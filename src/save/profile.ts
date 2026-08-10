/**
 * Player profile, collection, decks and progression.
 *
 * Offline-first: everything lives in a versioned local store shaped so it can
 * be lifted to a cloud save later without changing callers.
 */

import type { CardDef, ContentIndex, DeckList, FactionId, MatchRecord, Seat } from "../engine/types";
import { createStore } from "./storage";
import { getContent } from "../engine/content";
import { autoBuildDeck, validateDeck } from "../engine/deck";
import { starterDeckFor, tutorialConfig } from "../game/progression/data";
import { seedRng, type RngState } from "../engine/rng";
import { openDrop, playableCap, type DropResult } from "../game/economy/drops";
import { aiDailyCap, matchClout } from "../game/economy/income";
import {
  canChooseLegendary,
  GRAND_TOUR_REWARD_KEY,
  legendaryChoices,
  legendaryFallbackSignal,
  tourProgress,
  type TourView,
} from "../game/progression/grandTour";
import {
  affinityConfig,
  checkInConfig,
  factionMasteryConfig,
  leaderMasteryConfig,
  type CheckInStep,
} from "../game/progression/data";
import {
  affinityBoard,
  affinityView,
  canPick,
  claimKey,
  factionTracks,
  isGrantable,
  leaderTracks,
  matchXp,
  pickCandidates,
  rankFor,
  rewardsAt,
  type AffinityView,
  type MasteryReward,
  type MasteryTrack,
  type MasteryView,
} from "../game/progression/mastery";
import type { LoreKind } from "../game/progression/masteryLore";
import {
  cosmeticById,
  equipped as equippedCosmetic,
  ownedCosmetics,
  unlockedEmotes,
  WEARABLE_KINDS,
  type Cosmetic,
  type CosmeticKind,
} from "../game/cosmetics";
import {
  achievementKey,
  achievementViews,
  creditMatch,
  emptyTally,
  milestoneKey,
  milestoneViews,
  pointsFrom,
  reachablePoints,
  unclaimedCount,
  isGrantable as achievementRewardGrantable,
  type AccountFacts,
  type AchievementReward,
  type AchievementTally,
  type AchievementView,
  type MilestoneView,
} from "../game/achievements";
import {
  canPassPick,
  creditFor,
  emptyPass,
  hypeWaveData,
  isGrantable as passRewardGrantable,
  passComplete,
  passPickCandidates,
  passView,
  refFor,
  rewardsAt as passRewardsAt,
  seasonAt,
  tierFor,
  welcomeBackDue,
  xpForTier,
  type PassReward,
  type PassState,
  type PassTrack,
  type PassView,
} from "../game/progression/hypeWave";
import {
  bannerById,
  bannerData,
  bannerView,
  emptyBannerState,
  liveBanners,
  resolvePulls,
  tokenPrice,
  type BannerState,
  type BannerView,
  type PullResult,
} from "../game/economy/banner";
import {
  allEvents,
  applyConversion as applyEventConversion,
  buyShopEntry as buyEventEntry,
  claimMission as claimEventMissionPure,
  completionEarned as eventCompletionEarned,
  creditMatch as creditMatchToEvent,
  eventById,
  eventPhase,
  eventView,
  liveEvents,
  pendingConversion as pendingEventConversion,
  stateFor as eventStateFor,
  type EventConversion,
  type EventDef,
  type EventState,
  type EventView,
} from "../game/events";
import {
  dailyBonusProgress,
  dailyDoomscrollReward,
  dailyDoomscrollSeed,
  dailyPuzzleIndex,
  dailyPuzzleReward,
  dayNumber,
  type DailyBonusProgress,
  type DailyBonusReward,
} from "../game/dailies";
import { remixData, remixQuest, type RemixQuest } from "../game/remix";
/**
 * Aliased, and the alias is load-bearing.
 *
 * This file already imports a `weekIndex` from the missions rotation, and the
 * two are **different weeks**: missions align to Monday, the Weekly Boss and the
 * Remix rotation align to the epoch. The Remix quest has to count wins in the
 * same week the rotation deals a rule in, or a win could land in a week whose
 * rule was a different one — so it borrows the rotation's clock, not the
 * missions' one.
 */
import { weekIndex as remixWeekIndex } from "../game/weeklyBoss";
import { bannerCardBackId, checkInCosmeticForMonth } from "../game/cosmetics";
import { buildMail, type MailGrantRecord, type MailInput, type MailMessage } from "../game/inbox";
import { newsArticles, releases, unseenVersions, type NewsArticle } from "../game/news";
import { doomscrollStore } from "./doomscrollSave";
import {
  canReroll,
  dailyPool,
  dayIndex,
  emptyRotation,
  evidenceHorizon,
  issueDue,
  readMatch,
  removeMission,
  reroll as rerollMission,
  viewMission,
  weeklyPool,
  weekIndex,
  weekStart,
  type ActiveMission,
  type MatchOutcome,
  type MatchReading,
  type MissionCadence,
  type MissionView,
  type RotationState,
} from "../game/missions";

/**
 * The handful of numbers the statistics dashboard needs, stamped per match.
 *
 * Deliberately *not* the whole `MatchStats`. The dashboard asks about six things
 * and a history of sixty full readings would be several times the size of the
 * rest of the profile for statistics nobody displays.
 *
 * Nothing derivable is stored. The faction, the Currents and the win are all
 * already answerable from `leaderCardId` and `result`, and a second copy of them
 * would be a second thing to disagree with the first.
 *
 * Absent on matches recorded before this shipped, which is why the dashboard
 * reports its own sample size rather than quietly averaging over fewer matches
 * than the header claims.
 */
export interface MatchSummary {
  cardsPlayed: number;
  charactersDefeated: number;
  damageToEnemyLeader: number;
  confluencesActivated: number;
  perfectResonances: number;
  peakObsession: number;
}

export interface MatchHistoryEntry {
  id: string;
  playedAt: number;
  deckName: string;
  leaderCardId: string;
  opponentLeaderCardId: string;
  result: "win" | "loss" | "draw";
  turns: number;
  mode: string;
  /** what the deriver read out of this match, for the statistics dashboard */
  summary?: MatchSummary;
  /**
   * The full replayable record, for the most recent matches only.
   *
   * A record is {config, intents[]} — small, but not free, and a 60-match
   * history of them would grow localStorage without bound. Only the newest few
   * keep theirs; older entries stay in the list as results you can read but no
   * longer watch. Absent means "not replayable", which the UI shows honestly.
   */
  record?: MatchRecord;
}

/** How many recent matches keep their full replay record. */
export const REPLAYABLE_HISTORY = 8;

export interface PlayerProfile {
  displayName: string;
  accountLevel: number;
  accountXp: number;
  /** soft currency earned by playing */
  clout: number;
  /** crafting material from dismantling duplicates */
  shards: number;
  /**
   * Glimmer — the premium currency (§1), earned and never bought.
   *
   * This build takes no payments, so the only source is the Hype Wave itself:
   * 400 on the free track per season, 500 more if you hold a Backstage Pass.
   * That makes the 1,000-Glimmer pass something a free player earns their way
   * into over about two and a half seasons, which is close to §10.2's stated
   * intent of "a Backstage Pass roughly every other season without spending".
   *
   * Added after this object shipped, so it arrives `undefined` on an existing
   * save: read it with `?? 0`.
   */
  glimmer?: number;
  /** cards owned, by card id → count */
  collection: Record<string, number>;
  decks: DeckList[];
  activeDeckIndex: number;
  favorites: string[];
  locked: string[];
  history: MatchHistoryEntry[];
  stats: {
    matchesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    /**
     * Legendaries crafted, for §9's *Whale-Free Since Day One*.
     *
     * A lifetime count rather than a flag, because the achievement asks for the
     * first one and a later one may ask for more, and the collection cannot
     * answer either question — a crafted Legendary and one opened in a Drop are
     * the same card once they land.
     *
     * Added after this object shipped, so it arrives `undefined` on an existing
     * save: read it with `?? 0`.
     */
    legendariesCrafted?: number;
  };
  onboardingComplete: boolean;
  /**
   * Tutorial stage ids whose reward has already been paid.
   *
   * Stages are replayable by design, so this has to be a set of what has been
   * granted rather than a counter — otherwise replaying stage 1 six times pays
   * six times, which would make the tutorial the most efficient Clout farm in
   * the game.
   */
  tutorialStagesRewarded: string[];
  /**
   * Keys of one-off rewards already paid (boss first clears, and anything else
   * that must never pay twice). Shares the tutorial's "record what was granted"
   * shape rather than counting, for the same reason: repeats are expected.
   */
  claimedRewards: string[];
  /**
   * The faction whose starter deck this account began with, and every faction
   * whose starter deck it has unlocked since. Null means the account has not
   * chosen yet — see `needsStarterChoice`.
   */
  starterFaction: FactionId | null;
  unlockedFactions: FactionId[];
  /** Drops owed but not yet opened, from starter grants and rewards. */
  pendingDrops: number;
  /**
   * Merch Drops.
   *
   * The PRNG state is stored rather than re-derived, because the number of draws
   * a Drop makes depends on the collection it was opened against — so "seed plus
   * a count of Drops" is not enough to replay one. Keeping the live state means
   * the next Drop is exactly the one the account was always going to get, and
   * the log below can be checked against a re-run rather than merely believed.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object will not be back-filled on an existing save. Read it defensively
   * or bump the store version.
   */
  drops: {
    seed: number;
    rng: [number, number, number, number] | null;
    opened: number;
    /** Drops opened since the last Legendary — the pity counter shown in the shop */
    sinceLegendary: number;
    /** newest first, bounded; the account's opening history */
    log: DropLogEntry[];
  };
  /**
   * Missions — what is held, what has been claimed, and the evidence.
   *
   * `outcomes` is the load-bearing part: mission progress is **recomputed from
   * finished matches** rather than incremented into per-mission counters, so a
   * rerolled or newly issued mission scores against the same evidence every
   * other one sees. It is pruned to what the oldest held mission still needs.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  missions: {
    seed: number;
    rng: [number, number, number, number] | null;
    rotation: RotationState;
    outcomes: MatchOutcome[];
    /** the mission-day the first-win bonus was last paid for */
    firstWinDay: number;
    /** the mission-week the Weekly Restock was last claimed for */
    restockWeek: number;
    /** week indexes whose Weekly Wrap has been paid */
    wrappedWeeks: number[];
    /** lifetime totals, for the screen */
    dailiesCompleted: number;
    weekliesCompleted: number;
  };
  /**
   * Mastery — §4 Faction, §5 Leader, §6 the Bias Board.
   *
   * **An accumulator, unlike missions.** Mission progress is recomputed from a
   * bounded log of finished matches, so a claim can be re-derived and audited.
   * Mastery is lifetime and that log is pruned, so there is nothing to
   * re-derive from: these numbers are the record. The cost of that is that
   * `recordMatch` has to credit them correctly the first time, which is why it
   * does so outside the `try` that guards the mission statistics.
   *
   * `claimed` holds `claimKey()` strings and is deliberately **not** the
   * `claimedRewards` ledger, which trims itself at 400 entries — a Faction
   * Mastery rank that aged out of a trimmed ledger would become claimable
   * again, which is the exact bug the Grand Tour reward hit.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  mastery: {
    /** XP by faction id */
    faction: Record<string, number>;
    /** XP by leader card id */
    leader: Record<string, number>;
    /** Affinity Points by character card id */
    affinity: Record<string, number>;
    claimed: string[];
  };
  /**
   * Cosmetics — what has been earned, and what is being worn.
   *
   * Owning and wearing are separate on purpose: a reward is never lost by
   * equipping something else, and `owned` doubles as the ledger proving a rank
   * paid out. `equipped` holds at most one id per slot and is read defensively —
   * an id naming a cosmetic a later build removed falls back to the default
   * rather than rendering nothing.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  cosmetics: {
    owned: string[];
    equipped: Partial<Record<CosmeticKind, string | null>>;
  };
  /**
   * Achievements — §9.
   *
   * An accumulator, for the same reason Mastery is one and missions are not:
   * "complete 500 matches" and "activate all 9 Confluences" both reach further
   * back than the 200-match evidence log goes. `tally` is credited once per
   * finished match and is the only record of it.
   *
   * `claimed` holds `achievementKey`/`milestoneKey` strings and is deliberately
   * separate from `claimedRewards`, which trims itself at 400 entries. An
   * achievement is permanent, so a key that aged out of a trimmed ledger would
   * make it claimable again — the exact bug the Grand Tour reward hit.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  achievements: {
    tally: AchievementTally;
    claimed: string[];
  };
  /**
   * Headliner Banners — `07-economy-and-monetization.md` §4.
   *
   * Per-banner state (pulls, both pity counters, the Target Card, the wishlist
   * and the two first-time rewards) plus the account-wide Backstage Tokens and
   * the pull history. Everything here persists across a banner's reruns, because
   * §4.5 says the Encore Meter, wishlist and history do — a rerun is the same
   * banner, not a new one.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  /**
   * Stream Check-In — §11. The month it belongs to, how many steps have been
   * claimed in it, and the last calendar day one was taken. Deliberately not a
   * streak: `lastDay` exists only to stop two claims on one day.
   *
   * NOTE: the save store merges defaults shallowly, so read it defensively.
   */
  checkIn: { month: string; claimed: number; lastDay: string };
  /** daily-mission reroll tokens (§11 step 4), spent past the free reroll */
  rerollTokens?: number;
  /**
   * The Inbox — §4.5.3.
   *
   * **No messages live here**, only what was done to them. Mail is derived from
   * facts the save already holds (see `src/game/inbox/`), so this is three sets
   * of ids and nothing else.
   *
   * `grants` is the one exception, and it is still not a message: it is the
   * record of an operator having decided to send one, written from outside the
   * game by `scripts/grant.mjs` and read here so the inbox can derive the mail
   * from it. Absent on every account nobody has sent anything to, which is
   * nearly all of them.
   *
   * `claimed` is a permanent ledger and is never trimmed, for the reason
   * `mastery.claimed` and `achievements.claimed` are not: an id that aged out
   * would make an attachment claimable a second time. `read` and `deleted` are
   * pruned on every write to the ids mail still generates, which bounds them
   * exactly rather than by an arbitrary limit — and cannot resurrect a deleted
   * message, because an id is only dropped once no message has it.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  inbox: { read: string[]; claimed: string[]; deleted: string[]; grants?: MailGrantRecord[] };
  /**
   * News and patch notes — §4.2.2 and §4.2.3.
   *
   * Articles that have been opened, and release versions whose notes have been
   * read. Both are ids into shipped data rather than content, so the same
   * "derived, never stored" rule the inbox follows holds here: an article this
   * build no longer carries simply stops being listed, and its id is pruned.
   *
   * `seenVersions` is what §4.2.3's *"changed since you last played"* band reads.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  news: { read: string[]; seenVersions: string[] };
  /**
   * The daily cap on Clout earned from playing the AI — 09 §3's
   * `missions.aiDailyCap`.
   *
   * Account-wide and shared, because the design makes it shared: Sparring and
   * Quick Match name the same cap, and §8.4 puts Gauntlet Practice inside it.
   * One ledger, so a second consumer is a read rather than a second counter that
   * has to be kept in step.
   *
   * **Only the Gauntlet spends against it today.** Per-match Clout from
   * `recordMatch` has never been capped in any mode and still is not; capping it
   * would change what every existing mode pays, which is a decision of its own
   * and not a side effect of shipping a draft.
   *
   * Added after this object shipped, so it arrives `undefined` on an existing
   * save: read it defensively.
   */
  aiClout?: { day: string; spent: number };
  banners: {
    state: Record<string, BannerState>;
    /** account-wide, never expires (§4.4) */
    tokens: number;
    /** newest first, bounded; §4.1 requires it be exportable */
    log: PullLogEntry[];
    /** the PRNG the pulls roll from, stored so a history can be re-derived */
    seed: number;
    rng: [number, number, number, number] | null;
  };
  /**
   * Limited-time events — 09 §14.
   *
   * Keyed by event id and kept **across runs**, which is the whole mechanism
   * behind 07 §8.4's *"rerun events restore the player's previous event shop
   * progress and stock"*. There is nothing here about which run is on or when
   * it ends: that is `data/events.json` plus the clock, and storing it would be
   * a second copy of the calendar waiting to disagree with the first.
   */
  events: {
    state: Record<string, EventState>;
  };
  /**
   * The Remix Queue's weekly quest — 09 §12.
   *
   * Three numbers, because that is all that cannot be derived: which week the
   * wins belong to, how many there are, and which week was last paid. The
   * modifier itself is derived from the clock and `data/events.json`, so nothing
   * here records *which* rule was in force — that would be a second copy of the
   * rotation, free to disagree with the first.
   */
  remix: {
    week: number;
    wins: number;
    claimedWeek: number;
  };
  /**
   * The two bonus daily slots — 09 §11.
   *
   * Three numbers, and every one of them is something a clock cannot recompute:
   * which day each slot was last filled, and how many of the every-seven packs
   * have actually been handed over. *Which* puzzle and *which* run today's are
   * is derived from the date, so nothing here records them.
   */
  dailies: {
    puzzleDay: number;
    doomscrollDay: number;
    packsPaid: number;
  };
  /**
   * The Hype Wave — §10.
   *
   * `pass` is the live season's, or null between seasons. `archives` holds the
   * unfinished passes of seasons that have ended, each still earning at half
   * rate: §10.6 makes "the pass itself never expires" binding, and a single
   * archive slot would silently drop somebody's second missed season.
   *
   * NOTE: the save store merges defaults shallowly, so a field added *inside*
   * this object is not back-filled on an existing save. Read it defensively.
   */
  hypeWave: {
    pass: PassState | null;
    archives: PassState[];
    /** when this account was last seen, for §10.5.4's Welcome Back package */
    lastSeenAt: number;
    /** Wave Rebound is forced on until this moment, regardless of pace */
    forcedReboundUntil: number;
    /** when Welcome Back last paid, so returning twice in a fortnight pays once */
    welcomeBackAt: number;
  };
  createdAt: number;
}

