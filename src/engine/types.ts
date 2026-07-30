/**
 * HYPEBOUND — engine type contract.
 *
 * CANONICAL: this file is the source of truth for all shared shapes
 * (see docs/tech/00-architecture-contract.md §3-4). The engine, AI, UI and
 * data validation all build against these types. Everything here must remain
 * JSON-serializable (no classes, Maps, Dates, functions in state).
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type Seat = 0 | 1;

export type CurrentId =
  | "cinder"
  | "tide"
  | "root"
  | "gale"
  | "pulse"
  | "halo"
  | "veil"
  | "prism";

export type FactionId =
  | "neon-idols"
  | "gothic-royalty"
  | "viral-influencers"
  | "corporate-creators"
  | "digital-demons"
  | "cosplay-champions"
  | "afterparty-crew"
  | "touch-grass-order"
  | "algorithm-syndicate"
  | "meme-collective"
  | "neutral";

export type CardType =
  | "leader"
  | "character"
  | "action"
  | "reaction"
  | "equipment"
  | "location"
  | "transformation"
  | "event";

export type Rarity = "common" | "rare" | "epic" | "legendary";

/** Display + marker keywords. Trigger-flavored keywords (afterparty, flow, …)
 * are listed on cards for display and correspond to effect triggers. */
export type KeywordId =
  | "viral"
  | "spotlight"
  | "parasocial"
  | "trending"
  | "collab"
  | "comeback"
  | "raid"
  | "touch-grass"
  | "afterparty"
  | "rushwind"
  | "flow"
  | "grow"
  | "overload"
  | "inspire"
  | "corrupt"
  | "refract";

export type StatusId =
  | "scorched"
  | "shielded"
  | "armor"
  | "cancelled"
  | "lurking"
  | "warded"
  | "weakened"
  | "empowered"
  | "cursed"
  | "banished";

export type ConfluenceId =
  | "steamveil"
  | "bloom"
  | "sandstorm"
  | "tempest"
  | "starflare"
  | "blackflame"
  | "sanctuary"
  | "eclipse"
  | "refraction";

// ---------------------------------------------------------------------------
// Effects DSL — triggers
// ---------------------------------------------------------------------------

export type TriggerId =
  | "onPlay" // resolves when the card is played from hand
  | "onDefeat" // this character is defeated (deathrattle family / Comeback)
  | "afterparty" // end of controller's turn while in play
  | "startOfTurn" // start of controller's turn while in play
  | "onAttack" // this character declares an attack
  | "onDamaged" // this character survives damage
  | "onHealed" // this character is healed
  | "inspire" // this or another friendly character healed/shielded/buffed
  | "flow" // returned to hand / replayed / healed / exchanged — see 05-keyword-glossary.md §3.12
  | "rushwind" // onPlay bonus when not the first card played this turn
  | "onTargeted" // controller targeted this friendly character with a card/ability (Parasocial)
  | "onCardPlayed" // controller plays another card (optionally filtered)
  | "growComplete" // Grow condition met
  | "aura" // continuous static modifier while in play
  | "reaction" // face-down reaction condition (reaction cards only)
  | "onConfluenceActivated" // controller activated any Confluence this turn
  | "activate" // activated ability (locations via activateLocation intent)
  | "onReturnToHand" // this card returned from play to hand
  | "onDiscard" // this card discarded from hand
  | "eventTick" // event cards: start of each of controller's turns while active
  /**
   * A character its controller owns was defeated — the "last rites" window.
   *
   * Distinct from `onDefeat`, which fires only on the dying character's own card
   * ("deathrattle"). This one fires on OTHER permanents its controller owns, so a
   * leader passive can watch its side of the board. It resolves while the corpse
   * is still standing, which is what lets `revive` cancel the defeat outright.
   */
  | "onFriendlyDefeated"
  /** the controller drew a card (never the opening hand — that is dealt, not drawn) */
  | "onCardDrawn"
  /** the OPPONENT drew a card. The pair exists so "whose draw" is never implied. */
  | "onEnemyCardDrawn"
  /**
   * The opponent's turn began, BEFORE their draw for the turn.
   *
   * `startOfTurn` deliberately fires after the draw, so a card can react to what
   * it just drew. This one has to fire before it: everything that wants this
   * trigger wants to interfere with that draw, and a twist that only takes effect
   * from the second turn onwards is not the twist its text describes.
   */
  | "enemyStartOfTurn";

/** Conditions a face-down Reaction card can automatically fire on. */
export type ReactionConditionId =
  | "enemyPlaysCharacter"
  | "enemyPlaysAction"
  | "enemyAttacksLeader"
  | "enemyAttacksCharacter"
  | "friendlyCharacterDefeated"
  | "friendlyLeaderDamaged"
  | "enemyActivatesConfluence"
  | "enemyUsesFixation";

// ---------------------------------------------------------------------------
// Effects DSL — targeting
// ---------------------------------------------------------------------------

export interface TargetFilter {
  current?: CurrentId[];
  faction?: FactionId[];
  tag?: string[];
  type?: CardType[];
  costMax?: number;
  costMin?: number;
  hasKeyword?: KeywordId;
  hasStatus?: StatusId;
  isDamaged?: boolean;
  /** exclude the effect's own source instance from candidates */
  excludeSelf?: boolean;
}

export interface TargetSpec {
  select:
    | "choose" // acting player picks (targets provided in the intent)
    | "all"
    | "random"
    | "self" // the source card/character itself
    | "adjacent" // board neighbors of the source
    | "leader"
    | "triggering" // the entity that caused the trigger (attacker, healed unit, …)
    /**
     * The costliest / cheapest matching character. Ties break by board order, so
     * this stays a pure function of state — "random among the tied" would consume
     * RNG and make an effect's target depend on how much randomness ran before it.
     */
    | "highestCost"
    | "lowestCost";
  side?: "friendly" | "enemy" | "any";
  zone?: "board" | "hand" | "deck" | "discard" | "location";
  filter?: TargetFilter;
  /** for select: "random" | "choose" — how many (default 1) */
  count?: number;
  /** may resolve to zero targets without making the card unplayable */
  optional?: boolean;
}

// ---------------------------------------------------------------------------
// Effects DSL — amounts & conditions (closed expression set, not a language)
// ---------------------------------------------------------------------------

