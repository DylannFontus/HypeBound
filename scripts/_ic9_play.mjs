/**
 * Play the game the way a player does, and photograph every beat of it.
 *
 * The critic's job is not to look at forty-nine routes in isolation — every
 * previous wave has done that and the game still had a mulligan a finger could
 * not reach. What no per-route capture can see is the *journey*: whether the
 * lobby leads anywhere, whether a match can be finished, whether the reward at
 * the end of it arrives, and whether the pack you are given can be torn open and
 * turned over one card at a time.
 *
 * So this drives one continuous session. Every interaction is a CDP pointer
 * event at real viewport coordinates — never a locator click, because
 * `scrollIntoViewIfNeeded` is exactly how nine waves missed an unreachable
 * button. If a control is off screen, this run gets stuck on it, which is the
 * point.
 *
 * ## What it captures and why in bursts
 *
 * §8.7 of the bar: a still cannot show motion. Every set-piece is taken as a
 * burst — a card play, the turn change, the pack tear, each flip — so
 * consecutive frames can be compared. Where a frame pair is identical, that
 * thing does not animate and it is a fail, not an opinion.
 *
 *   node scripts/_ic9_play.mjs --size 1280x720 --scale 1 --tag base
 *   node scripts/_ic9_play.mjs --size 844x390 --scale 1.6 --tag phone160
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const [VW, VH] = String(arg("size", "1280x720")).split("x").map(Number);
const SCALE = Number(arg("scale", 1));
const TAG = String(arg("tag", "base"));
const DIR = path.join("scripts", "screenshots", "w9", "ic9-play", TAG);
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 140)}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 140)}`));

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let shotN = 0;
async function shot(name) {
  shotN += 1;
  const file = path.join(DIR, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
/** A burst, for anything the bar judges as motion. */
async function burst(name, frames = 6, gap = 70) {
  shotN += 1;
  const stem = `${String(shotN).padStart(2, "0")}-${name}`;
  for (let i = 0; i < frames; i += 1) {
    await cdp
      .send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })
      .then(async (r) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.join(DIR, `${stem}-${i}.png`), Buffer.from(r.data, "base64"));
      });
    if (gap) await sleep(gap);
  }
  return stem;
}

/** Raw pointer, no scroll assistance of any kind. */
async function click(x, y) {
  const c = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await sleep(40);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...c });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...c });
}
/** Centre of the first element matching `sel`, or null if it is not on screen. */
async function centre(sel, index = 0) {
  return page.evaluate(
    ({ sel, index }) => {
      const el = document.querySelectorAll(sel)[index];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
        below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
        text: (el.textContent ?? "").trim().slice(0, 30),
      };
    },
    { sel, index }
  );
}
async function clickSel(sel, index = 0, label = sel) {
  const c = await centre(sel, index);
  if (!c) {
    log(`  MISS  ${label}: no such element`);
    return false;
  }
  if (!c.onScreen) log(`  !! ${label} is ${c.below}px past the fold — a finger cannot reach it`);
  await click(c.x, c.y);
  return true;
}

async function setScale(scale) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await sleep(600);
  await page.locator("button", { hasText: new RegExp(`^${Math.round(scale * 100)}%$`) }).first().click();
  await sleep(400);
  const got = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim());
  log(`scale set: asked ${scale}, root reports ${got}`);
}

await seedPlayedAccount(page, ORIGIN);
if (SCALE !== 1) await setScale(SCALE);
await page.setViewportSize({ width: VW, height: VH });

// ---------------------------------------------------------------- 1. the door
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await sleep(1600);
await shot("lobby");
await burst("lobby-idle", 6, 320);

// -------------------------------------------------------- 2. lobby -> a child
const before = Date.now();
await page.evaluate(() => (location.hash = "#collection"));
await burst("nav-to-collection", 8, 45);
await page.waitForSelector(".collection-screen, [data-nav='collection']", { timeout: 20000 }).catch(() => {});
await sleep(1400);
log(`lobby -> collection took ${Date.now() - before}ms wall clock`);
await shot("collection");

await page.evaluate(() => (location.hash = "#deckbuilder"));
await sleep(2200);
await shot("deckbuilder");

await page.evaluate(() => (location.hash = "#shop"));
await sleep(1800);
await shot("shop");

// ---------------------------------------------------------------- 3. a match
await page.goto(`${ORIGIN}/?nointro#battle?seed=31&difficulty=casual`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await sleep(1000);
await shot("mulligan");
const conf = await centre(".mulligan-actions .btn-primary");
log(`mulligan Confirm at ${JSON.stringify(conf)}`);
await click(conf.x, conf.y);
await burst("match-curtain", 8, 90);
await page.waitForFunction(() => document.querySelectorAll(".hand-card").length > 0, null, { timeout: 25000 });
await sleep(1800);
await shot("board-turn1");

const state = () =>
  page.evaluate(() => {
    const w = window;
    const g = w.hypeboundBattle?.state?.() ?? w.hypeboundBattle?.getState?.() ?? null;
    return {
      hand: document.querySelectorAll(".hand-card").length,
      mine: document.querySelectorAll(".board-mirror [data-side='you'] [data-unit], .unit-mine").length,
      endTurnEnabled: !document.querySelector(".end-turn-btn")?.disabled,
      over: Boolean(document.querySelector(".battle-result, .result-overlay, .rw-open, .postmatch")),
      turnLabel: (document.querySelector(".turn-label, .hud-turn")?.textContent ?? "").trim().slice(0, 40),
      g: g ? { turn: g.turn, you: g.you?.health, foe: g.foe?.health } : null,
    };
  });
log(`turn 1 state: ${JSON.stringify(await state())}`);

/** Play the leftmost affordable card by dragging it onto the mat. */
async function playACard() {
  const n = await page.evaluate(() => document.querySelectorAll(".hand-card").length);
  for (let i = 0; i < n; i += 1) {
    const c = await centre(".hand-card", i);
    if (!c) continue;
    const target = await page.evaluate(() => {
      const el = document.querySelector(".battle-stage, .board-canvas, canvas");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.62) };
    });
    if (!target) return false;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y, button: "none", clickCount: 0 });
    await sleep(90);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
    for (let s = 1; s <= 10; s += 1) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(c.x + ((target.x - c.x) * s) / 10),
        y: Math.round(c.y + ((target.y - c.y) * s) / 10),
        button: "left",
        clickCount: 0,
      });
      await sleep(22);
    }
    await sleep(120);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(900);
    const after = await page.evaluate(() => document.querySelectorAll(".hand-card").length);
    if (after < n) return true;
  }
  return false;
}

