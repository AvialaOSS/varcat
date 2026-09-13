import { describe, expect, it } from 'vitest';
import { expandNamespace, expandPlan, inventory, parseAliasRef } from '../src/paradigm/expand';
import { validateInNamespace } from '../src/paradigm/validate';
import { buildPaletteRamps } from '../src/palette/ramp';
import { componentMatrix, getNamespace, semanticAliases } from '../src/paradigm/vocabulary';

const plan = expandPlan({ palette: buildPaletteRamps() });

describe('plan', () => {
  it('expands every namespace without a paradigm violation', () => {
    expect(plan.invalid).toEqual([]);
  });

  it('has the expected per-namespace counts', () => {
    expect(plan.counts).toEqual({
      palette: 74,
      semantic: 150,
      scaleDensity: 59,
      scaleContrast: 59,
      scaleStatic: 59,
      component: 344,
      effect: 6,
      effectSwitch: 6
    });
    expect(plan.total).toBe(757);
  });

  it('keeps every path unique inside its collection', () => {
    const seen = new Set<string>();
    for (const entry of plan.entries) {
      const key = `${entry.collection}/${entry.path}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('is the inventory the dry-run CLI prints', () => {
    expect(inventory(plan)).toMatchSnapshot();
  });
});

describe('palette', () => {
  it('writes literal hex for both modes, 12 chromatic steps and 14 neutral steps', () => {
    const entries = expandNamespace('palette', { palette: buildPaletteRamps() });
    const chromatic = entries.filter((entry) => entry.path.startsWith('primary/'));
    const neutral = entries.filter((entry) => entry.path.startsWith('neutral/'));
    expect(chromatic).toHaveLength(12);
    expect(neutral).toHaveLength(14);
    for (const entry of entries) {
      expect(entry.kind).toBe('literal');
      expect(entry.values?.light).toMatch(/^#[0-9A-F]{6}$/);
      expect(entry.values?.dark).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('keeps the ALD neutral ramp verbatim', () => {
    const entries = expandNamespace('palette', { palette: buildPaletteRamps() });
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    expect(byPath.get('neutral/s1')?.values?.light).toBe('#FFFFFF');
    expect(byPath.get('neutral/s12')?.values?.light).toBe('#444343');
    expect(byPath.get('neutral/s14')?.values?.light).toBe('#000000');
    expect(byPath.get('neutral/s1')?.values?.dark).toBe('#000000');
  });

  it('seeds the primary ramp from the seed color', () => {
    const entries = expandNamespace('palette', {
      palette: buildPaletteRamps({ seeds: { primary: '#0066FF' } })
    });
    const step8 = entries.find((entry) => entry.path === 'primary/s8');
    expect(step8?.values?.light).toBe('#0066FF');
  });
});

describe('semantic aliases', () => {
  it('targets a legal palette path for every mode', () => {
    for (const entry of expandNamespace('semantic')) {
      expect(entry.kind).toBe('alias');
      for (const mode of getNamespace('semantic').modes) {
        const ref = entry.aliases?.[mode];
        expect(ref, `${entry.path} has no ${mode} alias`).toBeTruthy();
        expect(ref?.namespace).toBe('palette');
        expect(validateInNamespace(ref!.path, 'palette').valid, `${entry.path} → ${ref?.path}`).toBe(
          true
        );
      }
    }
  });

  it('corrects the old ALD tone spellings', () => {
    const paths = Object.keys(semanticAliases.aliases);
    expect(paths).toContain('border/error-primary');
    expect(paths).toContain('text/info-primary');
    expect(paths.filter((path) => /fail|infomation/.test(path))).toEqual([]);
  });

  it('flips onColor per mode so it stays near-white in both themes', () => {
    const onColor = semanticAliases.aliases['text/theme-onColor'];
    expect(onColor).toEqual({ light: 'palette/neutral/s1', dark: 'palette/neutral/s14' });
  });

  it('keeps the ALD semantic step map for the primary slots', () => {
    expect(semanticAliases.aliases['border/theme-primary'].light).toBe('palette/primary/s8');
    expect(semanticAliases.aliases['control/theme-primary'].light).toBe('palette/primary/s8');
    expect(semanticAliases.aliases['text/theme-primary'].light).toBe('palette/primary/s10');
    expect(semanticAliases.aliases['text/theme-secondary'].light).toBe('palette/primary/s7');
    expect(semanticAliases.aliases['box/theme-secondary'].light).toBe('palette/primary/s4');
    expect(semanticAliases.aliases['box/theme-soft'].light).toBe('palette/primary/s2');
  });

  it('keeps ALD parity for the control and neutral border surfaces', () => {
    // control-theme-Background / control-theme-lightBackground
    expect(semanticAliases.aliases['control/theme-primary'].light).toBe('palette/primary/s8');
    expect(semanticAliases.aliases['control/theme-soft'].light).toBe('palette/primary/s4');
    // control-normal-lightBackground-1|2 and control-normal-Background-3
    expect(semanticAliases.aliases['control/normal-soft'].light).toBe('palette/neutral/s3');
    expect(semanticAliases.aliases['control/normal-muted'].light).toBe('palette/neutral/s4');
    expect(semanticAliases.aliases['control/normal-primary'].light).toBe('palette/neutral/s6');
    // border-normal-1|2|3
    expect(semanticAliases.aliases['border/normal-soft'].light).toBe('palette/neutral/s3');
    expect(semanticAliases.aliases['border/normal-tertiary'].light).toBe('palette/neutral/s4');
    expect(semanticAliases.aliases['border/normal-primary'].light).toBe('palette/neutral/s6');
  });
});

describe('component matrix', () => {
  it('aliases every whitelisted entry to a semantic path that exists', () => {
    const semanticPaths = new Set(Object.keys(semanticAliases.aliases));
    for (const entry of componentMatrix.entries) {
      const ref = parseAliasRef(entry.alias);
      expect(ref.namespace).toBe('semantic');
      expect(semanticPaths.has(ref.path), `${entry.path} → ${entry.alias}`).toBe(true);
    }
  });

  it('only covers the types that have recipes', () => {
    expect(componentMatrix.types.sort()).toEqual([
      'button',
      'checkbox',
      'input',
      'link',
      'switch',
      'tag'
    ]);
  });

  it('puts the label on a filled surface through the onColor slot', () => {
    const entry = componentMatrix.entries.find(
      (candidate) => candidate.path === 'button/filled-primary-foreground-rest'
    );
    expect(entry?.alias).toBe('semantic/text/theme-onColor');
  });
});

describe('scales', () => {
  it('shares one key set across the three collections', () => {
    const keys = (key: 'scaleStatic' | 'scaleDensity' | 'scaleContrast') =>
      expandNamespace(key)
        .map((entry) => entry.path)
        .sort();
    expect(keys('scaleDensity')).toEqual(keys('scaleStatic'));
    expect(keys('scaleContrast')).toEqual(keys('scaleStatic'));
  });

  it('writes a single default mode with numeric literals', () => {
    for (const entry of expandNamespace('scaleStatic')) {
      expect(Object.keys(entry.values ?? {})).toEqual(['default']);
      expect(typeof entry.values?.default).toBe('number');
    }
  });

  it('differs in value where the density and contrast intent differs', () => {
    const value = (key: 'scaleStatic' | 'scaleDensity' | 'scaleContrast', path: string) =>
      expandNamespace(key).find((entry) => entry.path === path)?.values?.default;
    expect(value('scaleStatic', 'size/md')).toBe(14);
    expect(value('scaleDensity', 'size/md')).toBe(18);
    expect(value('scaleContrast', 'thickness/md')).toBe(4);
    expect(value('scaleStatic', 'thickness/md')).toBe(3);
  });
});

describe('effects', () => {
  it('writes only the enabled whitelist by default', () => {
    expect(expandNamespace('effect').map((entry) => entry.path)).toEqual([
      'effect/glow-top',
      'effect/glow-bottom',
      'effect/lineShadow-bottom',
      'effect/lineShadow-bottomDeep',
      'effect/lineShadow-all',
      'effect/softLight-all'
    ]);
  });

  it('expands every legal name/position pair on request', () => {
    const paths = expandNamespace('effect', { allEffects: true }).map((entry) => entry.path);
    expect(paths).toHaveLength(16);
    expect(paths).toContain('effect/rim-all');
    expect(paths).not.toContain('effect/glow-bottomDeep');
  });

  it('switches the same paths by on/off mode', () => {
    for (const entry of expandNamespace('effectSwitch')) {
      expect(Object.keys(entry.values ?? {})).toEqual(['on', 'off']);
      expect(entry.values?.off).toMatch(/00$/);
    }
  });

  it('carries the ALD special-effort literals into the light mode', () => {
    const byPath = new Map(expandNamespace('effect').map((entry) => [entry.path, entry]));
    expect(byPath.get('effect/glow-top')?.values?.light).toBe('#FFD9CFFF');
    expect(byPath.get('effect/lineShadow-bottom')?.values?.light).toBe('#0000000A');
  });
});

describe('parseAliasRef', () => {
  it('splits a namespace-qualified reference', () => {
    expect(parseAliasRef('palette/neutral/s1')).toEqual({ namespace: 'palette', path: 'neutral/s1' });
  });

  it('rejects a reference without a namespace', () => {
    expect(() => parseAliasRef('neutral/s1')).toThrow();
  });
});
