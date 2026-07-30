/**
 * Scripted encounters: the data behind the tutorial, puzzles, boss fights,
 * story chapters and the sandbox.
 *
 * An encounter is pure data. It says how a match is dealt (`MatchConfig`,
 * including the `scenario` setup the engine understands), who the opponent is,
 * and — for teaching modes — a list of *beats*: what the coach says, what the
 * player is allowed to do, and what has to become true before moving on.
 *
 * Nothing here decides rules. Beat conditions are read against a `PlayerView`
 * the engine produced, and gating is expressed as intent matchers that the
 * match driver enforces before an intent reaches the reducer — never in the
 * view. The engine has no idea any of this exists.
 */

import { z } from "zod";
import type { DeckList, PlayerView, PlayerIntent, Seat, EncounterSetup, SetupOp } from "./types";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** HUD widgets that a teaching stage can reveal progressively. */
export const HUD_WIDGETS = [
  "hand",
  "hype",
  "endTurn",
  "leaderHealth",
  "targeting",
  "damagePreview",
  "statusIcons",
  "currentBadges",
  "confluence",
  "obsession",
  "history",
  "emotes",
] as const;
export type HudWidgetId = (typeof HUD_WIDGETS)[number];

/** What the player is permitted to do during a beat. */
export type IntentMatcher =
  | { intent: "playCard"; cardId?: string | string[] }
  | { intent: "attack"; target?: "leader" | "character" | "any" }
  | { intent: "useFixation"; kind?: "fixation" | "ultimate" }
  | { intent: "activateConfluence" }
  | { intent: "mulligan" }
  | { intent: "endTurn" }
  | { intent: "any" };

/** When a beat is satisfied and the script may advance. */
export type BeatCondition =
  | { when: "acknowledged" }
  | { when: "boardCount"; seat: "you" | "opponent"; min?: number; max?: number }
  | { when: "handCount"; seat: "you" | "opponent"; min?: number; max?: number }
  | { when: "leaderHealthAtMost"; seat: "you" | "opponent"; value: number }
  | { when: "obsessionAtLeast"; value: number }
  | { when: "turnAtLeast"; value: number }
  | { when: "confluenceUsed" }
  | { when: "matchEnded" }
  | { when: "all"; list: BeatCondition[] }
  | { when: "any"; list: BeatCondition[] };

export interface BeatDef {
  id: string;
  /** coach lines, shown in order; the last one waits for acknowledgement */
  say?: { speaker?: string; text: string; spotlight?: string }[];
  /** widgets revealed when this beat starts, cumulative across the stage */
  reveal?: HudWidgetId[];
  /** absent = anything legal is allowed; empty array = nothing is */
  allow?: IntentMatcher[];
  /** shown when the gate rejects something */
  denyReason?: string;
  until: BeatCondition;
}

export interface StageDef {
  id: string;
  title: string;
  teaches: string;
  /** baseline widgets visible for the whole stage */
  reveal?: HudWidgetId[];
  /** deck ids resolved against the encounter's `decks` map */
  decks: [string, string];
  seed: number;
  firstSeat?: Seat;
  scenario?: EncounterSetup;
  /** "idle" = the bot only ever passes; "ai" = a real opponent */
  opponent: { kind: "idle" } | { kind: "ai"; difficulty: string };
  beats: BeatDef[];
  /** stage is complete when this holds; omitted = when the last beat is done */
  objective?: BeatCondition;
  /**
   * Stage is lost when this holds. Puzzles are one exact line, so "your turn
   * ended and you have not won" is a loss, not a slow game — without it the
   * player is left on a board with nothing legal to do and no way to restart.
   */
  failIf?: BeatCondition;
}

