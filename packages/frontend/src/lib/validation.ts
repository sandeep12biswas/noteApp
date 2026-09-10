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
 * File names cannot start with a number or a special character, and must
 * start with a capital letter — unlike folder names, this is a hard
 * validation the user must fix, not an auto-correct.
 */
export function validateFileName(name: string): ValidationResult {
  if (name.trim().length === 0) {
    return { valid: false, error: 'File name cannot be empty.' }
  }
  if (!/^[A-Z]/.test(name)) {
    return { valid: false, error: 'File name must start with a capital letter.' }
  }
  return { valid: true }
}
