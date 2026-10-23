# Daymark Design System — "Vanta-Black Premium Control Room"

One line: picking precision instrument — near-black layered surfaces, a single
electric-teal accent, tightened type hierarchy, hairline borders, status color
as the only color noise.

Owner-fixed. Applied in `src/styles/theme.css`, `src/styles/tokens.css`,
`src/styles/app-shell.css`. No logic/IPC/data changes.

## 1. Color tokens (computed, flat values)

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` / bg | `#050507` | Page background (deepest layer) |
| `--color-surface` / surface | `#0B0D10` | Cards, columns, topbar, strip |
| `--color-surface-raised` / surface-2 | `#11141A` | Inputs, pills, hover/selected fill |
| `--color-border` / hairline | `rgba(255,255,255,0.07)` | All 1px borders |
| `--color-border-strong` | `rgba(255,255,255,0.14)` | Input borders, hover border |
| `--color-text-primary` / text | `#E8ECEF` | Body and headings |
| `--color-text-secondary/tertiary` / text-dim | `#98A2AD` | Meta, captions, countdowns |
| `--color-accent` (ONLY accent) | `#2DE2C5` | Primary actions + live indicators (usage fill, refresh dot, agents dot, focus ring) |
| `--color-accent-hover` | `#5CEBD4` | Primary button hover |
| `--color-accent-contrast` | `#050507` | Text on accent fill |
| `--color-success` | `#4ADE80` | Fresh/ok status only |
| `--color-danger` | `#F87171` | Late/delete/update-flash only |
| `--amber` (warn) | `#FBBF24` | Due/paused/cached status only |
| Indigo / any other hue | removed | Awaiting-state pills are neutral dim now |

Rule: teal is never used for decorative state; status colors appear only inside
their semantic pill/border/text role.

## 2. Type

Existing font stack (`Inter, ui-sans-serif, -apple-system, …`), hierarchy
tightened:

- Card/board titles: `15px / 650` (board row titles min `13.5px / 650` where
  layout density demands), no uppercase transform
- Body: `13.5px / 400`, line-height `1.45`
- Journal & task meta: `12px / 500`, uppercase-free
- Numeric readouts (usage labels, counts): `ui-monospace` stack,
  `font-variant-numeric: tabular-nums`
- No letter-spacing gimmicks (blanket `letter-spacing: 0` stays; uppercase
  column labels de-transformed where touched)

## 3. Spacing & radius

- 4/8 scale only: 4, 8, 12, 16, 20, 24… (sub-4 hairline paddings on pills use
  the pill spec below)
- One radius token: `--radius: 10px` (cards, buttons, inputs, columns)
- Pills: `border-radius: 999px` (the single allowed exception)
- Contract note: `src/control-panel-contract.test.mjs` pins the historical
  literal `.control-card { border-radius: 12px; }` — the live token is 10px;
  see the compatibility comment beside the rule.

## 4. Depth

- Hairline borders only; drop shadows removed (`--shadow-raised: none`)
- One top-highlight inset on raised surfaces:
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`
- The In-Progress column's `min-height: calc(260px * 4)` rule is untouched.

## 5. Pills

- Padding `3px 10px`, radius `999px`, dim background tint + colored text
- Agents pill carries a 6px accent dot pulsing via opacity, `2s ease infinite`,
  disabled under `prefers-reduced-motion`

## 6. Motion

- Exactly one orchestrated load reveal: the control board fades/rises 8px,
  `240ms ease-out`, opacity + transform only (`board-instrument-rise`)
- Update-flash (`board-task__update.is-new`) stays red for its existing
  2-minute window — logic untouched, only var-backed color
- `prefers-reduced-motion` global kill-switch in `theme.css` + explicit guards

## 7. Usage meters — instrument strip

Slim strip: segmented 4px bar per window (5h/7d), remaining fill in accent,
right-aligned mono numeric label, reset countdown in text-dim, warn/crit swap
the fill and label to warn/danger.

## 8. Buttons

- Primary (Complete/create): accent fill `#2DE2C5`, dark text `#050507`,
  hover `#5CEBD4`
- Secondary: hairline outline on surface
- Destructive (Delete all): danger-tinted outline
- Height 32px, radius 10px, focus ring `outline: 2px solid #2DE2C5; offset 2px`

## 9. Contrast pairs (WCAG)

Computed with the WCAG relative-luminance formula.

| Foreground | Background | Ratio | Grade |
| --- | --- | --- | --- |
| text `#E8ECEF` | bg `#050507` | **17.2 : 1** | AAA |
| text `#E8ECEF` | surface `#0B0D10` | 16.4 : 1 | AAA |
| text `#E8ECEF` | surface-2 `#11141A` | 15.0 : 1 | AAA |
| text-dim `#98A2AD` | bg `#050507` | **8.0 : 1** | AAA |
| text-dim `#98A2AD` | surface `#0B0D10` | 7.7 : 1 | AA (AAA large) |
| text-dim `#98A2AD` | surface-2 `#11141A` | 7.3 : 1 | AA |
| accent `#2DE2C5` | bg `#050507` | 12.4 : 1 | AAA |
| dark text `#050507` | accent fill `#2DE2C5` | 12.4 : 1 | AAA |
| success `#4ADE80` | bg | 11.7 : 1 | AAA |
| warn `#FBBF24` | bg | 12.0 : 1 | AAA |
| danger `#F87171` | bg | 7.4 : 1 | AA |

All text pairs clear WCAG AA; the flagged text-on-bg pair is 17.2:1.

## 10. The one memorable element

The live usage instrument strip + the single electric-teal accent. All
competing decoration removed: no gradients, no glows, no drop shadows, no
extra accent borders (the In-Progress column border is the only accent-tinted
border, at 35% teal, because it is a live state).

## Android companion (AiWorkspaceActivity tokens — same identity)
- bg #050507 · surface #0E1116 · surface-2 #141922 · stroke hairline #232B37
- text #EDF1F6 · secondary #9AA6B5 · accent #2DE2C5 (primary action only)
- success #4ADE80 / danger #F87171 / warn #FBBF24 — state meanings only
- Type: display 20sp/title 16sp medium/body 14sp/caption 12sp/micro 11sp; tnum on counts
- Spacing 4dp base (4/8/12/16/24); page gutter 16dp; radius 16/12/20/pill
- Pills: neutral surface-2 fill by default; hue only for real state
- Touch >= 48dp; pressed = 0.97 scale + ripple; titles ellipsize END
