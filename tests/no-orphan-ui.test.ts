/**
 * Nothing in the interface may be built and left unplugged.
 *
 * Two separate features were written during the visual overhaul, documented at
 * length, exported cleanly — and connected to nothing:
 *
 *   - `src/ui/intro/matchCurtain.ts` and its stylesheet, 637 lines whose whole
 *     job is to fill the wait between pressing PLAY and the mulligan. No file
 *     imported either. The defect the module's own header quotes — a near-black
 *     rectangle held for six seconds and then a cut — was still there, measured
 *     unchanged at 18/255, with the cure sitting beside it in the repository.
 *   - `setDropTarget` and `setSlotHighlight` on the battle board: implemented,
 *     exported on the board's public API, zero call sites anywhere in `src/`.
 *     Their meshes were allocated and ticked every frame and never lit, so
 *     dragging a card over a legal slot produced no feedback at all.
 *
 * Neither is carelessness. The overhaul ran six builders in parallel with strict
 * file ownership so they could not corrupt each other's work, and a builder that
 * owns `matchCurtain.ts` is forbidden from editing `shell.ts` to import it. The
 * rule that stopped the collisions also severed every wire that crosses between
 * two owners. That trade is worth making again — but only with something
 * watching the seams, because the failure is completely silent: the code
 * compiles, the tests pass, the module simply never runs.
 *
 * So this asserts the two things a reviewer cannot see in a screenshot and a
 * type-checker has no opinion about: every interface module is imported by
 * somebody, and every exported function is named by somebody other than the file
 * that declares it.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

/**
 * `tests/` and `scripts/` count as callers, and leaving them out was the first
 * version's mistake.
 *
 * Scanning `src/` alone reported two dozen orphans that were nothing of the
 * sort: `resetTextureCache` is called by a test, `boardIdFor` by a verification
 * script, `artCoverage` by the art auditor. A guard whose first run is mostly
 * false positives gets an allowlist bolted onto it until it means nothing, so
 * the honest question is "does anything at all reference this", not "does
 * anything in one folder".
 */
const CALLER_DIRS = [SRC, path.join(ROOT, "tests"), path.join(ROOT, "scripts")];

/** Every .ts/.css file under a directory, recursively, as absolute paths. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mjs|css)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** The interface itself — what is under test. */
const ALL = walk(SRC);
/** Everything that could plausibly reference it, including tests and tooling. */
const SOURCES = CALLER_DIRS.flatMap((dir) => walk(dir)).map((file) => ({
  file,
  text: readFileSync(file, "utf8"),
}));

/** `src/ui/battle/board.ts` — stable, POSIX-ish, and what a failure should print. */
const rel = (file: string): string => path.relative(path.dirname(SRC), file).replace(/\\/g, "/");

/**
 * Entry points, which are imported by the HTML or by the bundler rather than by
 * another module, so "nobody imports this" is the correct state for them.
 */
const ENTRY_POINTS = new Set(["src/main.ts", "src/ui/theme/base.css"]);

/**
 * Exports that genuinely have no in-repo caller, each with a reason.
 *
 * Keep this short and keep the reasons real. An entry added to silence a
 * failure, rather than to describe a deliberate decision, turns this file into
 * decoration.
 */
const ALLOWED_UNCALLED = new Map<string, string>([
  ["resetAssetCache", "test seam — called from tests/, not from the app"],
  ["resetIconStyles", "test seam — called from tests/, not from the app"],
]);

