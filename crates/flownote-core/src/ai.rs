//! Generic AI text generation — one interface, several providers
//! (EXECUTION_PLAN.md Features — "Generic AI interface"). Every request is
//! made here, in the Rust backend: API keys (stored by `store`'s
//! `ai_providers` table) never reach the renderer or a plugin.
//!
//! Three wire protocols cover the common services:
//! - `Anthropic` — Claude, via the Messages API (`POST /v1/messages`);
//! - `Gemini` — Google's Generative Language API (`:streamGenerateContent`);
//! - `OpenAiCompatible` — OpenAI's chat completions API
//!   (`POST {base}/chat/completions`), also spoken by Ollama
//!   (`http://localhost:11434/v1`), LM Studio, OpenRouter, Mistral, Groq, ….
//!
//! All three stream Server-Sent Events. The protocol details are pure
//! functions (`build_request`, `parse_sse_data`, `error_message`) so they're
//! unit-tested without a network; `stream_completion` is the blocking HTTP
//! runner on top of them, tested against a local mock server.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Anthropic,
    Gemini,
    OpenAiCompatible,
}

impl ProviderKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "anthropic" => Ok(Self::Anthropic),
            "gemini" => Ok(Self::Gemini),
            "openai_compatible" => Ok(Self::OpenAiCompatible),
            other => Err(format!("unknown AI provider kind `{other}` (expected anthropic, gemini or openai_compatible)")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::OpenAiCompatible => "openai_compatible",
        }
    }

    /// The official endpoint; users can point any provider elsewhere (a proxy, a local server).
    pub fn default_base_url(self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::Gemini => "https://generativelanguage.googleapis.com",
            Self::OpenAiCompatible => "https://api.openai.com/v1",
        }
    }

    /// A starting point only — the model is an editable setting per provider.
    pub fn default_model(self) -> &'static str {
        match self {
            Self::Anthropic => "claude-opus-5-5",
            Self::Gemini => "gemini-2.5-flash",
            Self::OpenAiCompatible => "gpt-4o-mini",
        }
    }
}

/// Everything needed to call one configured provider.
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

/// Framing for every provider, so they all behave like the same feature.
pub const SYSTEM_PROMPT: &str = "You are a writing assistant inside FlowNote, a note-taking app. \
The user is editing a note; their request is followed by the text of the note segment they are in. \
Reply with only the text to insert into the note — no preamble, no explanation, no Markdown code fences.";

/// Upper bound on generated tokens (Claude requires one; others accept it).
pub const MAX_TOKENS: u32 = 1024;

#[derive(Debug, PartialEq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

fn user_message(prompt: &str, context: &str) -> String {
    if context.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("{prompt}\n\n---\nCurrent note segment:\n{context}")
    }
}

/// The streaming HTTP request for one completion.
pub fn build_request(cfg: &ProviderConfig, prompt: &str, context: &str) -> Result<HttpRequest, String> {
    let base = cfg.base_url.trim_end_matches('/');
    let message = user_message(prompt, context);
    let key = cfg.api_key.as_deref().filter(|k| !k.is_empty());
    let mut headers = vec![("content-type".to_string(), "application/json".to_string())];

    let (url, body) = match cfg.kind {
        ProviderKind::Anthropic => {
            let key = key.ok_or("Claude needs an API key — add one in AI settings")?;
            headers.push(("x-api-key".into(), key.into()));
            headers.push(("anthropic-version".into(), "2023-06-01".into()));
            (
                format!("{base}/v1/messages"),
                json!({
                    "model": cfg.model,
                    "max_tokens": MAX_TOKENS,
                    "system": SYSTEM_PROMPT,
                    "messages": [{ "role": "user", "content": message }],
                    "stream": true,
                }),
            )
        }
        ProviderKind::Gemini => {
            let key = key.ok_or("Gemini needs an API key — add one in AI settings")?;
            headers.push(("x-goog-api-key".into(), key.into()));
            (
                format!("{base}/v1beta/models/{}:streamGenerateContent?alt=sse", cfg.model),
                json!({
                    "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
                    "contents": [{ "role": "user", "parts": [{ "text": message }] }],
                    "generationConfig": { "maxOutputTokens": MAX_TOKENS },
                }),
            )
        }
        ProviderKind::OpenAiCompatible => {
            // Optional: local servers (Ollama, LM Studio) don't need one.
            if let Some(key) = key {
                headers.push(("authorization".into(), format!("Bearer {key}")));
            }
            (
                format!("{base}/chat/completions"),
                json!({
                    "model": cfg.model,
                    "max_tokens": MAX_TOKENS,
                    "stream": true,
                    "messages": [
                        { "role": "system", "content": SYSTEM_PROMPT },
                        { "role": "user", "content": message },
                    ],
                }),
            )
        }
    };
    Ok(HttpRequest { url, headers, body })
}

