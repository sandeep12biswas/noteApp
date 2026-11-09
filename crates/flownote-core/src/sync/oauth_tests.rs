use super::*;
use crate::sync::fake_http::{serve, Req, Resp};
use crate::sync::http::Retry;
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

fn http() -> Http {
    Http::new(Retry { attempts: 3, base_delay: Duration::from_millis(5), max_delay: Duration::from_millis(20) }).unwrap()
}

fn provider(base: &str, secret: Option<&str>) -> Provider {
    Provider {
        name: "TestDrive",
        auth_url: format!("{base}/authorize"),
        token_url: format!("{base}/token"),
        client_id: "client-1".into(),
        client_secret: secret.map(str::to_string),
        scopes: "files offline".into(),
        redirect_host: "127.0.0.1",
        extra_auth_params: vec![("prompt", "consent")],
    }
}

fn auth_params(url: &str) -> HashMap<String, String> {
    http::parse_query(url.split_once('?').unwrap().1).into_iter().collect()
}

/// What the browser does after the user signs in: request the redirect URI.
fn browser_returns(redirect_uri: &str, query: &str) -> std::thread::JoinHandle<(u16, String)> {
    let url = format!("{redirect_uri}?{query}");
    std::thread::spawn(move || {
        let r = reqwest::blocking::get(&url).unwrap();
        (r.status().as_u16(), r.text().unwrap())
    })
}

#[test]
fn pkce_challenge_matches_rfc_7636() {
    assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
}

