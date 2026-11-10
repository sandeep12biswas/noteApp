#!/usr/bin/env node
// Renders the FlowNote guides to Word (.docx), from the same HTML sources
// as the PDFs (build-pdfs.mjs), so both formats always say the same thing:
//   docs/guides/user-guide.html          -> docs/FlowNote-User-Guide.docx
//   docs/guides/feature-guide.html       -> docs/FlowNote-Feature-Guide.docx
//   docs/guides/installation-guide.html  -> docs/FlowNote-Installation-Guide.docx
//
//   node docs/guides/build-docx.mjs          (or: pnpm docs:docx)
//
// Walks each guide's DOM (jsdom) and maps it onto docx elements: the cover,
// a linked table of contents, numbered chapters (h2) and sections (h3),
// paragraphs with inline formatting, lists, tables, figures, terminal
// blocks and the Note/Tip/Important/What's new callouts. Screenshots come
// from docs/guides/screenshots/ (pnpm docs:screenshots).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const require = createRequire(path.join(REPO, 'package.json'))
const { JSDOM } = require('jsdom')
const {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} = require('docx')

const VERSION = fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim()
const DOCS = [
  { src: 'user-guide.html', out: 'FlowNote-User-Guide.docx' },
  { src: 'feature-guide.html', out: 'FlowNote-Feature-Guide.docx' },
  { src: 'installation-guide.html', out: 'FlowNote-Installation-Guide.docx' },
]

// ------------------------------------------------------------- layout
const FONT = 'Arial'
// Courier New: on every Windows/Mac install, and LibreOffice maps it to the
// metric-compatible Liberation Mono on Linux (Consolas falls back to a serif).
const MONO = 'Courier New'
const ACCENT = '7650C2' // lavender-600 (guide.css --accent)
const ACCENT_DARK = '4B3182' // lavender-800
const TEXT = '1F2937'
const MUTED = '6B7280'
const PAGE = { width: 11906, height: 16838 } // A4, DXA
const MARGIN = 1134 // 2 cm
const CONTENT_DXA = PAGE.width - 2 * MARGIN
const CONTENT_PX = Math.floor((CONTENT_DXA / 1440) * 96)

/** Callout boxes per class: left rule, background, label. */
const CALLOUTS = {
  note: { rule: ACCENT, fill: 'F6F3FD', label: 'Note', labelColor: ACCENT_DARK },
  tip: { rule: ACCENT, fill: 'F6F3FD', label: 'Tip', labelColor: ACCENT_DARK },
  warn: { rule: 'D97706', fill: 'FFFBEB', label: 'Important', labelColor: 'B45309' },
  new: { rule: '16A34A', fill: 'F0FDF4', label: "What's new", labelColor: '15803D' },
}

// ------------------------------------------------------------- helpers
/** Pixel size of a PNG (IHDR), for aspect-correct scaling. */
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), data: b }
}

function image(src, baseDir, maxWidthPx) {
  const file = path.resolve(baseDir, src)
  const { width, height, data } = pngSize(file)
  const w = Math.min(maxWidthPx, width)
  return new ImageRun({ type: 'png', data, transformation: { width: w, height: Math.round((height * w) / width) } })
}

const collapse = (s) => s.replace(/\s+/g, ' ')

