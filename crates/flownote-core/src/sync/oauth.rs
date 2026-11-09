//! Signing in to a cloud drive (sync step S6): OAuth 2.0 authorization code
//! with PKCE and a loopback redirect, as RFC 8252 describes for desktop apps.
//!
//! 1. [`begin`] listens on a free port of this computer and builds the
//!    provider's sign-in URL; the shell opens it in the system browser.
//! 2. [`Authorization::wait`] receives the browser's redirect back to
//!    `http://127.0.0.1:<port>/` (or `localhost` for Microsoft) and checks it
//!    belongs to this sign-in (`state`).
//! 3. [`exchange`] trades the code (plus the PKCE verifier only this app
//!    knows) for tokens.
//!
//! [`TokenSource`] then keeps the access token fresh for the cloud targets,
//! saving refreshed tokens through a callback (`sync_settings.oauth_tokens`).

use base64::Engine as _;
use reqwest::blocking::{Client, RequestBuilder, Response};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::http::{self, Http};
use crate::store::now_ms;

/// Ends the message of an error that only signing in again can fix (the
/// refresh token expired or was revoked); the sync service then forgets the
/// tokens so the status asks for a new sign-in.
pub const SIGN_IN_AGAIN: &str = "Sign in again to keep syncing.";

/// A provider's OAuth endpoints and this app's registration with it.
#[derive(Debug, Clone)]
pub struct Provider {
    /// Shown in messages: "OneDrive", "Google Drive".
    pub name: &'static str,
    pub auth_url: String,
    pub token_url: String,
    pub client_id: String,
    /// Google's "Desktop app" clients have one; it isn't secret (it ships in
    /// the app) but the token endpoint wants it. PKCE is what protects the code.
    pub client_secret: Option<String>,
    pub scopes: String,
    /// `127.0.0.1`, or `localhost` where the provider only accepts that.
    pub redirect_host: &'static str,
    pub extra_auth_params: Vec<(&'static str, &'static str)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Epoch ms.
    pub expires_at: i64,
}

impl Tokens {
    pub fn to_json(&self) -> String {
        json!({ "accessToken": self.access_token, "refreshToken": self.refresh_token, "expiresAt": self.expires_at }).to_string()
    }

    pub fn from_json(text: &str) -> Result<Tokens, String> {
        let v: Value = serde_json::from_str(text).map_err(|e| format!("stored sign-in is damaged: {e}"))?;
        Ok(Tokens {
            access_token: v["accessToken"].as_str().ok_or("stored sign-in has no access token")?.to_string(),
            refresh_token: v["refreshToken"].as_str().map(str::to_string),
            expires_at: v["expiresAt"].as_i64().unwrap_or(0),
        })
    }

    /// From a token endpoint's JSON answer; `previous_refresh` is kept when
    /// a refresh answer doesn't include a new one (Google's don't).
    fn from_response(v: &Value, previous_refresh: Option<String>) -> Result<Tokens, String> {
        let access_token = v["access_token"].as_str().ok_or("the sign-in answer has no access token")?.to_string();
        let expires_in = v["expires_in"].as_i64().unwrap_or(3600);
        Ok(Tokens {
            access_token,
            refresh_token: v["refresh_token"].as_str().map(str::to_string).or(previous_refresh),
            expires_at: now_ms() + expires_in * 1000,
        })
    }
}

fn b64url() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// RFC 7636 S256: base64url(sha256(verifier)), no padding.
pub fn pkce_challenge(verifier: &str) -> String {
    b64url().encode(Sha256::digest(verifier.as_bytes()))
}

/// 64 random characters from the PKCE alphabet (two UUID v4s, hex).
fn random_verifier() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// A sign-in in progress: open `url` in the browser, then [`wait`](Self::wait).
pub struct Authorization {
    pub url: String,
    pub redirect_uri: String,
    verifier: String,
    state: String,
    listeners: Vec<TcpListener>,
}

/// Starts a sign-in: listens for the redirect and builds the sign-in URL.
pub fn begin(provider: &Provider) -> Result<Authorization, String> {
    let main = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("couldn't listen for the sign-in reply: {e}"))?;
    let port = main.local_addr().map_err(|e| e.to_string())?.port();
    let mut listeners = vec![main];
    if provider.redirect_host == "localhost" {
        // Browsers may resolve `localhost` to ::1; listen there too when we can.
        if let Ok(v6) = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port))) {
            listeners.push(v6);
        }
    }
    for l in &listeners {
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
    }
    let redirect_uri = format!("http://{}:{port}/", provider.redirect_host);
    let verifier = random_verifier();
    let state = uuid::Uuid::new_v4().simple().to_string();
    let challenge = pkce_challenge(&verifier);
    let mut params = vec![
        ("client_id", provider.client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri.as_str()),
        ("scope", provider.scopes.as_str()),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
    ];
    params.extend(provider.extra_auth_params.iter().copied());
    let url = format!("{}?{}", provider.auth_url, http::form(&params));
    Ok(Authorization { url, redirect_uri, verifier, state, listeners })
}

const PAGE_DONE: &str = "<!doctype html><meta charset=utf-8><title>FlowNote</title>\
<body style=\"font-family:system-ui;margin:3em\"><h2>Signed in</h2><p>You can close this tab and go back to FlowNote.</p>";
const PAGE_FAILED: &str = "<!doctype html><meta charset=utf-8><title>FlowNote</title>\
<body style=\"font-family:system-ui;margin:3em\"><h2>Sign-in didn't finish</h2><p>Go back to FlowNote to try again.</p>";

