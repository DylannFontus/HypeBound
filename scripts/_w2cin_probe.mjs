/** One-off probe: gfx tier, atmosphere layers, and what is actually animating at rest. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const b = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await p.waitForTimeout(1800);
console.log(
  JSON.stringify(
    await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const anims = document.getAnimations();
      return {
        tier: document.documentElement.dataset["gfxTier"],
        reduced: document.documentElement.dataset["reducedMotion"],
        blur: cs.getPropertyValue("--nav-recede-blur"),
        dim: cs.getPropertyValue("--nav-recede-dim"),
        atmosphere: Array.from(document.querySelectorAll(".atmosphere > *")).map((e) => e.className),
        atmosphereOutsideApp: !document.getElementById("app")?.contains(document.querySelector(".atmosphere")),
        runningCount: anims.length,
        running: Array.from(new Set(anims.map((a) => a.animationName ?? "?"))),
      };
    }),
    null,
    1
  )
);
await b.close();