/** Inline content of an element as TextRuns (and links), carrying formatting down. */
function inlineRuns(node, fmt = {}) {
  const runs = []
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = fmt.pre ? child.textContent : collapse(child.textContent)
      if (!text) continue
      if (fmt.pre) {
        text.split('\n').forEach((line, i) => runs.push(new TextRun({ ...runStyle(fmt), text: line, break: i > 0 ? 1 : undefined })))
      } else {
        runs.push(new TextRun({ ...runStyle(fmt), text }))
      }
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = child.tagName.toLowerCase()
    const cls = child.classList
    if (tag === 'br') {
      runs.push(new TextRun({ break: 1 }))
    } else if (tag === 'strong' || tag === 'b' || cls.contains('label') || cls.contains('u')) {
      runs.push(...inlineRuns(child, { ...fmt, bold: true }))
    } else if (tag === 'em' || tag === 'i') {
      runs.push(...inlineRuns(child, { ...fmt, italics: true }))
    } else if (tag === 'u') {
      runs.push(...inlineRuns(child, { ...fmt, underline: true }))
    } else if (tag === 's') {
      runs.push(...inlineRuns(child, { ...fmt, strike: true }))
    } else if (tag === 'code') {
      runs.push(...inlineRuns(child, { ...fmt, code: !fmt.pre }))
    } else if (tag === 'kbd') {
      runs.push(...inlineRuns(child, { ...fmt, kbd: true }))
    } else if (tag === 'span' && fmt.pre && cls.contains('p')) {
      runs.push(...inlineRuns(child, { ...fmt, color: fmt.term ? '4ADE80' : '15803D', bold: true }))
    } else if (tag === 'span' && fmt.pre && cls.contains('c')) {
      runs.push(...inlineRuns(child, { ...fmt, color: fmt.term ? '94A3B8' : MUTED }))
    } else if (tag === 'a' && child.getAttribute('href')?.startsWith('http')) {
      runs.push(new ExternalHyperlink({ link: child.getAttribute('href'), children: inlineRuns(child, { ...fmt, link: true }) }))
    } else {
      runs.push(...inlineRuns(child, fmt))
    }
  }
  return runs
}

function runStyle(fmt) {
  const style = {}
  if (fmt.bold) style.bold = true
  if (fmt.italics) style.italics = true
  if (fmt.underline || fmt.link) style.underline = {}
  if (fmt.strike) style.strike = true
  if (fmt.link) style.color = ACCENT
  if (fmt.color) style.color = fmt.color
  if (fmt.size) style.size = fmt.size
  if (fmt.pre || fmt.code || fmt.kbd) style.font = MONO
  if (fmt.code) style.shading = { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' }
  if (fmt.kbd) {
    style.shading = { type: ShadingType.CLEAR, fill: 'E5E7EB', color: 'auto' }
    style.size = fmt.size ?? 18
  }
  return style
}

/** Elements that start a new block inside an <li> or callout. */
const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'pre', 'figure', 'table', 'div', 'h3', 'h4'])

// ------------------------------------------------------------- converter
class GuideConverter {
  constructor(doc, baseDir) {
    this.doc = doc
    this.baseDir = baseDir
    this.chapter = 0
    this.section = 0
    this.listInstance = 0
    this.toc = [] // { level, text, anchor }
  }

  /** Paragraph options for a block in context (indent inside a list item). */
  frame(ctx, extra = {}) {
    return ctx.indent && !extra.numbering ? { ...extra, indent: { left: ctx.indent } } : extra
  }

  blocks(parent, ctx = {}) {
    const out = []
    for (const el of parent.children) out.push(...this.block(el, ctx))
    return out
  }

