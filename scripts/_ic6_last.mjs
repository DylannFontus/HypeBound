/**
 * The three things left that nothing else in this review can answer.
 *
 * 1. **Does the hand collide with the Hype tray at 1280x720 and 160% text?** The
 *    still says yes; a still is not a measurement, and this project's history is
 *    of confident readings that turned out to be the instrument. So the boxes
 *    get compared numerically.
 * 2. **Does reduced motion keep the functional layer?** §3 makes this a hard
 *    requirement. An idle board under reduced motion measures 0.002 mean delta,
 *    which is correct for *decoration* and says nothing about whether a card
 *    still travels from the hand to the mat. Playing one answers it.
 * 3. **The four routes the census still cannot reach.** `gauntletfight`,
 *    `doomfight`, `storyscene` and `storybattle` each need two or three clicks
 *    through the screen that owns their state; the census recipe has one, so it
 *    prints the *parent* screen's numbers in a row labelled with the child's
 *    name. Reaching them by hand is the only way to know what is there.
 *
 *   node scripts/_ic6_last.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
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
const OUT = path.join(HERE, "screenshots", "w6", "critic-final", "last");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const meanDelta = (a, b) => {
  const n = Math.min(a.data.length, b.data.length);
  let s = 0;
  let c = 0;
  for (let i = 0; i + 2 < n; i += a.channels * 2) {
    s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    c += 3;
  }
  return s / c;
};

// ---------------------------------------------------------------- 1. the tray
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await seedPlayedAccount(page, ORIGIN);
  await page.evaluate(async () => {
    const mod = await import("/src/save/settings.ts");
    const st = await import("/src/save/storage.ts");
    mod.updateSettings({ uiScale: 1.6 });
    st.flushAllStores();
  });
  await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
  await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
  await page.waitForFunction(() => document.querySelector(".end-turn-btn") !== null, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const hand = [...document.querySelectorAll(".hand-card")].map((e) => e.getBoundingClientRect());
    const trayEl =
      document.querySelector(".hype-tray, .hype-rail, .hud-hype, [class*='hype']") ?? null;
    const tray = trayEl ? trayEl.getBoundingClientRect() : null;
    const log = document.querySelector(".history-panel")?.getBoundingClientRect() ?? null;
    return {
      scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
      trayCls: trayEl?.className ?? null,
      tray: tray && { l: Math.round(tray.left), r: Math.round(tray.right), t: Math.round(tray.top) },
      hand: hand.map((b) => ({ l: Math.round(b.left), r: Math.round(b.right) })),
      collide: tray ? hand.filter((b) => b.right > tray.left + 2 && b.left < tray.right).length : -1,
      logCls: log && { l: Math.round(log.left), r: Math.round(log.right) },
    };
  });
  console.log("\n=== 1. hand vs Hype tray, 1280x720 @ 160% ===");
  console.log(JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, "tray-collide.png") });
  await page.close();
}

// ------------------------------------------------------- 2. reduced motion play
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await seedPlayedAccount(page, ORIGIN);
  await page.evaluate(async () => {
    const mod = await import("/src/save/settings.ts");
    const st = await import("/src/save/storage.ts");
    mod.updateSettings({ reducedMotion: true });
    st.flushAllStores();
  });
  await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
  await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "rm-before.png") });

  const session = await page.context().newCDPSession(page);
  const reel = [];
  session.on("Page.screencastFrame", (f) => {
    reel.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
    void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1600, maxHeight: 900 });
  const t0 = Date.now();
  const playable = page.locator(".hand-card.playable").first();
  if (await playable.count()) {
    const b = await playable.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - (270 * i) / 10);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
  } else console.log("   no playable card under reduced motion");
  await page.waitForTimeout(3000);
  await session.send("Page.stopScreencast").catch(() => {});
  let prev = null;
  const rows = [];
  for (const f of reel) {
    const img = decodePng(Buffer.from(f.data, "base64"));
    rows.push({ t: Math.round(f.t - t0), d: prev ? meanDelta(prev, img) : null });
    prev = img;
  }
  console.log("\n=== 2. reduced motion: does the card still travel? ===");
  console.log(
    `frames=${rows.length} peak=${Math.max(0, ...rows.map((r) => r.d ?? 0)).toFixed(2)} ` +
      `moves>0.5=${rows.filter((r) => (r.d ?? 0) > 0.5).length}`
  );
  console.log("  " + rows.map((r) => `${r.t}:${r.d === null ? "-" : r.d.toFixed(2)}`).join(" ").slice(0, 900));
  await page.screenshot({ path: path.join(OUT, "rm-after.png") });
  await page.close();
}

// ------------------------------------------------ 3. the four unreachable routes
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await seedPlayedAccount(page, ORIGIN);
  const survey = async (name) => {
    await page.waitForTimeout(1200);
    const hash = await page.evaluate(() => location.hash);
    const s = await page.evaluate(() => {
      const screen = document.querySelector(".screen");
      if (!screen) return { err: "no .screen" };
      const big = [...screen.querySelectorAll("*")].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 120 && b.height > 60;
      });
      const flat = [];
      for (const e of big) {
        const cs = getComputedStyle(e);
        if (cs.backgroundColor === "rgba(0, 0, 0, 0)") continue;
        if (cs.backgroundImage !== "none" || cs.boxShadow !== "none") continue;
        flat.push(`${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/).slice(0, 2).join(".")} ${cs.backgroundColor}`);
      }
      return {
        big: big.length,
        mat: big.filter((e) => /\bmat-(panel|card|chip|hero|rail|well)\b/.test(String(e.className))).length,
        plain: big.filter((e) => /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className))).length,
        flat,
      };
    });
    console.log(`  ${name.padEnd(14)} at ${hash.padEnd(28)} big=${s.big} mat=${s.mat} plain=${s.plain} flat=${s.flat?.length ?? "-"}`);
    for (const f of (s.flat ?? []).slice(0, 4)) console.log(`        flat ${f}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };

  console.log("\n=== 3. the four routes the census reports as its parent screen ===");

  // storyscene: chapters -> episodes -> play
  await page.goto(`${ORIGIN}/?nointro#story`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".chapter-card, .story-chapter, .episode-row, .screen button").first().click().catch(() => {});
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, "story-chapter.png") });
  const ep = page.locator(".episode-row button:not([disabled]), .episode-row .btn:not([disabled])").first();
  if (await ep.count()) await ep.click().catch(() => {});
  await survey("storyscene");
  // the scene's own control should start the battle
  const go = page.locator(".screen button", { hasText: /begin|start|play|fight|continue/i }).first();
  if (await go.count()) {
    await go.click().catch(() => {});
    await page.waitForTimeout(4000);
  }
  await survey("storybattle");

  // gauntlet: start -> draft -> begin -> fight
  await page.goto(`${ORIGIN}/?nointro#gauntlet`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  for (const sel of ["#gauntlet-start", ".gauntlet-offer button", "#gauntlet-begin", "#gauntlet-fight"]) {
    for (let i = 0; i < 40; i += 1) {
      const l = page.locator(sel).first();
      if (!(await l.count())) break;
      await l.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(420);
      if (sel !== ".gauntlet-offer button") break;
    }
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  await survey("gauntletfight");

  // doomscroll: start a run, then take the first fight node
  await page.goto(`${ORIGIN}/?nointro#doomscroll`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".doom-leader-grid button, .doom-leader").first().click().catch(() => {});
  await page.waitForTimeout(900);
  for (const sel of ["#doom-start", ".doom-body .mat-hero", "#doom-fight"]) {
    const l = page.locator(sel).first();
    if (await l.count()) {
      await l.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1400);
    } else console.log(`        (no ${sel})`);
  }
  await page.waitForTimeout(2500);
  await survey("doomfight");
  await page.close();
}

await browser.close();
