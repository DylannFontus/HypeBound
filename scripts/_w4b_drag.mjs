/**
 * Photograph the board while a card is actually being carried over it.
 *
 * `shot.mjs --eval` cannot do this: a drag is a stream of real pointer events
 * and the feedback it produces only exists between pointerdown and pointerup, so
 * every previous review of the drop target was made from a still of a board with
 * nothing in the air. Frames are written at four moments — before the pickup, on
 * the pickup, over a legal row, and over the rival's — so the difference between
 * "nothing selected" and "receiving" can be diffed rather than described.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const outDir = String(arg("dir", "scripts/screenshots/w4/board"));
const tag = String(arg("out", "drag"));
const [vw, vh] = String(arg("size", "1280x720")).split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const shot = (n) => page.screenshot({ path: path.join(outDir, `${tag}-${n}.png`) });

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count()) {
    await page.click(".mulligan-actions .btn-primary");
  }
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  await shot("0-rest");

  const card = await page.evaluate(() => {
    const all = window.hypeboundBattle.debug().hand.filter((c) => c.ok);
    // A character is the only card that occupies a slot, and the slot feedback
    // is the whole subject here.
    const list = [...all.filter((c) => c.type === "character"), ...all];
    const nodes = [...document.querySelectorAll(".hand-card")];
    for (const c of list) {
      const node = nodes.find((n) => n.dataset.instanceId === c.instanceId);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      return { id: c.instanceId, type: c.type, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (!card) throw new Error("no playable card in hand");
  console.log("carrying", card.type, card.id);

  await page.mouse.move(card.x, card.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(card.x, card.y - 40, { steps: 4 });
  /**
   * The trough eases in over about eleven frames, so a single still cannot say
   * whether it arrived or popped. Four samples 60ms apart across the ramp can.
   */
  for (let i = 0; i < 4; i++) {
    await shot(`1-open-${i}`);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(220);
  await shot("1-picked-up");

  // over the player's own row
  await page.mouse.move(vw * 0.5, vh * 0.6, { steps: 8 });
  await page.waitForTimeout(420);
  await shot("2-over-own-row");

  // over the rival's row: the refusal
  await page.mouse.move(vw * 0.5, vh * 0.24, { steps: 8 });
  await page.waitForTimeout(420);
  await shot("3-over-rival");

  await page.mouse.move(vw * 0.5, vh * 0.6, { steps: 8 });
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(900);
  await shot("4-played");

  console.log(path.join(outDir, `${tag}-*.png`));
} finally {
  await browser.close();
}