export type AmountExpr =
  | number
  | { kind: "count"; target: TargetSpec }
  | { kind: "perTurnCardsPlayed" }
  /**
   * Cards that side played during its previous turn.
   *
   * Tracked explicitly rather than read off `cardsPlayedThisTurn` from the other
   * side of the table. That counter is cleared at the start of its own player's
   * turn, so it *happens* to hold last turn's value while the opponent acts — a
   * coincidence of reset ordering, not a fact anyone wrote down, and silently
   * wrong the moment the reset moves.
   */
  | { kind: "cardsPlayedLastTurn"; side?: "friendly" | "enemy" }
  | { kind: "obsession"; side: "friendly" | "enemy" }
  | { kind: "counter"; key: string; side?: "friendly" | "enemy" }
  | { kind: "hypeSpentThisTurn" }
  | { kind: "fatigueCounter"; side: "friendly" | "enemy" };

export type ConditionExpr =
  | { kind: "controlsAtLeast"; target: TargetSpec; min: number }
  | { kind: "obsessionAtLeast"; side: "friendly" | "enemy"; value: number }
  | { kind: "handSizeAtLeast"; side: "friendly" | "enemy"; value: number }
  | { kind: "cardsPlayedThisTurnAtLeast"; value: number }
  | { kind: "leaderHealthAtMost"; side: "friendly" | "enemy"; value: number }
  | { kind: "currentPlayedThisTurn"; current: CurrentId }
  /** Finale/archetype counters — see PlayerState.counters */
  | { kind: "counterAtLeast"; key: string; value: number; side?: "friendly" | "enemy" }
  /** Algorithm Syndicate: does the top card of your deck match? */
  | { kind: "topOfDeckMatches"; filter: TargetFilter }
  | { kind: "not"; c: ConditionExpr }
  | { kind: "and"; list: ConditionExpr[] }
  | { kind: "or"; list: ConditionExpr[] };

// ---------------------------------------------------------------------------
// Effects DSL — ops (interpreter opcodes)
// ---------------------------------------------------------------------------

export type EffectOp =
  | { op: "damage"; target: TargetSpec; amount: AmountExpr; cantBeHealedUntilNextTurn?: boolean; ignoresShield?: boolean }
  | { op: "heal"; target: TargetSpec; amount: AmountExpr }
  /**
   * A stat change that lasts for the life of the instance.
   *
   * There is no temporary form and there never was: `buffTarget` writes straight
   * onto the instance's attack and health. The op used to carry a `permanent`
   * flag that nothing read — six cards set it, none set it false — which made
   * the schema imply a distinction the engine does not have, and invited an
   * author to write `permanent: false` and expect a buff to wear off. For a
   * change that ends, use `applyStatus` with `empowered`/`weakened` and a
   * duration, or an `aura`, which is recomputed rather than written down.
   */
  | { op: "buff"; target: TargetSpec; attack?: AmountExpr; health?: AmountExpr }
  | { op: "setStats"; target: TargetSpec; attack: number; health: number }
  | { op: "summon"; cardId: string; count?: AmountExpr; side?: "friendly" | "enemy" }
  | { op: "draw"; count: AmountExpr; side?: "friendly" | "enemy" }
  | { op: "discard"; target: TargetSpec; count?: AmountExpr }
  | { op: "returnToHand"; target: TargetSpec }
  | { op: "applyStatus"; target: TargetSpec; status: StatusId; amount?: number; durationTurns?: number }
  | { op: "removeStatus"; target: TargetSpec; status?: StatusId; polarity?: "negative" | "positive" }
  | { op: "destroy"; target: TargetSpec }
  | { op: "transform"; target: TargetSpec; intoCardId: string }
  | { op: "copyCardToHand"; target: TargetSpec; costDelta?: number }
  | { op: "stealCopy"; from: "enemyHand" | "enemyDeck" | "enemyDiscard"; count?: number }
  | { op: "banish"; target: TargetSpec; returnAtStartOfYourNextTurn?: boolean }
  | { op: "cancel"; target: TargetSpec; durationTurns?: number }
  | { op: "destroyEquipment"; target: TargetSpec }
  | { op: "gainHype"; amount: AmountExpr; permanent?: boolean; side?: "friendly" | "enemy" }
  | { op: "lockHype"; amount: number } // Overload
  | { op: "gainObsession"; amount: AmountExpr; side?: "friendly" | "enemy" }
  | { op: "removeObsession"; amount: AmountExpr; side?: "friendly" | "enemy" }
  | { op: "addKeyword"; target: TargetSpec; keyword: KeywordId }
  | { op: "removeKeyword"; target: TargetSpec; keyword: KeywordId }
  | { op: "modifyCost"; target: TargetSpec; delta: number } // cards in hand
  /**
   * Re-price the single card that caused the current trigger (the card just
   * drawn, under `onCardDrawn` / `onEnemyCardDrawn`).
   *
   * Separate from `modifyCost` rather than a `scope` flag on it, because the two
   * do not share a target: `modifyCost` sweeps a hand by filter, this one
   * addresses one already-identified card and would have to carry a `target`
   * field that is read by nothing.
   */
  | { op: "modifyTriggeringCardCost"; delta: number }
  | { op: "chooseOne"; options: { label: string; ops: EffectOp[] }[] }
  | { op: "randomOp"; options: { weight?: number; ops: EffectOp[] }[] } // bounded randomness
  | { op: "forEach"; target: TargetSpec; ops: EffectOp[] } // ops run with 'triggering' bound to each match
  | { op: "if"; condition: ConditionExpr; then: EffectOp[]; else?: EffectOp[] }
  | { op: "scheduleDelayed"; delayTurns: number; ops: EffectOp[]; label: string }
  | { op: "disableAuras"; durationTurns: number } // Eclipse
  | { op: "resurrect"; target: TargetSpec; count?: number } // from discard to board
  /**
   * Cancel a defeat in progress: put a character at 0 or less health back on its
   * feet at `health`, still in its slot, keeping its buffs and statuses.
   *
   * Only legal inside the `onFriendlyDefeated` window, which is the one moment
   * the character is both dead and still on the board. Outside it there is
   * nothing at 0 health to catch, and the op simply finds no target.
   */
  | { op: "revive"; target: TargetSpec; health: number }
  /**
   * Advance a leader's Current one step along the advantage cycle
   * (cinder → gale → root → pulse → tide → cinder; Halo and Veil swap with each
   * other; Prism has no advantage and so never rotates).
   *
   * A leader's Current is what an attacker is measured against when it swings at
   * the face, so rotating it moves the +1 elemental bonus around the table.
   */
  | { op: "rotateLeaderCurrent"; side?: "friendly" | "enemy" }
  | { op: "mill"; count: AmountExpr; side?: "friendly" | "enemy" }
  | {
      op: "scry";
      count: number;
      mode: "reorder" | "bottomOne";
      side?: "friendly" | "enemy";
      /**
       * Which of the revealed cards `bottomOne` buries. Default "random".
       *
       * "mostPlayable" is how an effect takes a *decision* on someone's behalf
       * without stopping the game to ask: it buries the card that side could
       * actually cast right now (cost within their Hype, dearest first), falling
       * back to the cheapest when none is castable. Deterministic, so it replays.
       */
      pick?: "random" | "mostPlayable";
    }
  | { op: "swapAttackHealth"; target: TargetSpec }
  | { op: "refract"; intoCurrent?: CurrentId } // undefined => chosen in intent
  | { op: "attackAgain"; target: TargetSpec } // refresh attack
  /** Named counters drive Finale win conditions and archetype trackers. */
  | { op: "addCounter"; key: string; amount: AmountExpr; side?: "friendly" | "enemy" }
  | { op: "setCounter"; key: string; amount: AmountExpr; side?: "friendly" | "enemy" }
  /** Alternate victory. Canon requires visible progress and >=2 turns of counterplay. */
  | { op: "winMatch" }
  /** Afterparty Crew: this turn, your end-of-turn triggers resolve twice. */
  | { op: "repeatAfterpartyThisTurn" }
  | {
      op: "aura"; // ONLY under trigger "aura": continuous, recomputed modifier
      target: TargetSpec;
      attack?: number;
      health?: number;
      costDelta?: number;
      grantKeyword?: KeywordId;
    };

