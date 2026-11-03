-- AI providers (EXECUTION_PLAN.md Features — generic AI interface): one row
-- per configured provider. `kind` selects the wire protocol in
-- flownote_core::ai — 'anthropic' (Claude Messages API), 'gemini' (Google
-- Generative Language API) or 'openai_compatible' (OpenAI's chat
-- completions API, also spoken by Ollama, LM Studio, OpenRouter, Mistral,
-- Groq, ...). `base_url` lets any of them point at a proxy or a local server.
--
-- `api_key` is stored here in plain text (a deliberate, user-chosen
-- trade-off on 2026-10-24 over the OS keychain): it is only ever read by the
-- Rust backend to make requests — store::list_ai_providers never returns
-- it, only whether one is set — so the renderer and plugins can't read it
-- back, but anyone who copies this database file can.
--
-- At most one row has is_default = 1; it's the provider the AI box uses.
CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('anthropic', 'gemini', 'openai_compatible')),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
