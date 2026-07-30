/**
 * A mode that needs a server has to say so properly.
 *
 * `docs/design/03-screens-and-navigation.md` states the rule and then names the
 * failure: *"greyed entry + 'Coming online' tag + a one-paragraph honest
 * explainer of the designed feature. Never: fake queues, placeholder friends,
 * empty-but-live-looking ladders, or disabled buttons that pretend to be
 * temporarily broken."*
 *
 * Two of the three were missing, and the anti-pattern was what shipped: Casual
 * and Ranked were bare `disabled` buttons labelled "Needs server" — which reads
 * as *broken right now* rather than *designed, partly built, honestly not
 * finished*. Nothing in `tests/` touched this screen, so nothing objected.
 *
 * It is tested here rather than only in `scripts/verify-screens.mjs` because
 * this is a claim about **honesty**, not about layout: a browser script proves
 * the panel opens, and this proves the words in it exist and are not a stub. It
 * is the same argument as `tests/fairness.test.ts`, which is why the assertions
 * below are shaped like that file's.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "./helpers/source";

const source = readFileSync(fileURLToPath(new URL("../src/ui/screens/playScreen.ts", import.meta.url)), "utf8");
/**
 * The same file with its comments removed.
 *
 * Needed because this file explains what it replaced, and quotes it while doing
 * so — a search for the old wording finds the paragraph apologising for it. See
 * `helpers/source.ts`.
 */
const code = stripComments(source);
const css = readFileSync(fileURLToPath(new URL("../src/ui/theme/screens.css", import.meta.url)), "utf8");

/**
 * Read the `MODES` array out of the screen rather than importing it.
 *
 * It is module-local and not exported, and exporting it purely so a test could
 * see it would widen the module's surface for the test's convenience. The array
 * is a plain literal, so extracting the fields that matter is honest — and if
 * the shape ever changes enough to break the extraction, the coverage
 * assertions below fail loudly rather than silently matching nothing.
 */
function modes(): { id: string; status: string; explainerParagraphs: number }[] {
  const start = source.indexOf("const MODES: ModeCard[] = [");
  const end = source.indexOf("\n];", start);
  expect(start, "could not find the MODES array").toBeGreaterThan(-1);
  const block = source.slice(start, end);

  const out: { id: string; status: string; explainerParagraphs: number }[] = [];
  // Split on `id:` so each chunk is one entry, whether written inline or spread.
  const chunks = block.split(/\{\s*\n?\s*id:/).slice(1);
  for (const chunk of chunks) {
    const id = /^\s*"([^"]+)"/.exec(chunk)?.[1];
    const status = /status:\s*"([^"]+)"/.exec(chunk)?.[1];
    if (!id || !status) continue;
    const explainer = /explainer:\s*\[([\s\S]*?)\]/.exec(chunk)?.[1] ?? "";
    out.push({ id, status, explainerParagraphs: (explainer.match(/"[\s\S]*?[^\\]"/g) ?? []).length });
  }
  return out;
}

const ALL = modes();

describe("the mode list was actually read", () => {
  it("found the modes, including the two that need a server", () => {
    // Every assertion below is over this array. If the extraction breaks, they
    // all pass vacuously and this file becomes decoration.
    expect(ALL.length).toBeGreaterThan(10);
    expect(ALL.filter((m) => m.status === "online").map((m) => m.id).sort()).toEqual(["casual", "ranked"]);
    expect(ALL.filter((m) => m.status === "available").length).toBeGreaterThan(8);
  });
});