  block(el, ctx) {
    const tag = el.tagName.toLowerCase()
    const cls = el.classList
    if (tag === 'section' || tag === 'main' || (tag === 'div' && cls.contains('feature'))) return this.blocks(el, ctx)
    if (tag === 'nav' || tag === 'script' || tag === 'style') return []
    if (tag === 'h2') return [this.heading(el, 1)]
    if (tag === 'h3') return [this.heading(el, 2)]
    if (tag === 'h4') {
      return [new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(el) })]
    }
    if (tag === 'p') return [this.paragraph(el, ctx)]
    if (tag === 'ul' || tag === 'ol') return this.list(el, ctx, 0)
    if (tag === 'pre') return this.pre(el, ctx)
    if (tag === 'figure') return this.figure(el, ctx)
    if (tag === 'table') return [this.table(el), new Paragraph({ spacing: { after: 60 }, children: [] })]
    if (tag === 'div' && cls.contains('two-col')) return this.twoCol(el)
    const callout = Object.keys(CALLOUTS).find((k) => cls.contains(k))
    if (tag === 'div' && callout) return this.callout(el, callout)
    return this.blocks(el, ctx)
  }

  heading(el, level) {
    const title = collapse(el.textContent).trim()
    let number
    if (level === 1) {
      this.chapter += 1
      this.section = 0
      number = `${this.chapter}.`
    } else {
      this.section += 1
      number = `${this.chapter}.${this.section}`
    }
    const anchor = `h_${this.chapter}_${this.section}`
    this.toc.push({ level, text: `${number} ${title}`, anchor })
    return new Paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      pageBreakBefore: level === 1,
      children: [new Bookmark({ id: anchor, children: [new TextRun({ text: `${number} `, color: level === 1 ? ACCENT : MUTED }), new TextRun(title)] })],
    })
  }

  paragraph(el, ctx) {
    const lead = el.classList.contains('lead')
    const runs = inlineRuns(el, lead ? { size: 24, color: '374151' } : {})
    return new Paragraph(this.frame(ctx, { children: runs, spacing: { after: lead ? 160 : 120 } }))
  }

  list(el, ctx, level) {
    const ordered = el.tagName.toLowerCase() === 'ol'
    const instance = ordered ? ++this.listInstance : 0
    const out = []
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== 'li') continue
      // Inline content up to the first block child forms the bullet's own line.
      const inline = li.ownerDocument.createElement('span')
      const rest = []
      let sawBlock = false
      for (const child of [...li.childNodes]) {
        if (!sawBlock && !(child.nodeType === 1 && BLOCK_TAGS.has(child.tagName.toLowerCase()))) inline.appendChild(child.cloneNode(true))
        else {
          sawBlock = true
          if (child.nodeType === 1) rest.push(child)
        }
      }
      out.push(
        new Paragraph(
          this.frame(ctx, {
            children: inlineRuns(inline),
            numbering: { reference: ordered ? 'ordered' : 'bullets', level, instance: ordered ? instance : undefined },
            spacing: { after: 60 },
          }),
        ),
      )
      for (const child of rest) {
        const t = child.tagName.toLowerCase()
        if (t === 'ul' || t === 'ol') out.push(...this.list(child, ctx, level + 1))
        else out.push(...this.block(child, { ...ctx, indent: 720 * (level + 1) }))
      }
    }
    return out
  }

  pre(el, ctx) {
    const term = el.classList.contains('term')
    const runs = inlineRuns(el, { pre: true, term, size: 18, color: term ? 'E2E8F0' : TEXT })
    const indent = (ctx.indent ?? 0) + 120
    return [
      new Paragraph({
        children: runs,
        shading: { type: ShadingType.CLEAR, fill: term ? '0F172A' : 'F1F5F9', color: 'auto' },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: term ? '0F172A' : 'E2E8F0', space: 6 },
          left: { style: BorderStyle.SINGLE, size: 6, color: term ? '0F172A' : 'E2E8F0', space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: term ? '0F172A' : 'E2E8F0', space: 6 },
          right: { style: BorderStyle.SINGLE, size: 6, color: term ? '0F172A' : 'E2E8F0', space: 6 },
        },
        indent: { left: indent, right: 120 },
        spacing: { before: 120, after: 160, line: 260 },
      }),
    ]
  }

  figure(el, ctx, maxPx) {
    const img = el.querySelector('img')
    const caption = el.querySelector('figcaption')
    const width = maxPx ?? (el.classList.contains('wide') ? CONTENT_PX : el.classList.contains('small') ? Math.round(CONTENT_PX * 0.6) : Math.round(CONTENT_PX * 0.85))
    const out = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { before: 160, after: 60 },
        indent: ctx.indent ? { left: ctx.indent } : undefined,
        children: [image(img.getAttribute('src'), this.baseDir, width - (ctx.indent ? Math.round((ctx.indent / 1440) * 96) : 0))],
      }),
    ]
    if (caption) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: 'Figure: ', bold: true, size: 18, color: MUTED }), ...inlineRuns(caption, { size: 18, color: MUTED })],
        }),
      )
    }
    return out
  }

  twoCol(el) {
    const figures = [...el.querySelectorAll(':scope > figure')]
    const colDxa = Math.floor(CONTENT_DXA / figures.length)
    const colPx = Math.floor((colDxa / 1440) * 96) - 16
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    return [
      new Table({
        width: { size: colDxa * figures.length, type: WidthType.DXA },
        columnWidths: figures.map(() => colDxa),
        borders: { top: none, left: none, bottom: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [
          new TableRow({
            children: figures.map(
              (f) => new TableCell({ width: { size: colDxa, type: WidthType.DXA }, borders: { top: none, left: none, bottom: none, right: none }, children: this.figure(f, {}, colPx) }),
            ),
          }),
        ],
      }),
      new Paragraph({ children: [] }),
    ]
  }

  /** A Note/Tip/Important/What's new box: a one-cell table with a coloured left rule and tint. */
  callout(el, kind) {
    const c = CALLOUTS[kind]
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    const rule = { style: BorderStyle.SINGLE, size: 24, color: c.rule }
    const label = new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: c.label, bold: true, color: c.labelColor })] })
    const body = this.blocks(el, {})
    return [
      new Table({
        width: { size: CONTENT_DXA, type: WidthType.DXA },
        columnWidths: [CONTENT_DXA],
        borders: { top: none, left: rule, bottom: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: CONTENT_DXA, type: WidthType.DXA },
                borders: { top: none, left: rule, bottom: none, right: none },
                shading: { type: ShadingType.CLEAR, fill: c.fill, color: 'auto' },
                margins: { top: 100, bottom: 60, left: 200, right: 200 },
                children: [label, ...body],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    ]
  }

  table(el) {
    const rows = [...el.querySelectorAll('tr')]
    const cols = Math.max(...rows.map((r) => r.children.length))
    // Column widths follow how much text each column holds (min 15%).
    const weight = Array.from({ length: cols }, (_, i) =>
      Math.max(...rows.map((r) => collapse(r.children[i]?.textContent ?? '').length), 4),
    )
    const total = weight.reduce((a, b) => a + b, 0)
    let widths = weight.map((w) => Math.max(Math.round((w / total) * CONTENT_DXA), Math.round(CONTENT_DXA * 0.15)))
    const scale = CONTENT_DXA / widths.reduce((a, b) => a + b, 0)
    widths = widths.map((w) => Math.floor(w * scale))
    widths[widths.length - 1] += CONTENT_DXA - widths.reduce((a, b) => a + b, 0)
    const border = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' }
    return new Table({
      width: { size: CONTENT_DXA, type: WidthType.DXA },
      columnWidths: widths,
      rows: rows.map((tr) => {
        const header = tr.parentElement?.tagName.toLowerCase() === 'thead'
        return new TableRow({
          tableHeader: header,
          cantSplit: true,
          children: [...tr.children].map(
            (cell, i) =>
              new TableCell({
                width: { size: widths[i], type: WidthType.DXA },
                borders: { top: border, left: border, bottom: border, right: border },
                shading: header ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ spacing: { after: 0 }, children: inlineRuns(cell, header ? { bold: true, size: 19 } : { size: 19 }) })],
              }),
          ),
        })
      }),
    })
  }

  cover(section, docTitle) {
    const get = (sel) => section.querySelector(sel)
    const out = []
    const logo = get('img.logo')
    if (logo) out.push(new Paragraph({ spacing: { before: 600, after: 200 }, children: [image(logo.getAttribute('src'), this.baseDir, 72)] }))
    out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: collapse(get('.kicker')?.textContent ?? '').trim().toUpperCase(), bold: true, color: ACCENT, size: 22 })] }))
    out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(collapse(get('h1')?.textContent ?? docTitle).trim())] }))
    const subtitle = get('.subtitle')
    if (subtitle) out.push(new Paragraph({ spacing: { after: 360 }, children: inlineRuns(subtitle, { size: 26, color: '4B5563' }) }))
    const shot = get('img.shot')
    if (shot) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [image(shot.getAttribute('src'), this.baseDir, CONTENT_PX)] }))
    out.push(new Paragraph({ children: [new TextRun({ text: `Version ${VERSION}   ·   Linux · Windows`, color: MUTED, size: 20 })] }))
    return out
  }

  tocBlock() {
    return [
      new Paragraph({ pageBreakBefore: true, spacing: { after: 240 }, children: [new TextRun({ text: 'Contents', bold: true, size: 36, color: TEXT })] }),
      ...this.toc.map(
        (e) =>
          new Paragraph({
            indent: { left: e.level === 1 ? 0 : 480 },
            spacing: { before: e.level === 1 ? 140 : 20, after: 20 },
            children: [new InternalHyperlink({ anchor: e.anchor, children: [new TextRun({ text: e.text, bold: e.level === 1, color: e.level === 1 ? TEXT : '374151', size: e.level === 1 ? 22 : 20 })] })],
          }),
      ),
    ]
  }
}

