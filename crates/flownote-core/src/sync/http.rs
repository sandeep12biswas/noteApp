//! HTTP for the cloud targets (sync step S6): one blocking client, retries
//! with backoff for throttling and server errors, and the little URL/form
//! encoding the OneDrive and Google Drive APIs need.

use reqwest::blocking::{Client, RequestBuilder, Response};
use std::time::Duration;

/// How often and how long requests are retried. Tests shorten the delays.
#[derive(Debug, Clone)]
pub struct Retry {
    pub attempts: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for Retry {
    fn default() -> Self {
        Retry { attempts: 5, base_delay: Duration::from_millis(500), max_delay: Duration::from_secs(30) }
    }
}

pub struct Http {
    pub client: Client,
    pub retry: Retry,
}

impl Http {
    pub fn new(retry: Retry) -> Result<Http, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Http { client, retry })
    }

    /// Sends the request `build` makes, again (rebuilt) after 429 / 5xx /
    /// connection failures, waiting `Retry-After` or an exponential backoff.
    /// Any other response — success or not — is returned as is.
    pub fn send(&self, what: &str, build: impl Fn(&Client) -> RequestBuilder) -> Result<Response, String> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let last = attempt >= self.retry.attempts;
            let backoff = (self.retry.base_delay * 2u32.saturating_pow(attempt - 1)).min(self.retry.max_delay);
            match build(&self.client).send() {
                Ok(response) => {
                    let status = response.status().as_u16();
                    if (status == 429 || (500..600).contains(&status)) && !last {
                        let wait = response
                            .headers()
                            .get("retry-after")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|v| v.trim().parse::<u64>().ok())
                            .map(|s| Duration::from_secs(s).min(self.retry.max_delay))
                            .unwrap_or(backoff);
                        std::thread::sleep(wait);
                        continue;
                    }
                    return Ok(response);
                }
                Err(e) if !last && (e.is_connect() || e.is_timeout() || e.is_request()) => std::thread::sleep(backoff),
                Err(e) => return Err(format!("Couldn't reach {what}: {e}")),
            }
        }
    }
}

/// A failed response as a short message: status plus the API's own error text.
pub fn error_of(what: &str, response: Response) -> String {
    let status = response.status().as_u16();
    let body = response.text().unwrap_or_default();
    let detail = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| {
            let e = &v["error"];
            e["message"].as_str().or(e.as_str()).or(v["error_description"].as_str()).map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    format!("{what} answered {status}: {detail}")
}

/// Reads a response as JSON (reqwest's own `json()` needs a feature this
/// crate doesn't enable).
pub trait ReadJson {
    fn json_value(self) -> Result<serde_json::Value, String>;
}

impl ReadJson for Response {
    fn json_value(self) -> Result<serde_json::Value, String> {
        let text = self.text().map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("unexpected answer from the cloud drive: {e}"))
    }
}

/// Percent-encodes everything but RFC 3986 unreserved characters.
pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Each `/`-separated part encoded, the slashes kept.
pub fn encode_path(path: &str) -> String {
    path.split('/').map(encode).collect::<Vec<_>>().join("/")
}

/// `application/x-www-form-urlencoded` body (also a query string).
pub fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", encode(k), encode(v))).collect::<Vec<_>>().join("&")
}

/// Decodes `%XX` and `+` (query strings from the OAuth redirect). A `%`
/// not followed by two hex digits is kept as is.
pub fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' => match (bytes.get(i + 1).copied().and_then(hex), bytes.get(i + 2).copied().and_then(hex)) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `a=1&b=2` → pairs, decoded.
pub fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (decode(k), decode(v)),
            None => (decode(p), String::new()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_decodes() {
        assert_eq!(encode("a b/c:d"), "a%20b%2Fc%3Ad");
        assert_eq!(encode_path("devices/x y/1.enc"), "devices/x%20y/1.enc");
        assert_eq!(form(&[("code", "a/b"), ("x", "1 2")]), "code=a%2Fb&x=1%202");
        assert_eq!(decode("a%20b+c%2F"), "a b c/");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(decode("%zz"), "%zz");
        assert_eq!(parse_query("code=x%2Fy&state=s&flag"), vec![("code".into(), "x/y".into()), ("state".into(), "s".into()), ("flag".into(), String::new())]);
    }
}
