/**
 * The battle board's standing questions, answered in numbers rather than in
 * adjectives.
 *
 * Four things this checks, each of which has been argued about from a still
 * image at least once:
 *
 *  - **Is it alive at rest, and does reduced motion actually stop it?** Two
 *    screenshots a second apart, decoded inside the page and differenced. The
 *    board is WebGL, so its pixels cannot be read back from Node — the frames
 *    go back into the page as image bitmaps and the arithmetic happens there.
 *  - **Does anything leave the viewport** at 1280x720 and 844x390, which is the
 *    hard constraint rather than a preference.
 *  - **Does the hand survive a resize**, which is the only path phone rotation
 *    ever takes and the one a fresh load can never catch.
 *  - **How long does a button take to look pressed.**
 *
 *   node scripts/audit-battlemotion.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
// An explicit context, so the reduced-motion page below can share the seeded
// account rather than starting from a brand-new profile.
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

const shot = async () => (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 })).data;

/**
 * Six builders are editing this repo at once and the dev server hot-reloads
 * under the browser mid-navigation. That is not a fault in the game and it must
 * not be reported as one, so the seeding step is simply retried.
 */
const seed = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await seedPlayedAccount(page, ORIGIN);
      return;
    } catch (error) {
      if (attempt >= 8) throw error;
      console.log(`  (seed attempt ${attempt} failed: ${String(error).split("\n")[0]} — retrying)`);
      await page.goto(`${ORIGIN}/#starter`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(4000);
    }
  }
};

/** Mean and peak per-channel difference between two frames, over a region. */
const diffFrames = (a, b, region) =>
  page.evaluate(
    async ([x, y, w, h, da, db]) => {
      const load = async (d) => {
        const blob = await (await fetch(`data:image/jpeg;base64,${d}`)).blob();
        return createImageBitmap(blob);
      };
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const scale = ia.width / innerWidth;
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const grab = (img) => {
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, Math.round(x * scale), Math.round(y * scale), cw, ch, 0, 0, cw, ch);
        return g.getImageData(0, 0, cw, ch).data;
      };
      const pa = grab(ia);
      const pb = grab(ib);
      let sum = 0;
      let peak = 0;
      let moved = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2])
        );
        sum += d;
        if (d > peak) peak = d;
        if (d > 6) moved++;
      }
      const n = pa.length / 4;
      return { mean: +(sum / n).toFixed(3), peak, movedPct: +((moved / n) * 100).toFixed(1) };
    },
    [region.x, region.y, region.w, region.h, a, b]
  );

