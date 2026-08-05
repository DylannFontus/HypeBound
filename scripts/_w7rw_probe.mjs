/**
 * The reward moment, the End Turn press and the cold boot, measured rather than
 * described.
 *
 * ## Why this file exists at all
 *
 * Eight instruments have lied in this project, and the four findings this wave
 * handed me were produced by `_ic6_journey.mjs`, which is the ninth candidate:
 * its `drop` stage clicks `#rw-pack`, and `packOpening.ts::packMarkup` emits
 * `class="rw-pack"` with **no id**. Playwright throws, the stage swallows the
 * throw in a `.catch(e => console.log(...))`, and the 3.8s reel that follows is
 * a reel of a page nobody touched. "Peak delta 0.56, no response at all" is
 * exactly what a screen looks like when the click never happened.
 *
 * So this probe does three things the journey did not:
 *
 * 1. **It proves the click landed** before it reports on what the click did. A
 *    capture listener on the overlay records every pointerdown and click with
 *    its target, and a run whose reel shows nothing but whose log shows no event
 *    says "NOT CLICKED" instead of "dead affordance".
 * 2. **It resolves the selector by hand first** and prints what it found, so a
 *    missing id is a printed line rather than a swallowed exception.
 * 3. **It calibrates before it measures.** `calib` recomputes the Hearthstone
 *    idle floor from `hearthstone_frames/` with this file's own `meanDelta`, and
 *    then measures the lobby and the board, whose published figures (3.01 and
 *    5.47) were produced by a different script. If those three numbers do not
 *    come back, the metric here is not the metric the floors were written
 *    against and nothing below it can be compared to them.
 *
 * PNG, never JPEG — `lib/png.mjs` explains why in full: JPEG's own quantisation
 * noise is about 0.3 mean absolute delta between two *identical* frames, which
 * is a fifth of the reference median, so a JPEG reel reports a frozen screen as
 * alive.
 *
 *   node scripts/_w7rw_probe.mjs calib
 *   node scripts/_w7rw_probe.mjs idle <route> [--seconds n]
 *   node scripts/_w7rw_probe.mjs pack        -- the whole reveal, click by click
 *   node scripts/_w7rw_probe.mjs endturn     -- press latency on a live board
 *   node scripts/_w7rw_probe.mjs drop        -- card drop, and the ambient under it
 *   node scripts/_w7rw_probe.mjs boot        -- cold boot, first pixel to cinematic
 *   node scripts/_w7rw_probe.mjs handtray    -- hand card vs Hype tray overlap
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "calib";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const UI_SCALE = Number(flag("scale-ui", 0)) || 0;
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w7", "rewards")));
mkdirSync(OUT, { recursive: true });

/** Mean absolute per-channel delta, identical arithmetic to `_ic6_calib.mjs`. */
function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < n; i += a.channels) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

const quantiles = (values) => {
  const s = [...values].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: q(0),
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
};
const f3 = (x) => (x === undefined || x === null ? "-" : x.toFixed(3));

/* ---------------------------------------------------------------------------
   calib: does this file's metric reproduce the numbers the floors are written
   against? Run before anything else, every time.
   --------------------------------------------------------------------------- */

if (mode === "calib") {
  const dir = path.join(HERE, "..", "hearthstone_frames");
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const deltas = [];
  let prev = null;
  for (const file of files) {
    const img = decodePng(readFileSync(path.join(dir, file)));
    if (prev) deltas.push(meanDelta(prev, img));
    prev = img;
  }
  const s = quantiles(deltas);
  console.log(
    `[reference] hearthstone_frames  n=${s.n}  min=${f3(s.min)}  median=${f3(s.median)}  ` +
      `p90=${f3(s.p90)}  max=${f3(s.max)}    (published: min 0.50, median 1.71)`
  );
  process.exit(0);
}

/* --------------------------------------------------------------------------- */

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  // Permits the software fallback; never forces it. See shot.mjs on why
  // --use-gl=angle --use-angle=swiftshader is not here.
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`console: ${m.text()}`));

const session = await page.context().newCDPSession(page);
let reel = [];
let filming = false;
session.on("Page.screencastFrame", (f) => {
  if (filming) reel.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

async function startFilm() {
  reel = [];
  filming = true;
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: VW, maxHeight: VH });
}