export interface EffectDef {
  trigger: TriggerId;
  /**
   * Primary target selection for the whole effect, resolved ONCE before the
   * ops run. Ops address it with `{ select: "triggering" }`. This is how a
   * card asks the player for one target and then applies several ops to it.
   */
  target?: TargetSpec;
  /**
   * Filters the card that caused the trigger. Applies to `onCardPlayed` and to
   * `reaction` effects whose condition is enemyPlaysCharacter/enemyPlaysAction
   * (e.g. "when the enemy plays a character costing (3) or more").
   */
  playedFilter?: TargetFilter;
  /** for trigger "reaction" (reaction cards only) */
  reactionOn?: ReactionConditionId;
  condition?: ConditionExpr;
  ops: EffectOp[];
  /** fire at most once per game (per instance) */
  once?: boolean;
  /** fire at most once per controller turn — "the first time each turn…" */
  oncePerTurn?: boolean;
  /** explicit card-text fragment; omit to auto-template */
  text?: string;
}

// ---------------------------------------------------------------------------
// Card definitions (data/cards/*.json)
// ---------------------------------------------------------------------------

export interface CardDefBase {
  id: string; // kebab-case, faction-prefixed, globally unique
  name: string;
  faction: FactionId;
  current: CurrentId;
  type: CardType;
  rarity: Rarity;
  cost: number;
  tags: string[];
  keywords: KeywordId[];
  effects: EffectDef[];
  /** "auto" => generated from effects via templating; otherwise explicit */
  text: string;
  flavor?: string;
  /** art asset key; defaults to id. Missing file => procedural placeholder */
  art?: string;
  /** tokens are summon-only: never in decks, packs, or collection crafting */
  token?: boolean;
  /** cosmetic variant of another card (same rules identity) */
  variantOf?: string | null;
  /** Collab parameter (required when keywords includes "collab") */
  collab?: { kind: "current" | "faction" | "tag"; value: string };
  /** Comeback configuration (required when keywords includes "comeback") */
  comeback?: { mode: "hand" | "play"; delayTurns: number };
  /** Grow configuration (required when keywords includes "grow") */
  grow?: { turns: number; ops: EffectOp[] };
  /** Overload amount (required when keywords includes "overload") */
  overload?: number;
  /** marks alternate-win "Finale" legendaries (visible-progress rule applies) */
  finale?: boolean;
}

export interface CharacterCardDef extends CardDefBase {
  type: "character";
  attack: number;
  health: number;
}

export interface ActionCardDef extends CardDefBase {
  type: "action" | "transformation";
}

export interface ReactionCardDef extends CardDefBase {
  type: "reaction";
}

export interface EquipmentCardDef extends CardDefBase {
  type: "equipment";
  /** stat grants while attached */
  equipAttack?: number;
  equipHealth?: number;
  grantKeywords?: KeywordId[];
}

export interface LocationCardDef extends CardDefBase {
  type: "location";
  /** activated-use charges; aura-only locations may omit */
  durability?: number;
}

export interface EventCardDef extends CardDefBase {
  type: "event";
  durationTurns: number;
}

export interface LeaderAbility {
  name: string;
  obsessionCost: number;
  /** resolved once, bound to `{ select: "triggering" }` inside ops */
  target?: TargetSpec;
  ops: EffectOp[];
  text: string;
}

export interface LeaderCardDef extends CardDefBase {
  type: "leader";
  health: number;
  primaryCurrent: CurrentId;
  secondaryCurrent?: CurrentId | null;
  /** passive effects, always active (aura / triggered) */
  passive: EffectDef[];
  fixation: LeaderAbility; // canonical cost 3, once per turn
  ultimate: LeaderAbility; // canonical cost 7, once per match
  title: string; // e.g. "Prime Diva of the Neon Idols"
}

export type CardDef =
  | CharacterCardDef
  | ActionCardDef
  | ReactionCardDef
  | EquipmentCardDef
  | LocationCardDef
  | EventCardDef
  | LeaderCardDef;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface StatusInstance {
  id: StatusId;
  amount?: number; // armor/weakened/empowered magnitude
  /** turns remaining (counted at end of the AFFECTED player's turn); null = until removed */
  remainingTurns: number | null;
  sourceCardId: string;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  /** cost modifications while in hand/deck (viral copies, auras, modifyCost) */
  costDelta: number;
  addedKeywords: KeywordId[];
  removedKeywords: KeywordId[];
  /** viral copies lose Viral and are not "original" for resonance counting */
  viralCopy?: boolean;
  /**
   * This card has been in play and came back — so playing it again is a
   * *replay*, which is one of Flow's four clauses (canon §6). Kept on the hand
   * instance rather than derived, because "has this card been in play before"
   * is not recoverable from the board once it has left it.
   */
  returnedFromPlay?: boolean;
}

export interface EquipmentInstance {
  instanceId: string;
  cardId: string;
  durability?: number;
}

