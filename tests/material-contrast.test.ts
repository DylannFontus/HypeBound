/**
 * The ink and the plate are one decision, and the setting that exists to help
 * has to help.
 *
 * `.mat-hero` — the material the contract reserves for PLAY, confirm and claim,
 * the loudest control on every screen — shipped `color: #fff` on a light violet
 * plate and measured **2.71:1** by pipette. The disabled copy of the same button
 * beside it measured 12.10:1, so the label a player could not press was four and
 * a half times more legible than the one they could. And turning on
 * `data-contrast="high"` took it to **2.47:1**, because that rule correctly
 * lightens the hero plate and nothing was checking what the ink on top of it was
 * doing. The one setting whose entire purpose is legibility was making the
 * primary action less legible, and it did that for as long as it existed.
 *
 * None of that is exotic. It is what happens when the plate and the ink are
 * chosen in two different rules by two different people and nothing multiplies
 * them together. So this file multiplies them together: every material, every
 * ink role that lands on it, every stop of its gradient, in the default theme
 * and again under high contrast.
 *
 * ## Three assertions, and the third is the one that cannot be argued with
 *
 * **Absolute floors.** 4.5:1 for body text, 3:1 for large. These are computed
 * from the tokens as authored rather than from a screenshot, which means the
 * model has to be stated honestly:
 *
 *  - a plate's *representative* colour is its gradient evaluated at the middle,
 *    because that is where glyphs sit and it is what the project's own pipette
 *    measurements sampled — `foundation.css` records 4.78:1 for the hardest
 *    pairing in the system and this model returns 4.8 for it;
 *  - every *individual stop* is held to the large-text floor as well, so a plate
 *    that is legal across its face but illegal in one corner is still caught;
 *  - alpha is composited over `--bg-deep`, the page the materials sit on;
 *  - the specular band is folded in at its peak, because a band that lightens a
 *    dark plate under light type is a contrast change and the file tunes
 *    `--text-faint` against exactly that.
 *
 * **The loading veil.** A hero in its loading state turns its ink back over to
 * light and covers the plate with `--load-veil`. That pairing measured 4.05:1
 * and went to 3.54:1 under high contrast, which is the identical failure one
 * state along, so it is modelled here rather than trusted.
 *
 * **High contrast never lowers a ratio.** This is the assertion that does not
 * depend on the model being right. Both numbers are produced by the same
 * arithmetic from the same tokens, so systematic error cancels and what is left
 * is a pure comparison: for every material, every ink, every stop, the
 * high-contrast ratio must be greater than or equal to the default one. That is
 * the rule `foundation.css` §10 states about itself — *"every ratio this setting
 * touches must go up"* — and it is the rule that was broken.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Rgba,
  blocks,
  blocksFor,
  composite,
  contrastRatio,
  customProperties,
  gradientStopList,
  gradientStops,
  parseColour,
  resolveVars,
  sampleGradient,
} from "./helpers/css";

const sheet = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/ui/theme/${name}`, import.meta.url)), "utf8");

const BASE = blocks(sheet("base.css"));
const FOUNDATION = blocks(sheet("foundation.css"));

/**
 * The two token scopes, built the way the browser builds them.
 *
 * `foundation.css` is `@import`ed at the top of `base.css`, so base's `:root`
 * wins a source-order tie — except where foundation deliberately writes
 * `:root:root` to out-specify it, which it does for `--text-faint`. Both are
 * folded in here in that order. High contrast is the default scope with the two
 * `:root[data-contrast="high"]` blocks laid over it.
 */
const DEFAULT_SCOPE: Record<string, string> = customProperties([
  ...blocksFor(FOUNDATION, ":root"),
  ...blocksFor(BASE, ":root"),
  ...blocksFor(FOUNDATION, ":root:root"),
]);

const HIGH_SCOPE: Record<string, string> = {
  ...DEFAULT_SCOPE,
  ...customProperties([
    ...blocksFor(FOUNDATION, ':root[data-contrast="high"]'),
    ...blocksFor(BASE, ':root[data-contrast="high"]'),
  ]),
};

const MODES = { default: DEFAULT_SCOPE, high: HIGH_SCOPE } as const;
type Mode = keyof typeof MODES;

function token(mode: Mode, name: string): string {
  return resolveVars(MODES[mode], `var(${name})`).trim();
}

