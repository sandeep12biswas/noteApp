#!/usr/bin/env node
// Renders the FlowNote guide (installation + user manual, one document) to PDF:
//   docs/guides/flownote-guide.html  -> docs/FlowNote-Guide.pdf
//
//   node docs/guides/build-pdfs.mjs          (or: pnpm docs:pdf)
//
// Uses headless Chrome/Chromium through playwright-core: set CHROME_PATH, or
// it looks for google-chrome / chromium in the usual places. Before printing
// it fills in the table of contents (from each part divider and each
// chapter's h2/h3) and the
// version (from the repo's VERSION file). Screenshots come from
// docs/guides/screenshots/ (pnpm docs:screenshots).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const require = createRequire(path.join(REPO, 'package.json'))
const { chromium } = require('playwright-core')

const VERSION = fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim()
const DOCS = [{ src: 'flownote-guide.html', out: 'FlowNote-Guide.pdf' }]

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) throw new Error('No Chrome/Chromium found; set CHROME_PATH to its executable.')
  return found
}

const missing = new Set()
const browser = await chromium.launch({ executablePath: findChrome(), headless: true })
try {
  const page = await browser.newPage()
  page.on('requestfailed', (r) => missing.add(r.url()))
  page.on('response', (r) => { if (r.status() >= 400) missing.add(r.url()) })

  for (const doc of DOCS) {
    const file = path.join(HERE, doc.src)
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
    const title = await page.evaluate(({ version }) => {
      // Version placeholders.
      document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = version })
      // Table of contents from the chapters' headings.
      const toc = document.querySelector('[data-toc]')
      if (toc) {
        const ol = document.createElement('ol')
        document.querySelectorAll('main > section.chapter, main > section.part').forEach((sec, i) => {
          if (sec.classList.contains('part')) {
            // "Part 1 · Installation": an unnumbered TOC line.
            const li = document.createElement('li')
            li.className = 'part'
            const a = document.createElement('a')
            a.href = `#${sec.id}`
            a.textContent = `${sec.querySelector('.part-kicker')?.textContent ?? ''} · ${sec.querySelector('.part-title')?.textContent ?? ''}`
            li.append(a)
            ol.append(li)
            return
          }
          const h2 = sec.querySelector('h2')
          if (!h2) return
          if (!sec.id) sec.id = `chapter-${i + 1}`
          const li = document.createElement('li')
          const a = document.createElement('a')
          a.href = `#${sec.id}`
          a.textContent = h2.textContent
          li.append(a)
          const subs = [...sec.querySelectorAll('h3')]
          if (subs.length) {
            const sub = document.createElement('ol')
            subs.forEach((h3, j) => {
              if (!h3.id) h3.id = `${sec.id}-${j + 1}`
              const sli = document.createElement('li')
              const sa = document.createElement('a')
              sa.href = `#${h3.id}`
              // Heading text without its platform badges.
              const clone = h3.cloneNode(true)
              clone.querySelectorAll('.badge').forEach((b) => b.remove())
              sa.textContent = clone.textContent.trim()
              sli.append(sa)
              sub.append(sli)
            })
            li.append(sub)
          }
          ol.append(li)
        })
        toc.append(ol)
      }
      const title = document.querySelector('meta[name="flownote-doc-title"]')?.content ?? document.title
      // Running header text for guide.css's @page margin boxes.
      const style = document.createElement('style')
      style.textContent = `:root { --doc-title: ${JSON.stringify(title)}; --doc-version: ${JSON.stringify('FlowNote ' + version)}; }`
      document.head.append(style)
      return title
    }, { version: VERSION })

    // Wait for every image to finish decoding before printing.
    await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))))
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')))
    if (broken.length) throw new Error(`${doc.src}: images failed to load: ${broken.join(', ')}`)

    const out = path.join(REPO, 'docs', doc.out)
    // Header/footer come from guide.css's @page margin boxes, not Chrome's
    // header/footer templates (those would also print on the cover).
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true, outline: true, tagged: true })
    console.log(`wrote ${path.relative(REPO, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
  }
} finally {
  await browser.close()
}
if (missing.size) {
  console.error('missing resources:\n  ' + [...missing].join('\n  '))
  process.exit(1)
}