export interface CharacterInstance {
  instanceId: string;
  cardId: string;
  controller: Seat;
  slot: number; // 0..5 board index
  attack: number; // current (post-buff, pre-aura; auras applied at read time)
  health: number;
  maxHealth: number;
  baseAttack: number;
  baseHealth: number;
  current: CurrentId; // may differ from CardDef via Refract/effects
  tags: string[];
  keywords: KeywordId[];
  statuses: StatusInstance[];
  equipment: EquipmentInstance | null;
  enteredOnTurn: number;
  attacksUsedThisTurn: number;
  maxAttacksPerTurn: number;
  growProgress: number;
  growComplete: boolean;
  /** indexes of this card's effects already fired (once / oncePerTurn) */
  firedOnce: number[];
  firedThisTurn: number[];
  /** set while banished (Touch Grass): character is off-board, returns later */
  banishedUntilTurn?: number;
  /** cancelled: blank text + cannot attack (mirrors "cancelled" status for fast checks) */
  damagedThisTurn: boolean;
  healingDisabledUntilTurn?: number; // Blackflame
}

export interface LocationInstance {
  instanceId: string;
  cardId: string;
  durability: number | null;
  usedThisTurn: boolean;
}

export interface ReactionInstance {
  instanceId: string;
  cardId: string; // hidden from opponent in redacted views
  setOnTurn: number;
}

export interface ActiveEventInstance {
  instanceId: string;
  cardId: string;
  remainingTurns: number;
}

export interface DelayedEffect {
  triggersOnTurn: number; // absolute turn number
  ownerSeat: Seat;
  ops: EffectOp[];
  label: string;
  sourceCardId: string;
}

export interface ComebackEntry {
  cardId: string;
  mode: "hand" | "play";
  returnsOnTurn: number; // absolute turn number
  ownerSeat: Seat;
}

export interface PlayerState {
  seat: Seat;
  leaderCardId: string;
  /**
   * The leader's Current *right now*, which is not always the one on the card.
   *
   * Attacks on a leader are measured against this for the elemental bonus, so it
   * has to live in state: `rotateLeaderCurrent` moves it, and reading the card
   * def instead would quietly ignore every rotation.
   */
  leaderCurrent: CurrentId;
  leaderHealth: number;
  leaderMaxHealth: number;
  armor: number;
  /** leader-level statuses (Armor is tracked separately in `armor`) */
  statuses: StatusInstance[];
  hype: number;
  hypeMax: number;
  /**
   * Max Hype granted by effects, on top of the amount your turn count gives you.
   *
   * Held separately because a turn start *recomputes* `hypeMax` from the turn
   * counter rather than incrementing it. Anything added straight to `hypeMax`
   * therefore lasted exactly one turn — which is what two shipped cards promising
   * max Hype "permanently" were actually doing.
   */
  bonusHypeMax: number;
  hypeLockedNextTurn: number; // Overload debt
  tempHypeThisTurn: number;
  obsession: number;
  fixationUsedThisTurn: boolean;
  ultimateUsed: boolean;
  /** the once-per-turn "support a friendly character" obsession gain */
  supportObsessionGainedThisTurn: boolean;
  deck: CardInstance[]; // index 0 = top
  hand: CardInstance[];
  discard: CardInstance[];
  board: (CharacterInstance | null)[]; // fixed length = balance board slots
  banished: CharacterInstance[]; // Touch-Grassed characters awaiting return
  location: LocationInstance | null;
  reactions: ReactionInstance[]; // max per balance config
  activeEvent: ActiveEventInstance | null;
  fatigueCounter: number;
  cardsPlayedThisTurn: number;
  /** snapshot of the above, taken at end of turn — see AmountExpr.cardsPlayedLastTurn */
  cardsPlayedLastTurn: number;
  currentsPlayedThisTurn: CurrentId[];
  hypeSpentThisTurn: number;
  confluenceUsedThisTurn: boolean;
  /** pure-deck Perfect Resonance tracking */
  pureCurrent: CurrentId | null;
  resonanceProgress: number;
  resonanceActivated: boolean;
  /** Refraction confluence: next card of this current triggers onPlay twice */
  refractionCurrent: CurrentId | null;
  /** Afterparty Crew: end-of-turn triggers resolve twice this turn */
  afterpartyRepeatThisTurn: boolean;
  /** named counters powering Finale win conditions and archetype trackers */
  counters: Record<string, number>;
  mulliganDone: boolean;
  /**
   * Indexes of this player's LEADER passive effects that have already fired.
   *
   * Characters track their own on the instance, but a leader has no instance to
   * hang it off, so `once` / `oncePerTurn` on a passive was silently ignored —
   * three shipped leaders say "the first character you play each turn" and fired
   * on every one.
   */
  leaderFiredOnce: number[];
  leaderFiredThisTurn: number[];
}

/**
 * A per-match patch to one card, applied on top of the loaded content.
 *
 * Numbers are DELTAS, not replacements, because everything that wants this
 * wants "cost −1" or "+1/+1": deltas compose additively and are independent of
 * the order patches are merged in, which absolute values are not. Values are
 * clamped to the card schema's range and the patched card is re-validated, so a
 * patch can never produce a card the loader would have rejected.
 *
 * This is the per-PLAYER counterpart to `balanceOverrides`. Balance is one
 * rulebook shared by both seats — "your Fixation costs 2" written as a balance
 * override discounts the opponent's too — whereas a leader card belongs to
 * exactly one player, so patching it changes the game for that player alone.
 */
export interface CardPatch {
  /** added to cost, clamped to the schema's 0..12 */
  cost?: number;
  attack?: number;
  health?: number;
  keywords?: KeywordId[];
  /** appended to a leader's passive list — how an artifact attaches to a player */
  passive?: EffectDef[];
  /** added to the leader's Fixation / Ultimate Obsession cost */
  fixationCost?: number;
  ultimateCost?: number;
  /** appended to the card's rules text, so the change is visible on the card */
  textSuffix?: string;
}

