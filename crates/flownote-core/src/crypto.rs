//! End-to-end encryption for sync (step S3): everything FlowNote writes to
//! the user's cloud drive is encrypted on the device first, so the provider
//! (OneDrive, Google Drive, …) only ever stores ciphertext.
//!
//! - A **vault** (`vault.json`, the one file stored unencrypted) records how
//!   to turn the user's passphrase into the key: Argon2id with a random salt
//!   and its cost settings. It also holds a short known value encrypted with
//!   that key, so a wrong passphrase is reported as wrong instead of every
//!   later file failing to decrypt.
//! - Every other file is sealed with XChaCha20-Poly1305 under that key, with
//!   a fresh random nonce, and bound to its path in the vault (the AEAD's
//!   associated data) — a file moved to another path won't decrypt, so a
//!   change log can't be passed off as a different device's.
//!
//! Losing the passphrase means the cloud copy can't be read; each device's
//! local database is unaffected. The key is never derived from anything but
//! the passphrase and is never uploaded.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde_json::{json, Value};
use zeroize::Zeroize;

/// Sealed files start with this, so a file that isn't one (or is from a
/// future format) is recognised before trying to decrypt it.
const MAGIC: &[u8; 4] = b"FNE1";
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const VAULT_FORMAT: u64 = 1;
const CHECK_PATH: &str = "vault.json#check";
const CHECK_PLAINTEXT: &[u8] = b"flownote vault check";

/// Argon2id cost. The default (64 MiB, 3 passes) is OWASP's recommended
/// Argon2id setting, paid once per device when the passphrase is entered;
/// it's stored in the vault, so it can be raised later without breaking
/// existing vaults.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        KdfParams { memory_kib: 64 * 1024, iterations: 3, parallelism: 1 }
    }
}

/// The 256-bit vault key. Zeroed when dropped.
#[derive(Clone, PartialEq)]
pub struct VaultKey([u8; KEY_LEN]);

impl Drop for VaultKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl std::fmt::Debug for VaultKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultKey(…)")
    }
}

impl VaultKey {
    /// Text form, for keeping the key in this device's database
    /// (`sync_settings.vault_key`) so the passphrase is asked only once.
    pub fn to_base64(&self) -> String {
        b64().encode(self.0)
    }

    pub fn from_base64(text: &str) -> Result<VaultKey, String> {
        let bytes = b64().decode(text).map_err(|e| format!("bad vault key: {e}"))?;
        let bytes: [u8; KEY_LEN] = bytes.try_into().map_err(|_| "bad vault key: wrong length".to_string())?;
        Ok(VaultKey(bytes))
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

#[derive(Debug, PartialEq)]
pub enum UnlockError {
    WrongPassphrase,
    /// The vault file itself is unreadable or from an unknown format.
    BadVault(String),
}

impl std::fmt::Display for UnlockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnlockError::WrongPassphrase => f.write_str("wrong passphrase"),
            UnlockError::BadVault(e) => write!(f, "the sync vault can't be read: {e}"),
        }
    }
}

fn derive_key(passphrase: &str, salt: &[u8], params: KdfParams) -> Result<VaultKey, String> {
    let params = Params::new(params.memory_kib, params.iterations, params.parallelism, Some(KEY_LEN)).map_err(|e| e.to_string())?;
    let mut key = VaultKey([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut key.0)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// Starts a new vault for `passphrase`: returns the `vault.json` contents to
/// upload and the key. Called once, on the first device that sets up sync.
pub fn create_vault(passphrase: &str, params: KdfParams) -> Result<(Value, VaultKey), String> {
    if passphrase.is_empty() {
        return Err("the passphrase can't be empty".into());
    }
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let key = derive_key(passphrase, &salt, params)?;
    let check = seal(&key, CHECK_PATH, CHECK_PLAINTEXT)?;
    let vault = json!({
        "format": VAULT_FORMAT,
        "vaultId": uuid::Uuid::new_v4().to_string(),
        "kdf": {
            "algorithm": "argon2id",
            "memoryKib": params.memory_kib,
            "iterations": params.iterations,
            "parallelism": params.parallelism,
            "salt": b64().encode(salt),
        },
        "check": b64().encode(check),
    });
    Ok((vault, key))
}

/// Derives the key from `passphrase` for an existing vault (every later
/// device), checking it against the vault's known value.
pub fn unlock_vault(vault: &Value, passphrase: &str) -> Result<VaultKey, UnlockError> {
    let bad = |e: &str| UnlockError::BadVault(e.to_string());
    if vault.get("format").and_then(Value::as_u64) != Some(VAULT_FORMAT) {
        return Err(bad("unsupported format (made by a newer FlowNote?)"));
    }
    let kdf = vault.get("kdf").ok_or_else(|| bad("missing kdf"))?;
    if kdf.get("algorithm").and_then(Value::as_str) != Some("argon2id") {
        return Err(bad("unsupported key derivation"));
    }
    let number = |name: &str| -> Result<u32, UnlockError> {
        kdf.get(name).and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).ok_or_else(|| bad(name))
    };
    let params = KdfParams { memory_kib: number("memoryKib")?, iterations: number("iterations")?, parallelism: number("parallelism")? };
    let salt = kdf.get("salt").and_then(Value::as_str).and_then(|s| b64().decode(s).ok()).ok_or_else(|| bad("salt"))?;
    let check = vault.get("check").and_then(Value::as_str).and_then(|s| b64().decode(s).ok()).ok_or_else(|| bad("check"))?;

    let key = derive_key(passphrase, &salt, params).map_err(|e| bad(&e))?;
    match open(&key, CHECK_PATH, &check) {
        Ok(plain) if plain == CHECK_PLAINTEXT => Ok(key),
        _ => Err(UnlockError::WrongPassphrase),
    }
}

/// Encrypts `plaintext` for storage at `path` in the vault:
/// `FNE1 ‖ nonce (24 bytes) ‖ ciphertext and tag`.
pub fn seal(key: &VaultKey, path: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&key.0));
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad: path.as_bytes() })
        .map_err(|_| format!("could not encrypt {path}"))?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypts a file sealed for `path`. Fails — never returns partial or
