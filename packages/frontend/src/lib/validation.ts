// Naming rules — DESIGN.md §2.1/§2.2.

/**
 * Folder names auto-capitalize their first letter as the user types
 * ("typing all-lowercase still yields a capitalized name") — a live
 * transform, not a rejection, so this never fails.
 */
export function capitalizeFirstLetter(name: string): string {
  if (name.length === 0) return name
  return name[0]!.toUpperCase() + name.slice(1)
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * File names must start with a letter — lowercase or capital, any script
 * (`\p{L}`), so not a number or a special character (issue #31: they used
 * to require a capital). Unlike folder names, nothing is auto-corrected:
 * the name keeps the case the user typed, and an invalid one is an error
 * the user must fix.
 */
export function validateFileName(name: string): ValidationResult {
  if (name.trim().length === 0) {
    return { valid: false, error: 'File name cannot be empty.' }
  }
  if (!/^\p{L}/u.test(name)) {
    return { valid: false, error: 'File name must start with a letter.' }
  }
  return { valid: true }
}
