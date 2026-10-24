// Installed plugins must load when the app starts, not only after the
// Plugins panel is opened. PluginManager's own mount-time loadPlugins() runs
// before App.tsx has resolved the IPC adapter (child effects run first), so
// App.tsx has to load them once the adapter exists — before that fix, a
// restarted app had zero plugin iframes and every plugin block showed as
// inactive until the user happened to open the Plugins panel.
import { expect, test } from '@playwright/test'
import { closeApp, launchApp, SPREADSHEET_MANIFEST, type LaunchedApp } from './helpers'

test('an installed plugin loads on startup after a restart, without opening the Plugins panel', async () => {
  let ctx: LaunchedApp = await launchApp()
  await ctx.page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
  await ctx.page.getByRole('button', { name: 'Install…' }).click()
  await ctx.page.getByRole('textbox', { name: 'Plugin manifest JSON' }).fill(SPREADSHEET_MANIFEST)
  await ctx.page.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(ctx.page.locator('iframe')).toHaveCount(1)

  // Restart against the same database (app.close(), not closeApp — see ink-layer-persistence.spec.ts).
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })

  // The plugin's registration iframe is back without touching the Plugins panel...
  await expect(ctx.page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1)
  // ...and it actually ran: its `/sheet` slash command is registered.
  await ctx.page.getByRole('button', { name: 'New page' }).click()
  await ctx.page.getByRole('radio', { name: 'New folder' }).click()
  await ctx.page.getByRole('textbox', { name: 'New folder name' }).fill('Notes')
  await ctx.page.getByRole('button', { name: 'Next' }).click()
  await ctx.page.getByRole('textbox', { name: 'File name' }).fill('Sheet')
  await ctx.page.getByRole('button', { name: 'Create' }).click()
  await ctx.page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  await ctx.page.keyboard.type('/')
  await expect(ctx.page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Spreadsheet' })).toBeVisible()

  await closeApp(ctx)
})
