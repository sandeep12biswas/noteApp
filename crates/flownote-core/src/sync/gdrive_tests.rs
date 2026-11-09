use super::*;
use crate::sync::fake_clouds::{drive, fast_http, token_source, DriveState};
use crate::sync::target::tests::exercise;
use std::sync::Mutex as StdMutex;

fn target() -> (GoogleDriveTarget, Arc<StdMutex<DriveState>>) {
    let (base, state) = drive();
    (GoogleDriveTarget::with_api(fast_http(), token_source(&base), &base), state)
}

#[test]
fn behaves_like_a_folder_inside_a_visible_flownote_folder() {
    let (t, state) = target();
    exercise(&t);
    assert_eq!(state.lock().unwrap().paths(), ["FlowNote/a/c/d.bin", "FlowNote/e.bin"]);
}

#[test]
fn folders_and_files_duplicated_by_a_race_are_read_as_one() {
    let (t, state) = target();
    t.put("vault.json", b"first").unwrap();
    {
        // Two devices each created `devices` at the same moment, and a
        // retried upload left a second, newer vault.json.
        let mut st = state.lock().unwrap();
        let root = st.files.values().find(|f| f.name == "FlowNote").unwrap().id.clone();
        let d1 = st.add("devices", &root, true, vec![]);
        let d2 = st.add("devices", &root, true, vec![]);
        st.add("one.enc", &d1, false, b"1".to_vec());
        st.add("two.enc", &d2, false, b"2".to_vec());
        st.add("vault.json", &root, false, b"second".to_vec());
    }
    let listed: Vec<String> = t.list("").unwrap().into_iter().map(|f| f.path).collect();
    assert_eq!(listed, ["devices/one.enc", "devices/two.enc", "vault.json"]);
    assert_eq!(t.get("vault.json").unwrap().unwrap(), b"first", "the oldest of a name is the one read");
    assert_eq!(t.get("devices/two.enc").unwrap().unwrap(), b"2");

    t.put("vault.json", b"updated").unwrap();
    assert_eq!(t.get("vault.json").unwrap().unwrap(), b"updated", "and the one replaced");
    t.delete("vault.json").unwrap();
    assert_eq!(t.get("vault.json").unwrap(), None, "delete removes every copy");
}

#[test]
fn another_device_finds_what_the_first_wrote() {
    let (base, state) = drive();
    let a = GoogleDriveTarget::with_api(fast_http(), token_source(&base), &base);
    let b = GoogleDriveTarget::with_api(fast_http(), token_source(&base), &base);
    a.put("devices/a/changes/0000000001.bundle.enc", b"x").unwrap();
    assert_eq!(b.list("devices/").unwrap().len(), 1);
    b.put("devices/b/info.json.enc", b"y").unwrap();
    assert_eq!(a.list("devices/").unwrap().len(), 2, "a's cached folder ids still see b's new subfolder");
    let folders = state.lock().unwrap().files.values().filter(|f| f.name == "devices").count();
    assert_eq!(folders, 1, "b reused a's folder");
}

#[test]
fn names_the_signed_in_account_and_escapes_query_literals() {
    let (t, _) = target();
    assert_eq!(t.account().unwrap(), "test@gmail.com");
    assert_eq!(q_literal("it's a\\b"), "'it\\'s a\\\\b'");
}
