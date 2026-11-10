#!/usr/bin/env python3
"""Generates installer artwork from the app icon (apps/tauri/src-tauri/icons/icon.png).

Outputs (committed, so builds don't need Pillow):
  apps/electron/build/icons/<N>x<N>.png      Linux icon set for electron-builder
  apps/tauri/src-tauri/installer/header.bmp   NSIS header image, 150x57
  apps/tauri/src-tauri/installer/sidebar.bmp  NSIS welcome/finish sidebar, 164x314
  apps/tauri/src-tauri/installer/wix-banner.bmp  MSI top banner, 493x58
  apps/tauri/src-tauri/installer/wix-dialog.bmp  MSI welcome background, 493x312

The icon itself comes from docs/design/branding/icons/c-nib-wave.svg: render it
to a 1024px PNG and run `pnpm --dir apps/tauri tauri icon <png>` first.

Re-run after changing the icon:  python3 scripts/assets/make-installer-art.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ICON = Image.open(ROOT / "apps/tauri/src-tauri/icons/icon.png").convert("RGBA")
ACCENT = (118, 80, 194)  # FlowNote lavender-600
# Sidebar / dialog gradient: lavender-800 -> lavender-500 (packages/frontend/src/index.css)
GRAD_TOP = (75, 49, 130)
GRAD_BOTTOM = (142, 108, 214)
WHITE = (255, 255, 255)


def font(size, bold=False):
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for d in ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/TTF", "/usr/share/fonts/dejavu"]:
        for n in names:
            p = Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def paste_icon(img, size, xy):
    ic = ICON.resize((size, size), Image.LANCZOS)
    img.paste(ic, xy, ic)


def gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


# Linux icon set
out = ROOT / "apps/electron/build/icons"
out.mkdir(parents=True, exist_ok=True)
for n in (16, 32, 48, 64, 128, 256, 512):
    ICON.resize((n, n), Image.LANCZOS).save(out / f"{n}x{n}.png")

inst = ROOT / "apps/tauri/src-tauri/installer"
inst.mkdir(parents=True, exist_ok=True)

# NSIS header: white, icon on the right (NSIS draws the page title on the left)
h = Image.new("RGB", (150, 57), WHITE)
paste_icon(h, 45, (99, 6))
h.save(inst / "header.bmp")

# NSIS sidebar: lavender gradient, icon + name
s = gradient(164, 314, GRAD_TOP, GRAD_BOTTOM)
paste_icon(s, 96, (34, 48))
d = ImageDraw.Draw(s)
f = font(22, True)
w = d.textlength("FlowNote", font=f)
d.text(((164 - w) / 2, 160), "FlowNote", font=f, fill=WHITE)
f2 = font(11)
for i, line in enumerate(["Click anywhere.", "Just write."]):
    w = d.textlength(line, font=f2)
    d.text(((164 - w) / 2, 196 + i * 16), line, font=f2, fill=(237, 231, 251))  # lavender-100
s.save(inst / "sidebar.bmp")

# WiX banner: white, icon at the right edge (WiX puts text on the left)
b = Image.new("RGB", (493, 58), WHITE)
paste_icon(b, 44, (440, 7))
b.save(inst / "wix-banner.bmp")

# WiX dialog: left 164px coloured panel with icon (WiX writes text on the right)
dl = Image.new("RGB", (493, 312), WHITE)
dl.paste(gradient(164, 312, GRAD_TOP, GRAD_BOTTOM), (0, 0))
paste_icon(dl, 96, (34, 60))
d = ImageDraw.Draw(dl)
w = d.textlength("FlowNote", font=f)
d.text(((164 - w) / 2, 170), "FlowNote", font=f, fill=WHITE)
dl.save(inst / "wix-dialog.bmp")

print("wrote", out, "and", inst)
