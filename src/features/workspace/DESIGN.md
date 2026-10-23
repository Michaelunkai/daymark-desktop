# Workspace board — design tokens & rules

## Token table (`src/styles/tokens.css`)

| Token | Value | Usage |
|---|---|---|
| `--workspace-accent` | `#4fd1a5` | Single restrained accent: active pills, focus, meter fills |
| `--workspace-surface` | `#0c0e12` | Board background layer |
| `--workspace-surface-raised` | `#14171d` | Cards, header strips |
| `--workspace-border-hairline` | `rgba(255,255,255,0.08)` | All card/column borders |
| `--workspace-text-primary` | `rgba(240,244,248,0.94)` | Primary text |
| `--workspace-text-secondary` | `rgba(240,244,248,0.6)` | Captions, meta |
| `--workspace-age-fresh` | `#3ecf8e` | Update-age chip: fresh (<5 min) |
| `--workspace-age-due` | `#e6b450` | Update-age chip: due (5–10 min) |
| `--workspace-age-late` | `#f87171` | Update-age chip: late (>10 min) |
| `--workspace-radius-card` | `12px` | Card corners |
| `--workspace-radius-pill` | `999px` | Pills, chips |
| `--workspace-motion-fast` | `120ms` | State changes (armed button, chip swap) |
| `--workspace-motion` | `160ms` | Hover lift, bar width transitions |
| `--workspace-shadow-1` / `-2` | layered soft black | Resting / hover elevation |
| `--workspace-danger` | `#f87171` | Delete-all armed state |
| `--workspace-focus-ring` | teal ring | `:focus-visible` on new controls |

## Anti-AI-look rules

1. No purple-blue gradients; no gradient text anywhere.
2. One accent color (`--workspace-accent`), used sparingly.
3. No emoji in UI chrome — icons come from `features/workspace/icons.tsx`.
4. Type hierarchy from the system stack (`Inter, Segoe UI Variable`); max two font sizes per card zone.
5. 4px spacing grid (`--space-*` tokens) — no arbitrary gaps.
6. Motion ≤160ms, always wrapped in `prefers-reduced-motion` guards.
7. Hairline borders (`rgba(255,255,255,0.08)`) instead of heavy outlines.
8. Radii: 12px cards / 999px pills only — never oversized blobs.
9. Cards sit on elevation, not colored blocks; shadows are soft and dark, never glows.
10. Micro-copy stays human and concrete ("Delete all", "Tap again to delete 3", "updated 2m ago") — no marketing filler.
