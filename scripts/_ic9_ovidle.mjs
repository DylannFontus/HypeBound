/**
 * Are the overlays alive at rest? The forty-nine-route sweep cannot see them.
 *
 * `_w8room_sweep.mjs` walks `shell.register` names. The end-of-match sequence,
 * the mulligan and the pack room are mounted into a screen rather than
 * registered as one, so none of the three has ever been measured — and the
 * end-of-match sequence is on screen after every single match, which is more
 * often than most of the forty-nine.
 *
 * Same instrument, same floor, same grid: `lib/idle.mjs`, whose achieved
 * interval I have separately verified against the page's own clock at 200.0ms.
 * Nothing here is quoted without `grid`.
 *
 *   node scripts/_ic9_ovidle.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { createIdleSampler, gridNote, referenceAtLag, f3 } from "./lib/idle.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ref = referenceAtLag(200);
console.log(`reference at 200ms: min ${f3(ref.min)} median ${f3(ref.median)}   (floor 0.5)\n`);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);
const sample = await createIdleSampler(page, { lagMs: 200 });

const click = async (x, y) => {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 45));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const centre = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, sel);

async function row(label, stats) {
  console.log(
    `${label.padEnd(24)} n=${stats.n} min=${f3(stats.min)} med=${f3(stats.median)} max=${f3(stats.max)}  ${gridNote(stats)}` +
      (stats.min !== null && stats.min < 0.5 ? "   <-- UNDER THE FLOOR" : "")
  );
}

// --- the mulligan -------------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#battle?seed=91&difficulty=casual`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2200));
await row("mulligan overlay", await sample({ seconds: 3 }));

// --- the board, then the end sequence ----------------------------------------
const conf = await centre(".mulligan-actions .btn-primary");
await click(conf.x, conf.y);
await page.waitForFunction(() => document.querySelectorAll(".hand-card").length > 0, null, { timeout: 25000 });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /concede/i.test((x.getAttribute("aria-label") ?? "") + (x.title ?? "") + (x.textContent ?? ""))
  );
  b?.click();
});
await new Promise((r) => setTimeout(r, 700));
await row("concede confirm", await sample({ seconds: 2.4 }));
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".confirm-overlay button")].find((x) => /concede/i.test(x.textContent ?? ""));
  b?.click();
});
await page.waitForFunction(() => Boolean(document.querySelector(".end-overlay")), null, { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
await row("END OF MATCH", await sample({ seconds: 3 }));

// --- the pack room ------------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 1800));
const buy = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /open a .*drop/i.test(x.textContent ?? ""));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (buy) {
  await click(buy.x, buy.y);
  await new Promise((r) => setTimeout(r, 2200));
  await row("pack room, unopened", await sample({ seconds: 3 }));
  const pack = await centre(".rw-pack");
  if (pack) {
    await click(pack.x, pack.y);
    await new Promise((r) => setTimeout(r, 6000));
    await row("pack room, revealed", await sample({ seconds: 3 }));
  }
}
await browser.close();
