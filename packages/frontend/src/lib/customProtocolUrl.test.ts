import { afterEach, describe, expect, it } from 'vitest'
import { customProtocolUrl } from './customProtocolUrl'

afterEach(() => {
  delete window.__TAURI_INTERNALS__
})

/** Tauri's own convertFileSrc, as its scripts/core.js defines it for each OS. */
function fakeTauri(os: 'windows' | 'macos' | 'linux') {
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (filePath: string, protocol: string) => {
      const path = encodeURIComponent(filePath)
      return os === 'windows' ? `http://${protocol}.localhost/${path}` : `${protocol}://localhost/${path}`
    },
  }
}

describe('customProtocolUrl', () => {
  it('Electron (no Tauri): <scheme>://localhost/<path>', () => {
    expect(customProtocolUrl('flownote-plugin', 'plugins/p/grid.html')).toBe('flownote-plugin://localhost/plugins/p/grid.html')
    expect(customProtocolUrl('flownote-attachment', 'att-1')).toBe('flownote-attachment://localhost/att-1')
  })

  it('Tauri on Windows: http://<scheme>.localhost/<path>, slashes left unencoded', () => {
    fakeTauri('windows')
    expect(customProtocolUrl('flownote-plugin', 'plugins/p/grid.html')).toBe('http://flownote-plugin.localhost/plugins/p/grid.html')
    expect(customProtocolUrl('flownote-attachment', 'att-1')).toBe('http://flownote-attachment.localhost/att-1')
  })

  it('Tauri on macOS/Linux: <scheme>://localhost/<path>', () => {
    fakeTauri('macos')
    expect(customProtocolUrl('flownote-plugin', '/sdk/index.js')).toBe('flownote-plugin://localhost/sdk/index.js')
  })
})
