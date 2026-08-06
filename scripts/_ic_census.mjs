/**
 * Which of the two panel languages is each screen speaking — for *every* screen.
 *
 * `foundation.css` defines `.mat-panel` — grain, rim, lip, a 315° sheen, a real
 * material. `base.css` defines a plain `.panel` — a glass fill, one 1px border,
 * one inset highlight. Both are live. A screen built on the first looks like
 * HYPEBOUND; a screen built on the second looks like the placeholder it was
 * before the overhaul started, and the eye reads the difference instantly even
 * though no single screen is *wrong*. Counting them per route turns "it feels
 * like two games" into a number somebody can act on.
 *
 * ## Why the route list is parsed out of `main.ts`
 *
 * The first version of this file carried a hand-written array of twenty-five
 * route names. The game registers forty-nine. Nobody noticed, because the census
 * printed a full-looking table with a row for every route it had been told
 * about, and every reader took the absence of `#lab` from the table as evidence
 * that `#lab` was fine. It was the worst screen in the game: zero materials,
 * five flat fills, a legacy panel and a hero clipped off the bottom of the
 * viewport, two clicks from PLAY.
 *
 * A hard-coded list measures the list. So the list is now read from the source
 * of truth — the `shell.register("…")` calls in `src/main.ts` — and the script
 * refuses to run if that yields implausibly few. Adding a screen to the game now
 * adds it to the census automatically, which is the only arrangement in which
 * this class of blindness cannot come back.
 *
 * ## Why an unreachable route is loud rather than absent
 *
 * Nine routes are matches and five of those need state that only another screen
 * can create (a Doomscroll run, a custom lobby's settings, a pending story
 * battle). A census that quietly skipped them would repeat the original mistake
 * in miniature. Every registered route therefore gets a row; a route that
 * redirected, blanked or threw says so in its `status` column and is repeated in
 * a LOUD block underneath the table, with the reason. `--strict` turns anything
 * unexplained into a non-zero exit.
 *
 * ## What it counts
 *
 *   mat      surfaces on the material system            (want: > 0 everywhere)
 *   plain    legacy `base.css` `.panel`                 (want: 0)
 *   flat     §1's banned solid fill, > 120×60px         (want: 0)
 *   outline  controls whose only edge is a 1px stroke   (want: 0, §1)
 *   glyph    unicode used as an icon instead of uiIcons (want: 0, contract C)
 *   fold     a hero cut in half at rest — informational, not a violation
 *
 * Usage:
 *   node scripts/_ic_census.mjs                 every registered route
 *   node scripts/_ic_census.mjs lab custom      just these
 *   node scripts/_ic_census.mjs --detail        name every offender
 *   node scripts/_ic_census.mjs --strict        exit 1 on any unexplained route
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const argv = process.argv.slice(2);
const DETAIL = argv.includes("--detail");
const STRICT = argv.includes("--strict");
const only = new Set(argv.filter((a) => !a.startsWith("--")));

// --- the route list, derived rather than remembered ---------------------------

/** Every `shell.register("<id>", …)` in main.ts, in source order. */
function registeredRoutes() {
  const src = readFileSync(path.join(ROOT, "src", "main.ts"), "utf8");
  const ids = [...src.matchAll(/shell\.register\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ids.length < 40) {
    // The regex broke, or main.ts changed shape. Either way the census is about
    // to measure a subset again, which is the exact failure it exists to stop.
    throw new Error(
      `_ic_census: parsed only ${ids.length} routes out of main.ts. ` +
        `Refusing to run — a census of a subset measures the subset.`
    );
  }
  return ids;
}

/** The shell's own relationship table, so the census can say what a route *is*. */
function routeTable() {
  const src = readFileSync(path.join(ROOT, "src", "ui", "shell.ts"), "utf8");
  const block = src.slice(src.indexOf("export const ROUTES"), src.indexOf("const UNKNOWN_ROUTE"));
  const table = {};
  for (const m of block.matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)) {
    table[m[1]] = { battle: /battle:\s*true/.test(m[2]), heavy: /heavy:\s*true/.test(m[2]) };
  }
  return table;
}

/**
 * Extra query parameters, and the reason a route cannot be reached cold.
 *
 * `gated` is a *declaration*, not a suppression: the route still gets a row and
 * still appears in the LOUD block. It only stops `--strict` from failing on a
 * redirect we already understand and have written down.
 */
