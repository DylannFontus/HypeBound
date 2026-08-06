/**
 * Cold versus warm on the same leg, in one session.
 *
 * A dev server serves every route as a separate module, so the first navigation
 * to a screen pays for its module graph as well as its paint. Repeating the same
 * leg without reloading separates the two.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}

await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const legs = [
  ["lobby", "play"],
  ["play", "signin"],
  ["signin", "queue"],
  ["queue", "play"],
  ["play", "lobby"],
  ["lobby", "play"],
  ["play", "signin"],
  ["signin", "queue"],
  ["queue", "play"],
  ["play", "lobby"],
  ["lobby", "play"],
  ["play", "signin"],
  ["signin", "queue"],
  ["queue", "play"],
];

for (const [from, to] of legs) {
  const out = await page.evaluate(
    async ([f, t]) => {
      if (location.hash !== "#" + f) {
        location.hash = "#" + f;
        await new Promise((r) => setTimeout(r, 1200));
      }
      const frames = [];
      let last = performance.now();
      const t0 = last;
      let stop = false;
      const tick = () => {
        const n = performance.now();
        frames.push(n - last);
        last = n;
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      location.hash = "#" + t;
      await new Promise((r) => setTimeout(r, 1200));
      stop = true;
      let at = 0;
      const gaps = [];
      for (const g of frames) {
        at += g;
        if (g > 34) gaps.push(`${Math.round(g)}@${Math.round(at)}`);
      }
      return { worst: Math.round(Math.max(...frames)), gaps };
    },
    [from, to]
  );
  console.log(`${(from + "->" + to).padEnd(16)} worst ${String(out.worst).padStart(4)}ms  ${out.gaps.join(" ")}`);
}
await browser.close();