fn reply(mut stream: TcpStream, status: &str, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

impl Authorization {
    /// Waits for the browser's redirect and returns the authorization code.
    /// Fails if the user declined, the reply isn't for this sign-in,
    /// `cancel` is set, or `timeout` passes.
    pub fn wait(&self, cancel: &AtomicBool, timeout: Duration) -> Result<String, String> {
        let start = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Sign-in was cancelled.".into());
            }
            if start.elapsed() > timeout {
                return Err("Sign-in timed out. Try again.".into());
            }
            let accepted = self.listeners.iter().find_map(|l| l.accept().ok());
            let Some((mut stream, _)) = accepted else {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            let target = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
            let Some(query) = target.strip_prefix("/?") else {
                reply(stream, "404 Not Found", ""); // e.g. /favicon.ico
                continue;
            };
            let params = http::parse_query(query);
            let get = |k: &str| params.iter().find(|(name, _)| name == k).map(|(_, v)| v.clone());
            if get("state").as_deref() != Some(self.state.as_str()) {
                reply(stream, "400 Bad Request", PAGE_FAILED);
                continue; // not our sign-in: keep waiting for the real reply
            }
            if let Some(error) = get("error") {
                reply(stream, "200 OK", PAGE_FAILED);
                let detail = get("error_description").unwrap_or(error);
                return Err(format!("Sign-in didn't finish: {detail}"));
            }
            match get("code") {
                Some(code) => {
                    reply(stream, "200 OK", PAGE_DONE);
                    return Ok(code);
                }
                None => reply(stream, "400 Bad Request", PAGE_FAILED),
            }
        }
    }
}

fn token_request(http: &Http, provider: &Provider, pairs: &[(&str, &str)]) -> Result<Value, (u16, String)> {
    let mut all = pairs.to_vec();
    all.push(("client_id", &provider.client_id));
    if let Some(secret) = &provider.client_secret {
        all.push(("client_secret", secret));
    }
    let body = http::form(&all);
    let response = http
        .send(provider.name, |c| c.post(&provider.token_url).header("Content-Type", "application/x-www-form-urlencoded").body(body.clone()))
        .map_err(|e| (0, e))?;
    let status = response.status().as_u16();
    let text = response.text().unwrap_or_default();
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        let code = value["error"].as_str().unwrap_or_default().to_string();
        let detail = value["error_description"].as_str().map(str::to_string).unwrap_or_else(|| text.chars().take(200).collect());
        return Err((status, format!("{code}|{detail}")));
    }
    Ok(value)
}

/// Trades the authorization code for tokens.
pub fn exchange(http: &Http, provider: &Provider, auth: &Authorization, code: &str) -> Result<Tokens, String> {
    let value = token_request(
        http,
        provider,
        &[("grant_type", "authorization_code"), ("code", code), ("redirect_uri", &auth.redirect_uri), ("code_verifier", &auth.verifier)],
    )
    .map_err(|(status, e)| format!("{} sign-in failed ({status}): {}", provider.name, e.replace('|', ": ")))?;
    Tokens::from_response(&value, None)
}

/// A new access token from the refresh token.
pub fn refresh(http: &Http, provider: &Provider, refresh_token: &str) -> Result<Tokens, String> {
    match token_request(http, provider, &[("grant_type", "refresh_token"), ("refresh_token", refresh_token)]) {
        Ok(value) => Tokens::from_response(&value, Some(refresh_token.to_string())),
        Err((_, e)) if e.starts_with("invalid_grant|") => Err(format!("The {} sign-in has expired or was revoked. {SIGN_IN_AGAIN}", provider.name)),
        Err((status, e)) => Err(format!("Couldn't renew the {} sign-in ({status}): {}", provider.name, e.replace('|', ": "))),
    }
}

/// Saves tokens after a refresh (to `sync_settings.oauth_tokens`).
pub type SaveTokens = Box<dyn Fn(&Tokens) -> Result<(), String> + Send + Sync>;

/// Current tokens for one signed-in account, refreshed when needed.
pub struct TokenSource {
    pub provider: Provider,
    tokens: Mutex<Tokens>,
    /// Saves refreshed tokens.
    on_refresh: SaveTokens,
}

impl TokenSource {
    pub fn new(provider: Provider, tokens: Tokens, on_refresh: SaveTokens) -> TokenSource {
        TokenSource { provider, tokens: Mutex::new(tokens), on_refresh }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Tokens> {
        self.tokens.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The access token, refreshed first if it expires within a minute.
    pub fn access_token(&self, http: &Http) -> Result<String, String> {
        let tokens = self.lock().clone();
        if tokens.expires_at - now_ms() > 60_000 {
            return Ok(tokens.access_token);
        }
        self.refresh_now(http)
    }

    /// Refreshes now (the API said the token isn't valid any more).
    pub fn refresh_now(&self, http: &Http) -> Result<String, String> {
        let current = self.lock().clone();
        let Some(refresh_token) = current.refresh_token else {
            return Err(format!("The {} sign-in can't be renewed. {SIGN_IN_AGAIN}", self.provider.name));
        };
        let fresh = refresh(http, &self.provider, &refresh_token)?;
        (self.on_refresh)(&fresh)?;
        *self.lock() = fresh.clone();
        Ok(fresh.access_token)
    }

    /// Sends an authorized request; on 401 refreshes the token once and
    /// sends it again.
    pub fn send(&self, http: &Http, what: &str, build: impl Fn(&Client) -> RequestBuilder) -> Result<Response, String> {
        let token = self.access_token(http)?;
        let response = http.send(what, |c| build(c).bearer_auth(&token))?;
        if response.status().as_u16() != 401 {
            return Ok(response);
        }
        let token = self.refresh_now(http)?;
        http.send(what, |c| build(c).bearer_auth(&token))
    }
}

#[cfg(test)]
#[path = "oauth_tests.rs"]
mod tests;