const toBattle = async (query = "battle?difficulty=beginner&seed=20260725") => {
  await page.goto(`${ORIGIN}/#${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(1600);
};

try {
  await seed();

  // ------------------------------------------------------- idle, both ways --
  await toBattle();
  const board = { x: 300, y: 90, w: 1000, h: 620 };
  const hud = { x: 0, y: 640, w: 420, h: 260 };

  const sample = async (label) => {
    await page.waitForTimeout(700);
    const a = await shot();
    await page.waitForTimeout(1100);
    const b = await shot();
    const onBoard = await diffFrames(a, b, board);
    const onHud = await diffFrames(a, b, hud);
    console.log(
      ` ${label.padEnd(16)} board mean ${String(onBoard.mean).padStart(6)} peak ${String(onBoard.peak).padStart(3)} moved ${String(onBoard.movedPct).padStart(5)}%  |  hud mean ${String(onHud.mean).padStart(6)} moved ${String(onHud.movedPct).padStart(5)}%`
    );
    return onBoard;
  };

  console.log("=== idle motion over 1.1s ===");
  const full = await sample("motion on");
  /**
   * Reduced motion is measured in a **second page opened with the preference
   * already set**, and both halves of that matter.
   *
   * `await import("/src/save/settings.ts")` from inside a live page is not the
   * app's copy of that module in a Vite dev build — the app's carries an HMR
   * `?t=` query and is a separate module record with its own store — so
   * `updateSettings` there sets the root attribute and changes nothing the board
   * reads. And flipping the media query after boot is no better: `defaults`
   * seeds the setting from `prefers-reduced-motion` exactly once, when the store
   * is first created. One round of this review captured two heatmaps of a board
   * that had reduced motion "on" in a store nobody was reading and reasoned
   * about them at length.
   */
  /**
   * A whole separate context whose very first page load already has the
   * preference. Sharing the seeded one does not work: the app writes a settings
   * blob on its first boot, and after that `defaults` — the only place
   * `prefers-reduced-motion` is ever read — never runs again. Two runs of this
   * script reported `attr=false` and a nonsense percentage before that was
   * chased down.
   */
  const quietContext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const quiet = await quietContext.newPage();
  for (let attempt = 1; ; attempt++) {
    try {
      await seedPlayedAccount(quiet, ORIGIN);
      break;
    } catch (error) {
      if (attempt >= 6) throw error;
      await quiet.goto(`${ORIGIN}/#starter`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await quiet.waitForTimeout(4000);
    }
  }
  const quietCdp = await quiet.context().newCDPSession(quiet);
  await quiet.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await quiet.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await quiet.click(".mulligan-actions .btn-primary");
  await quiet
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await quiet.waitForTimeout(2400);
  const applied = await quiet
    .evaluate(() => document.documentElement.getAttribute("data-reduced-motion"))
    .catch(() => "unknown");
  const qShot = async () => (await quietCdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 })).data;
  const qa = await qShot();
  await quiet.waitForTimeout(1100);
  const qb = await quiet.evaluate ? await qShot() : null;
  const reduced = await quiet.evaluate(
    async ([x, y, w, h, da, db]) => {
      const load = async (d) => createImageBitmap(await (await fetch(`data:image/jpeg;base64,${d}`)).blob());
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      const grab = (img) => {
        g.clearRect(0, 0, w, h);
        g.drawImage(img, x, y, w, h, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const pa = grab(ia);
      const pb = grab(ib);
      let sum = 0;
      let moved = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2])
        );
        sum += d;
        if (d > 6) moved++;
      }
      const n = pa.length / 4;
      return { mean: +(sum / n).toFixed(3), movedPct: +((moved / n) * 100).toFixed(1) };
    },
    [board.x, board.y, board.w, board.h, qa, qb]
  );
  console.log(
    ` reduced (attr=${applied})  board mean ${String(reduced.mean).padStart(6)} moved ${String(reduced.movedPct).padStart(5)}%`
  );
  console.log(
    ` reduced motion removes ${(100 - (reduced.mean / Math.max(0.001, full.mean)) * 100).toFixed(0)}% of the board's idle movement` +
      ` (${full.mean} -> ${reduced.mean})`
  );
  await quietContext.close();
  // and back to a live board for everything below. A different seed, because
  // re-entering the identical hash resumes the match instead of dealing a new
  // one and there is then no mulligan to confirm.
  await toBattle("battle?difficulty=beginner&seed=20260726");
  await quietContext.close();
  // and back to a live board for everything below
  await toBattle();

  // ---------------------------------------------------- press latency -------
  await page.waitForTimeout(900);
  console.log("\n=== press feedback ===");
  const press = await page.evaluate(async () => {
    const btn = document.querySelector(".end-turn-btn");
    if (!btn) return null;
    const before = getComputedStyle(btn).transform;
    const t0 = performance.now();
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    let t = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (getComputedStyle(btn).transform !== before) {
        t = performance.now() - t0;
        break;
      }
    }
    btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    return Math.round(t);
  });
  console.log(` End Turn transform changes ${press}ms after pointerdown`);

  // ------------------------------------------------- viewport containment ---
  const overflow = async (w, h, label) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1400);
    const bad = await page.evaluate(() => {
      const out = [];
      const nodes = document.querySelectorAll(
        ".battle-hud > *, .battle-hud > * > *, .hand-card, .hype-wrap, .turn-wrap, .history-panel"
      );
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const over = [];
        if (r.right > innerWidth + 1) over.push(`right +${Math.round(r.right - innerWidth)}`);
        if (r.left < -1) over.push(`left ${Math.round(r.left)}`);
        if (r.bottom > innerHeight + 1) over.push(`bottom +${Math.round(r.bottom - innerHeight)}`);
        if (r.top < -1) over.push(`top ${Math.round(r.top)}`);
        if (over.length) out.push(`${String(n.className).split(" ")[0]} ${over.join(", ")}`);
      }
      // and anything overlapping the End Turn ring, which is the collision the
      // phone layout has failed on for three rounds
      const ring = document.querySelector(".turn-wrap")?.getBoundingClientRect();
      const clashes = [];
      if (ring) {
        for (const n of document.querySelectorAll(".battle-hud > *")) {
          if (n.classList.contains("turn-wrap")) continue;
          const r = n.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.left < ring.right && r.right > ring.left && r.top < ring.bottom && r.bottom > ring.top) {
            clashes.push(String(n.className).split(" ")[0]);
          }
        }
      }
      return { out, clashes };
    });
    console.log(`\n=== ${label} (${w}x${h}) ===`);
    console.log(bad.out.length ? bad.out.map((s) => "  overflow: " + s).join("\n") : "  nothing leaves the viewport");
    console.log(bad.clashes.length ? `  overlapping End Turn: ${bad.clashes.join(", ")}` : "  End Turn is clear");
  };

  await overflow(1280, 720, "desktop small");
  await overflow(844, 390, "phone landscape");

  // ------------------------------------------------------- the resize path --
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1200);
  const fan = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".hand-card")].map((n) => n.getBoundingClientRect());
    if (cards.length === 0) return null;
    return {
      count: cards.length,
      left: Math.round(Math.min(...cards.map((c) => c.left))),
      right: Math.round(Math.max(...cards.map((c) => c.right))),
      offRight: cards.filter((c) => c.right > innerWidth + 1).length,
      offBottom: cards.filter((c) => c.bottom > innerHeight + 1).length,
      viewport: innerWidth,
    };
  });
  console.log("\n=== hand after a 1600x900 -> 844x390 resize ===");
  console.log(" ", JSON.stringify(fan));

  if (errors.length) console.log("\npage errors:", errors.slice(0, 6));
} finally {
  await browser.close();
}
