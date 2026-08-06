/** Why does the press-and-hold peek render see-through? */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2200);

const card = await page.evaluate(
  () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen) ?? null
);
await page.mouse.move(card.screen.x, card.screen.y);
await page.mouse.down();
await page.waitForTimeout(1500); // well past any entrance animation

const stacking = await page.evaluate(() => {
  const overlay = document.querySelector(".battle-overlay.peeking");
  const host = document.querySelector(".battle-board-host");
  const boardCanvas = host?.querySelector("canvas");
  const describe = (el, label) => {
    if (!el) return { label, missing: true };
    const cs = getComputedStyle(el);
    return {
      label,
      tag: el.tagName,
      className: el.className,
      position: cs.position,
      zIndex: cs.zIndex,
      backdropFilter: cs.backdropFilter,
      background: cs.backgroundColor,
      parent: el.parentElement?.className ?? "(none)",
      // index among siblings decides paint order when z-index ties
      domIndex: el.parentElement ? [...el.parentElement.children].indexOf(el) : -1,
      siblings: el.parentElement ? el.parentElement.children.length : 0,
    };
  };
  return {
    overlay: describe(overlay, "overlay"),
    host: describe(host, "board host"),
    boardCanvas: describe(boardCanvas, "board canvas"),
  };
});
console.log("STACKING:", JSON.stringify(stacking, null, 1));

const probe = await page.evaluate(() => {
  const overlay = document.querySelector(".battle-overlay.peeking");
  const panel = document.querySelector(".detail-panel");
  const canvas = panel?.querySelector("canvas");
  const read = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      opacity: cs.opacity,
      animationName: cs.animationName,
      animationFillMode: cs.animationFillMode,
      background: cs.backgroundColor,
      zIndex: cs.zIndex,
      mixBlendMode: cs.mixBlendMode,
      filter: cs.filter,
    };
  };
  const rect = canvas?.getBoundingClientRect();
  return {
    overlay: read(overlay),
    panel: read(panel),
    canvas: read(canvas),
    // what the browser thinks is painted on top at the card's centre
    topmostAtCardCentre: rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.className ?? "?"
      : "?",
  };
});

console.log(JSON.stringify(probe, null, 1));
await page.screenshot({ path: "scripts/screenshots/peek-with-drag.png" });
await page.mouse.up();
await page.waitForTimeout(600);

/**
 * Same overlay, same CSS, but opened by right-click so no drag is live.
 * If this one renders correctly the drag is what breaks compositing.
 */
await page.mouse.move(card.screen.x, card.screen.y);
await page.mouse.click(card.screen.x, card.screen.y, { button: "right" });
await page.waitForTimeout(900);
await page.screenshot({ path: "scripts/screenshots/peek-no-drag.png" });
console.log("wrote peek-with-drag.png and peek-no-drag.png");

await browser.close();
