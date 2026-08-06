/**
 * Is `optimizeForSpeed: true` the same pixels — asked with an A/A control.
 *
 * `lib/idle.mjs` rests its whole grid fix on that flag being a zlib level and
 * nothing else, and states the pixels are byte-identical. A naive A/B on a live
 * page found 5,616 differing bytes and that proves nothing on its own, because a
 * HYPEBOUND screen never stops moving: the atmosphere runs on rAF, which
 * `document.getAnimations().pause()` does not touch.
 *
 * So the only honest form of the question is A/A/B: two captures with the SAME
 * encoder establish what the page's own motion contributes between two captures,
 * and only a B that differs by materially more than that has anything to do with
 * the encoder. Run on a route with the room suppressed as well, so there is a
 * genuinely still subject in the set.
 *
 *   node scripts/_ic9_encoder.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { decodePng } from "./lib/png.mjs";
import { meanDelta } from "./lib/idle.mjs";
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
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

const grab = async (fast) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", ...(fast ? { optimizeForSpeed: true } : {}) });
  return decodePng(Buffer.from(r.data, "base64"));
};
const bytesDiffer = (a, b) => {
  let n = 0;
  for (let i = 0; i < Math.min(a.data.length, b.data.length); i += 1) if (a.data[i] !== b.data[i]) n += 1;
  return n;
};

for (const subject of ["live", "frozen"]) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (subject === "frozen") {
    // Kill every source of motion this page has, not only the CSS ones: rAF is
    // where the atmosphere lives, and it is the reason a naive A/B is worthless.
    await page.evaluate(() => {
      for (const a of document.getAnimations()) a.pause();
      window.requestAnimationFrame = () => 0;
      document.documentElement.dataset["reducedMotion"] = "true";
    });
    await page.waitForTimeout(900);
  }
  await grab(true);
  const a1 = await grab(false);
  const a2 = await grab(false);
  const b1 = await grab(true);
  const b2 = await grab(true);
  console.log(
    `${subject.padEnd(7)}  A/A slow-slow ${String(bytesDiffer(a1, a2)).padStart(8)} bytes (delta ${meanDelta(a1, a2).toFixed(5)})  |  ` +
      `B/B fast-fast ${String(bytesDiffer(b1, b2)).padStart(8)} bytes (delta ${meanDelta(b1, b2).toFixed(5)})  |  ` +
      `A/B slow-fast ${String(bytesDiffer(a2, b1)).padStart(8)} bytes (delta ${meanDelta(a2, b1).toFixed(5)})`
  );
}
console.log(
  "\nIf A/B is in the same range as A/A and B/B, the differing bytes are the page moving between captures and the encoder is exonerated."
);
await browser.close();