export interface DropLogEntry {
  openedAt: number;
  cards: { cardId: string; rarity: string; isNew: boolean; convertedToSignal?: number }[];
  signal: number;
}

/** How many openings the account remembers. */
export const DROP_LOG_LIMIT = 50;

export interface PullLogEntry {
  pulledAt: number;
  bannerId: string;
  /** 1 or 10 */
  count: number;
  cards: {
    cardId: string;
    rarity: string;
    isNew: boolean;
    featured: boolean;
    wishlisted: boolean;
    path: string;
    convertedToSignal?: number;
  }[];
  signal: number;
  tokens: number;
}

/**
 * How many pulls the account remembers.
 *
 * §4.1 asks for "every pull ever made on this banner (and account-wide)", and
 * "ever" is not a thing a browser save can honestly promise — a hundred ×10
 * pulls is a thousand card entries. This is bounded and the page says so, which
 * is the same bargain the Drop log already makes.
 */
export const PULL_LOG_LIMIT = 120;

function defaults(): PlayerProfile {
  return {
    displayName: "New Creator",
    accountLevel: 1,
    accountXp: 0,
    clout: 500,
    shards: 300,
    collection: {},
    decks: [],
    activeDeckIndex: 0,
    favorites: [],
    locked: [],
    history: [],
    stats: { matchesPlayed: 0, wins: 0, losses: 0, draws: 0, legendariesCrafted: 0 },
    onboardingComplete: false,
    tutorialStagesRewarded: [],
    claimedRewards: [],
    starterFaction: null,
    unlockedFactions: [],
    pendingDrops: 0,
    drops: { seed: 0, rng: null, opened: 0, sinceLegendary: 0, log: [] },
    missions: {
      seed: 0,
      rng: null,
      rotation: emptyRotation(),
      outcomes: [],
      firstWinDay: -1,
      restockWeek: -1,
      wrappedWeeks: [],
      dailiesCompleted: 0,
      weekliesCompleted: 0,
    },
    mastery: { faction: {}, leader: {}, affinity: {}, claimed: [] },
    cosmetics: { owned: [], equipped: {} },
    achievements: { tally: emptyTally(), claimed: [] },
    glimmer: 0,
    hypeWave: { pass: null, archives: [], lastSeenAt: 0, forcedReboundUntil: 0, welcomeBackAt: 0 },
    checkIn: { month: "", claimed: 0, lastDay: "" },
    rerollTokens: 0,
    inbox: { read: [], claimed: [], deleted: [] },
    news: { read: [], seenVersions: [] },
    aiClout: { day: "", spent: 0 },
    banners: { state: {}, tokens: 0, log: [], seed: 0, rng: null },
    events: { state: {} },
    remix: { week: -1, wins: 0, claimedWeek: -1 },
    dailies: { puzzleDay: -1, doomscrollDay: -1, packsPaid: 0 },
    /**
     * Stamped at account creation, because the Rookie Road window (§8.1) is
     * measured from it. `defaults()` runs on every load but saved values win, so
     * this only takes effect for a profile that does not exist yet — which is
     * exactly what "account creation" means. It used to be left at 0 until the
     * starter deck was granted, which read as "not a new account" and quietly
     * paid new players the *lower* daily rate.
     */
    createdAt: Date.now(),
  };
}

/**
 * The profile store's schema version.
 *
 * Exported because §4.5.3's *version-migration grants* are the one inbox sender
 * this build cannot have: nothing has ever migrated, because there has only ever
 * been one version. `tests/inbox.test.ts` asserts this is still 1, so the day the
 * schema moves, the test fails and says to go and build the sender — the same
 * staleness guard `DEFERRED_COSMETICS` and `DEFERRED_PASS` carry.
 */
export const PROFILE_VERSION = 1;

/**
 * One entry per version bump: `steps[n]` upgrades a payload written at version
 * `n` into the shape version `n + 1` expects.
 *
 * Empty, because nothing has ever migrated. That is exactly why it exists.
 * `storage.ts` falls back to `defaults()` when a store has no `migrate` and the
 * version does not match — so the day somebody bumped `PROFILE_VERSION`, every
 * existing account would have lost its collection, its decks, its Mastery and
 * its cosmetics, silently, on the next load. The bug would have been in a line
 * of code nobody touched, triggered by a line of code somebody did.
 *
 * A step only has to do the part that *changes shape*. Fields added to an
 * object are back-filled from the defaults at every depth by `fillDefaults`, so
 * an additive change needs no step at all — a step is for renames, splits,
 * unit changes and anything where the old value means something different.
 */
const PROFILE_MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Carry an older save forward, one version at a time.
 *
 * The rule is that **a recognisable save is never discarded**. An unknown step
 * is a no-op rather than a reset: the fields it does not understand are still
 * the player's, `fillDefaults` supplies anything new, and every reader in this
 * file already tolerates a missing field. Throwing the account away because the
 * schema moved is the one outcome that is worse than a slightly stale profile.
 *
 * A payload from a *newer* build takes the same path. A downgrade cannot be
 * migrated in any honest sense, and keeping the data is still better than
 * deleting it — the reader either understands a field or does not.
 */
export function migrateProfile(data: unknown, fromVersion: number): PlayerProfile {
  let carried = (typeof data === "object" && data !== null ? { ...(data as Record<string, unknown>) } : {}) as Record<
    string,
    unknown
  >;
  for (let version = fromVersion; version < PROFILE_VERSION; version++) {
    const step = PROFILE_MIGRATIONS[version];
    if (step) carried = step(carried);
  }
  return carried as unknown as PlayerProfile;
}

export const profileStore = createStore<PlayerProfile>({
  key: "profile",
  version: PROFILE_VERSION,
  defaults,
  migrate: migrateProfile,
});

export const getProfile = (): PlayerProfile => profileStore.get();

// ---------------------------------------------------------------------------
// The display name
// ---------------------------------------------------------------------------

/**
 * The one field of this profile a player is expected to author, and until now
 * the only one nothing could write.
 *
 * `defaults()` above stamps `"New Creator"` and, before this block existed, that
 * string had exactly one other appearance in the whole source tree: the lobby
 * and the profile header rendering it. No screen, no hook, no debug path ever
 * assigned `displayName`. So the owner's report is literally true — the name was
 * unreachable, not merely awkward.
 *
 * **Where it lives is already right, and that is worth stating rather than
 * changing.** `displayName` is a field of `PlayerProfile`, `profileStore` is the
 * `profile` section of `save/cloudSaves.ts`, and that section is uploaded and
 * downloaded whole under the checksum-verified, `If-Match`-guarded round trip in
 * `net/saveClient.ts`. A name written here therefore rides the account's save by
 * construction. Giving it its own field, its own endpoint or its own "which
 * account owns this name" record would be a second copy of a fact the save
 * already holds, free to disagree with the first — the same mistake this file
 * refuses in half a dozen other places (see the notes on `remix`, `dailies` and
 * `events`, none of which store what the clock can answer).
 *
 * What the validator is *for* is worth naming too, because a length limit looks
 * arbitrary until you say which failure it prevents:
 *
 * - **A name is rendered into a leaderboard row, a match header and a chip.**
 *   Twenty-four is what `.profile-name`'s `clamp(1.7rem, 3.4vw, 2.4rem)` fits on
 *   a 390px viewport without wrapping into the level meter under it.
 * - **Invisible characters are not typos, they are a spoof.** A right-to-left
 *   override makes the string that is stored and the string that is drawn two
 *   different things, and a zero-width space lets two accounts hold what looks
 *   like one name. They are stripped rather than refused, because refusing a
 *   character the player cannot see is an error message about nothing — and the
 *   screen says out loud when the stripping changed anything.
 * - **Something has to be readable.** A name of pure punctuation is a row on the
 *   leaderboard nobody can refer to out loud.
 */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 24;

/** What `defaults()` starts every account with, exported so a screen can tell. */
export const DEFAULT_DISPLAY_NAME = "New Creator";

/**
 * Characters that occupy no width, and the reason each group is here.
 *
 * C0 and C1 controls, DEL, the soft hyphen, the zero-width space and non-joiner,
 * the two directional marks, the four bidi embed/override codes, the word joiner
 * and invisible operators, the four bidi isolates, and the byte-order mark.
 *
 * **U+200D, the zero-width joiner, is deliberately absent.** It is the glue in
 * every multi-person and multi-skin-tone emoji — stripping it does not tidy a
 * name up, it silently detonates 👩‍🚀 into two unrelated pictures. That is a
 * corruption rather than a cleanup, and the spoofing argument that justifies the
 * rest does not reach a character whose ordinary use is this common.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

/**
 * Whitespace runs collapse to one space, invisibles go, and the ends are
 * trimmed. Deliberately **not** a rejection: every transformation here is one
 * the player cannot see and therefore cannot be asked to fix.
 */
export function normaliseDisplayName(raw: string): string {
  return raw.replace(INVISIBLE_CHARS, "").replace(/\s+/gu, " ").trim();
}

/**
 * Length in **code points**, not UTF-16 units.
 *
 * `"🎧".length` is 2, so a `.length` limit spends half a player's allowance on
 * one emoji and — worse — a truncation at an odd offset splits a surrogate pair
 * and stores half a character. The input's `maxlength` is set to twice this
 * ceiling for the same reason: a code point is at most two UTF-16 units, so the
 * browser's own cap can never fire *before* the validator has had a chance to
 * say what is wrong. A silent truncation is the one refusal that explains
 * nothing.
 */
export const displayNameLength = (name: string): number => [...name].length;

export interface NameVerdict {
  readonly ok: boolean;
  /** The name as it would actually be stored. */
  readonly name: string;
  /** Why not, in a sentence a player can act on. Empty when `ok`. */
  readonly reason: string;
  /** True when normalisation removed or folded something the player typed. */
  readonly cleaned: boolean;
}

/** Pure, so the screen can call it on every keystroke and a test can enumerate it. */
export function checkDisplayName(raw: string): NameVerdict {
  const name = normaliseDisplayName(raw);
  const cleaned = name !== raw;
  const length = displayNameLength(name);

  if (length === 0) {
    return { ok: false, name, reason: "Type a name — this cannot be left empty.", cleaned };
  }
  if (length < DISPLAY_NAME_MIN) {
    return {
      ok: false,
      name,
      reason: `That is ${length} character. A name needs at least ${DISPLAY_NAME_MIN}.`,
      cleaned,
    };
  }
  if (length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      name,
      reason: `That is ${length} characters. Names go up to ${DISPLAY_NAME_MAX} — trim ${length - DISPLAY_NAME_MAX}.`,
      cleaned,
    };
  }
  if (!/[\p{L}\p{N}]/u.test(name)) {
    return { ok: false, name, reason: "A name needs at least one letter or number in it.", cleaned };
  }
  return { ok: true, name, reason: "", cleaned };
}

/**
 * Write the name, or say why not.
 *
 * `flush()` rather than leaving it to the store's 250ms debounce, because this
 * is the one write a player makes and then immediately closes the tab to go and
 * check on their phone. Losing it to a debounce would look exactly like the
 * cross-device sync failing, and would be neither.
 *
 * Nothing here talks to the network. The upload is `cloudSaves.ts`'s subscriber
 * on this very store, which is why the name needs no transport of its own.
 */
export function setDisplayName(raw: string): NameVerdict {
  const verdict = checkDisplayName(raw);
  if (!verdict.ok) return verdict;
  if (getProfile().displayName !== verdict.name) {
    profileStore.update((draft) => {
      draft.displayName = verdict.name;
    });
    profileStore.flush();
  }
  return verdict;
}

/**
 * Does this account still need to choose a starting faction?
 *
 * True only for a genuinely new account. An existing save — anyone who played
 * before starter decks existed — has a collection already and is left exactly
 * as it was; nobody's cards are taken away to fit a newer model.
 */
export function needsStarterChoice(): boolean {
  const profile = getProfile();
  return profile.starterFaction === null && Object.keys(profile.collection).length === 0;
}

export interface StarterGrant {
  factionId: FactionId;
  deckName: string;
  /** card copies actually added to the collection */
  cardsAdded: number;
  /** copies that would have gone over the playable cap, converted instead */
  convertedToSignal: number;
  /** free Drops that came with it — only ever on the account's first deck */
  drops: number;
  /** true when this deck was also made the active one */
  madeActive: boolean;
  /**
   * false when every deck slot was already full, so the cards and the faction
   * were granted but the ready-made list could not be
   */
  deckSaved: boolean;
}

/**
 * Grant a faction's starter deck: its cards, its Leader, the deck itself, and —
 * on the account's **first** deck only — the Drops that come with it (§3.4).
 *
 * This is the one act behind both ways a starter deck is earned: chosen on the
 * first screen, or won on the Grand Tour. Deliberately one function, because two
 * would eventually disagree about what a starter grant is, and the tour's whole
 * promise is that you are handed *the deck you just played*.
 *
 * Returns null when there is nothing to grant — no such list, or this faction is
 * already unlocked. Granting twice would push a second copy of thirty cards and
 * a duplicate deck into the profile, and the route is reachable by hand.
 *
 * Three rules are worth reading off the code rather than inferring:
 *
 * - **Never above the playable cap.** A copy that would take the account past
 *   2 (1 for a Legendary) converts to Signal at the published duplicate rate
 *   instead, exactly as a Drop's does. Without this, a player who opened Drops
 *   before winning their next faction would end up owning three copies of a
 *   Common — an amount the deck builder will not let them play and the
 *   collection screen cannot honestly draw.
 * - **The Drops come once.** §3.4 attaches them to the first deck, not to each.
 * - **It only becomes the active deck if it is the only deck.** Switching what
 *   somebody is playing with because they won a match with something else is
 *   not a reward.
 */
export function grantStarterDeck(content: ContentIndex, factionId: FactionId): StarterGrant | null {
  const starter = starterDeckFor(factionId);
  if (!starter) return null;
  if (getProfile().unlockedFactions.includes(factionId)) return null;

  const { dustValue, dupeConversionBonus } = content.balance.economy;
  let cardsAdded = 0;
  let convertedToSignal = 0;
  let drops = 0;
  let madeActive = false;
  let deckSaved = false;

  profileStore.update((draft) => {
    const first = draft.decks.length === 0 && draft.starterFaction === null;

    for (const cardId of starter.cards) {
      const card = content.cards[cardId];
      if (!card) continue;
      const held = draft.collection[cardId] ?? 0;
      if (held >= playableCap(content, card)) {
        convertedToSignal += Math.round((dustValue[card.rarity] ?? 0) * dupeConversionBonus);
      } else {
        draft.collection[cardId] = held + 1;
        cardsAdded += 1;
      }
    }
    draft.shards += convertedToSignal;

    /**
     * The deck slot, **if there is one**.
     *
     * `saveDeck` has honoured `balance.deck.slots` since the slot list shipped;
     * this path did not, and it is the one path that writes a deck the player
     * never asked for. An account with twelve decks that then won four more
     * factions on the Grand Tour ended up holding sixteen, of which `#decks`
     * renders twelve — the other four saved, counted nowhere, and unreachable by
     * any screen in the game.
     *
     * When the slots are full the grant still happens: the cards go in, the
     * faction unlocks, the Drops pay. Only the ready-made list is skipped, and
     * `deckSaved` says so out loud so the screen can tell the player to free a
     * slot rather than leaving them to notice a deck that never arrived.
     */
    if (draft.decks.length < content.balance.deck.slots) {
      const deck: DeckList = { name: starter.name, leaderCardId: starter.leaderCardId, cards: [...starter.cards] };
      draft.decks.push(deck);
      deckSaved = true;
      if (draft.decks.length === 1) {
        draft.activeDeckIndex = 0;
        madeActive = true;
      }
    }

    draft.unlockedFactions.push(factionId);
    draft.starterFaction ??= factionId;
    if (first) {
      drops = STARTER_DROPS;
      draft.pendingDrops += STARTER_DROPS;
    }
    draft.createdAt = draft.createdAt || Date.now();
  });

  return { factionId, deckName: starter.name, cardsAdded, convertedToSignal, drops, madeActive, deckSaved };
}