export interface MatchConfig {
  seed: number;
  decks: [DeckList, DeckList];
  /** balance overrides for boss battles / weekly modifiers */
  balanceOverrides?: Record<string, number>;
  /**
   * Per-card patches for this match, keyed by card id.
   *
   * Lives in MatchConfig for the same reason `scenario` does: `replay()` rebuilds
   * from config, so a card bent anywhere else would be its unbent self on replay
   * and every intent after the first divergence would decode into a different
   * game.
   */
  cardOverrides?: Record<string, CardPatch>;
  /**
   * Extra cards this match has, each cloned from a real one: variantId → baseId.
   *
   * The per-COPY counterpart to `cardOverrides`. A patch is keyed by card id, so
   * "upgrade one of your two copies of this card" cannot be written as one —
   * patching the id upgrades both. Cloning the card under a new id gives the
   * upgraded copy its own identity, and `cardOverrides` then bends the clone
   * through exactly the same clamping, refusal and re-validation as any other
   * patch rather than a second code path.
   *
   * In config, like everything else a match is dealt from, so `replay()` rebuilds
   * the same card pool instead of decoding intents against cards that no longer
   * exist.
   */
  cardVariants?: Record<string, string>;
  firstSeat?: Seat; // omitted => coin flip via rng
  /**
   * Scripted setup for tutorial stages, puzzles, boss fights and the sandbox.
   *
   * It lives in MatchConfig rather than being arranged by the caller because
   * `replay()` rebuilds a match with `createMatch(record.config, content)` and
   * then re-applies the intent log. Anything a mode arranged outside config
   * would simply not exist on replay, and every stored scripted match would
   * decode into a different game.
   */
  scenario?: EncounterSetup;
}

/**
 * How a scripted encounter is dealt. Every field is optional and every default
 * reproduces a normal match exactly, so the no-scenario path is untouched.
 */
export interface EncounterSetup {
  /** false = deal decks in authored order and consume no RNG doing it */
  shuffle?: boolean;
  /** false = both players start with empty hands */
  deal?: boolean;
  /** false = the second player does not receive Borrowed Clout */
  borrowedClout?: boolean;
  /** "none" = skip the mulligan and start in the main phase */
  mulligan?: "normal" | "none";
  /** deterministic state writes, applied in array order after the deal */
  setup?: SetupOp[];
  /**
   * Reinforcements that arrive during the match rather than at the deal.
   *
   * They live here, in `MatchConfig`, for the same reason `setup` does: `replay()`
   * rebuilds a match from its config, so a board arranged anywhere else would
   * simply not exist on re-simulation. Waves land strictly in array order, one
   * per check, so "wave 3 of 5" is a fact about the match and not about which
   * cue happened to fire first.
   */
  waves?: EncounterWave[];
}

/**
 * One arrival of a scripted board.
 *
 * A wave is deliberately *dealt* rather than played: its characters are placed
 * the way `{ op: "board" }` places them, so nothing in it triggers `onPlay`, costs
 * Hype, or counts as a card played. An encounter that wants a summon to behave
 * like a card being played already has `{ op: "summon" }` in the effects DSL —
 * this is the other thing, the one the DSL cannot say, which is a *finite,
 * ordered, announced* sequence the player can count down.
 */
export interface EncounterWave {
  /** what the player is told is arriving — printed on the announcement */
  label: string;
  /** whose board it lands on */
  seat: Seat;
  /**
   * Land it at the start of this seat's turn once they have no characters left.
   *
   * This is the cue that makes a wave a wave: you clear the board and the next
   * one arrives. It is checked at the start of the wave seat's turn rather than
   * the instant the last body dies, so the player always gets the swing they
   * cleared the board for.
   */
  onBoardClear?: boolean;
  /**
   * …or at the start of this seat's turn number, whatever the board looks like.
   *
   * Counted in the seat's OWN turns, which is what an author means by "on their
   * third turn". Set alongside `onBoardClear` to mean whichever comes first —
   * which is how a wave encounter escalates against a player who has decided to
   * ignore the board and race the leader instead.
   */
  onTurn?: number;
  /** the bodies, dealt in listed order into the first free slots */
  characters: WaveCharacter[];
}

/**
 * A body in a wave. Deliberately the same vocabulary as `{ op: "board" }` minus
 * its slot, because the two go through one code path — a wave character and a
 * scripted opening character must not be able to drift apart.
 */
export interface WaveCharacter {
  cardId: string;
  attack?: number;
  health?: number;
  maxHealth?: number;
  /**
   * true = can attack the turn it lands, bypassing summoning sickness.
   *
   * Defaults to **false**, which is the opposite of `{ op: "board" }`, and the
   * difference is the point: an opening board has been standing there since
   * before the match, while a wave has visibly just walked in. A wave that could
   * attack on arrival would also be unanswerable — the player never gets a turn
   * between seeing it and being hit by it.
   */
  ready?: boolean;
  statuses?: { id: StatusId; amount?: number; remainingTurns?: number | null }[];
}

/**
 * Setup writes are a closed vocabulary, deliberately separate from EffectOp.
 * EffectOp is card text — it is templated into rules text and validated against
 * the card schema, so overloading it with "set leader health to 12" would
 * corrupt card validation. A SetupOp never appears on a card.
 */
export type SetupOp =
  | { op: "deckOrder"; seat: Seat; cards: string[]; rest?: "keep" | "empty" }
  | { op: "hand"; seat: Seat; cards: string[] }
  | {
      op: "board";
      seat: Seat;
      slot: number;
      cardId: string;
      attack?: number;
      health?: number;
      /**
       * The character's ceiling, when it should differ from its current health.
       *
       * Without this a scripted character can be small but never *damaged*:
       * `health` sets the ceiling too, so a 1-health body has a 1-health maximum
       * and no heal can ever raise it. "A wounded bodyguard you have to mend" is
       * an ordinary puzzle premise and was simply inexpressible.
       */
      maxHealth?: number;
      /** true = already attacked-ready this turn, bypassing summoning sickness */
      ready?: boolean;
      /** statuses the character starts with — Scorched, Shielded, Weakened … */
      statuses?: { id: StatusId; amount?: number; remainingTurns?: number | null }[];
    }
  | { op: "leaderHealth"; seat: Seat; value: number; max?: number }
  | { op: "armor"; seat: Seat; value: number }
  | { op: "hype"; seat: Seat; value: number; max?: number }
  | { op: "obsession"; seat: Seat; value: number }
  /**
   * The turn this seat will be on when play begins.
   *
   * Puzzles need a specific amount of Hype, and Hype is not directly settable:
   * starting a turn derives it from the seat's turn counter. Setting the turn
   * is therefore how a scenario says "give me four Hype" without duplicating
   * the engine's own arithmetic.
   */
  | { op: "turn"; seat: Seat; value: number }
  /** a face-down Reaction already set, as a puzzle brief may reveal */
  | { op: "reaction"; seat: Seat; cardId: string };

