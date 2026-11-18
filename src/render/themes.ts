/**
 * Level-reactive and piece-color-reactive visual themes inspired by
 * Tetris Effect and Classic Mobile Tetris.
 */

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface VisualTheme {
  readonly id: string;
  readonly name: string;
  readonly levelRangeLabel: string;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly skyTop: RGB;
  readonly skyMid: RGB;
  readonly skyHorizon: RGB;
  readonly groundVoid: RGB;
  readonly gridPrimary: RGB;
  readonly gridSecondary: RGB;
  readonly nebulaPrimary: RGB;
  readonly nebulaSecondary: RGB;
  readonly starTint: RGB;
  readonly accent: RGB;
  readonly boardGlow: RGB;
  readonly prismaticShift: number;
}

export const PIECE_PALETTE: Readonly<Record<string, string>> = {
  I: '#00E5FF',
  O: '#FFD500',
  T: '#B84DFF',
  S: '#2EE86C',
  Z: '#FF3B5C',
  J: '#2F7BFF',
  L: '#FF8C1A',
};

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function hexToRgb(hex: string): RGB {
  const cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  } else if (cleaned.length >= 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  }
  return { r: 0, g: 229, b: 255 };
}

export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function rgba(rgb: RGB, alpha: number): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
  const a = clamp01(alpha);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

export function mixRgb(base: RGB, tint: RGB, amount: number): RGB {
  return lerpRgb(base, tint, amount);
}

export function lightenRgb(rgb: RGB, amount: number): RGB {
  return lerpRgb(rgb, { r: 255, g: 255, b: 255 }, amount);
}

export function darkenRgb(rgb: RGB, amount: number): RGB {
  return lerpRgb(rgb, { r: 0, g: 0, b: 0 }, amount);
}

