/** Frame time on the two screens this round touched, 240 settled frames each. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const sample = async (label, prepare) => {
  await page.goto("http://localhost:5173/#collection", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    if (location.hash !== "#collection") location.hash = "#collection";
  });
  await page.waitForTimeout(2500);
  if (prepare) await prepare();
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          if (gaps.length >= 240) {
            gaps.sort((a, b) => a - b);
            resolve({
              median: +gaps[120].toFixed(1),
              p95: +gaps[Math.floor(240 * 0.95)].toFixed(1),
              worst: +gaps[239].toFixed(1),
              over16: gaps.filter((g) => g > 16.7).length,
              over33: gaps.filter((g) => g > 33).length,
            });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
  console.log(label, JSON.stringify(stats));
};

await sample("collection-idle    ", null);
await sample("detail-legendary   ", async () => {
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll(".card-cell")].find((c) =>
      (c.getAttribute("aria-label") ?? "").includes("legendary")
    );
    cell?.click();
  });
});
await sample("detail-tilting     ", async () => {
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll(".card-cell")].find((c) =>
      (c.getAttribute("aria-label") ?? "").includes("legendary")
    );
    cell?.click();
  });
  await page.waitForTimeout(800);
  // a pointer sweeping the card for the whole sample window
  await page.evaluate(() => {
    const wrap = document.querySelector(".cd-art");
    const box = wrap.getBoundingClientRect();
    let t = 0;
    const drive = () => {
      t += 0.03;
      wrap.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: box.left + box.width * (0.5 + 0.45 * Math.sin(t)),
          clientY: box.top + box.height * (0.5 + 0.35 * Math.cos(t * 0.7)),
          bubbles: true,
        })
      );
      requestAnimationFrame(drive);
    };
    drive();
  });
});

await browser.close();
