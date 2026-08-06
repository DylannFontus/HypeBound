/**
 * Does the deck's card back reach the board, and on which route?
 *
 * `verify:decks` step 12 reports "could not read the board's card back", which
 * is the script's phrasing for `cardBackStyleFor(0)` coming back null after
 * entering a match through **Test vs AI**. That single sentence covers two
 * unrelated faults: the per-deck card back never reaching any board, or the
 * unsaved-draft handover specifically dropping the field on its way through
 * `?test=1`. One is a feature that does not work; the other is a hole in one
 * path, and a report that cannot tell them apart is worth nothing.
 *
 * So this equips a back on a saved deck and enters a match **twice** — once by
 * URL, which reads the saved slot, and once through Test vs AI, which hands an
 * in-memory draft to the battle route — and prints what the board believes each
 * time. Whichever of the two comes back null is the one that is broken.
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
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));

await seedPlayedAccount(page);

// Own the award back, wear nothing, and put it on deck slot 0.
await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const { autoBuildDeck } = await import("/src/engine/deck.ts");
  const content = getContent();
  profileStore.update((draft) => {
    if (!draft.cosmetics.owned.includes("cardBack:award:gauntlet")) draft.cosmetics.owned.push("cardBack:award:gauntlet");
    draft.cosmetics.equipped = {};
    const deck = autoBuildDeck(content, "idols-lumi-starcall", "Back Test");
    deck.cardBackId = "cardBack:award:gauntlet";
    draft.decks[0] = deck;
    draft.activeDeck = 0;
  });
  const storage = await import("/src/save/storage.ts");
  storage.flushAllStores();
});

const readBack = async (label) => {
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  const seen = [];
  for (let i = 0; i < 24; i++) {
    /**
     * Through the battle screen's handle, not through a fresh `import()`.
     *
     * This script's original readout was the defect it was written to find. A
     * dev server that has served an HMR update holds `cardMesh.ts` in its graph
     * as `cardMesh.ts?t=<stamp>`; importing the bare path from here is a
     * different URL and therefore a *second instance* of the module, whose
     * `playerCardBack` has never been written. Twenty-four samples of `null`
     * over three seconds on two separate routes, from a board that was dealing
     * the right back the whole time.
     */
    seen.push(await page.evaluate(() => {
      const s = window.hypeboundCardBack?.() ?? null;
      return s ? s.emblem : null;
    }));
    await page.waitForTimeout(120);
  }
  console.log(`${label}: cardBackStyleFor(0) over 3s = ${JSON.stringify(seen)}`);
};

/** What `battleScreen.ts` would compute, recomputed here from the same inputs. */
const explain = async () =>
  console.log(
    "  inputs: " +
      JSON.stringify(
        await page.evaluate(async () => {
          const { getProfile, playableDeck } = await import("/src/save/profile.ts");
          const { getContent } = await import("/src/engine/content.ts");
          const { cosmeticById } = await import("/src/game/cosmetics/index.ts");
          const { selectableLeaders } = await import("/src/game/roster/index.ts").catch(() => ({}));
          const content = getContent();
          const profile = getProfile();
          const deck = playableDeck(content, selectableLeaders ? selectableLeaders(content)[0]?.id ?? "" : "");
          const cosmetic = deck.cardBackId ? cosmeticById(content, deck.cardBackId) : null;
          return {
            activeDeckIndex: profile.activeDeckIndex,
            deckNames: profile.decks.map((d) => d?.name ?? null),
            chosenDeck: deck.name,
            chosenCardBackId: deck.cardBackId ?? null,
            cosmetic: cosmetic ? { kind: cosmetic.kind, color: cosmetic.color, emblem: cosmetic.emblem ?? null } : null,
          };
        }),
      ),
  );

// 1. the saved slot, entered by URL
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=414", { waitUntil: "load" });
await readBack("saved deck, entered by URL     ");
await explain();

// 2. the same deck through the builder's Test vs AI
await page.goto("http://localhost:5173/#deckbuilder?deck=0", { waitUntil: "load" });
await page.waitForSelector(".builder-screen", { timeout: 20000 });
await page.waitForTimeout(600);
const stored = await page.evaluate(() => window.hypeboundBuilder?.deck()?.cardBackId ?? null);
console.log(`the builder's draft carries cardBackId = ${JSON.stringify(stored)}`);
await page.locator(".builder-actions button", { hasText: "Test vs AI" }).first().click();
await readBack("draft, through Test vs AI      ");

await browser.close();