describe("every mode that needs a server explains itself", () => {
  it.each(ALL.filter((m) => m.status !== "available"))("$id has a real explainer", (mode) => {
    expect(mode.explainerParagraphs, `${mode.id} is gated but explains nothing`).toBeGreaterThan(0);
  });

  it("says what the feature is, not just that it is missing", () => {
    /**
     * The design asks for "an honest explainer **of the designed feature**".
     * A single line reading "not available yet" satisfies the letter of a
     * presence check and none of the point, so the bar is length — enough text
     * that it must be describing something.
     */
    const start = source.indexOf("const MODES: ModeCard[] = [");
    const block = source.slice(start, source.indexOf("\n];", start));
    for (const mode of ALL.filter((m) => m.status !== "available")) {
      const chunk = block.split(/\{\s*\n?\s*id:/).find((c) => c.startsWith(` "${mode.id}"`));
      expect(chunk, `no block for ${mode.id}`).toBeDefined();
      const explainer = /explainer:\s*\[([\s\S]*?)\]/.exec(chunk!)?.[1] ?? "";
      expect(explainer.length, `${mode.id}'s explainer is too short to describe anything`).toBeGreaterThan(240);
    }
  });

  it("admits the server is not deployed rather than implying it is broken", () => {
    // The specific dishonesty this replaces. "Needs server" reads as a fault
    // report; the truth is that it is written, tested and not deployed.
    expect(code).toContain("not deployed anywhere yet");
    expect(code, "the old fault-report wording is still rendered").not.toContain("Needs server");
  });
});

describe("the tag is the one the documents use", () => {
  it('renders "Coming online", not a synonym invented by this screen', () => {
    expect(code).toContain('"Coming online"');
  });
});

describe("greyed, but not disabled", () => {
  it("gives a gated mode a click handler instead of `disabled`", () => {
    /**
     * A `disabled` button is unfocusable and unreachable by keyboard, so the
     * explainer would be hidden from exactly the players most likely to need
     * it — and the design names "disabled buttons that pretend to be
     * temporarily broken" as the thing never to ship.
     */
    expect(source).toMatch(/mode\.status === "online" && mode\.explainer/);
    expect(source).toContain("card.classList.add(\"mode-locked\")");
    expect(source).toContain('card.setAttribute("aria-haspopup", "dialog")');
  });

  it("styles the locked state without :disabled", () => {
    expect(css).toContain(".mode-card.mode-locked");
    // dimmed, but not as dim as a truly dead tile
    const locked = /\.mode-card\.mode-locked\s*\{[^}]*opacity:\s*([\d.]+)/.exec(css)?.[1];
    const dead = /\.mode-card:disabled\s*\{[^}]*opacity:\s*([\d.]+)/.exec(css)?.[1];
    expect(locked, "no opacity on .mode-locked").toBeDefined();
    expect(dead, "no opacity on :disabled").toBeDefined();
    expect(Number(locked)).toBeGreaterThan(Number(dead));
    expect(Number(locked)).toBeLessThan(1);
  });

  it("uses CSS custom properties that exist", () => {
    // `--accent-2` and `--space-sm` were both invented on the first pass and
    // neither is defined anywhere, which fails silently as an unstyled element.
    const declared = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const file of ["base.css", "battle.css"]) {
      const text = readFileSync(fileURLToPath(new URL(`../src/ui/theme/${file}`, import.meta.url)), "utf8");
      for (const match of text.matchAll(/--([a-z0-9-]+)\s*:/g)) declared.add(match[1]!);
    }
    expect(declared.size, "no custom properties were found, so nothing was checked").toBeGreaterThan(20);

    const block = css.slice(css.indexOf(".mode-card.mode-locked"), css.indexOf("/* Proper modal"));
    const used = [...block.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(used.length, "the locked-state block referenced no tokens at all").toBeGreaterThan(1);
    for (const token of used) {
      expect(declared.has(token), `--${token} is used but never declared`).toBe(true);
    }
  });
});

describe("the explainer panel is reachable and dismissable", () => {
  it("has a panel, a close button and a scrim dismiss", () => {
    expect(source).toContain('id="online-panel"');
    expect(source).toContain('id="online-cancel"');
    expect(source).toMatch(/onlinePanel\?\.addEventListener\("click"/);
  });

  it("moves focus into the panel when it opens", () => {
    // Otherwise a keyboard user opens a dialog and their focus is still behind
    // it, on a tile they cannot see.
    expect(source).toMatch(/#online-cancel"\)\?\.focus\(\)/);
  });

  it("builds the paragraphs as text, never as markup", () => {
    expect(source).toContain("p.textContent = paragraph");
    const showBlock = code.slice(code.indexOf("const showOnline"), code.indexOf("const runInProgress"));
    expect(showBlock.length, "the showOnline block was not found").toBeGreaterThan(100);
    expect(showBlock).not.toContain("innerHTML");
  });
});