/** Free Drops that come with the first starter deck (economy doc §3.4). */
export const STARTER_DROPS = 5;

// ---------------------------------------------------------------------------
// The Grand Tour
// ---------------------------------------------------------------------------

/** The account as the tour reads it — see `game/progression/grandTour.ts`. */
export function tourView(): TourView {
  const profile = getProfile();
  return {
    unlockedFactions: profile.unlockedFactions,
    starterFaction: profile.starterFaction,
    owned: profile.collection,
    rewardClaimed: profile.claimedRewards.includes(GRAND_TOUR_REWARD_KEY),
  };
}

/**
 * A won loaner match: unlock that faction's starter deck, permanently.
 *
 * Thin on purpose — the grant is `grantStarterDeck`, unchanged, because §3.4
 * says the tour pays *"that faction's starter deck"* and any second definition
 * of what that means is a bug waiting to be written. What this adds is the name
 * at the call site, and the guarantee that a loss reaches nothing: the battle
 * route calls it only on a win.
 */
export function recordTourWin(content: ContentIndex, factionId: FactionId): StarterGrant | null {
  return grantStarterDeck(content, factionId);
}

export interface GrandTourReward {
  clout: number;
  drops: number;
  /** the Legendaries granted, in the order they were chosen */
  legendaryCardIds: string[];
  /** paid instead of a Legendary, when the account already owns every one */
  convertedToSignal: number;
}

/**
 * Pay the completion reward, once ever: 1,000 Clout, 10 Merch Drops and a
 * Legendary of the player's choice (§3.4).
 *
 * Returns null rather than paying a partial or wrong reward, on any of four
 * counts — the tour is not finished, it has already been paid, the wrong number
 * of Legendaries was chosen, or one of them is a card the account already holds
 * at the playable cap. That last one matters: a Legendary caps at one copy, so
 * "choosing" one you own would hand over a card you can never put in a deck, and
 * a reward the player cannot use is worse than an error message.
 *
 * The exception is an account that owns **every** Legendary in the game. There
 * is then nothing left to choose, and refusing would strand the Clout and the
 * Drops behind an impossible pick, so the choice pays out as Signal at the same
 * published duplicate rate a Drop uses. Pass an empty list to take it.
 */
export function claimGrandTourReward(content: ContentIndex, legendaryCardIds: readonly string[]): GrandTourReward | null {
  const progress = tourProgress(content, tourView());
  if (!progress.rewardReady) return null;

  const owned = getProfile().collection;
  const wanted = progress.reward.legendaryChoices;
  const anyLeft = legendaryChoices(content, owned).some((choice) => !choice.owned);

  let convertedToSignal = 0;
  const chosen = [...legendaryCardIds];

  if (chosen.length === 0 && !anyLeft) {
    // every Legendary already held — the choice converts rather than stranding
    convertedToSignal = legendaryFallbackSignal(content) * wanted;
  } else {
    if (chosen.length !== wanted) return null;
    if (new Set(chosen).size !== chosen.length) return null;
    if (!chosen.every((cardId) => canChooseLegendary(content, owned, cardId))) return null;
  }

  profileStore.update((draft) => {
    draft.claimedRewards.push(GRAND_TOUR_REWARD_KEY);
    draft.clout += progress.reward.clout;
    draft.pendingDrops += progress.reward.drops;
    draft.shards += convertedToSignal;
    for (const cardId of chosen) draft.collection[cardId] = (draft.collection[cardId] ?? 0) + 1;
  });

  return {
    clout: progress.reward.clout,
    drops: progress.reward.drops,
    legendaryCardIds: chosen,
    convertedToSignal,
  };
}

/**
 * Pay a tutorial stage's reward, once ever.
 *
 * Returns what was granted, or null if this stage has already paid — the caller
 * uses that to decide whether to show a reward flourish, so a replay stays
 * silent rather than pretending to hand out Clout it did not.
 *
 * Per-stage Clout only. §2.3's card packs, card back and title are the
 * *completion* package and are paid by `grantTutorialCompletion` — which used to
 * be a paragraph here explaining why they could not be paid at all, because
 * there were no screens for any of them. Both blockers are gone: Merch Drops
 * ship, and the cosmetics layer resolves a card back and a title onto a profile
 * somebody can actually look at.
 */
export function grantTutorialReward(stageId: string, clout: number): { clout: number } | null {
  const profile = getProfile();
  if (profile.tutorialStagesRewarded.includes(stageId)) return null;

  profileStore.update((draft) => {
    draft.tutorialStagesRewarded.push(stageId);
    draft.clout += clout;
  });
  return { clout };
}

/** Has the player finished the whole tutorial at least once? */
export function tutorialComplete(stageIds: readonly string[]): boolean {
  const rewarded = new Set(getProfile().tutorialStagesRewarded);
  return stageIds.length > 0 && stageIds.every((id) => rewarded.has(id));
}

/**
 * Grant every tutorial reward at once, for a player who skips it.
 *
 * Skipping is never punished — that is a binding rule in the economy doc — so
 * the skip path pays exactly what playing through pays.
 */
export function grantAllTutorialRewards(
  stageIds: readonly string[],
  cloutPerStage: number,
  content?: ContentIndex
): number {
  let granted = 0;
  for (const id of stageIds) {
    if (grantTutorialReward(id, cloutPerStage)) granted += cloutPerStage;
  }
  // the completion package too, or "skipping is never punished" would be a rule
  // that pays six sevenths of what playing through pays
  if (content) grantTutorialCompletion(content, stageIds);
  return granted;
}

/** The key recording that §2.3's completion package has been paid. */
export const TUTORIAL_COMPLETE_KEY = "tutorial:complete";

export interface TutorialCompletion {
  drops: number;
  cosmetics: string[];
}

/**
 * 09 §2.3's completion package: card packs, the "Day One" card back and the
 * title **Fresh Poster**. Once ever.
 *
 * Keyed into `claimedRewards` and listed as permanent, for the reason the Grand
 * Tour's reward had to be: the ledger trims at 400 entries, and a boss clear a
 * week would eventually push this key off the front and make the tutorial pay
 * its finale a second time.
 *
 * §2.3 also promises a choice of two starter decks. That is an onboarding
 * question with a picker of its own — the account already chooses one at
 * creation — so it is listed as deferred rather than silently granted, which
 * would hand somebody a faction they did not pick.
 */
export function grantTutorialCompletion(
  content: ContentIndex,
  stageIds: readonly string[]
): TutorialCompletion | null {
  if (!tutorialComplete(stageIds)) return null;
  if (getProfile().claimedRewards.includes(TUTORIAL_COMPLETE_KEY)) return null;

  const { completion } = tutorialConfig();
  // a cosmetic that no longer resolves is dropped rather than stored as a
  // dangling id — the same rule `ownedCosmetics` applies when reading them back
  const cosmetics = completion.cosmetics.filter((id) => cosmeticById(content, id));

  profileStore.update((draft) => {
    draft.claimedRewards.push(TUTORIAL_COMPLETE_KEY);
    draft.pendingDrops += completion.drops;
    for (const id of cosmetics) {
      if (!draft.cosmetics.owned.includes(id)) draft.cosmetics.owned.push(id);
    }
  });

  return { drops: completion.drops, cosmetics };
}

/**
 * Pay a one-off reward, once ever, under `key`.
 *
 * Returns the Clout granted, or null if this key has already paid. Boss fights
 * are repeatable and pay standard match rewards on repeat, so the first-clear
 * bonus has to be keyed by boss + difficulty + week rather than counted.
 */
/**
 * Keys recording something **permanent**, which the ledger's trim must not evict.
 *
 * The trim below is right for a boss first-clear: those keys are per boss, per
 * tier, per *week*, so they accumulate at about thirty a week and an old one
 * being forgotten costs nothing. It is wrong for a reward that may only ever be
 * paid once in the life of an account — and mixing the two in one ring buffer
 * meant the Grand Tour's 1,000 Clout, 10 Drops and choice Legendary would become
 * claimable again after roughly three months of ordinary play, when its key aged
 * off the front. Permanent keys are now kept regardless of age.
 */
const PERMANENT_REWARDS: ReadonlySet<string> = new Set([GRAND_TOUR_REWARD_KEY, TUTORIAL_COMPLETE_KEY]);

/** How many claim keys the ledger keeps beyond the permanent ones. */
export const CLAIM_LEDGER_LIMIT = 400;

export function claimOnce(key: string, clout: number): { clout: number } | null {
  const profile = getProfile();
  if (profile.claimedRewards.includes(key)) return null;
  profileStore.update((draft) => {
    draft.claimedRewards.push(key);
    draft.clout += clout;
    // keep the ledger from growing without bound across seasons, without ever
    // forgetting something that must never be paid twice
    if (draft.claimedRewards.length > CLAIM_LEDGER_LIMIT) {
      const permanent = draft.claimedRewards.filter((entry) => PERMANENT_REWARDS.has(entry));
      const seasonal = draft.claimedRewards.filter((entry) => !PERMANENT_REWARDS.has(entry));
      draft.claimedRewards = [...permanent, ...seasonal.slice(-(CLAIM_LEDGER_LIMIT - permanent.length))];
    }
  });
  return { clout };
}

export function hasClaimed(key: string): boolean {
  return getProfile().claimedRewards.includes(key);
}

export function ownedCount(cardId: string): number {
  return getProfile().collection[cardId] ?? 0;
}

export function activeDeck(): DeckList | null {
  const profile = getProfile();
  return profile.decks[profile.activeDeckIndex] ?? profile.decks[0] ?? null;
}

export function setActiveDeck(index: number): void {
  profileStore.update((draft) => {
    draft.activeDeckIndex = Math.max(0, Math.min(index, draft.decks.length - 1));
  });
}

/**
 * Save a deck into a slot, or append a new one.
 *
 * Returns the index written, or **−1 when every slot is full** (§4.3.2's twelve).
 * The cap lives here rather than in the screen because `decks` is an array
 * anything may append to, and a limit only the deck builder knows about is a
 * limit the next caller walks past.
 */
export function saveDeck(deck: DeckList, index?: number): number {
  const slots = getContent().balance.deck.slots;
  if (index === undefined && getProfile().decks.length >= slots) return -1;
  let savedIndex = index ?? -1;
  // stamped so the weekly "win with a deck you created or edited this week" can
  // be answered; without it that mission's filter would be a field nothing reads
  const stamped: DeckList = { ...deck, editedAt: Date.now() };
  profileStore.update((draft) => {
    if (index !== undefined && draft.decks[index]) {
      draft.decks[index] = stamped;
      savedIndex = index;
    } else {
      draft.decks.push(stamped);
      savedIndex = draft.decks.length - 1;
    }
  });
  return savedIndex;
}

/**
 * Delete a slot, and move the active pointer with the array.
 *
 * `activeDeckIndex` is an **index into a list that just shifted**. Clamping the
 * upper bound was the only adjustment, which is right when you delete the last
 * slot and wrong for every other case: deleting slot 0 while slot 2 was active
 * left the pointer at 2, which now names what used to be slot 3 — so deleting
 * one deck silently changed which deck you were playing, to a different one.
 *
 * It was unreachable in practice while nothing in the interface listed the
 * slots. §4.3.2's slot list makes deleting any slot two clicks away, which is
 * exactly the kind of latent bug a missing screen was hiding.
 */
export function deleteDeck(index: number): void {
  const content = getContent();
  profileStore.update((draft) => {
    if (index < 0 || index >= draft.decks.length) return;
    draft.decks.splice(index, 1);

    if (draft.activeDeckIndex > index) draft.activeDeckIndex -= 1;
    else if (draft.activeDeckIndex === index) {
      /**
       * Deleting the deck you were playing with has to choose a successor, and
       * slot 0 is not automatically a defensible one. The slot list refuses to
       * let you press "Play with this" on a deck that does not validate — so
       * quietly *making* such a deck active, on a screen that shows the active
       * marker, contradicts the button sitting next to it.
       *
       * The first legal deck, then, and slot 0 only when nothing validates. A
       * half-built list is still better than a dangling pointer, and the play
       * path checks again anyway (`playableDeck`).
       */
      const firstLegal = draft.decks.findIndex((deck) => validateDeck(content, deck).length === 0);
      draft.activeDeckIndex = firstLegal >= 0 ? firstLegal : 0;
    }
    draft.activeDeckIndex = Math.max(0, Math.min(draft.activeDeckIndex, draft.decks.length - 1));
  });
}

/**
 * The deck a match should actually start with.
 *
 * `activeDeck() ?? autoBuildDeck(...)` was the idiom at every route into a
 * battle, and it guards the wrong failure: it catches *no deck at all* and waves
 * through an **illegal** one. A twenty-two card list, or one whose cards were
 * dismantled, went to Quick Match unchallenged — while the screen the player
 * chose it on had greyed out the button for saying so.
 *
 * So the fallback ladder is stated once, here: the active deck if it validates,
 * else the first saved deck that does, else a built one. `validateDeck` is the
 * engine's answer, as everywhere else; ownership is deliberately not consulted,
 * because loaner, story and Gauntlet decks legitimately contain cards the
 * account does not own.
 */
export function playableDeck(content: ContentIndex, fallbackLeaderId: string): DeckList {
  const profile = getProfile();
  const legal = (deck: DeckList | undefined): deck is DeckList =>
    deck !== undefined && validateDeck(content, deck).length === 0;

  const active = profile.decks[profile.activeDeckIndex];
  if (legal(active)) return active;

  const firstLegal = profile.decks.find((deck) => legal(deck));
  if (firstLegal) return firstLegal;

  return autoBuildDeck(content, fallbackLeaderId);
}

/** XP needed to reach the next account level. */
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 45;
}

/**
 * Award XP — to the account level, and to the Hype Wave, from one place.
 *
 * §10.1: *"The single account XP stream. No separate pass currency."* Two call
 * sites pay XP — finishing a match and claiming a mission — and before the pass
 * existed each ran its own level-up loop. One funnel means the pass cannot
 * silently miss a source: adding a third way to earn XP now feeds the pass by
 * construction rather than by somebody remembering to.
 *
 * The pass is synced first, so XP earned in the first moment of a new season
 * lands on the new season's pass rather than on the one that just ended.
 *
 * Returns whether the account levelled, which is all either caller wanted.
 */
function awardXp(draft: PlayerProfile, xp: number, now: number): boolean {
  let leveledUp = false;
  draft.accountXp += xp;
  while (draft.accountXp >= xpForLevel(draft.accountLevel)) {
    draft.accountXp -= xpForLevel(draft.accountLevel);
    draft.accountLevel += 1;
    leveledUp = true;
  }

  syncPassState(draft, now);
  const wave = draft.hypeWave;
  const forcedRebound = wave.forcedReboundUntil > now;
  if (wave.pass) wave.pass.xp += creditFor(wave.pass, xp, now, { forcedRebound });
  /**
   * Every archive earns too, at half rate. §10.5.3 says an unfinished pass
   * "keeps progressing at 50% of all XP you earn" — all of it, not the leftovers
   * of what the live pass did not want, so this is not a split.
   */
  for (const archive of wave.archives) archive.xp += creditFor(archive, xp, now);
  return leveledUp;
}

export interface MatchRewards {
  clout: number;
  xp: number;
  leveledUp: boolean;
  newLevel: number;
  /** the §3.5 first-win-of-the-day bonus, if this match was the one */
  firstWinBonus: number;
  /**
   * Clout this match earned that today's AI allowance had no room for.
   *
   * Reported rather than silently subtracted. A payout that quietly shrinks is
   * the exact move §6's honesty rules exist to prevent, and a cap nobody is told
   * about reads as the game being broken rather than as a rule.
   */
  cloutCapped: number;
  /** what is left of today's allowance after this match */
  cloutRemainingToday: number;
}

/** How many finished matches the mission evidence log keeps at most. */
export const OUTCOME_LOG_LIMIT = 200;

/**
 * Record a finished match and grant rewards. Rewards scale with participation
 * rather than with wins, so experimenting with new decks is never punished.
 */
