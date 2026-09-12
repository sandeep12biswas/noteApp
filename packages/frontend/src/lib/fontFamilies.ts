// Ribbon font-family picker — a curated list, not every installed font
// (matching the ColorDropdownButton pattern's fixed preset lists in
// textColors.ts). `value` is the real CSS `font-family` stack TipTap's
// FontFamily extension writes onto the `textStyle` mark; the first entry's
// empty value means "no override" (dispatches `unsetFontFamily()`), used
// both for the "Default" ribbon option and as `fontStore.ts`'s initial
// default-font preference.
//
// Every entry except `group: 'Web fonts'` is a genuinely pre-installed
// system font on some major OS, not a web font — no `<link>`/`@font-face`
// loads them, so on a machine that doesn't have that font, the browser
// silently falls back to the stack's next entry (each stack ends in a
// generic family for exactly this reason). "Windows" lists the fonts
// bundled with Windows/Office (Calibri, Segoe UI, Cambria, ...); "Linux"
// lists the fonts the `dejavu-fonts`/`liberation-fonts`/`fonts-noto`/
// `gnu-freefont` packages install, which cover the large majority of
// mainstream distros (Ubuntu, Fedora, Debian, ...) out of the box — a
// user without a given package installed just sees that option fall back,
// same as any other missing font, not an error. Only `group: 'Web fonts'`
// needs index.html's Google Fonts `<link>` to actually render as itself.
export interface FontFamilyOption {
  label: string
  value: string
  group: string
}

const GENERIC: FontFamilyOption[] = [
  { label: 'Default', value: '', group: 'Generic' },
  { label: 'Sans Serif', value: 'ui-sans-serif, system-ui, sans-serif', group: 'Generic' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif', group: 'Generic' },
  { label: 'Monospace', value: '"Courier New", monospace', group: 'Generic' },
]

// Windows/Office-bundled fonts.
const WINDOWS: FontFamilyOption[] = [
  // Office's default typeface since 2023-24, replacing Calibri — only on
  // newer Windows/Office installs, hence the Calibri fallback before the
  // generic tail.
  { label: 'Aptos', value: 'Aptos, Calibri, sans-serif', group: 'Windows' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif', group: 'Windows' },
  { label: 'Calibri', value: 'Calibri, sans-serif', group: 'Windows' },
  { label: 'Cambria', value: 'Cambria, serif', group: 'Windows' },
  { label: 'Candara', value: 'Candara, sans-serif', group: 'Windows' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive', group: 'Windows' },
  { label: 'Consolas', value: 'Consolas, monospace', group: 'Windows' },
  { label: 'Constantia', value: 'Constantia, serif', group: 'Windows' },
  { label: 'Corbel', value: 'Corbel, sans-serif', group: 'Windows' },
  { label: 'Courier New', value: '"Courier New", monospace', group: 'Windows' },
  { label: 'Garamond', value: 'Garamond, serif', group: 'Windows' },
  { label: 'Georgia', value: 'Georgia, serif', group: 'Windows' },
  { label: 'Impact', value: 'Impact, fantasy', group: 'Windows' },
  { label: 'Lucida Console', value: '"Lucida Console", monospace', group: 'Windows' },
  { label: 'Lucida Sans Unicode', value: '"Lucida Sans Unicode", sans-serif', group: 'Windows' },
  { label: 'Palatino Linotype', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif', group: 'Windows' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif', group: 'Windows' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif', group: 'Windows' },
  { label: 'Times New Roman', value: '"Times New Roman", serif', group: 'Windows' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif', group: 'Windows' },
  { label: 'Verdana', value: 'Verdana, sans-serif', group: 'Windows' },
]

// Fonts installed by default (or via the dejavu-fonts/liberation-fonts/
// fonts-noto/gnu-freefont packages) on most mainstream Linux distros.
const LINUX: FontFamilyOption[] = [
  { label: 'Cantarell', value: 'Cantarell, sans-serif', group: 'Linux' },
  { label: 'DejaVu Sans', value: '"DejaVu Sans", sans-serif', group: 'Linux' },
  { label: 'DejaVu Sans Mono', value: '"DejaVu Sans Mono", monospace', group: 'Linux' },
  { label: 'DejaVu Serif', value: '"DejaVu Serif", serif', group: 'Linux' },
  { label: 'FreeMono', value: 'FreeMono, monospace', group: 'Linux' },
  { label: 'FreeSans', value: 'FreeSans, sans-serif', group: 'Linux' },
  { label: 'FreeSerif', value: 'FreeSerif, serif', group: 'Linux' },
  { label: 'Liberation Mono', value: '"Liberation Mono", monospace', group: 'Linux' },
  { label: 'Liberation Sans', value: '"Liberation Sans", sans-serif', group: 'Linux' },
  { label: 'Liberation Serif', value: '"Liberation Serif", serif', group: 'Linux' },
  { label: 'Noto Sans', value: '"Noto Sans", sans-serif', group: 'Linux' },
  { label: 'Noto Serif', value: '"Noto Serif", serif', group: 'Linux' },
  { label: 'Ubuntu', value: 'Ubuntu, sans-serif', group: 'Linux' },
]

// Google Fonts (index.html loads these families at weights 400/700) — the
// only entries here that aren't pre-installed anywhere and need a network
// fetch to render as themselves.
const WEB: FontFamilyOption[] = [
  { label: 'Inter', value: '"Inter", sans-serif', group: 'Web fonts' },
  { label: 'Lora', value: '"Lora", serif', group: 'Web fonts' },
  { label: 'Merriweather', value: '"Merriweather", serif', group: 'Web fonts' },
  { label: 'Poppins', value: '"Poppins", sans-serif', group: 'Web fonts' },
  { label: 'Roboto', value: '"Roboto", sans-serif', group: 'Web fonts' },
]

export const FONT_FAMILIES: FontFamilyOption[] = [...GENERIC, ...WINDOWS, ...LINUX, ...WEB]