export interface MatchState {
  schemaVersion: number;
  config: MatchConfig;
  rngState: [number, number, number, number]; // sfc32-style internal state
  turn: number; // 1-based; increments when seat 0 starts (full rounds tracked per seat internally)
  turnOfSeat: [number, number]; // per-seat turn counters (for "your next turn" math)
  activeSeat: Seat;
  phase: "mulligan" | "main" | "ended";
  players: [PlayerState, PlayerState];
  delayed: DelayedEffect[];
  comebacks: ComebackEntry[];
  aurasDisabledUntilTurn: number; // Eclipse; 0 = not disabled (absolute global turn index)
  globalTurnCounter: number; // increments every seat-turn; basis for all "until" math
  winner: Seat | "draw" | null;
  /** running per-match log indexes for history UI; events are NOT stored here */
  intentCount: number;
  /** deterministic instance-id counter — never reset during a match */
  nextInstanceId: number;
  /**
   * How many of `config.scenario.waves` have already landed.
   *
   * An index rather than a set of flags, because waves land in order: the next
   * wave is always `waves[wavesLanded]`, and "wave 2 of 3" is read straight off
   * it. A match with no waves leaves it at 0 forever.
   */
  wavesLanded: number;
}

export interface DeckList {
  name: string;
  leaderCardId: string;
  cards: string[]; // exactly deck.size card ids (duplicates listed individually)
  cardBackId?: string;
  coverCardId?: string;
  /** when the deck was last saved, for the weekly "a deck you edited this week" */
  editedAt?: number;
}

// ---------------------------------------------------------------------------
// Intents (player → engine)
// ---------------------------------------------------------------------------

export type TargetRef =
  | { kind: "character"; instanceId: string }
  | { kind: "leader"; seat: Seat };

export type PlayerIntent =
  | { type: "mulligan"; seat: Seat; replaceInstanceIds: string[] }
  | {
      type: "playCard";
      seat: Seat;
      instanceId: string;
      /** board slot for characters (must be empty) */
      slot?: number;
      /** chosen targets, in the order the card's choose-targets appear */
      targets?: TargetRef[];
      /** chosen branch indexes for chooseOne ops, in order encountered */
      choices?: number[];
      /** Refract current selection */
      refractChoice?: CurrentId;
    }
  | { type: "attack"; seat: Seat; attackerInstanceId: string; target: TargetRef }
  | { type: "useFixation"; seat: Seat; kind: "fixation" | "ultimate"; targets?: TargetRef[] }
  | { type: "activateLocation"; seat: Seat; targets?: TargetRef[] }
  | { type: "activateConfluence"; seat: Seat; confluence: ConfluenceId; targets?: TargetRef[]; choice?: number }
  | { type: "endTurn"; seat: Seat }
  | { type: "concede"; seat: Seat };

// ---------------------------------------------------------------------------
// Events (engine → UI/replay). The ONLY feed the presenter consumes.
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { e: "matchStarted"; firstSeat: Seat; leaders: [string, string] }
  | { e: "mulliganDone"; seat: Seat; kept: number; replaced: number }
  | { e: "turnStarted"; seat: Seat; turn: number; hype: number; hypeMax: number; lockedHype: number }
  | { e: "turnEnded"; seat: Seat }
  | { e: "cardDrawn"; seat: Seat; instanceId: string; cardId: string | null } // cardId null in redacted enemy view
  | { e: "cardBurned"; seat: Seat; cardId: string; reason: "handFull" }
  | { e: "fatigueDamage"; seat: Seat; amount: number }
  | { e: "cardPlayed"; seat: Seat; instanceId: string; cardId: string; cost: number; targets: TargetRef[] }
  | { e: "characterSummoned"; seat: Seat; instance: CharacterInstance; fromCardPlay: boolean }
  | { e: "reactionSet"; seat: Seat; instanceId: string }
  | { e: "reactionTriggered"; seat: Seat; instanceId: string; cardId: string; on: ReactionConditionId }
  | { e: "locationPlayed"; seat: Seat; instanceId: string; cardId: string; replacedCardId: string | null }
  | { e: "locationActivated"; seat: Seat; instanceId: string; durabilityLeft: number | null }
  | { e: "eventStarted"; seat: Seat; instanceId: string; cardId: string; duration: number }
  | { e: "eventTicked"; seat: Seat; instanceId: string; remaining: number }
  | { e: "eventEnded"; seat: Seat; cardId: string }
  | { e: "equipped"; seat: Seat; characterInstanceId: string; equipment: EquipmentInstance; replacedCardId: string | null }
  | { e: "equipmentDestroyed"; characterInstanceId: string | null; cardId: string }
  | {
      e: "attackDeclared";
      attackerInstanceId: string;
      target: TargetRef;
    }
  | {
      e: "damageDealt";
      target: TargetRef;
      amount: number; // final applied damage after shield/armor
      elementalBonus: boolean;
      absorbedByShield: boolean;
      absorbedByArmor: number;
      source: { cardId: string; instanceId?: string } | { confluence: ConfluenceId } | { fatigue: true };
    }
  | { e: "healed"; target: TargetRef; amount: number; blocked: boolean }
  | { e: "statusApplied"; target: TargetRef; status: StatusInstance }
  | { e: "statusRemoved"; target: TargetRef; status: StatusId }
  | { e: "statusTriggered"; target: TargetRef; status: StatusId } // e.g. scorched burn
  | { e: "buffApplied"; target: TargetRef; attack: number; health: number }
  | { e: "statsSet"; target: TargetRef; attack: number; health: number }
  | { e: "keywordAdded"; target: TargetRef; keyword: KeywordId }
  | { e: "keywordRemoved"; target: TargetRef; keyword: KeywordId }
  /**
   * A keyword fired. `viral` copy made, `rushwind` bonus, `comeback` return, etc.
   *
   * `seat` is who it fired for. It was added when per-seat event redaction was
   * built (`redactEvents`, see `docs/tech/03-multiplayer-architecture.md` §5):
   * every other player-scoped event carries a seat, and without one this event
   * cannot be attributed — which means it cannot be redacted. Six of the seven
   * emission sites name a card that is already public, but the `comeback` one
   * names a card entering a private hand, and there was no way to tell those
   * apart from the event alone.
   */
  | { e: "keywordTriggered"; seat: Seat; instanceId: string | null; cardId: string; keyword: KeywordId }
  | { e: "characterDefeated"; instance: CharacterInstance; killerCardId: string | null }
  | { e: "characterReturnedToHand"; seat: Seat; instanceId: string; cardId: string }
  | { e: "characterBanished"; instanceId: string; cardId: string; returnsOnTurn: number | null }
  | { e: "characterReturnedFromBanish"; instance: CharacterInstance }
  | { e: "characterTransformed"; oldInstanceId: string; instance: CharacterInstance }
  | { e: "characterResurrected"; seat: Seat; instance: CharacterInstance }
  /**
   * A scripted wave arrived. `index` is 1-based against `total` so the UI can
   * say "2 of 3" without knowing how waves are stored, and `dropped` is how many
   * of the wave's bodies had nowhere to stand — announced rather than hidden,
   * because a wave that quietly delivers four of six is a balance change nobody
   * authored.
   */
  | { e: "waveArrived"; seat: Seat; label: string; index: number; total: number; instances: CharacterInstance[]; dropped: number }
  /** a defeat was cancelled mid-resolution by `revive`; the character never left */
  | { e: "defeatPrevented"; instanceId: string; cardId: string; health: number }
  | { e: "leaderCurrentChanged"; seat: Seat; from: CurrentId; to: CurrentId }
  | { e: "comebackScheduled"; seat: Seat; cardId: string; returnsOnTurn: number; mode: "hand" | "play" }
  | { e: "comebackReturned"; seat: Seat; cardId: string; mode: "hand" | "play" }
  | { e: "cardAddedToHand"; seat: Seat; instanceId: string; cardId: string | null; source: "viral" | "copy" | "steal" | "comeback" | "effect" }
  | { e: "cardDiscarded"; seat: Seat; cardId: string }
  | { e: "cardMilled"; seat: Seat; cardId: string }
  | { e: "deckScryed"; seat: Seat; count: number }
  | { e: "costModified"; seat: Seat; instanceId: string; delta: number }
  | { e: "hypeChanged"; seat: Seat; hype: number; hypeMax: number; temp: number }
  | { e: "hypeLocked"; seat: Seat; amount: number }
  | { e: "obsessionChanged"; seat: Seat; obsession: number; reason: "support" | "parasocial" | "effect" | "fixation" | "fullFixationReset" }
  | { e: "obsessedThresholdCrossed"; seat: Seat; nowObsessed: boolean }
  | { e: "fullFixation"; seat: Seat }
  | { e: "fixationUsed"; seat: Seat; kind: "fixation" | "ultimate"; abilityName: string }
  | { e: "confluenceActivated"; seat: Seat; confluence: ConfluenceId; currents: [CurrentId, CurrentId] }
  | { e: "resonanceAdvanced"; seat: Seat; progress: number; threshold: number }
  | { e: "resonanceActivated"; seat: Seat; current: CurrentId }
  | { e: "refracted"; instanceId: string; intoCurrent: CurrentId }
  | { e: "aurasDisabled"; untilTurn: number } // Eclipse
  | { e: "aurasReenabled" }
  | { e: "delayedScheduled"; seat: Seat; label: string; triggersOnTurn: number }
  | { e: "delayedTriggered"; seat: Seat; label: string }
  | { e: "counterChanged"; seat: Seat; key: string; value: number; delta: number }
  | { e: "growProgressed"; instanceId: string; progress: number; needed: number }
  | { e: "growCompleted"; instanceId: string }
  | { e: "triggerQueued"; sourceCardId: string; trigger: TriggerId; depth: number }
  | { e: "triggerCapReached"; dropped: number }
  | { e: "chooseOneResolved"; cardId: string; optionLabel: string }
  | { e: "randomResolved"; cardId: string; optionIndex: number }
  | { e: "matchEnded"; winner: Seat | "draw"; reason: "leaderDefeated" | "concede" | "finale" | "draw" };