export interface EncounterDef {
  id: string;
  kind: "tutorial" | "puzzle" | "boss" | "story" | "lab";
  decks: Record<string, DeckList>;
  stages: StageDef[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const zSeat = z.union([z.literal(0), z.literal(1)]);
const zSide = z.enum(["you", "opponent"]);

const zSetupOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("deckOrder"), seat: zSeat, cards: z.array(z.string()), rest: z.enum(["keep", "empty"]).optional() }).strict(),
  z.object({ op: z.literal("hand"), seat: zSeat, cards: z.array(z.string()) }).strict(),
  z.object({
    op: z.literal("board"),
    seat: zSeat,
    slot: z.number().int().min(0),
    cardId: z.string(),
    attack: z.number().int().optional(),
    health: z.number().int().optional(),
    // a ceiling above `health` deals a character that has already taken damage
    maxHealth: z.number().int().optional(),
    ready: z.boolean().optional(),
    statuses: z
      .array(
        z.object({
          id: z.string(),
          amount: z.number().int().optional(),
          remainingTurns: z.number().int().nullable().optional(),
        }).strict()
      )
      .optional(),
  }).strict(),
  z.object({ op: z.literal("leaderHealth"), seat: zSeat, value: z.number().int(), max: z.number().int().optional() }).strict(),
  z.object({ op: z.literal("armor"), seat: zSeat, value: z.number().int() }).strict(),
  z.object({ op: z.literal("hype"), seat: zSeat, value: z.number().int(), max: z.number().int().optional() }).strict(),
  z.object({ op: z.literal("obsession"), seat: zSeat, value: z.number().int() }).strict(),
  z.object({ op: z.literal("turn"), seat: zSeat, value: z.number().int().positive() }).strict(),
  z.object({ op: z.literal("reaction"), seat: zSeat, cardId: z.string() }).strict(),
]);

const zWaveCharacter = z.object({
  cardId: z.string(),
  attack: z.number().int().optional(),
  health: z.number().int().optional(),
  maxHealth: z.number().int().optional(),
  ready: z.boolean().optional(),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        amount: z.number().int().optional(),
        remainingTurns: z.number().int().nullable().optional(),
      }).strict()
    )
    .optional(),
}).strict();

/**
 * A wave with neither cue never arrives, and does so silently — the encounter
 * simply plays as though the wave were not written. That is the one mistake this
 * shape invites, so it is a parse error rather than a quiet nothing.
 */
export const zWave = z.object({
  label: z.string().min(1),
  seat: zSeat,
  onBoardClear: z.boolean().optional(),
  onTurn: z.number().int().positive().optional(),
  characters: z.array(zWaveCharacter).min(1),
}).strict().refine(
  (wave) => wave.onBoardClear === true || wave.onTurn !== undefined,
  { message: 'has no cue, so it would never arrive: set onBoardClear:true, onTurn, or both' }
);

const zScenario = z.object({
  shuffle: z.boolean().optional(),
  deal: z.boolean().optional(),
  borrowedClout: z.boolean().optional(),
  mulligan: z.enum(["normal", "none"]).optional(),
  setup: z.array(zSetupOp).optional(),
  waves: z.array(zWave).optional(),
}).strict();

const zMatcher = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("playCard"), cardId: z.union([z.string(), z.array(z.string())]).optional() }).strict(),
  z.object({ intent: z.literal("attack"), target: z.enum(["leader", "character", "any"]).optional() }).strict(),
  z.object({ intent: z.literal("useFixation"), kind: z.enum(["fixation", "ultimate"]).optional() }).strict(),
  z.object({ intent: z.literal("activateConfluence") }).strict(),
  z.object({ intent: z.literal("mulligan") }).strict(),
  z.object({ intent: z.literal("endTurn") }).strict(),
  z.object({ intent: z.literal("any") }).strict(),
]);

