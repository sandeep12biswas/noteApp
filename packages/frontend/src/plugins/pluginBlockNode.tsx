// The `pluginBlock` TipTap node — DESIGN.md §9.2 `registerBlockType`. One
// generic node type handles *every* plugin block type, rather than the
// editor's extension list growing/shrinking per registered plugin: its
// `pluginId`/`blockType` attrs say which registration to look up in
// `ExtensionPointRegistry` at render time, so enabling/disabling a plugin
// (which adds/removes that registry entry) is reflected immediately —
// the NodeView is a real React component subscribed to the registry, no
// editor recreation needed. When the entry is missing (plugin disabled or
// never installed), it renders the "Plugin inactive" placeholder DESIGN.md
// §9.7 step 8 calls for, with the block's data untouched underneath so
// re-enabling restores it exactly.
import { mergeAttributes, Node, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { registerPluginIframe, unregisterPluginIframe } from './PluginIPCBridge'
import { pluginAssetUrl } from './PluginManager'
import { useExtensionRegistry } from '../store/extensionRegistry'

let nextBlockId = 1
function makeBlockId(): string {
  return `plugin-block-${nextBlockId++}`
}

function PluginBlockView({ node, updateAttributes }: NodeViewProps) {
  const { pluginId, blockType, blockId, attrs } = node.attrs as {
    pluginId: string
    blockType: string
    blockId: string
    attrs: Record<string, unknown>
  }
  const entry = useExtensionRegistry((s) => s.blockTypes[`${pluginId}/${blockType}`])
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeightState] = useState(120)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !entry) return

    const onLoad = () => {
      const win = iframe.contentWindow
      if (!win) return
      registerPluginIframe(win, {
        pluginId,
        // A block instance only ever needs to persist its own data — it
        // was inserted through a `blockType` the plugin already declared,
        // so it inherits the same storage permission the registration
        // iframe checked at install time (DESIGN.md §9.3's permissions are
        // per-plugin, not per-iframe).
        permissions: new Set(['storage:read', 'storage:write']),
        extensionPoints: new Set(),
        kind: 'block',
        onBlockUpdate: (msg) => {
          if (msg.attrs) updateAttributes({ attrs: { ...attrs, ...msg.attrs } })
          if (msg.height) setHeightState(msg.height)
        },
      })
      win.postMessage({ source: 'flownote-host', type: 'block:init', blockId, attrs }, '*')
    }
    iframe.addEventListener('load', onLoad)
    return () => {
      iframe.removeEventListener('load', onLoad)
      if (iframe.contentWindow) unregisterPluginIframe(iframe.contentWindow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-registering on every `attrs` change would tear down the iframe on every keystroke inside it; `attrs` is read fresh via the closure the `onBlockUpdate` callback below captures at mount
  }, [entry, pluginId, blockType, blockId])

  if (!entry) {
    return (
      <NodeViewWrapper
        data-testid={`plugin-block-${blockId}`}
        className="rounded border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400 dark:border-gray-700"
      >
        Plugin inactive
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper data-testid={`plugin-block-${blockId}`} className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
      <iframe
        ref={iframeRef}
        title={entry.label}
        sandbox="allow-scripts"
        src={pluginAssetUrl(pluginId, entry.renderPath)}
        style={{ width: '100%', height, border: 'none', display: 'block' }}
      />
    </NodeViewWrapper>
  )
}

export const PluginBlock = Node.create({
  name: 'pluginBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      pluginId: { default: null },
      blockType: { default: null },
      blockId: { default: null },
      attrs: { default: {} },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-plugin-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-plugin-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PluginBlockView)
  },
})

export function pluginBlockAttrs(pluginId: string, blockType: string, defaultAttrs: Record<string, unknown>) {
  return { pluginId, blockType, blockId: makeBlockId(), attrs: defaultAttrs }
}
