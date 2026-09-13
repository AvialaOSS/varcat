# VarCat

Figma plugin that creates **Spiral-named Figma Variables as empty shells**. You pick templates, tick
the axes you want, review the exact path list, then Apply creates each variable with a path and a
type — and stops. No mode value is written, because the value is yours to fill.

Component names, appearance words and part names come from
[Spiral](https://github.com/AvialaOSS/developer-kit), the Aviala Design component library, so a
variable path lines up with a real component prop instead of a generic word list.

**This is not [ColorCat](https://github.com/AvialaOSS/colorcat).** ColorCat generates color ramps and
writes real colors. VarCat owns naming and bulk creation, and by default writes no color at all. If
the plugin window says ColorCat or shows 搜索颜色 / 添加颜色, you imported the wrong manifest.

## Install — the build step is not optional

`dist/` is gitignored, and `manifest.json` points at `dist/code.js`. A fresh clone has no bundle, so
importing the manifest before building is a hard load failure that looks like "the plugin does
nothing".

```bash
npm install
npm run build          # writes dist/code.js + dist/ui.html — REQUIRED
```

Then in Figma **desktop**: **Plugins → Development → Import plugin from manifest…** and pick
`manifest.json` from this folder. `npm run watch` rebuilds on save; re-run the plugin to pick up a
change.

| Script | What it does |
|--------|--------------|
| `npm run build` | Bundles `dist/code.js` + `dist/ui.html` (esbuild) |
| `npm run watch` | Same, in watch mode |
| `npm test` | vitest: validator gold/anti examples, template expansion, unbound apply |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dry-run` | Headless expansion — see [Dry-run without Figma](#dry-run-without-figma) |
| `npm run spiral:catalog` | Regenerates `paradigm/spiral-catalog.json` from a Spiral checkout |
| `npm run paradigm:generate` | Regenerates the derived alias table and the legacy component matrix |

## Using the plugin

Four steps, one screen each, every step returns to the previous one.

1. **Templates** — two sections: the seven foundation layers (`palette`, `semantic`, the three
   scales, the two effect collections) and the 44 Spiral components grouped the way Storybook groups
   them. **Nothing is selected by default**, and Apply stays disabled until something is. Each row
   shows how many variables it would add.
2. **Axes** — for a component template, tick values on the appearance / part / state axes. The count
   updates live (`2 × 2 × 3 = 12`). Above 200 you get a warning, above 500 Apply asks again — the
   full cross product of a rich component runs into the hundreds and is almost never what you want.
   `Select all` / `Clear` / `Reset` are there per template. A template's `extras` — the single-point
   `FLOAT` tokens like `button/disabled-opacity` — are a separate opt-in.
3. **Dry-run** — the complete path list grouped by collection, filterable and copyable, each path
   marked `+` (will be created) or `·` (already exists, left alone). Apply is disabled while the plan
   has a paradigm violation. A collection that needs two modes on a file whose Figma plan allows one
   is called out here, before you write anything.
4. **Apply** — batched, with a progress bar, and it finishes with the list of variables that are now
   empty shells, grouped by collection and ready to copy.

### What "empty shell" actually means

Figma has no null variable value. `VariableValue` is
`boolean | string | number | RGB | RGBA | VariableAlias` — there is no `null` in it, there is no
`removeValueForMode`, and `valuesByMode` is read-only. Once a variable exists, every mode holds
*something*.

So VarCat does the only honest version of "unbound": it creates the variable and never calls
`setValueForMode`. Each mode then holds **Figma's own initial value**, which is:

| Type | Initial value Figma assigns |
|------|-----------------------------|
| `COLOR` | opaque black |
| `FLOAT` | `0` |
| `STRING` | empty string |
| `BOOLEAN` | `false` |

That is a real value, not a blank. To keep an unfilled shell distinguishable from a deliberate black,
each one is marked in two writable places:

- `Variable.description` is stamped `VarCat: 待填 · {template id} · {YYYY-MM}`, so unfilled variables
  are searchable in the Variables panel and countable by **Check the whole file**.
- `hiddenFromPublishing` is set (on by default, one toggle in the UI), so an unfilled shell does not
  reach the team library before it has a value.

VarCat does **not** paint a sentinel color. A magenta placeholder that escapes into a design file is
worse than a black one.

Re-running Apply never overwrites a value you filled in. An existing path is reported as existing and
skipped entirely — its `valuesByMode` and its description are left alone.

### Advanced: the complete paradigm with preset values

The original one-shot generator is still there, in a collapsed section, with nothing checked. It
writes all 757 variables with real values and aliases, and it is the only way to seed the palette
ramps from the five seed colors. It asks for confirmation before writing.

It is also the regression baseline for the expansion snapshot, which is why it is demoted rather than
deleted.

**Check the whole file** (formerly the misnamed "Validate selection") validates every local variable
against the paradigm and reports both violations and how many variables are still marked unfilled.

## Dry-run without Figma

```bash
npm run dry-run -- --template list                              # every selectable template
npm run dry-run -- --template spiral.button --paths             # default axes → 12 paths
npm run dry-run -- --template spiral.button --axes-all --extras # full cross product
npm run dry-run -- --template spiral.button,spiral.tab --json
npm run dry-run -- --namespaces palette,semantic --paths        # the advanced full paradigm
```

## Templates

A template is a slice of the paradigm you opt into. The data lives in
[`paradigm/templates/`](paradigm/templates): a registry plus one file per layer and per component.

```json
{
  "id": "spiral.button",
  "group": "button",
  "shape": "{variant}-{role}-{state}",
  "axes": [
    { "slot": "variant", "values": ["primary", "second", "…", "destructive"], "default": ["primary", "destructive"] },
    { "slot": "role",    "values": ["background", "foreground", "…"],         "default": ["background", "foreground"] },
    { "slot": "state",   "values": ["rest", "hover", "…"],                    "default": ["rest", "hover", "active"] }
  ],
  "exclude": [{ "why": "…", "role": ["gloss"], "state": ["disabled", "loading"] }],
  "extras": [{ "path": "button/disabled-opacity", "valueType": "FLOAT" }]
}
```

Three things to know about the model:

- **The shape belongs to the template, not to the namespace.** The `component` namespace used to hard
  code four leaf slots (`{component}-{level}-{role}-{state}`). Spiral's Button has one appearance axis
  and Spiral's Input has none, so a fixed four slots forced invented words like `filled-primary-…`.
  Templates carry their own shape; two to four slots are all legal.
- **`exclude` is the whitelist inverted.** The old whitelist was 344 hand-written entries in an 84 KB
  file. Axes plus a handful of exclude rules say the same thing in a few dozen lines per component,
  and each rule carries the reason it exists.
- **`extras` is where the non-cross-product tokens go**, and the only place a `FLOAT` appears in a
  component template. A Figma collection is happy to mix types; `resolvedType` is per variable.

### Which components are fully templated

**Hand-curated** (rich roles / exclude / extras), axes taken from Spiral:

`button` (`mode`), `switch` (checked/unchecked), `segmentator` (`mode`), `tab` (`style`),
`badge` (`style`), `tag` (`level`), `alert` (`type`) and `input` (no appearance axis — its cva
variants are layout only).

**Spiral-derived** (auto from `cva` / exported `DisplayNameMode|Style|Type|…` unions via
`npm run spiral:catalog`): every other catalog component that declares an appearance prop — e.g.
`link` (`mode`), `feedback` (`type`), `progress` (`type`), `radio` (`variant`), `popover`
(`appearance`). These land in [`paradigm/templates/from-spiral.json`](paradigm/templates/from-spiral.json)
and `paradigm/templates/component/auto/*.json`. Hand-curated files always win.

**Stubs** remain only when Spiral exposes no appearance axis (size/layout-only components such as
`colorPicker`, `timePicker`, `cascader`). They keep generic `role` × `state` words so a stub never
invents an appearance word Spiral does not use. Promote one by adding a curated JSON (or by adding
a real appearance prop upstream in developer-kit and re-running the catalog sync).

### Naming, in one example

Spiral's private CSS custom properties are the naming reference — **not** the value source. VarCat
never reads a color out of `@aviala-design/tokens`; the source of truth for a value is Figma.

| Spiral CSS variable | VarCat path | Type |
|---|---|---|
| `--button-primary-bg-hover` | `button/primary-background-hover` | `COLOR` |
| `--button-outline-border` | `button/outline-border-rest` | `COLOR` |
| `--button-disabled-opacity` | `button/disabled-opacity` *(extras)* | `FLOAT` |
| `--switch-thumb-bg` | `switch/checked-thumb-background-rest` | `COLOR` |
| `--tab-indicator-height` | `tab/indicator-height` *(extras)* | `FLOAT` |

## The Spiral catalog

[`paradigm/spiral-catalog.json`](paradigm/spiral-catalog.json) is derived, never hand-written:

```bash
# clone AvialaOSS/developer-kit (or spiral-2 with the same packages/ui layout), then:
npm run spiral:catalog -- --spiral /path/to/developer-kit
# or: set SPIRAL_ROOT=/path/to/developer-kit && npm run spiral:catalog
npm run spiral:catalog:check          # non-zero exit if catalog / from-spiral.json are stale
```

The script reads:

1. Storybook `title: "{group}/{Component}"` in `packages/ui/src/components/*.stories.tsx` for the
   design-side grouping (`Foundation/Icons` dropped).
2. Semantic effect CSS for each component's private property inventory.
3. **Appearance axes** from each component's primary `.tsx`: `cva({ variants })` keys
   (`mode` / `type` / `style` / …) and exported unions (`ButtonMode`, `AlertType`, `LinkMode`, …).

44 components across 6 groups. It is a **manifest only**: no color value is ever synced. The
developer-kit commit SHA is recorded as `spiralCommit`. Auto templates are written to
`paradigm/templates/from-spiral.json` (and review copies under `component/auto/`).

The component slug is the display name with a lowercase first letter (`NumberInput` → `numberInput`),
which satisfies the camelCase slot rule for free.

### Retired component types

Five type words VarCat used to accept do not exist in Spiral. The validator reports them and suggests
the replacement; it never renames anything, because renaming a variable breaks the bindings a
designer already made.

| Retired | Spiral |
|---|---|
| `dialog` | `modal` |
| `menu` | `navigation` |
| `toast` | `feedback` |
| `divider` | — |
| `icon` | — (a foundation) |

### `manifest.json` keeps its id

The plugin id is still `varcat-aviala-design`. Changing it makes Figma treat this as a brand new
plugin: every already-imported development copy stops resolving. The visible name and copy are
Spiral's; the id is a stable identifier and is left alone deliberately.

## Paradigm in one screen

Full rules and vocabulary: [`docs/paradigm.md`](docs/paradigm.md).

| Collection | Path shape | Value | Modes | Count in the full run |
|------------|------------|-------|-------|-------|
| `palette` | `{family}/{step}` | literal `COLOR` | `light` / `dark` | 74 |
| `semantic` | `{use}/{tone}-{slot}` | alias → `palette` | `light` / `dark` | 150 |
| `scaleStatic` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `scaleDensity` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `scaleContrast` | `{category}/{step}` | literal `FLOAT` | `default` | 59 |
| `component` | template-owned, e.g. `button/{variant}-{role}-{state}` | unbound (template flow) or alias → `semantic` (advanced) | `light` / `dark` | 344 |
| `effect` | `effect/{name}-{position}` | literal `COLOR` | `light` / `dark` | 6 |
| `effectSwitch` | `effect/{name}-{position}` | literal `COLOR` | `on` / `off` | 6 |

Naming rules: charset `a-zA-Z0-9-`; every segment and slot starts with a lowercase letter and stays
camelCase inside; a group is mandatory; the leaf never repeats the full group name; singular only;
`-` separates slots only; every slot draws from a closed list — for a component template, that closed
list is the template's own axes.

### Figma mode limits

Five of the eight collections want two modes. On a Figma plan capped at one variable mode per
collection the second mode cannot be created at all. In the template flow this is easy to miss —
nothing has values, so a missing `dark` half looks like everything else. VarCat checks the budget in
the dry-run and reports every refused mode in the Apply summary.

## Migrating from the legacy Aviala Design collections

Historical reference. The old collections (`Aviala Design Colors`, `token-colors`, `base-numbers`,
`font-weight`, `special-effort`, `base-variable`) are **never read and never touched** — VarCat only
ever writes the eight lowercase collection names above. The full old-name → new-name key lives in
[`docs/paradigm.md`](docs/paradigm.md#legacy-name-mapping).

## Repository layout

```
varcat/
├── manifest.json            Figma plugin manifest
├── paradigm/                source of truth, read by the plugin and the tests
│   ├── vocabulary.json      rules, namespaces, closed slot lists, matrices, retired types
│   ├── spiral-catalog.json  derived from developer-kit; manifest only, no values
│   ├── templates/           registry + one file per layer and per component
│   ├── aliases/             semantic → palette alias table (advanced flow)
│   ├── matrices/            legacy component whitelist (advanced flow)
│   ├── scales/              density / contrast / static values
│   └── effects/             effect + effectSwitch literals
├── src/
│   ├── paradigm/            vocabulary loader, pure validator, pure expansion, templates
│   ├── palette/             ramp generation via @aviala-design/color
│   ├── figma/               idempotent collections, path upsert, apply
│   ├── cli/                 headless dry-run
│   ├── ui/                  zero-framework UI (one HTML + one TS file)
│   └── code.ts              plugin entry
├── scripts/                 build, dry-run, paradigm generation, Spiral catalog sync
├── tests/                   validator examples, template expansion, unbound apply
└── docs/paradigm.md         human-readable paradigm
```

## Adding to the paradigm

1. **A component template** — add `paradigm/templates/component/{slug}.json`, register it in
   `paradigm/templates/index.json`, and add the static import in `src/paradigm/templates.ts` (esbuild
   bundles the JSON, so a glob is not an option). Take the appearance values from the component's
   real `cva` variant map in Spiral, not from a generic word list. Never hardcode a name in `src/`.
2. **A slot or a matrix rule** — edit `paradigm/vocabulary.json`.
3. **A semantic alias or the legacy component whitelist** — edit the rule in
   `scripts/generate-paradigm.mjs`, run `npm run paradigm:generate`, and commit the regenerated JSON
   so the reviewer sees the expanded table.
4. Run `npm test`. Two snapshots will show every added or removed path.
5. Update `docs/paradigm.md`, and this file if it changes the flow.
