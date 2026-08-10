/**
 * The declarations that cost a compositing surface, and the four ways this
 * project has already got them wrong.
 *
 * ## Why a guard rather than a review note
 *
 * An owner reported half a second of freeze on every navigation on an iPad Pro
 * M5, with the same build "totally smooth" on a desktop Chromium. Nobody here
 * has a Safari, and Playwright's WebKit turned out to have no display link at
 * all — it fires one `requestAnimationFrame` per second and cannot be used to
 * time a repaint — so the cause could not be photographed. What *could* be
 * counted, with Chromium's own `LayerTree`, is how much the stylesheet **asks**
 * the compositor for, and at an iPad Pro's logical size and pixel ratio that
 * came to 93 MB of backing store standing still and 156 MB at the peak of a
 * navigation, on the graphics tier an iPad is actually given.
 *
 * A frame-rate number would not have travelled to an engine nobody can run. A
 * demand figure does, because `will-change`, `filter`, a 3D transform and an
 * infinite transform animation promote a layer in Blink and in WebKit for the
 * same reasons — WebKit simply has far less room for the result. So the rules
 * below are about *asking for less*, and every one of them is a mistake that was
 * found in the tree rather than one imagined for a test.
 *
 * ## The four rules, and the bug behind each
 *
 * **1. A cancelled animation must release its layer.** Seven rules across the
 * accessibility and tier switches wrote `animation: none` while the element's
 * own rule kept `will-change: transform`. A `will-change` promotes on its own,
 * so somebody with reduced motion switched on was holding every full-bleed
 * surface in the file, permanently, for animations that had been turned off. The
 * setting bought stillness and paid the full price of the motion.
 *
 * **2. A parked layer must not park itself on the z axis.** The first attempt at
 * fixing the low tier's room replaced `animation: none` with a
 * `translate3d(…, 0)` holding the light mid-travel — and the census came back
 * completely unchanged, because a 3D transform is itself a promotion trigger.
 * One reason to composite one-and-a-half viewports had been swapped for another.
 *
 * **3. `will-change` must not name `filter` where nothing animates one.** Both
 * screen roots carried `will-change: transform, opacity, filter` for the length
 * of every navigation, and the whole world carried it too — while exactly two of
 * eleven `data-nav` states and four of eight travels ever interpolate a filter.
 * A filter cannot be applied to a stack of sibling layers; it has to be fed a
 * picture of them, so naming it buys a viewport-sized intermediate surface
 * whether or not the property is ever set.
 *
 * **4. No animated `backdrop-filter` on a full-bleed surface.** This one is a
 * ratchet rather than a repair: the tree is already clean — nothing in `src/`
 * animates a `backdrop-filter`, which was checked before it was asserted — and
 * a backdrop filter re-reads everything painted underneath it on every frame it
 * changes, which is the most expensive thing a full-screen element can do on any
 * engine and is a documented cliff on Apple GPUs. `transitions.css` owns every
 * full-viewport surface in the game and does not use `backdrop-filter` at all;
 * that is worth keeping true.
 *
 * The scope is `theme/transitions.css` for rules 1–3, because that is the file
 * that owns the persistent world and the screen-to-screen transitions and is
 * therefore the only one whose surfaces are all viewport-sized. Rule 4 sweeps
 * the whole of `src/`, because a keyframe animating a backdrop filter is wrong
 * wherever it is written.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, blocks, lineOf } from "./helpers/css";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const TRANSITIONS = path.join(SRC, "ui", "theme", "transitions.css");

const source = readFileSync(TRANSITIONS, "utf8");
const sheet = blocks(source);

/** A rule's declarations as a map, last-wins, exactly as the cascade would. */
function declared(block: (typeof sheet)[number]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of block.declarations) out.set(d.prop, d.value);
  return out;
}

function where(block: (typeof sheet)[number]): string {
  return `transitions.css:${block.line}  ${block.prelude.trim().slice(0, 110)}`;
}