function colour(mode: Mode, name: string): Rgba {
  const parsed = parseColour(token(mode, name));
  if (parsed === null) throw new Error(`${name} does not resolve to a colour in the ${mode} theme`);
  return parsed;
}

/** The page every material is eventually composited onto. */
const backdrop = (mode: Mode): Rgba => colour(mode, "--bg-deep");

/**
 * The four materials, the knobs `foundation.css` gives each of them, and the ink
 * roles that actually land on each.
 *
 * The hero's ink is a token because on that material the plate and the ink are a
 * single decision; the three dark materials wear `color: var(--text)` from the
 * shared recipe and inherit `.t-body`'s `--text-dim` and `.t-label`'s
 * `--text-faint` from §4. `.mat-well` gets the same three: a well holds field
 * text, placeholders and field notes.
 */
const MATERIALS = [
  { name: "mat-hero", fill: "--fill-hero", sheen: [0.14, 0.28], inks: ["--ink-hero"] },
  { name: "mat-panel", fill: "--fill-panel", sheen: [0.03, 0.06], inks: ["--text", "--text-dim", "--text-faint"] },
  { name: "mat-chip", fill: "--fill-chip", sheen: [0.02, 0.032], inks: ["--text", "--text-dim", "--text-faint"] },
  { name: "mat-well", fill: "--fill-well", sheen: [0.004, 0.012], inks: ["--text", "--text-dim", "--text-faint"] },
] as const;

/** White, at the specular band's peak alpha. */
const band = (alpha: number): Rgba => [255, 255, 255, alpha];

interface Plate {
  readonly label: string;
  readonly colour: Rgba;
}

/**
 * Every colour a material's face takes: each declared stop, and the midpoint
 * between the first and the last — each of them with the band off, at rest and
 * at its hover peak.
 */
function plates(mode: Mode, fill: string, sheen: readonly [number, number]): { middle: Plate[]; stops: Plate[] } {
  const declared = gradientStopList(resolveVars(MODES[mode], `var(${fill})`));
  if (declared.length < 2) throw new Error(`${fill} did not parse as a gradient in the ${mode} theme`);
  /**
   * The middle of the plate is *sampled*, not averaged.
   *
   * `--fill-hero` puts its darkest colour at 48%, so the mean of its two ends is
   * nowhere near the colour under a label. Averaging is also what makes the
   * high-contrast comparison below unsound: the default hero has three stops and
   * the high-contrast one has two, and pairing them by index compares different
   * places on two different plates. Sampling at the same fraction of each
   * gradient compares the same place.
   */
  const middle = sampleGradient(declared, 0.5);
  if (middle === null) throw new Error(`${fill} could not be sampled in the ${mode} theme`);
  const under = backdrop(mode);

  const lit = (raw: Rgba, label: string): Plate[] => {
    const flat = composite(raw, under);
    return [
      { label, colour: flat },
      { label: `${label} + band at rest`, colour: composite(band(sheen[0]), flat) },
      { label: `${label} + band on hover`, colour: composite(band(sheen[1]), flat) },
    ];
  };

  return {
    middle: lit(middle, "mid-plate"),
    stops: declared.flatMap((stop, i) => lit(stop.colour, `stop ${i}`)),
  };
}

/** WCAG's two floors. `.t-display` is the only role in the system that is large text. */
const BODY = 4.5;
const LARGE = 3;

const report = (n: number): string => n.toFixed(2);