// ------------------------------------------------------------- document
/**
 * Fixes two schema problems in docx's output (and drops the zip's folder entries):
 * - every Bookmark gets the same w:id: number each start/end pair uniquely
 *   (they are emitted in order, each end right after its start's content);
 * - paragraph borders come out as top, bottom, left, right, but the schema
 *   wants top, left, bottom, right.
 */
async function fixSchema(buffer) {
  const JSZip = createRequire(require.resolve('docx'))('jszip')
  // createFolders: false, so no folder entries are added: Word has refused
  // files that have them when opened through a cloud co-editing service.
  const zip = await JSZip.loadAsync(buffer, { createFolders: false })
  let xml = await zip.file('word/document.xml').async('string')
  let next = 0
  const open = []
  xml = xml.replace(/<w:bookmark(Start|End)\b([^>]*?)w:id="\d+"/g, (_, kind, attrs) => {
    const id = kind === 'Start' ? (open.push(++next), next) : open.shift()
    return `<w:bookmark${kind}${attrs}w:id="${id}"`
  })
  const order = ['top', 'left', 'bottom', 'right', 'between', 'bar']
  xml = xml.replace(/<w:pBdr>(.*?)<\/w:pBdr>/g, (_, inner) => {
    const sides = inner.match(/<w:(\w+)\b[^>]*\/>/g) ?? []
    sides.sort((a, b) => order.indexOf(a.match(/<w:(\w+)/)[1]) - order.indexOf(b.match(/<w:(\w+)/)[1]))
    return `<w:pBdr>${sides.join('')}</w:pBdr>`
  })
  zip.file('word/document.xml', xml)
  // docx's own folder entries too (deleting the entry, not zip.remove(),
  // which would take the files inside with it).
  for (const [name, entry] of Object.entries(zip.files)) if (entry.dir) delete zip.files[name]
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function headingStyle(id, name, size, color, before, after, extra = {}) {
  return {
    id,
    name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font: FONT, size, bold: true, color },
    paragraph: { spacing: { before, after }, keepNext: true, keepLines: true, ...extra },
  }
}

