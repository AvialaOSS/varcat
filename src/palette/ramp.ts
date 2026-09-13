/**
 * Palette ramps for the `palette` collection. Chromatic families go through
 * `@aviala-design/color` with the same options ColorCat and ALD use (8 hue
 * families protected, strength 2, gamma 1), so a VarCat file and a ColorCat file
 * seeded with the same color land on the same hex values.
 */
import { neutral, palette } from '@aviala-design/color';

export type PaletteFamily = 'primary' | 'success' | 'warning' | 'error' | 'info';
export type RampSide = 'light' | 'dark';
export type Ramp = Record<RampSide, string[]>;
export type PaletteRamps = Record<string, Ramp>;

const HUE_FAMILIES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];

export const CHROMATIC_STEPS = 12;
export const NEUTRAL_STEPS = 14;

/** ALD default seeds (spiral tokens `DEFAULT_SEMANTIC_COLORS`). */
export const DEFAULT_SEEDS: Record<PaletteFamily, string> = {
  primary: '#FF5532',
  success: '#33BF24',
  warning: '#FFC130',
  error: '#FF1D4E',
  info: '#37B2FF'
};

/**
 * The neutral ramp shipped in Aviala Design Colors. Kept as literals so a fresh
 * file matches ALD exactly instead of approximating it with a generated gray.
 */
export const ALD_NEUTRAL_RAMP: Ramp = {
  light: [
    '#FFFFFF',
    '#FEFDFD',
    '#F9F8F8',
    '#F0EFEF',
    '#E5E4E3',
    '#D6D5D4',
    '#C4C2C2',
    '#AFADAD',
    '#979696',
    '#7D7C7C',
    '#616060',
    '#444343',
    '#262525',
    '#000000'
  ],
  dark: [
    '#000000',
    '#020202',
    '#090909',
    '#121212',
    '#1A1A1A',
    '#252525',
    '#333333',
    '#444444',
    '#595959',
    '#717272',
    '#8E8E8E',
    '#AFAFAF',
    '#D5D5D5',
    '#FFFFFF'
  ]
};

const toUpperHex = (value: string) => {
  const hex = String(value).trim().replace(/^#/, '');
  const expanded =
    hex.length === 3 ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : hex;
  return `#${expanded.toUpperCase()}`;
};

const generateSide = (seed: string, dark: boolean): string[] => {
  const options = {
    list: true,
    steps: CHROMATIC_STEPS,
    curveGamma: 1,
    protectHueFamilies: HUE_FAMILIES,
    protectHueStrength: 2,
    ...(dark ? { dark: true } : {})
  };
  const colors = (palette as any).generate(seed, options) as string[];
  return colors.map(toUpperHex);
};

export type RampOptions = {
  seeds?: Partial<Record<PaletteFamily, string>>;
  /** Generate the neutral ramp from two grays instead of using the ALD literals. */
  neutralRange?: { start: string; end: string };
};

export const buildChromaticRamp = (seed: string): Ramp => ({
  light: generateSide(seed, false),
  dark: generateSide(seed, true)
});

export const buildNeutralRamp = (range?: { start: string; end: string }): Ramp => {
  if (!range) return ALD_NEUTRAL_RAMP;
  const options = { steps: NEUTRAL_STEPS, curveGamma: 1, format: 'hex' } as any;
  return {
    light: ((neutral as any).generate(range.start, range.end, options) as string[]).map(toUpperHex),
    dark: ((neutral as any).generate(range.end, range.start, options) as string[]).map(toUpperHex)
  };
};

export const buildPaletteRamps = (options: RampOptions = {}): PaletteRamps => {
  const seeds = { ...DEFAULT_SEEDS, ...(options.seeds ?? {}) };
  const ramps: PaletteRamps = {};
  for (const family of Object.keys(seeds) as PaletteFamily[]) {
    ramps[family] = buildChromaticRamp(seeds[family]);
  }
  ramps.neutral = buildNeutralRamp(options.neutralRange);
  return ramps;
};
