/**
 * No stylesheet may be installed in a way a Content-Security-Policy can drop.
 *
 * The desktop build ships a strict CSP and Tauri appends a per-response
 * `nonce-…` to `style-src` for its own boot styles. CSP says a directive that
 * carries a nonce **ignores `'unsafe-inline'`**, so that one addition silently
 * revoked every runtime-injected stylesheet in the app — nine of them, in the
 * icon sizing, the texture variables, the battle HUD, the collection kit, the
 * gallery, the play screen's tile art, the pack-opening room, the rewards theme
 * and the UI kit.
 *
 * Nothing caught it, and nothing could have: the browser build has no CSP at
 * all, so all nine worked in every test, in every screenshot and on GitHub
 * Pages. In the .exe they were in `<head>` with their full text and a null
 * `.sheet`. The visible symptom was three steps downstream — `.hb-icon` takes
 * its `width: 1em` from the dead sheet, so currency icons laid out at 0×0,
 * `iconAssets.ts` measured 0 against a `minPx` of 14, correctly withheld
 * `hb-mark-fits`, and the wallet rendered a bare number with no icon.
 *
 * So the rule is mechanical: `src/` creates `<style>` elements through
 * `createStyleElement`, which carries the nonce when there is one, and nowhere
 * else. This is a source check rather than a DOM one on purpose — jsdom has no
 * CSP, so a runtime test would pass on a build that is broken in the app.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..", "src");
/** The one module allowed to call `createElement("style")` — it is the fix. */
const HELPER = path.join(SRC, "ui", "styleSheet.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((file) => ({ file, text: readFileSync(file, "utf8") }));
const rel = (file: string): string => path.relative(path.dirname(SRC), file).split(path.sep).join("/");

describe("every runtime stylesheet survives a nonce-bearing CSP", () => {
  it("scanned a real source tree", () => {
    // If the walk breaks, every assertion below passes vacuously.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some(({ file }) => file === HELPER), "the helper itself is missing").toBe(true);
  });

  it("creates <style> elements only through createStyleElement", () => {
    const raw = FILES.filter(
      ({ file, text }) => file !== HELPER && /\.createElement\(\s*["']style["']\s*\)/.test(text),
    ).map(({ file }) => rel(file));

    expect(
      raw,
      "these build a <style> directly, so a CSP with a nonce drops it and the sheet never applies — use createStyleElement()",
    ).toEqual([]);
  });

  it("gives every module that installs a stylesheet the import to do it with", () => {
    const missing = FILES.filter(
      ({ file, text }) => file !== HELPER && text.includes("createStyleElement(") && !/import\s*\{[^}]*createStyleElement[^}]*\}\s*from/.test(text),
    ).map(({ file }) => rel(file));

    expect(missing, "these call createStyleElement without importing it").toEqual([]);
  });

  it("still installs at least the nine stylesheets this was written for", () => {
    /*
     * A guard that only bans a call would also pass if somebody deleted every
     * stylesheet in the game. The count is the other half of the claim.
     */
    const installers = FILES.filter(({ text }) => text.includes("createStyleElement(")).map(({ file }) => rel(file));
    expect(installers.length, `only ${installers.length} modules install a stylesheet: ${installers.join(", ")}`)
      .toBeGreaterThanOrEqual(9);
  });

  it("reads the nonce through the IDL property, not the attribute alone", () => {
    /*
     * Browsers blank the `nonce` content attribute — "nonce hiding" — so that
     * it cannot be exfiltrated through a CSS attribute selector. A helper that
     * only read `getAttribute("nonce")` would find an empty string on exactly
     * the browsers it exists for, and fail in the silent way it is meant to
     * prevent.
     */
    const helper = readFileSync(HELPER, "utf8");
    expect(helper).toMatch(/element\.nonce\s*\|\|/);
    expect(helper, "a found nonce must be cached, an empty one must not").toMatch(/if\s*\(found\)\s*NONCE\.set/);
  });
});