async function build({ src, out }) {
  const file = path.join(HERE, src)
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'))
  const doc = dom.window.document
  doc.querySelectorAll('[data-version]').forEach((n) => (n.textContent = VERSION))
  const docTitle = doc.querySelector('meta[name="flownote-doc-title"]')?.content ?? doc.title
  const conv = new GuideConverter(doc, HERE)

  const cover = conv.cover(doc.querySelector('section.cover'), docTitle)
  const body = conv.blocks(doc.querySelector('main'))
  const toc = conv.tocBlock()

  const headerFooterRun = { size: 16, color: '9CA3AF', font: FONT }
  const document = new Document({
    creator: 'FlowNote',
    title: docTitle,
    description: `${docTitle}, version ${VERSION}`,
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: TEXT }, paragraph: { spacing: { line: 288 } } } },
      paragraphStyles: [
        headingStyle('Title', 'Title', 64, '111827', 0, 160),
        headingStyle('Heading1', 'Heading 1', 34, '111827', 0, 200, {
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
          outlineLevel: 0,
        }),
        headingStyle('Heading2', 'Heading 2', 26, '111827', 280, 120, { outlineLevel: 1 }),
        headingStyle('Heading3', 'Heading 3', 22, '111827', 200, 80, { outlineLevel: 2 }),
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪'][level],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540 + level * 360, hanging: 300 } } },
          })),
        },
        {
          reference: 'ordered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: PAGE, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, titlePage: true },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_DXA }],
                children: [new TextRun({ ...headerFooterRun, text: docTitle }), new TextRun({ ...headerFooterRun, text: `\tFlowNote ${VERSION}` })],
              }),
            ],
          }),
          first: new Header({ children: [new Paragraph({ children: [] })] }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ ...headerFooterRun, children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] }),
                ],
              }),
            ],
          }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
        },
        children: [...cover, ...toc, ...body],
      },
    ],
  })

  const buffer = await fixSchema(await Packer.toBuffer(document))
  const target = path.join(REPO, 'docs', out)
  fs.writeFileSync(target, buffer)
  console.log(`wrote docs/${out} (${Math.round(buffer.length / 1024)} KB, ${conv.toc.filter((e) => e.level === 1).length} chapters)`)
}

for (const d of DOCS) await build(d)
