/**
 * The sun over the *canvas*, which no test could previously see.
 *
 * `tests/texture-light-rig.test.ts` proves `LIGHT_RIG.cssAngle` and
 * `LIGHT_RIG.world` describe the same direction, and `tests/one-sun.test.ts`
 * proves every gradient in the stylesheets obeys it. Between them they cover the
 * DOM and the three.js scene and nothing at all of the card renderer — which is
 * how `renderLeader::metalGradient` shipped.
 *
 * That function built a conic starting at 2.356 rad and a linear from (94,40) to
 * (346,292), and stated its intent in its own doc comment: *"shadowed
 * upper-left, specular lower-right."* Measured with `scripts/measure-light.mjs`
 * on 460px coins, Cinder came out 1.3:1 brighter at the *bottom*-right, Halo
 * 1.7:1 and Tide 8.5:1, with the fitted peak between 16° and 28° — the opposite
 * corner from a card frame whose peak the same script puts at 275–285°. The
 * leader coin sits directly above the hand for the whole of every match. Two
 * suns, one screen, four rounds of review, every test green.
 *
 * There is no canvas under node, so this cannot count pixels — that is what the
 * script is for, and it is the measurement of record. What a unit test *can* do
 * is close the two doors the defect walked through:
 *
 * 1. **Drive the shared primitives through a recording context** and check that
 *    the gradient they build runs from dark to light along `TO_LIGHT`, for the
 *    coin's bounds and the card's alike. This is the assertion the brief asks
 *    for — the coin's fill and the card rim's fill, compared — expressed as the
 *    geometry both of them hand to the canvas rather than as pixels neither of
 *    them can produce here.
 *
 * 2. **Refuse to let a second implementation exist.** The defect was never a
 *    disagreement about where the light is; it was a private gradient nobody had
 *    to look at. So every directional gradient in the card renderer must either
 *    come from `TO_LIGHT`, be exactly axis-aligned — a scrim carries no claim
 *    about a light — or be registered below with a reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TO_LIGHT, bandFace, bandShelf, edgeGradient, litGradient, type Metal } from "../src/ui/cardRenderer/material";
import { CARD_H, CARD_W, CURRENT_PALETTE, LAYOUT } from "../src/ui/cardRenderer/palette";

// ---------------------------------------------------------------------------
// A canvas context that records instead of painting
// ---------------------------------------------------------------------------

interface Recorded {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: [number, string][];
}

function recorder(): { ctx: CanvasRenderingContext2D; made: Recorded[] } {
  const made: Recorded[] = [];
  const ctx = {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      const gradient: Recorded & { addColorStop(at: number, colour: string): void } = {
        x0,
        y0,
        x1,
        y1,
        stops: [],
        addColorStop(at: number, colour: string) {
          this.stops.push([at, colour]);
        },
      };
      made.push(gradient);
      return gradient;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, made };
}

/** sRGB hex, or `rgba(r, g, b, a)`, to WCAG relative luminance. */
function luminance(colour: string): number {
  let r = 0;
  let g = 0;
  let b = 0;
  const rgba = /rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(colour);
  if (rgba) {
    [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  } else {
    const value = parseInt(colour.replace("#", ""), 16);
    r = (value >> 16) & 255;
    g = (value >> 8) & 255;
    b = value & 255;
  }
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The unit vector the gradient's colours travel along. */
function direction(g: Recorded): { x: number; y: number } {
  const dx = g.x1 - g.x0;
  const dy = g.y1 - g.y0;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/** How closely a gradient points at the key light. 1 is exact; −1 is the defect. */
function alignment(g: Recorded): number {
  const d = direction(g);
  return d.x * TO_LIGHT.x + d.y * TO_LIGHT.y;
}

const CARD_RECT = {
  x: LAYOUT.bleed,
  y: LAYOUT.bleed,
  w: CARD_W - LAYOUT.bleed * 2,
  h: CARD_H - LAYOUT.bleed * 2,
};

/** The leader coin's ring bounds, from `renderLeader`'s own constants. */
const COIN_RECT = { x: 220 - 150, y: 166 - 150, w: 300, h: 300 };

const METALS: [string, Metal][] = Object.entries(CURRENT_PALETTE).map(([id, palette]) => [
  id,
  { hi: palette.hi, key: palette.key, lo: palette.lo, abyss: palette.abyss },
]);

describe("the card renderer's key light", () => {
  it("runs the frame band's fill from shadow to highlight along TO_LIGHT", () => {
    for (const [id, metal] of METALS) {
      const { ctx, made } = recorder();
      bandFace(ctx, CARD_RECT, metal);
      const gradient = made[0];
      expect(gradient, `${id} built no gradient`).toBeDefined();
      expect(alignment(gradient!), `${id} frame band`).toBeCloseTo(1, 6);

      const stops = gradient!.stops;
      const first = luminance(stops[0]![1]);
      const last = luminance(stops[stops.length - 1]![1]);
      expect(last, `${id} frame band must be lightest at the lit end`).toBeGreaterThan(first);
    }
  });

  /**
   * The assertion the round-one brief asked for, in the form node can run: the
   * coin and the card rim are handed the *same* construction, so a change that
   * moves one has to move the other. A private gradient in `renderLeader` was
   * how they came apart, and the guard below is what stops one reappearing.
   */
  it("lights the leader coin from the same direction as the card rim, on every Current", () => {
    for (const [id, metal] of METALS) {
      const card = recorder();
      bandFace(card.ctx, CARD_RECT, metal);
      const coin = recorder();
      bandFace(coin.ctx, COIN_RECT, metal);

      const a = direction(card.made[0]!);
      const b = direction(coin.made[0]!);
      expect(a.x * b.x + a.y * b.y, `${id}: coin and card rim disagree about the light`).toBeCloseTo(1, 9);
      expect(alignment(card.made[0]!)).toBeCloseTo(1, 6);
      expect(alignment(coin.made[0]!)).toBeCloseTo(1, 6);

      // and the same again for the recessed shelf, which is the other half of
      // the section both objects now share
      const cardShelf = recorder();
      bandShelf(cardShelf.ctx, CARD_RECT, metal);
      const coinShelf = recorder();
      bandShelf(coinShelf.ctx, COIN_RECT, metal);
      expect(alignment(cardShelf.made[0]!), `${id} card shelf`).toBeCloseTo(1, 6);
      expect(alignment(coinShelf.made[0]!), `${id} coin shelf`).toBeCloseTo(1, 6);
    }
  });

  it("puts white on the lit arc of an edge and black on the unlit one", () => {
    const { ctx, made } = recorder();
    edgeGradient(ctx, CARD_RECT, 0.5, 0.7);
    const g = made[0]!;
    expect(alignment(g)).toBeCloseTo(1, 6);
    expect(g.stops[0]![1]).toContain("rgba(0,0,0");
    expect(g.stops[g.stops.length - 1]![1]).toContain("rgba(255,255,255");

    // ...and exactly the other way round when the wall faces inward
    const inverted = recorder();
    edgeGradient(inverted.ctx, CARD_RECT, 0.5, 0.7, true);
    const back = inverted.made[0]!;
    expect(back.stops[0]![1]).toContain("rgba(255,255,255");
    expect(back.stops[back.stops.length - 1]![1]).toContain("rgba(0,0,0");
  });

  /**
   * A tall plate and a wide one must carry the same amount of light.
   *
   * `litGradient` projects the gradient line so both extreme corners land on the
   * ends, which is what stops a 512×680 card frame and a 300×300 coin from
   * having visibly different contrast across their metal despite the same stops.
   */
  it("normalises the gradient's span to the shape, so aspect does not change the exposure", () => {
    for (const rect of [CARD_RECT, COIN_RECT, { x: 0, y: 0, w: 600, h: 40 }]) {
      const { ctx, made } = recorder();
      litGradient(ctx, rect, [
        [0, "#000000"],
        [1, "#ffffff"],
      ]);
      const g = made[0]!;
      const span = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
      const wanted = Math.abs(rect.w * TO_LIGHT.x) + Math.abs(rect.h * TO_LIGHT.y);
      expect(span).toBeCloseTo(wanted, 6);
      // and it is centred on the shape, so neither end is clipped
      expect((g.x0 + g.x1) / 2).toBeCloseTo(rect.x + rect.w / 2, 6);
      expect((g.y0 + g.y1) / 2).toBeCloseTo(rect.y + rect.h / 2, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// No second implementation
// ---------------------------------------------------------------------------

const SOURCES = [
  "../src/ui/cardRenderer/material.ts",
  "../src/ui/cardRenderer/renderCard.ts",
  "../src/ui/cardRenderer/renderCardBack.ts",
  "../src/ui/cardRenderer/renderLeader.ts",
  "../src/ui/cardRenderer/placeholderArt.ts",
  "../src/ui/cardRenderer/icons.ts",
  "../src/ui/cardRenderer/hatch.ts",
  "../src/ui/battle/cardMesh.ts",
] as const;

/**
 * Directional gradients that are allowed not to come from `TO_LIGHT`.
 *
 * One entry per site with a written reason, and an entry that stops matching
 * fails the suite — so an excuse cannot outlive the line it excused. All three
 * are *moving* bands rather than static shading: a specular crawling a frame and
 * a diffraction grating drifting across a foil are travelling in the direction
 * of their own travel, which is a different claim from where the sun is.
 */
const JUSTIFIED: { file: string; match: string; why: string }[] = [
  {
    file: "renderCard.ts",
    match: "travel - CARD_H * 0.55",
    why: "the specular band crawling the frame; its angle is its travel, not the key light",
  },
  {
    file: "renderCard.ts",
    match: "-drift, 0, CARD_W * 1.2 - drift",
    why: "the foil's diffraction grating, which drifts across the card on the shared clock",
  },
  {
    file: "renderCard.ts",
    match: "travel - CARD_H * 0.8",
    why: "the foil's specular, running the other way across the grating",
  },
];

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** The argument list of a call, with nesting respected. */
function callArguments(source: string, at: number): string {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(at + source.slice(at).indexOf("(") + 1, i);
    }
  }
  return "";
}

function splitTop(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

describe("nobody in the card renderer owns their own light", () => {
  it("builds no conic gradient anywhere", () => {
    for (const relative of SOURCES) {
      const source = read(relative);
      expect(source.includes("createConicGradient"), `${relative} builds a conic gradient`).toBe(false);
    }
  });

  it("keeps every linear gradient axis-aligned, derived from TO_LIGHT, or registered", () => {
    const seen = new Set<string>();

    for (const relative of SOURCES) {
      const name = relative.split("/").pop() ?? relative;
      const source = read(relative);
      let index = source.indexOf("createLinearGradient");
      while (index !== -1) {
        const args = splitTop(callArguments(source, index));
        const line = source.slice(0, index).split("\n").length;
        const where = `${name}:${line}`;

        const derived = args.some((a) => a.includes("TO_LIGHT"));
        const axisAligned =
          args.length === 4 && (normalise(args[0]!) === normalise(args[2]!) || normalise(args[1]!) === normalise(args[3]!));
        const excuse = JUSTIFIED.find((entry) => entry.file === name && args.join(", ").includes(entry.match));
        if (excuse) seen.add(`${excuse.file}|${excuse.match}`);

        expect(
          derived || axisAligned || Boolean(excuse),
          `${where}: createLinearGradient(${args.join(", ")}) is oblique, does not come from ` +
            `TO_LIGHT, and is not registered in JUSTIFIED. A private light source in the card ` +
            `renderer is the defect this file exists to catch.`
        ).toBe(true);

        index = source.indexOf("createLinearGradient", index + 1);
      }
    }

    for (const entry of JUSTIFIED) {
      expect(seen.has(`${entry.file}|${entry.match}`), `stale exception for ${entry.file}: ${entry.why}`).toBe(true);
    }
  });

  /** Whitespace-insensitive equality, so `0` and ` 0 ` are the same argument. */
  function normalise(text: string): string {
    return text.replace(/\s+/g, "");
  }

  /**
   * The prose is allowed to name the thing it replaced — that is how the next
   * reader learns why the coin does not own a gradient — so the check is on the
   * declaration and the call, not on the string.
   */
  it("leaves the coin no gradient of its own", () => {
    const source = read("../src/ui/cardRenderer/renderLeader.ts");
    expect(/function\s+metalGradient/.test(source), "renderLeader declares metalGradient again").toBe(false);
    expect(source).toContain("bandFace(ctx, bounds, metal)");
    expect(source).toContain("bandShelf(ctx, bounds, metal)");
  });
});
