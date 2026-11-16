"""Regenerates icon16/32/48/128.png. Run: python make_icons.py (needs Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

ACCENT = (37, 99, 235)  # matches --accent in the pages
HERE = Path(__file__).parent


def icon(size: int) -> Image.Image:
    s = 512  # draw large, scale down for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 0 if size <= 32 else s * 0.0625  # Chrome expects padding on larger icons
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=(s - 2 * pad) * 0.24, fill=ACCENT)
    # Bookmark ribbon with a V notch at the bottom.
    x0, x1, y0, y1, notch = 0.33 * s, 0.67 * s, 0.24 * s, 0.78 * s, 0.64 * s
    d.rounded_rectangle([x0, y0, x1, y0 + 0.12 * s], radius=0.04 * s, fill="white")
    d.polygon([(x0, y0 + 0.05 * s), (x1, y0 + 0.05 * s), (x1, y1), (s / 2, notch), (x0, y1)], fill="white")
    return img.resize((size, size), Image.LANCZOS)


for n in (16, 32, 48, 128):
    icon(n).save(HERE / f"icon{n}.png")
print("icons written")
