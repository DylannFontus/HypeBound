/**
 * A screen is lit because it is a screen, and this is what stops that being a
 * comment.
 *
 * ## The failure this exists to catch, stated as it actually happened
 *
 * The room — four depth planes, an accent alcove at the key light, a floor that
 * gives the frame a dark mass, layers that drift so the screen is alive at rest
 * — was built as `kit.ts::room()`, a helper a screen called from inside its own
 * template. Eleven screens called it. Measured with `scripts/_w7rw_probe.mjs`,
 * whose metric reproduces the reference set at n=203 / min 0.501 / median
 * 1.713, those eleven idled at **0.88–1.89** and the other **thirty-eight at
 * 0.18–0.71**, with minima at 0.067.
 *
 * **Those figures were labelled "per 200ms" and were not.** The probe sampled
 * with `page.screenshot()` then `waitForTimeout(200)`, and a 1600x900
 * `page.screenshot()` costs 691ms, so the real interval was 843ms — every one of
 * them is a 843ms number, roughly four times the stated grid. On an 843ms grid
 * the reference set's own floor is 1.274, not 0.501, so most of the eleven
 * "alive" screens were in fact *under* the floor they were being credited with
 * clearing. The 4.9x gap between the two groups is real and the defect it
 * described was real; the absolute numbers were not. `scripts/_w9grid.mjs`
 * holds the whole reckoning, and the honest re-measurement is in
 * `scripts/_w8room_sweep.results.json`, which the last block of this file
 * asserts against.
 *
 * Everything about the room was correct. Every test in the suite passed. A
 * census that counts class names found no plain panel anywhere. The defect was
 * that being alive was **opt-in**, and the half of the game that did not opt in
 * was the half a player spends most of their time in, starting with the front
 * door. `#stats` had a lit room and `#missions`, one click away, was flat
 * near-black outside its panels.
 *
 * ## So what is asserted here is the *invariant*, never a list
 *
 * A test that enumerated the eleven and checked each one would have passed
 * throughout the entire period the defect existed — and a test that enumerated
 * all forty-nine would go stale the day somebody registers the fiftieth. Both
 * are the same mistake as the bug. Every assertion below is instead of the form
 * "there is no way for a screen to not have this":
 *
 *   1. The accent is a total function of a route id, including ids that appear
 *      nowhere in the codebase. Run against an invented one.
 *   2. Every layer the shell emits has paint somewhere.
 *   3. That paint is in a stylesheet loaded on **every** route, not in one that
 *      only the screens which already had a room pull in. This is the one that
 *      failed silently before: `hall.css` is reached through
 *      `screens/data/kit.ts`, so a room defined there is not even loadable on
 *      more than half the game.
 *   4. Nothing opts in, and nothing can. `room()` returns the empty string and
 *      `.ambient-bg` — the opaque plate that used to stand in front of the
 *      world — paints nothing inside a screen.
 *   5. The one layer that carries the measurement lives on the layer that is
 *      mounted once and never unmounted.
 *
 * ## What this deliberately does not do, and what it stopped delegating
 *
 * It does not measure. The floor — every route at or above 0.50 per 200ms with
 * a minimum above zero — needs a real browser, a real compositor and about eight
 * minutes, and it lives in `scripts/_w8room_sweep.mjs`.
 *
 * What this file used to do was *name* that script and repeat its prose: "it
 * calibrates against `hearthstone_frames/` before it reports anything and exits
 * non-zero on any route under the floor". Both halves were true and the gate was
 * still mis-scaled, because calibrating a metric is not calibrating a sample
 * interval and nothing here could tell the difference. That is how an instrument
 * error got inside a committed test for the first time in this project.
 *
 * So the last two blocks below stop taking the sweep's word for anything. One
 * asserts the *properties of the instrument* — that it samples through the
 * validated sampler, that the sampler can refuse a run whose clock slipped, and
 * that no script in the repository still contains the shape that caused this.
 * The other reads the sweep's published table and asserts the numbers in it,
 * including the interval each row was taken at. A table with no `gridMs` is
 * rejected outright: an idle figure without its interval is not a measurement,
 * and this file spent a whole wave proving it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOM_LAYERS, ROUTES, roomLightFor } from "../src/ui/shell";
import { ROOMS } from "../src/ui/atmosphere";

const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

const TRANSITIONS = read("src", "ui", "theme", "transitions.css");
const HALL = read("src", "ui", "screens", "data", "hall.css");
const KIT = read("src", "ui", "screens", "data", "kit.ts");
const SHELL = read("src", "ui", "shell.ts");
const ATMOSPHERE = read("src", "ui", "atmosphere.ts");
const MAIN = read("src", "main.ts");

/** Every route id `main.ts` actually registers, which is the real population. */
const REGISTERED = [...MAIN.matchAll(/shell\.register\(\s*"([^"]+)"/g)].map((m) => m[1]!);

/**
 * Does this stylesheet declare anything for this class — as a selector, not
 * merely as a word in a comment? Every rule in these files is prose-heavy, so
 * `includes(".d-room-grid")` matches the explanation as readily as the rule.
 */
function declares(css: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[^\\n*/]*\\.${escaped}[\\s,{:.]`, "m").test(css);
}

/**
 * Every leaf rule in a stylesheet, as `{ selector, body }`.
 *
 * Brace-naive on purpose and correct because of it: nothing in this project
 * nests declaration blocks, so a rule body contains no `{`, which means
 * `[^{}]+\{[^{}]*\}` skips right over an `@media` prelude and lands on the rule
 * *inside* it. That is exactly what is wanted here — a duplicate declaration
 * hidden inside a media query is still a duplicate declaration.
 */
function rules(css: string): Array<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }));
}

describe("the accent is a total function of a route id", () => {
  it("answers for a route that exists nowhere in this repository", () => {
    /**
     * The whole claim, executable. If somebody registers `#wardrobe` next month
     * and touches nothing else, this is what they get — and if a future change
     * makes the answer depend on a table somebody has to remember to edit, this
     * is the line that goes red.
     */
    const invented = roomLightFor("a-route-nobody-has-ever-registered");
    expect(invented.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Number(invented.lit)).toBeGreaterThan(0.5);
    expect(Number(invented.lit)).toBeLessThanOrEqual(1);
  });

  it("gives every registered route a colour from the ten rooms", () => {
    expect(REGISTERED.length, "main.ts registered nothing — the scan is broken").toBeGreaterThan(40);
    const keys = new Set(Object.values(ROOMS).map((r) => r.key));
    for (const id of REGISTERED) {
      const light = roomLightFor(id);
      expect(keys.has(light.accent), `#${id} is lit in a colour no room owns`).toBe(true);
      // A quiet room must still be *visible*: the raw 0.42 of Back Office reads
      // as an alcove nobody can see, which is how a nominally lit screen
      // measures like an unlit one.
      expect(Number(light.lit), `#${id} is lit too faintly to read`).toBeGreaterThanOrEqual(0.65);
    }
  });

  it("keeps the two doors into the workshop lit as one room", () => {
    // Not a coincidence worth asserting for its own sake — it is the property
    // that makes ten rooms read as one building, and the thing a per-screen
    // accent argument destroyed by letting each screen pick for itself.
    expect(roomLightFor("collection").accent).toBe(roomLightFor("deckbuilder").accent);
    expect(ROUTES["collection"]?.room).toBe(ROUTES["deckbuilder"]?.room);
  });
});

