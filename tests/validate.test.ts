import { describe, expect, it } from 'vitest';
import {
  detectNamespace,
  normalizeVariablePath,
  validateInNamespace,
  validateVariablePath,
  validateVariablePaths
} from '../src/paradigm/validate';

/** Gold examples: one per namespace, all of them must validate clean. */
const GOLD: Array<[string, string]> = [
  ['palette', 'primary/s1'],
  ['palette', 'primary/s12'],
  ['palette', 'neutral/s14'],
  ['semantic', 'text/theme-primary'],
  ['semantic', 'text/normal-caption'],
  ['semantic', 'text/error-onColor'],
  ['semantic', 'box/error-soft'],
  ['semantic', 'border/normal-focus'],
  ['semantic', 'control/info-canvas'],
  ['scaleStatic', 'size/md'],
  ['scaleDensity', 'lineHeight/xxxl'],
  ['scaleContrast', 'weight/semibold'],
  ['scaleStatic', 'transparency/loading'],
  ['scaleStatic', 'thickness/lg'],
  ['component', 'button/filled-primary-background-rest'],
  ['component', 'input/outlined-danger-border-focus'],
  ['component', 'checkbox/filled-primary-icon-checked'],
  ['component', 'link/text-primary-foreground-hover'],
  ['effect', 'effect/glow-top'],
  ['effect', 'effect/lineShadow-bottomDeep'],
  ['effectSwitch', 'effect/softLight-all']
];

/** Anti examples: each one must be rejected, with the listed rule firing. */
const ANTI: Array<{ path: string; namespace?: string; code: string; why: string }> = [
  { path: 'primary/8', code: 'slotCase', why: 'numeric step must be written s8' },
  { path: 'primary/S8', code: 'slotCase', why: 'slots start with a lowercase letter' },
  { path: 'primary/s15', code: 'unknownSlotValue', why: 'no ramp goes past s14' },
  { path: 'primary/s13', namespace: 'palette', code: 'matrixViolation', why: 'chromatic ramps stop at s12' },
  { path: 'text/theme_primary', code: 'illegalChar', why: 'underscore is outside the charset' },
  { path: 'text/theme primary', code: 'illegalChar', why: 'space is outside the charset' },
  { path: 'text/theme.primary', code: 'illegalChar', why: 'dot is outside the charset' },
  { path: 'primary', code: 'missingGroup', why: 'a group is mandatory' },
  {
    path: 'text/theme-primary/black',
    namespace: 'semantic',
    code: 'tooManySegments',
    why: 'exactly one group level'
  },
  {
    path: 'border/border-error-primary',
    namespace: 'semantic',
    code: 'groupEcho',
    why: 'the old ALD leaf repeats the whole group'
  },
  { path: 'effect/effect-top', namespace: 'effect', code: 'groupEcho', why: 'leaf repeats the group' },
  {
    path: 'button/button-filled-primary-background-rest',
    namespace: 'component',
    code: 'groupEcho',
    why: 'leaf repeats the group'
  },
  {
    path: 'buttons/filled-primary-background-rest',
    namespace: 'component',
    code: 'pluralSlot',
    why: 'the paradigm is singular'
  },
  {
    path: 'box/theme-light-background',
    namespace: 'semantic',
    code: 'slotCount',
    why: '- may only separate slots; lightBackground is one camelCase slot'
  },
  { path: 'text/theme-focus', namespace: 'semantic', code: 'matrixViolation', why: 'focus is a border slot' },
  { path: 'box/theme-title', namespace: 'semantic', code: 'matrixViolation', why: 'title is a text slot' },
  { path: 'control/theme-secondary', namespace: 'semantic', code: 'matrixViolation', why: 'control has no secondary' },
  { path: 'size/gigantic', namespace: 'scaleStatic', code: 'unknownSlotValue', why: 'gigantic is in no slot vocabulary' },
  {
    path: 'size/medium',
    namespace: 'scaleStatic',
    code: 'matrixViolation',
    why: 'medium belongs to weight, not to size'
  },
  { path: 'transparency/md', namespace: 'scaleStatic', code: 'matrixViolation', why: 'transparency has its own steps' },
  { path: 'weight/xl', namespace: 'scaleStatic', code: 'matrixViolation', why: 'weight has its own steps' },
  {
    path: 'button/filled-primary-background-selected',
    namespace: 'component',
    code: 'notWhitelisted',
    why: 'legal vocabulary, but no recipe in the component matrix'
  },
  {
    path: 'avatar/filled-primary-background-rest',
    namespace: 'component',
    code: 'notWhitelisted',
    why: 'avatar vocabulary is reserved but not generated'
  },
  { path: 'effect/glow-bottomDeep', namespace: 'effect', code: 'matrixViolation', why: 'glow has no bottomDeep' },
  { path: 'nope/whatever', code: 'unknownNamespace', why: 'no namespace owns this group' }
];

describe('normalizeVariablePath', () => {
  it('collapses separators and trims segments without rewriting slots', () => {
    expect(normalizeVariablePath(' text / theme-primary ')).toBe('text/theme-primary');
    expect(normalizeVariablePath('text//theme-primary')).toBe('text/theme-primary');
    expect(normalizeVariablePath('text\\theme-primary')).toBe('text/theme-primary');
  });
});

describe('gold examples', () => {
  it.each(GOLD)('%s accepts %s', (namespace, path) => {
    const result = validateInNamespace(path, namespace as any);
    expect(result.issues, `${path}: ${JSON.stringify(result.issues)}`).toEqual([]);
    expect(result.valid).toBe(true);
  });

  /**
   * The three scale collections and the two effect collections are the same
   * shape on purpose, so detection can only name the group they belong to.
   */
  const DETECTION_GROUP: Record<string, string> = {
    scaleStatic: 'scaleDensity',
    scaleDensity: 'scaleDensity',
    scaleContrast: 'scaleDensity',
    effectSwitch: 'effect'
  };

  it.each(GOLD)('%s is detected from the path %s', (namespace, path) => {
    expect(detectNamespace(path)).toBe(DETECTION_GROUP[namespace] ?? namespace);
  });
});

describe('anti examples', () => {
  it.each(ANTI.map((entry) => [entry.path, entry.code, entry.why, entry.namespace] as const))(
    'rejects %s with %s (%s)',
    (path, code, _why, namespace) => {
      const result = namespace
        ? validateInNamespace(path, namespace as any)
        : validateVariablePath(path);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(code);
    }
  );
});

describe('batch report', () => {
  it('splits legal paths from violations', () => {
    const report = validateVariablePaths([
      'primary/s8',
      { path: 'text/theme-primary', namespace: 'semantic' },
      'border/border-error-primary'
    ]);
    expect(report.total).toBe(3);
    expect(report.validCount).toBe(2);
    expect(report.invalidCount).toBe(1);
    expect(report.violations[0].path).toBe('border/border-error-primary');
  });
});

describe('scale namespaces share one shape', () => {
  it('accepts the same key in all three collections', () => {
    for (const key of ['scaleStatic', 'scaleDensity', 'scaleContrast'] as const) {
      expect(validateInNamespace('padding/lg', key).valid).toBe(true);
    }
  });
});
