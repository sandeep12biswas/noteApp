// Reference plugin — EXECUTION_PLAN.md Phase 7, DESIGN.md §9.7. Registration
// entry: declares the `spreadsheet` block type and its `/sheet` slash
// command, then activates. This file runs inside the plugin's sandboxed
// "registration" iframe (`PluginManager`'s `PluginFrame`); the actual grid
// UI (`grid.ts`) runs in a *separate* sandboxed iframe per block instance.
import { FlowNotePlugin } from '@flownote/sdk'

const plugin = new FlowNotePlugin()

plugin.registerBlockType({
  name: 'spreadsheet',
  label: 'Spreadsheet',
  slashCommand: '/sheet',
  render: 'grid.html',
  defaultAttrs: { rows: 5, cols: 4, data: {} },
})

plugin.activate()
