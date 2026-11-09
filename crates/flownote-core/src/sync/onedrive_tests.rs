use super::*;
use crate::sync::fake_clouds::{fast_http, graph, token_source};
use crate::sync::target::tests::exercise;

fn target() -> (OneDriveTarget, std::sync::Arc<std::sync::Mutex<crate::sync::fake_clouds::GraphState>>) {
    let (base, api, state) = graph();
    (OneDriveTarget::with_api(fast_http(), token_source(&base), &api), state)
}

#[test]
fn behaves_like_a_folder() {
    let (t, state) = target();
    exercise(&t);
    assert!(state.lock().unwrap().files.contains_key("a/c/d.bin"), "stored under the app folder by path");
}

#[test]
fn big_files_go_up_in_chunks_without_the_bearer_token() {
    let (t, state) = target();
    let t = t.with_upload_sizes(10, 8);
    let data: Vec<u8> = (0..50u8).collect();
    t.put("blobs/big.enc", &data).unwrap();
    assert_eq!(state.lock().unwrap().session_chunks, 7);
    assert_eq!(t.get("blobs/big.enc").unwrap().unwrap(), data);
    t.put("blobs/small.enc", b"tiny").unwrap(); // under the limit: one request
    assert_eq!(state.lock().unwrap().session_chunks, 7);
}

#[test]
fn listing_follows_every_page_and_skips_other_prefixes() {
    let (t, _) = target();
    for i in 0..5 {
        t.put(&format!("devices/d1/changes/{i:010}.bundle.enc"), b"x").unwrap();
    }
    t.put("devices/d1/info.json.enc", b"i").unwrap();
    t.put("blobs/b.enc", b"b").unwrap();
    let listed: Vec<String> = t.list("devices/").unwrap().into_iter().map(|f| f.path).collect();
    assert_eq!(listed.len(), 6, "{listed:?}");
    assert!(listed.iter().all(|p| p.starts_with("devices/d1/")));
    assert_eq!(t.list("devices/d1/changes/").unwrap().len(), 5);
    assert!(t.list("nothing/").unwrap().is_empty(), "a missing folder lists as empty");
    assert_eq!(t.list("").unwrap().len(), 7);
}

#[test]
fn names_the_signed_in_account() {
    let (t, _) = target();
    assert_eq!(t.account().unwrap(), "test@example.com");
}