describe("every material's ink is legible on its own plate", () => {
  it("resolves the palette in both contrast modes", () => {
    // If the scopes came out empty every assertion below would pass vacuously,
    // which is how a contrast guard becomes decoration.
    for (const mode of ["default", "high"] as const) {
      expect(Object.keys(MODES[mode]).length, `${mode} scope is empty`).toBeGreaterThan(40);
      expect(parseColour(token(mode, "--text")), `--text in ${mode}`).not.toBeNull();
      expect(parseColour(token(mode, "--ink-hero")), `--ink-hero in ${mode}`).not.toBeNull();
    }
    // And the two modes must actually differ, or "high contrast is never worse"
    // is a comparison of a thing with itself.
    expect(token("high", "--fill-hero")).not.toBe(token("default", "--fill-hero"));
  });

  it("holds body ink at 4.5:1 across the middle of every plate, in both modes", () => {
    const failures: string[] = [];
    for (const mode of ["default", "high"] as const) {
      for (const material of MATERIALS) {
        const { middle } = plates(mode, material.fill, material.sheen);
        for (const ink of material.inks) {
          for (const plate of middle) {
            const ratio = contrastRatio(colour(mode, ink), plate.colour);
            if (ratio < BODY) {
              failures.push(`${mode}: ${ink} on .${material.name} (${plate.label}) = ${report(ratio)}:1`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * And every individual stop against the large-text floor.
   *
   * A two-stop gradient's extremes live in opposite corners of the plate. A
   * corner is not where a paragraph sits, which is why this is 3:1 rather than
   * 4.5 — but a plate whose corner cannot hold the biggest type in the system is
   * a plate with no legible region at all, and `.mat-hero` at 2.71:1 failed here
   * on every stop it had.
   */
  it("holds every stop of every plate above the large-text floor, in both modes", () => {
    const failures: string[] = [];
    for (const mode of ["default", "high"] as const) {
      for (const material of MATERIALS) {
        const { stops } = plates(mode, material.fill, material.sheen);
        for (const ink of material.inks) {
          for (const plate of stops) {
            const ratio = contrastRatio(colour(mode, ink), plate.colour);
            if (ratio < LARGE) {
              failures.push(`${mode}: ${ink} on .${material.name} (${plate.label}) = ${report(ratio)}:1`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The hero is held to the body floor on every stop as well, with no corner
   * exemption. It is the one material whose ink is chosen *for* its plate, it is
   * opaque so there is nothing to composite and nothing to argue about, and it
   * is the material that shipped broken.
   */
  it("holds .mat-hero's ink at 4.5:1 on every stop it has, in both modes", () => {
    const failures: string[] = [];
    for (const mode of ["default", "high"] as const) {
      const { stops } = plates(mode, "--fill-hero", [0.14, 0.28]);
      for (const plate of stops) {
        const ratio = contrastRatio(colour(mode, "--ink-hero"), plate.colour);
        if (ratio < BODY) failures.push(`${mode}: --ink-hero on ${plate.label} = ${report(ratio)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The hero's other two inks, which are set by state rather than by role.
   *
   * `disabled` re-points `--ink-hero` at `--text-dim` and `loading` re-points it
   * at `--text` over a `--load-veil` of near-black. Both are declared in §5 and
   * both are the same class of pairing as the resting one; the loading pair is
   * the one that measured 4.05:1 and fell to 3.54:1 under high contrast.
   */
  it("holds the hero's disabled and loading states at 4.5:1 too", () => {
    // Both states are read out of their own rules rather than restated, because
    // a state that changes its plate and a test that assumes it did not is how
    // this pairing gets certified against a surface it never renders.
    const stateBlock = (selector: string): Record<string, string> => {
      const block = FOUNDATION.find((b) => b.selectors.includes(selector));
      expect(block, `foundation.css must declare ${selector}`).toBeDefined();
      return customProperties(block === undefined ? [] : [block]);
    };
    const disabledVars = stateBlock(".act:disabled");
    const loadingVars = stateBlock('.act[data-state="loading"]');

    const disabledFill = disabledVars["--mat-fill"];
    expect(disabledFill, "the disabled state must declare its own plate").toBeDefined();
    // `animation: none` on the same rule parks the specular band off-plate, so
    // there is no band to fold in here.
    const loadingSheen = Number(loadingVars["--sheen-alpha"]);
    expect(Number.isFinite(loadingSheen), "the loading state must declare its own --sheen-alpha").toBe(true);

    const failures: string[] = [];
    for (const mode of ["default", "high"] as const) {
      const under = backdrop(mode);

      for (const stop of gradientStops(resolveVars(MODES[mode], disabledFill as string))) {
        const plate = composite(stop, under);
        const ratio = contrastRatio(colour(mode, "--text-dim"), plate);
        if (ratio < BODY) failures.push(`${mode}: disabled hero = ${report(ratio)}:1`);
      }

      /**
       * The loading plate, in the layer order §3 declares: the fill, then the
       * veil over it, then the specular wipe over *that*. The order is the whole
       * point — the wipe composites onto the darkened plate at full strength
       * rather than being darkened with it, which is why deepening the veil once
       * bought almost nothing.
       */
      const veilAlpha = Number(token(mode, "--load-veil"));
      expect(Number.isFinite(veilAlpha), `--load-veil in ${mode}`).toBe(true);
      for (const stop of gradientStops(resolveVars(MODES[mode], `var(--fill-hero)`))) {
        const veiled = composite([4, 2, 10, veilAlpha], composite(stop, under));
        const ratio = contrastRatio(colour(mode, "--text"), composite(band(loadingSheen), veiled));
        if (ratio < BODY) failures.push(`${mode}: loading hero = ${report(ratio)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The assertion that survives a wrong model.
   *
   * Every ratio is recomputed by the same arithmetic in both modes, so whatever
   * this file gets wrong about absolute contrast, it gets equally wrong twice
   * and the comparison stands. High contrast may hold a ratio; it may raise it;
   * it may never lower it. A tolerance of 0.005 exists only so that a pairing
   * the setting does not touch cannot fail on floating point.
   */
  it("never lets high contrast produce a lower ratio than the default theme", () => {
    const regressions: string[] = [];
    for (const material of MATERIALS) {
      const low = plates("default", material.fill, material.sheen);
      const high = plates("high", material.fill, material.sheen);
      for (const ink of material.inks) {
        /**
         * Two comparisons, and neither pairs stops by index — the two modes may
         * declare different numbers of them, and index 1 of a three-stop
         * gradient is not the same place on the plate as index 1 of a two-stop
         * one. The middle is compared like for like at the same fraction of each
         * gradient; the corners are compared at their worst.
         */
        const pairs: [string, Plate[], Plate[]][] = [
          ["the middle of the plate", low.middle, high.middle],
          ["the worst corner", low.stops, high.stops],
        ];
        for (const [where, a, b] of pairs) {
          const before = Math.min(...a.map((p) => contrastRatio(colour("default", ink), p.colour)));
          const after = Math.min(...b.map((p) => contrastRatio(colour("high", ink), p.colour)));
          if (after < before - 0.005) {
            regressions.push(
              `${ink} on .${material.name}, ${where}: ${report(before)}:1 → ${report(after)}:1`
            );
          }
        }
      }
    }
    expect(regressions, "high contrast must raise every ratio it touches, never lower one").toEqual([]);
  });

  /**
   * The structural half of the same defect: the ink has to be a token, and the
   * token has to win.
   *
   * The measured 2.70:1 was not a bad palette choice — `--ink-hero` was already
   * correct. It was a consumer writing `.some-thing.mat-hero { color: #fff }`
   * and out-specifying a one-class rule. `foundation.css` answers that with a
   * deliberately loud `.mat-hero.mat-hero.mat-hero`, and the reason this test
   * exists is that a later tidy-up would read that as a typo.
   */
  it("keeps the hero's ink on a token that out-specifies its consumers", () => {
    const css = sheet("foundation.css");
    expect(/--ink-hero:\s*var\(--text-invert\)/.test(css), "--ink-hero must resolve to --text-invert").toBe(true);
    expect(
      /\.mat-hero\.mat-hero\.mat-hero[\s\S]{0,40}\{[^}]*color:\s*var\(--ink-hero\)/.test(css),
      ".mat-hero's colour must be declared at three-class weight so a consumer cannot out-specify it"
    ).toBe(true);
    // The states re-point the token rather than the property, for the same reason.
    expect(/\.mat-hero\.act:disabled[\s\S]{0,200}--ink-hero:/.test(css)).toBe(true);
  });

  /**
   * Type roles inside a hero must follow the hero's ink.
   *
   * `.t-body` and `.t-label` name light colours, written for the dark plates
   * that every other material is. Dropped inside a hero they are pale on pale —
   * `--text-faint` against the default hero's mid-plate is about 1.4:1 — and the
   * only thing standing between the game and that is one `:is()` rule.
   */
  it("makes the type roles inherit inside a hero, because they are unreadable otherwise", () => {
    const heroMid = (plates("default", "--fill-hero", [0.14, 0.28]).middle[0] as Plate).colour;
    expect(contrastRatio(colour("default", "--text-faint"), heroMid)).toBeLessThan(BODY);
    expect(
      /\.mat-hero :is\(\.t-display, \.t-heading, \.t-body, \.t-label, \.num\)[\s\S]{0,40}\{[^}]*color:\s*inherit/.test(
        sheet("foundation.css")
      ),
      "a type role inside .mat-hero must inherit the hero's ink"
    ).toBe(true);
  });
});
