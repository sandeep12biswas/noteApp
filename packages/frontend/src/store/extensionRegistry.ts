// ExtensionPointRegistry — DESIGN.md §8.1 table row, §7.1's `CanvasStore.
// pluginExts`. An empty Zustand slice until Phase 7 gives plugins a way to
// register into it (`PluginIPCBridge` routing `registerX()` SDK calls
// here); `CanvasRoot`, `RibbonRoot`, `SlashMenu` (Phase 4), `SectionSidebar`
// and `SidePanel` (Phase 7) all consult it and render nothing extra until
// then — this is that plumbing, not the features built on top of it.
//
// Every entry is namespaced by the registering plugin's id (DESIGN.md §10
// "TipTap schema conflict" — block type names collide across plugins
// otherwise) and keyed by `${pluginId}/${id}` so a plugin's registrations
// can all be dropped together on disable/uninstall.
import { create } from 'zustand'

export interface BlockTypeExtension {
  pluginId: string
  id: string
  label: string
}

export interface SectionTabExtension {
  pluginId: string
  id: string
  label: string
}

export interface RibbonGroupExtension {
  pluginId: string
  id: string
  ribbonTab: 'Home' | 'Insert' | 'Draw' | 'View'
  label: string
}

export interface SlashCommandExtension {
  pluginId: string
  id: string
  label: string
}

export interface SidePanelExtension {
  pluginId: string
  id: string
  label: string
}

type Registry<T> = Record<string, T>

function entryKey(pluginId: string, id: string): string {
  return `${pluginId}/${id}`
}

interface ExtensionRegistryState {
  blockTypes: Registry<BlockTypeExtension>
  sectionTabs: Registry<SectionTabExtension>
  ribbonGroups: Registry<RibbonGroupExtension>
  slashCommands: Registry<SlashCommandExtension>
  sidePanels: Registry<SidePanelExtension>

  registerBlockType: (ext: BlockTypeExtension) => void
  registerSectionTab: (ext: SectionTabExtension) => void
  registerRibbonGroup: (ext: RibbonGroupExtension) => void
  registerSlashCommand: (ext: SlashCommandExtension) => void
  registerSidePanel: (ext: SidePanelExtension) => void
  /** Drops every registration for one plugin — called on disable/uninstall (Phase 7). */
  unregisterPlugin: (pluginId: string) => void
}

function registerInto<T extends { pluginId: string; id: string }>(
  registry: Registry<T>,
  ext: T,
): Registry<T> {
  return { ...registry, [entryKey(ext.pluginId, ext.id)]: ext }
}

function dropPlugin<T extends { pluginId: string }>(registry: Registry<T>, pluginId: string): Registry<T> {
  return Object.fromEntries(Object.entries(registry).filter(([, ext]) => ext.pluginId !== pluginId))
}

export const useExtensionRegistry = create<ExtensionRegistryState>((set) => ({
  blockTypes: {},
  sectionTabs: {},
  ribbonGroups: {},
  slashCommands: {},
  sidePanels: {},

  registerBlockType: (ext) => set((state) => ({ blockTypes: registerInto(state.blockTypes, ext) })),
  registerSectionTab: (ext) => set((state) => ({ sectionTabs: registerInto(state.sectionTabs, ext) })),
  registerRibbonGroup: (ext) => set((state) => ({ ribbonGroups: registerInto(state.ribbonGroups, ext) })),
  registerSlashCommand: (ext) => set((state) => ({ slashCommands: registerInto(state.slashCommands, ext) })),
  registerSidePanel: (ext) => set((state) => ({ sidePanels: registerInto(state.sidePanels, ext) })),

  unregisterPlugin: (pluginId) =>
    set((state) => ({
      blockTypes: dropPlugin(state.blockTypes, pluginId),
      sectionTabs: dropPlugin(state.sectionTabs, pluginId),
      ribbonGroups: dropPlugin(state.ribbonGroups, pluginId),
      slashCommands: dropPlugin(state.slashCommands, pluginId),
      sidePanels: dropPlugin(state.sidePanels, pluginId),
    })),
}))
