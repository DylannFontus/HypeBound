/**
 * Give a fresh browser an account that has already played.
 *
 * Every verification launches a clean browser profile, which is now a *brand-new
 * account*: no cards, and sent to the starter picker before anything else. That
 * is right for the game and wrong for a script that wants to exercise the deck
 * builder or the collection, so each script calls this once before it navigates.
 *
 * Two steps, and the order matters. The faction is chosen through **the app's own
 * picker**, so the account is started by exactly the code a player would use and
 * there is no second definition of what a starter grant is. Then the collection
 * is filled out directly, because these scripts are checking the Doomscroll or
 * the deck builder and should fail when *those* break — not when a new account
 * turns out to own thirty cards.
 *
 * `verify-shop.mjs` deliberately does NOT use this: the new-player path is the
 * thing it is checking, and a seeded collection would hide the very behaviour it
 * exists to prove.
 */

const ORIGIN = "http://localhost:5173";

/** Seed a started account with a full collection, and leave the page reloaded. */
export async function seedPlayedAccount(page, origin = ORIGIN) {
  if (!page.url().startsWith(origin)) {
    await page.goto(origin, { waitUntil: "networkidle" });
  }

  const started = await page.evaluate(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data?.starterFaction);
    } catch {
      return false;
    }
  });

  if (!started) {
    if ((await page.locator(".starter-screen").count()) === 0) {
      await page.goto(`${origin}/#starter`, { waitUntil: "networkidle" });
    }
    await page.waitForSelector(".starter-screen", { timeout: 20000 });
    await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
    await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });
  }

  /**
   * Fill the collection from the card files the dev server is already serving.
   * Two copies of everything (one Legendary) is the playable cap, which is what
   * these scripts want: every card craftable, every deck buildable, nothing
   * about the UI gated behind progression they are not testing.
   *
   * SEEDED THROUGH THE STORE, NOT THROUGH `localStorage`.
   *
   * Writing the key directly and reloading loses the write: the starter grant
   * above leaves a pending save on the store's 250ms debounce, `pagehide` flushes
   * it during the reload, and the in-memory profile — which still holds only the
   * starter deck — lands on top of the seeded collection. That is exactly the
   * trap `verify-tour.mjs` hit when it seeded faction unlocks, and it had been
   * quietly costing every script that calls this one its collection: the account
   * they were "given everything" ended up owning the twenty cards a starter deck
   * happens to contain. Going through `profileStore.update` and flushing means
   * the write cannot be overtaken by one that is already in flight.
   */
  const owned = await page.evaluate(async () => {
    const files = [
      "afterparty-crew", "algorithm-syndicate", "corporate-creators", "cosplay-champions",
      "digital-demons", "gothic-royalty", "meme-collective", "neon-idols", "neutral",
      "touch-grass-order", "viral-influencers",
    ];
    const collection = {};
    for (const file of files) {
      const response = await fetch(`/data/cards/${file}.json`);
      if (!response.ok) continue;
      const raw = await response.json();
      for (const card of raw.cards ?? raw) {
        if (card.token || card.type === "leader" || card.variantOf) continue;
        collection[card.id] = card.rarity === "legendary" ? 1 : 2;
      }
    }
    const { profileStore } = await import("/src/save/profile.ts");
    const storage = await import("/src/save/storage.ts");
    profileStore.update((draft) => {
      draft.collection = collection;
      draft.clout = 5000;
      draft.shards = 5000;
    });
    storage.flushAllStores();
    return Object.keys(collection).length;
  });

  if (owned < 100) {
    throw new Error(`seedPlayedAccount only granted ${owned} cards — the card files did not load`);
  }

  await page.reload({ waitUntil: "networkidle" });
}
