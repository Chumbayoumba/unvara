#!/usr/bin/env python3
"""Renders the Unvara app icon (open ember ring on a warm-dark tile) into every desktop/web icon slot.

Only needs Pillow. Geometry mirrors packages/app/src/pages/unvara/mark.tsx (24-unit grid).
Run: python3 design/build-icons.py
"""
import json, math, pathlib, shutil
from PIL import Image, ImageDraw

root = pathlib.Path(__file__).resolve().parent.parent
tokens = json.loads((root / "design/tokens.json").read_text())
EMBER = tokens["brand"]["ember"]
TILE_TOP, TILE_BOTTOM = "#262524", "#121212"
SS = 4  # supersampling factor for smooth edges


def hex_rgb(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def render(size: int, tile: bool = True) -> Image.Image:
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if tile:
        # Vertical gradient clipped to a rounded square (22.5% corner radius, like macOS/Windows 11 tiles).
        gradient = Image.new("RGBA", (big, big))
        top, bottom = hex_rgb(TILE_TOP), hex_rgb(TILE_BOTTOM)
        draw = ImageDraw.Draw(gradient)
        for y in range(big):
            t = y / (big - 1)
            draw.line([(0, y), (big, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.225), fill=255)
        img.paste(gradient, (0, 0), mask)
        # Hairline highlight along the top edge for depth.
        ImageDraw.Draw(img).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=round(big * 0.225), outline=(255, 255, 255, 22), width=max(1, big // 256)
        )

    # Mark geometry in 24-unit space: ring center (12, 12.5) r=8 stroke 2.25, gap ±25° around the top,
    # spark dot at (12, 3.6) r=1.7. Bounding box center is (12, 11.75).
    scale = big / 24 * (0.62 if tile else 1.0) * (24 / 19.7)
    cx, cy = big / 2, big / 2 + (12.5 - 11.75) * scale
    r, stroke = 8 * scale, 2.25 * scale
    color = hex_rgb(EMBER) + (255,)
    draw = ImageDraw.Draw(img)
    draw.arc([cx - r - stroke / 2, cy - r - stroke / 2, cx + r + stroke / 2, cy + r + stroke / 2], 295, 245, fill=color, width=round(stroke))
    for angle in (295, 245):  # round caps
        x, y = cx + r * math.cos(math.radians(angle)), cy + r * math.sin(math.radians(angle))
        draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=color)
    dx, dy, dr = cx, big / 2 + (3.6 - 11.75) * scale, 1.7 * scale
    draw.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=color)
    return img.resize((size, size), Image.LANCZOS)


def save_png(path: pathlib.Path, size: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    render(size).save(path)


def desktop_icons(folder: pathlib.Path):
    sizes = {
        "32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512, "dock.png": 256,
        "StoreLogo.png": 50, "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
    }
    for name, size in sizes.items():
        save_png(folder / name, size)
    render(256).save(folder / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    render(1024).save(folder / "icon.icns")


def favicon_svg() -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" fill="none">
  <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TILE_TOP}"/><stop offset="1" stop-color="{TILE_BOTTOM}"/></linearGradient></defs>
  <rect width="24" height="24" rx="5.4" fill="url(#t)"/>
  <g transform="translate(12 12) scale(0.755) translate(-12 -11.75)">
    <path d="M15.38 5.25A8 8 0 1 1 8.62 5.25" stroke="{EMBER}" stroke-width="2.25" stroke-linecap="round"/>
    <circle cx="12" cy="3.6" r="1.7" fill="{EMBER}"/>
  </g>
</svg>
"""


def web_icons(folder: pathlib.Path):
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("favicon.svg", "favicon-v3.svg"):
        (folder / name).write_text(favicon_svg())
    for name in ("favicon.ico", "favicon-v3.ico"):
        render(64).save(folder / name, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    for name, size in {
        "favicon-96x96.png": 96, "favicon-96x96-v3.png": 96, "apple-touch-icon.png": 180,
        "apple-touch-icon-v3.png": 180, "web-app-manifest-192x192.png": 192, "web-app-manifest-512x512.png": 512,
    }.items():
        save_png(folder / name, size)
    manifest = {
        "name": tokens["brand"]["name"], "short_name": tokens["brand"]["name"], "id": "/", "start_url": "/", "scope": "/",
        "icons": [
            {"src": "/web-app-manifest-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/web-app-manifest-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "theme_color": "#151515", "background_color": "#151515", "display": "standalone",
    }
    (folder / "site.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")


for channel in ("dev", "beta", "prod"):
    desktop_icons(root / "packages/desktop/icons" / channel)
favicons = root / "packages/ui/src/assets/favicon"
web_icons(favicons)
# packages/app/public holds copies (upstream symlinks can't be created on Windows without Developer Mode).
for item in favicons.iterdir():
    shutil.copy(item, root / "packages/app/public" / item.name)
save_png(root / "design/unvara-icon-1024.png", 1024)
print("icons written")
