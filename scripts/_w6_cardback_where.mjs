/**
 * Is the deck's card back on the *pixels*, and does it survive a second match?
 *
 * `_w5_cardback.mjs` asks the game what back it believes it is dealing. That is
 * necessary and it is not sufficient — the value being right is what the last
 * two waves argued about, and the argument was only settled by discovering the
 * reader was looking at a second copy of the module. So this one never asks the
 * game anything: it decodes the bitmap the hand is actually painting with and
 * reports its mean colour.
 *
 * Two matches, deliberately. `handBar`'s back was a module-level `string | null`
 * filled on first use and never revisited, and a module lives as long as the
 * tab, so the second deck of a session wore the first deck's back on every card
 * in hand while the 3D board beside it (keyed by colour and emblem) wore the
 * right one. One match cannot see that.
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
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));

/** Two owned backs with very different hues, so a stale cache cannot hide. */
const DECKS = [
  { slot: 0, id: "cardBack:award:gauntlet", name: "Gold Deck" },
  { slot: 1, id: null, name: "House Deck" },
];

try {
  await seedPlayedAccount(page, ORIGIN);

  const houseBack = await page.evaluate(async (decks) => {
    const { profileStore } = await import("/src/save/profile.ts");
    const { getContent } = await import("/src/engine/content.ts");
    const { autoBuildDeck } = await import("/src/engine/deck.ts");
    const { cosmeticById } = await import("/src/game/cosmetics/index.ts");
    const content = getContent();
    profileStore.update((draft) => {
      if (!draft.cosmetics.owned.includes("cardBack:award:gauntlet")) {
        draft.cosmetics.owned.push("cardBack:award:gauntlet");
      }
      draft.cosmetics.equipped = {};
      for (const d of decks) {
        const deck = autoBuildDeck(content, "idols-lumi-starcall", d.name);
        if (d.id) deck.cardBackId = d.id;
        draft.decks[d.slot] = deck;
      }
      draft.activeDeckIndex = 0;
    });
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    const gold = cosmeticById(content, "cardBack:award:gauntlet");
    return { gold: gold ? { color: gold.color, emblem: gold.emblem } : null };
  }, DECKS);
  console.log(`the award back resolves to ${JSON.stringify(houseBack.gold)}`);

  /** Mean colour of the bitmap a hand card is actually painting its back with. */
  const sampleHandBack = async () => {
    await page.waitForSelector(".battle-screen", { timeout: 25000 });
    await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count()) {
      await page.click(".mulligan-actions .btn-primary");
    }
    await page.waitForSelector(".hand-card-back", { timeout: 25000 });
    await page.waitForTimeout(1200);
    return page.evaluate(async () => {
      const node = document.querySelector(".hand-card-back");
      const url = getComputedStyle(node).backgroundImage.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
      if (!url || url === "none") return { error: "no background-image on .hand-card-back" };
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // The middle half only: the frame band is nearly the same on every back,
      // and the emblem plate is what the cosmetic actually colours.
      const x0 = Math.round(img.width * 0.25);
      const y0 = Math.round(img.height * 0.25);
      const d = ctx.getImageData(x0, y0, Math.round(img.width * 0.5), Math.round(img.height * 0.5)).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
      return { size: `${img.width}x${img.height}`, mean: `#${hex(r)}${hex(g)}${hex(b)}` };
    });
  };

  await page.goto(`${ORIGIN}/?nointro#battle?difficulty=beginner&seed=414`, { waitUntil: "load" });
  const first = await sampleHandBack();
  const firstValue = await page.evaluate(() => window.hypeboundCardBack?.() ?? null);
  console.log(`match 1 (deck 0, award back):  hand back mean ${JSON.stringify(first)}  board says ${JSON.stringify(firstValue)}`);

  // Switch the active deck to the one with no back of its own, and play again.
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "load" });
  await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    profileStore.update((draft) => {
      draft.activeDeckIndex = 1;
    });
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
  });
  await page.goto(`${ORIGIN}/?nointro#battle?difficulty=beginner&seed=515`, { waitUntil: "load" });
  const second = await sampleHandBack();
  const secondValue = await page.evaluate(() => window.hypeboundCardBack?.() ?? null);
  console.log(`match 2 (deck 1, house back):  hand back mean ${JSON.stringify(second)}  board says ${JSON.stringify(secondValue)}`);

  if (first.mean && second.mean && first.mean === second.mean) {
    console.log("\nFAIL: both matches painted the same back — the hand's cache is stale again");
  } else {
    console.log("\nthe two matches painted different backs, so the hand is not serving a stale bitmap");
  }
} finally {
  await browser.close();
}
