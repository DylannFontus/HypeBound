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
  bevelStrip,
  contactShadow,
  cssAngleToWorld,
  currentGlow,
  fadeStrip,
  grainDataUri,
  installTextureVars,
  lightPosition,
  noiseTexture,
  scaledAsset,
  shadowOffset,
  softMask,
  softMaskDataUri,
  worldToCssAngle,
} from "../src/ui/art/texture";

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
