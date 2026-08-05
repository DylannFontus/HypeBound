/**
 * A seeded account that has *played*, for the record screens.
 *
 * `seedPlayedAccount` gives a browser a full collection and nothing else, which
 * is right for the collection and the deck builder and wrong for every screen in
 * the records hub: Statistics, Match History, Leaderboards and the profile all
 * read `profile.history`, and with an empty history all four render their empty
 * state. Reviewing them meant reviewing four empty states and never once seeing
 * the screen a player who has played thirty matches actually gets.
 *
 * So this writes a plausible history — mixed modes, mixed factions, mixed
 * results, per-match detail on most of them — through the store rather than
 * through `localStorage`, for the reason `account.mjs` documents at length: the
 * starter grant leaves a pending save on the 250ms debounce and a direct write
 * loses the race.
 *
 * It writes **no replay records**, deliberately. A record is a real
 * `{config, intents[]}` that the engine has to be able to reproduce, and a
 * fabricated one would make the Replay Theater draw a board that never happened.
 * Every row is honest about it: they all wear the "No replay" tag, which is a
 * long-lived real state (only the newest eight ever keep a record) and one the
 * screen has to look right in.
 */

const LEADERS = [
  ["idols-dj-kilowatt", "neon-idols"],
  ["goth-leader-morvina-vane", "gothic-royalty"],
  ["viral-leader-blayze-trendall", "viral-influencers"],
  ["corp-leader-cressida-vale", "corporate-creators"],
  ["demon-leader-ashvyre-dropped-frames", "digital-demons"],
  ["grass-leader-juniper-vale", "touch-grass-order"],
];

const MODES = ["ai-easy", "ai-normal", "ai-expert", "casual", "story", "gauntlet"];
const DECKS = ["Neon Idols Starter", "Kilowatt Aggro", "Widow's Court", "Ratio Machine"];

/** Deterministic, so two runs of a review are comparing the same account. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Give the page a played-in history. Call *after* `seedPlayedAccount`.
 *
 * @param {import("playwright-core").Page} page
 * @param {number} matches how many entries to write
 */
export async function seedHistory(page, matches = 34) {
  const rng = mulberry(20260805);
  const now = Date.parse("2026-08-05T19:20:00Z");
  const history = [];
  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (let i = 0; i < matches; i++) {
    const [leaderCardId, faction] = LEADERS[Math.floor(rng() * LEADERS.length)];
    const [opponentLeaderCardId] = LEADERS[Math.floor(rng() * LEADERS.length)];
    const roll = rng();
    const result = roll < 0.56 ? "win" : roll < 0.94 ? "loss" : "draw";
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else draws++;
    // The deriver was added part-way through the project's life, so the *oldest*
    // entries are the ones with no per-match detail. Getting this the wrong way
    // round made every review look at the one state a real account rarely has.
    const detailed = i < matches - 6;
    history.push({
      id: `seed-${i}`,
      // newest first, one every few hours, so the dates span a fortnight
      playedAt: now - i * (3.4 * 3600_000 + Math.floor(rng() * 5) * 900_000),
      deckName: DECKS[Math.floor(rng() * DECKS.length)],
      leaderCardId,
      opponentLeaderCardId,
      result,
      turns: 6 + Math.floor(rng() * 11),
      mode: MODES[Math.floor(rng() * MODES.length)],
      faction,
      ...(detailed
        ? {
            summary: {
              cardsPlayed: 9 + Math.floor(rng() * 14),
              charactersDefeated: Math.floor(rng() * 9),
              damageToEnemyLeader: 12 + Math.floor(rng() * 24),
              confluencesActivated: Math.floor(rng() * 3),
              perfectResonances: Math.floor(rng() * 2),
              peakObsession: 1 + Math.floor(rng() * 6),
            },
          }
        : {}),
    });
  }

  await page.evaluate(
    async ({ history, wins, losses, draws }) => {
      const { profileStore } = await import("/src/save/profile.ts");
      const storage = await import("/src/save/storage.ts");
      profileStore.update((draft) => {
        draft.history = history;
        draft.stats.matchesPlayed = history.length;
        draft.stats.wins = wins;
        draft.stats.losses = losses;
        draft.stats.draws = draws;
        draft.accountLevel = 14;
        draft.accountXp = 260;
        draft.displayName = "Static Cling";
      });
      storage.flushAllStores();
    },
    { history, wins, losses, draws }
  );

  await page.reload({ waitUntil: "networkidle" });
  return { matches: history.length, wins, losses, draws };
}
