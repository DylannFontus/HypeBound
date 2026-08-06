/**
 * The light rig has two representations, and they must never drift.
 *
 * `LIGHT_RIG.cssAngle` is what forty-nine DOM screens light themselves from and
 * `LIGHT_RIG.world` is what the battle scene lights itself from. They are the
 * same statement — *the key light is at the top-left* — written twice, once for
 * a coordinate system where y grows downward and once for one where it grows up
 * and the screen's vertical axis is z.
 *
 * Two adjacent surfaces lit from different directions is the defect the
 * foundation contract calls its single most load-bearing line, and the way it
 * happens is not that somebody disagrees about the light. It is that somebody
 * changes one representation, cannot check the other by looking at it, and
 * leaves them ninety degrees apart in a scene nobody screenshots for a week. So
 * the check is arithmetic, and it runs through the same conversion the module
 * itself uses rather than a second copy of it — a test that reimplemented the
 * trigonometry would prove only that two copies of the same mistake agree.
 *
 * The rest of the file covers the other thing this module quietly promises: it
 * is imported by screen code that the test suite runs under node, where there
 * is no document and no canvas, and every entry point has to return a value of
 * the right type instead of throwing.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIGHT_RIG,
  MATERIAL_AMPLITUDE,
  MATERIAL_FACE,
  bevelStrip,
  contactShadow,
  cssAngleToWorld,
  currentGlow,
  fadeStrip,
  grainContrast,
  grainContrastOf,
  grainDataUri,
  grainTier,
  installTextureVars,
  lightPosition,
  noiseTexture,
  scaledAsset,
  shadowOffset,
  softMask,
  softMaskDataUri,
  worldToCssAngle,
} from "../src/ui/art/texture";

const TIERS = ["hero", "panel", "chip", "well"] as const;

const FOUNDATION = fileURLToPath(new URL("../src/ui/theme/foundation.css", import.meta.url));

/** The stylesheet, or null while module A has not landed. See the note below. */
function foundationCss(): string | null {
  return existsSync(FOUNDATION) ? readFileSync(FOUNDATION, "utf8") : null;
}

/** sRGB hex to WCAG relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (pair: string): number => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6))
  );
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("LIGHT_RIG", () => {
  it("states the contract's angle", () => {
    expect(LIGHT_RIG.cssAngle).toBe(315);
  });

  it("describes the same direction in CSS terms and in world space", () => {
    expect(worldToCssAngle(LIGHT_RIG.world)).toBeCloseTo(LIGHT_RIG.cssAngle, 9);
  });

  it("builds its world vector from its own CSS angle", () => {
    const rebuilt = cssAngleToWorld(LIGHT_RIG.cssAngle, LIGHT_RIG.elevation);
    expect(rebuilt.x).toBeCloseTo(LIGHT_RIG.world.x, 12);
    expect(rebuilt.y).toBeCloseTo(LIGHT_RIG.world.y, 12);
    expect(rebuilt.z).toBeCloseTo(LIGHT_RIG.world.z, 12);
  });

  it("is normalised, so it can be used as a direction without scaling anything", () => {
    expect(LIGHT_RIG.world.length()).toBeCloseTo(1, 12);
  });

  it("puts the key light above the board and to the top-left of the screen", () => {
    expect(LIGHT_RIG.world.y).toBeGreaterThan(0); // above
    expect(LIGHT_RIG.world.x).toBeLessThan(0); // screen left
    expect(LIGHT_RIG.world.z).toBeLessThan(0); // up the screen, away from the camera
    expect(LIGHT_RIG.screen.x).toBeLessThan(0);
    expect(LIGHT_RIG.screen.y).toBeLessThan(0); // CSS y grows downward, so up is negative
  });

  it("casts every shadow to the bottom-right", () => {
    const offset = shadowOffset(12);
    expect(offset.x).toBeGreaterThan(0);
    expect(offset.y).toBeGreaterThan(0);
    // The vertical throw is the one the eye reads as height; the horizontal one
    // is deliberately shorter so a panel does not look peeled off the page.
    expect(offset.x).toBeLessThan(offset.y);
  });

  it("round-trips every angle, not just its own", () => {
    for (const angle of [0, 30, 45, 90, 135, 180, 225, 270, 315, 359]) {
      expect(worldToCssAngle(cssAngleToWorld(angle))).toBeCloseTo(angle, 9);
    }
  });

  it("hands out a fresh position vector rather than the shared direction", () => {
    const a = lightPosition(10);
    const b = lightPosition(10);
    expect(a).not.toBe(b);
    expect(a).not.toBe(LIGHT_RIG.world);
    expect(a.length()).toBeCloseTo(10, 9);
  });

  it("keeps a 3:1 key-to-fill ratio, with the rim between them", () => {
    expect(LIGHT_RIG.key / LIGHT_RIG.fill).toBeCloseTo(3, 1);
    expect(LIGHT_RIG.rim).toBeGreaterThan(LIGHT_RIG.fill);
    expect(LIGHT_RIG.rim).toBeLessThan(LIGHT_RIG.key);
  });

  /**
   * Module A owns `--light-angle` and writes it into `foundation.css`. Skipped
   * rather than failed while that file does not exist yet: this module ships
   * ahead of it, and a red test for work another builder has not landed tells
   * nobody anything they can act on. The moment the file appears, this starts
   * guarding the seam between the two modules.
   */
  it("agrees with module A's --light-angle", () => {
    const path = fileURLToPath(new URL("../src/ui/theme/foundation.css", import.meta.url));
    if (!existsSync(path)) return;
    const css = readFileSync(path, "utf8");
    const match = /--light-angle:\s*([0-9.]+)deg/.exec(css);
    expect(match, "foundation.css must declare --light-angle").not.toBeNull();
    expect(Number(match?.[1])).toBe(LIGHT_RIG.cssAngle);
  });
});

