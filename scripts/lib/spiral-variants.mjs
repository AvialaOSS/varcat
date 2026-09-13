/**
 * Extract Spiral appearance axes from a component source file.
 * Appearance = color/intent variants (mode, type, style, …), not size/layout.
 */
export const APPEARANCE_PROP_PRIORITY = [
  'mode',
  'type',
  'style',
  'appearance',
  'variant',
  'tone',
  'status',
  'background'
];

/** Layout / size props — never the Figma variable appearance axis. */
export const NON_APPEARANCE_PROPS = new Set([
  'size',
  'level',
  'allRound',
  'compact',
  'primary',
  'lineHeightFix',
  'content',
  'fullWidth',
  'iconOnly',
  'disabled',
  'loading',
  'orientation',
  'direction',
  'side',
  'align',
  'position',
  'placement',
  'shape'
]);

/** Story displayName → type-name prefixes to accept (Radio stories live in radio-group). */
export const TYPE_PREFIX_ALIASES = {
  /** Longer prefixes first so RadioInputVariant → variant, not input. */
  Radio: ['RadioInput', 'Radio']
};

/** Suffixes that mark an exported string union as an appearance axis. */
const APPEARANCE_TYPE_SUFFIX =
  /(Mode|Style|Appearance|Variant|Type|Tone|Status|Background)$/;

const REJECT_TYPE_SUFFIX = /(Size|Level|Props|Content|Fix|Direction|Layout|Function|Value|Options|Meta)$/;

export const parseStringUnion = (body) => {
  const values = [...body.matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2]);
  return values.length ? values : null;
};

/**
 * Pull `variants: { prop: { value: class, … }, … }` out of a cva() call.
 * Stops before defaultVariants / compoundVariants.
 */
export const extractCvaVariants = (source) => {
  const match = source.match(
    /variants:\s*\{([\s\S]*?)\n\s*\},?\s*\n\s*(defaultVariants|compoundVariants)/
  );
  if (!match) return null;
  const block = match[1];
  const variants = {};
  const propRe = /\n\s{2,8}([A-Za-z][A-Za-z0-9]*)\s*:\s*\{/g;
  const props = [...block.matchAll(propRe)];
  for (let i = 0; i < props.length; i++) {
    const prop = props[i][1];
    const start = props[i].index + props[i][0].length;
    const end = i + 1 < props.length ? props[i + 1].index : block.length;
    const body = block.slice(start, end);
    const values = [...body.matchAll(/^\s{4,12}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map(
      (m) => m[1]
    );
    if (!values.length) continue;
    if (values.every((v) => v === 'true' || v === 'false')) continue;
    variants[prop] = values;
  }
  return Object.keys(variants).length ? variants : null;
};

export const extractExportedUnions = (source) => {
  const out = [];
  for (const match of source.matchAll(/export\s+type\s+(\w+)\s*=\s*([\s\S]*?);/g)) {
    const values = parseStringUnion(match[2]);
    if (!values) continue;
    out.push({ name: match[1], values });
  }
  return out;
};

const propFromTypeName = (typeName, displayName) => {
  const prefixes = TYPE_PREFIX_ALIASES[displayName] ?? [displayName];
  for (const prefix of prefixes) {
    if (!typeName.startsWith(prefix)) continue;
    const rest = typeName.slice(prefix.length);
    if (!rest || REJECT_TYPE_SUFFIX.test(rest)) continue;
    const suffixMatch = rest.match(APPEARANCE_TYPE_SUFFIX);
    if (!suffixMatch) continue;
    // DisplayNameMode → mode; RadioInputVariant → variant
    if (rest === suffixMatch[1]) {
      return suffixMatch[1][0].toLowerCase() + suffixMatch[1].slice(1);
    }
    // Reject nested leftovers like ItemType when prefix already consumed DisplayName
    const before = rest.slice(0, -suffixMatch[1].length);
    if (before.length > 0) continue;
  }
  return null;
};

const scoreType = (typeName, displayName) => {
  const prop = propFromTypeName(typeName, displayName);
  if (!prop) return null;
  // Prefer direct DisplayNameMode over DisplayNameItemType-style leftovers (already filtered)
  let score = 10;
  if (prop === 'mode') score = 100;
  else if (prop === 'style') score = 90;
  else if (prop === 'appearance') score = 80;
  else if (prop === 'variant') score = 70;
  else if (prop === 'type') score = 60;
  else if (prop === 'tone' || prop === 'status') score = 50;
  else if (prop === 'background') score = 40;
  if (typeName.startsWith(displayName)) score += 15;
  return { prop, score };
};

/**
 * Pick one appearance axis for a component.
 * Prefers exported DisplayName* unions, then cva appearance props from the *primary* file only.
 */
export const pickAppearance = (displayName, { cvaVariants, unions }) => {
  const scored = [];
  for (const u of unions) {
    const hit = scoreType(u.name, displayName);
    if (!hit) continue;
    scored.push({ ...hit, values: u.values, via: `type:${u.name}` });
  }
  // Prefer the richer axis (AlertType 5 beats AlertAppearance 2; FeedbackType beats Mode).
  // Tie-break with prop score (ButtonMode alone still wins).
  scored.sort(
    (a, b) => b.values.length - a.values.length || b.score - a.score
  );
  if (scored[0]) {
    return {
      prop: scored[0].prop,
      values: scored[0].values,
      via: scored[0].via
    };
  }

  if (cvaVariants) {
    for (const prop of APPEARANCE_PROP_PRIORITY) {
      if (cvaVariants[prop]?.length) {
        return { prop, values: cvaVariants[prop], via: `cva:${prop}` };
      }
    }
    for (const [prop, values] of Object.entries(cvaVariants)) {
      if (NON_APPEARANCE_PROPS.has(prop)) continue;
      if (!values.length) continue;
      return { prop, values, via: `cva:${prop}` };
    }
  }

  return null;
};
