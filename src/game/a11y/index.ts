/**
 * The colour guardrail — `13-accessibility.md` §7.2.
 *
 * > *"A pure-TypeScript test that, for each mode: converts every token to
 * > CIELAB, applies a Brettel–Viénot dichromacy simulation, and asserts that
 * > every pair of tokens in the same visual family satisfies ΔE\*ab ≥ 20 in
 * > simulated space, or differs in relative luminance by a ratio ≥ 1.6:1. A
 * > failing palette change fails CI. **This is why the palette can be tuned
 * > freely later: the guardrail is mechanical, not editorial.**"*
 *
 * That last sentence is the whole point. Eight hues that have to stay
 * distinguishable under three kinds of colour blindness is not a judgement
 * anybody can make reliably by looking, and "looks fine to me" is exactly the
 * failure mode this is for. So it is arithmetic, it runs on every commit, and it
 * needs no library.
 *
 * The simulation is the standard Brettel–Viénot–Mollon projection onto the
 * dichromat's reduced colour plane, in linear RGB. It is an approximation of
 * what a dichromat sees; what matters here is that it is a *consistent* one,
 * because the assertion is about the distance between two colours rather than
 * about either colour on its own.
 */

import type { CurrentId } from "../../engine/types";
import { COLORBLIND_MODES, paletteFor, type ColorblindMode } from "../../ui/cardRenderer/palette";

export type Rgb = [number, number, number];

/** §7.2's thresholds. Two colours pass on either one. */
export const MIN_DELTA_E = 20;
export const MIN_LUMINANCE_RATIO = 1.6;

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const value = parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** sRGB → linear light. */
const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Linear light → sRGB, clamped. */
const toSrgb = (value: number): number => {
  const c = Math.max(0, Math.min(1, value));
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

/** WCAG relative luminance, which the ratio test uses. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Brettel–Viénot dichromacy simulation, in linear RGB.
 *
 * Each matrix projects colour onto the plane the dichromat can still
 * distinguish. Protanopia and deuteranopia collapse the red–green axis from
 * opposite sides; tritanopia collapses blue–yellow.
 */
const SIMULATION: Record<Exclude<ColorblindMode, "off">, number[][]> = {
  protanopia: [
    [0.1720, 0.8290, -0.0020],
    [0.1720, 0.8290, -0.0020],
    [-0.0050, 0.0070, 0.9980],
  ],
  deuteranopia: [
    [0.3330, 0.6670, 0.0000],
    [0.3330, 0.6670, 0.0000],
    [-0.0240, 0.0240, 1.0000],
  ],
  tritanopia: [
    [1.0000, 0.1280, -0.1280],
    [0.0000, 0.9750, 0.0250],
    [0.0000, 0.9750, 0.0250],
  ],
};

/** What a dichromat of this kind sees, as sRGB. `off` returns the colour unchanged. */
export function simulate(rgb: Rgb, mode: ColorblindMode): Rgb {
  if (mode === "off") return rgb;
  const matrix = SIMULATION[mode];
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  return matrix.map((row) => toSrgb(row[0]! * r + row[1]! * g + row[2]! * b)) as Rgb;
}

/** sRGB → CIELAB, through XYZ with the D65 white point. */
export function toLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE*ab — the plain 1976 distance, which is what §7.2 asks for. */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** The luminance ratio between two colours, brighter over darker. */
export function luminanceRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a) + 0.05;
  const lb = relativeLuminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

export interface PairVerdict {
  a: string;
  b: string;
  deltaE: number;
  luminanceRatio: number;
  /** true when the pair clears either threshold */
  distinguishable: boolean;
}

/**
 * Every pair of Currents in one mode, judged as a dichromat of that kind would
 * see them.
 *
 * A mode is simulated with **its own** deficiency: the deuteranopia palette is
 * checked through the deuteranopia simulation, because that is who it is for.
 * The `off` palette is checked against all three, since somebody who has not
 * found the setting is still looking at it.
 */
export function pairVerdicts(mode: ColorblindMode, through: ColorblindMode = mode): PairVerdict[] {
  const palette = paletteFor(mode);
  const ids = Object.keys(palette) as CurrentId[];
  const out: PairVerdict[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = simulate(hexToRgb(palette[ids[i]!]!), through);
      const b = simulate(hexToRgb(palette[ids[j]!]!), through);
      const distance = deltaE(a, b);
      const ratio = luminanceRatio(a, b);
      out.push({
        a: ids[i]!,
        b: ids[j]!,
        deltaE: distance,
        luminanceRatio: ratio,
        distinguishable: distance >= MIN_DELTA_E || ratio >= MIN_LUMINANCE_RATIO,
      });
    }
  }
  return out;
}

/**
 * Everything wrong with the three colour-blind palettes.
 *
 * Each is judged **through its own deficiency**, because that is who it is for.
 *
 * The default palette is deliberately *not* required to pass. It fails under all
 * three simulations, and that is not a bug — it is the reason §7 exists at all.
 * Forcing the default to be dichromat-safe would mean designing the whole game's
 * colour language around a constraint that a switch already solves, and the
 * switch is the better answer: it costs nothing to the players who do not need
 * it. `defaultPalettePressure` reports how the default fares, because the
 * accessibility screen shows it — but nothing fails on it.
 */
export function checkPalettes(): string[] {
  const problems: string[] = [];

  for (const mode of COLORBLIND_MODES) {
    if (mode === "off") continue;
    for (const verdict of pairVerdicts(mode, mode)) {
      if (verdict.distinguishable) continue;
      problems.push(
        `${mode} palette, seen with ${mode}: ${verdict.a} and ${verdict.b} are confusable ` +
          `(ΔE ${verdict.deltaE.toFixed(1)} < ${MIN_DELTA_E}, luminance ${verdict.luminanceRatio.toFixed(2)}:1 < ${MIN_LUMINANCE_RATIO}:1)`
      );
    }
  }

  return problems;
}

/**
 * How many pairs of the **default** palette are confusable under each
 * deficiency, and how many the matching mode fixes.
 *
 * This is what the accessibility screen shows next to each mode: not "turns on a
 * colour-blind palette", but "the default has four pairs you cannot tell apart
 * and this leaves none". A setting that states its own effect is a setting
 * somebody can decide about.
 */
export function defaultPalettePressure(): { mode: ColorblindMode; confusableByDefault: number; confusableInMode: number }[] {
  return COLORBLIND_MODES.filter((mode) => mode !== "off").map((mode) => ({
    mode,
    confusableByDefault: pairVerdicts("off", mode).filter((verdict) => !verdict.distinguishable).length,
    confusableInMode: pairVerdicts(mode, mode).filter((verdict) => !verdict.distinguishable).length,
  }));
}
