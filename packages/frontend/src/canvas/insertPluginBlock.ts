// Shared by SegmentHost/LinearSegmentHost's SlashMenu wiring: replaces the
// "/" the user typed with a `pluginBlock` node for the chosen plugin block
// type (DESIGN.md §9.2 `registerSlashCommand` → "inserting calls the
// plugin's `insertBlock` handler" — here, that's just inserting the generic
// node with that block type's default attrs; the plugin's own per-instance
// iframe takes over from there).
import type { Editor } from '@tiptap/react'
import { pluginBlockAttrs } from '../plugins/pluginBlockNode'
import { useExtensionRegistry } from '../store/extensionRegistry'

/** `slashCommandId` is the id `SlashMenu` was given (a `SlashCommandExtension.id`, e.g. "/sheet") — resolved to its declared `blockType` before insertion. */
export function insertPluginBlock(editor: Editor, charPos: number, pluginId: string, slashCommandId: string): void {
  const state = useExtensionRegistry.getState()
  const command = state.slashCommands[`${pluginId}/${slashCommandId}`]
  if (!command) return
  const entry = state.blockTypes[`${pluginId}/${command.blockType}`]
  if (!entry) return
  editor
    .chain()
    .focus()
    .deleteRange({ from: charPos - 1, to: charPos })
    .insertContent({ type: 'pluginBlock', attrs: pluginBlockAttrs(pluginId, command.blockType, entry.defaultAttrs) })
    .run()
}