/**
 * Stop the reel and report it.
 *
 * `moveAt` is the first frame whose delta clears `threshold`, timed from `t0`,
 * which is the wall clock of the action — so it answers "how long after the
 * press did any pixel move". The threshold is 0.5 because that is the *minimum*
 * of the reference set: below it, a real game at its quietest is
 * indistinguishable from a still.
 */
async function stopFilm(label, t0, { keep = 0, threshold = 0.5, print = 40 } = {}) {
  filming = false;
  await session.send("Page.stopScreencast").catch(() => {});
  const frames = reel.map((f) => ({ t: Math.round(f.t - t0), buf: Buffer.from(f.data, "base64") }));
  const rows = [];
  let prev = null;
  for (const f of frames) {
    const img = decodePng(f.buf);
    rows.push({ t: f.t, d: prev ? meanDelta(prev, img) : null });
    prev = img;
  }
  /**
   * The same reel, re-differenced at the reference's own 200ms lag.
   *
   * Consecutive frames at 45fps are 22ms apart, and a 3.6s breathe moves about
   * 0.2% of its amplitude in 22ms — so a frame-to-frame reel reports a screen
   * that is genuinely, visibly breathing as 0.00. That is how the boot plate
   * came to be described as "static": not because it is, but because the metric
   * used to judge it was sampled forty times faster than the thing it was
   * judging. Every published floor in this wave is a **200ms** figure, so the
   * reel is differenced at 200ms as well, against the same frames.
   */
  const lagged = [];
  for (let i = 0; i < rows.length; i += 1) {
    const target = rows[i].t + 200;
    let j = i + 1;
    while (j < rows.length - 1 && Math.abs(rows[j + 1].t - target) < Math.abs(rows[j].t - target)) j += 1;
    if (j >= rows.length || Math.abs(rows[j].t - target) > 90) continue;
    lagged.push({ t: rows[i].t, d: meanDelta(decodePng(frames[i].buf), decodePng(frames[j].buf)) });
  }
  const moved = rows.find((r) => r.d !== null && r.d > threshold);
  const last = [...rows].reverse().find((r) => r.d !== null && r.d > threshold);
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].t - rows[i - 1].t);
  console.log(
    `\n[film] ${label}: ${rows.length} frames over ${rows.length ? rows[rows.length - 1].t - rows[0].t : 0}ms ` +
      `(median gap ${gaps.length ? quantiles(gaps).median : "-"}ms => ${
        gaps.length ? (1000 / quantiles(gaps).median).toFixed(0) : "-"
      }fps)`
  );
  console.log(
    `       first-move=${moved ? moved.t + "ms" : "NEVER"}  last-move=${last ? last.t + "ms" : "-"}  ` +
      `peak=${Math.max(0, ...rows.map((r) => r.d ?? 0)).toFixed(2)}`
  );
  if (lagged.length) {
    const s = quantiles(lagged.map((r) => r.d));
    console.log(
      `       @200ms lag: n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}  ` +
        `[reference min 0.50 median 1.71]  ${s.median < 0.5 ? "BELOW REFERENCE FLOOR" : "alive"}`
    );
  }
  if (print) {
    console.log(
      "       " + rows.slice(0, print).map((r) => `${r.t}:${r.d === null ? "-" : r.d.toFixed(2)}`).join(" ")
    );
    if (lagged.length) {
      console.log(
        "  @200  " + lagged.slice(0, print).map((r) => `${r.t}:${r.d.toFixed(2)}`).join(" ")
      );
    }
  }
  if (keep > 0 && frames.length) {
    for (let k = 0; k < keep; k += 1) {
      const f = frames[Math.min(frames.length - 1, Math.round((k * (frames.length - 1)) / (keep - 1 || 1)))];
      writeFileSync(path.join(OUT, `${label}-f${k}-t${f.t}.png`), f.buf);
    }
  }
  return rows;
}

/**
 * Sample at rest on a 200ms grid, exactly like the reference frames.
 *
 * `require` is not optional politeness. A run of this probe measured the shop
 * for three seconds and printed it under the label "pack at anticipation",
 * because the overlay it was supposed to be photographing had never opened — the
 * same class of mistake as the `#rw-pack` selector that produced this wave's
 * second finding, one level up. A measurement that cannot prove it is looking at
 * its subject is not a measurement.
 */
