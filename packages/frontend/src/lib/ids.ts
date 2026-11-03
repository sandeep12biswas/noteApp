// Ids for every record the app creates (folders, pages, segments,
// attachments). They must be unique across sessions *and* across devices:
// with sync, two devices create records independently and their ids meet in
// one database. The earlier `<prefix>-<6-char session salt>-<counter>` form
// fixed cross-session collisions (see canvasStore.test.ts / notebookStore.
// test.ts "cross-session uniqueness"), but a 6-character salt is too small
// to rely on across devices. The prefix keeps ids readable in logs and
// tests; ids already saved in the old form stay valid.
export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