describe("material amplitudes", () => {
  it("are the contract's four values on one scale", () => {
    expect(MATERIAL_AMPLITUDE).toEqual({ hero: 1, panel: 0.55, chip: 0.35, well: 0.7 });
  });
});

/**
 * The three things the two halves of the rig kept disagreeing about.
 *
 * Everything below reads the real stylesheet rather than a copy of its numbers,
 * for the same reason the `--light-angle` check does: a test that restates the
 * value it is checking proves only that somebody typed it twice. All of them are
 * skipped rather than failed while `foundation.css` is absent, because this
 * module ships ahead of module A and a red test for a file another builder has
 * not landed tells nobody anything they can act on.
 */
describe("the seam between module B's arithmetic and module A's stylesheet", () => {
  /**
   * The DOM cast has to fall where `shadowOffset()` says it does. It did not:
   * both layers of `--mat-cast` were authored as `0 Npx`, so every raised object
   * on the page shadowed as if the key light were directly overhead while the
   * gallery printed a horizontal throw in its light readout one card above.
   */
  it("throws the CSS cast sideways at exactly shadowOffset's ratio", () => {
    const css = foundationCss();
    if (css === null) return;
    const unit = shadowOffset(1);
    const wanted = unit.x / unit.y;

    // The soft drop and the tight contact, in the order they appear in --mat-cast.
    const drop = /calc\(([0-9.]+)px \* var\(--mat-amp\) \* var\(--cast-lift\)\) calc\(([0-9.]+)px \* var\(--mat-amp\) \* var\(--cast-lift\)\)/.exec(
      css
    );
    expect(drop, "--mat-cast must declare a two-axis soft drop").not.toBeNull();
    expect(Number(drop?.[1]) / Number(drop?.[2])).toBeCloseTo(wanted, 3);

    const contact = /calc\(([0-9.]+)px \* var\(--cast-lift\)\) calc\(([0-9.]+)px \* var\(--cast-lift\)\)/.exec(css);
    expect(contact, "--mat-cast must declare a two-axis contact shadow").not.toBeNull();
    expect(Number(contact?.[1]) / Number(contact?.[2])).toBeCloseTo(wanted, 3);

    // And the pressed state's inner shade, which falls the same way.
    const press = /--press-cast: inset ([0-9.]+)px ([0-9.]+)px/.exec(css);
    expect(press, ".act:active must declare a two-axis --press-cast").not.toBeNull();
    expect(Number(press?.[1]) / Number(press?.[2])).toBeCloseTo(wanted, 2);
  });

  /**
   * Grain is a contrast, not an alpha. The assertion is on the *ratio* between
   * the four rendered amplitudes rather than on the amounts, because the amounts
   * are an answer that will change the next time a fill is retuned and the ratio
   * is the requirement that must not. 1.75% on the hero against 22.0% on the
   * well is what this replaced.
   */
  it("renders the four plates at the same high-pass fraction of their own faces", () => {
    const ratios = TIERS.map(grainContrastOf);
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.5);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.03);
      expect(ratio).toBeLessThan(0.1);
    }
  });

  /**
   * And the measurements have to still follow from the amounts.
   *
   * `contrast` is read off the rendered page rather than computed, which is the
   * honest way round — but a hand-recorded measurement rots the moment somebody
   * edits an amount and does not re-shoot. So: the model's prediction for the
   * grain, added in quadrature to the plate's own recorded dither floor, must
   * land within a fifth of what was measured. Change an amount without
   * re-measuring and this goes red.
   */
  it("keeps each recorded measurement consistent with the amount that produced it", () => {
    for (const tier of TIERS) {
      const { amount, baseline, contrast } = grainTier(tier);
      const modelled = grainContrast(amount, MATERIAL_FACE[tier]);
      const predicted = Math.hypot(modelled, baseline);
      expect(Math.abs(predicted - contrast) / contrast, `${tier} grain measurement is stale`).toBeLessThan(0.2);
    }
  });

  it("keeps the four faces in the value structure the materials claim", () => {
    expect(MATERIAL_FACE.hero).toBeGreaterThan(MATERIAL_FACE.chip);
    expect(MATERIAL_FACE.chip).toBeGreaterThan(MATERIAL_FACE.panel);
    expect(MATERIAL_FACE.panel).toBeGreaterThan(MATERIAL_FACE.well);
  });

  /**
   * Four material ranks, four tiles, no sharing *between ranks*.
   *
   * The rule this guards is that amplitudes stay perceptually equal: each tile
   * is authored against one face, so a rank wearing a tile cut for a different
   * face renders at the wrong contrast — 1.75% on the hero against 22.0% on the
   * well is the failure it exists to catch. That is a statement about **ranks**,
   * and counting raw claims is not the same statement. A *state* — `:disabled`,
   * and whatever joins it — legitimately re-points the grain when it re-points
   * the fill, because the tile has to follow the face it is now sitting on.
   * `.act:disabled` drops its plate to within a few levels of `--fill-panel`, so
   * it takes the panel's tile; keeping `.mat-hero`'s there instead would render
   * it at four times the intended contrast and make the dead button the noisiest
   * object on the card. Counting five claims and calling that a double-claim
   * would have forced exactly that defect back in.
   *
   * So the assertion is on the ranks, and a state may reuse a rank's grain
   * provided it (a) reads as a state rather than a material and (b) says in a
   * comment why, in the block that does it. A state inventing a fifth tile is
   * still a failure, because that tile is authored against no face at all.
   *
   * The shared recipe's own `var(--mat-grain, var(--tex-grain-mid, none))`
   * fallback does not count here, because it is written with a comma rather than
   * a colon — only a selector actually claiming a tile matches.
   */
  it("gives each material rank its own grain, and lets only a documented state reuse one", () => {
    const css = foundationCss();
    if (css === null) return;

    /** Every `--mat-grain` claim, with the selector and block that made it. */
    const claims = [...css.matchAll(/--mat-grain: var\((--tex-grain-[a-z]+),/g)].map((match) => {
      const at = match.index ?? 0;
      const braceAt = css.lastIndexOf("{", at);
      // The selector runs from the end of whatever precedes it — the previous
      // rule, or the comment documenting this one — to that brace.
      const start = Math.max(css.lastIndexOf("}", braceAt) + 1, css.lastIndexOf("*/", braceAt) + 2, 0);
      return {
        // The pattern cannot match without group 1; `String` is what says so to
        // the compiler without an assertion.
        grain: String(match[1]),
        selector: css.slice(start, braceAt).replace(/\s+/g, " ").trim(),
        /**
         * What stands immediately above the claim — from the end of the
         * previous declaration, or the block's own brace if it is the first.
         * Deliberately not the whole block: a rule that happens to carry a
         * comment about its border would otherwise count as an explanation of
         * its grain, and this has to be an argument somebody made about *this*
         * line.
         */
        preamble: css.slice(Math.max(braceAt + 1, css.lastIndexOf(";", at) + 1), at),
      };
    });
    expect(claims.length, "foundation.css must claim a grain somewhere").toBeGreaterThan(0);

    // A state is recognised by its own selector, and is asked the state
    // questions; everything else claiming a grain must be one of the four ranks.
    const RANKS = [".mat-hero", ".mat-panel", ".mat-chip", ".mat-well"] as const;
    const rankOf = (selector: string): string | undefined =>
      RANKS.find((rank) => new RegExp(`(^|[\\s,])\\${rank}(?![\\w-])`).test(selector));
    const isState = (selector: string): boolean =>
      /:disabled|:hover|:active|:focus|:checked|\[aria-disabled|\[data-state=|\[disabled\]/.test(selector);

    const states = claims.filter((claim) => isState(claim.selector));
    const ranked = claims.filter((claim) => !isState(claim.selector));

    // One rank, one grain — the invariant the amplitudes rest on.
    const byRank = new Map<string, string[]>();
    for (const claim of ranked) {
      const rank = rankOf(claim.selector);
      expect(rank, `${claim.selector} claims a grain but is neither a material rank nor a state`).toBeDefined();
      byRank.set(rank ?? claim.selector, [...(byRank.get(rank ?? claim.selector) ?? []), claim.grain]);
    }
    for (const rank of RANKS) {
      expect(byRank.get(rank) ?? [], `${rank} must claim exactly one grain`).toHaveLength(1);
    }

    // Four ranks, four distinct tiles: no rank may wear another's.
    const owned = RANKS.map((rank) => (byRank.get(rank) ?? [])[0]);
    expect(new Set(owned), "each rank owns a different grain").toEqual(
      new Set(["--tex-grain-hero", "--tex-grain-mid", "--tex-grain-chip", "--tex-grain-well"])
    );

    // A state may borrow, but only a tile some rank is already wearing, and only
    // where the block it borrows in says why.
    for (const claim of states) {
      expect(owned, `${claim.selector} claims ${claim.grain}, which no material rank uses`).toContain(claim.grain);
      expect(
        /\/\*/.test(claim.preamble),
        `${claim.selector} reuses ${claim.grain} without saying why in the block that does it`
      ).toBe(true);
    }
  });

  /**
   * The hero's label against the hero's own plate, in both contrast modes.
   *
   * This is the defect that comes back the moment somebody retunes the gradient:
   * `.mat-hero` shipped `color: #fff` on a light-violet plate and measured
   * 2.71:1 by pipette, and `data-contrast="high"` made it *worse* by dropping the
   * darkest stop — the one setting whose entire purpose is legibility handing the
   * primary action a lighter plate. The ink is now `--text-invert`; the check is
   * that every stop of every hero fill clears 4.5:1 against it, and that turning
   * high contrast on never makes a stop worse.
   */
  it("holds .mat-hero's ink above 4.5:1 on every stop, in both contrast modes", () => {
    const css = foundationCss();
    if (css === null) return;

    const inkMatch = /--text-invert:\s*(#[0-9a-fA-F]{6})/.exec(
      readFileSync(fileURLToPath(new URL("../src/ui/theme/base.css", import.meta.url)), "utf8")
    );
    expect(inkMatch, "base.css must define --text-invert").not.toBeNull();
    const ink = inkMatch?.[1] ?? "#000000";

    expect(/\.mat-hero\s*\{[^}]*color: var\(--ink-hero\)/.test(css), ".mat-hero must ink from --ink-hero").toBe(true);
    expect(/--ink-hero:\s*var\(--text-invert\)/.test(css), "--ink-hero must resolve to --text-invert").toBe(true);

    // The default fill names palette tokens; the high-contrast one is literal.
    const palette = readFileSync(fileURLToPath(new URL("../src/ui/theme/base.css", import.meta.url)), "utf8");
    const token = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(palette)?.[1] ?? "#000000";
    const defaultStops = [token("accent-bright"), token("accent"), token("accent-hot")];

    const highFill = /:root\[data-contrast="high"\]\s*\{[\s\S]*?--fill-hero:[^;]*?linear-gradient\(([^;]*)\);/.exec(css);
    expect(highFill, "high contrast must restate --fill-hero").not.toBeNull();
    const highStops = [...(highFill?.[1] ?? "").matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
    expect(highStops.length).toBeGreaterThan(1);

    for (const stop of defaultStops) expect(contrastRatio(stop, ink)).toBeGreaterThanOrEqual(4.5);
    for (const stop of highStops) expect(contrastRatio(stop, ink)).toBeGreaterThanOrEqual(4.5);

    // The whole point of the setting: it may not be the worse of the two.
    const worstDefault = Math.min(...defaultStops.map((s) => contrastRatio(s, ink)));
    const worstHigh = Math.min(...highStops.map((s) => contrastRatio(s, ink)));
    expect(worstHigh).toBeGreaterThanOrEqual(worstDefault);
  });
});

describe("the texture primitives under node", () => {
  it("return an empty string instead of a data URI when there is no canvas", () => {
    expect(typeof document).toBe("undefined");
    expect(grainDataUri()).toBe("");
    expect(softMaskDataUri({ width: 64, height: 64 })).toBe("");
  });

  it("install nothing, and do not throw, without a document", () => {
    expect(() => installTextureVars()).not.toThrow();
  });

  it("still hand back well-formed textures, so callers never branch on the environment", () => {
    expect(softMask({ width: 64, height: 64 }).isTexture).toBe(true);
    expect(noiseTexture({ size: 32 }).isTexture).toBe(true);
    expect(fadeStrip().texture.isTexture).toBe(true);
  });

  it("memoise by argument, so a render loop pays once", () => {
    expect(noiseTexture({ size: 32 })).toBe(noiseTexture({ size: 32 }));
    expect(softMask({ width: 64, height: 64 })).toBe(softMask({ width: 64, height: 64 }));
    expect(currentGlow("cinder", 0.5)).toBe(currentGlow("cinder", 0.5));
  });

  it("return null for an asset that cannot exist here", () => {
    expect(scaledAsset("assets/icons/current/cinder", 28)).toBeNull();
  });
});

describe("the CSS half of each primitive", () => {
  it("bevels with a lit rim, an unlit lip and a shadow that falls right and down", () => {
    const { boxShadow } = bevelStrip({ tier: "hero" });
    expect(boxShadow).toContain("inset 0 1px 0 rgba(255, 255, 255,");
    expect(boxShadow).toContain("inset 0 -1px 0 rgba(0, 0, 0,");
    // The soft drop is the last entry; its offsets are both positive.
    const drop = boxShadow.split(", 0 1px 2px ")[1] ?? "";
    const offsets = /(-?[0-9.]+)px (-?[0-9.]+)px/.exec(drop);
    expect(Number(offsets?.[1])).toBeGreaterThan(0);
    expect(Number(offsets?.[2])).toBeGreaterThan(0);
  });

  it("scales the whole bevel with the material rank", () => {
    const hero = bevelStrip({ tier: "hero" }).boxShadow;
    const chip = bevelStrip({ tier: "chip" }).boxShadow;
    expect(hero).not.toBe(chip);
  });

  it("emits both shadows of a contact shadow — the tight one and the soft one", () => {
    const { css, padding } = contactShadow({ width: 128, height: 128 });
    expect(css.split("), ").length).toBe(2);
    expect(css.startsWith("0 1px 2px rgba(0, 0, 0,")).toBe(true);
    expect(padding).toBeGreaterThan(0);
  });

  it("fades a divider at both ends and nowhere else", () => {
    const { maskImage } = fadeStrip(0.15);
    expect(maskImage.startsWith("linear-gradient(90deg,")).toBe(true);
    expect(maskImage).toContain("rgba(0, 0, 0, 0) 0%");
    expect(maskImage).toContain("rgba(0, 0, 0, 0) 100%");
    expect(maskImage).toContain("rgba(0, 0, 0, 1) 15%");
    expect(fadeStrip(0.15, "y").maskImage.startsWith("linear-gradient(180deg,")).toBe(true);
  });

  it("normalises a Current's bloom against its luminance", () => {
    // Halo is pale yellow and Veil is deep violet. At the same intensity the
    // pale one needs less bloom to read as equally bright, and a pass that
    // treated them alike would blow Halo out into a white smear.
    expect(currentGlow("halo", 1).bloom).toBeLessThan(currentGlow("veil", 1).bloom);
    expect(currentGlow("veil", 0).bloom).toBe(0);
    expect(currentGlow("veil", 1).css).toContain("0 0 ");
  });
});
