// Flattens a segment's TipTap JSON document to plain text — shared by
// `CanvasRoot` and `LinearRoot` so both modes mirror identical text into
// `notebookStore.updateFileContent` (DESIGN.md §2.2's content search), and
// by the mirror of this same flattening in
// `crates/flownote-electron/src/protocol.rs`'s `flatten_tiptap_text` (server
// side, for `search()`'s FTS5 index) — client and server must agree on what
// "the text of a segment" means, even though they can't share code.
export function segmentText(content: Record<string, unknown>): string {
  const nodes = (content as { content?: { content?: { text?: string }[] }[] }).content ?? []
  return nodes
    .flatMap((n) => n.content ?? [])
    .map((n) => n.text ?? '')
    .join(' ')
}
