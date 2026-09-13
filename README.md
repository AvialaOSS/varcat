# VarCat

Figma plugin that creates the whole Aviala Design Variables tree from one closed naming paradigm: five namespaces, eight collections, 757 variables, all derivable from [`paradigm/vocabulary.json`](paradigm/vocabulary.json).

Sibling of [ColorCat](https://github.com/AvialaOSS/colorcat), which stays responsible for color-ramp experiments. VarCat reuses ColorCat's ramp algorithm (`@aviala-design/color`) but owns naming, aliasing and bulk creation.

## Install

```bash
npm install
npm run build
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json` from this folder. `npm run watch` rebuilds on save; re-run the plugin to pick up a change.

| Script | What it does |
|--------|--------------|
| `npm run build` | Bundles `dist/code.js` + `dist/ui.html` (esbuild) |
| `npm run watch` | Same, in watch mode |
| `npm test` | vitest: validator gold/anti examples + expansion snapshot |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dry-run` | Headless expansion; `-- --json` prints the full path inventory |
| `npm run paradigm:generate` | Regenerates the derived alias table and component matrix |

## Using the plugin

1. **Namespaces** — check the collections to write. All eight are on by default.
2. **Palette seeds** — the ALD seeds are prefilled (`primary #FF5532`, `success #33BF24`, `warning #FFC130`, `error #FF1D4E`, `info #37B2FF`). The neutral ramp is the ALD literal ramp.
3. **Dry-run** — counts per collection plus the first paths, nothing is written.
4. **Apply** — creates or reuses collections and modes, then upserts every variable by path. Re-running is idempotent: existing variables are updated in place, and variables you added by hand are never deleted.
5. **Validate selection** — checks every local variable in the file against the paradigm and lists the violations with the rule that fired.

Apply writes into a **new `palette` collection**. The existing `Aviala Design Colors` collection is never touched or overwritten; the mapping below is how the two relate.

Namespaces are applied in dependency order (`palette` → `semantic` → `component`) so aliases always find their target. If you apply `component` alone, VarCat looks the target up in the file and reports the entry as skipped rather than writing a literal behind your back.

## Paradigm in one screen

Full rules and vocabulary: [`docs/paradigm.md`](docs/paradigm.md).

| Collection | Path shape | Value | Modes | Count |
|------------|------------|-------|-------|-------|
| `palette` | `{family}/{step}` | literal `COLOR` | `light` / `dark` | 74 |
| `semantic` | `{use}/{tone}-{slot}` | alias → `palette` | `light` / `dark` | 150 |
| `scaleStatic` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `scaleDensity` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `scaleContrast` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `component` | `{type}/{component}-{level}-{role}-{state}` | alias → `semantic` | `light` / `dark` | 344 |
| `effect` | `effect/{name}-{position}` | literal `COLOR` | `light` / `dark` | 6 |
| `effectSwitch` | `effect/{name}-{position}` | literal `COLOR` | `on` / `off` | 6 |

Naming rules: charset `a-zA-Z0-9-`; every segment and slot starts with a lowercase letter and stays camelCase inside; a group is mandatory; the leaf never repeats the full group name; singular only; `-` separates slots only; every slot draws from a closed list narrowed further by the per-namespace matrices.

## Old ALD → new name

The old collections keep working. Nothing below is a rename in place — VarCat writes new collections, and this table is the migration key.

### Collections

| ALD today | VarCat |
|-----------|--------|
| `Aviala Design Colors` (Light/Dark) | `palette` (light/dark) |
| `token-colors` (Default) | `semantic` (light/dark) |
| `base-numbers` (Default / Mobile Friendly) | `scaleStatic` / `scaleDensity`, plus the new `scaleContrast` |
| `font-weight` (Mode 1) | folded into `scale*` as `weight/{step}` |
| `special-effort` (ON/OFF) | `effect` (light/dark) + `effectSwitch` (on/off) |
| `base-variable` (empty) | dropped |
| — | `component` (new) |

### Palette

| ALD | VarCat |
|-----|--------|
| `primary/primary-8` | `primary/s8` |
| `error/error-8` | `error/s8` |
| `neutral/neutral-14` | `neutral/s14` |

The step number is written `sN` so the segment starts with a letter. Display names still read as step 8.

### Semantic — text

| ALD | VarCat |
|-----|--------|
| `text/text-theme-primary-black` | `text/theme-primary` |
| `text/text-theme-secondary-black` | `text/theme-secondary` |
| `text/text-theme-light-black` | `text/theme-tertiary` |
| `text/text-fail-primary-black` | `text/error-primary` |
| `text/text-infomation-primary-black` | `text/info-primary` |
| `text/text-normal-title-black` | `text/normal-title` |
| `text/text-normal-text-black` | `text/normal-primary` |
| `text/text-normal-text-caption-black` | `text/normal-caption` |
| `text/text-normal-{title,text,text-caption}-white` | `text/normal-inverse` |

`success` and `warning` follow the `theme` rows. The `-black` / `-white` suffixes disappear: the palette collection already flips per mode, so one variable covers both. Text on a filled brand surface is `text/{tone}-onColor`, which is the only alias that differs per mode.

### Semantic — box

| ALD | VarCat |
|-----|--------|
| `box/box-theme-primaryBackground` | `box/theme-primary` |
| `box/box-theme-secondaryBackground` | `box/theme-secondary` |
| `box/box-theme-lightBackground` | `box/theme-soft` |
| `box/box-fail-primaryBackground` | `box/error-primary` |
| `box/box-infomation-lightBackground` | `box/info-soft` |
| `box/box-normal-lightBackground-black` | `box/normal-soft` |
| `box/box-normal-lightBackground-white` | `box/normal-canvas` |
| `box/box-normal-Background-blackOnly` | `box/normal-inverse` |
| `box/box-normal-Background-whiteOnly` | `box/normal-canvas` |
| `normal-background-theme` (root leaf) | `box/normal-primary` |

### Semantic — border

| ALD | VarCat |
|-----|--------|
| `border/border-theme-primary` | `border/theme-primary` |
| `border/border-fail-primary` | `border/error-primary` |
| `border/border-infomation-primary` | `border/info-primary` |
| `border/border-normal-1` | `border/normal-soft` |
| `border/border-normal-2` | `border/normal-tertiary` |
| `border/border-normal-3` | `border/normal-primary` |
| — | `border/{tone}-focus` (new; focus rings were not variables) |

### Semantic — control

| ALD | VarCat |
|-----|--------|
| `control/control-theme-Background` | `control/theme-primary` |
| `control/control-theme-lightBackground` | `control/theme-soft` |
| `control/control-fail-Background` | `control/error-primary` |
| `control/control-normal-Background-whiteOnly` | `control/normal-canvas` |
| `control/control-normal-Background-blackOnly` | `control/normal-inverse` |
| `control/control-normal-lightBackground-1` | `control/normal-soft` |
| `control/control-normal-lightBackground-2` | `control/normal-muted` |
| `control/control-normal-Background-3` | `control/normal-primary` |

All eight rows keep their ALD palette step, so the resolved colors do not move.

### Scale

| ALD | VarCat |
|-----|--------|
| `size/size-tiny\|small\|regular\|middle\|big` | `size/xs\|sm\|md\|lg\|xl` |
| `size/size-semilarge\|semilarger` | `size/xxl` |
| `size/size-large\|huge` | `size/xxxl` |
| `size/size-max` | `size/max` |
| `gap/gap-inside\|inside-space\|component-space` | `gap/xs\|sm\|md` |
| `gap/gap-content-space\|block-space\|chapter-space\|page-space` | `gap/lg\|xl\|xxl\|xxxl` |
| `padding/padding-min\|tiny\|default\|middle` | `padding/xs\|sm\|md\|lg` |
| `padding/padding-big\|large\|max` | `padding/xl\|xxl\|max` |
| `border-radius/border-radius-extra-small 2` | `radius/sm` |
| `border-radius/border-radius-small\|middle\|big\|large` | `radius/md\|lg\|xl\|xxl` |
| `border-radius/border-radius-allround` | `radius/max` |
| `border-thickness/border-thickness-default\|middle\|large` | `thickness/xs\|sm\|md` |
| `line-height/line-height-tiny\|small\|regular\|middle` | `lineHeight/xs\|sm\|md\|lg` |
| `line-height/line-height-big\|semilarge\|large` | `lineHeight/xxl\|xxxl\|max` |
| `transparency/transparency-loading\|disable\|placeholder` | `transparency/loading\|disabled\|placeholder` |
| `font-weight/{light…bold}` | `weight/{light…bold}` |

The ladders collapse to nine steps, so a few ALD rungs have no successor: `padding-tinyer\|smaller\|small\|littleSmall` (3/5/6/7), `size-huger` (34), `line-height-huge\|max` (52/44). Pick the nearest new step when migrating a layer, or add the value to the scale JSON if the rung is load-bearing.

### Effects

| ALD | VarCat |
|-----|--------|
| `special-effort/se-light-effort-top` | `effect/glow-top` |
| `special-effort/se-light-effort-bottom` | `effect/glow-bottom` |
| `special-effort/se-lineShadow-bottom` | `effect/lineShadow-bottom` |
| `special-effort/se-lineShadow-bottomDeep` | `effect/lineShadow-bottomDeep` |
| `special-effort/se-lineShadow-all` | `effect/lineShadow-all` |
| — | `effect/softLight-all` (new) |

The ALD ON/OFF modes become the `effectSwitch` collection; `effect` keeps the same paths and switches by theme instead.

## Repository layout

```
varcat/
├── manifest.json            Figma plugin manifest
├── paradigm/                source of truth, read by the plugin and the tests
│   ├── vocabulary.json      rules, namespaces, closed slot lists, matrices
│   ├── aliases/             semantic → palette alias table
│   ├── matrices/            component whitelist + its semantic aliases
│   ├── scales/              density / contrast / static values
│   └── effects/             effect + effectSwitch literals
├── src/
│   ├── paradigm/            vocabulary loader, pure validator, pure expansion
│   ├── palette/             ramp generation via @aviala-design/color
│   ├── figma/               idempotent collections, path upsert, apply
│   ├── cli/                 headless dry-run
│   ├── ui/                  zero-framework UI (one HTML + one TS file)
│   └── code.ts              plugin entry
├── scripts/                 build, dry-run, paradigm generation
├── tests/                   validator gold/anti examples, expansion snapshot
└── docs/paradigm.md         human-readable paradigm
```

## Adding to the paradigm

1. Edit `paradigm/vocabulary.json` (slot lists, matrices) — never hardcode a name in `src/`.
2. If the change touches semantic aliases or the component whitelist, edit the rule in `scripts/generate-paradigm.mjs` and run `npm run paradigm:generate`; commit the regenerated JSON so the reviewer sees the expanded table.
3. Run `npm test`. The expansion snapshot will show every added or removed path.
4. Update `docs/paradigm.md` and, if it changes a migration, the table above.