// ---------------------------------------------------------------------------
// Engine API result shapes
// ---------------------------------------------------------------------------

export interface ApplyResult {
  state: MatchState;
  events: EngineEvent[];
}

/** Thrown by the reducer on illegal intents. UI should prevent these. */
export interface RulesErrorShape {
  code:
    | "notYourTurn"
    | "wrongPhase"
    | "notEnoughHype"
    | "invalidTarget"
    | "invalidSlot"
    | "boardFull"
    | "cannotAttack"
    | "alreadyAttacked"
    | "spotlightEnforced"
    | "unknownInstance"
    | "confluenceUnavailable"
    | "fixationUnavailable"
    | "reactionLimit"
    | "missingChoice"
    | "invalidIntent";
  message: string;
}

/** Preview annotations for the UI before an intent is confirmed. */
export interface AttackPreview {
  attackerDamage: number; // damage attacker will deal (incl. elemental bonus)
  defenderDamage: number; // counter-damage attacker receives
  elementalBonus: boolean;
  attackerDies: boolean;
  defenderDies: boolean;
  lethalOnLeader: boolean;
  shieldAbsorbs: boolean;
}

export interface ConfluenceAvailability {
  confluence: ConfluenceId;
  currents: [CurrentId, CurrentId];
  available: boolean;
  reasonUnavailable?: "alreadyUsed" | "currentsNotPlayed" | "noValidTargets";
}

// ---------------------------------------------------------------------------
// Redacted (per-seat) views — what a client/AI is allowed to see
// ---------------------------------------------------------------------------

export interface RedactedOpponent {
  seat: Seat;
  leaderCardId: string;
  /** public: it decides whether your attacks on their face get the elemental bonus */
  leaderCurrent: CurrentId;
  leaderHealth: number;
  leaderMaxHealth: number;
  armor: number;
  hype: number;
  hypeMax: number;
  obsession: number;
  handCount: number;
  deckCount: number;
  discard: CardInstance[]; // discard is public
  board: (CharacterInstance | null)[];
  banishedCount: number;
  location: LocationInstance | null;
  reactionCount: number; // face-down cards hidden
  activeEvent: ActiveEventInstance | null;
  resonanceProgress: number;
  pureCurrent: CurrentId | null;
  /** counters are public so Finale progress is always visible to both players */
  counters: Record<string, number>;
}

