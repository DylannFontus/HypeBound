/**
 * Turns a story battle into an ordinary match.
 *
 * Everything a story can do to a battle is something another mode already does:
 * a deck built the way the AI's is built, leader health as a setup op the way
 * the Weekly Boss does it, and rules as leader-passive patches the way artifacts
 * and boss twists are. There is no story branch anywhere in the engine, and this
 * file is deliberately the only place that knows a story battle is different
 * from a practice match — which is to say, it isn't.
 */

import type {
  AiDifficulty,
  CardPatch,
  ContentIndex,
  DeckList,
  EncounterSetup,
  EncounterWave,
  Seat,
  SetupOp,
} from "../../engine/types";
import type { StoryBattle } from "./types";
import { autoBuildDeck } from "../../engine/deck";
import { playableDeck } from "../../save/profile";
import { selectableLeaders } from "../../engine/content";
import { resolveWaveSet } from "./waves";

/** Extra leader health the player gets after asking for help. */
export const STORY_ASSIST_HEALTH = 5;

export interface StoryMatchSetup {
  playerDeck: DeckList;
  aiDeck: DeckList;
  difficulty: AiDifficulty;
  scenario?: EncounterSetup;
  cardOverrides?: Record<string, CardPatch>;
  balanceOverrides?: Record<string, number>;
  firstSeat?: Seat;
  /** what the pre-battle brief says about where the player's cards came from */
  deckSource: string;
}

const PLAYER: Seat = 0;
const OPPONENT: Seat = 1;

/**
 * Which leader card the opponent actually wears.
 *
 * Normally the one the script named. The exception is a mirror: a rule is
 * attached by patching a leader CARD, so if both seats led the same card a rule
 * meant for one of them would land on both — and a player who happened to build
 * a deck around the same leader the script gave their opponent would silently
 * suffer the opponent's handicap, or be handed their own advantage twice.
 *
 * Scripts cannot prevent this, because they never know what deck the player will
 * bring. So the opponent moves instead, to the other leader of their own faction
 * (every faction has two). The swap is deterministic, it is visible — the brief
 * and the board both show who they are actually playing — and their deck does
 * not change, because their cards come from `opponentDeckLeaderCardId` and one
 * leader wearing another's list is exactly how a boss fight is already dealt.
 */
function wornLeader(content: ContentIndex, battle: StoryBattle, playerLeaderCardId: string): string {
  const worn = battle.opponentLeaderCardId;
  if (worn !== playerLeaderCardId || battle.rules.length === 0) return worn;

  const others = selectableLeaders(content)
    .filter((leader) => leader.id !== playerLeaderCardId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const sameFaction = others.find((leader) => leader.faction === content.leaders[worn]?.faction);
  return sameFaction?.id ?? others[0]?.id ?? worn;
}

export function storyMatchSetup(
  content: ContentIndex,
  battle: StoryBattle,
  options: { assist?: boolean } = {}
): StoryMatchSetup {
  const fallbackLeader = selectableLeaders(content)[0]?.id ?? "";

  let playerDeck: DeckList;
  let deckSource: string;
  if (battle.yourDeck.kind === "fixed") {
    playerDeck = autoBuildDeck(content, battle.yourDeck.leaderCardId, `${battle.yourDeck.name}'s set`);
    deckSource = `Loaner deck — ${battle.yourDeck.name}`;
  } else {
    playerDeck = playableDeck(content, fallbackLeader);
    deckSource = `Your deck — ${playerDeck.name}`;
  }

  /**
   * The opponent's cards come from a leader who has some; the leader card they
   * *wear* may be a boss with no pool of its own. Splitting the two is what lets
   * a script name a boss without also having to name whose deck it borrows.
   */
  const aiDeck: DeckList = {
    ...autoBuildDeck(content, battle.opponentDeckLeaderCardId, battle.opponentName),
    leaderCardId: wornLeader(content, battle, playerDeck.leaderCardId),
  };

  const setup: SetupOp[] = [];
  const health = (leaderCardId: string): number => content.leaders[leaderCardId]?.health ?? 30;

  const assistBonus = options.assist ? STORY_ASSIST_HEALTH : 0;
  const yourTotal = (battle.yourHealth ?? health(playerDeck.leaderCardId)) + assistBonus;
  if (battle.yourHealth !== null || assistBonus > 0) {
    setup.push({ op: "leaderHealth", seat: PLAYER, value: yourTotal, max: yourTotal });
  }
  if (battle.theirHealth !== null) {
    setup.push({ op: "leaderHealth", seat: OPPONENT, value: battle.theirHealth, max: battle.theirHealth });
  }
  if (battle.yourArmor !== null) setup.push({ op: "armor", seat: PLAYER, value: battle.yourArmor });
  if (battle.theirArmor !== null) setup.push({ op: "armor", seat: OPPONENT, value: battle.theirArmor });

  /**
   * A rule is a patch on a leader card, which is how it reaches one seat only:
   * balance overrides are a single rulebook shared by both players and could
   * never say "your maximum Hype", while a passive on your leader can.
   */
  const patches: Record<string, CardPatch> = {};
  const balanceOverrides: Record<string, number> = {};
  for (const rule of battle.rules) {
    const leaderCardId = rule.side === "you" ? playerDeck.leaderCardId : aiDeck.leaderCardId;
    const existing = patches[leaderCardId];
    // costs are deltas, so two rules aimed at the same leader add up rather than
    // fighting over the field — the same reason `mergeCardPatches` can exist
    const cost = (was: number | undefined, delta: number | undefined): number | undefined =>
      delta === undefined ? was : (was ?? 0) + delta;
    patches[leaderCardId] = {
      ...existing,
      passive: [...(existing?.passive ?? []), ...rule.effects],
      ...(cost(existing?.fixationCost, rule.fixationCost) !== undefined
        ? { fixationCost: cost(existing?.fixationCost, rule.fixationCost) }
        : {}),
      ...(cost(existing?.ultimateCost, rule.ultimateCost) !== undefined
        ? { ultimateCost: cost(existing?.ultimateCost, rule.ultimateCost) }
        : {}),
      // the rule is printed on the brief; putting it on the card too means it is
      // still readable at turn nine, when the brief is long gone
      textSuffix: [existing?.textSuffix, `${rule.name}: ${rule.text}`].filter(Boolean).join(" "),
    };
    Object.assign(balanceOverrides, rule.balanceOverrides ?? {});
  }

  /**
   * Waves are the one thing a story battle puts in `scenario` that is not a
   * setup write, and they are there for the same reason the setup writes are:
   * `replay()` rebuilds a match from its config, so reinforcements arranged
   * anywhere else would not exist on re-simulation.
   *
   * Card names were already resolved and reported at compile time, so anything
   * still unresolvable here has been complained about and the chapter is broken.
   */
  const waves: EncounterWave[] = battle.waves
    ? resolveWaveSet(content, battle.waves, battle.waves.side === "you" ? PLAYER : OPPONENT).waves
    : [];

  const scenario: EncounterSetup = {
    ...(setup.length > 0 ? { setup } : {}),
    ...(waves.length > 0 ? { waves } : {}),
  };

  return {
    playerDeck,
    aiDeck,
    difficulty: battle.difficulty,
    deckSource,
    ...(Object.keys(scenario).length > 0 ? { scenario } : {}),
    ...(Object.keys(patches).length > 0 ? { cardOverrides: patches } : {}),
    ...(Object.keys(balanceOverrides).length > 0 ? { balanceOverrides } : {}),
    ...(battle.goesFirst ? { firstSeat: battle.goesFirst === "you" ? PLAYER : OPPONENT } : {}),
  };
}
