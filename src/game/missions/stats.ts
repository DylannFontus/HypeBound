/**
 * What one player did in one match, derived from the match record.
 *
 * Missions ask questions like "defeat 8 enemy characters" and "restore 10 health
 * to friendly characters", and the answers are not in the profile — they are in
 * the match. This module reads them out of the **replayed event stream**, which
 * is the one source every mode already produces: a `MatchRecord` is
 * `{config, intents[]}` and `replay()` rebuilds the whole match from it.
 *
 * Three consequences of doing it this way rather than by listening to the live
 * match, which is the obvious alternative:
 *
 * - **One code path for every mode.** The tutorial, puzzles, the Doomscroll, a
 *   story battle and an ordinary practice match all produce a record. Anything
 *   that hooks the battle screen instead would quietly miss the modes that do
 *   not use it, and would miss them *silently*.
 * - **It is re-derivable.** A mission claim can be audited the same way a Merch
 *   Drop's opening history can — re-run the record and check the number. That is
 *   what the future authoritative server needs in order to sign it.
 * - **No UI coupling.** Nothing here touches the DOM, the clock or storage.
 *
 * ## Whose event is it anyway
 *
 * Most engine events carry a `seat`, but the interesting ones — `damageDealt`,
 * `healed`, `characterDefeated`, `statusApplied` — carry a **target** instead,
 * because that is what the rules care about. Rather than guess an actor from
 * whose turn it is, this counts by target wherever the objective allows:
 * "damage to enemy leaders" is damage whose target is the other leader, and
 * "healing to friendly characters" is healing whose target is one of yours. That
 * is exact, and it does not care whether the effect came from an attack, a card,
 * a Confluence or a Reaction fired on the opponent's turn.
 *
 * Resolving a character target to its controller needs an instance map, which is
 * built from the opening board and maintained across summons, waves, revivals,
 * banish returns and transformations.
 */

import type {
  CardDef,
  ContentIndex,
  CurrentId,
  EngineEvent,
  MatchRecord,
  Seat,
  TargetRef,
} from "../../engine/types";
import { createMatch } from "../../engine/state";
import { replay } from "../../engine/replay";
import { resolveMatchContent } from "../../engine/content";
import { affinityConfig } from "../progression/data";

/** Everything a mission objective is allowed to ask about one match. */
export interface MatchStats {
  /** the seat these numbers describe */
  seat: Seat;
  won: boolean;
  /** the leader this seat played, and what it belongs to */
  leaderCardId: string;
  factionId: string;
  primaryCurrent: CurrentId;
  secondaryCurrent: CurrentId | null;

  cardsPlayed: number;
  cardsDrawn: number;
  charactersDefeated: number;
  damageToEnemyLeader: number;
  healingToFriendlies: number;
  supportsGiven: number;
  confluencesActivated: number;
  perfectResonances: number;
  obsessionGained: number;
  fixationsUsed: number;
  ultimatesUsed: number;
  elementalBonusHits: number;
  afterpartyTriggers: number;
  equipmentPlayed: number;
  expensiveCardsPlayed: number;
  cancelledApplied: number;
  negativeStatusesCleared: number;
  /** the largest number of cards of any one Current played this match */
  mostOfOneCurrent: number;