describe("the shell dresses every screen it mounts", () => {
  it("dresses it in the same pass that names the cascade, on the detached tree", () => {
    /**
     * Order matters twice over. Before insertion, because seven appends and two
     * custom properties on a tree nobody is observing invalidate nothing, and
     * the same writes afterwards each cost a style recalc over a whole screen —
     * the exact cost `markCascade` was written to avoid. And beside
     * `markCascade`, because `place()` is the single funnel every route passes
     * through and a second mount path is how this becomes optional again.
     */
    expect(SHELL).toMatch(/markCascade\(root\);\s*\n\s*dressScreen\(root, id\);/);
    const place = SHELL.slice(SHELL.indexOf("private place("));
    const dress = place.indexOf("dressScreen(root, id)");
    const append = place.indexOf("this.host.appendChild(root)");
    expect(dress).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(-1);
    expect(dress, "the room is built after the screen is in the document").toBeLessThan(append);
  });

  it("puts the room back when a screen rewrites its own children", () => {
    /**
     * The correction the first measured sweep forced, and the assertion that
     * keeps it. Every route came back with seven planes except **the lobby**,
     * which came back with none — not because the shell skipped it, but because
     * `lobbyScreen` sets `root.innerHTML` inside its own `render()`, and
     * `render()` runs again whenever the profile changes or the screen resumes
     * from a child. One assignment silently removes every direct child the
     * shell put there and the front door goes back to being the flat screen
     * this whole wave exists to fix.
     *
     * `childList` with **no `subtree`**: it fires only when a screen's direct
     * children change, so the Collection rebuilding two hundred cells inside
     * its body is not observed at all. A `subtree: true` here would put a
     * callback on every DOM write in the game, which is how a fix for a
     * backdrop becomes a frame-time regression.
     */
    expect(SHELL).toMatch(/new MutationObserver\(\(\) => buildRoom\(root\)\)/);
    expect(SHELL).toMatch(/watcher\.observe\(root, \{ childList: true \}\)/);
    expect(SHELL).not.toMatch(/watcher\.observe\(root, \{[^}]*subtree/);
    // …and the rebuild has to be idempotent, or a re-render stacks rooms.
    const build = SHELL.slice(SHELL.indexOf("function buildRoom("));
    expect(build.slice(0, 400)).toMatch(/if \(root\.querySelector\(":scope > \.d-room"\)\) return;/);
  });

  it("emits a full set of planes rather than a wash", () => {
    // §2 asks for four resolvable depth planes and names the failure: a screen
    // with a backdrop and content has two. The accent light, the dark mass and
    // the two drifting fields are what make the middle two resolvable.
    expect(ROOM_LAYERS).toContain("d-room-alcove");
    expect(ROOM_LAYERS).toContain("d-room-floor");
    expect(ROOM_LAYERS.filter((l) => l.startsWith("d-room-dust")).length).toBe(2);
    expect(ROOM_LAYERS.indexOf("d-room-floor")).toBe(ROOM_LAYERS.length - 1);
  });
});

describe("every layer the shell emits is painted, and painted somewhere every route loads", () => {
  it("has a rule in the continuity stylesheet for each one", () => {
    for (const layer of ROOM_LAYERS) {
      // `d-room-dust is-far` is one element wearing two classes.
      for (const cls of layer.split(" ")) {
        if (cls === "is-far") continue;
        expect(declares(TRANSITIONS, cls), `${cls} is emitted and never painted`).toBe(true);
      }
    }
    expect(declares(TRANSITIONS, "d-room")).toBe(true);
  });

  it("does not paint them a second time in the data domain's stylesheet", () => {
    /**
     * Two stylesheets declaring the same property for the same class at equal
     * specificity are settled by load order, and load order here is a property
     * of the module graph — true until somebody adds an import. `hall.css` says
     * this about itself at the top of `rooms.css`; it applies with more force to
     * a rule that has just been hoisted out of it.
     */
    const PAINT = ["background", "animation", "mask-image", "box-shadow", "inset", "opacity"];
    for (const rule of rules(HALL)) {
      if (!/\.d-room/.test(rule.selector)) continue;
      // The hall is still allowed to say *where* the room sits and to hide the
      // parts of it that only make sense beside a rail — it is not allowed to
      // say what any of it looks like.
      if (/\.d-hall/.test(rule.selector)) continue;
      for (const property of PAINT) {
        expect(
          new RegExp(`(^|;|\\n)\\s*${property}\\s*:`).test(rule.body),
          `hall.css paints "${rule.selector}" with ${property}; that moved to transitions.css`
        ).toBe(false);
      }
    }
    // …and the sanity check on the scanner itself, because a rule tokeniser
    // that silently matches nothing is a test that always passes.
    expect(rules(HALL).filter((r) => /\.d-room/.test(r.selector)).length).toBeGreaterThan(0);
  });

  it("keeps that stylesheet on the boot path, not behind a screen import", () => {
    /**
     * The silent half of the original defect. `hall.css` is reached through
     * `screens/data/kit.ts`, which is imported by the data screens and by
     * nothing else — so a room defined there is not merely un-emitted on the
     * other twenty-six routes, it is not even *loadable* on them. Moving the
     * markup without moving the paint would have produced forty-nine screens
     * with seven invisible `<div>`s in them and no error anywhere.
     */
    expect(ATMOSPHERE).toMatch(/import\s+"\.\/theme\/transitions\.css"/);
    expect(MAIN).toMatch(/mountAtmosphere/);
  });
});

describe("nothing opts in, and nothing can", () => {
  it("has no room helper left to call", () => {
    /**
     * Two acceptable states and no third. Either the helper is gone from
     * `kit.ts` outright — which is where this ends up once the eleven call
     * sites have been cleaned out of files this wave did not own — or it is
     * still exported and returns the empty string, which is the deprecation
     * that let those eleven files stay untouched while the mechanism moved.
     *
     * What is not acceptable is a helper that emits markup again. A twelfth
     * call site is not a bug in itself; a twelfth call site that *works* is,
     * because it is a screen deciding its own lighting, and eleven screens
     * deciding their own lighting is the defect this file is named after.
     */
    const at = KIT.indexOf("export function room(");
    if (at !== -1) {
      const body = KIT.slice(at, at + 400);
      expect(body).toMatch(/return\s+"";/);
    }
    expect(KIT).not.toContain("d-room-alcove");
    expect(KIT).not.toContain('class="d-room"');
  });

  it("leaves the opaque plate with no paint", () => {
    /**
     * `.ambient-bg` is `base.css`'s: a full-viewport plate at `z-index: -1`
     * whose last stop is solid `--bg-void`, standing in front of the persistent
     * world and behind the screen's own content. Sixteen screen files still
     * write the element and this wave does not edit sixteen files; §2.6 of the
     * continuity stylesheet takes its paint away instead, which is true for
     * every mount path including the two error screens that are built by hand.
     */
    const rule = TRANSITIONS.slice(TRANSITIONS.indexOf(".screen > .ambient-bg {"));
    expect(rule.slice(0, 120)).toMatch(/background:\s*none/);
    expect(TRANSITIONS).toMatch(/\.screen > \.ambient-bg::after \{\s*\n\s*content: none;/);
  });
});

describe("the layer that carries the measurement cannot be unmounted", () => {
  it("lives on the persistent front plane rather than inside a screen", () => {
    /**
     * Dust covers about a tenth of a percent of the frame; a 34px grid drifting
     * one cell in eleven seconds moves a fifth of a pixel per 200ms tick. Both
     * are for the eye. Grain covers every pixel at the highest spatial
     * frequency there is, and it is the only thing in the build that moves the
     * idle number — so it belongs on the one element that is mounted at boot,
     * outside the screen router, and never removed.
     */
    expect(ATMOSPHERE).toMatch(/layer\("atm-fore-grain"\)/);
    expect(declares(TRANSITIONS, "atm-fore-grain")).toBe(true);
    const rule = TRANSITIONS.slice(TRANSITIONS.indexOf(".atm-fore-grain {"));
    expect(rule.slice(0, 400)).toContain("var(--grain-src");
    // Compositor only. A full-viewport layer that animates a paint property is
    // the single most expensive mistake available in this file.
    expect(rule.slice(0, 400)).toMatch(/animation: atm-fore-grain-drift/);
    expect(TRANSITIONS).toMatch(/@keyframes atm-fore-grain-drift \{\s*\n\s*to \{\s*\n\s*transform: translate3d/);
  });

  it("generates the tile at every tier, including the one that used to skip it", () => {
    /**
     * The grain used to be a nicety, so the low tier skipped generating it. It
     * is now the only layer keeping a route alive at rest, and a low-tier device
     * with no `--grain-src` gets `background-image: none` and measures zero. The
     * tier's saving is taken by `--atm-strength` instead, which §1.8 already
     * drops to 0.6 and which the grain's opacity is multiplied by.
     */
    const gen = ATMOSPHERE.slice(ATMOSPHERE.indexOf("grainTile(96"));
    expect(gen).toContain("--grain-src");
    expect(ATMOSPHERE).not.toMatch(/if \(tier !== "low"\) \{\s*\n\s*const grain = grainTile/);
    const opacity = TRANSITIONS.slice(TRANSITIONS.indexOf(".atm-fore-grain {"), TRANSITIONS.indexOf(".atm-fore-grain {") + 400);
    expect(opacity).toMatch(/opacity: calc\([^)]*var\(--atm-strength\)\)/);
  });

  it("stops entirely when the tab is hidden and when motion is refused", () => {
    // Both are already properties of being inside `.atm-fore-body`; this is the
    // assertion that notices if the grain is ever lifted out of it.
    expect(ATMOSPHERE).toMatch(/foreBody\.append\([^)]*foreGrain/);
    expect(TRANSITIONS).toMatch(/\.atmosphere-fore\[data-paused="true"\] \.atm-fore-body \*/);
    expect(TRANSITIONS).toMatch(/:root\[data-reduced-motion="true"\] \.atmosphere-fore \{\s*\n\s*display: none;/);
  });

  it("keeps the grain over a match, and drops only what a board hides", () => {
    /**
     * The one exemption in the whole mechanism, and the shape of it is the
     * point. Behind an opaque three.js board the room's seven planes are
     * invisible and cost +0.79ms of frame interval, so they are not drawn — and
     * that is keyed off `RouteNode.battle`, the flag that already decides a
     * match gets the curtain rather than a descend, so it is a property of
     * being a match and not a list of ten ids.
     *
     * The **grain stays**, and that is the correction rather than the design.
     * The first version dropped both, on the reasoning that `battle/scene.ts`
     * ends its merged pass with its own `NoiseEffect` so a DOM grain over it is
     * a second grain. Good argument, wrong rule: `#boss` fell to 0.203, under
     * the floor, because a match *at rest* is the mulligan — a modal over a
     * blurred still — and the board's noise is behind both the blur and the
     * modal. Removing it left the screen with nothing moving at all.
     */
    expect(TRANSITIONS).toMatch(/:root\[data-board="true"\] \.screen > \.d-room \{\s*\n\s*display: none;/);
    expect(TRANSITIONS).not.toMatch(/:root\[data-board="true"\][^{]*\.atm-fore-grain/);
    // Written from the flag that already exists, never from a list of ids.
    expect(SHELL).toMatch(/if \(routeNode\(id\)\.battle\) board\["board"\] = "true";/);
    for (const id of ["battle", "tutorial", "puzzle", "boss", "online", "remix"]) {
      expect(ROUTES[id]?.battle, `#${id} is a match and does not say so`).toBe(true);
    }
  });

  it("collapses the room's own motion under reduced motion and high contrast", () => {
    for (const cls of ["d-room-grid", "d-room-dust", "d-room-crawl"]) {
      expect(
        new RegExp(`:root\\[data-reduced-motion="true"\\] \\.${cls}`).test(TRANSITIONS),
        `${cls} keeps moving under reduced motion`
      ).toBe(true);
    }
    // The floor is value structure, not decoration, and must survive both.
    expect(TRANSITIONS).not.toMatch(/:root\[data-reduced-motion="true"\] \.d-room-floor/);
    expect(TRANSITIONS).toMatch(/:root\[data-contrast="high"\] \.d-room-floor/);
  });
});

/* ===========================================================================
   The instrument, and then the numbers. Everything above this line is about
   the mechanism; everything below is about whether the thing that measures the
   mechanism can be trusted, which is the question wave 9 had to answer before
   any of the numbers meant anything.
   =========================================================================== */

/** Every `.mjs` under `scripts/`, with comments removed so prose cannot match code. */
function scriptSources(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) {
        out.push({
          file: path.relative(ROOT, full).replace(/\\/g, "/"),
          code: readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
        });
      }
    }
  };
  walk(path.join(ROOT, "scripts"));
  return out;
}

describe("the instrument this file delegates its measurement to", () => {
  const SWEEP = read("scripts", "_w8room_sweep.mjs");
  const IDLE_LIB = read("scripts", "lib", "idle.mjs");

  it("samples through the shared sampler instead of a loop of its own", () => {
    /**
     * The sweep used to carry its own `idleAt`, its own `meanDelta` and its own
     * `quantiles`, each introduced with a comment saying it was identical to
     * `_w7rw_probe.mjs`'s — and they were, on the day they were pasted. What
     * they were not was *jointly validated*: the copies all reproduced the
     * reference distribution and all sampled at 843ms. One sampler, validated
     * once, in a file whose whole job is to be argued with.
     */
    expect(SWEEP).toMatch(/from "\.\/lib\/idle\.mjs"/);
    expect(SWEEP).toMatch(/createIdleSampler\(page, \{ lagMs: LAG_MS/);
    expect(SWEEP, "the sweep has grown a second copy of the metric").not.toMatch(/^function meanDelta\(/m);
  });

  it("can refuse a run whose clock slipped, and the sweep acts on the refusal", () => {
    /**
     * The single line that would have caught instrument eleven on the day it
     * was written. `onGrid` is the sampler's own verdict on whether it held the
     * interval it was asked for; a probe that computes it and then does not
     * consult it is no better than one that never measured it.
     */
    expect(IDLE_LIB).toMatch(/onGrid:\s*drift !== null && drift <= 0\.08/);
    // The achieved interval is returned, not merely computed and discarded.
    expect(IDLE_LIB).toMatch(/^\s*grid,\s*$/m);
    expect(SWEEP).toMatch(/!stats\.onGrid/);
    expect(SWEEP).toMatch(/OFF GRID/);
  });

  it("leaves no script in the repository sampling on a grid it cannot hold", () => {
    /**
     * The shape, banned repository-wide, because it was never confined to one
     * file: `_w7rw_probe.mjs`, `_w8room_sweep.mjs`, `_w8col_idle.mjs`,
     * `_ic6_board.mjs` and `_ic6_journey.mjs` all carried it, all against a
     * floor written per 200ms, and all had "calibrated".
     *
     *     shots.push(decodePng(await page.screenshot()));
     *     await page.waitForTimeout(200);
     *
     * What is banned is precisely a **capture inside a loop with a fixed sleep
     * beside it**: a cadence that has budgeted nothing for the capture, so the
     * period it achieves is the period plus however long the camera took. Two
     * screenshots seven hundred milliseconds apart to test whether a reduced-
     * motion screen is byte-identical is not that, and `_w4b_a11y.mjs` does
     * exactly that and is not an offender — which is why this looks for the
     * loop rather than for the two calls.
     *
     * `_w9grid.mjs` is exempt and must be: it keeps the defective loop verbatim
     * as the control arm of the experiment that condemned it, which is the one
     * place in the repository where the shape is evidence rather than a defect.
     */
    const EXEMPT = new Set(["scripts/_w9grid.mjs"]);
    const offenders = scriptSources()
      .filter((s) => !EXEMPT.has(s.file))
      .filter((s) =>
        s.code
          .split(/\bfor\s*\(/)
          .slice(1)
          .some((body) => {
            const head = body.slice(0, 400);
            return /await\s+page\.screenshot\(\s*\)/.test(head) && /await\s+page\.waitForTimeout\(/.test(head);
          })
      )
      .map((s) => s.file);
    expect(
      offenders,
      `these sample with an unbudgeted capture and quote the result against a per-200ms floor: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("is calibrated against a reference set that really is 200ms apart", () => {
    /**
     * The assumption underneath every floor in this project, never once
     * checked. `hearthstone_frames/` carries its own clock in its filenames —
     * `frame_00042_t00008.40s.png` — so "per 200ms" is falsifiable in about
     * four lines. A single dropped frame anywhere in the sequence would make
     * its neighbours 400ms apart and quietly move the floor.
     *
     * Skipped rather than failed when the directory is absent: the frames are
     * Blizzard's and gitignored, so a clean checkout legitimately has none.
     */
    const dir = path.join(ROOT, "hearthstone_frames");
    if (!existsSync(dir)) return;
    const stamps = readdirSync(dir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => {
        const m = /frame_(\d+)_t(\d+\.\d+)s\.png$/.exec(f);
        return m ? { index: Number(m[1]), t: Math.round(Number(m[2]) * 1000) } : null;
      });
    expect(stamps.every((s) => s !== null), "a reference frame does not carry its own timestamp").toBe(true);
    expect(stamps.length).toBeGreaterThan(100);
    const steps = new Set(stamps.slice(1).map((s, i) => s!.t - stamps[i]!.t));
    expect([...steps], "the reference set is not on one uniform grid, so 'per 200ms' is not true of it").toEqual([200]);
  });
});

describe("the published table, and the numbers in it", () => {
  /**
   * `scripts/_w8room_sweep.results.json` is written by a full default sweep and
   * read here. It is the corrected replacement for a paragraph of prose: before
   * wave 9 this file described the sweep's findings in a comment, and a comment
   * cannot go red when the findings stop being true.
   */
  const TABLE_PATH = path.join(ROOT, "scripts", "_w8room_sweep.results.json");
  type Row = {
    route: string;
    n: number;
    min: number | null;
    median: number | null;
    max: number | null;
    gridMs: number | null;
    onGrid: boolean;
    planes: number;
    planesInDom: number;
    drawnLayers: string[];
    hall: boolean;
    rail: boolean;
    board: boolean;
    missed: boolean;
    pageErrors: number;
  };
  type Table = { lagMs: number; floor: number; viewport: string; routes: Row[] };
  /**
   * Read inside the tests, never at collection time.
   *
   * A `readFileSync` in the describe body turns a missing table into a *suite*
   * error, which takes the twenty static assertions above it down with it — and
   * those are the half that runs on every commit and needs no browser. A missing
   * table should cost one red test with an instruction in it.
   */
  const load = (): Table => {
    expect(
      existsSync(TABLE_PATH),
      "no measured table — run `node scripts/_w8room_sweep.mjs idle` with the dev server up"
    ).toBe(true);
    return JSON.parse(readFileSync(TABLE_PATH, "utf8")) as Table;
  };
  const rowsOf = (table: Table): Row[] => table.routes.filter((r) => !r.missed);

  it("was taken at the interval it is compared against", () => {
    const table = load();
    const measured = rowsOf(table);
    /**
     * The assertion this whole wave exists for, and the one that has to come
     * first: a table of idle figures with no record of the interval they were
     * sampled at is not evidence of anything. Eight per cent is the sampler's
     * own tolerance; every row of the honest sweep sits inside one per cent.
     */
    expect(table.lagMs).toBe(200);
    expect(table.viewport).toBe("1600x900");
    for (const row of measured) {
      expect(row.gridMs, `${row.route} has no recorded interval — it is not a measurement`).not.toBeNull();
      expect(
        Math.abs(row.gridMs! - table.lagMs) / table.lagMs,
        `${row.route} was sampled at ${row.gridMs}ms and compared to a ${table.lagMs}ms floor`
      ).toBeLessThanOrEqual(0.08);
      expect(row.onGrid).toBe(true);
    }
  });

  it("covers every route main.ts registers", () => {
    const table = load();
    // A table that has quietly stopped covering a route is the same failure as
    // a hand-kept list of which screens get a room.
    const inTable = new Set(table.routes.map((r) => r.route));
    const absent = REGISTERED.filter((id) => !inTable.has(id));
    expect(absent, `re-run scripts/_w8room_sweep.mjs — these routes are not in the table: ${absent.join(", ")}`).toEqual(
      []
    );
  });

  it("was taken against an app that was not falling over at the time", () => {
    const measured = rowsOf(load());
    // A route measured after a dev-server 500 is a measurement of a broken app
    // wearing that route's name. The first honest sweep lost twenty-six rows
    // this way and reported them as roomless.
    const noisy = measured.filter((r) => r.pageErrors > 0).map((r) => `${r.route}(${r.pageErrors})`);
    expect(noisy, `page errors were raised while these were on screen: ${noisy.join(" ")}`).toEqual([]);
  });

  it("has every measured route at or above the floor", () => {
    const table = load();
    const measured = rowsOf(table);
    const under = measured
      .filter((r) => r.median === null || r.median < table.floor)
      .map((r) => `${r.route}@${r.median}`);
    expect(under, `under ${table.floor} per ${table.lagMs}ms: ${under.join(" ")}`).toEqual([]);
  });

  it("has no route that froze for a whole tick", () => {
    const measured = rowsOf(load());
    // A zero minimum is a frame that did not change at all in 200ms, which the
    // reference set never does — its quietest tick is 0.501.
    const frozen = measured.filter((r) => r.min !== null && r.min <= 0).map((r) => r.route);
    expect(frozen, `these produced an identical pair of frames: ${frozen.join(" ")}`).toEqual([]);
  });

  it("found a full room drawn on every route that is not behind a board", () => {
    /**
     * The invariant the top of this file asserts statically, confirmed against a
     * real compositor — and `planes` counts what is **drawn**, not what is in
     * the DOM. That distinction is the reason this assertion is worth anything.
     * The sweep's census used to count `room.children.length`, which counts a
     * `display: none` element as readily as a painted one, so the six match
     * routes passed it while their rooms were switched off by
     * `:root[data-board="true"]` — the right outcome, reached by an argument
     * that would equally have passed a route whose room went missing by mistake.
     */
    /**
     * And the assertion is on *which* planes, not how many, because the one
     * legitimate omission has a name. `hall.css` §5 hides `.d-room-wall` on a
     * **hall** with no rail standing in it — the wall is positioned against the
     * rail track, so without a rail there is nothing for it to be the wall of.
     * `#story` draws six of seven for exactly that reason. A count makes that
     * indistinguishable from a plane going missing by accident; naming it means
     * a *different* absent plane still goes red.
     *
     * The exemption needs both halves of the CSS condition. Keyed on `rail`
     * alone it would also excuse a missing wall on the thirty-odd routes that
     * are not halls at all — `#legal` has no rail and draws its wall — which is
     * a licence the stylesheet never granted.
     *
     * It is deliberately *narrower* than the stylesheet rather than wider. The
     * full rule is `.d-hall` and (`.d-hall-solo` or no `.d-rail`); this checks
     * `.d-hall` and no `.d-rail`, so a hall that is solo *and* has a rail would
     * come back red. No such screen exists today, and if one is added the error
     * is a false alarm somebody investigates — which is the survivable direction
     * for a guard to be wrong in. The other direction is how this project got
     * eleven confident wrong answers.
     */
    const measured = rowsOf(load());
    /**
     * Counted, not set-compared: `ROOM_LAYERS` names `d-room-dust` twice — the
     * near field and `d-room-dust is-far` — and a set comparison would call a
     * screen with one of the two dust planes complete.
     */
    const tally = (names: readonly string[]): Map<string, number> => {
      const out = new Map<string, number>();
      for (const n of names) out.set(n, (out.get(n) ?? 0) + 1);
      return out;
    };
    const bare: string[] = [];
    for (const row of measured) {
      if (row.board) continue;
      const wallExempt = row.hall && !row.rail;
      const want = tally(ROOM_LAYERS.map((l) => l.split(" ")[0]!).filter((l) => !wallExempt || l !== "d-room-wall"));
      const got = tally(row.drawnLayers);
      const missing = [...want].filter(([n, k]) => (got.get(n) ?? 0) < k).map(([n, k]) => `${n}x${k - (got.get(n) ?? 0)}`);
      if (missing.length) bare.push(`${row.route} is missing ${missing.join("+")} (drew ${row.drawnLayers.join(",")})`);
    }
    expect(bare, `planes emitted but not drawn: ${bare.join("; ")}`).toEqual([]);
  });

  it("drops the room behind a board, and only there, and keeps it in the DOM", () => {
    /**
     * The exemption, asserted as an exemption rather than assumed. A match must
     * have its room *dropped* — behind an opaque board the seven planes are
     * invisible and cost +0.79ms of frame interval — but it must still have been
     * built, because `data-board` comes off the moment the match ends and
     * nothing rebuilds a room that was never there.
     */
    const table = load();
    const boards = rowsOf(table).filter((r) => r.board);
    expect(boards.length, "no route reported itself as a board; the flag is not reaching the census").toBeGreaterThan(0);
    for (const row of boards) {
      expect(row.planes, `#${row.route} is a board and is still drawing its room`).toBe(0);
      expect(row.planesInDom, `#${row.route} is a board and was never given a room to drop`).toBe(ROOM_LAYERS.length);
      expect(row.median, `#${row.route} lost the grain along with the room`).toBeGreaterThanOrEqual(table.floor);
    }
  });
});
