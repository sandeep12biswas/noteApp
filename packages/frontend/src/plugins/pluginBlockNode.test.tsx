// pluginBlockNode — DESIGN.md §9.7 step 8 ("disabling shows a 'Plugin
// inactive' placeholder … re-enabling restores full functionality with no
// data loss"). Exercised through a real segment editor (SegmentHost) rather
// than mounting `PluginBlockView` in isolation, since the interesting
// behavior is entirely about how it reacts to `ExtensionPointRegistry`
// state via TipTap's NodeView machinery.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from '../canvas/CanvasRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
  })
  useExtensionRegistry.setState({ blockTypes: {}, sectionTabs: {}, ribbonGroups: {}, slashCommands: {}, sidePanels: {} })
})

function seedPluginBlockSegment(pluginId: string, blockType: string, attrs: Record<string, unknown> = {}) {
  const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
  useCanvasStore.getState().updateSegmentContent(id, {
    type: 'doc',
    content: [{ type: 'pluginBlock', attrs: { pluginId, blockType, blockId: 'block-1', attrs } }],
  })
  return id
}

describe('pluginBlockNode', () => {
  it('shows "Plugin inactive" when the block type is not registered (plugin missing/disabled)', async () => {
    seedPluginBlockSegment('com.sandeep.spreadsheet', 'spreadsheet')
    render(<CanvasRoot pageId="page-1" />)

    expect(await screen.findByText('Plugin inactive')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('renders a sandboxed iframe at the registered renderPath when the block type is active', async () => {
    useExtensionRegistry.getState().registerBlockType({
      pluginId: 'com.sandeep.spreadsheet',
      id: 'spreadsheet',
      label: 'Spreadsheet',
      renderPath: 'grid.html',
      defaultAttrs: {},
    })
    seedPluginBlockSegment('com.sandeep.spreadsheet', 'spreadsheet')
    render(<CanvasRoot pageId="page-1" />)

    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.src).toContain('/plugins/com.sandeep.spreadsheet/grid.html')
  })

  it('re-registering the block type (plugin re-enabled) swaps the placeholder for the iframe without remounting the segment', async () => {
    seedPluginBlockSegment('com.sandeep.spreadsheet', 'spreadsheet')
    render(<CanvasRoot pageId="page-1" />)
    expect(await screen.findByText('Plugin inactive')).toBeInTheDocument()

    useExtensionRegistry.getState().registerBlockType({
      pluginId: 'com.sandeep.spreadsheet',
      id: 'spreadsheet',
      label: 'Spreadsheet',
      renderPath: 'grid.html',
      defaultAttrs: {},
    })

    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    expect(screen.queryByText('Plugin inactive')).not.toBeInTheDocument()
  })

  it('disabling the plugin (unregisterPlugin) reverts back to the placeholder, data untouched', async () => {
    useExtensionRegistry.getState().registerBlockType({
      pluginId: 'com.sandeep.spreadsheet',
      id: 'spreadsheet',
      label: 'Spreadsheet',
      renderPath: 'grid.html',
      defaultAttrs: {},
    })
    const segId = seedPluginBlockSegment('com.sandeep.spreadsheet', 'spreadsheet', { rows: 3 })
    render(<CanvasRoot pageId="page-1" />)
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())

    useExtensionRegistry.getState().unregisterPlugin('com.sandeep.spreadsheet')

    expect(await screen.findByText('Plugin inactive')).toBeInTheDocument()
    // The underlying block data survives — only the rendering fell back.
    const content = useCanvasStore.getState().segments[segId]?.content as { content: { attrs: { attrs: unknown } }[] }
    expect(content.content[0]?.attrs.attrs).toEqual({ rows: 3 })
  })
})
