/**
 * The list of data files, written down instead of discovered.
 *
 * `content.ts` and `encounters.ts` used to find their inputs with
 * `import.meta.glob`, which is a Vite feature and not a JavaScript one. That was
 * fine while the engine only ever ran inside a Vite build. It stops being fine
 * the moment the same engine has to run on Cloudflare Workers, because
 * `src/engine` is imported **verbatim** by the server — never forked, never
 * re-implemented (multiplayer §15, sequencing rule 1) — and wrangler's bundler
 * has no idea what a glob is. It does not fail loudly either: `import.meta.glob`
 * survives as a runtime property access, returns `undefined`, and the server
 * starts a match with **zero cards in it**.
 *
 * So the discovery moves here, to one module both builds can compile, and the
 * cost of that convenience — someone adds `data/cards/new-faction.json` and
 * forgets this file — is paid by a test rather than by a player. See
 * `tests/data-files.test.ts`, which lists the two directories from disk and
 * fails if either disagrees with what is exported below.
 *
 * The `path` strings are kept in the exact shape the glob used to produce
 * (`../../data/cards/x.json`, relative to this directory) because `content.ts`
 * sorts by them to fix card order, and card order is load-bearing:
 * `collectibleCards()` reads `Object.values(content.cards)` in insertion order,
 * so a different order is a different deck for the same seed. Preserving the key
 * strings makes this refactor provably order-identical rather than
 * order-identical by inspection.
 */

import afterpartyCrew from "../../data/cards/afterparty-crew.json";
import algorithmSyndicate from "../../data/cards/algorithm-syndicate.json";
import bosses from "../../data/cards/bosses.json";
import corporateCreators from "../../data/cards/corporate-creators.json";
import cosplayChampions from "../../data/cards/cosplay-champions.json";
import digitalDemons from "../../data/cards/digital-demons.json";
import gothicRoyalty from "../../data/cards/gothic-royalty.json";
import memeCollective from "../../data/cards/meme-collective.json";
import neonIdols from "../../data/cards/neon-idols.json";
import neutral from "../../data/cards/neutral.json";
import tokens from "../../data/cards/tokens.json";
import touchGrassOrder from "../../data/cards/touch-grass-order.json";
import tutorialCards from "../../data/cards/tutorial.json";
import viralInfluencers from "../../data/cards/viral-influencers.json";

import puzzleEncounters from "../../data/encounters/puzzles.json";
import tutorialEncounters from "../../data/encounters/tutorial.json";

/** One data file: the module path it used to be globbed under, and its content. */
export interface DataFile {
  readonly path: string;
  readonly data: unknown;
}

/** Every card file under `data/cards/`. Order is imposed by the consumer, not by this list. */
export const CARD_FILES: readonly DataFile[] = [
  { path: "../../data/cards/afterparty-crew.json", data: afterpartyCrew },
  { path: "../../data/cards/algorithm-syndicate.json", data: algorithmSyndicate },
  { path: "../../data/cards/bosses.json", data: bosses },
  { path: "../../data/cards/corporate-creators.json", data: corporateCreators },
  { path: "../../data/cards/cosplay-champions.json", data: cosplayChampions },
  { path: "../../data/cards/digital-demons.json", data: digitalDemons },
  { path: "../../data/cards/gothic-royalty.json", data: gothicRoyalty },
  { path: "../../data/cards/meme-collective.json", data: memeCollective },
  { path: "../../data/cards/neon-idols.json", data: neonIdols },
  { path: "../../data/cards/neutral.json", data: neutral },
  { path: "../../data/cards/tokens.json", data: tokens },
  { path: "../../data/cards/touch-grass-order.json", data: touchGrassOrder },
  { path: "../../data/cards/tutorial.json", data: tutorialCards },
  { path: "../../data/cards/viral-influencers.json", data: viralInfluencers },
];

/** Every encounter file under `data/encounters/` (puzzles, tutorial stages, scripted fights). */
export const ENCOUNTER_FILES: readonly DataFile[] = [
  { path: "../../data/encounters/puzzles.json", data: puzzleEncounters },
  { path: "../../data/encounters/tutorial.json", data: tutorialEncounters },
];