export function recordMatch(
  /**
   * The replayable record, or **null** for a match this client did not
   * adjudicate.
   *
   * An online client cannot build one: a `MatchRecord` is `{ seed, decks,
   * intents }` and a `PlayerView` carries none of the three, deliberately,
   * because any of them would tell the client what it is about to draw.
   *
   * Nothing new had to be invented to accept that. `MatchHistoryEntry.record`
   * was already optional — "absent means not replayable, which the UI shows
   * honestly" — and the stats deriver already produced null for a record that
   * would not replay, with everything downstream simply getting no credit. An
   * online match takes that existing path: the outcome, the Clout and the XP
   * all land; the replay and the per-match statistics do not exist to land.
   */
  record: MatchRecord | null,
  outcome: "win" | "loss" | "draw",
  meta: {
    deckName: string;
    leaderCardId: string;
    opponentLeaderCardId: string;
    mode: string;
    /** the content index, so missions can read the match; omit to skip mission credit */
    content?: ContentIndex;
    /** which seat the player held; defaults to 0 */
    seat?: Seat;
    /** when the deck played was last saved, for the "edited this week" weekly */
    deckEditedAt?: number;
    /** Turn count, for a match with no record to read it out of. */
    turns?: number;
    now?: number;
  }
): MatchRewards {
  /**
   * What the match is worth, and what today has room for (09 §3).
   *
   * The rate moved out of this function into `economy.missions.match`; the cap
   * is derived from it by `aiDailyCap()`. Both are read before the update so the
   * returned `MatchRewards` can report the shortfall — the cap has to be visible
   * or it is just the game quietly paying less than it did yesterday.
   */
  const earnedClout = matchClout(outcome === "win");
  /**
   * A draw pays the loss rate, which is what `outcome === "win"` already meant.
   * Spelled out because the old literal made it look accidental.
   */
  const baseClout = spendAiClout(earnedClout, aiDailyCap(), meta.now ?? Date.now());
  /**
   * The XP the account level is paid, and — by §4 — the XP the mastery tracks
   * are paid with it. One number, read from `progression.json`, so the curve the
   * tracks are calibrated against cannot drift away from what a match actually
   * grants.
   */
  const baseXp = matchXp(outcome === "win");
  const now = meta.now ?? Date.now();

  /**
   * One replay, read once, before anything is written.
   *
   * It used to happen inside the update, after the history entry had already
   * been pushed — which was fine while only missions wanted it. The statistics
   * dashboard wants a summary *on* that entry, so the reading has to exist
   * before the entry is built. Reading it out here rather than replaying twice
   * also means the history summary, the mission evidence, the affinity and the
   * achievement tally are all the same numbers by construction.
   *
   * A record that will not replay produces null, and everything downstream of it
   * simply gets no credit — the same bargain as before.
   */
  let reading: MatchReading | null = null;
  if (meta.content && record) {
    try {
      reading = readMatch(record, meta.content, meta.seat ?? 0);
    } catch {
      reading = null;
    }
  }
  const stats = reading?.stats ?? null;

  let leveledUp = false;
  let newLevel = getProfile().accountLevel;

  /**
   * The first win of the day (§3.5, 30 Clout).
   *
   * Paid here rather than on the missions screen because it is a property of the
   * match, and a bonus that only lands if you happen to open a screen is a bonus
   * players lose without knowing.
   */
  let firstWinBonus = 0;

  profileStore.update((draft) => {
    draft.clout += baseClout;
    leveledUp = awardXp(draft, baseXp, now);
    newLevel = draft.accountLevel;

    draft.stats.matchesPlayed += 1;
    if (outcome === "win") draft.stats.wins += 1;
    else if (outcome === "loss") draft.stats.losses += 1;
    else draft.stats.draws += 1;

    draft.history.unshift({
      id: `m${Date.now().toString(36)}`,
      playedAt: Date.now(),
      deckName: meta.deckName,
      leaderCardId: meta.leaderCardId,
      opponentLeaderCardId: meta.opponentLeaderCardId,
      result: outcome,
      turns: record?.result?.turns ?? meta.turns ?? 0,
      mode: meta.mode,
      ...(stats
        ? {
            summary: {
              cardsPlayed: stats.cardsPlayed,
              charactersDefeated: stats.charactersDefeated,
              damageToEnemyLeader: stats.damageToEnemyLeader,
              confluencesActivated: stats.confluencesActivated,
              perfectResonances: stats.perfectResonances,
              peakObsession: stats.peakObsession,
            },
          }
        : {}),
      ...(record ? { record: structuredClone(record) } : {}),
    });
    draft.history = draft.history.slice(0, 60);
    // drop the heavy part from everything but the newest handful
    draft.history.forEach((entry, index) => {
      if (index >= REPLAYABLE_HISTORY) delete entry.record;
    });

    // --- mastery (§4, §5, §6) ----------------------------------------------
    /**
     * Credited *before* the mission block, and outside its `try`, on purpose.
     *
     * Mission stats come from replaying the record, and a record that no longer
     * replays cleanly earns no mission credit — which is recoverable, because
     * the evidence is still there to be re-scored if the bug is fixed. Mastery
     * is an accumulator with nothing to re-derive from, so it must not be able
     * to fail for a reason that has nothing to do with it. All it needs is the
     * leader that was played and whether the match was won, and both are in
     * `meta`.
     */
    /**
     * The save store merges defaults **shallowly**, so a save written before a
     * field was added inside `mastery` keeps the old object and the new field
     * arrives `undefined`. Normalising here rather than trusting the shape means
     * the next field added to this block cannot crash the first match after an
     * update — which, for an accumulator with nothing to re-derive from, would
     * cost real progress rather than one render.
     */
    draft.mastery ??= { faction: {}, leader: {}, affinity: {}, claimed: [] };
    draft.mastery.faction ??= {};
    draft.mastery.leader ??= {};
    draft.mastery.affinity ??= {};
    draft.mastery.claimed ??= [];
    draft.cosmetics ??= { owned: [], equipped: {} };
    draft.cosmetics.owned ??= [];
    draft.cosmetics.equipped ??= {};
    draft.achievements ??= { tally: emptyTally(), claimed: [] };
    draft.achievements.tally ??= emptyTally();
    draft.achievements.tally.totals ??= {};
    draft.achievements.tally.bests ??= {};
    draft.achievements.tally.sets ??= {};
    draft.achievements.claimed ??= [];

    const masteryLeader = meta.content?.leaders[meta.leaderCardId];
    const masteryFaction = masteryLeader && !masteryLeader.token ? masteryLeader.faction : null;
    /** the ranks this match started at — the two mastery weeklies read these */
    const rankBefore = masteryFaction
      ? {
          faction: rankFor(factionMasteryConfig(), draft.mastery.faction[masteryFaction] ?? 0).rank,
          leader: rankFor(leaderMasteryConfig(), draft.mastery.leader[meta.leaderCardId] ?? 0).rank,
        }
      : null;
    if (masteryFaction) {
      draft.mastery.faction[masteryFaction] = (draft.mastery.faction[masteryFaction] ?? 0) + baseXp;
      draft.mastery.leader[meta.leaderCardId] = (draft.mastery.leader[meta.leaderCardId] ?? 0) + baseXp;
    }

    // --- mission evidence --------------------------------------------------
    if (meta.content) {
      // affinity rides on the same replay; a match that would not replay earns
      // none, which is the one place mastery and missions genuinely share a fate
      for (const [cardId, points] of Object.entries(reading?.affinity ?? {})) {
        draft.mastery.affinity[cardId] = (draft.mastery.affinity[cardId] ?? 0) + points;
      }
      if (stats) {
        /**
         * Achievements share missions' fate rather than mastery's: they read the
         * replayed statistics, so a record that will not replay earns no
         * achievement credit either. That is the honest arrangement — the
         * alternative is banking a feat nobody can show the evidence for.
         *
         * Credited exactly once per finished match. `creditMatch` has no idea
         * whether it has seen this match before, and with an accumulator there
         * is nothing to re-derive from, so this being the only call site is what
         * keeps *"complete 500 matches"* honest.
         */
        creditMatch(draft.achievements.tally, stats, meta.mode);

        const outcomeEntry: MatchOutcome = {
          stats,
          mode: meta.mode,
          deckEditedThisPeriod: (meta.deckEditedAt ?? 0) >= weekStartOf(now),
          playedAt: now,
          ...(rankBefore ? { masteryAtPlay: rankBefore } : {}),
        };
        draft.missions.outcomes.push(outcomeEntry);
        /**
         * Events are credited from the same evidence, at the same moment.
         *
         * They cannot read `missions.outcomes` afterwards: it is pruned to what
         * the daily and weekly rotation still needs — about a week — and an
         * event runs a fortnight. See `src/game/events/index.ts`.
         */
        creditEvents(draft, outcomeEntry, now);
        // keep only what a held mission could still be scored from, plus a small
        // margin so a mission issued moments from now is not scored from nothing
        const horizon = Math.min(evidenceHorizon(draft.missions.rotation), now);
        draft.missions.outcomes = draft.missions.outcomes
          .filter((entry) => entry.playedAt >= horizon)
          .slice(-OUTCOME_LOG_LIMIT);
      }

      const today = dayIndex(now);
      if (outcome === "win" && draft.missions.firstWinDay !== today) {
        firstWinBonus = meta.content.balance.economy.missions.firstWinOfDayClout;
        draft.missions.firstWinDay = today;
        draft.clout += firstWinBonus;
      }
    }
  });

  /**
   * The first-win-of-the-day bonus is deliberately **outside** the cap.
   *
   * §3.5 pays it once a day by construction, so it cannot be farmed and there is
   * nothing for a daily ceiling to protect against. Capping it would mean the
   * one bonus the design promises is unmissable could be missed by having played
   * earlier in the day, which is the opposite of what it is for.
   */
  return {
    clout: baseClout + firstWinBonus,
    xp: baseXp,
    leveledUp,
    newLevel,
    firstWinBonus,
    cloutCapped: earnedClout - baseClout,
    cloutRemainingToday: aiCloutRemaining(aiDailyCap(), meta.now ?? Date.now()),
  };
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const weekStartOf = (now: number): number => weekStart(weekIndex(now));

/** Is the account still inside its Rookie Road window (§8.1)? */
export function onRookieRoad(content: ContentIndex, now = Date.now()): boolean {
  const created = getProfile().createdAt;
  if (!created) return false;
  return now - created < content.balance.economy.missions.rookieRoadDays * DAY_MS;
}

/** The PRNG the rotation rolls from, stored so an issue history can be re-derived. */
function missionRng(draft: PlayerProfile, now: number): RngState {
  const seed = draft.missions.seed || now;
  draft.missions.seed = seed;
  return draft.missions.rng ? ([...draft.missions.rng] as RngState) : seedRng(seed);
}

/**
 * Bring the rotation up to date and return what is held.
 *
 * Safe to call on every screen mount: `issueDue` is idempotent within a period,
 * so opening the missions screen twice in a minute issues nothing twice.
 */
export function syncMissions(content: ContentIndex, now = Date.now()): MissionView[] {
  profileStore.update((draft) => {
    const rng = missionRng(draft, now);
    draft.missions.rotation = issueDue(draft.missions.rotation, now, rng, {
      daily: dailyPool(),
      weekly: weeklyPool(),
    });
    draft.missions.rng = [...rng] as [number, number, number, number];
  });
  return missionViews(content, now);
}

/** Every held mission with its progress, dailies first. */
export function missionViews(content: ContentIndex, now = Date.now()): MissionView[] {
  const profile = getProfile();
  const rookieRoad = onRookieRoad(content, now);
  const held: ActiveMission[] = [...profile.missions.rotation.daily, ...profile.missions.rotation.weekly];
  return held
    .map((active) => viewMission(content, active, profile.missions.outcomes, { rookieRoad }))
    .filter((view): view is MissionView => view !== null);
}

export interface MissionClaim {
  clout: number;
  xp: number;
  /** Drops from the Weekly Wrap, when this claim finished a week's set */
  wrapDrops: number;
  leveledUp: boolean;
}

/**
 * Claim a completed mission.
 *
 * Returns null unless the mission is held **and** its objective is actually met
 * against the stored evidence — the completion is re-checked here rather than
 * trusted from the screen, because the screen is the one thing a player can
 * influence.
 */
export function claimMission(
  content: ContentIndex,
  cadence: MissionCadence,
  missionId: string,
  now = Date.now()
): MissionClaim | null {
  const views = missionViews(content, now);
  const view = views.find((entry) => entry.active.cadence === cadence && entry.active.missionId === missionId);
  if (!view || !view.progress.complete) return null;

  const economy = content.balance.economy.missions;
  let wrapDrops = 0;
  let leveledUp = false;

  profileStore.update((draft) => {
    draft.missions.rotation = removeMission(draft.missions.rotation, cadence, missionId);
    draft.clout += view.reward.clout;
    leveledUp = awardXp(draft, view.reward.xp, now);
    if (cadence === "daily") draft.missions.dailiesCompleted += 1;
    else draft.missions.weekliesCompleted += 1;

    /**
     * The Weekly Wrap (§8): finishing all of a week's weeklies pays a Drop.
     *
     * "All of them" is read as "none of that week's missions are still held",
     * which needs no extra bookkeeping precisely because nothing ever expires —
     * a mission leaves the list only by being claimed.
     */
    if (cadence === "weekly") {
      const week = view.active.periodIndex;
      const stillHeld = draft.missions.rotation.weekly.some((mission) => mission.periodIndex === week);
      if (!stillHeld && !draft.missions.wrappedWeeks.includes(week)) {
        wrapDrops = economy.weeklyWrapDrops;
        draft.missions.wrappedWeeks.push(week);
        draft.missions.wrappedWeeks = draft.missions.wrappedWeeks.slice(-52);
        draft.pendingDrops += wrapDrops;
      }
    }
  });

  return { clout: view.reward.clout, xp: view.reward.xp, wrapDrops, leveledUp };
}

/** Swap one held mission for another. One free reroll per period, per §7. */
export function rerollSlot(
  content: ContentIndex,
  cadence: MissionCadence,
  missionId: string,
  now = Date.now()
): MissionView[] | null {
  let ok = false;
  profileStore.update((draft) => {
    const rng = missionRng(draft, now);
    const pools = { daily: dailyPool(), weekly: weeklyPool() };
    /**
     * The free reroll first, then a token (§11 step 4).
     *
     * Ordered this way on purpose: spending a token while the free reroll is
     * still available would charge a player for something they already had, and
     * they cannot see the difference from the button.
     */
    const free = canReroll(draft.missions.rotation, cadence, now);
    const token = !free && (draft.rerollTokens ?? 0) > 0;
    if (!free && !token) return;

    const next = rerollMission(draft.missions.rotation, cadence, missionId, now, rng, pools, { force: token });
    draft.missions.rng = [...rng] as [number, number, number, number];
    if (next) {
      draft.missions.rotation = next;
      if (token) draft.rerollTokens = (draft.rerollTokens ?? 0) - 1;
      ok = true;
    }
  });
  return ok ? missionViews(content, now) : null;
}

/** Free Drops available this week (§3.5 "Weekly Restock"), claimable any time. */
export function restockAvailable(content: ContentIndex, now = Date.now()): number {
  const profile = getProfile();
  return profile.missions.restockWeek === weekIndex(now) ? 0 : content.balance.economy.missions.weeklyRestockDrops;
}

export function claimWeeklyRestock(content: ContentIndex, now = Date.now()): number {
  const drops = restockAvailable(content, now);
  if (drops <= 0) return 0;
  profileStore.update((draft) => {
    draft.missions.restockWeek = weekIndex(now);
    draft.pendingDrops += drops;
  });
  return drops;
}

// ---------------------------------------------------------------------------
// Mastery — §4 Faction, §5 Leader, §6 the Bias Board
// ---------------------------------------------------------------------------

/** Every faction's track, for the mastery screen. */
export function factionMastery(content: ContentIndex): MasteryView[] {
  const profile = getProfile();
  return factionTracks(content, profile.mastery?.faction ?? {}, profile.mastery?.claimed ?? []);
}

/** Every selectable leader's track. */
export function leaderMastery(content: ContentIndex): MasteryView[] {
  const profile = getProfile();
  return leaderTracks(content, profile.mastery?.leader ?? {}, profile.mastery?.claimed ?? []);
}

/** The Bias Board — characters with affinity, plus every character owned. */
export function biasBoard(content: ContentIndex): AffinityView[] {
  const profile = getProfile();
  return affinityBoard(content, profile.mastery?.affinity ?? {}, profile.mastery?.claimed ?? [], profile.collection);
}

/** How many mastery rewards are waiting — what the lobby badge counts. */
export function masteryUnclaimed(content: ContentIndex): number {
  const tracks = [...factionMastery(content), ...leaderMastery(content)];
  const board = biasBoard(content);
  return (
    tracks.reduce((sum, view) => sum + view.unclaimed, 0) + board.reduce((sum, view) => sum + view.unclaimed, 0)
  );
}

export interface MasteryGrant {
  clout: number;
  /** the crafting currency the design calls Fragments and the game calls Signal */
  fragments: number;
  /** cards added to the collection, by card id */
  cards: { cardId: string; copies: number }[];
  /** Signal paid instead of a copy the collection had no room for */
  signal: number;
  /** the Faction Pack this rank opened, if it paid one */
  pack: DropResult | null;
  /** lore pages unlocked, as `masteryLore` keys */
  lore: { kind: LoreKind; id: string; page: number }[];
  /** cosmetics unlocked — card backs, emotes, frames, badges, titles */
  cosmetics: Cosmetic[];
  /** cosmetics the rank promises that nothing can display yet */
  deferred: string[];
}

const emptyGrant = (): MasteryGrant => ({
  clout: 0,
  fragments: 0,
  cards: [],
  signal: 0,
  pack: null,
  lore: [],
  cosmetics: [],
  deferred: [],
});

/**
 * Add copies of a card, converting to Signal whatever the collection has no room
 * for — the same bargain the starter grant and a Drop both make, so a reward
 * never silently evaporates against the playable cap.
 */
function addCopies(
  draft: PlayerProfile,
  content: ContentIndex,
  cardId: string,
  copies: number,
  // structural, so a Mastery rank and a pass tier can share the one definition
  // of what "add copies, converting the overflow" means
  grant: { cards: { cardId: string; copies: number }[]; signal: number }
): void {
  const card = content.cards[cardId];
  if (!card) return;
  let added = 0;
  for (let copy = 0; copy < copies; copy++) {
    const held = draft.collection[cardId] ?? 0;
    if (held >= playableCap(content, card)) {
      const value = Math.round(
        (content.balance.economy.dustValue[card.rarity] ?? 0) * content.balance.economy.dupeConversionBonus
      );
      grant.signal += value;
      draft.shards += value;
    } else {
      draft.collection[cardId] = held + 1;
      added += 1;
    }
  }
  if (added > 0) grant.cards.push({ cardId, copies: added });
}

/** Open a Faction Pack through the account's own Drop stream, and log it. */
function openFactionPack(
  draft: PlayerProfile,
  content: ContentIndex,
  factionId: string,
  now: number
): DropResult {
  const seed = draft.drops.seed || now;
  const rng: RngState = draft.drops.rng ? ([...draft.drops.rng] as RngState) : seedRng(seed);
  const drop = openDrop(
    content,
    { owned: draft.collection, sinceLegendary: draft.drops.sinceLegendary },
    rng,
    { pool: (card) => card.faction === factionId }
  );
  for (const card of drop.cards) {
    if (card.convertedToSignal === undefined) draft.collection[card.cardId] = (draft.collection[card.cardId] ?? 0) + 1;
  }
  draft.shards += drop.signal;
  draft.drops.seed = seed;
  draft.drops.rng = [...rng] as [number, number, number, number];
  draft.drops.opened += 1;
  draft.drops.sinceLegendary = drop.sinceLegendary;
  draft.drops.log.unshift({
    openedAt: now,
    cards: drop.cards.map((card) => ({
      cardId: card.cardId,
      rarity: card.rarity,
      isNew: card.isNew,
      ...(card.convertedToSignal !== undefined ? { convertedToSignal: card.convertedToSignal } : {}),
    })),
    signal: drop.signal,
  });
  draft.drops.log = draft.drops.log.slice(0, DROP_LOG_LIMIT);
  return drop;
}

/** Pay one reward into the draft. Returns nothing; everything lands in `grant`. */
function payReward(
  draft: PlayerProfile,
  content: ContentIndex,
  reward: MasteryReward,
  context: { kind: LoreKind; id: string; factionId: string; rank: number; pickCardId?: string; now: number },
  grant: MasteryGrant
): void {
  switch (reward.kind) {
    case "clout":
      draft.clout += reward.amount;
      grant.clout += reward.amount;
      break;
    case "fragments":
      draft.shards += reward.amount;
      grant.fragments += reward.amount;
      break;
    case "pack":
      grant.pack = openFactionPack(draft, content, context.factionId, context.now);
      break;
    case "pick":
      if (context.pickCardId) addCopies(draft, content, context.pickCardId, reward.copies, grant);
      break;
    case "lore":
      grant.lore.push({ kind: context.kind, id: context.id, page: reward.page });
      break;
    case "cosmetic": {
      /**
       * `{id}` is the track's own entity, which is what lets one shared reward
       * table grant the right card back on each of ten faction tracks. A
       * cosmetic with no `ref`, or one naming something that does not resolve,
       * is recorded as deferred rather than granted — see DEFERRED_COSMETICS.
       */
      const cosmetic = reward.ref
        ? cosmeticById(content, reward.ref.replace("{id}", context.id))
        : null;
      if (!cosmetic) {
        grant.deferred.push(reward.name);
        break;
      }
      grantCosmeticTo(draft, cosmetic, grant);
      break;
    }
  }
}

/**
 * Add a cosmetic to the account, and wear it if that slot is empty.
 *
 * Auto-equipping the first of a kind is the difference between a reward you
 * receive and a reward you receive *and notice*: earn your first card back and
 * the next match is played with it, without a trip to a picker you do not yet
 * know exists. Later ones wait, because replacing something a player chose would
 * be worse than not equipping at all.
 */
function grantCosmeticTo(draft: PlayerProfile, cosmetic: Cosmetic, grant: { cosmetics: Cosmetic[] }): void {
  if (draft.cosmetics.owned.includes(cosmetic.id)) return;
  draft.cosmetics.owned.push(cosmetic.id);
  grant.cosmetics.push(cosmetic);
  if (WEARABLE_KINDS.includes(cosmetic.kind) && !draft.cosmetics.equipped[cosmetic.kind]) {
    draft.cosmetics.equipped[cosmetic.kind] = cosmetic.id;
  }
}

/**
 * The three cards a rank's pick offers, or null when it has no pick.
 *
 * The screen calls this to draw the choice; `claimMasteryRank` calls `canPick`
 * with the same inputs, so what is offered and what is accepted cannot drift.
 */
export function masteryPickChoices(
  content: ContentIndex,
  track: MasteryTrack,
  id: string,
  rank: number
): CardDef[] | null {
  const config = track === "faction" ? factionMasteryConfig() : leaderMasteryConfig();
  const pick = rewardsAt(config, rank).find((reward) => reward.kind === "pick");
  if (!pick || pick.kind !== "pick") return null;
  const factionId = track === "faction" ? id : (content.leaders[id]?.faction ?? "");
  return pickCandidates(content, factionId, rank, pick.rarity, pick.choices);
}

/**
 * Claim one mastery rank.
 *
 * Returns null and changes nothing when the rank is not earned, has already been
 * claimed, pays nothing that can be granted, or needs a pick that was not made
 * (or was made from outside the offer). Everything else lands in one `update`,
 * so a rank can never be marked claimed without paying.
 */
export function claimMasteryRank(
  content: ContentIndex,
  track: MasteryTrack,
  id: string,
  rank: number,
  pickCardId?: string,
  now = Date.now()
): MasteryGrant | null {
  if (track === "affinity") return null;
  const views = track === "faction" ? factionMastery(content) : leaderMastery(content);
  const view = views.find((entry) => entry.id === id);
  const row = view?.rows.find((entry) => entry.rank === rank);
  if (!view || !row || !row.claimable) return null;

  const config = track === "faction" ? factionMasteryConfig() : leaderMasteryConfig();
  const pick = rewardsAt(config, rank).find((reward) => reward.kind === "pick");
  if (pick && pick.kind === "pick") {
    const factionId = track === "faction" ? id : view.factionId;
    if (!pickCardId || !canPick(content, factionId, rank, pick.rarity, pick.choices, pickCardId)) return null;
  }

  const grant = emptyGrant();
  let paid = false;
  profileStore.update((draft) => {
    // re-check inside the update: the view was read outside it
    if (draft.mastery.claimed.includes(claimKey(track, id, rank))) return;
    paid = true;
    for (const reward of row.rewards) {
      payReward(
        draft,
        content,
        reward,
        {
          kind: track,
          id,
          factionId: view.factionId,
          rank,
          ...(pickCardId ? { pickCardId } : {}),
          now,
        },
        grant
      );
    }
    draft.mastery.claimed.push(claimKey(track, id, rank));
  });
  /**
   * The re-check losing means nothing was paid, so say so rather than handing
   * back an all-zero grant. A caller that treats a truthy result as "collected"
   * would otherwise report a reward it never received.
   */
  return paid ? grant : null;
}

/**
 * Claim one Bias Board tier. `tier` is 1-based, matching §6.2's table.
 *
 * Affinity rewards are lore and cosmetics only — §6 is explicit that affinity
 * must never create a gameplay reason to warp deckbuilding — so this pays a page
 * and records the rest as deferred.
 */
export function claimAffinityTier(content: ContentIndex, cardId: string, tier: number): MasteryGrant | null {
  const card = content.cards[cardId];
  if (!card) return null;
  const profile = getProfile();
  const view = affinityView(
    card,
    profile.mastery?.affinity?.[cardId] ?? 0,
    new Set(profile.mastery?.claimed ?? [])
  );
  const state = view.tiers[tier - 1];
  if (!state || !state.claimable) return null;

  const grant = emptyGrant();
  let paid = false;
  profileStore.update((draft) => {
    if (draft.mastery.claimed.includes(claimKey("affinity", cardId, tier))) return;
    paid = true;
    for (const reward of state.rewards) {
      if (reward.kind === "lore") {
        grant.lore.push({ kind: "bias", id: cardId, page: reward.page });
        continue;
      }
      if (reward.kind !== "cosmetic") continue;
      const cosmetic = reward.ref ? cosmeticById(content, reward.ref.replace("{id}", cardId)) : null;
      if (cosmetic) grantCosmeticTo(draft, cosmetic, grant);
      else grant.deferred.push(reward.name);
    }
    draft.mastery.claimed.push(claimKey("affinity", cardId, tier));
  });
  return paid ? grant : null;
}

/** The affinity config, for a screen that wants to print the published rates. */
export const publishedAffinity = (): ReturnType<typeof affinityConfig> => affinityConfig();

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

/**
 * Normalise the cosmetics block on the way in.
 *
 * The save store merges defaults shallowly, so an account created before this
 * shipped keeps its own object and any field added since arrives `undefined`.
 * Every reader goes through here rather than trusting the shape.
 */
function cosmeticsState(): { owned: string[]; equipped: Partial<Record<CosmeticKind, string | null>> } {
  const raw = getProfile().cosmetics;
  return { owned: raw?.owned ?? [], equipped: raw?.equipped ?? {} };
}

/** Every cosmetic the account owns, newest last, unknown ids dropped. */
export function myCosmetics(content: ContentIndex): Cosmetic[] {
  return ownedCosmetics(content, cosmeticsState().owned);
}

/** What is being worn in one slot, or null for the default. */
export function wearing(content: ContentIndex, kind: CosmeticKind): Cosmetic | null {
  const { owned, equipped } = cosmeticsState();
  return equippedCosmetic(content, kind, equipped, owned);
}

/**
 * Wear a cosmetic, or pass null to take the slot back to its default.
 *
 * Refuses anything the account does not own or that belongs in another slot,
 * and returns whether the slot changed — so a caller can tell "equipped" from
 * "that is not yours".
 */
export function equipCosmetic(content: ContentIndex, kind: CosmeticKind, id: string | null): boolean {
  if (id !== null) {
    const cosmetic = cosmeticById(content, id);
    if (!cosmetic || cosmetic.kind !== kind) return false;
    if (!cosmeticsState().owned.includes(id)) return false;
  }
  profileStore.update((draft) => {
    draft.cosmetics ??= { owned: [], equipped: {} };
    draft.cosmetics.equipped ??= {};
    draft.cosmetics.equipped[kind] = id;
  });
  return true;
}

/**
 * The emote wheel: the six every account starts with, plus anything unlocked.
 *
 * Emotes are the one cosmetic kind that is not *worn* — owning one adds it to
 * the wheel rather than replacing what is there, because the wheel is the whole
 * communication channel and swapping one phrase for another would be a strictly
 * worse reward.
 */
export function emoteWheel(content: ContentIndex): string[] {
  return unlockedEmotes(content, cosmeticsState().owned);
}

/** Does the account own this cosmetic? */
export const ownsCosmetic = (id: string): boolean => cosmeticsState().owned.includes(id);

// ---------------------------------------------------------------------------
// Achievements — §9
// ---------------------------------------------------------------------------

/** The achievements block, normalised for a save written before it existed. */
function achievementState(): { tally: AchievementTally; claimed: string[] } {
  const raw = getProfile().achievements;
  return {
    tally: {
      totals: raw?.tally?.totals ?? {},
      bests: raw?.tally?.bests ?? {},
      sets: raw?.tally?.sets ?? {},
    },
    claimed: raw?.claimed ?? [],
  };
}

/**
 * The facts about the account that achievements are allowed to read.
 *
 * Assembled here rather than reached for from inside the achievements module,
 * which is pure and takes this as an argument. That is not ceremony: three of
 * these come from Mastery views and one from the Doomscroll's own save store,
 * and a pure module that imported both would be a module that cannot be tested
 * against a literal.
 */
export function accountFacts(content: ContentIndex): AccountFacts {
  const profile = getProfile();
  const best = (views: readonly MasteryView[]): number =>
    views.reduce((highest, view) => Math.max(highest, view.rank), 0);
  return {
    distinctCards: Object.keys(profile.collection).length,
    cosmeticsOwned: cosmeticsState().owned.length,
    legendariesCrafted: profile.stats.legendariesCrafted ?? 0,
    accountLevel: profile.accountLevel,
    bestFactionMastery: best(factionMastery(content)),
    bestLeaderMastery: best(leaderMastery(content)),
    bestAffinityTier: biasBoard(content).reduce((highest, view) => Math.max(highest, view.tier), 0),
    roguelikeRunsCleared: doomscrollStore.get().runsCleared ?? 0,
    /**
     * Always zero, and honestly so — see `DEFERRED_FACTS`. *Front Row Seat* is
     * kept on the screen with its reason rather than deleted, because the
     * Community tab having exactly one greyed entry is a truer picture of what
     * this build is than an empty tab would be.
     */
    matchesSpectated: 0,
  };
}

export interface AchievementBoard {
  views: AchievementView[];
  milestones: MilestoneView[];
  /** points earned, and the most any offline account can earn */
  points: number;
  reachable: number;
}

/** Everything the achievements screen draws. */
export function achievementBoard(content: ContentIndex): AchievementBoard {
  const { tally, claimed } = achievementState();
  const views = achievementViews(tally, accountFacts(content), claimed);
  const points = pointsFrom(views);
  return { views, milestones: milestoneViews(points, claimed), points, reachable: reachablePoints() };
}

/** How many achievement rewards are waiting — what the lobby badge counts. */
export function achievementsUnclaimed(content: ContentIndex): number {
  const board = achievementBoard(content);
  return unclaimedCount(board.views, board.milestones);
}

export interface AchievementGrant {
  clout: number;
  fragments: number;
  cosmetics: Cosmetic[];
  /** rewards this promised that nothing can display yet */
  deferred: string[];
}

const emptyAchievementGrant = (): AchievementGrant => ({ clout: 0, fragments: 0, cosmetics: [], deferred: [] });

/** Pay one achievement reward into the draft. */
function payAchievementReward(
  draft: PlayerProfile,
  content: ContentIndex,
  reward: AchievementReward,
  grant: AchievementGrant
): void {
  switch (reward.kind) {
    case "clout":
      draft.clout += reward.amount;
      grant.clout += reward.amount;
      break;
    case "fragments":
      draft.shards += reward.amount;
      grant.fragments += reward.amount;
      break;
    case "cosmetic": {
      const cosmetic = reward.ref ? cosmeticById(content, reward.ref) : null;
      if (!cosmetic) grant.deferred.push(reward.name);
      else grantCosmeticTo(draft, cosmetic, grant);
      break;
    }
  }
}

/**
 * Claim one unlocked achievement.
 *
 * Returns null and changes nothing unless it is unlocked, unclaimed and pays
 * something that can actually be granted. The unlock is re-checked here rather
 * than trusted from the screen, and the claim key is written inside the same
 * `update` that pays, so an achievement can never be marked claimed without
 * paying — nor paid twice by two clicks landing in the same tick.
 */
export function claimAchievement(content: ContentIndex, id: string): AchievementGrant | null {
  const view = achievementBoard(content).views.find((entry) => entry.def.id === id);
  if (!view || !view.claimable) return null;

  const grant = emptyAchievementGrant();
  let paid = false;
  profileStore.update((draft) => {
    draft.achievements ??= { tally: emptyTally(), claimed: [] };
    draft.achievements.claimed ??= [];
    if (draft.achievements.claimed.includes(achievementKey(id))) return;
    paid = true;
    for (const reward of view.def.rewards) payAchievementReward(draft, content, reward, grant);
    draft.achievements.claimed.push(achievementKey(id));
  });
  return paid ? grant : null;
}

/** Claim one achievement-point milestone. `points` is the threshold, per §9. */
export function claimPointMilestone(content: ContentIndex, points: number): AchievementGrant | null {
  const view = achievementBoard(content).milestones.find((entry) => entry.milestone.points === points);
  if (!view || !view.claimable) return null;

  const grant = emptyAchievementGrant();
  let paid = false;
  profileStore.update((draft) => {
    draft.achievements ??= { tally: emptyTally(), claimed: [] };
    draft.achievements.claimed ??= [];
    if (draft.achievements.claimed.includes(milestoneKey(points))) return;
    paid = true;
    payAchievementReward(draft, content, view.milestone.reward, grant);
    draft.achievements.claimed.push(milestoneKey(points));
  });
  return paid ? grant : null;
}

/** Re-exported so a screen can grey a row for the same reason the claim refuses. */
export const achievementRewardIsGrantable = achievementRewardGrantable;

// ---------------------------------------------------------------------------
// The Hype Wave — §10
// ---------------------------------------------------------------------------

const WEEK_IN_MS = 604_800_000;

/**
 * Bring the pass block up to date, inside an existing draft.
 *
 * Idempotent and cheap, so it is safe to call from `awardXp` on every match as
 * well as from the screen. Three things happen here and nowhere else:
 *
 * 1. **Normalising.** The save store merges defaults shallowly, so an account
 *    created before the pass shipped keeps its own object and every field
 *    arrives `undefined`.
 * 2. **Archiving.** A pass whose season has ended and which is not finished
 *    becomes an Archive Pass. A *finished* one is simply dropped — there is
 *    nothing left for it to earn, and keeping it would grow the save forever.
 * 3. **Starting.** Entering a season with no pass for it starts one at zero.
 *
 * Between seasons there is no live pass at all, which is the honest state: the
 * screen says so, and the archives keep paying.
 */
function syncPassState(draft: PlayerProfile, now: number): void {
  draft.hypeWave ??= { pass: null, archives: [], lastSeenAt: 0, forcedReboundUntil: 0, welcomeBackAt: 0 };
  const wave = draft.hypeWave;
  wave.archives ??= [];
  wave.lastSeenAt ??= 0;
  wave.forcedReboundUntil ??= 0;
  wave.welcomeBackAt ??= 0;

  const season = seasonAt(now);
  if (wave.pass && wave.pass.seasonId !== season?.id) {
    if (!passComplete(wave.pass)) wave.archives.push(wave.pass);
    wave.pass = null;
  }
  if (season && !wave.pass) wave.pass = emptyPass(season.id);
  // an archive that has since reached tier 50 has nothing left to do
  wave.archives = wave.archives.filter((archive) => !passComplete(archive));
}

export interface WelcomeBack {
  /** the Clout the package is worth — attached to the message, not paid here */
  clout: number;
  /** how long Wave Rebound is forced on for, in whole days */
  reboundDays: number;
}

/**
 * Bring the pass up to date, and post the Welcome Back package if it is due.
 *
 * Safe to call on every screen mount. §10.5.4 offers it after fourteen days away;
 * `welcomeBackAt` stops a player who returns twice inside one window being paid
 * twice, and it is deliberately *not* a streak — coming back is rewarded, never
 * required, and skipping a fortnight forfeits nothing.
 *
 * **The Clout is not paid here.** It used to be: 300 Clout landed in the wallet
 * during a lobby mount, with nothing anywhere saying where it came from. That is
 * the inert-reward bug from the other side — not a reward that does nothing, but
 * one that says nothing — and §4.2.4 forbids it outright (*"No reward is
 * auto-consumed invisibly"*). Stamping `welcomeBackAt` is what posts the message;
 * `claimMail` hands the Clout over when the player takes it, and the message is
 * held open past the retention window until they do.
 *
 * The forced Rebound week *is* applied here, because it is a rate rather than a
 * grant: there is nothing to hand over, only a multiplier that is either on or
 * off, and a claim button for it would be a button that changes nothing.
 *
 * §10.5.4's other two parts — three pre-banked dailies and an extra weekly slot
 * for two weeks — are in `DEFERRED_PASS`: the mission rotation issues from a
 * pool on a clock and has no vocabulary for a granted mission.
 */
export function syncHypeWave(now = Date.now()): WelcomeBack | null {
  let posted: WelcomeBack | null = null;
  const { welcomeBack } = hypeWaveData();
  profileStore.update((draft) => {
    syncPassState(draft, now);
    const wave = draft.hypeWave;
    const away = welcomeBackDue(wave.lastSeenAt, now);
    const alreadyPaid = wave.welcomeBackAt > 0 && now - wave.welcomeBackAt < welcomeBack.afterDays * 86_400_000;
    if (away && !alreadyPaid) {
      wave.forcedReboundUntil = now + welcomeBack.reboundWeeks * WEEK_IN_MS;
      wave.welcomeBackAt = now;
      posted = { clout: welcomeBack.clout, reboundDays: welcomeBack.reboundWeeks * 7 };
    }
    wave.lastSeenAt = now;
  });
  return posted;
}

/** The live pass, plus any archives, as the screen draws them. */
export function hypeWaveViews(now = Date.now()): { live: PassView | null; archives: PassView[] } {
  const wave = getProfile().hypeWave;
  const forcedRebound = (wave?.forcedReboundUntil ?? 0) > now;
  return {
    live: wave?.pass ? passView(wave.pass, now, { forcedRebound }) : null,
    archives: (wave?.archives ?? []).map((archive) => passView(archive, now)).filter((view): view is PassView => view !== null),
  };
}

/** How many pass rewards are waiting — what the lobby badge counts. */
export function hypeWaveUnclaimed(now = Date.now()): number {
  const { live, archives } = hypeWaveViews(now);
  return (live?.unclaimed ?? 0) + archives.reduce((sum, view) => sum + view.unclaimed, 0);
}

export interface PassGrant {
  clout: number;
  fragments: number;
  glimmer: number;
  drops: number;
  cards: { cardId: string; copies: number }[];
  signal: number;
  cosmetics: Cosmetic[];
  /** rewards this tier promises that nothing can display yet */
  deferred: string[];
}

const emptyPassGrant = (): PassGrant => ({
  clout: 0,
  fragments: 0,
  glimmer: 0,
  drops: 0,
  cards: [],
  signal: 0,
  cosmetics: [],
  deferred: [],
});

/** The pass whose `seasonId` this is — the live one, or an archive. */
function passFor(draft: PlayerProfile, seasonId: string): PassState | null {
  if (draft.hypeWave.pass?.seasonId === seasonId) return draft.hypeWave.pass;
  return draft.hypeWave.archives.find((archive) => archive.seasonId === seasonId) ?? null;
}

function payPassReward(
  draft: PlayerProfile,
  content: ContentIndex,
  reward: PassReward,
  context: { seasonId: string; pickCardId?: string },
  grant: PassGrant
): void {
  switch (reward.kind) {
    case "clout":
      draft.clout += reward.amount;
      grant.clout += reward.amount;
      break;
    case "fragments":
      draft.shards += reward.amount;
      grant.fragments += reward.amount;
      break;
    case "glimmer":
      draft.glimmer = (draft.glimmer ?? 0) + reward.amount;
      grant.glimmer += reward.amount;
      break;
    case "pack":
      /**
       * Paid as an owed Drop rather than opened here. The pass hands over five
       * packs a season and opening them silently would rob the shop's opening
       * sequence of the one thing it is for.
       */
      draft.pendingDrops += 1;
      grant.drops += 1;
      break;
    case "pick":
      if (context.pickCardId) addCopies(draft, content, context.pickCardId, reward.copies, grant);
      break;
    case "cosmetic": {
      const ref = refFor(reward, context.seasonId);
      const cosmetic = ref ? cosmeticById(content, ref) : null;
      if (!cosmetic) grant.deferred.push(reward.name);
      else grantCosmeticTo(draft, cosmetic, grant);
      break;
    }
  }
}

/** The three cards a pass tier's pick offers, or null when it has no pick. */
export function passPickChoices(content: ContentIndex, seasonId: string, tier: number): CardDef[] | null {
  const pick = passRewardsAt("free", tier).find((reward) => reward.kind === "pick");
  if (!pick || pick.kind !== "pick") return null;
  return passPickCandidates(content, seasonId, tier, pick.rarity, pick.choices);
}

/**
 * Claim one tier on one track.
 *
 * Returns null and changes nothing unless the tier is reached, unclaimed, on a
 * track the account holds, and pays something that can actually be granted —
 * plus a valid pick where the tier needs one. Re-checked inside the `update`,
 * so a tier can never be marked claimed without paying.
 */
export function claimPassTier(
  content: ContentIndex,
  seasonId: string,
  track: PassTrack,
  tier: number,
  pickCardId?: string,
  now = Date.now()
): PassGrant | null {
  const { live, archives } = hypeWaveViews(now);
  const view = [live, ...archives].find((entry) => entry?.season.id === seasonId);
  const row = view?.rows.find((entry) => entry.tier === tier);
  if (!view || !row) return null;
  if (track === "free" ? !row.freeClaimable : !row.backstageClaimable) return null;

  const rewards = track === "free" ? row.free : row.backstage;
  const pick = rewards.find((reward) => reward.kind === "pick");
  if (pick && pick.kind === "pick") {
    if (!pickCardId || !canPassPick(content, seasonId, tier, pick.rarity, pick.choices, pickCardId)) return null;
  }

  const grant = emptyPassGrant();
  let paid = false;
  profileStore.update((draft) => {
    const pass = passFor(draft, seasonId);
    if (!pass) return;
    const claimed = track === "free" ? pass.claimedFree : pass.claimedBackstage;
    if (claimed.includes(tier)) return;
    paid = true;
    for (const reward of rewards) {
      payPassReward(draft, content, reward, { seasonId, ...(pickCardId ? { pickCardId } : {}) }, grant);
    }
    claimed.push(tier);
  });
  return paid ? grant : null;
}

/**
 * Collect the Encore tiers earned past 50 (§10.1) — endless, 50 Clout each.
 *
 * Paid as a count rather than as individual claims, because "endless" and "one
 * button per tier" do not go together, and because there is nothing to choose.
 */
export function claimEncore(now = Date.now()): { tiers: number; clout: number } | null {
  const { encoreClout } = hypeWaveData();
  let paid: { tiers: number; clout: number } | null = null;
  profileStore.update((draft) => {
    syncPassState(draft, now);
    const pass = draft.hypeWave.pass;
    if (!pass) return;
    const owed = tierFor(pass.xp).encore - pass.encoreClaimed;
    if (owed <= 0) return;
    pass.encoreClaimed += owed;
    draft.clout += owed * encoreClout;
    paid = { tiers: owed, clout: owed * encoreClout };
  });
  return paid;
}

/**
 * Buy the Backstage Pass for this season with Glimmer (§10.1).
 *
 * Retro-claim needs no code: every already-earned tier simply becomes claimable
 * the moment `backstage` flips, because claimability is recomputed from the tier
 * reached rather than stamped when the tier was passed.
 */
export function buyBackstagePass(seasonId: string, now = Date.now()): boolean {
  const { backstagePrice } = hypeWaveData();
  let bought = false;
  profileStore.update((draft) => {
    syncPassState(draft, now);
    const pass = passFor(draft, seasonId);
    if (!pass || pass.backstage) return;
    if ((draft.glimmer ?? 0) < backstagePrice) return;
    draft.glimmer = (draft.glimmer ?? 0) - backstagePrice;
    pass.backstage = true;
    bought = true;
  });
  return bought;
}

/**
 * Buy one tier with Glimmer (§10.5.5).
 *
 * A time-saver, never surfaced with urgency messaging — core rules §10. Adds one
 * tier's worth of XP rather than incrementing a tier counter, so a skip and an
 * hour of play are the same thing to everything downstream.
 */
export function skipPassTier(seasonId: string, now = Date.now()): boolean {
  const data = hypeWaveData();
  let skipped = false;
  profileStore.update((draft) => {
    syncPassState(draft, now);
    const pass = passFor(draft, seasonId);
    if (!pass || passComplete(pass)) return;
    if ((draft.glimmer ?? 0) < data.tierSkipPrice) return;
    draft.glimmer = (draft.glimmer ?? 0) - data.tierSkipPrice;
    pass.xp = xpForTier(tierFor(pass.xp).tier + 1);
    skipped = true;
  });
  return skipped;
}

/** Re-exported so a screen can grey a row for the same reason the claim refuses. */
export const passRewardIsGrantable = passRewardGrantable;

// ---------------------------------------------------------------------------
// Stream Check-In — §11
// ---------------------------------------------------------------------------

/** The calendar month a moment falls in, as `YYYY-MM`. */
export const monthKey = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

/** The calendar day a moment falls in, as `YYYY-MM-DD`. */
export const dayKey = (now: number): string => {
  const date = new Date(now);
  return `${monthKey(now)}-${String(date.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// The AI daily Clout cap — 09 §3's `missions.aiDailyCap`
// ---------------------------------------------------------------------------

/** Clout already taken from the AI cap today. */
export function aiCloutSpent(now = Date.now()): number {
  const state = getProfile().aiClout;
  return state && state.day === dayKey(now) ? state.spent : 0;
}

/** How much of a cap is left today. */
export const aiCloutRemaining = (cap: number, now = Date.now()): number => Math.max(0, cap - aiCloutSpent(now));

/**
 * Take up to `wanted` Clout from today's AI allowance and return what was
 * actually granted.
 *
 * Returns the amount rather than a boolean, and the caller reports the
 * difference, because a payout silently shrinking to nothing is exactly the kind
 * of quiet subtraction §6's honesty rules exist to prevent. A capped run says on
 * the summary that it was capped and by how much.
 *
 * The ledger resets on a calendar-day change rather than a rolling window: a
 * cap you can predict is a cap you can plan around.
 */
export function spendAiClout(wanted: number, cap: number, now = Date.now()): number {
  if (wanted <= 0) return 0;
  const today = dayKey(now);
  let granted = 0;
  profileStore.update((draft) => {
    const state = draft.aiClout?.day === today ? draft.aiClout : { day: today, spent: 0 };
    granted = Math.max(0, Math.min(wanted, cap - state.spent));
    draft.aiClout = { day: today, spent: state.spent + granted };
  });
  return granted;
}

export interface CheckInView {
  month: string;
  steps: CheckInStep[];
  /** how many steps have been claimed this month */
  claimed: number;
  /** true when today's step has not been taken yet */
  available: boolean;
  /** true once every step this month is claimed */
  complete: boolean;
}

export function checkInView(now = Date.now()): CheckInView {
  const { steps } = checkInConfig();
  const state = getProfile().checkIn;
  const month = monthKey(now);
  const claimed = state?.month === month ? (state.claimed ?? 0) : 0;
  const claimedToday = state?.month === month && state.lastDay === dayKey(now);
  return {
    month,
    steps,
    claimed,
    available: !claimedToday && claimed < steps.length,
    complete: claimed >= steps.length,
  };
}

export interface CheckInGrant {
  step: number;
  clout: number;
  fragments: number;
  glimmer: number;
  rerollTokens: number;
  drops: number;
  cosmetics: Cosmetic[];
}

/**
 * Claim today's check-in step (§11).
 *
 * *"Each day you log in claims the next step. No streaks, no resets, no
 * consecutive-day requirements — a player who logs in 6 scattered days simply
 * claims 6 steps."* So the only thing this refuses is a second claim on the same
 * calendar day; missing a day costs nothing and skips nothing.
 *
 * A new month restarts the track at step 1, which is §11's own rule ("the track
 * does not carry between months"). It is not a reset in the punishing sense —
 * nothing is taken away, and last month's steps were already paid.
 */
export function claimCheckIn(content: ContentIndex, now = Date.now()): CheckInGrant | null {
  const view = checkInView(now);
  if (!view.available) return null;
  const step = view.steps[view.claimed];
  if (!step) return null;

  const grant: CheckInGrant = {
    step: view.claimed + 1,
    clout: 0,
    fragments: 0,
    glimmer: 0,
    rerollTokens: 0,
    drops: 0,
    cosmetics: [],
  };

  profileStore.update((draft) => {
    draft.checkIn ??= { month: "", claimed: 0, lastDay: "" };
    if (draft.checkIn.month !== view.month) draft.checkIn = { month: view.month, claimed: 0, lastDay: "" };
    if (draft.checkIn.lastDay === dayKey(now)) return;

    switch (step.kind) {
      case "clout":
        draft.clout += step.amount;
        grant.clout = step.amount;
        break;
      case "fragments":
        draft.shards += step.amount;
        grant.fragments = step.amount;
        break;
      case "glimmer":
        draft.glimmer = (draft.glimmer ?? 0) + step.amount;
        grant.glimmer = step.amount;
        break;
      case "rerollTokens":
        draft.rerollTokens = (draft.rerollTokens ?? 0) + step.amount;
        grant.rerollTokens = step.amount;
        break;
      case "pack":
        draft.pendingDrops += 1;
        grant.drops = 1;
        break;
      case "cosmetic": {
        /**
         * The month decides which card back, not the step. A player who claims
         * step 10 in March and again in April gets two different backs; one who
         * reaches it twice in the same month cannot, because the month has only
         * one.
         */
        const cosmetic = cosmeticById(content, checkInCosmeticForMonth(new Date(now).getMonth()));
        if (cosmetic) grantCosmeticTo(draft, cosmetic, grant);
        break;
      }
    }

    draft.checkIn.claimed += 1;
    draft.checkIn.lastDay = dayKey(now);
  });

  return grant;
}

/** Daily-mission reroll tokens held (§11 step 4). */
export const rerollTokens = (): number => getProfile().rerollTokens ?? 0;

// ---------------------------------------------------------------------------
// The Inbox — §4.5.3
// ---------------------------------------------------------------------------

/** The inbox block, normalised for a save written before it existed. */
function inboxBlock(draft: PlayerProfile): PlayerProfile["inbox"] {
  draft.inbox ??= { read: [], claimed: [], deleted: [] };
  draft.inbox.read ??= [];
  draft.inbox.claimed ??= [];
  draft.inbox.deleted ??= [];
  return draft.inbox;
}

/** The facts mail is derived from that only the save knows. */
function mailInput(profile: PlayerProfile): MailInput {
  return {
    createdAt: profile.createdAt,
    welcomeBackAt: profile.hypeWave?.welcomeBackAt ?? 0,
    archivedSeasonIds: (profile.hypeWave?.archives ?? []).map((archive) => archive.seasonId),
    claimed: profile.inbox?.claimed ?? [],
    grants: profile.inbox?.grants ?? [],
    eventConversions: Object.values(profile.events?.state ?? {}).flatMap((state) =>
      (state.conversions ?? []).map((entry) => ({ eventId: state.eventId, ...entry }))
    ),
  };
}

export interface MailView {
  message: MailMessage;
  read: boolean;
  /** true once the attachment has been handed over */
  claimed: boolean;
  /** true when there is an attachment still waiting */
  claimable: boolean;
}

/**
 * The inbox, newest first, with what the player has done to each message.
 *
 * Deleted messages are dropped here rather than inside `buildMail`, so deletion
 * stays a fact about the *account* and never about the mail: undeleting would be
 * one line, and a message the player deleted before it was corrected comes back
 * corrected rather than not at all.
 */
export function inboxViews(content: ContentIndex, now = Date.now()): MailView[] {
  const profile = getProfile();
  const deleted = new Set(profile.inbox?.deleted ?? []);
  const read = new Set(profile.inbox?.read ?? []);
  const claimed = new Set(profile.inbox?.claimed ?? []);
  return buildMail(content, mailInput(profile), now)
    .filter((message) => !deleted.has(message.id))
    .map((message) => ({
      message,
      read: read.has(message.id),
      claimed: claimed.has(message.id),
      claimable: (message.attachment?.length ?? 0) > 0 && !claimed.has(message.id),
    }));
}

/**
 * What the lobby badge counts: unread messages.
 *
 * Unread rather than claimable, because most system mail carries nothing and a
 * badge that only lit up for grants would leave a season ending unannounced —
 * §5's rule that badge counts *"reflect real claimable state only, never
 * attention bait"* is about not inventing counts, and an unread message is a
 * real thing waiting for you.
 */
export function unreadMail(content: ContentIndex, now = Date.now()): number {
  return inboxViews(content, now).filter((view) => !view.read).length;
}

/**
 * Drop ids no message has any more.
 *
 * Called from every write, which keeps `read` and `deleted` bounded by the
 * number of messages that exist rather than by an arbitrary limit. It is given
 * the *undeleted* id set on purpose: pruning against the visible list would
 * forget every deletion the moment it took effect, and the message would return.
 */
function pruneMailLedgers(draft: PlayerProfile, content: ContentIndex, now: number): void {
  const inbox = inboxBlock(draft);
  const live = new Set(buildMail(content, mailInput(draft), now).map((message) => message.id));
  inbox.read = inbox.read.filter((id) => live.has(id));
  inbox.deleted = inbox.deleted.filter((id) => live.has(id));
}

/** Mark one message read. Returns false when it was already. */
export function markMailRead(content: ContentIndex, id: string, now = Date.now()): boolean {
  let changed = false;
  profileStore.update((draft) => {
    const inbox = inboxBlock(draft);
    if (inbox.read.includes(id)) return;
    inbox.read.push(id);
    changed = true;
    pruneMailLedgers(draft, content, now);
  });
  return changed;
}

/** Mark everything currently in the inbox read. Returns how many changed. */
export function markAllMailRead(content: ContentIndex, now = Date.now()): number {
  const ids = inboxViews(content, now)
    .filter((view) => !view.read)
    .map((view) => view.message.id);
  if (ids.length === 0) return 0;
  profileStore.update((draft) => {
    const inbox = inboxBlock(draft);
    for (const id of ids) if (!inbox.read.includes(id)) inbox.read.push(id);
    pruneMailLedgers(draft, content, now);
  });
  return ids.length;
}

export interface MailGrant {
  clout: number;
}

/**
 * Take a message's attachment.
 *
 * Returns null and changes nothing unless the message exists, is not deleted,
 * carries an attachment and has not been claimed — re-checked inside the
 * `update`, so an id can never be written to the ledger without being paid.
 * Claiming also marks it read, because taking something out of a message you
 * have not opened is not a state worth keeping.
 */
export function claimMail(content: ContentIndex, id: string, now = Date.now()): MailGrant | null {
  const view = inboxViews(content, now).find((entry) => entry.message.id === id);
  if (!view || !view.claimable) return null;

  const grant: MailGrant = { clout: 0 };
  let paid = false;
  profileStore.update((draft) => {
    const inbox = inboxBlock(draft);
    if (inbox.claimed.includes(id)) return;
    for (const reward of view.message.attachment ?? []) {
      draft.clout += reward.amount;
      grant.clout += reward.amount;
    }
    inbox.claimed.push(id);
    if (!inbox.read.includes(id)) inbox.read.push(id);
    paid = true;
    pruneMailLedgers(draft, content, now);
  });
  return paid ? grant : null;
}

/**
 * Delete a message.
 *
 * **Refuses to delete anything still holding an unclaimed attachment.** F6
 * forbids grants you can lose by not acting, and a delete button that can throw
 * away 300 Clout with one mis-tap is exactly that with an extra step. Take the
 * attachment first; then it deletes like anything else.
 */
export function deleteMail(content: ContentIndex, id: string, now = Date.now()): boolean {
  const view = inboxViews(content, now).find((entry) => entry.message.id === id);
  if (!view || view.claimable) return false;
  profileStore.update((draft) => {
    const inbox = inboxBlock(draft);
    if (!inbox.deleted.includes(id)) inbox.deleted.push(id);
    pruneMailLedgers(draft, content, now);
  });
  return true;
}

/** Clear every read message that owes nothing. Returns how many went. */
export function deleteReadMail(content: ContentIndex, now = Date.now()): number {
  const ids = inboxViews(content, now)
    .filter((view) => view.read && !view.claimable)
    .map((view) => view.message.id);
  if (ids.length === 0) return 0;
  profileStore.update((draft) => {
    const inbox = inboxBlock(draft);
    for (const id of ids) if (!inbox.deleted.includes(id)) inbox.deleted.push(id);
    pruneMailLedgers(draft, content, now);
  });
  return ids.length;
}

// ---------------------------------------------------------------------------
// News and patch notes — §4.2.2, §4.2.3
// ---------------------------------------------------------------------------

/** The news block, normalised for a save written before it existed. */
function newsBlock(draft: PlayerProfile): PlayerProfile["news"] {
  draft.news ??= { read: [], seenVersions: [] };
  draft.news.read ??= [];
  draft.news.seenVersions ??= [];
  return draft.news;
}

export interface NewsView {
  article: NewsArticle;
  read: boolean;
}

/** Every article, newest first, with whether it has been opened. */
export function newsFeed(content: ContentIndex): NewsView[] {
  const read = new Set(getProfile().news?.read ?? []);
  return newsArticles(content).map((article) => ({ article, read: read.has(article.def.id) }));
}

/** The newest article — what the lobby's card shows. */
export const headlineArticle = (content: ContentIndex): NewsView | null => newsFeed(content)[0] ?? null;

/** How many articles have not been opened. */
export const unreadNews = (content: ContentIndex): number =>
  newsFeed(content).filter((view) => !view.read).length;

/** Mark one article read. Returns false when it already was. */
export function markArticleRead(content: ContentIndex, id: string): boolean {
  let changed = false;
  profileStore.update((draft) => {
    const news = newsBlock(draft);
    if (news.read.includes(id)) return;
    news.read.push(id);
    changed = true;
    // bounded by what the shipped feed carries, the same way the inbox prunes
    const live = new Set(newsArticles(content).map((article) => article.def.id));
    news.read = news.read.filter((entry) => live.has(entry));
  });
  return changed;
}

/** Mark every article read. Returns how many changed. */
export function markAllNewsRead(content: ContentIndex): number {
  const ids = newsFeed(content)
    .filter((view) => !view.read)
    .map((view) => view.article.def.id);
  for (const id of ids) markArticleRead(content, id);
  return ids.length;
}

/**
 * Release versions whose notes this account has not opened — §4.2.3's
 * *"changed since you last played"* band.
 *
 * A brand-new account has seen nothing, which would light the band up on a
 * player's very first visit and tell them something changed since a time they
 * were not here for. So an account that has never opened the notes is treated as
 * having seen the release it started on: the band is for *changes*, and the
 * state of the world when you arrived is not one.
 */
export function unseenReleases(): string[] {
  return unseenVersions(
    getProfile().news?.seenVersions ?? [],
    releases().map((release) => release.version)
  );
}

/** Record that a release's notes have been read. */
export function markVersionSeen(version: string): void {
  profileStore.update((draft) => {
    const news = newsBlock(draft);
    if (!news.seenVersions.includes(version)) news.seenVersions.push(version);
    const live = new Set(releases().map((release) => release.version));
    news.seenVersions = news.seenVersions.filter((entry) => live.has(entry));
  });
}

// ---------------------------------------------------------------------------
// Headliner Banners — §4
// ---------------------------------------------------------------------------

/** The banner block, normalised for a save written before it existed. */
function bannerBlock(draft: PlayerProfile): PlayerProfile["banners"] {
  draft.banners ??= { state: {}, tokens: 0, log: [], seed: 0, rng: null };
  draft.banners.state ??= {};
  draft.banners.tokens ??= 0;
  draft.banners.log ??= [];
  return draft.banners;
}

const bannerStateOf = (id: string): BannerState | null => {
  const banner = bannerById(id);
  if (!banner) return null;
  return getProfile().banners?.state?.[id] ?? emptyBannerState(banner);
};

/** Every banner and its state, live ones first. */
export function bannerViews(content: ContentIndex, now = Date.now()): BannerView[] {
  const live = new Set(liveBanners(now).map((banner) => banner.id));
  return bannerData()
    .banners.map((banner) => bannerView(content, banner, bannerStateOf(banner.id)!, now))
    .sort((a, b) => Number(live.has(b.banner.id)) - Number(live.has(a.banner.id)));
}

/** The banner the page opens on: the live one, or the next to run. */
export function currentBanner(content: ContentIndex, now = Date.now()): BannerView | null {
  return bannerViews(content, now)[0] ?? null;
}

export const backstageTokens = (): number => getProfile().banners?.tokens ?? 0;

/** Every pull the account remembers, newest first. */
export const pullHistory = (): PullLogEntry[] => getProfile().banners?.log ?? [];

/** §4.1: the history is exportable as JSON. */
export const pullHistoryJson = (): string => JSON.stringify(pullHistory(), null, 2);

export interface BannerPull extends PullResult {
  /** Clout actually charged — zero when §4.1's free first pull covered it */
  cloutSpent: number;
  cards: PullResult["cards"];
  /** the themed card back, if this ×10 was the first */
  cosmetics: Cosmetic[];
}

/**
 * Pull on a banner, ×1 or ×10.
 *
 * Returns null when the banner is not running or the account cannot pay, and
 * never partially applies: the Clout, the cards, the Signal, the tokens, the
 * counters and the log all move inside one `update`.
 *
 * The ×10 is exactly ten pulls at ten times the price and carries **no** odds
 * advantage — §6's F2 — which needs no special case precisely because it is the
 * same loop run ten times against the same rolling counters.
 */
export function pullBanner(
  content: ContentIndex,
  bannerId: string,
  count: 1 | 10,
  now = Date.now()
): BannerPull | null {
  const banner = bannerById(bannerId);
  if (!banner) return null;
  const view = bannerView(content, banner, bannerStateOf(bannerId)!, now);
  if (!view.live) return null;

  const rules = content.balance.economy.banner;
  // §4.1: the first ×1 on each banner is free, and only the ×1
  const free = count === 1 && view.freePull;
  const price = free ? 0 : rules.pullPrice * count;
  if (getProfile().clout < price) return null;

  let result: BannerPull | null = null;
  profileStore.update((draft) => {
    const block = bannerBlock(draft);
    const before = block.state[bannerId] ?? emptyBannerState(banner);
    const seed = block.seed || now;
    const rng: RngState = block.rng ? ([...block.rng] as RngState) : seedRng(seed);

    const pull = resolvePulls(content, banner, before, { owned: draft.collection }, rng, count);

    draft.clout -= price;
    for (const card of pull.cards) {
      if (card.convertedToSignal === undefined) draft.collection[card.cardId] = (draft.collection[card.cardId] ?? 0) + 1;
    }
    draft.shards += pull.signal;
    block.tokens += pull.tokens;

    const next = { ...pull.state };
    if (free) next.freePullUsed = true;
    /**
     * §4.1's other first-time reward: the first ×10 grants the banner's themed
     * card back, once. Kept across reruns, because a rerun is the same banner.
     */
    const cosmetics: Cosmetic[] = [];
    if (count === 10 && !next.firstTenRewarded) {
      next.firstTenRewarded = true;
      const cosmetic = cosmeticById(content, bannerCardBackId(bannerId));
      if (cosmetic) grantCosmeticTo(draft, cosmetic, { cosmetics });
    }
    block.state[bannerId] = next;

    block.seed = seed;
    block.rng = [...rng] as [number, number, number, number];
    block.log.unshift({
      pulledAt: now,
      bannerId,
      count,
      cards: pull.cards.map((card) => ({
        cardId: card.cardId,
        rarity: card.rarity,
        isNew: card.isNew,
        featured: card.featured,
        wishlisted: card.wishlisted,
        path: card.path,
        ...(card.convertedToSignal !== undefined ? { convertedToSignal: card.convertedToSignal } : {}),
      })),
      signal: pull.signal,
      tokens: pull.tokens,
    });
    block.log = block.log.slice(0, PULL_LOG_LIMIT);

    result = { ...pull, state: next, cloutSpent: price, cosmetics };
  });
  return result;
}

/**
 * Choose the card the Encore Meter counts toward (§4.3).
 *
 * Any card in the pool, and changing it **keeps the meter's count** — the
 * guarantee applies to whichever Target is set when the meter fills. Resetting
 * the count on a change would make choosing a Target a trap.
 */
export function setTargetCard(content: ContentIndex, bannerId: string, cardId: string): boolean {
  const card = content.cards[cardId];
  if (!bannerById(bannerId) || !card || card.token || card.variantOf) return false;
  profileStore.update((draft) => {
    const block = bannerBlock(draft);
    const state = block.state[bannerId] ?? emptyBannerState(bannerById(bannerId)!);
    block.state[bannerId] = { ...state, targetCardId: cardId };
  });
  return true;
}

/**
 * Add or remove a card from a banner's wishlist. Returns the new list, or null
 * when the card is not eligible or the list is already full.
 */
export function toggleWishlist(content: ContentIndex, bannerId: string, cardId: string): string[] | null {
  const banner = bannerById(bannerId);
  const card = content.cards[cardId];
  if (!banner || !card || card.token || card.variantOf) return null;

  let out: string[] | null = null;
  profileStore.update((draft) => {
    const block = bannerBlock(draft);
    const state = block.state[bannerId] ?? emptyBannerState(banner);
    const wishlist = [...state.wishlist];
    const at = wishlist.indexOf(cardId);
    if (at >= 0) wishlist.splice(at, 1);
    else if (wishlist.length >= content.balance.economy.banner.wishlistLimit) return;
    else wishlist.push(cardId);
    block.state[bannerId] = { ...state, wishlist };
    out = wishlist;
  });
  return out;
}

/**
 * Redeem a card from the Backstage Shop (§4.4).
 *
 * Sells any card from **any currently active banner's pool** at fixed token
 * prices — which, since a banner's pool is the whole collectible set, means any
 * card at all while a banner is running. That is the design's intent: fifty
 * pulls both fill the Encore Meter and bank enough tokens to buy a second
 * Legendary of choice, and §4.4 calls that double guarantee deliberate.
 *
 * Refuses a card the account already holds at the playable cap — spending fifty
 * tokens on a copy that would immediately convert is not a purchase anybody
 * meant to make.
 */
export function redeemBackstage(content: ContentIndex, cardId: string, now = Date.now()): number | null {
  const card = content.cards[cardId];
  if (!card || card.token || card.variantOf) return null;
  if (liveBanners(now).length === 0) return null;
  const price = tokenPrice(content, card);
  if (price <= 0 || backstageTokens() < price) return null;
  if ((getProfile().collection[cardId] ?? 0) >= playableCap(content, card)) return null;

  profileStore.update((draft) => {
    const block = bannerBlock(draft);
    block.tokens -= price;
    draft.collection[cardId] = (draft.collection[cardId] ?? 0) + 1;
    /**
     * §4.3: obtaining the Target Card by any means resets the meter. Buying it
     * with tokens is a means, and a meter that kept counting toward a card the
     * player just bought would be counting toward nothing.
     */
    for (const [id, state] of Object.entries(block.state)) {
      if (state.targetCardId === cardId) block.state[id] = { ...state, sinceTarget: 0 };
    }
  });
  return price;
}

// ---------------------------------------------------------------------------
// Merch Drops
// ---------------------------------------------------------------------------

/** Can the account afford a Drop right now? */
export function canAffordDrop(content: ContentIndex): boolean {
  const profile = getProfile();
  return profile.pendingDrops > 0 || profile.clout >= content.balance.economy.pack.price;
}

/**
 * Buy and open one Merch Drop.
 *
 * Returns null when the account cannot pay, and never partially applies: the
 * Clout, the cards, the Signal and the log all move in one `update`, so a Drop
 * can never be charged for and not delivered.
 */
export function openMerchDrop(content: ContentIndex, now = Date.now()): DropResult | null {
  const price = content.balance.economy.pack.price;
  // an owed Drop is spent before Clout is, so a starter grant is not quietly
  // wasted by a player who happens to be able to afford one anyway
  const free = getProfile().pendingDrops > 0;
  if (!free && getProfile().clout < price) return null;

  let result: DropResult | null = null;
  profileStore.update((draft) => {
    const seed = draft.drops.seed || now;
    const rng: RngState = draft.drops.rng ? ([...draft.drops.rng] as RngState) : seedRng(seed);

    const drop = openDrop(content, { owned: draft.collection, sinceLegendary: draft.drops.sinceLegendary }, rng);

    if (free) draft.pendingDrops -= 1;
    else draft.clout -= price;
    for (const card of drop.cards) {
      if (card.convertedToSignal === undefined) draft.collection[card.cardId] = (draft.collection[card.cardId] ?? 0) + 1;
    }
    draft.shards += drop.signal;

    draft.drops.seed = seed;
    draft.drops.rng = [...rng] as [number, number, number, number];
    draft.drops.opened += 1;
    draft.drops.sinceLegendary = drop.sinceLegendary;
    draft.drops.log.unshift({
      openedAt: now,
      cards: drop.cards.map((card) => ({
        cardId: card.cardId,
        rarity: card.rarity,
        isNew: card.isNew,
        ...(card.convertedToSignal !== undefined ? { convertedToSignal: card.convertedToSignal } : {}),
      })),
      signal: drop.signal,
    });
    draft.drops.log = draft.drops.log.slice(0, DROP_LOG_LIMIT);

    result = drop;
  });
  return result;
}

/** Craft a card with shards. */
export function craftCard(content: ContentIndex, cardId: string): boolean {
  const card = content.cards[cardId];
  if (!card) return false;
  const cost = content.balance.economy.craftCost[card.rarity];
  const profile = getProfile();
  if (profile.shards < cost) return false;

  profileStore.update((draft) => {
    draft.shards -= cost;
    draft.collection[cardId] = (draft.collection[cardId] ?? 0) + 1;
    // §9's *Whale-Free Since Day One*. Counted here rather than inferred from the
    // collection, which cannot tell a crafted Legendary from an opened one.
    if (card.rarity === "legendary") draft.stats.legendariesCrafted = (draft.stats.legendariesCrafted ?? 0) + 1;
  });
  return true;
}

/** Dismantle a spare copy for shards. Locked and favourited cards are safe. */
export function dismantleCard(content: ContentIndex, cardId: string): boolean {
  const card = content.cards[cardId];
  if (!card) return false;
  const profile = getProfile();
  if ((profile.collection[cardId] ?? 0) <= 0) return false;
  if (profile.locked.includes(cardId)) return false;

  profileStore.update((draft) => {
    draft.collection[cardId] = (draft.collection[cardId] ?? 1) - 1;
    if (draft.collection[cardId] <= 0) delete draft.collection[cardId];
    draft.shards += content.balance.economy.dustValue[card.rarity];
  });
  return true;
}

export function toggleFavorite(cardId: string): void {
  profileStore.update((draft) => {
    const index = draft.favorites.indexOf(cardId);
    if (index >= 0) draft.favorites.splice(index, 1);
    else draft.favorites.push(cardId);
  });
}

export function toggleLock(cardId: string): void {
  profileStore.update((draft) => {
    const index = draft.locked.indexOf(cardId);
    if (index >= 0) draft.locked.splice(index, 1);
    else draft.locked.push(cardId);
  });
}

// ---------------------------------------------------------------------------
// Limited-time events — 09 §14
// ---------------------------------------------------------------------------

/** The events block, normalised for a save written before it existed. */
function eventBlock(draft: PlayerProfile): PlayerProfile["events"] {
  draft.events ??= { state: {} };
  draft.events.state ??= {};
  return draft.events;
}

/** One event's stored state, or a fresh empty one. */
export const eventStateOf = (eventId: string): EventState =>
  eventStateFor(getProfile().events?.state ?? {}, eventId);

/**
 * Every event with its state, as the hub draws it: live first, then upcoming,
 * then the archive.
 *
 * The ordering is the screen's, but it belongs here rather than in the screen
 * because the lobby widget wants the same first row and two orderings of one
 * list is one ordering too many.
 */
export function eventViews(now = Date.now()): EventView[] {
  const states = getProfile().events?.state ?? {};
  const rank = (event: EventDef): number => {
    const phase = eventPhase(event, now);
    return phase === "active" ? 0 : phase === "upcoming" ? 1 : 2;
  };
  return [...allEvents()]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((event) => eventView(event, eventStateFor(states, event.id), now));
}

/**
 * Credit one finished match to every running event.
 *
 * Called from `recordMatch`, beside the achievement tally, because both are
 * accumulators over finished matches and both must be credited exactly once —
 * at the same moment, from the same evidence.
 */
function creditEvents(draft: PlayerProfile, outcome: MatchOutcome, now: number): void {
  const block = eventBlock(draft);
  for (const event of liveEvents(now)) {
    const before = eventStateFor(block.state, event.id);
    const after = creditMatchToEvent(event, before, outcome, now);
    if (after !== before) block.state[event.id] = after;
  }
}

export interface EventClaim {
  /** event currency paid */
  paid: number;
  currencyName: string;
  /** the completion cosmetic, if this claim was the one that earned it */
  completionCosmeticId: string | null;
}

/**
 * Take a completed event mission's reward.
 *
 * Returns null when there was nothing to claim, so a double-click pays once.
 * The completion meta-reward is granted here rather than on a later visit: a
 * reward that waits for you to come back and look at it is a reward that can be
 * missed, which is the one thing §14 says events must never be.
 */
export function claimEventMission(eventId: string, missionId: string): EventClaim | null {
  const event = eventById(eventId);
  if (!event) return null;

  let result: EventClaim | null = null;
  profileStore.update((draft) => {
    const block = eventBlock(draft);
    const before = eventStateFor(block.state, eventId);
    const { state, paid } = claimEventMissionPure(event, before, missionId);
    if (paid <= 0) return;

    let next = state;
    let completionCosmeticId: string | null = null;
    if (!next.completionGranted && eventCompletionEarned(event, next)) {
      next = { ...next, completionGranted: true };
      completionCosmeticId = event.completion.cosmeticId;
      if (!draft.cosmetics.owned.includes(completionCosmeticId)) {
        draft.cosmetics.owned.push(completionCosmeticId);
      }
    }
    block.state[eventId] = next;
    result = { paid, currencyName: event.currency.name, completionCosmeticId };
  });
  return result;
}

export interface EventPurchase {
  entryName: string;
  problem: string | null;
}

/**
 * Buy one row from an event's shop.
 *
 * The event module moves the event's own currency; the payout lands here,
 * because Clout, Signal, Drops and the cosmetic wardrobe all belong to the
 * profile and granting them from inside the events module would give each of
 * them a second owner.
 */
export function buyEventItem(eventId: string, entryId: string, now = Date.now()): EventPurchase {
  const event = eventById(eventId);
  if (!event) return { entryName: "", problem: "no such event" };

  let outcome: EventPurchase = { entryName: "", problem: "nothing happened" };
  profileStore.update((draft) => {
    const block = eventBlock(draft);
    const { state, entry, problem } = buyEventEntry(event, eventStateFor(block.state, eventId), entryId, now);
    if (!entry) {
      outcome = { entryName: "", problem: problem ?? "unavailable" };
      return;
    }

    switch (entry.kind) {
      case "cosmetic":
        if (!draft.cosmetics.owned.includes(entry.ref)) draft.cosmetics.owned.push(entry.ref);
        break;
      case "clout":
        draft.clout += entry.amount;
        break;
      case "signal":
        draft.shards += entry.amount;
        break;
      case "drops":
        draft.pendingDrops += entry.amount;
        break;
    }
    block.state[eventId] = state;
    outcome = { entryName: entry.name, problem: null };
  });
  return outcome;
}

/**
 * Pay out the leftovers of every run that has ended since anyone last looked.
 *
 * 07 §3: *"Event currency never expires into nothing: when an event ends,
 * leftover event currency auto-converts to Clout at 1 : 5, logged in the
 * inbox."* Auto is the load-bearing word — this runs on load and whenever the
 * hub opens, so the payout does not wait for the player to notice it is owed.
 *
 * The conversions are recorded on the event's state, and the inbox **derives**
 * its receipt from them rather than being handed a message to store, which is
 * how every other sender in that screen works.
 */
export function settleEvents(now = Date.now()): EventConversion[] {
  const settled: EventConversion[] = [];
  profileStore.update((draft) => {
    const block = eventBlock(draft);
    for (const event of allEvents()) {
      const before = eventStateFor(block.state, event.id);
      const owed = pendingEventConversion(event, before, now);
      if (!owed) continue;
      block.state[event.id] = applyEventConversion(before, owed);
      draft.clout += owed.clout;
      settled.push(owed);
    }
  });
  return settled;
}

// ---------------------------------------------------------------------------
// The Remix Queue's weekly quest — 09 §12
// ---------------------------------------------------------------------------

/** The remix block, normalised for a save written before it existed. */
function remixBlock(draft: PlayerProfile): PlayerProfile["remix"] {
  draft.remix ??= { week: -1, wins: 0, claimedWeek: -1 };
  return draft.remix;
}

export interface RemixWin {
  wins: number;
  required: number;
  clout: number;
  /** true when this win was the one that finished the quest */
  justCompleted: boolean;
}

/**
 * Count a won Remix match toward the week's quest, paying it when it completes.
 *
 * The counter **resets by comparison, not by a timer**: a stored `week` that is
 * not this week means the wins belong to a week that has passed, so they start
 * again from zero. Nothing has to run at midnight on Monday, and an account left
 * closed for a month comes back to a clean quest rather than a stale one.
 *
 * §12 pays Clout for it. The weekly-exclusive emote it also promises is in
 * `DEFERRED_REMIX` with its reason — an emote is a phrase somebody has to write,
 * and inventing one per week would be ten cosmetics a year with no design behind
 * them.
 */
export function recordRemixWin(now = Date.now()): RemixWin {
  const { questWinsRequired, questClout } = remixData();
  const week = remixWeekIndex(now);
  let result: RemixWin = { wins: 0, required: questWinsRequired, clout: questClout, justCompleted: false };

  profileStore.update((draft) => {
    const block = remixBlock(draft);
    if (block.week !== week) {
      block.week = week;
      block.wins = 0;
    }
    const before = block.wins;
    block.wins += 1;

    // paid the moment it completes, once, and never again this week
    const justCompleted =
      before < questWinsRequired && block.wins >= questWinsRequired && block.claimedWeek !== week;
    if (justCompleted) {
      block.claimedWeek = week;
      draft.clout += questClout;
    }
    result = { wins: block.wins, required: questWinsRequired, clout: questClout, justCompleted };
  });

  return result;
}

/** This week's quest, as the Remix screen draws it. */
export function remixQuestView(now = Date.now()): RemixQuest {
  const profile = getProfile();
  const block = profile.remix ?? { week: -1, wins: 0, claimedWeek: -1 };
  // wins banked in a previous week are not this week's progress
  const wins = block.week === remixWeekIndex(now) ? block.wins : 0;
  return remixQuest(wins, block.claimedWeek, now);
}

// ---------------------------------------------------------------------------
// The two bonus dailies — 09 §11
// ---------------------------------------------------------------------------

/** The dailies block, normalised for a save written before it existed. */
function dailiesBlock(draft: PlayerProfile): PlayerProfile["dailies"] {
  draft.dailies ??= { puzzleDay: -1, doomscrollDay: -1, packsPaid: 0 };
  return draft.dailies;
}

/** Which puzzle today's Daily Puzzle is, for this account. */
export function todaysPuzzleIndex(puzzleCount: number, now = Date.now()): number {
  return dailyPuzzleIndex(now, getProfile().createdAt || 1, puzzleCount);
}

/** Today's shared Doomscroll seed — the same run for every account. */
export const todaysDoomscrollSeed = (now = Date.now()): number => dailyDoomscrollSeed(now);

export interface BonusDailyView {
  puzzleDone: boolean;
  doomscrollDone: boolean;
  puzzleClout: number;
  doomscrollClout: number;
  doomscrollXp: number;
  progress: DailyBonusProgress;
}

/** Both bonus slots and the pack counter, as the missions screen draws them. */
export function bonusDailies(content: ContentIndex, now = Date.now()): BonusDailyView {
  const profile = getProfile();
  const block = profile.dailies ?? { puzzleDay: -1, doomscrollDay: -1, packsPaid: 0 };
  const today = dayNumber(now);
  const puzzle = dailyPuzzleReward(content);
  const doomscroll = dailyDoomscrollReward(content);
  return {
    puzzleDone: block.puzzleDay === today,
    doomscrollDone: block.doomscrollDay === today,
    puzzleClout: puzzle.clout,
    doomscrollClout: doomscroll.clout,
    doomscrollXp: doomscroll.xp,
    progress: dailyBonusProgress(content, profile.missions?.dailiesCompleted ?? 0, block.packsPaid),
  };
}

export interface BonusDailyPaid {
  clout: number;
  xp: number;
  /** Merch Drops handed over because this completion crossed a multiple of seven */
  drops: number;
}

/**
 * Pay a bonus daily, once per day.
 *
 * Returns null when today's slot is already filled, so a second completion pays
 * nothing rather than paying again — the same shape `claimOnce` uses everywhere
 * else, and the reason a puzzle you replay for fun cannot farm Clout.
 *
 * The pack is settled in the same update, because §11 attaches it to completing
 * dailies and a reward that waits for the player to open a screen is a reward
 * that can be missed.
 */
function payBonusDaily(
  content: ContentIndex,
  slot: "puzzleDay" | "doomscrollDay",
  reward: DailyBonusReward,
  now: number
): BonusDailyPaid | null {
  const today = dayNumber(now);
  let paid: BonusDailyPaid | null = null;

  profileStore.update((draft) => {
    const block = dailiesBlock(draft);
    if (block[slot] === today) return;
    block[slot] = today;

    draft.clout += reward.clout;
    if (reward.xp > 0) awardXp(draft, reward.xp, now);

    // it counts as a daily, so it counts toward the pack every seven
    draft.missions.dailiesCompleted = (draft.missions.dailiesCompleted ?? 0) + 1;
    const progress = dailyBonusProgress(content, draft.missions.dailiesCompleted, block.packsPaid);
    if (progress.owed > 0) {
      draft.pendingDrops += progress.owed;
      block.packsPaid += progress.owed;
    }

    paid = { clout: reward.clout, xp: reward.xp, drops: progress.owed };
  });

  return paid;
}

/** §11's Daily Puzzle. Pays only for *today's* puzzle, and only the first time. */
export function completeDailyPuzzle(
  content: ContentIndex,
  puzzleIndex: number,
  puzzleCount: number,
  now = Date.now()
): BonusDailyPaid | null {
  if (puzzleIndex !== todaysPuzzleIndex(puzzleCount, now)) return null;
  return payBonusDaily(content, "puzzleDay", dailyPuzzleReward(content), now);
}

/**
 * §11's Daily Doomscroll. Pays only for a run started from today's shared seed.
 *
 * Checking the seed is what makes it *the daily* rather than *a* run: a player
 * who starts an ordinary Doomscroll run has not done the daily, and one who
 * finishes today's has, whichever route they came in by.
 */
export function completeDailyDoomscroll(
  content: ContentIndex,
  runSeed: number,
  now = Date.now()
): BonusDailyPaid | null {
  if ((runSeed >>> 0) !== todaysDoomscrollSeed(now)) return null;
  return payBonusDaily(content, "doomscrollDay", dailyDoomscrollReward(content), now);
}

/**
 * Hand over any packs owed for dailies already completed.
 *
 * The ordinary mission-claim path does not know about the pack, and back-filling
 * it here means an account that completed dailies before this shipped is paid
 * what it earned rather than starting the count from today.
 */
export function settleDailyBonus(content: ContentIndex): number {
  let handed = 0;
  profileStore.update((draft) => {
    const block = dailiesBlock(draft);
    const progress = dailyBonusProgress(content, draft.missions?.dailiesCompleted ?? 0, block.packsPaid);
    if (progress.owed <= 0) return;
    draft.pendingDrops += progress.owed;
    block.packsPaid += progress.owed;
    handed = progress.owed;
  });
  return handed;
}