const RECIPE = {
  // matches that deal themselves from a query string alone
  battle: { params: "seed=7&difficulty=casual", battle: true },
  tutorial: { params: "stage=1", battle: true },
  puzzle: { params: "n=1", battle: true },
  boss: { params: "tier=normal", battle: true },
  remix: { params: "", battle: true },

  // matches whose state belongs to another screen
  custombattle: {
    battle: true,
    via: { route: "custom", click: "#custom-start" },
    gated: "needs settings held in memory by #custom",
  },
  gauntletfight: {
    battle: true,
    via: { route: "gauntlet", click: "#gauntlet-fight" },
    gated: "needs an active Gauntlet run",
  },
  doomfight: {
    battle: true,
    via: { route: "doomscroll", click: "#doom-fight" },
    gated: "needs an active Doomscroll run",
  },
  storyscene: { via: { route: "story", click: ".episode-row .btn:not([disabled])" }, gated: "needs ?ch and ?ep" },
  storybattle: { battle: true, gated: "needs a pending story battle from #storyscene" },
  online: { battle: true, gated: "needs the room server; offline by design in this harness" },

  /**
   * Signed out, `#queue` calls `onNeedsSignIn` and the router lands on
   * `#signin`. That is correct behaviour and it is also why the queue screen
   * had never been surveyed: the old census listed `queue`, printed a row for
   * it, and the row described the sign-in screen. Declared here so the next
   * reader knows the row is a redirect rather than a measurement.
   */
  queue: { gated: "signed out — the screen redirects to #signin by design" },

  // ordinary screens that want an argument
  news: { params: "" },
  story: { params: "" },
  deckbuilder: { params: "" },
};

// --- the measurement ----------------------------------------------------------

/**
 * Runs inside the page. Everything it needs must be inlined — it is serialised
 * across the CDP boundary and cannot close over anything up here.
 */
