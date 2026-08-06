/**
 * `verify:screens` does not crash because a screen is broken. It crashes on its
 * own wait condition, and this is what proves it.
 *
 * The script dies at `scripts/verify-screens.mjs:128` —
 * `page.goto("…/#stats", { waitUntil: "networkidle" })`, thirty seconds, every
 * run. The obvious reading is that something on the way to the statistics screen
 * never stops fetching, which would be a real defect and would be the eighth
 * time in this project that an instrument's confident answer was about a
 * narrower question than the one asked. So the answer is measured rather than
 * argued: this replays the script's exact sequence — seed the account, land on a
 * live battle, bank three matches through the engine in-page, reload — and then
 * performs the identical navigation with every request in flight counted once a
 * second while the wait runs.
 *
 * What it records:
 *
 *   inflight=0 startedSince=0 url=…/#stats   for the whole fifteen seconds,
 *   and `.stats-screen` present in the document when the wait finally times out.
 *
 * Nothing is fetching, nothing has fetched since the navigation began, the hash
 * has already changed and the destination has already been built. The wait is
 * for a lifecycle event that cannot arrive: `#battle… → #stats` is a
 * *same-document* navigation, no new document is committed, so no new
 * `networkidle` is ever emitted for `goto` to observe.
 *
 * It is a race, which is why it looks intermittent. Run this without the banking
 * block and the goto resolves in ~1.4s — not because the navigation is different
 * but because the reload's own trailing art requests are still settling, so a
 * `networkidle` fires *after* the goto starts and it is collected by the wrong
 * waiter. Anything that makes the previous route finish loading sooner loses the
 * script that race permanently.
 *
 * The repair is in the script, not in the game: seven hash-only gotos in
 * `verify-screens.mjs` want `waitUntil: "commit"` (or a plain `location.hash`
 * write) followed by the `settleOn()` it already has, which waits on the real
 * thing — the screen selector and the absence of `.screen-out`.
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
let started = 0;
const recent = [];
page.on("request", (r) => {
  inflight.add(r);
  started += 1;
  recent.push(r.url());
  if (recent.length > 40) recent.shift();
});
page.on("requestfinished", (r) => inflight.delete(r));
page.on("requestfailed", (r) => inflight.delete(r));

await seedPlayedAccount(page);
console.log("seeded");

await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=301", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
const hasHook = await page.evaluate(() => Boolean(window.hypeboundBattle?.autoPlay));
console.log("autoPlay hook present:", hasHook);

const tBank = Date.now();
  await page.evaluate(async () => {
    const { recordMatch } = await import("/src/save/profile.ts");
    const { getContent } = await import("/src/engine/content.ts");
    const { autoBuildDeck } = await import("/src/engine/deck.ts");
    const { createMatch } = await import("/src/engine/state.ts");
    const { applyIntent } = await import("/src/engine/reducer.ts");
    const { chooseIntent } = await import("/src/ai/ai.ts");
    const { getAiProfile } = await import("/src/ai/profiles.ts");
    const storage = await import("/src/save/storage.ts");
    const content = getContent();
    const build = (seed, a, b) => {
      const config = {
        seed,
        decks: [autoBuildDeck(content, a, "A"), autoBuildDeck(content, b, "B")],
        firstSeat: 0,
      };
      let state = createMatch(config, content);
      const intents = [];
      const profiles = [getAiProfile("casual"), getAiProfile("casual")];
      while (state.phase === "mulligan") {
        const seat = state.players[0].mulliganDone ? 1 : 0;
        const decision = chooseIntent(state, content, seat, profiles[seat]);
        if (!decision) break;
        intents.push(decision.intent);
        state = applyIntent(state, content, decision.intent).state;
      }
      let guard = 0;
      while (state.winner === null && guard++ < 700) {
        const decision = chooseIntent(state, content, state.activeSeat, profiles[state.activeSeat]);
        if (!decision) break;
        intents.push(decision.intent);
        try {
          state = applyIntent(state, content, decision.intent).state;
        } catch {
          break;
        }
      }
      return { config, intents, result: { winner: state.winner, turns: state.turn }, state };
    };
    for (const [seed, leader, deckName, outcome] of [
      [901, "idols-lumi-starcall", "Neon Test", "win"],
      [902, "idols-lumi-starcall", "Neon Test", "loss"],
      [903, "goth-leader-alaric-thornheart", "Goth Test", "win"],
    ]) {
      const built = build(seed, leader, "goth-leader-alaric-thornheart");
      recordMatch(built, outcome, {
        deckName,
        leaderCardId: leader,
        opponentLeaderCardId: "goth-leader-alaric-thornheart",
        mode: "ai-casual",
        content,
      });
    }
    storage.flushAllStores();
  });
console.log("banked in", Date.now() - tBank, "ms");
await page.reload({ waitUntil: "networkidle" });
console.log("reloaded, url =", page.url());
console.log("history =", await page.evaluate(async () => (await import("/src/save/profile.ts")).getProfile().history.length));

started = 0;
const t0 = Date.now();
const ticker = setInterval(() => {
  console.log(
    `  t=${Date.now() - t0}ms inflight=${inflight.size} startedSince=${started} url=${page.url()} ` +
      `screens=${recent.length ? recent[recent.length - 1].slice(-60) : "-"}`
  );
}, 1000);

try {
  await page.goto("http://localhost:5173/#stats", { waitUntil: "networkidle", timeout: 15000 });
  console.log("goto networkidle RESOLVED in", Date.now() - t0, "ms");
} catch (error) {
  console.log("goto networkidle FAILED after", Date.now() - t0, "ms:", String(error).split("\n")[0]);
}
clearInterval(ticker);

console.log("still in flight:", [...inflight].map((r) => r.url()).slice(0, 10));
console.log("last 20 requests:", recent.slice(-20));
console.log("stats screen present:", await page.locator(".stats-screen").count());
console.log("url now:", page.url());

// and the same navigation without the networkidle condition
const t1 = Date.now();
await page.goto("http://localhost:5173/#stats", { waitUntil: "commit", timeout: 15000 }).catch((e) => console.log("commit goto failed:", String(e).split("\n")[0]));
console.log("commit goto took", Date.now() - t1, "ms; .stats-screen =", await page.locator(".stats-screen").count());

await browser.close();
