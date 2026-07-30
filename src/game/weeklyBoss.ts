/**
 * Weekly Boss rotation and difficulty tiers.
 *
 * The rotation is derived from the ISO week number rather than stored, so every
 * client shows the same boss on the same day without a server telling them —
 * and the same function will keep agreeing once one exists.
 *
 * A boss's rule twist is a passive on its leader card, expressed in the ordinary
 * effect DSL. Nothing here special-cases a boss: the difficulty tiers are an AI
 * profile, a `balanceOverrides` map and a `leaderHealth` setup op, all of which
 * the engine already understood.
 */

import type { AiDifficulty, EncounterSetup, MatchConfig } from "../engine/types";

export interface BossDef {
  id: string;
  leaderCardId: string;
  /** faction whose starter deck the boss plays */
  deckLeaderCardId: string;
  name: string;
  twistName: string;
  twistText: string;
}

/**
 * All ten faction bosses from `docs/design/09-game-modes.md` §9.8.
 *
 * Every twist is a passive on the boss's own leader card, written in the same
 * effect DSL as any other card — nothing here special-cases a boss. Eight of
 * them waited on ops the DSL did not have (cancel a defeat, rotate a leader's
 * Current, banish the costliest character, watch the opponent's draws, decide
 * which of two cards they draw); those ops now exist and are used by ordinary
 * cards' rules too, rather than being boss-shaped hooks.
 */
export const BOSSES: BossDef[] = [
  {
    id: "dj-last-call",
    leaderCardId: "boss-dj-last-call",
    deckLeaderCardId: "after-leader-half-four-mari",
    name: "DJ Last Call",
    twistName: "Encore Set",
    // `repeatAfterpartyThisTurn` sets the flag on its own controller, and
    // Afterparty is an end-of-YOUR-turn trigger, so this doubles the boss's
    // Afterparty triggers and not the player's. The old wording ("the boss's and
    // yours") described a trigger-scoping bug rather than the rule.
    twistText: "Every Afterparty trigger the boss has fires twice.",
  },
  {
    id: "prisma-final-encore",
    leaderCardId: "boss-prisma-final-encore",
    deckLeaderCardId: "idols-lumi-starcall",
    name: "Prisma, the Final Encore",
    twistName: "Standing Ovation",
    twistText: "While the boss holds three or more characters, every one of them has +1 attack.",
  },
  {
    id: "widow-dead-fandoms",
    leaderCardId: "boss-widow-dead-fandoms",
    deckLeaderCardId: "goth-leader-morvina-vane",
    name: "The Widow of Dead Fandoms",
    twistName: "The Vigil",
    twistText:
      "The first character the boss loses each turn stands back up at 1 health, keeping its buffs. Kill the same body twice, or kill two.",
  },
  {
    id: "king-ratio",
    leaderCardId: "boss-king-ratio",
    deckLeaderCardId: "viral-leader-blayze-trendall",
    name: "King Ratio",
    twistName: "Engagement Farming",
    twistText:
      "At the start of the boss turn he summons a 1/1 Follower for every card you played on your last turn. Dumping your hand feeds him.",
  },
  {
    id: "executive-producer",
    leaderCardId: "boss-executive-producer",
    deckLeaderCardId: "corp-leader-cressida-vale",
    name: "The Executive Producer",
    twistName: "Quarterly Targets",
    twistText: "The boss gains 1 max Hype at the start of each of her turns, up to 10 — so her Hype grows twice as fast as yours.",
  },
  {
    id: "glitchlord-exe",
    leaderCardId: "boss-glitchlord-exe",
    deckLeaderCardId: "demon-leader-ashvyre-dropped-frames",
    name: "GLITCHLORD_EXE",
    twistName: "Corrupted Feed",
    twistText: "Every third card you draw costs (1) more. The running count is public — it is the Corrupted Feed counter on your side.",
  },
  {
    /**
     * Tide, deliberately, and not this faction's other Current.
     *
     * Prism has no elemental advantage, so it has no next step on the cycle and a
     * Prism Grand Cosplayer would rotate nowhere — the twist would be a line of
     * card text with nothing behind it. Tide sits on the five-Current cycle
     * (tide → cinder → gale → root → pulse → tide) and visits all of it.
     */
    id: "grand-cosplayer",
    leaderCardId: "boss-grand-cosplayer",
    deckLeaderCardId: "cosplay-kiko-thousand-faces",
    name: "The Grand Cosplayer",
    twistName: "Quick Change",
    twistText:
      "The boss's Current rotates one step along the advantage cycle at the start of each of their turns, moving the elemental bonus on their leader around the table.",
  },
  {
    id: "groundskeeper",
    leaderCardId: "boss-groundskeeper",
    deckLeaderCardId: "grass-leader-rhett-halloran",
    name: "The Groundskeeper",
    twistName: "Log Off",
    twistText:
      "At the start of the boss turn your costliest character is Banished until your next turn, and comes back stripped of buffs and statuses.",
  },
  {
    /**
     * "The boss chooses which you draw" without stopping the game to ask.
     *
     * A genuine prompt would need the engine to suspend a turn mid-resolution and
     * wait on the other seat — and against an AI it would be a pause with no
     * visible decision behind it. The published rule is applied identically every
     * time and can be read off the board, which is the part that matters.
     */
    id: "the-recommendation",
    leaderCardId: "boss-the-recommendation",
    deckLeaderCardId: "algo-leader-cassia-cache",
    name: "The Recommendation",
    twistName: "The Feed Decides",
    twistText:
      "At the start of your turn it reads your top two cards and buries the one you could cast this turn, so you draw the other. If you could cast neither, it buries the cheaper.",
  },
  {
    id: "living-meme",
    leaderCardId: "boss-living-meme",
    deckLeaderCardId: "meme-leader-chairperson-nobody",
    name: "The Living Meme",
    twistName: "Dead Meme Cycle",
    twistText:
      "At the start of the boss turn one of five old bits resurfaces, each exactly 1 in 5: a Follower, +1 attack to its board, 2 damage to one of yours, a card, or Weakened 1.",
  },
];

