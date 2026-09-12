// Scaffold file contents for `flownote create` — DESIGN.md §9.6's
// generated project shape (manifest / entry / block UI / tsconfig /
// package.json), trimmed to what this CLI can actually deliver today (see
// commands.ts's module doc for the gaps vs. the full DESIGN.md flow).

export const SDK_VERSION = '0.0.1-alpha.0'

function titleCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

export function manifestJson(name: string): string {
  const manifest = {
    id: `com.example.${name}`,
    name: titleCase(name),
    version: '0.1.0',
    description: '',
    author: '',
    entry: 'index.js',
    sdkVersion: SDK_VERSION,
    permissions: [] as string[],
    extensionPoints: [] as string[],
    minAppVersion: '0.0.0',
  }
  return JSON.stringify(manifest, null, 2) + '\n'
}

export function packageJson(name: string): string {
  const pkg = {
    name: `@flownote-plugins/${name}`,
    version: '0.1.0',
    type: 'module',
    scripts: {
      typecheck: 'tsc --noEmit',
      build: 'tsc',
    },
    dependencies: {
      '@flownote/sdk': `^${SDK_VERSION}`,
    },
    devDependencies: {
      typescript: '~5.7.2',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

export const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "declaration": false
  },
  "include": ["src"]
}
`

export function indexTs(name: string): string {
  return `// Registration entry (DESIGN.md §9.4) — runs once in a sandboxed
// "registration" iframe when the plugin is enabled. Register your block
// type(s), slash command(s), ribbon group(s), section tab(s), and/or side
// panel(s) here, then call plugin.activate().
import { FlowNotePlugin } from '@flownote/sdk'

const plugin = new FlowNotePlugin()

plugin.registerBlockType({
  name: '${name}',
  label: '${titleCase(name)}',
  slashCommand: '/${name}',
  render: 'block.html',
  defaultAttrs: {},
})

plugin.activate()
`
}

export function blockHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!-- FlowNote serves plugin assets over a privileged flownote-plugin://
         scheme (a sandboxed iframe's opaque origin can't load file://
         subresources) and needs this import map so a plain "@flownote/sdk"
         bare specifier resolves inside it — see
         packages/frontend/src/plugins/PluginManager.tsx's own copy of this
         same import map for the host-side half. -->
    <script type="importmap">
      { "imports": { "@flownote/sdk": "flownote-plugin:///sdk/index.js" } }
    </script>
    <style>
      body {
        margin: 0;
        padding: 8px;
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script type="module" src="./block.js"></script>
  </body>
</html>
`
}

export function blockTs(name: string): string {
  return `// The per-block-instance UI (DESIGN.md §9.4's \`render\` spec) — one
// sandboxed iframe per "${name}" block inserted into a note.
import { FlowNoteBlock } from '@flownote/sdk'

const block = new FlowNoteBlock()
const root = document.getElementById('root')!

block.onInit((_blockId, attrs) => {
  root.textContent = JSON.stringify(attrs)
  block.reportHeight(60)
})
`
}

export function readmeMd(name: string): string {
  const id = `com.example.${name}`
  return `# ${titleCase(name)}

Scaffolded by \`flownote create\`.

## Build

\`\`\`bash
npm install
npm run build   # tsc -> dist/*.js
\`\`\`

## Try it in a running FlowNote

There's no install-from-\`.fnp\` flow in FlowNote yet (\`flownote pack\`
produces a \`.fnp\`, but the app's own install step only accepts a pasted
\`flownote-plugin.json\` today — see this CLI's own README for the current
state of that gap). Until then, install by hand the same way the built-in
spreadsheet reference plugin does:

1. \`npm run build\`
2. Copy \`dist/*.js\`, \`src/*.html\`, and \`flownote-plugin.json\` into
   FlowNote's \`packages/frontend/public/plugins/${id}/\`
   (create the directory first).
3. In FlowNote: Plugins (left sidebar) → Install… → paste the contents of
   \`flownote-plugin.json\` → Install.
4. \`/${name}\` in any segment inserts a "${titleCase(name)}" block.

\`flownote dev\` automates step 1-2 (rebuild on save + copy into a target
FlowNote checkout) — see \`flownote dev --help\`. It does **not** hot-reload
an already-open block; reload FlowNote's window to pick up a rebuilt
plugin.
`
}
