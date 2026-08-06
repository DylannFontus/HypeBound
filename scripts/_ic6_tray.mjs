/**
 * Does a hand card sit under the Hype tray at 1280x720 with 160% text?
 *
 * The still says yes and a still is not a measurement. An earlier attempt asked
 * for `[class*='hype']` and matched `<html>` — whose class list carries the
 * icon-availability flags — so it reported a tray covering the whole viewport
 * and "7 cards collide", which is the shape of every wrong answer this project
 * has already paid for. The anchor here is `.hype-sockets`, written by `hud.ts`
 * and unable to be anything else, and the same measurement runs at 1600x900 and
 * 100% as a control: if the control also collides, the finding is the instrument.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const [w, h, scale] of [
  [1280, 720, 1.6],
  [1280, 720, 1.4],
  [1600, 900, 1],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await seedPlayedAccount(page, ORIGIN);
  await page.evaluate(async (s) => {
    const m = await import("/src/save/settings.ts");
    const st = await import("/src/save/storage.ts");
    m.updateSettings({ uiScale: s });
    st.flushAllStores();
  }, scale);
  await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
  await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn") !== null, null, { timeout: 40000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const sockets = document.querySelector(".hype-sockets");
    const tray = sockets?.parentElement ?? null;
    const t = tray?.getBoundingClientRect();
    const hand = [...document.querySelectorAll(".hand-card")].map((e) => e.getBoundingClientRect());
    const hit = t
      ? hand.filter((x) => x.right > t.left + 2 && x.left < t.right - 2 && x.bottom > t.top + 2 && x.top < t.bottom - 2)
      : [];
    return {
      scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
      tray: t && { cls: String(tray.className).slice(0, 34), l: Math.round(t.left), r: Math.round(t.right), t: Math.round(t.top) },
      handRight: hand.length ? Math.round(Math.max(...hand.map((x) => x.right))) : null,
      collide: hit.length,
      overlapPx: hit.length ? Math.round(Math.max(...hit.map((x) => x.right)) - t.left) : 0,
    };
  });
  console.log(`${w}x${h} @ui-scale ${scale}: ${JSON.stringify(r)}`);
  await page.close();
}

await browser.close();
