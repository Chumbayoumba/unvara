#!/usr/bin/env python3
"""Generates packages/ui/src/theme/themes/unvara.json from the Unvara design tokens (design/tokens.json)."""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
tokens = json.loads((root / "design/tokens.json").read_text())
ramps = tokens["ramps"]

# Map each 12-step OpenCode v2 ramp (100 = lightest, 1200 = darkest) onto the Unvara ramps.
STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
PICK = ["50", "100", "150", "200", "300", "400", "450", "500", "600", "700", "750", "800"]
RENAME = {"blue": "blue", "red": "red", "green": "green", "yellow": "yellow", "orange": "orange",
          "purple": "violet", "pink": "magenta", "cyan": "aqua"}

def hue_ramps():
    out = {}
    for v2name, ours in RENAME.items():
        for step, pick in zip(STEPS, PICK):
            out[f"v2-{v2name}-{step}"] = ramps[ours][pick]
    return out

def grey_ramp():
    g = ramps["gray"]
    order = ["0", "20", "50", "100", "200", "300", "400", "500", "600", "700", "800", "850", "870"]
    names = [50] + STEPS
    return {f"v2-grey-{n}": g[k] for n, k in zip(names, order)}

def variant(mode):
    m = tokens[mode]
    return {
        "palette": m["palette"],
        "overrides": m["legacy"],
        "v2Overrides": {**grey_ramp(), **hue_ramps(), **m["semantic"]},
    }

theme = {
    "$schema": "https://opencode.ai/desktop-theme.json",
    "name": "Unvara",
    "id": "unvara",
    "light": variant("light"),
    "dark": variant("dark"),
}
out = root / "packages/ui/src/theme/themes/unvara.json"
out.write_text(json.dumps(theme, indent=2) + "\n")
print("wrote", out)