  // --- feats, for achievements (§9) ----------------------------------------
  /**
   * These are read by achievements rather than by missions, and they are here
   * rather than in a second deriver for one reason: they are answers to the same
   * walk over the same events. A separate `readFeats` would mean replaying every
   * finished match twice, and would eventually disagree with this one about what
   * "damage to the enemy leader" means.
   *
   * They are deliberately *not* in `SumStat`. Missions may only ask about things
   * a mission actually asks about, and adding eleven statistics no mission reads
   * would be eleven entries of dead vocabulary in the objective language.
   */
  /** times this seat reached Full Fixation (Obsession 10) */
  fullFixations: number;
  /** enemy characters banished — the Touch-Grass Order's whole idea */
  charactersBanished: number;
  /** damage this seat's own leader took, from any source */
  leaderDamageTaken: number;
  /** fatigue damage this seat took, which only happens with an empty deck */
  fatigueTaken: number;
  /** this seat's set Reactions that fired */
  reactionsTriggered: number;
  /** total damage dealt to the other side by elemental advantage */
  elementalBonusDamage: number;
  /** the most damage dealt to the enemy leader inside one turn */
  mostLeaderDamageInATurn: number;
  /** the fullest this seat's board ever got — 0 unless the match was won */
  widestWinningBoard: number;
  /** 1 when the match was won with this seat's leader untouched */
  flawlessWin: number;
  /** 1 when the match was won after being decked */
  burnoutWin: number;
  /** 1 when the match was won without defeating a single enemy character */
  shutoutWin: number;
  /**
   * The highest Obsession this seat reached.
   *
   * Not a feat — the statistics dashboard prints it per match and averages it
   * per deck, because "how high does this deck actually get" is the question
   * Obsession-payoff cards are built around and the one a player cannot answer
   * by feel.
   */
  peakObsession: number;
  /**
   * The distinct Confluences this seat activated.
   *
   * The ids rather than a count, because *Weather Machine* asks for all nine and
   * a count cannot tell nine different ones from the same one nine times.
   */
  confluencesUsed: string[];
}

/**
 * Affinity Points earned per character card in one match — the Bias Board.
 *
 * `08-progression.md` §6.1. Keyed by **card id, not instance**, because affinity
 * is a relationship with a character rather than with one copy of it: playing
 * two copies of the same character is two lots of devotion to the same person.
 * Capping happens here rather than in the save layer, so the number that reaches
 * the accumulator is already the number §6.1 promises.
 */
export type MatchAffinity = Record<string, number>;

/** What one replay produces. Missions read the stats; the Bias Board reads the AP. */
export interface MatchReading {
  stats: MatchStats;
  affinity: MatchAffinity;
}

/** A card costing at least this much counts as "expensive" (daily 15). */
export const EXPENSIVE_COST = 6;

/** Statuses that count as a downside when cleared from a friendly character. */
const NEGATIVE_STATUSES = new Set(["scorched", "weakened", "cancelled", "spotlight"]);

/** Statuses that count as *supporting* a friendly character when applied. */
const SUPPORT_STATUSES = new Set(["shielded"]);

/**
 * A zeroed reading for one seat.
 *
 * Exported so fixtures can spread it rather than restating thirty fields — a
 * literal that has to be edited every time the deriver learns something new is
 * a test that fails for reasons that have nothing to do with what it checks.
 */
export const emptyStats = (seat: Seat): MatchStats => ({
  seat,
  won: false,
  leaderCardId: "",
  factionId: "",
  primaryCurrent: "prism",
  secondaryCurrent: null,
  cardsPlayed: 0,
  cardsDrawn: 0,
  charactersDefeated: 0,
  damageToEnemyLeader: 0,
  healingToFriendlies: 0,
  supportsGiven: 0,
  confluencesActivated: 0,
  perfectResonances: 0,
  obsessionGained: 0,
  fixationsUsed: 0,
  ultimatesUsed: 0,
  elementalBonusHits: 0,
  afterpartyTriggers: 0,
  equipmentPlayed: 0,
  expensiveCardsPlayed: 0,
  cancelledApplied: 0,
  negativeStatusesCleared: 0,
  mostOfOneCurrent: 0,
  fullFixations: 0,
  charactersBanished: 0,
  leaderDamageTaken: 0,
  fatigueTaken: 0,
  reactionsTriggered: 0,
  elementalBonusDamage: 0,
  mostLeaderDamageInATurn: 0,
  widestWinningBoard: 0,
  flawlessWin: 0,
  burnoutWin: 0,
  shutoutWin: 0,
  peakObsession: 0,
  confluencesUsed: [],
});

