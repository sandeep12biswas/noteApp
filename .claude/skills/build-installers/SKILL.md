---
name: build-installers
description: Build FlowNote's Linux and Windows installers in parallel, after regenerating the single FlowNote Guide (installation for Linux then Windows, then the user manual with a screenshot for every feature). Use when asked to build/make/cut the installers, a release build, "package for Linux and Windows", or to regenerate/update the user manual, installation guide or guide screenshots.
---

# Build both installers (with a fresh guide)

The release flow, in this order. The order matters: both bundles ship
`docs/FlowNote-Guide.{pdf,docx}`, and the Windows bundle is built on GitHub
Actions from the **pushed commit**, so the guide must be regenerated and
committed before either installer is built.

1. Find features the guide doesn't cover yet
2. Update the guide source and the screenshot script for them
3. Build the app, capture screenshots, **look at them**
4. Build the PDF + DOCX, **look at them**
5. Commit, push (ask first)
6. `scripts/release/build-all.sh`: Linux locally ∥ Windows on CI
7. Report

All paths are relative to the repo root.

## The pieces

| What | Where |
|---|---|
| Guide source (one document) | `docs/guides/flownote-guide.html` + `guide.css` |
| Screenshot capture (real Electron app, throwaway profile) | `docs/guides/capture-screenshots.mjs` → `docs/guides/screenshots/*.png` + `manifest.json` |
| PDF / Word builders | `docs/guides/build-pdfs.mjs`, `build-docx.mjs` → `docs/FlowNote-Guide.pdf/.docx` |
| Linux bundle | `scripts/linux/package.sh` → `dist-release/FlowNote-<ver>-linux-x86_64.{run,tar.gz,sha256}` |
| Windows bundle | `scripts/windows/package.ps1`, run by `.github/workflows/windows-installer.yml` → artifact `flownote-windows` |
| Parallel orchestrator | `scripts/release/build-all.sh` (`pnpm package:all`) |

## 1. What's new since the guide was last updated

```bash
since=$(git log -1 --format=%h -- docs/guides/flownote-guide.html)
git log --no-merges --format='%h %s' "$since"..HEAD -- packages/frontend apps crates plugins
```

Read the commit bodies (`git show --stat <sha>`) and the matching
`e2e-electron/*.spec.ts`: the e2e specs have the exact role/label selectors
the screenshot script needs. Also check whether an existing feature's UI
changed. **A layout change can quietly break an old screenshot.** For
example, adding the table tools to the Insert tab pushed *Ask AI* out of
`16-ribbon-insert-ai`'s crop.

If nothing user-visible changed, skip to step 3. The screenshots and PDF
still get regenerated, so the version number and UI are current.

## 2. Update the guide

Structure of `flownote-guide.html` (keep it):

- `section.cover`, `nav.toc[data-toc]` (filled in at build time)
- `section.part#part-install` → **Part 1 · Installation** chapters, in this order:
  Before you start → **Installing on Linux** → **Installing on Windows** →
  Updating and backing up → Uninstalling → Solving installation problems
- `section.part#part-manual` → **Part 2 · User manual**: Welcome (with the
  `div.new` "What's new" box and the features-at-a-glance table), tour, then
  one chapter per area, then shortcuts, troubleshooting, FAQ

Every feature in Part 2 is one block in this shape:

```html
<div class="feature">
<h3>Feature name</h3>
<p class="what"><span class="label">What it does.</span> …</p>
<p class="how"><span class="label">How to use it.</span></p>
<ol class="steps">
  <li>Click <strong>Exact UI label</strong> …</li>
</ol>
<figure class="small"><img src="screenshots/NN-name.png" alt=""><figcaption>…</figcaption></figure>
</div>
```