function surveyPage() {
  const screen = document.querySelector(".screen");
  if (!screen) return { err: "no .screen mounted" };

  const describe = (e) => {
    const b = e.getBoundingClientRect();
    const cls = String(e.className || "").trim().split(/\s+/).slice(0, 3).join(".");
    return `${e.tagName.toLowerCase()}${cls ? "." + cls : ""} ${Math.round(b.width)}×${Math.round(b.height)}`;
  };

  const all = [...screen.querySelectorAll("*")];
  const big = all.filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 120 && b.height > 60;
  });

  const mat = big.filter((e) => /\bmat-(panel|card|chip|hero|rail|well)\b/.test(String(e.className)));
  const plain = big.filter(
    (e) => /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className))
  );

  // §1: a solid `background: #hex` on any surface larger than an icon is banned.
  const flat = [];
  for (const e of big) {
    const cs = getComputedStyle(e);
    if (cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent") continue;
    if (cs.backgroundImage !== "none") continue;
    if (cs.boxShadow !== "none") continue;
    flat.push(`${describe(e)} ${cs.backgroundColor}`);
  }

  /**
   * §1: "a `border: 1px solid` as the only edge treatment" is banned outright.
   *
   * Scoped to controls, because that is where it actually happens — an
   * outline-only pill row under a finished hero is the deck builder's tell. A
   * control counts as outline-only when it has a visible border, no background
   * image (so no gradient, no grain), a background colour of effectively nothing,
   * and no shadow of any kind.
   */
  const outline = [];
  const controls = all.filter(
    (e) => e.tagName === "BUTTON" || /\bbtn\b/.test(String(e.className)) || e.getAttribute("role") === "button"
  );
  for (const e of controls) {
    const b = e.getBoundingClientRect();
    if (b.width < 24 || b.height < 12) continue;
    const cs = getComputedStyle(e);
    const w = Math.max(
      parseFloat(cs.borderTopWidth) || 0,
      parseFloat(cs.borderRightWidth) || 0,
      parseFloat(cs.borderBottomWidth) || 0,
      parseFloat(cs.borderLeftWidth) || 0
    );
    if (w <= 0 || cs.borderTopStyle === "none") continue;
    if (cs.backgroundImage !== "none") continue;
    if (cs.boxShadow !== "none") continue;
    const alpha = (cs.backgroundColor.match(/rgba?\([^)]*?,\s*([\d.]+)\)/) ?? [])[1];
    const opaque = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && (alpha === undefined || Number(alpha) > 0.06);
    if (opaque) continue;
    outline.push(`${describe(e)} "${(e.textContent || "").trim().slice(0, 24)}"`);
  }

  /**
   * Contract C: unicode glyphs standing in for icons. They render in whatever
   * font the OS has, at the wrong weight, and become tofu where the code point is
   * missing. Only counted where the glyph is the element's whole content, so a
   * bullet inside a sentence is not a false positive.
   */
  const GLYPHS = /^[\u2190-\u21ff\u2300-\u27bf\u2b00-\u2bff\ufe0f\u25a0-\u25ff\u2600-\u26ff]+$/;
  const glyph = [];
  for (const e of all) {
    if (e.children.length) continue;
    const t = (e.textContent || "").trim();
    if (!t || t.length > 3) continue;
    if (GLYPHS.test(t)) glyph.push(`${describe(e)} "${t}"`);
  }

  /**
   * A **hero** cut in half at rest.
   *
   * Informational, not a violation, and deliberately narrow. The first version
   * of this check flagged any control straddling the fold, which on the
   * Collection meant seven card cells and on the Gallery eight tiles — a grid
   * that continues below the fold is a grid, not a defect, and a metric that
   * says otherwise is noise the next reader will learn to ignore. Restricted to
   * `.mat-hero` and `.btn-primary`, it says something worth knowing: the one
   * action this screen is for is half off the bottom edge at rest, which is the
   * Lab's "Add to board" at 1280×720 and nothing on the Collection.
   */
  const fold = [];
  const vh = window.innerHeight;
  for (const e of controls) {
    if (!/\b(mat-hero|btn-primary)\b/.test(String(e.className))) continue;
    const b = e.getBoundingClientRect();
    if (b.height < 12 || b.width < 24) continue;
    let cut = b.top < vh && b.bottom > vh + 1 ? vh : 0;
    for (let p = e.parentElement; p && !cut; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden)/.test(cs.overflowY)) continue;
      const pb = p.getBoundingClientRect();
      if (b.top < pb.bottom && b.bottom > pb.bottom + 1) cut = pb.bottom;
      break;
    }
    if (cut) fold.push(`${describe(e)} "${(e.textContent || "").trim().slice(0, 24)}" cut at y=${Math.round(cut)}`);
  }

  return {
    big: big.length,
    mat: mat.length,
    plain: plain.length,
    flat: flat.length,
    outline: outline.length,
    glyph: glyph.length,
    fold: fold.length,
    detail: { plain: plain.map(describe), flat, outline, glyph, fold },
    scrollsY: screen.scrollHeight > screen.clientHeight + 2 || document.body.scrollHeight > window.innerHeight + 2,
  };
}

// --- drive --------------------------------------------------------------------

const routes = registeredRoutes().filter((r) => only.size === 0 || only.has(r));
const table = routeTable();
const missingFromTable = registeredRoutes().filter((r) => !table[r]);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 25000 })
    .catch(() => {});