const zCondition: z.ZodType<BeatCondition> = z.lazy(() =>
  z.union([
    z.object({ when: z.literal("acknowledged") }).strict(),
    z.object({ when: z.literal("boardCount"), seat: zSide, min: z.number().int().optional(), max: z.number().int().optional() }).strict(),
    z.object({ when: z.literal("handCount"), seat: zSide, min: z.number().int().optional(), max: z.number().int().optional() }).strict(),
    z.object({ when: z.literal("leaderHealthAtMost"), seat: zSide, value: z.number().int() }).strict(),
    z.object({ when: z.literal("obsessionAtLeast"), value: z.number().int() }).strict(),
    z.object({ when: z.literal("turnAtLeast"), value: z.number().int() }).strict(),
    z.object({ when: z.literal("confluenceUsed") }).strict(),
    z.object({ when: z.literal("matchEnded") }).strict(),
    z.object({ when: z.literal("all"), list: z.array(zCondition) }).strict(),
    z.object({ when: z.literal("any"), list: z.array(zCondition) }).strict(),
  ])
);

const zBeat = z.object({
  id: z.string(),
  say: z.array(z.object({ speaker: z.string().optional(), text: z.string(), spotlight: z.string().optional() }).strict()).optional(),
  reveal: z.array(z.enum(HUD_WIDGETS)).optional(),
  allow: z.array(zMatcher).optional(),
  denyReason: z.string().optional(),
  until: zCondition,
}).strict();

const zDeckList = z.object({
  name: z.string(),
  leaderCardId: z.string(),
  cards: z.array(z.string()),
}).strict();

const zStage = z.object({
  id: z.string(),
  title: z.string(),
  teaches: z.string(),
  reveal: z.array(z.enum(HUD_WIDGETS)).optional(),
  decks: z.tuple([z.string(), z.string()]),
  seed: z.number().int(),
  firstSeat: zSeat.optional(),
  scenario: zScenario.optional(),
  opponent: z.union([
    z.object({ kind: z.literal("idle") }).strict(),
    z.object({ kind: z.literal("ai"), difficulty: z.string() }).strict(),
  ]),
  beats: z.array(zBeat),
  objective: zCondition.optional(),
  failIf: zCondition.optional(),
}).strict();

const zEncounter = z.object({
  id: z.string(),
  kind: z.enum(["tutorial", "puzzle", "boss", "story", "lab"]),
  decks: z.record(z.string(), zDeckList),
  stages: z.array(zStage),
}).strict();

export class EncounterError extends Error {}

/**
 * Parse and cross-check an encounter.
 *
 * The referential checks matter more than the shape ones: a stage naming a deck
 * that does not exist, or a scenario that fixes deck order and then lets the
 * mulligan reshuffle it, both parse fine and then fail confusingly at runtime.
 */