#[test]
fn the_whole_sign_in_ends_with_tokens() {
    // The token endpoint checks the verifier against the challenge the
    // sign-in URL carried, as a real provider does.
    let challenge = Arc::new(Mutex::new(String::new()));
    let seen = challenge.clone();
    let base = serve(move |req: &Req, _| {
        assert_eq!(req.path(), "/token");
        let form = req.form();
        if form["grant_type"] != "authorization_code" || form["code"] != "the-code" || form["client_id"] != "client-1" || form["client_secret"] != "s3cret" {
            return Resp::json(400, json!({ "error": "invalid_request" }));
        }
        if pkce_challenge(&form["code_verifier"]) != *seen.lock().unwrap() {
            return Resp::json(400, json!({ "error": "invalid_grant", "error_description": "PKCE mismatch" }));
        }
        Resp::json(200, json!({ "access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600 }))
    });
    let p = provider(&base, Some("s3cret"));
    let auth = begin(&p).unwrap();
    let params = auth_params(&auth.url);
    assert!(auth.url.starts_with(&format!("{base}/authorize?")));
    assert_eq!(params["code_challenge_method"], "S256");
    assert_eq!(params["redirect_uri"], auth.redirect_uri);
    assert_eq!(params["prompt"], "consent");
    assert!(auth.redirect_uri.starts_with("http://127.0.0.1:"));
    *challenge.lock().unwrap() = params["code_challenge"].clone();

    let browser = browser_returns(&auth.redirect_uri, &format!("code=the-code&state={}", params["state"]));
    let code = auth.wait(&AtomicBool::new(false), Duration::from_secs(10)).unwrap();
    let (status, page) = browser.join().unwrap();
    assert_eq!((status, code.as_str()), (200, "the-code"));
    assert!(page.contains("Signed in"));

    let tokens = exchange(&http(), &p, &auth, &code).unwrap();
    assert_eq!(tokens.access_token, "at-1");
    assert_eq!(tokens.refresh_token.as_deref(), Some("rt-1"));
    assert!(tokens.expires_at > now_ms() + 3_500_000);
    assert_eq!(Tokens::from_json(&tokens.to_json()).unwrap(), tokens);
}

#[test]
fn a_reply_for_another_sign_in_is_ignored() {
    let p = provider("http://unused", None);
    let auth = begin(&p).unwrap();
    let state = auth_params(&auth.url)["state"].clone();
    let forged = browser_returns(&auth.redirect_uri, "code=evil&state=not-ours");
    let real_uri = auth.redirect_uri.clone();
    let real = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        browser_returns(&real_uri, &format!("code=good&state={state}")).join().unwrap()
    });
    assert_eq!(auth.wait(&AtomicBool::new(false), Duration::from_secs(10)).unwrap(), "good");
    assert_eq!(forged.join().unwrap().0, 400);
    assert_eq!(real.join().unwrap().0, 200);
}

#[test]
fn declining_cancelling_and_timing_out_end_the_wait() {
    let p = provider("http://unused", None);
    let auth = begin(&p).unwrap();
    let state = auth_params(&auth.url)["state"].clone();
    let browser = browser_returns(&auth.redirect_uri, &format!("error=access_denied&error_description=The+user+said+no&state={state}"));
    let e = auth.wait(&AtomicBool::new(false), Duration::from_secs(10)).unwrap_err();
    assert!(e.contains("The user said no"), "{e}");
    browser.join().unwrap();

    let auth = begin(&p).unwrap();
    assert!(auth.wait(&AtomicBool::new(true), Duration::from_secs(10)).unwrap_err().contains("cancelled"));
    assert!(auth.wait(&AtomicBool::new(false), Duration::from_millis(100)).unwrap_err().contains("timed out"));
}

#[test]
fn refresh_keeps_the_refresh_token_and_reports_a_revoked_sign_in() {
    let base = serve(|req: &Req, _| match req.form()["refresh_token"].as_str() {
        "good" => Resp::json(200, json!({ "access_token": "at-2", "expires_in": 60 })),
        _ => Resp::json(400, json!({ "error": "invalid_grant", "error_description": "Token has been expired or revoked." })),
    });
    let p = provider(&base, None);
    let t = refresh(&http(), &p, "good").unwrap();
    assert_eq!((t.access_token.as_str(), t.refresh_token.as_deref()), ("at-2", Some("good")));
    let e = refresh(&http(), &p, "revoked").unwrap_err();
    assert!(e.ends_with(SIGN_IN_AGAIN), "{e}");
}

#[test]
fn a_401_refreshes_the_token_once_and_retries() {
    let base = serve(|req: &Req, _| match (req.path(), req.header("authorization")) {
        ("/token", _) => Resp::json(200, json!({ "access_token": "fresh", "expires_in": 3600 })),
        ("/api", Some("Bearer fresh")) => Resp::json(200, json!({ "ok": true })),
        ("/api", _) => Resp::status(401),
        _ => Resp::status(404),
    });
    let saved = Arc::new(Mutex::new(None));
    let saved2 = saved.clone();
    let source = TokenSource::new(
        provider(&base, None),
        Tokens { access_token: "stale".into(), refresh_token: Some("rt".into()), expires_at: now_ms() + 3_600_000 },
        Box::new(move |t| {
            *saved2.lock().unwrap() = Some(t.access_token.clone());
            Ok(())
        }),
    );
    let h = http();
    let r = source.send(&h, "api", |c| c.get(format!("{base}/api"))).unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(saved.lock().unwrap().as_deref(), Some("fresh"), "refreshed tokens are saved");
    assert_eq!(source.access_token(&h).unwrap(), "fresh");
}

#[test]
fn an_expiring_token_is_refreshed_before_use() {
    let base = serve(|_: &Req, _| Resp::json(200, json!({ "access_token": "renewed", "expires_in": 3600 })));
    let source = TokenSource::new(
        provider(&base, None),
        Tokens { access_token: "old".into(), refresh_token: Some("rt".into()), expires_at: now_ms() + 10_000 },
        Box::new(|_| Ok(())),
    );
    assert_eq!(source.access_token(&http()).unwrap(), "renewed");
}

#[test]
fn throttled_requests_are_retried() {
    let calls = Arc::new(AtomicUsize::new(0));
    let c = calls.clone();
    let base = serve(move |_: &Req, _| match c.fetch_add(1, Ordering::SeqCst) {
        0 => Resp::status(429).header("Retry-After", "0"),
        1 => Resp::status(503),
        _ => Resp::json(200, json!({})),
    });
    let r = http().send("test", |c| c.get(format!("{base}/x"))).unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}