/** Where did we actually end up? The hash is the only honest answer. */
const landed = async () => (await page.evaluate(() => location.hash)).replace(/^#/, "").split("?")[0];

const rows = [];
const loud = [];

for (const route of routes) {
  const recipe = RECIPE[route] ?? {};
  const isBattle = recipe.battle || table[route]?.battle;
  const before = errors.length;
  let status = "ok";
  let note = "";

  try {
    if (recipe.via) {
      // Reach it the way a player does: through the screen that owns its state.
      await page.goto(`${ORIGIN}/?nointro#${recipe.via.route}`, { waitUntil: "networkidle" });
      await settled();
      await page.waitForTimeout(700);
      const target = page.locator(recipe.via.click).first();
      if (await target.count()) await target.click({ timeout: 5000 }).catch(() => {});
      else note = `no ${recipe.via.click} on #${recipe.via.route}`;
    } else {
      const q = recipe.params ? `?${recipe.params}` : "";
      await page.goto(`${ORIGIN}/?nointro#${route}${q}`, { waitUntil: "networkidle" });
    }
    await settled();

    if (isBattle) {
      await page.waitForSelector(".mulligan-panel", { timeout: 20000 }).catch(() => {});
      const keep = page.locator(".mulligan-actions .btn-primary");
      if (await keep.count()) await keep.first().click().catch(() => {});
      await page
        .waitForFunction(() => document.querySelector(".end-turn-btn") !== null, null, { timeout: 25000 })
        .catch(() => {});
    }
    await page.waitForTimeout(isBattle ? 1600 : 1100);
  } catch (e) {
    status = "threw";
    note = String(e.message).slice(0, 80);
  }

  const here = await landed();
  if (status === "ok" && here !== route) {
    status = `→ #${here}`;
    note = note || recipe.gated || "redirected with no declared reason";
  }

  let survey = await page.evaluate(surveyPage).catch((e) => ({ err: String(e.message).slice(0, 60) }));

  /**
   * One retry when nothing mounted, and it is not politeness.
   *
   * This runs against a live dev server that other people are editing, and a
   * Vite HMR reload landing inside the settle window leaves `#app` empty for a
   * few hundred milliseconds. A single sweep caught `#lobby` mid-reload and
   * reported "no .screen mounted" for the most-travelled route in the game —
   * which is the same class of mistake as every instrument in this project's
   * list: a confident wrong answer rather than an error. A blank that survives
   * a reload is a real blank; one that does not was the harness.
   */
  if (survey.err) {
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await settled();
    await page.waitForTimeout(1200);
    survey = await page.evaluate(surveyPage).catch((e) => ({ err: String(e.message).slice(0, 60) }));
  }
  const thrown = errors.slice(before);

  if (survey.err) {
    status = status === "ok" ? "BLANK" : status;
    note = note || survey.err;
  }

  const row = {
    route,
    kind: isBattle ? "battle" : table[route] ? "screen" : "unlisted",
    status,
    big: survey.big ?? 0,
    mat: survey.mat ?? 0,
    plain: survey.plain ?? 0,
    flat: survey.flat ?? 0,
    outline: survey.outline ?? 0,
    glyph: survey.glyph ?? 0,
    fold: survey.fold ?? 0,
    errs: thrown.length,
  };
  rows.push(row);
  if (survey.detail) row._detail = survey.detail;

  const unexplained = status !== "ok" && !recipe.gated;
  if (status !== "ok" || thrown.length) {
    loud.push({ route, status, note: note || thrown[0]?.slice(0, 90) || "", explained: !unexplained });
  }
  process.stderr.write(
    `${route.padEnd(15)} ${status.padEnd(14)} mat=${row.mat} plain=${row.plain} flat=${row.flat} outline=${row.outline}\n`
  );
}

await browser.close();

// --- report -------------------------------------------------------------------

console.log(`\nRoutes registered in main.ts: ${registeredRoutes().length}   surveyed: ${rows.length}`);
console.table(rows.map(({ _detail, ...r }) => r));

const dirty = rows.filter((r) => r.plain || r.flat || r.outline || r.glyph);
console.log(`\nClean: ${rows.length - dirty.length}/${rows.length}.  Routes with at least one violation: ${dirty.length}`);
const noMat = rows.filter((r) => r.status === "ok" && r.mat === 0);
if (noMat.length) console.log(`ZERO MATERIAL SURFACES: ${noMat.map((r) => "#" + r.route).join(" ")}`);

if (loud.length) {
  console.log(`\n=== LOUD: ${loud.length} route(s) did not survey cleanly ===`);
  for (const l of loud) {
    console.log(`  ${l.explained ? "gated " : "UNEXPLAINED "}#${l.route}  ${l.status}  ${l.note}`);
  }
}
if (missingFromTable.length) {
  console.log(`\nRegistered but absent from shell.ts ROUTES (falls through to UNKNOWN_ROUTE):`);
  console.log(`  ${missingFromTable.join(" ")}`);
}

if (DETAIL) {
  console.log(`\n=== offenders ===`);
  for (const r of rows) {
    const d = r._detail;
    if (!d) continue;
    const lines = [
      ...d.plain.map((s) => `    plain   ${s}`),
      ...d.flat.map((s) => `    flat    ${s}`),
      ...d.outline.map((s) => `    outline ${s}`),
      ...d.glyph.map((s) => `    glyph   ${s}`),
      ...d.fold.map((s) => `    fold    ${s}`),
    ];
    if (lines.length) console.log(`  #${r.route}\n${lines.join("\n")}`);
  }
}

if (STRICT && loud.some((l) => !l.explained)) process.exit(1);