await burst("play-card", 8, 65);
const played = await playACard();
log(`played a card by drag: ${played}`);
await shot("board-after-play");

// --- run the match to its end ------------------------------------------------
let turns = 0;
let finished = false;
while (turns < 40 && !finished) {
  turns += 1;
  await playACard();
  const et = await centre(".end-turn-btn");
  if (!et) break;
  if (!et.onScreen) log(`  !! End Turn is ${et.below}px past the fold`);
  if (turns === 2) await burst("turn-change", 8, 70);
  await click(et.x, et.y);
  await sleep(500);
  /*
   * The game asks "End your turn? You still have Hype and a playable card."
   * That is a real feature and the first run of this script sat on it for
   * thirty-four consecutive clicks, reporting a match that could not be
   * finished. The confirm is the thing to press, not the thing to route around.
   */
  const confirm = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".confirm-overlay button")].find((x) =>
      /^end turn$/i.test((x.textContent ?? "").trim())
    );
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  if (confirm) await click(confirm.x, confirm.y);
  await sleep(2400);
  const s = await page.evaluate(() => ({
    over: Boolean(document.querySelector(".battle-result, .result-overlay, .postmatch, .rw-open")),
    hash: location.hash,
  }));
  if (s.over || !s.hash.startsWith("#battle")) {
    finished = true;
    log(`match ended after ${turns} of my turns, hash now ${s.hash}`);
  }
  if (turns % 6 === 0) log(`  ...turn ${turns}, ${JSON.stringify(await state())}`);
}
await sleep(2200);
await shot("match-end");
log(`match loop exited: finished=${finished} turns=${turns} hash=${await page.evaluate(() => location.hash)}`);

// ---------------------------------------------------- 4. the pack, torn open
await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
await sleep(1800);
await shot("shop-again");
// buy the cheapest pack the shop will sell
const bought = await page.evaluate(() => {
  const packBtn = [...document.querySelectorAll("button")].find((b) => /open a .*drop/i.test(b.textContent ?? ""));
  if (!packBtn) return null;
  const r = packBtn.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    onScreen: r.bottom <= window.innerHeight && r.top >= 0,
    below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    text: packBtn.textContent?.trim(),
  };
});
log(`shop pack button: ${JSON.stringify(bought)}`);
if (bought) {
  await click(bought.x, bought.y);
  await sleep(1600);
  await shot("shop-after-buy");
}
const packUp = await page.evaluate(() => Boolean(document.querySelector(".rw-open")));
log(`pack overlay present: ${packUp}`);

if (packUp) {
  await shot("pack-closed");
  await burst("pack-idle", 6, 320);
  const p = await centre(".rw-pack");
  log(`pack at ${JSON.stringify(p)}`);
  await burst("pack-tear", 10, 80);
  await click(p.x, p.y);
  await sleep(120);
  await burst("pack-tear-after", 10, 80);
  await sleep(1800);
  await shot("pack-dealt");
  const flips = await page.evaluate(() => document.querySelectorAll(".rw-flip").length);
  log(`cards dealt: ${flips}`);
  for (let i = 0; i < flips; i += 1) {
    const c = await centre(".rw-flip", i);
    if (!c) {
      log(`  card ${i}: not on screen`);
      continue;
    }
    const wasFlipped = await page.evaluate(
      (i) => document.querySelectorAll(".rw-flip")[i]?.getAttribute("aria-pressed"),
      i
    );
    await click(c.x, c.y);
    await sleep(90);
    if (i === 0) await burst("pack-flip-0", 8, 70);
    await sleep(700);
    const nowFlipped = await page.evaluate(
      (i) => document.querySelectorAll(".rw-flip")[i]?.getAttribute("aria-pressed"),
      i
    );
    log(`  card ${i} at (${c.x},${c.y}) onScreen=${c.onScreen}: aria-pressed ${wasFlipped} -> ${nowFlipped}`);
    await shot(`pack-card-${i}`);
  }
  await sleep(1400);
  await shot("pack-summary");
  await clickSel(".rw-open-foot button", 0, "pack close");
  await sleep(1400);
  await shot("after-pack");
}

log(`\npage errors (${errors.length}): ${errors.slice(0, 8).join(" | ")}`);
log(`shots in ${DIR}`);
await browser.close();
