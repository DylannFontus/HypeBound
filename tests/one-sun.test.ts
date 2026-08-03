/**
 * There is one sun, and a regular expression cannot see it.
 *
 * `tests/texture-light-rig.test.ts` already pins `--light-angle` to
 * `LIGHT_RIG.world`, and that check is correct and worth keeping. It is also
 * narrow in a way that cost a review round: it proves the *token* says 315°. It
 * says nothing at all about the forty-odd gradients that do not use the token.
 * A specular wipe authored as `linear-gradient(105deg, …)` sat in
 * `foundation.css` through four rounds of review with that test green the whole
 * time — fifteen degrees off vertical on a page where every static edge obeys
 * 315°, which is the two-suns defect the foundation contract calls its single
 * most load-bearing line.
 *
 * So this one reads the angles instead of the token, and it *evaluates* them.
 * That distinction is the whole point of the file. `calc(var(--light-sweep,
 * 135deg) + 90deg)` contains the string `135deg`, mentions the rig's own custom
 * property, and is 225° — a band lying **along** the light's axis rather than
 * crossing it, which `foundation.css` itself spends thirty lines of comment
 * proving is a second light source raking the plate. Any check built on pattern
 * matching passes that expression. This one resolves the variable, folds the
 * `calc`, normalises the result and compares numbers.
 *
 * ## What is allowed, and why the list is short
 *
 * **The rig axis — 315° or 135°.** The key light and its exact reverse. CSS
 * gradients name the direction the colour *travels*, so a plate lit from the
 * top-left ramps along 135°; `--light-sweep` is that, spelled as arithmetic on
 * `--light-angle` so the two can never drift.
 *
 * **Exactly axis-aligned — 0°, 90°, 180°, 270°.** A gradient square to the
 * viewport is a scrim, a wipe, or a divider fading along its own length. It
 * carries no direction of light and there is nothing for it to disagree with:
 * the failure this file exists to catch is an *oblique* highlight pointing
 * somewhere the key light is not. Roughly twenty gradients in the theme are of
 * this kind — the header scrim, the progress fill, the two `.hairline` masks —
 * and demanding a comment on each would be noise, which is how guards get
 * deleted. The allowance is withdrawn for anything whose name says it is a band
 * of light (see `LIGHT_BAND`), because a specular sweep at 90° is a sun on the
 * left-hand wall.
 *
 * **A comment that names the angle.** The contract's own escape hatch, made
 * strict on purpose. The comment has to sit inside the rule with the
 * declaration and it has to contain the resolved figure — "225" for a 225°
 * gradient. A looser test ("is there a comment nearby?") is exactly the hole
 * that let 105° through: it lived under a forty-line prose block, as does every
 * other declaration in this codebase. Naming the number is the smallest hurdle
 * that cannot be cleared by accident.
 *
 * **A registered exception.** `JUSTIFIED` below, one entry per site, each with a
 * written reason. It is a registry rather than a comment convention because an
 * exception should be visible in one place and should rot loudly: an entry that
 * no longer matches anything in the file fails this suite, so a registration
 * cannot outlive the declaration it excused.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIGHT_RIG } from "../src/ui/art/texture";
import { blankComments, blocks, comments, customProperties, evaluateAngle, lineOf, topLevelSplit } from "./helpers/css";

/** The three sheets that draw surfaces. `screens.css` is per-screen decoration and out of module A's hands. */
const SHEETS = ["foundation.css", "transitions.css", "battle.css"] as const;

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/ui/theme/${name}`, import.meta.url)), "utf8");

/**
 * Names that mean "this gradient is a moving highlight".
 *
 * The axis-aligned allowance does not apply to these. A scrim may be vertical; a
 * specular band may not be anything but the rig axis, because it is the one
 * layer on a plate whose whole job is to say where the light is.
 */
const LIGHT_BAND = /sheen|sweep|specular|gleam|shine|shimmer|rim|bevel|glint/i;

interface AngleSite {
  readonly sheet: string;
  readonly line: number;
  readonly kind: string;
  readonly source: string;
  readonly degrees: number | null;
  /** the declaration this angle was written inside, if any */
  readonly prop: string;
  readonly selector: string;
}

/**
 * Every place one of these three sheets commits to a direction.
 *
 * Three shapes, because those are the three the theme uses: the first argument
 * of a `linear-gradient()`, the `from` clause of a `conic-gradient()`, and any
 * custom property whose name ends in `angle`. A `conic-gradient()` with no
 * `from` starts at 0° by definition and is not an authored decision, so it is
 * not collected — the battle timer ring is two of those and its `360deg` is a
 * colour-stop position rather than a direction.
 */
function angleSites(sheet: string): AngleSite[] {
  const raw = read(sheet);
  const css = blankComments(raw);
  const scope = customProperties(blocks(raw));
  const out: AngleSite[] = [];

  const context = (offset: number): { prop: string; selector: string } => {
    // walk back to the start of the declaration and to the enclosing `{`
    const declStart = Math.max(css.lastIndexOf(";", offset), css.lastIndexOf("{", offset), css.lastIndexOf("}", offset));
    const head = css.slice(declStart + 1, offset);
    const colon = head.indexOf(":");
    const braceAt = css.lastIndexOf("{", offset);
    const preludeStart = Math.max(
      css.lastIndexOf("}", braceAt),
      css.lastIndexOf("{", braceAt - 1),
      css.lastIndexOf(";", braceAt)
    );
    return {
      prop: colon === -1 ? "" : head.slice(0, colon).trim(),
      selector: braceAt === -1 ? "" : css.slice(preludeStart + 1, braceAt).replace(/\s+/g, " ").trim(),
    };
  };

  const firstArgument = (open: number): { text: string; end: number } => {
    let depth = 1;
    let i = open;
    let text = "";
    for (; i < css.length; i += 1) {
      const c = css[i] as string;
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      if (depth === 1 && c === ",") break;
      text += c;
    }
    return { text: text.trim().replace(/\s+/g, " "), end: i };
  };

  const linear = /(?:repeating-)?linear-gradient\(/g;
  let match: RegExpExecArray | null;
  while ((match = linear.exec(css)) !== null) {
    const { text } = firstArgument(match.index + match[0].length);
    if (/^to\s/i.test(text)) continue; // `to bottom` and friends are axis-aligned by construction
    const degrees = evaluateAngle(text, scope);
    if (degrees === null && !/\d\s*(deg|grad|rad|turn)|--[a-z-]*(angle|sweep)/i.test(text)) continue;
    out.push({ sheet, line: lineOf(css, match.index), kind: match[0].slice(0, -1), source: text, degrees, ...context(match.index) });
  }

  const conic = /(?:repeating-)?conic-gradient\(/g;
  while ((match = conic.exec(css)) !== null) {
    const { text } = firstArgument(match.index + match[0].length);
    const from = /^from\s+([\s\S]+?)(?:\s+at\s[\s\S]*)?$/i.exec(text);
    if (from === null) continue;
    out.push({
      sheet,
      line: lineOf(css, match.index),
      kind: match[0].slice(0, -1),
      source: text,
      degrees: evaluateAngle(from[1] as string, scope),
      ...context(match.index),
    });
  }

  for (const block of blocks(raw)) {
    for (const declaration of block.declarations) {
      if (!/^--.*angle[a-z0-9-]*$/i.test(declaration.prop)) continue;
      out.push({
        sheet,
        line: declaration.line,
        kind: "custom property",
        source: declaration.value,
        degrees: evaluateAngle(declaration.value, scope),
        prop: declaration.prop,
        selector: block.prelude.replace(/\s+/g, " ").trim(),
      });
    }
  }

  return out.sort((a, b) => a.line - b.line);
}

/**
 * The comments written inside the rule that a given line belongs to.
 *
 * Scoped to the enclosing block rather than to "the previous N lines", so the
 * forty-line essay above a selector cannot excuse a declaration twenty lines
 * inside it. That essay is where 105° lived.
 */
function commentsInEnclosingRule(sheet: string, line: number): string[] {
  const raw = read(sheet);
  const css = blankComments(raw);
  const offset = raw.split("\n").slice(0, line).join("\n").length;
  const open = css.lastIndexOf("{", offset);
  if (open === -1) return [];
  let depth = 1;
  let close = open + 1;
  for (; close < css.length && depth > 0; close += 1) {
    if (css[close] === "{") depth += 1;
    else if (css[close] === "}") depth -= 1;
  }
  return comments(raw)
    .filter((c) => c.start > open && c.end < close)
    .map((c) => c.text);
}

/**
 * Angles that are deliberately not the rig, with the reason each one is not.
 *
 * `source` must still appear verbatim on the recorded line, so an entry cannot
 * outlive the declaration it excuses — a stale registration fails this suite as
 * loudly as an unjustified angle does.
 */
const JUSTIFIED: readonly { sheet: string; line: number; source: string; reason: string }[] = [
  {
    sheet: "foundation.css",
    line: 378,
    source: "45deg",
    reason:
      "--chevron-arm-l. Every stop is either `transparent` or the ink, and every " +
      "transition between them sits at a coincident position, so this is a drawn " +
      "1.8px line rather than a shaded surface. Its partner arm is -45deg, which " +
      "is the rig angle; the pair are the two strokes of a V and carry no light.",
  },
  {
    sheet: "foundation.css",
    line: 2814,
    source: "45deg",
    reason: "The same chevron arm, restated a hair heavier under data-contrast=\"high\".",
  },
];

const AXIS_ALIGNED = new Set([0, 90, 180, 270]);

describe("one sun", () => {
  it("derives the rig angle from module B rather than restating it", () => {
    // The whole file is arithmetic against this number, so it is read rather
    // than typed. A test that hard-codes 315 stops guarding the day the rig moves.
    expect(LIGHT_RIG.cssAngle).toBe(315);
  });

  const rig = LIGHT_RIG.cssAngle;
  const reverse = (rig + 180) % 360;
  const sites = SHEETS.flatMap((sheet) => angleSites(sheet));

  it("finds the angles at all, in every sheet", () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuously true, which is the failure mode a guard can least afford.
    for (const sheet of SHEETS) {
      expect(sites.filter((s) => s.sheet === sheet).length, `${sheet} yielded no angles`).toBeGreaterThan(0);
    }
    expect(sites.some((s) => s.degrees === rig || s.degrees === reverse)).toBe(true);
  });

  it("resolves every angle it found to a number", () => {
    // `null` means "an expression this test does not model", and an unmodelled
    // angle must never read as a compliant one.
    const unresolved = sites.filter((s) => s.degrees === null).map((s) => `${s.sheet}:${s.line}  ${s.source}`);
    expect(unresolved).toEqual([]);
  });

  it("registers no exception that has stopped existing", () => {
    // Checked against the parsed sites rather than the raw line, so the registry
    // stays honest about *which angle* it excused even if the declaration is
    // reflowed across lines — which is how these are written.
    const stale = JUSTIFIED.filter(
      (entry) => !sites.some((s) => s.sheet === entry.sheet && s.line === entry.line && s.source.includes(entry.source))
    ).map((entry) => `${entry.sheet}:${entry.line} no longer declares ${entry.source}`);
    expect(stale).toEqual([]);
  });

  it("lights every gradient in the theme from 315 degrees", () => {
    const violations: string[] = [];

    for (const site of sites) {
      const degrees = site.degrees;
      if (degrees === null) continue; // reported by its own test above
      if (degrees === rig || degrees === reverse) continue;

      const isBand = LIGHT_BAND.test(`${site.prop} ${site.selector}`);
      if (!isBand && AXIS_ALIGNED.has(degrees)) continue;

      if (JUSTIFIED.some((e) => e.sheet === site.sheet && e.line === site.line && site.source.includes(e.source))) {
        continue;
      }

      const figure = String(Math.round(degrees));
      const named = commentsInEnclosingRule(site.sheet, site.line).some((text) =>
        new RegExp(`\\b${figure}\\s*(?:deg|°)?\\b`).test(text)
      );
      if (named) continue;

      violations.push(
        `${site.sheet}:${site.line} — ${site.kind}(${site.source}) resolves to ${figure}deg on ` +
          `${site.prop === "" ? site.selector : site.prop}. The rig is ${rig}deg (reverse ${reverse}deg)` +
          (isBand && AXIS_ALIGNED.has(degrees) ? "; a band of light may not be axis-aligned either" : "")
      );
    }

    expect(
      violations,
      "two suns. A `calc(var(--light-sweep) ± 90deg)` is 225deg or 45deg and both render the same " +
        "band — foundation.css §3 measured it — so the fix is to drop the offset, not to flip its " +
        "sign. An authored oblique angle either derives from the rig or joins JUSTIFIED with a reason"
    ).toEqual([]);
  });

  /**
   * The rig's two spellings, checked against each other rather than against a
   * literal. `--light-sweep` is written as `calc(--light-angle - 180deg)` so
   * that moving the key light moves both, and this is the assertion that the
   * arithmetic still lands where it should.
   */
  it("keeps --light-sweep the exact reverse of --light-angle", () => {
    const scope = customProperties(blocks(read("foundation.css")));
    expect(evaluateAngle("var(--light-angle)", scope)).toBe(rig);
    expect(evaluateAngle("var(--light-sweep)", scope)).toBe(reverse);
  });

  /**
   * And the fallback written at every use site outside module A's own file.
   *
   * `transitions.css` spells it `var(--light-sweep, 135deg)`. A fallback is a
   * second copy of the number, so it is a second place the rig can drift.
   */
  it("agrees with every fallback written for the rig tokens", () => {
    for (const sheet of SHEETS) {
      const css = blankComments(read(sheet));
      const re = /var\(\s*(--light-(?:sweep|angle))\s*,([^()]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(css)) !== null) {
        const wanted = match[1] === "--light-angle" ? rig : reverse;
        const fallback = evaluateAngle((match[2] as string).trim());
        expect(fallback, `${sheet}:${lineOf(css, match.index)} fallback for ${match[1]}`).toBe(wanted);
      }
    }
  });

  /**
   * The last hole: a gradient that names no angle at all.
   *
   * `linear-gradient(<colour>, <colour>)` is 180° by CSS default, and `to left`
   * is 270°. Both are axis-aligned and therefore fine — but a `to bottom right`
   * is oblique, viewport-dependent and unrelated to the rig, and it is the one
   * spelling that would slip past the collector above.
   */
  it("uses no oblique keyword direction", () => {
    const offenders: string[] = [];
    for (const sheet of SHEETS) {
      const css = blankComments(read(sheet));
      const re = /gradient\(\s*(to\s+[a-z\s]+?)\s*,/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(css)) !== null) {
        const words = (match[1] as string).trim().split(/\s+/).length;
        if (words > 2) offenders.push(`${sheet}:${lineOf(css, match.index)} — ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The other half of the same statement, and the reason `screens.css` is out of
 * scope: what a sheet may *not* do is invent its own name for the light.
 */
describe("nobody re-declares the light", () => {
  it("declares --light-angle exactly once, in module A's own file", () => {
    const declarations = SHEETS.flatMap((sheet) =>
      blocks(read(sheet))
        .flatMap((block) => block.declarations)
        .filter((d) => d.prop === "--light-angle")
        .map(() => sheet)
    );
    expect(declarations).toEqual(["foundation.css"]);
  });

  it("lets no sheet override --light-sweep away from the reverse of the key", () => {
    for (const sheet of SHEETS) {
      for (const block of blocks(read(sheet))) {
        for (const declaration of block.declarations) {
          if (declaration.prop !== "--light-sweep") continue;
          const scope = customProperties(blocks(read("foundation.css")));
          expect(
            evaluateAngle(declaration.value, scope),
            `${sheet}:${declaration.line} redefines --light-sweep`
          ).toBe((LIGHT_RIG.cssAngle + 180) % 360);
        }
      }
    }
  });
});
