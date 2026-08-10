/** Where the leftover full-bleed animated layers actually sit in the tree. */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
await seedPlayedAccount(page);

for (const route of ["fairness", "collection", "lobby"]) {
  await page.goto(`http://localhost:5173/#${route}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const path = (el) => {
      const parts = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        parts.unshift((n.tagName || "?").toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/)[0] : ""));
      }
      return parts.join(" > ");
    };
    return {
      ambient: [...document.querySelectorAll(".ambient-bg")].map((n) => ({
        path: path(n),
        directChildOfScreen: !!(n.parentElement && n.parentElement.classList.contains("screen")),
        afterContent: getComputedStyle(n, "::after").content,
        afterAnim: getComputedStyle(n, "::after").animationName,
      })),
      curtains: [...document.querySelectorAll(".nav-curtain")].map((n) => ({ path: path(n), phase: n.dataset.phase, veil: n.dataset.veil })),
      screens: [...document.querySelectorAll(".screen")].map((n) => ({ path: path(n), nav: n.dataset.nav })),
      rooms: document.querySelectorAll(".d-room").length,
      hasSupport: CSS.supports("selector(:has(*))"),
      stepsVar: (() => {
        const d = document.createElement("div");
        d.style.cssText = "--tf:steps(12);animation:nothing 7s var(--tf) infinite";
        document.body.appendChild(d);
        const v = getComputedStyle(d).animationTimingFunction;
        d.remove();
        return v;
      })(),
    };
  });
  console.log(`\n=== ${route}`);
  console.log(JSON.stringify(info, null, 1));
}
await browser.close();