/**
 * Read one seat's contribution out of a finished match.
 *
 * Everything a mission asks about, plus the Affinity Points the Bias Board
 * awards — **one replay, two products**. They are derived together because they
 * are answers to the same walk over the same events, and replaying a match twice
 * to ask two questions about it would double the cost of finishing a match for
 * no benefit whatsoever.
 *
 * `record` is what `recordMatch` already stores, so nothing new has to be
 * captured at play time. A record that fails to replay cleanly still produces
 * what did replay — a mission should not silently stop counting because one
 * intent in a long match no longer applies.
 */
export function readMatch(record: MatchRecord, baseContent: ContentIndex, seat: Seat): MatchReading {
  const content = resolveMatchContent(
    baseContent,
    record.config.balanceOverrides,
    record.config.cardOverrides,
    record.config.cardVariants
  );
  const stats = emptyStats(seat);

  const leaderCardId = record.config.decks[seat]?.leaderCardId ?? "";
  const leader = content.leaders[leaderCardId];
  stats.leaderCardId = leaderCardId;
  stats.factionId = leader?.faction ?? "";
  stats.primaryCurrent = leader?.primaryCurrent ?? "prism";
  stats.secondaryCurrent = leader?.secondaryCurrent ?? null;

  // --- feats (§9) -----------------------------------------------------------
  /**
   * My characters currently standing, so *Sold-Out Show* can be answered with a
   * peak rather than a guess. Declared before the opening board is dealt because
   * that is where it is first written to — a scripted encounter puts most of its
   * characters on the table through setup ops, which emit no events at all.
   */
  const onBoard = new Set<string>();
  let peakBoard = 0;
  const arrive = (instanceId: string, controller: Seat): void => {
    if (controller !== seat) return;
    onBoard.add(instanceId);
    peakBoard = Math.max(peakBoard, onBoard.size);
  };
  const leave = (instanceId: string): void => {
    onBoard.delete(instanceId);
  };
  /** damage to the enemy leader inside the current turn, for *Ratio'd Into Orbit* */
  let leaderDamageThisTurn = 0;
  /**
   * The Obsession this seat starts on, read from the opening position.
   *
   * Not assumed to be zero, and not left unknown. An ordinary match does start
   * at zero, but a puzzle or story battle can be dealt with Obsession already on
   * the clock through a setup op — and setup ops emit no events, so the event
   * stream alone cannot tell the two apart.
   *
   * Seeding from the opening fixes a real undercount in `obsessionGained`, which
   * the "gain N Obsession" daily reads: `lastObsession` used to start as `null`,
   * so the *first* change was recorded as a baseline rather than counted. A match
   * whose Obsession went 0 → 2 → 5 was credited with 3 rather than 5.
   */
  let openingObsession = 0;
  const closeTurn = (): void => {
    stats.mostLeaderDamageInATurn = Math.max(stats.mostLeaderDamageInATurn, leaderDamageThisTurn);
    leaderDamageThisTurn = 0;
  };
  const confluences = new Set<string>();

  /**
   * Who controls each character instance.
   *
   * Seeded from the opening board, because a scripted encounter deals characters
   * through setup ops rather than through events — so an events-only map would
   * be blind to every character a puzzle or story battle starts with, which is
   * most of them.
   */
  const controllerOf = new Map<string, Seat>();
  /**
   * Which card each instance is a copy of.
   *
   * Affinity is a relationship with a *character*, not with an instance, so
   * every AP award has to be resolved back to a card id — including the ones the
   * events describe by instance, which is all the support verbs.
   */
  const cardOf = new Map<string, string>();
  try {
    const opening = createMatch(record.config, content);
    openingObsession = opening.players[seat]?.obsession ?? 0;
    for (const player of opening.players) {
      for (const character of player.board) {
        if (character) {
          controllerOf.set(character.instanceId, character.controller);
          cardOf.set(character.instanceId, character.cardId);
          arrive(character.instanceId, character.controller);
        }
      }
    }
  } catch {
    // a config that cannot be dealt produces nothing rather than throwing
    return { stats, affinity: {} };
  }

  const { events } = replay(record, baseContent);

  const mine = (target: TargetRef): boolean =>
    target.kind === "leader" ? target.seat === seat : controllerOf.get(target.instanceId) === seat;
  const enemy = (target: TargetRef): boolean =>
    target.kind === "leader" ? target.seat !== seat : controllerOf.get(target.instanceId) === (1 - seat);

  const currentCounts = new Map<CurrentId, number>();
  let lastObsession: number = openingObsession;
  stats.peakObsession = openingObsession;
  /** the seat whose turn it is, for the few events with no other attribution */
  let activeSeat: Seat = record.config.firstSeat ?? 0;

  // --- affinity (§6.1) ------------------------------------------------------
  const ap = affinityConfig();
  const affinity: MatchAffinity = {};
  /**
   * The card a Bias Board entry belongs to, or null for anything that has no
   * entry to belong to.
   *
   * Tokens are excluded because the Bias Board is drawn from the collection and
   * a Follower token is not in it — AP banked against one could never be shown
   * to the player, which is the same invisible-reward problem the deferred
   * cosmetics avoid, only stored in the save file forever. Premium variants fold
   * into the card they are a variant of, so devotion to a character does not
   * split in two the day somebody is granted a shiny copy of it.
   */
  const canonicalOf = (cardId: string | undefined): string | null => {
    if (!cardId) return null;
    const card = content.cards[cardId];
    if (!card || card.token) return null;
    return card.variantOf ?? card.id;
  };
  const award = (cardId: string | null, points: number): void => {
    if (!cardId || points <= 0) return;
    affinity[cardId] = (affinity[cardId] ?? 0) + points;
  };
  /** cards I played this match, for the win bonus §6.1 pays at the end */
  const played = new Set<string>();
  /**
   * Support verbs land on an instance; only my characters earn from them.
   *
   * The controller check is redundant for `healed`, `buffApplied` and
   * `statusApplied`, whose call sites already test `mine(target)`. It is not
   * redundant for `equipped`, which carries the seat that *played* the equipment
   * rather than the controller of the character it landed on — so this is the
   * only thing standing between an effect that equips across the table and a
   * player earning devotion to somebody else's character.
   */
  const supported = (instanceId: string): void => {
    if (controllerOf.get(instanceId) === seat) award(canonicalOf(cardOf.get(instanceId)), ap.ap.support);
  };

  for (const event of events) {
    switch (event.e) {
      case "turnStarted":
        activeSeat = event.seat;
        // the tally is per turn, so it closes at every turn boundary rather
        // than only at mine — a Reaction that fires on the opponent's turn
        // belongs to that turn, not to the one before it
        closeTurn();
        break;

      case "characterSummoned":
        controllerOf.set(event.instance.instanceId, event.instance.controller);
        cardOf.set(event.instance.instanceId, event.instance.cardId);
        arrive(event.instance.instanceId, event.instance.controller);
        break;
      case "waveArrived":
        for (const instance of event.instances) {
          controllerOf.set(instance.instanceId, instance.controller);
          cardOf.set(instance.instanceId, instance.cardId);
          arrive(instance.instanceId, instance.controller);
        }
        break;
      case "characterResurrected":
      case "characterReturnedFromBanish":
        controllerOf.set(event.instance.instanceId, event.instance.controller);
        cardOf.set(event.instance.instanceId, event.instance.cardId);
        arrive(event.instance.instanceId, event.instance.controller);
        break;
      case "characterTransformed":
        controllerOf.set(event.instance.instanceId, event.instance.controller);
        // one body, one slot: the old instance id stops existing
        leave(event.oldInstanceId);
        arrive(event.instance.instanceId, event.instance.controller);
        /**
         * A transformed instance is a different character now, so affinity
         * follows the new card. The old one keeps whatever it earned before the
         * transformation, which is the honest reading of "play the character".
         */
        cardOf.set(event.instance.instanceId, event.instance.cardId);
        break;

      case "cardPlayed": {
        if (event.seat !== seat) break;
        stats.cardsPlayed += 1;
        const card: CardDef | undefined = content.cards[event.cardId];
        if (!card) break;
        // the PRINTED cost, not what was paid: "cards that cost (6) or more" is
        // a fact about the card, and a Trending discount does not change it
        if (card.cost >= EXPENSIVE_COST) stats.expensiveCardsPlayed += 1;
        if (card.type === "equipment") stats.equipmentPlayed += 1;
        currentCounts.set(card.current, (currentCounts.get(card.current) ?? 0) + 1);
        if (card.type === "character") {
          const canonical = canonicalOf(card.id);
          if (canonical) {
            award(canonical, ap.ap.play);
            played.add(canonical);
          }
        }
        break;
      }

      case "cardDrawn":
        if (event.seat === seat) stats.cardsDrawn += 1;
        break;

      case "characterDefeated":
        if (event.instance.controller !== seat) stats.charactersDefeated += 1;
        leave(event.instance.instanceId);
        break;

      case "characterBanished":
        /**
         * *Log Off Speedrun* — "banish 25 characters with Touch Grass effects".
         *
         * The event carries no source, so what is counted is enemy characters
         * that left the table by banishment. The only way to get credit you did
         * not earn is for the opponent to banish one of their *own* characters,
         * which no shipped card does for value. Counting by whose turn it is
         * instead would have been worse in the other direction: it would drop
         * every banish fired by a Reaction on the opponent's turn, which is a
         * large fraction of the Touch-Grass Order's actual play pattern.
         */
        if (controllerOf.get(event.instanceId) === (1 - seat)) stats.charactersBanished += 1;
        leave(event.instanceId);
        break;

      case "characterReturnedToHand":
        leave(event.instanceId);
        break;

      case "damageDealt":
        if (event.target.kind === "leader" && event.target.seat !== seat) {
          stats.damageToEnemyLeader += event.amount;
          leaderDamageThisTurn += event.amount;
        }
        if (event.target.kind === "leader" && event.target.seat === seat) {
          stats.leaderDamageTaken += event.amount;
        }
        // an elemental bonus landing on the other side of the table is one you
        // dealt; counting by target avoids attributing damage by whose turn it is
        if (event.elementalBonus && enemy(event.target)) {
          stats.elementalBonusHits += 1;
          stats.elementalBonusDamage += event.amount;
        }
        break;

      case "fatigueDamage":
        // fatigue only happens to a player drawing from an empty deck, which is
        // the definition of Burnout — so this is what *Running on Vibes* reads
        if (event.seat === seat) stats.fatigueTaken += event.amount;
        break;

      case "reactionTriggered":
        if (event.seat === seat) stats.reactionsTriggered += 1;
        break;

      case "fullFixation":
        if (event.seat === seat) stats.fullFixations += 1;
        break;

      case "healed":
        if (!event.blocked && mine(event.target)) {
          stats.healingToFriendlies += event.amount;
          if (event.target.kind === "character") {
            stats.supportsGiven += 1;
            supported(event.target.instanceId);
          }
        }
        break;

      case "buffApplied":
        if (mine(event.target) && event.target.kind === "character") {
          stats.supportsGiven += 1;
          supported(event.target.instanceId);
        }
        break;

      case "equipped":
        if (event.seat === seat) {
          stats.supportsGiven += 1;
          supported(event.characterInstanceId);
        }
        break;

      case "statusApplied":
        if (SUPPORT_STATUSES.has(event.status.id) && mine(event.target)) {
          stats.supportsGiven += 1;
          if (event.target.kind === "character") supported(event.target.instanceId);
        }
        if (event.status.id === "cancelled" && enemy(event.target)) stats.cancelledApplied += 1;
        break;

      case "keywordTriggered":
        /**
         * §6.1 pays a point when a character's own **Parasocial** fires. The
         * event names the card directly, so this is the one AP award that needs
         * no instance lookup — but it still needs the controller check, because
         * the opponent's Parasocial triggers are not your devotion.
         */
        // `instanceId` is null when a keyword fires from something that is not a
        // character on the board, which no Parasocial trigger is
        if (event.keyword === "parasocial" && event.instanceId && controllerOf.get(event.instanceId) === seat) {
          award(canonicalOf(event.cardId), ap.ap.parasocial);
        }
        break;

      case "statusRemoved":
        if (NEGATIVE_STATUSES.has(event.status) && mine(event.target)) stats.negativeStatusesCleared += 1;
        break;

      case "confluenceActivated":
        if (event.seat === seat) {
          stats.confluencesActivated += 1;
          confluences.add(event.confluence);
        }
        break;

      case "resonanceActivated":
        if (event.seat === seat) stats.perfectResonances += 1;
        break;

      case "obsessionChanged":
        if (event.seat === seat) {
          if (event.obsession > lastObsession) stats.obsessionGained += event.obsession - lastObsession;
          lastObsession = event.obsession;
          // the peak, which is not the total gained: Full Fixation resets to
          // zero, so a match can gain 24 Obsession and never hold more than 10
          stats.peakObsession = Math.max(stats.peakObsession, event.obsession);
        }
        break;

      case "fixationUsed":
        if (event.seat === seat) {
          if (event.kind === "fixation") stats.fixationsUsed += 1;
          else stats.ultimatesUsed += 1;
        }
        break;

      case "triggerQueued":
        /**
         * `triggerQueued` carries no seat, and Afterparty is defined as firing
         * at the end of the **controller's** turn — so the seat whose turn it is
         * when the trigger queues is the seat that owns it. That equivalence is
         * the whole reason the trigger was scoped to one turn in the first place
         * (it used to fire on both, at double rate).
         */
        if (event.trigger === "afterparty" && activeSeat === seat) stats.afterpartyTriggers += 1;
        break;

      case "matchEnded":
        stats.won = event.winner === seat;
        break;

      default:
        break;
    }
  }

  stats.mostOfOneCurrent = Math.max(0, ...currentCounts.values());

  // --- feats that are only knowable once the match is over -------------------
  /**
   * The last turn never gets a `turnStarted` after it, so without this the
   * killing turn — the one most likely to be the biggest — would be the one
   * turn *Ratio'd Into Orbit* could not see.
   */
  closeTurn();
  stats.confluencesUsed = [...confluences];
  if (stats.won) {
    stats.widestWinningBoard = peakBoard;
    if (stats.leaderDamageTaken === 0) stats.flawlessWin = 1;
    if (stats.fatigueTaken > 0) stats.burnoutWin = 1;
    if (stats.charactersDefeated === 0) stats.shutoutWin = 1;
  }

  // §6.1's win bonus goes to every character you fielded, then the per-match cap
  if (stats.won) for (const cardId of played) award(cardId, ap.ap.win);
  for (const cardId of Object.keys(affinity)) {
    affinity[cardId] = Math.min(affinity[cardId]!, ap.perMatchCap);
  }

  return { stats, affinity };
}

/**
 * Just the statistics, for missions.
 *
 * Kept as its own name because that is what every mission call site means, and
 * because `readMatch(...).stats` at seven call sites would read like the
 * affinity half was being thrown away by accident rather than on purpose.
 */
export function matchStats(record: MatchRecord, baseContent: ContentIndex, seat: Seat): MatchStats {
  return readMatch(record, baseContent, seat).stats;
}