Figures: `class="wide"` for whole-window/ribbon shots, `small`/`tiny` for
menus and dialogs, `<div class="two-col">` for two related shots. Callouts:
`div.note`, `div.tip`, `div.warn`, `div.new`. Use the UI's exact labels
(copy them from the component's `aria-label`/text). When a feature is
added, also update: the "What's new" box, *Features at a glance*, *A tour
of the window* (if it adds a ribbon tab or group), *Keyboard shortcuts*,
*Troubleshooting*. Linux/Windows differences go in a `div.note`. Known
platform gaps, like plugins not loading on Windows, stay documented until
they're fixed.

Then add capture steps to `capture-screenshots.mjs`, before the `sync`
section (`29-sync-settings` and `30-final-overview` must stay last):

```js
await step('38-my-feature', async () => {
  // drive the UI with role/label selectors (see e2e-electron/*.spec.ts)
  await shot('38-my-feature', page.getByRole('dialog', { name: '…' }), 12)
})
```

- Name files `NN-kebab-name.png` with the next free number. The `<img>` in
  the HTML must match exactly; `build-pdfs.mjs` fails on a missing image.
- `shot(name, locator, pad, { maxWidth, maxHeight, minWidth, alignRight })`
  crops to an element. Without a locator it captures the whole 1400×880
  window. Crop to what the reader needs: a ribbon cropped to the full window
  width prints too small to read.
- Helpers: `newPage(folder, name)`, `newFolder`, `writeSegment(x, y, fn)`,
  `slash('Menu item')`, `tab('Insert')`, `setSegmentWidth`, `setTheme`.
  Leave the app as the next step expects it (close menus, Home tab).

## 3. Build the app and capture screenshots

```bash
pnpm --filter @flownote/frontend run build
pnpm --filter @flownote/electron run build
cargo build --release -p flownote-electron
node docs/guides/capture-screenshots.mjs        # ~2 min; needs DISPLAY (:0 here) or xvfb-run -a
```

It uses a temporary `--user-data-dir`, so the user's real notes in
`~/.config/@flownote/electron` are never touched. It prints `ok`/`SKIP`
per step and ends with `N captured, M skipped`. **Any SKIP is a failure to
fix**: a skipped step leaves the old PNG in place, or none at all.

Then **open every new or changed screenshot with the Read tool** (and spot-check
the rest). Check: the right thing is in frame, nothing is cut off, no
leftover menu or toast from the previous step, light theme unless the
step is about dark mode, sample text reads naturally. Fix the step and
re-run if it's wrong.

## 4. Build the guide and check it

```bash
pnpm docs:pdf && pnpm docs:docx
pdfinfo docs/FlowNote-Guide.pdf | grep Pages
pdftoppm -r 45 -png -f 2 -l 4 docs/FlowNote-Guide.pdf "$SCRATCH/p"   # TOC + Part 1 divider
```

Render the TOC, the Part dividers and the pages with new sections, and look
at them. For the DOCX, `soffice --headless --convert-to pdf --outdir "$SCRATCH" docs/FlowNote-Guide.docx`
gives a PDF to check the same way. Work in the session scratchpad, not the repo.

## 5. Commit and push

Commit the HTML, screenshots (including `manifest.json`), the capture
script and `docs/FlowNote-Guide.{pdf,docx}` on a feature branch (never
`main`). **Ask the user before pushing** unless they already said to; the
Windows build needs the branch on `origin`. Push with plain `git push -u
origin <branch>` (git's credential helper already points at the working gh
binary).

## 6. Build both installers in parallel

```bash
scripts/release/build-all.sh            # Bash tool: dangerouslyDisableSandbox: true, run_in_background: true
```

It refuses to start on a dirty tree, an unpushed branch, or a guide older
than its sources. Then it:
1. dispatches `windows-installer.yml` on the branch and finds that run (by commit SHA),
2. runs `scripts/linux/package.sh` locally at the same time (clean build, ~5-10 min),
3. watches the CI run (build + install/launch/uninstall tests + WebView2 smoke test, ~25-40 min),
4. downloads `FlowNote-<ver>-windows-x64.zip` into `dist-release/` and checks its checksum.

Logs go to `build-logs/<timestamp>/{linux,windows}.log`. Flags:
`--no-clean`, `--skip-install`, `--linux-only`, `--windows-only`. Run it in
the background and wait for the completion notification instead of
polling. Don't wrap it in `timeout`, because the CI run takes longer than
the Bash tool's 10-minute limit.

**gh on this machine:** `gh`/`/snap/bin/gh` print nothing and silently do
nothing (commands may still take effect, so never retry blindly). The
script uses `/snap/gh/current/gh` and must run **outside the sandbox**. Use
the same binary for any manual `gh run view <id> --log-failed`.

## 7. Report

Tell the user: the version, the commit, which guide sections and
screenshots changed, the paths under `dist-release/` for both platforms,
the CI run URL, and any failure with its log tail. If one platform failed,
say so plainly. Don't present the other one as a complete release.

## Gotchas

- **Never test the Linux installer against the real HOME.** The dev machine
  has real notes and a system-wide `.deb` install. Use `HOME=<scratchpad>/testhome`
  and the decision flags (`--appimage --silent`, `--keep-data`). See the
  installer-testing memory.
- `package.sh` (clean mode) deletes `dist-release/` first. That's why the
  Windows zip is downloaded only after the Linux build finishes.
- The Windows guide shortcut is created by `apps/tauri/src-tauri/installer/hooks.nsh`
  (`FlowNote Guide.lnk`) and the PDF is bundled via `tauri.conf.json` →
  `bundle.resources`. If you rename the guide, change both, plus the checks
  in both workflows, `package.sh`, `package.ps1`, the two packaging READMEs
  and `RELEASE-NOTICE.txt`.
- `workflow_dispatch` works on any branch because `windows-installer.yml`
  exists on `main`. The run uses the branch's copy of the workflow.
- Electron in this container needs `--disable-gpu --disable-software-rasterizer`
  (the capture script already passes them). Without them, launch hangs for ~30 s.
- Version: the guide and bundles take it from `VERSION`. Bump it (and run
  `pnpm version:sync`) only when the user asks for a new version.
