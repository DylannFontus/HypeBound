/**
 * Photograph the board while a card is actually being held over it.
 *
 * The drop socket, the row's gap and the ghost's legality colour only exist
 * between pointerdown and pointerup, so no ordinary screenshot can contain
 * them — every previous review of drag feedback was made from a picture of a
 * board with nothing being dragged. This holds the pointer at three places (a
 * legal slot, the rival's row, and off the mat entirely) and shoots each.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d = null) => (argv.indexOf(`--${n}`) === -1 ? d : argv[argv.indexOf(`--${n}`) + 1]);
const outDir = String(flag("dir", path.join(HERE, "screenshots", "w2", "battlemotion")));
const tag = String(flag("tag", "drag"));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
page.on("pageerror", (e) => console.log("  pageerror:", String(e.message).split("\n")[0]));

const dismiss = async () => {
  const c = page.locator(".confirm-panel .btn-primary");
  await c.waitFor({ state: "visible", timeout: 700 }).catch(() => {});
  if (await c.count()) await c.click().catch(() => {});
};
const endTurn = async () => {
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 40000,
  });
  await page.click(".end-turn-btn");
  await dismiss();
};

try {
  for (let attempt = 1; ; attempt++) {
    try {
      await seedPlayedAccount(page, ORIGIN);
      break;
    } catch (error) {
      if (attempt >= 10) throw error;
      console.log(`  (seed attempt ${attempt} failed — retrying)`);
      await page.goto(`${ORIGIN}/#starter`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(6000);
    }
  }
  await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(900);
  for (let i = 0; i < 2; i++) {
    await endTurn();
    await page.waitForTimeout(1700);
  }
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 40000,
  });
  await page.waitForTimeout(800);

  const pick = await page.evaluate(() => {
    const d = window.hypeboundBattle.debug();
    return d.hand.filter((h) => h.ok && h.needsSlot && h.screen)[0] ?? null;
  });
  if (!pick) throw new Error("no slot-needing playable card in hand");

  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(pick.screen.x, pick.screen.y);
  await page.waitForTimeout(180);
  await page.mouse.down();
  await page.waitForTimeout(80);

  const spots = [
    ["slot", box.x + box.width * 0.5, box.y + box.height * 0.62],
    ["slot-left", box.x + box.width * 0.38, box.y + box.height * 0.6],
    ["enemy-row", box.x + box.width * 0.5, box.y + box.height * 0.3],
    ["far-apron", box.x + box.width * 0.5, box.y + box.height * 0.12],
    ["off-mat", box.x + box.width * 0.08, box.y + box.height * 0.5],
  ];
  for (const [name, x, y] of spots) {
    await page.mouse.move(x, y, { steps: 10 });
    await page.waitForTimeout(420);
    await page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });
    const state = await page.evaluate(() => {
      const d = window.hypeboundBattle.debug();
      const g = document.querySelector(".hand-drag-ghost");
      return { hoverSlot: d.externalDrag?.hoverSlot ?? null, makeRoom: d.makeRoomIndex, ghost: g ? g.className : null };
    });
    console.log(`  ${name.padEnd(10)} hoverSlot=${state.hoverSlot} makeRoom=${state.makeRoom} ghost="${state.ghost}"`);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  console.log(`frames in ${outDir}`);
} finally {
  await browser.close();
}
