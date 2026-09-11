import { beforeEach, describe, expect, it } from 'vitest'
import { useExtensionRegistry } from './extensionRegistry'

beforeEach(() => {
  useExtensionRegistry.setState({ blockTypes: {}, sectionTabs: {}, ribbonGroups: {}, slashCommands: {}, sidePanels: {} })
})

describe('extensionRegistry', () => {
  it('starts empty (DESIGN.md: consulted by rendering code, empty until Phase 7)', () => {
    const state = useExtensionRegistry.getState()
    expect(state.blockTypes).toEqual({})
    expect(state.ribbonGroups).toEqual({})
  })

  it('registers entries namespaced by plugin id', () => {
    useExtensionRegistry.getState().registerRibbonGroup({ pluginId: 'com.example.foo', id: 'toolbar', ribbonTab: 'Insert', label: 'Foo' })
    const groups = Object.values(useExtensionRegistry.getState().ribbonGroups)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ pluginId: 'com.example.foo', label: 'Foo' })
  })

  it('unregisterPlugin drops every extension point for that plugin, leaving others', () => {
    const store = useExtensionRegistry.getState()
    store.registerBlockType({ pluginId: 'com.example.foo', id: 'a', label: 'A' })
    store.registerRibbonGroup({ pluginId: 'com.example.foo', id: 'b', ribbonTab: 'Home', label: 'B' })
    store.registerBlockType({ pluginId: 'com.example.bar', id: 'c', label: 'C' })

    store.unregisterPlugin('com.example.foo')

    const state = useExtensionRegistry.getState()
    expect(Object.keys(state.blockTypes)).toEqual(['com.example.bar/c'])
    expect(state.ribbonGroups).toEqual({})
  })
})