export type BossDifficulty = "normal" | "nightmare" | "impossible";

export interface BossTier {
  id: BossDifficulty;
  label: string;
  blurb: string;
  ai: AiDifficulty;
  clout: number;
  /** extra leader health, applied as a setup op — NOT a balance override */
  bonusHealth: number;
  balanceOverrides?: Record<string, number>;
}

export const BOSS_TIERS: BossTier[] = [
  {
    id: "normal",
    label: "Normal",
    blurb: "Advanced AI. The twist, as written.",
    ai: "advanced",
    clout: 50,
    bonusHealth: 0,
  },
  {
    id: "nightmare",
    label: "Nightmare",
    blurb: "Expert AI, and the boss draws harder.",
    ai: "expert",
    clout: 100,
    bonusHealth: 0,
    // the boss's pressure comes from cards, so the twist bites sooner
    balanceOverrides: { "draw.perTurn": 2 },
  },
  {
    id: "impossible",
    label: "Impossible",
    blurb: "Boss AI, +10 boss health, and a bigger board to fill.",
    ai: "boss",
    clout: 150,
    bonusHealth: 10,
    balanceOverrides: { "draw.perTurn": 2 },
  },
];

/**
 * ISO-week index since the epoch. Deterministic, timezone-stable enough for a
 * weekly rotation, and identical on every client.
 */
export function weekIndex(now: number): number {
  return Math.floor(now / (7 * 24 * 60 * 60 * 1000));
}

export function bossForWeek(now: number): BossDef {
  return BOSSES[weekIndex(now) % BOSSES.length]!;
}

/**
 * A specific boss by id, falling back to this week's.
 *
 * The rotation is the product feature; this is how anything that needs to reach
 * a *particular* boss does so. Without it the browser verification can only ever
 * exercise whichever boss today happens to land on — one in ten, chosen by the
 * calendar — so nine of them would go unrendered until their week came round.
 */
export function bossById(id: string | null | undefined, now: number): BossDef {
  return BOSSES.find((b) => b.id === id) ?? bossForWeek(now);
}

export function tierById(id: string): BossTier {
  return BOSS_TIERS.find((t) => t.id === id) ?? BOSS_TIERS[0]!;
}

/**
 * The scenario a boss fight is dealt with.
 *
 * Only the boss's extra health is scripted — everything else is a normal match,
 * so the fight is played with the player's real deck and a real mulligan. Note
 * that "+10 boss health" is deliberately NOT a balance override: leader health
 * comes from the leader card, and `leader.startingHealth` would raise BOTH
 * players' health.
 */
export function bossScenario(tier: BossTier, bossSeat: 0 | 1 = 1): EncounterSetup | undefined {
  if (tier.bonusHealth <= 0) return undefined;
  const total = 30 + tier.bonusHealth;
  return { setup: [{ op: "leaderHealth", seat: bossSeat, value: total, max: total }] };
}

/** The key a first-clear reward is recorded under, one per boss per tier per week. */
export function clearKey(boss: BossDef, tier: BossTier, now: number): string {
  return `boss:${boss.id}:${tier.id}:w${weekIndex(now)}`;
}

/** Everything the battle screen needs, assembled. */
export function bossMatchConfig(
  tier: BossTier,
  seed: number
): Pick<MatchConfig, "balanceOverrides"> & { scenario?: EncounterSetup; seed: number } {
  return {
    seed,
    ...(tier.balanceOverrides ? { balanceOverrides: tier.balanceOverrides } : {}),
    ...(bossScenario(tier) ? { scenario: bossScenario(tier)! } : {}),
  };
}