#[derive(Debug, PartialEq)]
pub enum StreamEvent {
    Text(String),
    Done,
    Error(String),
}

/// One Server-Sent Event's `data:` payload, in `kind`'s format.
pub fn parse_sse_data(kind: ProviderKind, data: &str) -> Vec<StreamEvent> {
    let data = data.trim();
    if kind == ProviderKind::OpenAiCompatible && data == "[DONE]" {
        return vec![StreamEvent::Done];
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else { return vec![] };
    if let Some(message) = v.get("error").and_then(error_text) {
        return vec![StreamEvent::Error(message)];
    }
    match kind {
        ProviderKind::Anthropic => match v.get("type").and_then(Value::as_str) {
            Some("content_block_delta") => v
                .pointer("/delta/text")
                .and_then(Value::as_str)
                .map(|t| vec![StreamEvent::Text(t.to_string())])
                .unwrap_or_default(),
            Some("message_stop") => vec![StreamEvent::Done],
            _ => vec![],
        },
        ProviderKind::Gemini => {
            let mut out: Vec<StreamEvent> = v
                .pointer("/candidates/0/content/parts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .filter(|t| !t.is_empty())
                .map(|t| StreamEvent::Text(t.to_string()))
                .collect();
            if v.pointer("/candidates/0/finishReason").and_then(Value::as_str).is_some() {
                out.push(StreamEvent::Done);
            }
            out
        }
        ProviderKind::OpenAiCompatible => v
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
            .map(|t| vec![StreamEvent::Text(t.to_string())])
            .unwrap_or_default(),
    }
}

/// `{"message": …}` (Claude, Gemini, OpenAI all nest it under `error`), or a bare string.
fn error_text(err: &Value) -> Option<String> {
    err.get("message").and_then(Value::as_str).map(str::to_string).or_else(|| err.as_str().map(str::to_string))
}

/// A readable error for a non-success HTTP response.
pub fn error_message(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).ok().and_then(|v| v.get("error").and_then(error_text));
    match (status, detail) {
        (401 | 403, Some(d)) => format!("The provider rejected the API key ({status}): {d}"),
        (401 | 403, None) => format!("The provider rejected the API key ({status})"),
        (_, Some(d)) => format!("The provider returned an error ({status}): {d}"),
        (_, None) => format!("The provider returned an error ({status}): {}", body.chars().take(300).collect::<String>()),
    }
}

/// Makes the request and calls `on_text` with each piece of generated text
/// as it streams in. Blocking — run it off any thread that must stay
/// responsive. Returns when the stream ends, or as soon as `cancel` is set
/// (checked between events; `Ok` — stopping isn't an error); `Err` for
/// transport, HTTP or in-stream provider errors.
pub fn stream_completion(
    cfg: &ProviderConfig,
    prompt: &str,
    context: &str,
    cancel: &AtomicBool,
    mut on_text: impl FnMut(&str),
) -> Result<(), String> {
    let req = build_request(cfg, prompt, context)?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(None::<Duration>)
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.post(&req.url).body(req.body.to_string());
    for (name, value) in &req.headers {
        builder = builder.header(name, value);
    }
    let response = builder.send().map_err(|e| format!("Couldn't reach the AI provider at {}: {e}", cfg.base_url))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(error_message(status.as_u16(), &body));
    }

    // Server-Sent Events: `data:` lines accumulate until a blank line ends the event.
    let mut data = String::new();
    for line in BufReader::new(response).lines() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let line = line.map_err(|e| format!("The AI response was interrupted: {e}"))?;
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
            continue;
        }
        if line.is_empty() && !data.is_empty() {
            for event in parse_sse_data(cfg.kind, &data) {
                match event {
                    StreamEvent::Text(t) => on_text(&t),
                    StreamEvent::Done => return Ok(()),
                    StreamEvent::Error(e) => return Err(format!("The AI provider reported an error: {e}")),
                }
            }
            data.clear();
        }
    }
    // Stream closed without an explicit end marker — whatever arrived stands.
    if !data.is_empty() {
        for event in parse_sse_data(cfg.kind, &data) {
            match event {
                StreamEvent::Text(t) => on_text(&t),
                StreamEvent::Error(e) => return Err(format!("The AI provider reported an error: {e}")),
                StreamEvent::Done => {}
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn cfg(kind: ProviderKind, base_url: &str, key: Option<&str>) -> ProviderConfig {
        ProviderConfig { kind, base_url: base_url.into(), model: "m-1".into(), api_key: key.map(str::to_string) }
    }

    fn header<'a>(req: &'a HttpRequest, name: &str) -> Option<&'a str> {
        req.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    // ---- build_request ----

    #[test]
    fn anthropic_request_matches_the_messages_api() {
        let req = build_request(&cfg(ProviderKind::Anthropic, "https://api.anthropic.com/", Some("sk-a")), "Summarise", "Some notes").unwrap();
        assert_eq!(req.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&req, "x-api-key"), Some("sk-a"));
        assert_eq!(header(&req, "anthropic-version"), Some("2023-06-01"));
        assert_eq!(req.body["model"], "m-1");
        assert_eq!(req.body["stream"], true);
        assert_eq!(req.body["max_tokens"], MAX_TOKENS);
        assert_eq!(req.body["system"], SYSTEM_PROMPT);
        let content = req.body["messages"][0]["content"].as_str().unwrap();
        assert!(content.starts_with("Summarise") && content.ends_with("Some notes"), "{content}");
    }

    #[test]
    fn gemini_request_matches_stream_generate_content() {
        let req = build_request(&cfg(ProviderKind::Gemini, "https://g.example", Some("g-key")), "Hi", "").unwrap();
        assert_eq!(req.url, "https://g.example/v1beta/models/m-1:streamGenerateContent?alt=sse");
        assert_eq!(header(&req, "x-goog-api-key"), Some("g-key"));
        assert_eq!(req.body["contents"][0]["parts"][0]["text"], "Hi"); // no context -> prompt alone
        assert_eq!(req.body["systemInstruction"]["parts"][0]["text"], SYSTEM_PROMPT);
    }

    #[test]
    fn openai_compatible_request_matches_chat_completions_and_key_is_optional() {
        let with = build_request(&cfg(ProviderKind::OpenAiCompatible, "https://api.openai.com/v1", Some("o-key")), "Hi", "").unwrap();
        assert_eq!(with.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(header(&with, "authorization"), Some("Bearer o-key"));
        assert_eq!(with.body["messages"][0]["role"], "system");
        assert_eq!(with.body["messages"][1]["content"], "Hi");

        let local = build_request(&cfg(ProviderKind::OpenAiCompatible, "http://localhost:11434/v1", None), "Hi", "").unwrap();
        assert_eq!(header(&local, "authorization"), None); // e.g. Ollama
    }

    #[test]
    fn claude_and_gemini_require_a_key() {
        assert!(build_request(&cfg(ProviderKind::Anthropic, "x", None), "p", "").unwrap_err().contains("API key"));
        assert!(build_request(&cfg(ProviderKind::Gemini, "x", Some("")), "p", "").unwrap_err().contains("API key"));
    }

    // ---- parse_sse_data ----

    #[test]
    fn parses_anthropic_events() {
        let k = ProviderKind::Anthropic;
        assert_eq!(parse_sse_data(k, r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}"#), vec![StreamEvent::Text("Hel".into())]);
        assert_eq!(parse_sse_data(k, r#"{"type":"message_start","message":{}}"#), vec![]);
        assert_eq!(parse_sse_data(k, r#"{"type":"message_stop"}"#), vec![StreamEvent::Done]);
        assert_eq!(parse_sse_data(k, r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#), vec![StreamEvent::Error("Overloaded".into())]);
    }

    #[test]
    fn parses_gemini_events() {
        let k = ProviderKind::Gemini;
        assert_eq!(parse_sse_data(k, r#"{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}"#), vec![StreamEvent::Text("Hi".into())]);
        assert_eq!(
            parse_sse_data(k, r#"{"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"STOP"}]}"#),
            vec![StreamEvent::Text("!".into()), StreamEvent::Done]
        );
    }

    #[test]
    fn parses_openai_events() {
        let k = ProviderKind::OpenAiCompatible;
        assert_eq!(parse_sse_data(k, r#"{"choices":[{"delta":{"content":"Yo"}}]}"#), vec![StreamEvent::Text("Yo".into())]);
        assert_eq!(parse_sse_data(k, r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), vec![]);
        assert_eq!(parse_sse_data(k, "[DONE]"), vec![StreamEvent::Done]);
        assert_eq!(parse_sse_data(k, "not json"), vec![]);
    }

    #[test]
    fn error_messages_are_readable() {
        assert_eq!(error_message(401, r#"{"error":{"message":"invalid x-api-key"}}"#), "The provider rejected the API key (401): invalid x-api-key");
        assert!(error_message(500, "upstream exploded").contains("(500): upstream exploded"));
    }

    // ---- stream_completion against a local mock server ----

    /// Serves one HTTP response (`status`, SSE `body`) on a free port; captures the raw request.
    fn mock_server(status: u16, body: &'static str) -> (String, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(String::new()));
        let seen2 = seen.clone();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let mut req = Vec::new();
            // Read headers + body (Content-Length is small here).
            loop {
                let n = sock.read(&mut buf).unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length: ").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                    if req.len() >= i + 4 + len {
                        break;
                    }
                }
            }
            *seen2.lock().unwrap() = String::from_utf8_lossy(&req).to_string();
            let head = format!("HTTP/1.1 {status} X\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n");
            sock.write_all(head.as_bytes()).unwrap();
            sock.write_all(body.as_bytes()).unwrap();
        });
        (url, seen)
    }

    #[test]
    fn streams_openai_compatible_text_until_done() {
        let (url, seen) = mock_server(
            200,
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\", world\"}}]}\n\ndata: [DONE]\n\n",
        );
        let mut out = String::new();
        stream_completion(&cfg(ProviderKind::OpenAiCompatible, &url, None), "Greet", "", &AtomicBool::new(false), |t| out.push_str(t)).unwrap();
        assert_eq!(out, "Hello, world");
        let req = seen.lock().unwrap().clone();
        assert!(req.starts_with("POST /chat/completions"), "{req}");
        assert!(req.contains("\"stream\":true"));
    }

    #[test]
    fn streams_anthropic_text_with_event_lines() {
        let (url, seen) = mock_server(
            200,
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Claude \"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"here\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
        );
        let mut out = String::new();
        stream_completion(&cfg(ProviderKind::Anthropic, &url, Some("sk")), "p", "", &AtomicBool::new(false), |t| out.push_str(t)).unwrap();
        assert_eq!(out, "Claude here");
        assert!(seen.lock().unwrap().to_lowercase().contains("x-api-key: sk"));
    }

    #[test]
    fn streams_gemini_text_until_finish_reason() {
        let (url, seen) = mock_server(
            200,
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Gem\"}]}}]}\r\n\r\ndata: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ini\"}]},\"finishReason\":\"STOP\"}]}\r\n\r\n",
        );
        let mut out = String::new();
        stream_completion(&cfg(ProviderKind::Gemini, &url, Some("g")), "p", "", &AtomicBool::new(false), |t| out.push_str(t)).unwrap();
        assert_eq!(out, "Gemini");
        assert!(seen.lock().unwrap().starts_with("POST /v1beta/models/m-1:streamGenerateContent?alt=sse"));
    }

    #[test]
    fn an_http_error_becomes_a_readable_message() {
        let (url, _) = mock_server(401, "{\"error\":{\"message\":\"bad key\"}}");
        let err = stream_completion(&cfg(ProviderKind::OpenAiCompatible, &url, Some("x")), "p", "", &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(err, "The provider rejected the API key (401): bad key");
    }

    #[test]
    fn an_in_stream_error_stops_with_it() {
        let (url, _) = mock_server(200, "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"par\"}}\n\ndata: {\"type\":\"error\",\"error\":{\"message\":\"Overloaded\"}}\n\n");
        let mut out = String::new();
        let err = stream_completion(&cfg(ProviderKind::Anthropic, &url, Some("k")), "p", "", &AtomicBool::new(false), |t| out.push_str(t)).unwrap_err();
        assert_eq!(out, "par");
        assert!(err.contains("Overloaded"));
    }

    #[test]
    fn setting_cancel_stops_the_stream_without_an_error() {
        let (url, _) = mock_server(200, "data: {\"choices\":[{\"delta\":{\"content\":\"one\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"two\"}}]}\n\ndata: [DONE]\n\n");
        let cancel = AtomicBool::new(false);
        let mut out = String::new();
        stream_completion(&cfg(ProviderKind::OpenAiCompatible, &url, None), "p", "", &cancel, |t| {
            out.push_str(t);
            cancel.store(true, Ordering::Relaxed); // the user pressed Stop after the first piece
        })
        .unwrap();
        assert_eq!(out, "one");
    }

    #[test]
    fn an_unreachable_server_is_a_readable_error() {
        let err = stream_completion(&cfg(ProviderKind::OpenAiCompatible, "http://127.0.0.1:9", None), "p", "", &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(err.starts_with("Couldn't reach the AI provider"), "{err}");
    }
}
