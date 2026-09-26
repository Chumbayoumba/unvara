# Unvara Design Guidebook

Unvara looks and feels like a calm, native desktop assistant: warm-neutral surfaces, one quiet accent,
generous type, no chrome that is not earning its place. The reference is the Claude desktop app
(dark "v2" palette) — we match its proportions and tone, not its brand.

Source of truth for every value below: [`design/tokens.json`](tokens.json).
Generated/consumed by:

| File | What it holds |
|---|---|
| `design/tokens.json` | All tokens (colors, type, sizes, radii, motion) |
| `design/build-theme.py` | → `packages/ui/src/theme/themes/unvara.json` (the app theme) |
| `design/build-icons.py` | → desktop icons, favicons, web manifest |
| `packages/ui/src/styles/unvara.css` | Fonts, shell tokens (`--uv-*`), component skins |
| `packages/app/src/pages/unvara/` | Shell: layout, sidebar, home, mark, icons |

## 1. Principles

1. **Content first.** Surfaces are nearly flat; hierarchy comes from tone steps and type, not borders or shadows.
2. **One accent.** Ember (`#E2A04F`) marks the brand moments only: the mark, the send button, selection tint.
   Everything interactive otherwise uses neutral overlays; links and focus use blue.
3. **Warm neutrals.** Greys carry a hint of yellow (`#c3c2b7`, `#898781`) — never pure blue-grey.
4. **Local and honest.** Copy says what happens on the machine ("Local"), never implies a cloud.
5. **Same in both themes.** Every color is a token with a light and a dark value; never hardcode hex in components.

## 2. Brand

| Token | Value | Use |
|---|---|---|
| `--uv-ember` | `#E2A04F` | Mark, send button, selection tint |
| `--uv-ember-emphasized` | `#C98733` | Hover/pressed on ember fills |
| `--uv-ember-soft` | `#F1C68B` | Subtle ember text on dark |
| `--uv-on-ember` | `#1A1206` | Icons/text on ember fills |

**Mark:** an open ring with a spark in the gap — "nothing held back". Geometry lives in
`packages/app/src/pages/unvara/mark.tsx` (24-unit grid: ring center 12,12.5 r8 stroke 2.25, gap ±25° at the top,
spark at 12,3.6 r1.7). Wordmark = mark + "Unvara" in the serif at 17px/500.
Do not recolor the mark except ember on any surface, or monochrome `currentColor` at ≤16px.

## 3. Color

Measured from the Claude desktop app (dark, color-version v2) and mapped onto OpenCode's v2 token system.

### Surfaces (dark / light)

| Role | Token | Dark | Light |
|---|---|---|---|
| Sidebar, window chrome | `v2-background-bg-deep` | `#111111` | `#f3f3f0` |
| Main pane | `v2-background-bg-base` | `#151515` | `#f9f9f7` |
| Composer, popovers, cards | `v2-background-bg-layer-01` | `#20201f` | `#ffffff` |
| Chips, avatars, raised controls | `v2-background-bg-layer-02` | `#2c2c2a` | `#f0efec` |
| Strong fills | `v2-background-bg-layer-03` | `#383835` | `#e7e6e1` |

### Text & icons

| Role | Token | Dark | Light |
|---|---|---|---|
| Primary | `v2-text-text-base` | `#f0efec` | `#131313` |
| Secondary (sidebar rows, meta) | `v2-text-text-muted` | `#c3c2b7` | `#383835` |
| Muted (placeholders, labels) | `v2-text-text-faint` | `#898781` | `#7b7974` |
| Link / accent | `v2-text-text-accent` | `#6da7ec` | `#256abf` |

### Lines & overlays (alpha, work on any surface)

| Role | Token | Dark | Light |
|---|---|---|---|
| Hairline / divider | `v2-border-border-muted` | white 8% | black 6% |
| Default border | `v2-border-border-base` | white 10% | black 9% |
| Composer ring | `v2-border-border-strong` | white 20% | black 18% |
| Row hover | `--uv-hover` | white 7.5% | black 5% |
| Row selected | `--uv-selected` | white 15% | black 10% |
| Focus ring | `v2-border-border-focus` | `#2a78d6` | `#2a78d6` |

### Status

success `#55bf50` / `#007300`, warning `#db9300` / `#945d00`, danger `#ec7e7e` / `#b93535`, info `#6da7ec` / `#256abf`
(foregrounds, dark / light). Backgrounds use the matching `-800` (dark) or `-50` (light) ramp step.

Full 12-step ramps (gray, blue, red, green, yellow, orange, violet, magenta, aqua) are in `tokens.json → ramps`.

## 4. Typography

All fonts are OFL-licensed and bundled (Latin + Cyrillic) in `packages/ui/src/assets/fonts/unvara/`.

| Family | Font | Used for |
|---|---|---|
| `--font-family-sans` ("Unvara Sans") | Inter (variable) | All UI and body text |
| `--font-family-serif` ("Unvara Serif") | Source Serif 4 (variable) | Greeting, wordmark, display moments |
| `--font-family-mono` ("Unvara Mono") | JetBrains Mono (variable) | Code, terminal, keybinds |

