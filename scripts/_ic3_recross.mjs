/**
 * Cross the same leg twice, because the first crossing pays for a lazy import
 * and the second does not.
 *
 * A critic who films `lobby -> collection` once on a fresh page and reports 700ms
 * of black has possibly measured Vite fetching a chunk, which a returning player
 * never sees. So this walks lobby -> collection -> lobby -> collection -> lobby
 * -> collection in one page and prints the composited gap for each crossing. If
 * the third is as bad as the first, it is the screen; if only the first is bad,
 * it is the import.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const legs = String(arg("legs", "collection,lobby,collection,lobby,collection,lobby,deckbuilder,lobby")).split(",");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

const session = await page.context().newCDPSession(page);
let shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 50, everyNthFrame: 1, maxWidth: 400, maxHeight: 225 });

let prev = "lobby";
for (const to of legs) {
  shots = [];
  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  });
  const t0 = Date.now();
  await page.evaluate((h) => (location.hash = h), `#${to}`);
  await page.waitForTimeout(2600);
  const times = shots.map((s) => Math.round(s.t - t0)).filter((t) => t > -50);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => b - a);
  const lt = await page.evaluate(() => window.__lt);
  console.log(
    `${prev} -> ${to}`.padEnd(26),
    "frames", String(times.length).padStart(3),
    "worstGap", String(gaps[0] ?? 0).padStart(4) + "ms",
    "top3", JSON.stringify(gaps.slice(0, 3)).padEnd(18),
    "longTasks", String(lt.reduce((a, b) => a + b, 0)).padStart(4) + "ms", JSON.stringify(lt)
  );
  prev = to;
}
await session.send("Page.stopScreencast");
await browser.close();