/**
 * Converts HSL (h in [0, 360), s in [0, 1], l in [0, 1]) into RGB [0..255].
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}

export const LEVEL_THEMES: readonly VisualTheme[] = [
  {
    id: 'cosmic-gold',
    name: 'Deep Gold Cosmos',
    levelRangeLabel: 'LVL 1–3',
    minLevel: 1,
    maxLevel: 3,
    skyTop: hexToRgb('#050614'),
    skyMid: hexToRgb('#0D1130'),
    skyHorizon: hexToRgb('#1A1A48'),
    groundVoid: hexToRgb('#060717'),
    gridPrimary: hexToRgb('#F6C453'),
    gridSecondary: hexToRgb('#7F68FF'),
    nebulaPrimary: hexToRgb('#FFBE4D'),
    nebulaSecondary: hexToRgb('#6E56FF'),
    starTint: hexToRgb('#FFF3D6'),
    accent: hexToRgb('#FFD166'),
    boardGlow: hexToRgb('#E8B647'),
    prismaticShift: 0,
  },
  {
    id: 'cyan-electric',
    name: 'Cyan Electric Grid',
    levelRangeLabel: 'LVL 4–6',
    minLevel: 4,
    maxLevel: 6,
    skyTop: hexToRgb('#030A18'),
    skyMid: hexToRgb('#071B36'),
    skyHorizon: hexToRgb('#0D3058'),
    groundVoid: hexToRgb('#040C1B'),
    gridPrimary: hexToRgb('#00E5FF'),
    gridSecondary: hexToRgb('#2F7BFF'),
    nebulaPrimary: hexToRgb('#00D8FF'),
    nebulaSecondary: hexToRgb('#2B6CFF'),
    starTint: hexToRgb('#D6F8FF'),
    accent: hexToRgb('#00E5FF'),
    boardGlow: hexToRgb('#1EC8FF'),
    prismaticShift: 0,
  },
  {
    id: 'emerald-aurora',
    name: 'Emerald & Violet Aurora',
    levelRangeLabel: 'LVL 7–9',
    minLevel: 7,
    maxLevel: 9,
    skyTop: hexToRgb('#041016'),
    skyMid: hexToRgb('#0A1E2C'),
    skyHorizon: hexToRgb('#1B1646'),
    groundVoid: hexToRgb('#050D17'),
    gridPrimary: hexToRgb('#2EE88D'),
    gridSecondary: hexToRgb('#B84DFF'),
    nebulaPrimary: hexToRgb('#24E695'),
    nebulaSecondary: hexToRgb('#A94DFF'),
    starTint: hexToRgb('#DBFFF0'),
    accent: hexToRgb('#2EE88D'),
    boardGlow: hexToRgb('#5AE8B5'),
    prismaticShift: 0,
  },
  {
    id: 'solar-crimson',
    name: 'Solar Amber & Crimson',
    levelRangeLabel: 'LVL 10–12',
    minLevel: 10,
    maxLevel: 12,
    skyTop: hexToRgb('#13060E'),
    skyMid: hexToRgb('#240B1A'),
    skyHorizon: hexToRgb('#3D1226'),
    groundVoid: hexToRgb('#11050B'),
    gridPrimary: hexToRgb('#FF9C2A'),
    gridSecondary: hexToRgb('#FF3B5C'),
    nebulaPrimary: hexToRgb('#FF8C1A'),
    nebulaSecondary: hexToRgb('#FF2E63'),
    starTint: hexToRgb('#FFE2D1'),
    accent: hexToRgb('#FF9E2C'),
    boardGlow: hexToRgb('#FF6847'),
    prismaticShift: 0,
  },
  {
    id: 'prismatic-supernova',
    name: 'Prismatic Supernova',
    levelRangeLabel: 'LVL 13+',
    minLevel: 13,
    maxLevel: Number.POSITIVE_INFINITY,
    skyTop: hexToRgb('#090418'),
    skyMid: hexToRgb('#160B36'),
    skyHorizon: hexToRgb('#2A1356'),
    groundVoid: hexToRgb('#080415'),
    gridPrimary: hexToRgb('#FF54D8'),
    gridSecondary: hexToRgb('#3CF2FF'),
    nebulaPrimary: hexToRgb('#E04DFF'),
    nebulaSecondary: hexToRgb('#3CE8FF'),
    starTint: hexToRgb('#F6E8FF'),
    accent: hexToRgb('#FF6BE8'),
    boardGlow: hexToRgb('#C86DFF'),
    prismaticShift: 1,
  },
];

export function getThemeForLevel(level: number): VisualTheme {
  const safeLevel = Math.max(1, Math.floor(level));
  for (const theme of LEVEL_THEMES) {
    if (safeLevel >= theme.minLevel && safeLevel <= theme.maxLevel) {
      return theme;
    }
  }
  return LEVEL_THEMES[LEVEL_THEMES.length - 1];
}

export function interpolateThemes(
  from: VisualTheme,
  to: VisualTheme,
  t: number
): VisualTheme {
  const k = clamp01(t);
  return {
    id: k < 0.5 ? from.id : to.id,
    name: k < 0.5 ? from.name : to.name,
    levelRangeLabel: k < 0.5 ? from.levelRangeLabel : to.levelRangeLabel,
    minLevel: k < 0.5 ? from.minLevel : to.minLevel,
    maxLevel: k < 0.5 ? from.maxLevel : to.maxLevel,
    skyTop: lerpRgb(from.skyTop, to.skyTop, k),
    skyMid: lerpRgb(from.skyMid, to.skyMid, k),
    skyHorizon: lerpRgb(from.skyHorizon, to.skyHorizon, k),
    groundVoid: lerpRgb(from.groundVoid, to.groundVoid, k),
    gridPrimary: lerpRgb(from.gridPrimary, to.gridPrimary, k),
    gridSecondary: lerpRgb(from.gridSecondary, to.gridSecondary, k),
    nebulaPrimary: lerpRgb(from.nebulaPrimary, to.nebulaPrimary, k),
    nebulaSecondary: lerpRgb(from.nebulaSecondary, to.nebulaSecondary, k),
    starTint: lerpRgb(from.starTint, to.starTint, k),
    accent: lerpRgb(from.accent, to.accent, k),
    boardGlow: lerpRgb(from.boardGlow, to.boardGlow, k),
    prismaticShift: lerp(from.prismaticShift, to.prismaticShift, k),
  };
}

/**
 * Applies gentle prismatic hue cycling for Level 13+ (or blended transitions into it).
 */
export function applyPrismaticModulation(
  theme: VisualTheme,
  timeSec: number
): VisualTheme {
  if (theme.prismaticShift <= 0.01) {
    return theme;
  }

  const amount = theme.prismaticShift * 0.58;
  const hueA = (timeSec * 22) % 360;
  const hueB = (hueA + 135) % 360;
  const prismA = hslToRgb(hueA, 0.92, 0.64);
  const prismB = hslToRgb(hueB, 0.92, 0.62);

  return {
    ...theme,
    gridPrimary: mixRgb(theme.gridPrimary, prismA, amount),
    gridSecondary: mixRgb(theme.gridSecondary, prismB, amount),
    nebulaPrimary: mixRgb(theme.nebulaPrimary, prismA, amount * 0.85),
    nebulaSecondary: mixRgb(theme.nebulaSecondary, prismB, amount * 0.85),
    accent: mixRgb(theme.accent, prismA, amount * 0.8),
    boardGlow: mixRgb(theme.boardGlow, prismA, amount * 0.75),
  };
}