/**
 * The rightmost compound of a selector — the part that decides which element the
 * rule lands on.
 *
 * `:root[data-reduced-motion="true"] .nav-curtain-panel` and `.nav-curtain-panel`
 * both key on `.nav-curtain-panel`, which is exactly the relationship this file
 * needs: a state rule cancelling an animation, and the base rule that promoted
 * the same element. Nothing here resolves the cascade — it only asks whether two
 * rules are plausibly talking about the same thing, because the alternative is a
 * blanket rule that flags every `animation: none` in the sheet including the six
 * whose targets were never promoted at all.
 */
function keyCompound(selector: string): string {
  const parts = selector.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Every element in this sheet that some rule promotes with a real will-change. */
const promoted = new Set<string>();
for (const block of sheet) {
  const willChange = declared(block).get("will-change");
  if (willChange === undefined || willChange.trim() === "auto") continue;
  for (const selector of block.selectors) {
    const key = keyCompound(selector);
    if (key !== "") promoted.add(key);
  }
}

describe("a cancelled animation releases its compositing layer", () => {
  it("the promoted-element index is not empty", () => {
    // Calibration: if `keyCompound` ever stops parsing this sheet, the real
    // assertion below passes vacuously and says nothing.
    expect(promoted.size).toBeGreaterThan(5);
  });

  it("every rule that switches off a promoted element's animation releases it", () => {
    const offenders: string[] = [];
    for (const block of sheet) {
      const decls = declared(block);
      const animation = decls.get("animation") ?? decls.get("animation-name");
      if (animation === undefined) continue;
      if (animation.trim() !== "none") continue;
      /**
       * `will-change: auto` is the release. A rule that cancels an animation and
       * says nothing about `will-change` leaves whatever the base rule declared
       * standing, which is the defect: the layer outlives the reason for it.
       */
      if (decls.get("will-change")?.trim() === "auto") continue;
      // ...and it is only a defect if something promoted this element in the
      // first place. A cascade riser carries no `will-change`, so switching its
      // entrance off costs nothing and demanding a release would be noise —
      // and a guard that fires on things that are fine is a guard that gets
      // deleted.
      if (!block.selectors.some((selector) => promoted.has(keyCompound(selector)))) continue;
      offenders.push(where(block));
    }
    expect(offenders, `these cancel an animation but leave the layer promoted:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a parked layer does not park itself on the z axis", () => {
  it("no rule releases will-change and then re-promotes with a 3D transform", () => {
    const offenders: string[] = [];
    for (const block of sheet) {
      const decls = declared(block);
      if (decls.get("will-change")?.trim() !== "auto") continue;
      const transform = decls.get("transform");
      if (transform === undefined) continue;
      /**
       * `translate3d`, `translateZ`, `rotate3d`, `scale3d`, `matrix3d` and
       * `perspective` all establish a 3D rendering context, which is a promotion
       * trigger in both engines. A *static* parked position has no business
       * claiming the z axis, and the 2D spelling of the same offset is free.
       */
      if (!/\b(?:translate3d|translateZ|rotate3d|scale3d|matrix3d|perspective)\s*\(/i.test(transform)) continue;
      offenders.push(`${where(block)}  ->  transform: ${transform}`);
    }
    expect(
      offenders,
      `these release will-change and then promote again with a 3D transform:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

describe("will-change names only what is animated", () => {
  /**
   * The states and travels whose keyframes genuinely interpolate a filter,
   * derived from the sheet rather than listed by hand — a hard-coded list would
   * rot the first time somebody adds a filter to a keyframe, and rot silently in
   * the permissive direction.
   */
  const filterAnimating = (() => {
    const css = blankComments(source);
    const names = new Set<string>();
    const re = /@keyframes\s+([\w-]+)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(css)) !== null) {
      let depth = 1;
      let i = re.lastIndex;
      while (i < css.length && depth > 0) {
        if (css[i] === "{") depth += 1;
        else if (css[i] === "}") depth -= 1;
        i += 1;
      }
      if (/(?:^|[;{\s])filter\s*:/.test(css.slice(re.lastIndex, i))) names.add(match[1] as string);
    }
    return names;
  })();

  it("at least one keyframe in this sheet does animate a filter", () => {
    // Calibration. If this ever comes back empty the derivation above has broken
    // and the real assertion below would pass vacuously.
    expect(filterAnimating.size).toBeGreaterThan(0);
  });

  it("no rule asks for a filter surface unless its own animation needs one", () => {
    /** Which animation-name a selector ends up with, gathered across the sheet. */
    const animationFor = new Map<string, Set<string>>();
    for (const block of sheet) {
      const decls = declared(block);
      const name = decls.get("animation-name") ?? decls.get("animation")?.split(/\s+/)[0];
      if (name === undefined || name === "none") continue;
      for (const selector of block.selectors) {
        const key = selector.trim();
        if (!animationFor.has(key)) animationFor.set(key, new Set());
        (animationFor.get(key) as Set<string>).add(name);
      }
    }

    const offenders: string[] = [];
    for (const block of sheet) {
      const willChange = declared(block).get("will-change");
      if (willChange === undefined) continue;
      if (!/\bfilter\b/.test(willChange)) continue;
      /**
       * The rule is allowed to name `filter` if any selector it declares for
       * also, somewhere in this sheet, carries an animation whose keyframes
       * touch a filter. That is deliberately generous — it is checking that the
       * promise is *plausible*, not that the cascade resolves — because the
       * failure being guarded against is a blanket `filter` on a selector that
       * provably never has one, not a subtle mismatch.
       */
      const justified = block.selectors.some((selector) => {
        const names = animationFor.get(selector.trim());
        if (names === undefined) return false;
        return [...names].some((name) => filterAnimating.has(name));
      });
      if (!justified) offenders.push(`${where(block)}  ->  will-change: ${willChange}`);
    }
    expect(
      offenders,
      `these buy a full-surface filter pass for an animation that never sets one:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

describe("no animated backdrop-filter anywhere", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(?:css|ts)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("no @keyframes block interpolates a backdrop-filter", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const css = blankComments(readFileSync(file, "utf8"));
      const re = /@keyframes\s+([\w-]+)\s*\{/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(css)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        while (i < css.length && depth > 0) {
          if (css[i] === "{") depth += 1;
          else if (css[i] === "}") depth -= 1;
          i += 1;
        }
        const body = css.slice(re.lastIndex, i);
        if (/(?:^|[;{\s])(?:-webkit-)?backdrop-filter\s*:/.test(body)) {
          offenders.push(`${path.relative(SRC, file)}:${lineOf(css, match.index)}  @keyframes ${match[1] as string}`);
        }
      }
    }
    expect(
      offenders,
      `a backdrop-filter re-reads everything painted beneath it on every frame it changes:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("transitions.css, which owns every full-viewport surface, uses none at all", () => {
    const found = sheet
      .filter((block) => block.declarations.some((d) => /^(?:-webkit-)?backdrop-filter$/.test(d.prop)))
      .map(where);
    expect(found, `full-bleed backdrop filters in the continuity sheet:\n${found.join("\n")}`).toEqual([]);
  });
});

describe("the layer that keeps every route alive at rest is not tier-gated", () => {
  /**
   * `.atm-fore-grain` is the one moving thing on an unmigrated route, and the
   * wave-8 measurements attribute essentially all of the idle signal to it. This
   * pass parked the low tier's room crawl partly on the strength of that, so the
   * assumption is worth pinning: if a future tier rule hides the grain, the
   * reasoning behind parking the crawl stops holding.
   */
  it("no tier or contrast rule hides .atm-fore-grain", () => {
    const offenders = sheet
      .filter((block) => block.selectors.some((s) => s.includes(".atm-fore-grain")))
      .filter((block) => {
        const display = declared(block).get("display");
        return display !== undefined && display.trim() === "none";
      })
      .map(where);
    expect(offenders, `the idle floor depends on this layer:\n${offenders.join("\n")}`).toEqual([]);
  });
});