describe("nothing in the interface is built and left unplugged", () => {
  it("imports every interface module from somewhere", () => {
    const modules = ALL.filter((f) => rel(f).startsWith("src/ui/") && f.endsWith(".ts"));

    const orphans = modules.filter((file) => {
      const r = rel(file);
      if (ENTRY_POINTS.has(r)) return false;

      // An index barrel is reached through its directory name.
      const stem = path.basename(file, ".ts");
      const dir = path.basename(path.dirname(file));
      const names = stem === "index" ? [dir, `${dir}/index`] : [stem, `${dir}/${stem}`];

      /*
       * Static `from "…"` and dynamic `import("…")` both count.
       *
       * The first version matched only the static form and reported
       * `uiKitScreen.ts` as an orphan. It is registered in `main.ts` as
       * `await import("./ui/screens/uiKitScreen")` — lazily, because a gallery
       * of every primitive in the game has no business in the initial bundle.
       * A guard against dead code that cannot see a code-split route would send
       * somebody to delete a live screen.
       */
      return !SOURCES.some(
        ({ file: other, text }) =>
          other !== file &&
          names.some((n) =>
            new RegExp(`(from\\s+|import\\s*\\(\\s*)["'][^"']*${n}(\\.js|\\.ts)?["']`).test(text),
          ),
      );
    });

    expect(
      orphans.map(rel),
      "these interface modules are imported by nothing, so they never run — wire them up or delete them",
    ).toEqual([]);
  });

  it("gives every exported interface function a caller outside its own file", () => {
    const uncalled: string[] = [];

    for (const { file, text } of SOURCES) {
      const r = rel(file);
      if (!r.startsWith("src/ui/") || !file.endsWith(".ts")) continue;

      for (const match of text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
        const name = match[1]!;
        if (!name || ALLOWED_UNCALLED.has(name)) continue;

        /*
         * This file does not count as a caller, and forgetting that broke the
         * guard the moment a baseline was added.
         *
         * `SOURCES` spans `tests/` on purpose, because a helper called only from
         * a test is not an orphan. But the KNOWN_ORPHANS list below names all
         * thirty-nine of them as string literals — so the detector found each
         * name "somewhere else", concluded nothing was orphaned at all, and the
         * staleness check then reported the entire baseline as fixed. A guard
         * that lists what it is looking for has to exclude itself from the
         * search, or the list is the alibi.
         */
        const named = SOURCES.some(
          ({ file: other, text: otherText }) =>
            other !== file &&
            rel(other) !== "tests/no-orphan-ui.test.ts" &&
            new RegExp(`\\b${name}\\b`).test(otherText),
        );
        if (!named) uncalled.push(`${name} (${r})`);
      }
    }

    /*
     * A baseline, not an approval — and the distinction is the whole point.
     *
     * This half of the guard shipped red, on the reasoning that a visible
     * failing list is a to-do list. It is not: it blocked the deploy workflow,
     * and a check that is always failing is a check nobody reads. What it exists
     * to catch is the NEXT feature built and left unplugged — the class that
     * produced `matchCurtain.ts`, 637 lines imported by nothing — and it can do
     * that without also demanding that thirty-nine pre-existing exports be
     * resolved first.
     *
     * So the debt is written down and frozen. A fortieth orphan fails. The list
     * is also asserted not to rot: an entry that no longer exists must be
     * deleted from it, so it can only ever shrink.
     *
     * These are dead API surface, not dead features — `uiIcons` settled on
     * `icon()` and `iconDataUri()` and its six alternative entry points were
     * never adopted; `material.ts` exports four path helpers its own module
     * uses. Wiring or deleting them is real work and belongs in a wave, not in
     * the way of a deploy.
     */
    const KNOWN_ORPHANS = new Set([
      /*
       * The first three were invisible until this file stopped counting itself.
       * A comment further up names them as examples of exports "called from a
       * test / a verification script / the art auditor" — and the detector read
       * its own prose as call sites. They are genuine orphans; the explanation
       * of the guard was hiding them from the guard.
       */
      "artCoverage (src/ui/art/artLoader.ts)",
      "boardIdFor (src/ui/art/boards.ts)",
      "resetTextureCache (src/ui/art/texture.ts)",

      "alloyInto (src/ui/cardRenderer/palette.ts)",
      "amplitudeOf (src/ui/art/texture.ts)",
      "assetLoaded (src/ui/art/assetLoader.ts)",
      "badgeMetal (src/ui/screens/rewards/achievementBadge.ts)",
      "cardStack (src/ui/cardRenderer/material.ts)",
      "chooseIntro (src/ui/intro/index.ts)",
      "describeEvent (src/ui/battle/hud.ts)",
      "describeHandCard (src/ui/battle/boardModel.ts)",
      "detectQuality (src/ui/battle/scene.ts)",
      "drawArtPending (src/ui/cardRenderer/placeholderArt.ts)",
      "drawLeaderMotion (src/ui/cardRenderer/renderLeader.ts)",
      "drawStatusIcon (src/ui/cardRenderer/icons.ts)",
      "encodeDeck (src/ui/screens/deckBuilderScreen.ts)",
      "frameIntro (src/ui/intro/index.ts)",
      "gemPath (src/ui/cardRenderer/material.ts)",
      "gemPoints (src/ui/cardRenderer/material.ts)",
      "gildInto (src/ui/cardRenderer/palette.ts)",
      "hasIcon (src/ui/art/uiIcons.ts)",
      "iconElement (src/ui/art/uiIcons.ts)",
      "iconIds (src/ui/art/iconAssets.ts)",
      "iconInline (src/ui/art/uiIcons.ts)",
      "iconSprite (src/ui/art/uiIcons.ts)",
      "innerPath (src/ui/cardRenderer/frameShapes.ts)",
      "keywordIcon (src/ui/art/uiIcons.ts)",
      "meterHtml (src/ui/screens/rewards/rewardKit.ts)",
      "nobleFor (src/ui/cardRenderer/palette.ts)",
      "preloadArt (src/ui/art/artLoader.ts)",
      "preloadBoard (src/ui/art/boards.ts)",
      "railBossPath (src/ui/cardRenderer/material.ts)",
      "resetArtCache (src/ui/screens/data/art.ts)",
      "resetBadgeCache (src/ui/screens/rewards/achievementBadge.ts)",
      "resetIconSprite (src/ui/art/uiIcons.ts)",
      "resetRewardsTheme (src/ui/screens/rewards/rewardsTheme.ts)",
      "saveSize (src/ui/screens/privacyScreen.ts)",
      "seedFrom (src/ui/art/texture.ts)",
      "statusIcon (src/ui/art/uiIcons.ts)",
      "traceFrame (src/ui/cardRenderer/frameShapes.ts)",
      "traceInner (src/ui/cardRenderer/frameShapes.ts)",
      "transitionTo (src/ui/screens/rewards/rewardKit.ts)",
    ]);

    expect(
      uncalled.filter((entry) => !KNOWN_ORPHANS.has(entry)),
      "these functions are exported and named nowhere else — a feature that compiles but never runs",
    ).toEqual([]);

    /*
     * And the list cannot rot. Anything wired up or deleted must leave here too,
     * otherwise the baseline slowly becomes a licence rather than a record.
     */
    const stale = [...KNOWN_ORPHANS].filter((entry) => !uncalled.includes(entry));
    expect(
      stale,
      "these are no longer orphans — delete them from KNOWN_ORPHANS so the debt only ever shrinks",
    ).toEqual([]);
  });
});