/// unauthenticated data — if the key is wrong, the file was altered or
/// truncated, or it was sealed for a different path.
pub fn open(key: &VaultKey, path: &str, sealed: &[u8]) -> Result<Vec<u8>, String> {
    if sealed.len() < MAGIC.len() + NONCE_LEN || &sealed[..MAGIC.len()] != MAGIC {
        return Err(format!("{path} is not a FlowNote encrypted file"));
    }
    let (nonce, ciphertext) = sealed[MAGIC.len()..].split_at(NONCE_LEN);
    XChaCha20Poly1305::new(Key::from_slice(&key.0))
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ciphertext, aad: path.as_bytes() })
        .map_err(|_| format!("{path} could not be decrypted (wrong key, or the file is damaged)"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cheap settings so tests run fast; real vaults use the default.
    const FAST: KdfParams = KdfParams { memory_kib: 256, iterations: 1, parallelism: 1 };

    #[test]
    fn the_right_passphrase_unlocks_the_same_key() {
        let (vault, key) = create_vault("correct horse", FAST).unwrap();
        // The vault travels as text (vault.json).
        let vault: Value = serde_json::from_str(&vault.to_string()).unwrap();
        assert_eq!(unlock_vault(&vault, "correct horse").unwrap(), key);
    }

    #[test]
    fn a_wrong_passphrase_is_reported_as_wrong() {
        let (vault, _) = create_vault("correct horse", FAST).unwrap();
        assert_eq!(unlock_vault(&vault, "correct hors").unwrap_err(), UnlockError::WrongPassphrase);
    }

    #[test]
    fn the_vault_holds_no_secrets_and_salts_differ() {
        let (a, key) = create_vault("pass phrase", FAST).unwrap();
        let (b, _) = create_vault("pass phrase", FAST).unwrap();
        let text = a.to_string();
        assert!(!text.contains("pass phrase"));
        assert!(!text.contains(&key.to_base64()));
        assert_ne!(a["kdf"]["salt"], b["kdf"]["salt"]);
        assert_eq!(a["kdf"]["memoryKib"], 256);
    }

    #[test]
    fn unknown_vault_formats_are_refused() {
        let (mut vault, _) = create_vault("p", FAST).unwrap();
        vault["format"] = json!(2);
        assert!(matches!(unlock_vault(&vault, "p"), Err(UnlockError::BadVault(_))));
        assert!(matches!(unlock_vault(&json!({}), "p"), Err(UnlockError::BadVault(_))));
        assert!(create_vault("", FAST).is_err());
    }

    #[test]
    fn sealed_files_round_trip_and_never_repeat() {
        let (_, key) = create_vault("p", FAST).unwrap();
        let path = "devices/d1/changes/1.am";
        let a = seal(&key, path, b"automerge bytes").unwrap();
        let b = seal(&key, path, b"automerge bytes").unwrap();
        assert_ne!(a, b, "a fresh nonce every time");
        assert!(!a.windows(9).any(|w| w == b"automerge"), "no plaintext in the output");
        assert_eq!(open(&key, path, &a).unwrap(), b"automerge bytes");
    }

    #[test]
    fn altered_moved_or_foreign_files_do_not_decrypt() {
        let (_, key) = create_vault("p", FAST).unwrap();
        let (_, other_key) = create_vault("p", FAST).unwrap(); // same passphrase, other vault
        let path = "devices/d1/changes/1.am";
        let sealed = seal(&key, path, b"data").unwrap();

        let mut flipped = sealed.clone();
        *flipped.last_mut().unwrap() ^= 1;
        assert!(open(&key, path, &flipped).is_err(), "tampered");
        assert!(open(&key, path, &sealed[..sealed.len() - 1]).is_err(), "truncated");
        assert!(open(&key, "devices/d2/changes/1.am", &sealed).is_err(), "moved to another path");
        assert!(open(&other_key, path, &sealed).is_err(), "another vault's key");
        assert!(open(&key, path, b"plain text").is_err(), "not sealed at all");
    }

    #[test]
    fn the_key_survives_being_stored_as_text() {
        let (_, key) = create_vault("p", FAST).unwrap();
        assert_eq!(VaultKey::from_base64(&key.to_base64()).unwrap(), key);
        assert!(VaultKey::from_base64("c2hvcnQ=").is_err());
        assert_eq!(format!("{key:?}"), "VaultKey(…)", "never printed");
    }

    #[test]
    fn the_default_cost_is_real() {
        let p = KdfParams::default();
        assert!(p.memory_kib >= 64 * 1024 && p.iterations >= 3);
    }
}
