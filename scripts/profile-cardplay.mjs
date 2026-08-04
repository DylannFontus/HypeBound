/**
 * Where does the frame go when a card is played?
 *
 * The screencast of a play shows three identical frames across 164ms starting
 * on the mouse-up — the browser is not merely slow there, it is not painting at
 * all. A long-task entry says "something took 164ms" and nothing else, so this
 * takes a real CPU sample across the same window and prints the self-time
 * leaders. Guessing which call is expensive has already cost one round.
 *
 *   node scripts/profile-cardplay.mjs
 *   node scripts/profile-cardplay.mjs --what turn
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

void path;
void fileURLToPath;
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const what = argv.includes("--what") ? argv[argv.indexOf("--what") + 1] : "play";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const cdp = await page.context().newCDPSession(page);

const report = (profile, label) => {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = new Map();
  // self time from the sample stream, weighted by the real inter-sample delta
  const deltas = profile.timeDeltas ?? [];
  profile.samples.forEach((id, i) => {
    const dt = (deltas[i] ?? 0) / 1000;
    const n = byId.get(id);
    if (!n) return;
    const key = `${n.callFrame.functionName || "(anonymous)"} @ ${String(n.callFrame.url).split("/").pop()}:${n.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
    // walk up the parents so the aggregate cost of a whole subtree is visible
    const seen = new Set();
    let cur = n;
    while (cur) {
      const k = `${cur.callFrame.functionName || "(anonymous)"} @ ${String(cur.callFrame.url).split("/").pop()}:${cur.callFrame.lineNumber + 1}`;
      if (!seen.has(k)) {
        total.set(k, (total.get(k) ?? 0) + dt);
        seen.add(k);
      }
      cur = profile.nodes.find((p) => p.children?.includes(cur.id));
    }
  });
  const top = (m, n = 18) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(`\n=== ${label} — self time (ms) ===`);
  for (const [k, v] of top(self)) if (v >= 1) console.log(`  ${v.toFixed(1).padStart(7)}  ${k}`);
  console.log(`\n=== ${label} — total (inclusive, ms) ===`);
  for (const [k, v] of top(total, 22)) if (v >= 4) console.log(`  ${v.toFixed(1).padStart(7)}  ${k}`);
};

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(800);

  const endTurn = async () => {
    await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
      timeout: 40000,
    });
    await page.click(".end-turn-btn");
    const c = page.locator(".confirm-panel .btn-primary");
    if (await c.count()) await c.click();
  };

  for (let i = 0; i < 3; i++) {
    await endTurn();
    await page.waitForTimeout(1700);
  }
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 40000,
  });
  await page.waitForTimeout(700);

  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 120 });

  if (what === "play") {
    const pick = await page.evaluate(() => {
      const d = window.hypeboundBattle.debug();
      return d.hand.filter((h) => h.ok && h.needsSlot && h.screen)[0] ?? null;
    });
    if (!pick) throw new Error("no playable character in hand");
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(pick.screen.x, pick.screen.y);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62, { steps: 14 });
    await page.waitForTimeout(320);
    await cdp.send("Profiler.start");
    await page.mouse.up();
    await page.waitForTimeout(900);
    const { profile } = await cdp.send("Profiler.stop");
    report(profile, "card play (mouse-up + 900ms)");
  } else {
    await cdp.send("Profiler.start");
    await page.click(".end-turn-btn");
    const c = page.locator(".confirm-panel .btn-primary");
    if (await c.count()) await c.click();
    await page.waitForTimeout(3000);
    const { profile } = await cdp.send("Profiler.stop");
    report(profile, "turn handover (click + 3000ms)");
  }
} finally {
  await browser.close();
}
