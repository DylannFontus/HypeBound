/**
 * Did the match card get drawn on the curtain, and if not, why not.
 *
 * `shell.ts` leaves `performance.mark("dress:end:true|false")` behind on every
 * battle navigation precisely so this question has an answer that does not
 * depend on being able to see the pixels.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE THROW:", e.message));
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const w = window;
  w.__log = [];
  const t0 = performance.now();
  const tick = () => {
    const veil = document.querySelector(".nav-curtain");
    w.__log.push(
      `${Math.round(performance.now() - t0)} ${veil === null ? "none" : `${veil.dataset.phase}/${veil.dataset.billing ?? "-"}/${veil.querySelectorAll(".match-side").length}`}`
    );
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  location.hash = "#battle";
});
await page.waitForTimeout(1200);
console.log((await page.evaluate(() => window.__log)).slice(0, 14).join("  |  "));
const out = (
  await page.evaluate(() => {
    const veil = document.querySelector(".nav-curtain");
    const look = (sel) => {
      const el = veil?.querySelector(sel);
      if (!el) return `${sel}: absent`;
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return `${sel}: opacity ${s.opacity} visibility ${s.visibility} display ${s.display} transform ${s.transform} box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} anim ${s.animationName}`;
    };
    const canvas = veil?.querySelector("canvas.match-portrait");
    let ink = "no canvas";
    if (canvas instanceof HTMLCanvasElement) {
      const pen = canvas.getContext("2d");
      const px = pen?.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let lit = 0;
      if (px) {
        for (let i = 0; i < px.length; i += 4) {
          sum += px[i + 3];
          if (px[i + 3] > 8) lit += 1;
        }
        ink = `alpha mean ${(sum / (px.length / 4)).toFixed(1)}, ${((100 * lit) / (px.length / 4)).toFixed(1)}% opaque`;
      }
    }
    const png = canvas instanceof HTMLCanvasElement ? canvas.toDataURL("image/png") : null;
    return {
      marks: performance.getEntriesByType("mark").map((m) => m.name),
      styles: [".match-side.is-away", ".match-side.is-home", ".match-portrait", ".match-plate", ".match-vs"].map(look),
      portrait: ink,
      png,
    };
  })
);
const { png, ...rest } = out;
console.log(rest);
if (typeof png === "string") {
  mkdirSync("scripts/screenshots/w3/shell", { recursive: true });
  writeFileSync("scripts/screenshots/w3/shell/portrait.png", Buffer.from(png.split(",")[1], "base64"));
  console.log("portrait canvas -> scripts/screenshots/w3/shell/portrait.png");
}
await browser.close();
