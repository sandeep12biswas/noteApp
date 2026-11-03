// Right-click on a panel's empty space: "New folder" in the folder panel,
// "New page" in the page panel (EXECUTION_PLAN.md Features). Right-clicking
// an existing row keeps that row's own menu.
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('create a folder and then a page in it, using only right-click menus', async ({ page }) => {
  // Folder panel: empty space -> New folder.
  await page.getByRole('list', { name: 'Folder tree' }).click({ button: 'right', position: { x: 20, y: 60 } })
  await page.getByRole('menu', { name: 'Folder panel actions' }).getByRole('menuitem', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill('projects')
  await page.keyboard.press('Enter')
  const folder = page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Projects', exact: true })
  await expect(folder).toBeVisible()
  await folder.click()

  // Page panel: empty space -> New page, with the selected folder pre-chosen.
  await page.getByRole('list', { name: 'Files' }).click({ button: 'right', position: { x: 20, y: 60 } })
  await page.getByRole('menu', { name: 'Page panel actions' }).getByRole('menuitem', { name: 'New page' }).click()
  await expect(page.getByRole('combobox', { name: 'Existing folder' })).toHaveValue(/.+/)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill('Roadmap')
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Roadmap' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Roadmap')
})

test('Escape closes a panel menu without creating anything', async ({ page }) => {
  await page.getByRole('list', { name: 'Folder tree' }).click({ button: 'right', position: { x: 20, y: 60 } })
  await expect(page.getByRole('menu', { name: 'Folder panel actions' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Folder panel actions' })).toHaveCount(0)
  await expect(page.getByText('No folders yet')).toBeVisible()
})