async function idle(label, seconds = 3, require = null) {
  if (require) {
    const found = await present(require);
    if (!found) {
      console.log(`[idle] ${label}: SUBJECT ABSENT (${require} not in the DOM) — no number reported`);
      return null;
    }
  }
  const shots = [];
  for (let i = 0; i * 0.2 < seconds; i += 1) {
    shots.push(decodePng(await page.screenshot()));
    await page.waitForTimeout(200);
  }
  const ds = [];
  for (let i = 1; i < shots.length; i += 1) ds.push(meanDelta(shots[i - 1], shots[i]));
  const s = quantiles(ds);
  console.log(
    `[idle] ${label}: n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}  ` +
      `[reference min 0.50 median 1.71]  ${s.median < 0.5 ? "BELOW REFERENCE FLOOR" : "alive"}`
  );
  return s;
}

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return path.join(OUT, `${name}.png`);
};

const settled = () =>
  page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 }).catch(() => {});

/**
 * Watch the real input events, so a reel that shows nothing can be told apart
 * from a click that never happened. This is the whole reason this probe exists.
 */
const WATCH_INPUT = () => {
  window.__hits = [];
  for (const type of ["pointerdown", "click", "keydown"]) {
    document.addEventListener(
      type,
      (e) => {
        const el = e.target;
        window.__hits.push({
          type,
          t: Math.round(performance.now()),
          cls: el && el.className ? String(el.className).slice(0, 60) : "",
          tag: el && el.tagName,
          key: e.key,
        });
      },
      true
    );
  }
};
const hits = async () => page.evaluate(() => window.__hits ?? []);
const clearHits = () => page.evaluate(() => (window.__hits = []));

/** Resolve a selector by hand and say what was found, instead of throwing. */
async function present(selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 70), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  }, selector);
}

/**
 * Set the interface scale **through the settings store**, after the page it is
 * meant to affect has loaded.
 *
 * The obvious version of this — write `hypebound:settings` in localStorage
 * before navigating, and set `--ui-scale` inline — is what `_ic6_journey.mjs`
 * does, and it does not work. Verified by reading the computed property back:
 * `--ui-scale` came back as `1` at both `--scale-ui 1.4` and `1.6`, so every
 * measurement that harness has ever taken "at 1.4" was taken at 1.0. Two
 * separate reasons, either of which is sufficient: an inline style set before a
 * `page.goto` does not survive the navigation, and `save/storage.ts` versions
 * and migrates its records, so a hand-written `{ data: {...} }` is not
 * necessarily a record the store will accept — the same trap `lib/account.mjs`
 * documents at length about seeding a collection.
 *
 * So it goes through `updateSettings`, which is the function the settings screen
 * itself calls, and then the value is read back and asserted. A scale that did
 * not apply says so instead of quietly measuring 100%.
 */
async function applyUiScale() {
  /*
   * Reduced motion and high contrast go through the same door, and for the same
   * reason: they are settings, and the settings screen is the only thing that
   * knows how to apply one.
   */
  const patch = {};
  if (UI_SCALE) patch.uiScale = UI_SCALE;
  if (argv.includes("--reduced-motion")) patch.reducedMotion = true;
  if (argv.includes("--high-contrast")) patch.highContrast = true;
  if (Object.keys(patch).length) {
    await page.evaluate(async (p) => {
      const mod = await import("/src/save/settings.ts");
      mod.updateSettings(p);
    }, patch);
    await page.waitForTimeout(200);
    console.log(
      "[settings] " +
        (await page.evaluate(
          () =>
            `reducedMotion=${document.documentElement.dataset.reducedMotion} contrast=${document.documentElement.dataset.contrast}`
        ))
    );
  }
  if (!UI_SCALE) return;
  await page.waitForTimeout(200);
  const got = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
  );
  console.log(`[scale] asked for ${UI_SCALE}, document reports ${got}`);
  if (Number(got) !== UI_SCALE) console.log("!! UI SCALE DID NOT APPLY — numbers below are at the wrong scale");
}

