/**
 * Drive one real match and photograph the moments the census cannot see.
 *
 * A modal is not a route, so the per-route panel count says nothing about the
 * mulligan curtain, the confirm dialog or the board HUD — and those are three of
 * the four seams the last integration critic named. This plays a card through
 * the real pointer pipeline (the board is a three.js canvas, so a drop target
 * cannot be guessed from a selector), swings an attack, and takes the End Turn
 * confirm, writing one PNG per beat so they can be laid side by side.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const dir = String(arg("dir", "scripts/screenshots/w4/ic3"));
const tag = String(arg("tag", ""));
const [vw, vh] = String(arg("size", "1600x900")).split("x").map(Number);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const shot = async (n) => {
  const f = path.join(dir, `${n}${tag}.png`);
  await page.screenshot({ path: f });
  console.log(f);
};
const idle = () =>
  page
    .waitForFunction(() => !window.hypeboundBattle?.debug()?.busy, null, { timeout: 30000 })
    .catch(() => {});

await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1400);
await shot("07-mulligan");

if (await page.locator(".mulligan-actions .btn-primary").count())
  await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(2000);
await shot("08-board");

const hand = page.locator(".hand-card").first();
if (await hand.count()) {
  await hand.hover();
  await page.waitForTimeout(600);
  await shot("09-hand-hover");
  await page.mouse.move(vw / 2, 10);
  await page.waitForTimeout(400);
}

/**
 * Turn one has one Hype, so a character may simply not be affordable yet. Ending
 * turns until something is playable is the only way to reach the beat the bar
 * actually cares about, and it costs a few seconds of AI turns.
 */
for (let round = 0; round < 6; round++) {
  const card = await page.evaluate(() => {
    const d = window.hypeboundBattle?.debug();
    if (!d) return null;
    const ok = (d.hand ?? []).filter((c) => c.ok);
    const pick = ok.find((c) => c.type === "character") ?? ok[0];
    if (!pick?.screen) return null;
    return { id: pick.instanceId, type: pick.type, ...pick.screen };
  });
  if (card) {
    console.log("round", round, "carrying", card.type, card.id);
    const cx = card.x ?? card.left + card.width / 2;
    const cy = card.y ?? card.top + card.height / 2;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 60, { steps: 5 });
    await page.waitForTimeout(180);
    await page.mouse.move(vw * 0.5, vh * 0.58, { steps: 10 });
    await page.waitForTimeout(320);
    await shot("10-carrying");
    await page.mouse.up();
    await page.waitForTimeout(260);
    await shot("11a-play-mid");
    await page.waitForTimeout(900);
    await shot("11-played");
    break;
  }
  await page.click(".end-turn-btn").catch(() => {});
  const dlg = await page.locator(".modal-card, [role=dialog], .confirm-panel, .dialog").count();
  if (dlg) {
    await shot("12-endturn-confirm");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(1200);
  await idle();
  await page.waitForTimeout(1600);
}

// an attack: pick a friendly character that can swing, drag it at the rival leader
const atk = await page.evaluate(() => {
  const d = window.hypeboundBattle?.debug();
  return d ? { board: d.board ?? d.friendly ?? null, keys: Object.keys(d) } : null;
});
console.log("debug keys:", JSON.stringify(atk?.keys));

await page.mouse.move(vw * 0.5, vh * 0.58);
await page.waitForTimeout(200);
await page.mouse.down();
await page.mouse.move(vw * 0.5, vh * 0.35, { steps: 8 });
await page.waitForTimeout(300);
await shot("13-attack-aim");
await page.mouse.move(vw * 0.5, vh * 0.16, { steps: 8 });
await page.waitForTimeout(300);
await page.mouse.up();
await page.waitForTimeout(900);
await shot("14-attack-done");

// End Turn — with a playable card still in hand this should raise the confirm
await page.click(".end-turn-btn").catch(() => {});
await page.waitForTimeout(600);
await shot("15-endturn");
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const sel = ".modal, .modal-card, [role=dialog], .confirm, .confirm-panel, .dialog, .overlay-card";
      const m = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 100);
      return m.map((e) => {
        const cs = getComputedStyle(e);
        return {
          cls: e.className,
          bgImage: cs.backgroundImage.slice(0, 90),
          bgColor: cs.backgroundColor,
          shadow: cs.boxShadow.slice(0, 120),
          radius: cs.borderRadius,
        };
      });
    }),
    null,
    1
  )
);

await browser.close();
