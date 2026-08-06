/**
 * What does one card face actually cost, and where does it go?
 *
 * The battle board's remaining frame drops are all one shape — the main thread
 * blocked for 150–250ms while a `CanvasTexture` for a card is drawn — and every
 * fix available inside `src/ui/battle` is about *when* that happens rather than
 * how long it takes. This measures the how-long, split by the two suspects the
 * CPU profile named, so the number can be handed to whoever owns the renderer.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
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
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).split("\n")[0]));

try {
  for (let a = 1; ; a++) {
    try {
      await seedPlayedAccount(page, ORIGIN);
      break;
    } catch (e) {
      if (a >= 8) throw e;
      await page.goto(`${ORIGIN}/#starter`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(4000);
    }
  }
  await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const mesh = await import("/src/ui/battle/cardMesh.ts");
    const content = window.hypeboundBattle.content?.() ?? null;
    const cards = content
      ? Object.values(content.cards).filter((c) => c.type === "character").slice(0, 8)
      : [];
    if (cards.length === 0) return { error: "no content bridge" };

    // Every fillRect on a card-sized 2d context, timed. `grainOver` is the only
    // caller that fills the whole canvas with a repeating pattern.
    const proto = CanvasRenderingContext2D.prototype;
    const realFill = proto.fillRect;
    let fillMs = 0;
    let fullCanvasFills = 0;
    let fills = 0;
    proto.fillRect = function (x, y, w, h) {
      const t = performance.now();
      const out = realFill.call(this, x, y, w, h);
      fillMs += performance.now() - t;
      fills++;
      if (w >= this.canvas.width && h >= this.canvas.height) fullCanvasFills++;
      return out;
    };
    const realDraw = proto.drawImage;
    let drawMs = 0;
    proto.drawImage = function (...args) {
      const t = performance.now();
      const out = realDraw.apply(this, args);
      drawMs += performance.now() - t;
      return out;
    };

    const per = [];
    for (const [i, card] of cards.entries()) {
      const t = performance.now();
      // a state nothing has cached, so this is always a real render
      mesh.getCardTexture(card, { attack: 90 + i, health: 90 + i, maxHealth: 90 + i, statEmphasis: true });
      per.push(Math.round(performance.now() - t));
    }
    proto.fillRect = realFill;
    proto.drawImage = realDraw;
    return {
      per,
      total: per.reduce((a, b) => a + b, 0),
      fillMs: Math.round(fillMs),
      drawMs: Math.round(drawMs),
      fills,
      fullCanvasFills,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