| Style | Size / line | Weight | Notes |
|---|---|---|---|
| Greeting | 38 / 47.5 | 300 serif | Centered with the mark (34px) |
| Title | 22 / 28 | 500 | Page titles |
| Prose (assistant replies) | 16 / 24 | 400 | |
| Composer input | 15 / 22 | 400 | |
| Body / sidebar rows | 14 / 21 | 400 | |
| Group labels, footnotes | 13 / 17 | 400 | `text-faint` |
| Caption, keybind hints | 12 / 17 | 400 | |
| Code | 13 / 19 | 400 mono | |

Weights: regular 400, medium 500, semibold 580, bold 600. Never go above 600 in UI.

## 5. Layout & sizing

```
┌───────────── sidebar 288 ─────────────┬──────────── main pane ─────────────────┐
│ header 48: ≡  ◯ Unvara        ‹  ›    │ header 48 (drag region)  [win controls]│
│ ( + ) New chat          Ctrl+N        │                                        │
│  ⌕   Search                           │            ◯  Good evening             │
│  ⬡   Models                           │   ┌──────────── composer 672 ───────┐  │
│  ⚙   Customize                        │   │ How can I help…                 │  │
│ Projects                        +     │   │ +  model ▾                  [↑] │  │
│  ▭  playground                        │   └─────────────────────────────────┘  │
│ Recents                               │                                        │
│  Session title…                       │                                        │
│ ─────────────────────────────────────  │                                        │
│ (A) admin · ● Local              ⊟    │                                        │
└───────────────────────────────────────┴────────────────────────────────────────┘
```

| Token | Value |
|---|---|
| `--uv-sidebar-width` | 288px |
| `--uv-header-height` | 48px (Windows caption buttons overlay the right 138px) |
| `--uv-row-height` | 32px, 8px gap icon↔label, 28px leading slot, 20px icons |
| `--uv-composer-width` | 672px (new chat) · thread max 768px |
| Greeting position | top 26% of the pane, 28px above the composer |
| Spacing scale | 6 · 8 · 12 · 16 · 24 · 28 · 40 |

## 6. Radii, elevation, motion

| Token | Value | Use |
|---|---|---|
| `--uv-radius-xs` | 6px | Tiny icon buttons |
| `--uv-radius` | 8px | Rows, buttons, chips |
| `--uv-radius-lg` | 10px | Icon tiles |
| `--uv-radius-card` | 12px | Cards, dialogs |
| `--uv-radius-composer` | 14px | Composer |

Elevation is a 1px ring + a soft shadow, never a heavy drop:
composer `0 0 0 1px border-strong, 0 4px 20px rgb(0 0 0 / .075)`; popovers use `v2-elevation-overlay`.
The main pane has **no** card or shadow — it sits flush on `bg-base`, separated from the sidebar by one hairline.

Motion: `60ms` hover color, `120ms` reveals (keybind hints, section `+`), `200ms` rings/shadows,
`300ms` sheets. Easing `cubic-bezier(.165,.84,.44,1)` (out) and `cubic-bezier(.32,.72,0,1)` (snap).
Respect `prefers-reduced-motion`.

## 7. Components

**Sidebar row** — 32px, radius 8, `text-muted`; hover `--uv-hover`; selected `--uv-selected` + `text-base`.
Keybind hint fades in on hover at 12px `text-faint`. Primary action ("New chat") uses `text-base` and a
filled-circle-plus icon.

**Group label** — 13px `text-faint`, 28px tall, 10px left inset; its `+` action appears on section hover.

**Composer** — `bg-layer-01`, radius 14, strong ring; focus brightens the ring to 32% of `text-base`.
Input 15/22 with 14×16px padding. Bottom bar: `+` attach, model picker (13px `text-muted`), send button right.

**Send button** — 32×32, radius 8, ember fill, `--uv-on-ember` arrow; disabled at 45% opacity; hover `ember-emphasized`.

**Icon button** — 32×32, radius 8, `icon-base`; hover overlay + `text-base`.

**Cards / choice rows** (e.g. "Choose a folder") — `bg-layer-01`, radius 14, strong ring, 40px icon tile
(`bg-layer-02`, radius 10), title 15/500, description 13/19 `text-faint`, trailing chevron nudges 2px on hover.

**Footer identity** — 28px round avatar (`bg-layer-02`, 12px/560 initial), name 13/500, status line 12px with a
6px success dot and "Local".

## 8. Icons

Own set in `packages/app/src/pages/unvara/icons.tsx`: 20px grid, 1.5px stroke, round caps and joins,
`currentColor`. Keep new icons geometric and quiet; no filled glyphs except status dots.

## 9. Copy

Short, sentence case, friendly: "New chat", "Let's get started", "Choose a folder".
Every visible string goes through i18n (`packages/app/src/i18n/en.ts` + `ru.ts`, keys `unvara.*`).
Say "Unvara" for the app; keep third-party names (OpenCode Zen, providers) as they are.

## 10. Don'ts

- Don't use Anthropic's or OpenAI's names, marks, or proprietary fonts; we borrow proportions, not brands.
- Don't hardcode colors in components — add a token.
- Don't put the main pane in a raised card, and don't add borders where a tone step works.
- Don't use ember for large fills or body text.
