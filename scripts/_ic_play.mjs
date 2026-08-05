/**
 * A card played, an attack, and End Turn — filmed off the compositor.
 *
 * The three beats §3 cares most about all live inside a live match, and all
 * three are under a second, which is exactly the length `page.screenshot`
 * cannot sample: at ~320ms a shot, a `--frames` burst takes two pictures of a
 * 600ms card play and both of them are of the settled state. So this drives a
 * real board and films it, then reports what animated and when.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const dir = "scripts/screenshots/w3/integration/motion/cardplay";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
if (await page.locator(".mulligan-actions .btn-primary").count())
  await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(1800);

await page.evaluate(() => {
  const w = window;
  w.__ic = { anim: [], t0: performance.now() };
  const on = (e) =>
    w.__ic.anim.push({
      p: e.type === "animationstart" ? "s" : "e",
      n: e.animationName,
      at: Math.round(performance.now() - w.__ic.t0),
      on: String(e.target.className || e.target.tagName).slice(0, 40),
    });
  document.addEventListener("animationstart", on, true);
  document.addEventListener("animationend", on, true);
});

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 82, everyNthFrame: 1, maxWidth: 1600, maxHeight: 900 });
await page.waitForTimeout(300);

const t0 = Date.now();
await page.evaluate(() => {
  window.__ic.t0 = performance.now();
});

const playable = page.locator(".hand-card:not(.unplayable)").first();
const marks = [];
if (await playable.count()) {
  await playable.click({ force: true });
  marks.push({ what: "hand card clicked", at: Date.now() - t0 });
  await page.waitForTimeout(220);
  const slot = page.locator(".board-slot, .slot-open, [class*='drop-slot'], [class*='board-slot']").first();
  if (await slot.count()) {
    await slot.click({ force: true }).catch(() => {});
    marks.push({ what: "board slot clicked", at: Date.now() - t0 });
  }
}
await page.waitForTimeout(1500);
const et = page.locator(".end-turn-btn").first();
if (await et.count()) {
  await et.click({ force: true }).catch(() => {});
  marks.push({ what: "end turn clicked", at: Date.now() - t0 });
}
await page.waitForTimeout(3200);
await session.send("Page.stopScreencast");
const rec = await page.evaluate(() => window.__ic);
await session.detach().catch(() => {});

const frames = shots.map((s) => ({ t: Math.round(s.t * 1000 - t0), data: s.data })).filter((f) => f.t > -100);
for (const f of frames)
  writeFileSync(`${dir}/t${String(Math.max(0, f.t)).padStart(5, "0")}.jpg`, Buffer.from(f.data, "base64"));

const times = frames.map((f) => f.t);
const gaps = [];
for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
gaps.sort((a, b) => b - a);
const starts = rec.anim.filter((a) => a.p === "s");
console.log(
  JSON.stringify(
    {
      marks,
      frames: frames.length,
      spanMs: times.at(-1) - times[0],
      worstGapMs: gaps[0],
      top5Gaps: gaps.slice(0, 5),
      distinctKeyframes: [...new Set(starts.map((a) => a.n))],
      starts: starts.slice(0, 26),
    },
    null,
    1
  )
);
await browser.close();
