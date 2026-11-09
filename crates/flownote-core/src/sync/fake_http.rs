//! A tiny HTTP server for the cloud-target and OAuth tests: every request
//! goes to one handler closure, each on its own connection (`Connection:
//! close`), so the real reqwest client and real request building are tested.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    /// Path and query, as sent (still percent-encoded).
    pub target: String,
    /// Lower-case names.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Req {
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }

    pub fn query(&self, key: &str) -> Option<String> {
        let q = self.target.split_once('?')?.1;
        super::http::parse_query(q).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or(serde_json::Value::Null)
    }

    pub fn form(&self) -> HashMap<String, String> {
        super::http::parse_query(&String::from_utf8_lossy(&self.body)).into_iter().collect()
    }
}

pub struct Resp {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Resp {
    pub fn status(status: u16) -> Resp {
        Resp { status, headers: vec![], body: vec![] }
    }

    pub fn json(status: u16, value: serde_json::Value) -> Resp {
        Resp { status, headers: vec![("Content-Type".into(), "application/json".into())], body: value.to_string().into_bytes() }
    }

    pub fn bytes(body: Vec<u8>) -> Resp {
        Resp { status: 200, headers: vec![("Content-Type".into(), "application/octet-stream".into())], body }
    }

    pub fn header(mut self, name: &str, value: &str) -> Resp {
        self.headers.push((name.into(), value.into()));
        self
    }
}

/// Starts the server; returns its base URL (`http://127.0.0.1:<port>`).
pub fn serve(handler: impl Fn(&Req, &str) -> Resp + Send + Sync + 'static) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handler = Arc::new(handler);
    let base2 = base.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let handler = handler.clone();
            let base = base2.clone();
            std::thread::spawn(move || {
                let Some(req) = read_request(&mut stream) else { return };
                let resp = handler(&req, &base);
                let reason = match resp.status {
                    200 => "OK",
                    201 => "Created",
                    204 => "No Content",
                    302 => "Found",
                    _ => "X",
                };
                let mut head = format!("HTTP/1.1 {} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n", resp.status, resp.body.len());
                for (k, v) in &resp.headers {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str("\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&resp.body);
            });
        }
    });
    base
}

fn read_request(stream: &mut std::net::TcpStream) -> Option<Req> {
    let mut data = Vec::new();
    let mut buf = [0u8; 16384];
    let header_end = loop {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            return None;
        }
        data.extend_from_slice(&buf[..n]);
        if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
    };
    let head = String::from_utf8_lossy(&data[..header_end]).into_owned();
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let headers: HashMap<String, String> =
        lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = data[header_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
    }
    Some(Req { method, target, headers, body })
}
