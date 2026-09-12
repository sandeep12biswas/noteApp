// Ribbon font-family picker — a curated list, not every installed font
// (matching the ColorDropdownButton pattern's fixed preset lists in
// textColors.ts). `value` is the real CSS `font-family` stack TipTap's
// FontFamily extension writes onto the `textStyle` mark; the first entry's
// empty value means "no override" (dispatches `unsetFontFamily()`), used
// both for the "Default" ribbon option and as `fontStore.ts`'s initial
// default-font preference. The Google Fonts entries need the stylesheet
// `<link>` in index.html to actually render in that face — without it
// they silently fall back to the stack's next entry, same as any missing
// web font.
export interface FontFamilyOption {
  label: string
  value: string
}

export const FONT_FAMILIES: FontFamilyOption[] = [
  { label: 'Default', value: '' },
  { label: 'Sans Serif', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"Courier New", monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  // Google Fonts (index.html loads these families at weights 400/700).
  { label: 'Inter', value: '"Inter", sans-serif' },
  { label: 'Roboto', value: '"Roboto", sans-serif' },
  { label: 'Poppins', value: '"Poppins", sans-serif' },
  { label: 'Lora', value: '"Lora", serif' },
  { label: 'Merriweather', value: '"Merriweather", serif' },
]