export interface PlayerView {
  seat: Seat;
  you: PlayerState;
  opponent: RedactedOpponent;
  turn: number;
  globalTurnCounter: number;
  activeSeat: Seat;
  phase: MatchState["phase"];
  aurasDisabledUntilTurn: number;
  winner: MatchState["winner"];
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface MatchRecord {
  schemaVersion: number;
  config: MatchConfig;
  intents: PlayerIntent[];
  /** result summary for history lists (filled when the match ends) */
  result?: { winner: Seat | "draw"; turns: number };
}

// ---------------------------------------------------------------------------
// Content index (loaded + validated data)
// ---------------------------------------------------------------------------

export interface CurrentDef {
  id: CurrentId;
  name: string;
  element: string;
  /** Currents this one has advantage over (+1 damage) */
  beats: CurrentId[];
  signatureKeyword: KeywordId | null;
  resonance: { name: string; ops: EffectOp[]; text: string } | null;
  icon: string;
  colorToken: string; // CSS custom property name, not a raw color
  frameShape: string; // frame shape family key for the card renderer
}

export interface FactionDef {
  id: FactionId;
  name: string;
  currents: CurrentId[]; // permitted currents for this faction's cards
  colorToken: string;
  crest: string;
  tagline: string;
}

export interface ConfluenceDef {
  id: ConfluenceId;
  name: string;
  currents: [CurrentId, CurrentId] | null; // null => prism + any (refraction)
  text: string;
  /** resolved once, bound to `{ select: "triggering" }` inside ops */
  target?: TargetSpec;
  choice?: { label: string; ops: EffectOp[] }[]; // tempest-style either/or
  ops: EffectOp[];
}

export interface StatusDef {
  id: StatusId;
  name: string;
  text: string;
  polarity: "positive" | "negative";
  iconShape: string; // distinct silhouette family (accessibility)
}

export interface KeywordDef {
  id: KeywordId;
  name: string;
  reminderText: string;
}

export interface BalanceConfig {
  deck: {
    size: number;
    maxCopies: number;
    maxCopiesLegendary: number;
    prismSplashLimit: number;
    /** 03 §4.3.2 save slots. A cap the save layer enforces, not a suggestion. */
    slots: number;
  };
  hand: { first: number; second: number; limit: number };
  leader: { startingHealth: number };
  board: { characterSlots: number; locationSlots: number; equipmentPerCharacter: number; maxSetReactions: number };
  hype: { cap: number };
  draw: { perTurn: number };
  fatigue: { start: number; increment: number };
  timer: { turnSeconds: number; ropeSeconds: number };
  obsession: { max: number; fixationCost: number; ultimateCost: number; obsessedThreshold: number; fullFixationResetTo: number; supportPerTurn: number; obsessedExtraDamageTaken: number };
  resonance: { threshold: number };
  rules: { triggerCap: number; elementalBonusDamage: number };
  economy: {
    craftCost: Record<Rarity, number>;
    dustValue: Record<Rarity, number>;
    packSize: number;
    /**
     * Merch Drops. Published to the player on the shop panel from this same
     * object, so the printed odds and the rolled ones cannot drift apart.
     */
    pack: {
      price: number;
      rates: Record<Rarity, number>;
      minRarePerPack: number;
      legendaryPity: number;
    };
    /**
     * Headliner Banners (§4). Every number here is printed on the banner page —
     * the odds table, the Encore Meter's threshold, the Backstage Shop's prices —
     * and read by the pull resolver, so what a player is shown and what is
     * rolled come from one object.
     */
    banner: {
      pullPrice: number;
      /** §6 F2: the ×10 costs exactly ten pulls, never a discount */
      tenPullMultiple: number;
      rates: Record<Rarity, number>;
      /** §4.2's split: half of the Legendary rate is the featured Legendary */
      featuredShare: { legendary: number; epic: number };
      epicPityWindow: number;
      hardPity: number;
      wishlistLimit: number;
      tokensPerPull: number;
      tokenPrices: Record<Rarity, number>;
    };
    /** a duplicate past the playable cap converts at this multiple of dust */
    dupeConversionBonus: number;
    /**
     * What finishing the Grand Tour pays. Published on the tour screen from this
     * same object, so what the player is promised and what they are paid cannot
     * disagree.
     */
    grandTour: { clout: number; drops: number; legendaryChoices: number };
    /**
     * Mission income. §3.5 calls the weekly total "a contract with the player",
     * so these are the numbers the missions screen prints *and* the numbers the
     * claim pays — `tests/missions.test.ts` reconciles them against the doc's
     * own published table.
     */
    missions: {
      dailyClout: number;
      dailyXp: number;
      weeklyClout: number;
      weeklyXp: number;
      firstWinOfDayClout: number;
      /** finishing all three of a week's missions (§8 "Weekly Wrap") */
      weeklyWrapDrops: number;
      /** free Drops available to claim each week (§3.5 "Weekly Restock") */
      weeklyRestockDrops: number;
      /** dailies pay `rookieRoadMultiplier`× for this many days after signup (§8.1) */
      rookieRoadDays: number;
      rookieRoadMultiplier: number;
      /** what finishing a match pays, win or lose — see `game/economy/income.ts` */
      match: { winClout: number; lossClout: number };
      /** 09 §11's Daily Puzzle, which §11 rates separately from an ordinary daily */
      dailyPuzzleClout: number;
      /**
       * 09 §11's *"7-day completion streak: 1 pack"*, paid **cumulatively**.
       *
       * §11 calls it a streak; 07 §6 policy F6 forbids streak resets in as many
       * words. Every seven dailies completed pays the pack, whenever they
       * happen — the reward §11 promises without the mechanic F6 refuses. See
       * `game/dailies`.
       */
      dailyBonusDrops: number;
      dailyBonusEvery: number;
      /**
       * 09 §3's AI daily Clout cap, in **wins** rather than Clout.
       *
       * §3 writes the cap as 200 against a 20–30-per-win schedule, which is
       * eight wins. Storing the eight and deriving the ceiling from what a win
       * is actually worth keeps the *rule* rather than the constant.
       */
      aiDailyCapWins: number;
    };
  };
}

export interface ContentIndex {
  cards: Record<string, CardDef>;
  leaders: Record<string, LeaderCardDef>;
  currents: Record<CurrentId, CurrentDef>;
  factions: Record<FactionId, FactionDef>;
  confluences: Record<ConfluenceId, ConfluenceDef>;
  statuses: Record<StatusId, StatusDef>;
  keywords: Record<KeywordId, KeywordDef>;
  balance: BalanceConfig;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type AiDifficulty =
  | "beginner"
  | "casual"
  | "intermediate"
  | "advanced"
  | "expert"
  | "boss";

export interface AiProfile {
  id: string;
  difficulty: AiDifficulty;
  /** evaluation noise stddev (0 = perfect); higher = sloppier */
  noise: number;
  /** probability of taking obvious lethal when available */
  lethalAwareness: number;
  /** probability of using an available Confluence */
  confluenceAwareness: number;
  /** look-ahead plies for intent sequences within a turn */
  searchDepth: number;
  style: "aggressive" | "defensive" | "balanced" | "combo";
  /** boss-only extras */
  bossCards?: string[];
  balanceOverrides?: Record<string, number>;
}
