/**
 * What the drag ghost and the board *say* at each point of the arena.
 *
 * The film answers "does anything change"; this answers "does it change to the
 * right thing", which a diff cannot, because a refusal and an invitation are
 * both differences. It walks the pointer across a grid of the arena during a
 * live drag and prints, per sample: the world point under the cursor, whether
 * `isPlayZone` accepts it, and the class the ghost is wearing. A row where the
 * ghost says `drop-valid` and the play zone says no — or the other way round —
 * is a defect that no screenshot could name.
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#battle?seed=414`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count()) await page.click(".mulligan-actions .btn-primary");
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  const findCharacter = () =>
    page.evaluate(() => {
      const hand = window.hypeboundBattle.debug().hand;
      const nodes = [...document.querySelectorAll(".hand-card")];
      const pick = hand.find(
        (c) => c.type === "character" && c.ok !== false && nodes.some((n) => n.dataset.instanceId === c.instanceId)
      );
      if (!pick) return {};
      const r = nodes.find((n) => n.dataset.instanceId === pick.instanceId).getBoundingClientRect();
      return { id: pick.instanceId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

  let card = await findCharacter();
  for (let turn = 0; !card.id && turn < 8; turn++) {
    await page.click(".end-turn-btn");
    await page.waitForTimeout(600);
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1400);
    card = await findCharacter();
  }
  if (!card.id) throw new Error("no playable character in hand");

  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  await page.mouse.move(card.x, card.y - 50, { steps: 4 });
  await page.waitForTimeout(300);

  const rows = [];
  for (const fy of [0.1, 0.14, 0.2, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.72, 0.78]) {
    for (const fx of [0.1, 0.16, 0.22, 0.5, 0.78, 0.84, 0.9]) {
      const x = Math.round(1600 * fx);
      const y = Math.round(900 * fy);
      await page.mouse.move(x, y, { steps: 3 });
      await page.waitForTimeout(90);
      const seen = await page.evaluate(() => {
        const ghost = document.querySelector(".hand-drag-ghost");
        const face = ghost?.querySelector("canvas");
        return {
          ghost: ghost ? [...ghost.classList].filter((c) => c.startsWith("drop-")).join(",") || "(none)" : "(gone)",
          scale: face ? face.style.scale || "1" : "-",
          probe: window.hypeboundBattle.debug().dropProbe,
        };
      });
      rows.push({ fx, fy, x, y, ...seen });
    }
  }
  await page.mouse.up();

  console.log("screen        world x,z        board arena cancel   ghost          scale");
  for (const r of rows) {
    const p = r.probe ?? {};
    const w = p.world ? `${String(p.world.x).padStart(7)},${String(p.world.z).padStart(6)}` : "        null  ";
    console.log(
      `${String(r.x).padStart(4)},${String(r.y).padStart(3)}   ${w}   ` +
        `${p.overBoard ? "yes" : "no "}   ${p.overArena ? "yes" : "no "}   ${p.overCancelStrip ? "yes" : "no "}      ` +
        `${r.ghost.padEnd(14)} ${r.scale}`
    );
  }
  const states = new Map();
  for (const r of rows) states.set(r.ghost, (states.get(r.ghost) ?? 0) + 1);
  console.log("\ntally: " + JSON.stringify(Object.fromEntries(states)));
} finally {
  await browser.close();
}