export function parseEncounter(raw: unknown, knownCardIds: ReadonlySet<string>): EncounterDef {
  const parsed = zEncounter.safeParse(raw);
  if (!parsed.success) {
    throw new EncounterError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const encounter = parsed.data as EncounterDef;
  const errors: string[] = [];

  for (const [deckId, deck] of Object.entries(encounter.decks)) {
    if (!knownCardIds.has(deck.leaderCardId)) errors.push(`deck ${deckId}: unknown leader ${deck.leaderCardId}`);
    for (const cardId of deck.cards) {
      if (!knownCardIds.has(cardId)) errors.push(`deck ${deckId}: unknown card ${cardId}`);
    }
  }

  for (const stage of encounter.stages) {
    for (const deckId of stage.decks) {
      // `$player` / `$rival` are resolved at launch against the real profile
      if (deckId.startsWith("$")) continue;
      if (!encounter.decks[deckId]) errors.push(`stage ${stage.id}: unknown deck ${deckId}`);
    }
    for (const op of stage.scenario?.setup ?? []) {
      const cards = "cardId" in op ? [op.cardId] : "cards" in op ? op.cards : [];
      for (const cardId of cards) {
        if (!knownCardIds.has(cardId)) errors.push(`stage ${stage.id}: setup references unknown card ${cardId}`);
      }
    }
    /**
     * Waves get the same existence check as setup, and for a sharper reason: a
     * wave body that resolves to nothing is dealt into no slot at all, so the
     * wave arrives one body short with nothing in the log to say why.
     *
     * The two checks this cannot make — that the card is a *character*, and that
     * the wave is not larger than the board — need the content index rather than
     * a set of ids, so they live with the story wave library in
     * `game/story/waves.ts`, which is the surface waves are actually authored on.
     */
    for (const [index, wave] of (stage.scenario?.waves ?? []).entries()) {
      for (const character of wave.characters) {
        if (!knownCardIds.has(character.cardId)) {
          errors.push(`stage ${stage.id}: wave ${index + 1} references unknown card ${character.cardId}`);
        }
      }
    }
    // The engine reshuffles on mulligan, so an authored deck order survives only
    // if the stage also skips the mulligan. Catch it here rather than letting a
    // stage deal a different hand than the script expects.
    if (stage.scenario?.shuffle === false && (stage.scenario.mulligan ?? "normal") !== "none") {
      errors.push(`stage ${stage.id}: shuffle:false needs mulligan:"none", or the mulligan reshuffles the authored order`);
    }
    /**
     * Opening a mulligan-free stage runs `startTurn`, which recomputes Hype
     * from the turn number — so an authored Hype value for the starting seat is
     * always discarded. That silently deals a board where nothing in the
     * scripted hand is affordable, with no error to explain it. Reject the
     * combination rather than let a puzzle ship unplayable.
     */
    if ((stage.scenario?.mulligan ?? "normal") === "none") {
      for (const op of stage.scenario?.setup ?? []) {
        if (op.op === "hype") {
          errors.push(
            `stage ${stage.id}: a "hype" setup op cannot survive mulligan:"none" — starting a turn ` +
              `recomputes Hype from the turn number. Use { op: "turn", seat, value } instead.`
          );
        }
      }
    }
    /**
     * A `failIf` that already holds when the stage opens retries instantly and
     * forever. The common way to write one is `turnAtLeast N` against a stage
     * that used `{ op: "turn", value: N }` to buy Hype — so check exactly that.
     */
    const openingTurn = (stage.scenario?.setup ?? []).find(
      (op): op is Extract<SetupOp, { op: "turn" }> => op.op === "turn" && op.seat === (stage.firstSeat ?? 0)
    )?.value;
    if (stage.failIf?.when === "turnAtLeast" && openingTurn !== undefined && stage.failIf.value <= openingTurn) {
      errors.push(
        `stage ${stage.id}: failIf turnAtLeast ${stage.failIf.value} is already true on the opening ` +
          `turn (${openingTurn}), so the stage would fail and retry forever`
      );
    }
    /**
     * The same trap facing the other way, and a quieter one.
     *
     * An `objective` of `turnAtLeast N` that already holds on the opening turn
     * marks the stage complete the instant it is dealt — so a Survival puzzle
     * reports a win before the player has done anything, and the mode skips
     * straight to the next one. It fails silently rather than looping, which is
     * why it survived a whole batch of puzzles passing their unit tests: the
     * solution really was correct, and the stage simply never asked for it.
     */
    if (stage.objective?.when === "turnAtLeast" && openingTurn !== undefined && stage.objective.value <= openingTurn) {
      errors.push(
        `stage ${stage.id}: objective turnAtLeast ${stage.objective.value} is already true on the opening ` +
          `turn (${openingTurn}), so the stage completes before the player acts`
      );
    }
    if (stage.beats.length === 0 && !stage.objective) {
      errors.push(`stage ${stage.id}: has no beats and no objective, so it can never complete`);
    }
  }

  if (errors.length) throw new EncounterError(errors.join("\n"));
  return encounter;
}

// ---------------------------------------------------------------------------
// Beat evaluation
// ---------------------------------------------------------------------------

/**
 * Every encounter file under data/encounters/, parsed and cross-checked.
 *
 * Auto-discovered exactly like card files, so dropping in a new puzzle pack or
 * story chapter needs no registration step. Parsed once and memoised; a bad
 * file throws with every problem listed rather than the first.
 */
let encounterCache: Record<string, EncounterDef> | null = null;

export function getEncounters(knownCardIds: ReadonlySet<string>): Record<string, EncounterDef> {
  if (encounterCache) return encounterCache;
  const modules = import.meta.glob("../../data/encounters/*.json", { eager: true, import: "default" });
  const out: Record<string, EncounterDef> = {};
  const problems: string[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    try {
      const encounter = parseEncounter(raw, knownCardIds);
      if (out[encounter.id]) problems.push(`${path}: duplicate encounter id ${encounter.id}`);
      out[encounter.id] = encounter;
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length) throw new EncounterError(problems.join("\n"));
  encounterCache = out;
  return out;
}

/** Test hook: drop the memoised encounters so a fixture can be re-parsed. */
export function resetEncounterCache(): void {
  encounterCache = null;
}

/**
 * Is a beat condition satisfied by the current view?
 *
 * `acknowledged` is the one case the view cannot answer — it is about the
 * player having read a line — so the caller passes it in.
 */
export function conditionMet(condition: BeatCondition, view: PlayerView, acknowledged: boolean): boolean {
  const sideOf = (seat: "you" | "opponent") => (seat === "you" ? view.you : view.opponent);
  switch (condition.when) {
    case "acknowledged":
      return acknowledged;
    case "boardCount": {
      const count = sideOf(condition.seat).board.filter(Boolean).length;
      return count >= (condition.min ?? 0) && count <= (condition.max ?? Number.MAX_SAFE_INTEGER);
    }
    case "handCount": {
      const side = sideOf(condition.seat);
      const count = "hand" in side ? side.hand.length : side.handCount;
      return count >= (condition.min ?? 0) && count <= (condition.max ?? Number.MAX_SAFE_INTEGER);
    }
    case "leaderHealthAtMost":
      return sideOf(condition.seat).leaderHealth <= condition.value;
    case "obsessionAtLeast":
      return view.you.obsession >= condition.value;
    case "turnAtLeast":
      return view.turn >= condition.value;
    case "confluenceUsed":
      return view.you.confluenceUsedThisTurn;
    case "matchEnded":
      return view.winner !== null;
    case "all":
      return condition.list.every((c) => conditionMet(c, view, acknowledged));
    case "any":
      return condition.list.some((c) => conditionMet(c, view, acknowledged));
  }
}

/**
 * Does an intent pass the beat's gate?
 *
 * This is mode policy, not a game rule: the engine still decides whether the
 * intent is *legal*. This only decides whether the lesson currently permits it.
 */
export function intentAllowed(
  intent: PlayerIntent,
  allow: IntentMatcher[] | undefined,
  /**
   * Resolves a hand instance to its card id, so a beat can restrict play to one
   * specific card. Without it the `cardId` restriction cannot be evaluated, and
   * a matcher that names a card is treated as naming none — so it is refused
   * rather than silently permitting everything, which is how a puzzle's
   * intended solution would get bypassed.
   */
  cardIdOf?: (instanceId: string) => string | null
): boolean {
  if (!allow) return true;
  return allow.some((matcher) => {
    if (matcher.intent === "any") return true;
    switch (intent.type) {
      case "playCard": {
        if (matcher.intent !== "playCard") return false;
        if (matcher.cardId === undefined) return true;
        const wanted = Array.isArray(matcher.cardId) ? matcher.cardId : [matcher.cardId];
        const actual = cardIdOf?.(intent.instanceId) ?? null;
        return actual !== null && wanted.includes(actual);
      }
      case "attack":
        if (matcher.intent !== "attack") return false;
        if (!matcher.target || matcher.target === "any") return true;
        return matcher.target === (intent.target.kind === "leader" ? "leader" : "character");
      case "useFixation":
        return matcher.intent === "useFixation" && (!matcher.kind || matcher.kind === intent.kind);
      case "activateConfluence":
        return matcher.intent === "activateConfluence";
      case "mulligan":
        return matcher.intent === "mulligan";
      case "endTurn":
        return matcher.intent === "endTurn";
      default:
        return false;
    }
  });
}