try {
  /* ------------------------------------------------------------------ idle */
  if (mode === "idle") {
    const route = argv[1] ?? "lobby";
    const seconds = Number(flag("seconds", 4));
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await applyUiScale();
    await settled();
    await page.waitForTimeout(1600);
    await shot(`idle-${route}`);
    await idle(route, seconds);
  }

  /* ------------------------------------------------------------------ pack */
  if (mode === "pack") {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
    await applyUiScale();
    await settled();
    await page.waitForTimeout(1500);
    await page.evaluate(WATCH_INPUT);

    // buy
    await startFilm();
    let t0 = Date.now();
    await page.locator("#shop-buy").click({ timeout: 8000 });
    await page.waitForTimeout(2600);
    // Before the reel is decoded, not after: decoding three hundred 1600x900
    // PNGs takes the better part of a minute of wall clock, and a DOM read on
    // the far side of it is a read of a different moment than the one filmed.
    console.log("[dom] immediately after buy ->", JSON.stringify(await present(".rw-pack")));
    await stopFilm("pack-01-buy", t0, { keep: 6 });
    await shot("pack-02-anticipation");
    await idle("pack at anticipation", 3, ".rw-pack");

    // What is actually in the DOM? The journey clicked #rw-pack.
    console.log("\n[dom] #rw-pack       ->", JSON.stringify(await present("#rw-pack")));
    console.log("[dom] .rw-pack       ->", JSON.stringify(await present(".rw-pack")));
    console.log("[dom] .rw-open-room  ->", JSON.stringify(await present(".rw-open-room")));
    console.log("[dom] .reveal-cards  ->", JSON.stringify(await present(".reveal-cards")));

    // the tear, clicked for real at the pack's own centre
    await clearHits();
    await startFilm();
    t0 = Date.now();
    const box = await page.locator(".rw-pack").boundingBox();
    console.log(`[click] .rw-pack box ${JSON.stringify(box)}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(3800);
    const rows = await stopFilm("pack-03-tear", t0, { keep: 10, print: 60 });
    const seen = await hits();
    console.log("[input] events during tear: " + JSON.stringify(seen));
    if (!seen.some((h) => h.type === "click")) console.log("!! NOT CLICKED — the reel above measures nothing");
    console.log(`[verdict] torn = ${(await page.locator(".rw-pack").count()) === 0}`);
    console.log(`[verdict] shown slots = ${await page.locator(".reveal-slot.shown").count()}`);
    void rows;
    await shot("pack-04-dealt");

    // one card, clicked
    await clearHits();
    await startFilm();
    t0 = Date.now();
    const slot = page.locator(".reveal-slot:not(.shown)").first();
    if (await slot.count()) {
      const sb = await slot.boundingBox();
      await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    }
    await page.waitForTimeout(1400);
    await stopFilm("pack-05-flip", t0, { keep: 6 });
    console.log("[input] events during flip: " + JSON.stringify(await hits()));
    console.log(`[verdict] shown slots = ${await page.locator(".reveal-slot.shown").count()}`);

    // finish and look at the room
    await page.evaluate(() => document.getElementById("reveal-all")?.click());
    await page.waitForTimeout(2600);
    await shot("pack-06-revealed");
    await idle("reveal at rest", 3, ".reveal-slot.shown");
  }

  /* --------------------------------------------------------------- endturn */
  if (mode === "endturn" || mode === "endturncost" || mode === "drop" || mode === "handtray") {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
    await applyUiScale();
    await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => console.log("no mulligan"));
    await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 60000 })
      .catch(() => console.log("!! never got an enabled end-turn"));
    await page.waitForTimeout(2500);
    await page.evaluate(WATCH_INPUT);
    await shot(`${mode}-00-board`);
    await idle("board at rest", 4);

    if (mode === "handtray") {
      const geom = await page.evaluate(() => {
        const tray = document.querySelector(".hype-wrap");
        const cards = [...document.querySelectorAll(".hand-card")];
        const t = tray ? tray.getBoundingClientRect() : null;
        return {
          scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
          vw: innerWidth,
          vh: innerHeight,
          tray: t ? [Math.round(t.x), Math.round(t.y), Math.round(t.right), Math.round(t.bottom)] : null,
          cards: cards.map((c) => {
            const r = c.getBoundingClientRect();
            const overlap = t ? Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left)) : 0;
            const vOverlap = t ? Math.max(0, Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top)) : 0;
            return {
              i: c.dataset.index ?? "",
              box: [Math.round(r.x), Math.round(r.y), Math.round(r.right), Math.round(r.bottom)],
              overlapPx: overlap > 0 && vOverlap > 0 ? Math.round(overlap) : 0,
            };
          }),
        };
      });
      console.log(JSON.stringify(geom, null, 1));
    }

    if (mode === "endturn") {
      // Where does the 306ms go? Film from the pointer going down.
      for (let round = 0; round < 2; round += 1) {
        /*
         * Nothing is measured while a modal is up. A confirm dialogue left over
         * from the previous round dims the board behind it and swallows the
         * press — which reads, in a reel, as "the button did not respond", and
         * is the same species of mistake as filming a page nobody clicked.
         */
        await page
          .waitForFunction(
            () =>
              document.querySelector(".end-turn-btn:not([disabled])") !== null &&
              document.querySelectorAll(".battle-overlay").length === 0,
            null,
            { timeout: 60000 }
          )
          .catch(async () =>
            console.log(
              `!! not pressable: overlays=${await page.locator(".battle-overlay").count()} ` +
                `enabled=${await page.locator(".end-turn-btn:not([disabled])").count()}`
            )
          );
        await page.waitForTimeout(1200);
        const b = await page.locator(".end-turn-btn").boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(400);
        await clearHits();
        // What the button's own computed style does, frame by frame, from the
        // pointerdown. This is the half a reel cannot see: whether the class
        // landed and the browser simply did not paint it.
        await page.evaluate(() => {
          const btn = document.querySelector(".end-turn-btn");
          window.__style = [];
          window.__t0 = performance.now();
          const tick = () => {
            const cs = getComputedStyle(btn);
            window.__style.push({
              t: Math.round(performance.now() - window.__t0),
              cls: btn.className.includes("pressed") ? 1 : 0,
              tr: cs.transform,
              fi: cs.filter,
            });
            if (performance.now() - window.__t0 < 900) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await startFilm();
        const t0 = Date.now();
        await page.mouse.down();
        await page.waitForTimeout(120);
        await page.mouse.up();
        await page.waitForTimeout(2400);
        await stopFilm(`endturn-press-${round}`, t0, { keep: 8, print: 30 });
        const style = await page.evaluate(() => window.__style ?? []);
        const firstPressed = style.find((s) => s.cls === 1);
        const firstMoved = style.find((s) => s.tr !== style[0].tr);
        console.log(
          `[style] class 'pressed' first seen at ${firstPressed ? firstPressed.t : "NEVER"}ms; ` +
            `computed transform first changed at ${firstMoved ? firstMoved.t : "NEVER"}ms`
        );
        console.log("[style] " + style.slice(0, 12).map((s) => `${s.t}|cls=${s.cls}|${s.tr.slice(7, 13)}|${s.fi}`).join("  "));
        console.log("[input] " + JSON.stringify(await hits()));
        // Answer whatever the press opened, so the next round starts on a board.
        await page
          .locator(".confirm-overlay .btn-primary")
          .first()
          .click({ timeout: 2000 })
          .catch(() => {});
        await page.waitForTimeout(4000);
      }
    }

    if (mode === "endturncost") {
      /*
       * Where the 306ms between the click and the confirm dialogue goes.
       *
       * `battleScreen.ts::endTurn` filters the hand with
       * `checkPlayable(this.matchState(), …)` — and `matchState()` is
       * `viewToState(this.match.view())`, called *inside the filter callback*,
       * so the whole authoritative state is rebuilt once per card in hand. This
       * runs both shapes against the live match and prints them side by side, so
       * the attribution is a number rather than a reading of the source.
       */
      /*
       * And the same question asked of the clock rather than of the source: how
       * long from the pointer going down to the confirm dialogue existing, and
       * how long from it existing to it being painted. A long task observer runs
       * across the whole window so the answer names the work rather than only
       * measuring it.
       */
      const latency = await page.evaluate(async () => {
        const btn = document.querySelector(".end-turn-btn");
        const out = { down: 0, click: 0, inDom: 0, painted: 0, longTasks: [] };
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) out.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
          }).observe({ entryTypes: ["longtask"] });
        } catch {}
        const t0 = performance.now();
        const seen = new Promise((resolve) => {
          const mo = new MutationObserver(() => {
            if (document.querySelector(".confirm-overlay")) {
              out.inDom = Math.round(performance.now() - t0);
              mo.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  out.painted = Math.round(performance.now() - t0);
                  resolve();
                })
              );
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
          setTimeout(resolve, 3000);
        });
        btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        out.down = Math.round(performance.now() - t0);
        btn.click();
        out.click = Math.round(performance.now() - t0);
        await seen;
        out.longTasks = out.longTasks.map((e) => ({ at: e.at - Math.round(t0), ms: e.ms })).filter((e) => e.at > -50);
        return out;
      });
      console.log("[latency] " + JSON.stringify(latency));
      await page.locator(".confirm-overlay .btn-primary").first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const cost = await page.evaluate(async () => {
        const vts = await import("/src/net/viewToState.ts");
        const intents = await import("/src/engine/intents.ts");
        const api = window.hypeboundBattle ?? null;
        const view = api?.view?.();
        if (!view) return { error: "no battle debug hook; measuring viewToState alone" };
        const content = api.content();
        const hand = view.you.hand;
        const t0 = performance.now();
        const once = vts.viewToState(view);
        const tOnce = performance.now() - t0;
        const t1 = performance.now();
        for (const inst of hand) intents.checkPlayable(vts.viewToState(view), content, view.seat, inst.instanceId);
        const tPerCard = performance.now() - t1;
        const t2 = performance.now();
        for (const inst of hand) intents.checkPlayable(once, content, view.seat, inst.instanceId);
        const tShared = performance.now() - t2;
        return { hand: hand.length, viewToStateOnceMs: +tOnce.toFixed(1), rebuiltPerCardMs: +tPerCard.toFixed(1), sharedStateMs: +tShared.toFixed(1) };
      });
      console.log("[cost] " + JSON.stringify(cost));
    }

    if (mode === "drop") {
      const playable = page.locator(".hand-card.playable");
      console.log(`playable hand cards: ${await playable.count()}`);
      if (await playable.count()) {
        const b = await playable.nth(0).boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(300);
        await page.mouse.down();
        for (let i = 1; i <= 12; i += 1) {
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - (VH * 0.32 * i) / 12);
          await page.waitForTimeout(40);
        }
        await page.waitForTimeout(500);
        await startFilm();
        const t0 = Date.now();
        await page.mouse.up();
        await page.waitForTimeout(3000);
        await stopFilm("drop-resolve", t0, { keep: 10, print: 80 });
        await shot("drop-after");
      }
    }
  }

  /* ------------------------------------------------------------- flatcheck */
  /*
   * "#banner has 7 flat banner-card-art fills."
   *
   * A census that reads `getComputedStyle(el).backgroundImage === "none"` cannot
   * tell a flat surface from a *transparent container whose child carries the
   * picture*, and §1's ban is on flat surfaces. So this asks both questions: what
   * the element declares, and what its pixels actually do — a real fill has a
   * standard deviation near zero across its own box, and a rendered card does
   * not.
   */
  if (mode === "flatcheck") {
    const route = argv[1] ?? "banner";
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(2000);
    const sel = String(flag("sel", ".banner-card-art"));
    const shot = (await page.screenshot()).toString("base64");
    const report = await page.evaluate(
      async ({ sel, shot }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${shot}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return [...document.querySelectorAll(sel)].map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const w = Math.max(1, Math.round(r.width));
          const h = Math.max(1, Math.round(r.height));
          const d = g.getImageData(Math.round(r.x), Math.round(r.y), w, h).data;
          let s = 0;
          let s2 = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            s += v;
            s2 += v * v;
            n += 1;
          }
          const mean = s / n;
          return {
            declares: cs.backgroundImage === "none" ? `flat ${cs.backgroundColor}` : "layered",
            kids: [...el.children].map((k) => k.tagName.toLowerCase() + (k.className ? "." + String(k.className).split(" ")[0] : "")).join(","),
            px: { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(1) },
          };
        });
      },
      { sel, shot }
    );
    console.log(`[flat] ${sel} on #${route}: ${report.length} found`);
    for (const row of report) console.log("  " + JSON.stringify(row));
    const trulyFlat = report.filter((r) => r.px.sd < 3);
    console.log(`[flat] pixel-flat (sd < 3): ${trulyFlat.length} of ${report.length}`);
  }

  /* ------------------------------------------------------------------ boot */
  if (mode === "boot") {
    // A genuine cold boot: new context, nothing in storage, cinematic allowed.
    await startFilm();
    const t0 = Date.now();
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(Number(flag("hold", 6500)));
    await stopFilm("boot", t0, { keep: 14, print: 90 });
    console.log("   landed:", await page.evaluate(() => location.hash));
  }
} finally {
  if (pageErrors.length) {
    console.log(`\n${pageErrors.length} page error(s):`);
    for (const e of [...new Set(pageErrors)].slice(0, 10)) console.log("  " + e.slice(0, 180));
  }
  await browser.close();
}
