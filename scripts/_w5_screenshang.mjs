/**
 * A faithful re-run of the first forty lines of `verify-screens.mjs`, watched.
 *
 * The companion instrument `_w5_statsnet.mjs` proved that `#stats` reached from
 * the lobby issues **zero** network requests and leaves nothing in flight, so
 * "networkidle never arrives because the screen keeps loading" is dead as an
 * explanation. What is different in the failing script is where it navigates
 * *from*: a live battle, mid-mulligan, entered by URL.
 *
 * So this repeats that exact route — seed, battle, the recordMatch fallback,
 * reload — and then attempts the same `goto("#stats")` while logging the hash,
 * the mounted screen and the in-flight count every 250ms. The trap it exists to
 * avoid is reporting a timeout as a performance problem: a wait that never ends
 * and a wait that ends slowly need opposite fixes, and only one of them is
 * consistent with an idle network.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

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

const inflight = new Set();
page.on("request", (r) => inflight.add(r));
page.on("requestfinished", (r) => inflight.delete(r));
page.on("requestfailed", (r) => inflight.delete(r));
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`  framenavigated → ${f.url()}`); });

await seedPlayedAccount(page);
console.log("seeded");

await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=301", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
console.log("mulligan up");
const hasHook = await page.evaluate(() => Boolean(window.hypeboundBattle?.autoPlay));
console.log(`autoPlay hook present: ${hasHook}`);

if (!hasHook) {
  await page.evaluate(async () => {
    const { recordMatch } = await import("/src/save/profile.ts");
    const { getContent } = await import("/src/engine/content.ts");
    const storage = await import("/src/save/storage.ts");
    const content = getContent();
    recordMatch(
      { config: { seed: 1, decks: [], firstSeat: 0 }, intents: [], result: { winner: 0, turns: 3 }, state: {} },
      "win",
      { deckName: "Probe", leaderCardId: "idols-lumi-starcall", opponentLeaderCardId: "goth-leader-alaric-thornheart", mode: "ai-casual", content },
    );
    storage.flushAllStores();
  }).catch((e) => console.log(`  record failed: ${e.message}`));
  await page.reload({ waitUntil: "networkidle" });
  console.log("reloaded onto the battle URL");
}

const state = async () =>
  page.evaluate(() => ({
    hash: location.hash,
    screens: [...document.querySelectorAll(".screen, [data-screen]")].map((n) => n.className).slice(0, 3),
    dialogs: [...document.querySelectorAll("dialog[open], .modal, .confirm")].length,
  }));

console.log("before goto:", JSON.stringify(await state()), `inflight=${inflight.size}`);

const watcher = setInterval(async () => {
  try {
    console.log(`  ..${JSON.stringify(await state())} inflight=${inflight.size}`);
  } catch {}
}, 500);

const t = Date.now();
await page
  .goto("http://localhost:5173/#stats", { waitUntil: "networkidle", timeout: 12000 })
  .then(() => console.log(`goto RESOLVED in ${Date.now() - t}ms`))
  .catch((e) => console.log(`goto FAILED after ${Date.now() - t}ms: ${e.message.split("\n")[0]}`));
clearInterval(watcher);
console.log("after goto:", JSON.stringify(await state()), `inflight=${inflight.size}`);

// Control: does the same navigation work when it is not a goto?
await page.evaluate(() => { location.hash = "#lobby"; });
await page.waitForTimeout(800);
const t2 = Date.now();
await page
  .goto("http://localhost:5173/#stats", { waitUntil: "networkidle", timeout: 12000 })
  .then(() => console.log(`control goto from lobby RESOLVED in ${Date.now() - t2}ms`))
  .catch((e) => console.log(`control goto from lobby FAILED after ${Date.now() - t2}ms: ${e.message.split("\n")[0]}`));

await browser.close();
