import { describe, expect, it } from 'vitest'
import { lavenderIconName } from './folderIcons'

describe('folder icon values', () => {
  it('null is the plain lavender folder', () => expect(lavenderIconName(null)).toBe('folder'))
  it('reads a lavender icon', () => expect(lavenderIconName('lavender:star')).toBe('star'))
  it('an unknown lavender name still draws a folder', () => expect(lavenderIconName('lavender:rocket')).toBe('folder'))
  it('an emoji is not a lavender icon', () => expect(lavenderIconName('⭐')).toBeNull())
})
