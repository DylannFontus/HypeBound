/**
 * Zod schemas for all data files + cross-content referential checks.
 * Mirrors src/engine/types.ts exactly — if types.ts changes, change this too.
 * Used by content.ts at load time, by `npm run validate`, and by tests.
 */

import { z } from "zod";
import type { CardDef, ContentIndex, LeaderCardDef } from "./types";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const zCurrentId = z.enum(["cinder", "tide", "root", "gale", "pulse", "halo", "veil", "prism"]);
export const zFactionId = z.enum([
  "neon-idols", "gothic-royalty", "viral-influencers", "corporate-creators", "digital-demons",
  "cosplay-champions", "afterparty-crew", "touch-grass-order", "algorithm-syndicate", "meme-collective", "neutral",
]);
export const zCardType = z.enum(["leader", "character", "action", "reaction", "equipment", "location", "transformation", "event"]);
export const zRarity = z.enum(["common", "rare", "epic", "legendary"]);
export const zKeywordId = z.enum([
  "viral", "spotlight", "parasocial", "trending", "collab", "comeback", "raid", "touch-grass",
  "afterparty", "rushwind", "flow", "grow", "overload", "inspire", "corrupt", "refract",
]);
export const zStatusId = z.enum(["scorched", "shielded", "armor", "cancelled", "lurking", "warded", "weakened", "empowered", "cursed", "banished"]);
export const zConfluenceId = z.enum(["steamveil", "bloom", "sandstorm", "tempest", "starflare", "blackflame", "sanctuary", "eclipse", "refraction"]);
export const zTriggerId = z.enum([
  "onPlay", "onDefeat", "afterparty", "startOfTurn", "onAttack", "onDamaged", "onHealed", "inspire",
  "flow", "rushwind", "onTargeted", "onCardPlayed", "growComplete", "aura", "reaction",
  "onConfluenceActivated", "activate", "onReturnToHand", "onDiscard", "eventTick",
  "onFriendlyDefeated", "onCardDrawn", "onEnemyCardDrawn", "enemyStartOfTurn",
]);
export const zReactionConditionId = z.enum([
  "enemyPlaysCharacter", "enemyPlaysAction", "enemyAttacksLeader", "enemyAttacksCharacter",
  "friendlyCharacterDefeated", "friendlyLeaderDamaged", "enemyActivatesConfluence", "enemyUsesFixation",
]);

// ---------------------------------------------------------------------------
// Effects DSL
// ---------------------------------------------------------------------------

export const zTargetFilter = z
  .object({
    current: z.array(zCurrentId).optional(),
    faction: z.array(zFactionId).optional(),
    tag: z.array(z.string()).optional(),
    type: z.array(zCardType).optional(),
    costMax: z.number().int().optional(),
    costMin: z.number().int().optional(),
    hasKeyword: zKeywordId.optional(),
    hasStatus: zStatusId.optional(),
    isDamaged: z.boolean().optional(),
    excludeSelf: z.boolean().optional(),
  })
  .strict();

export const zTargetSpec = z
  .object({
    select: z.enum(["choose", "all", "random", "self", "adjacent", "leader", "triggering", "highestCost", "lowestCost"]),
    side: z.enum(["friendly", "enemy", "any"]).optional(),
    zone: z.enum(["board", "hand", "deck", "discard", "location"]).optional(),
    filter: zTargetFilter.optional(),
    count: z.number().int().min(1).optional(),
    optional: z.boolean().optional(),
  })
  .strict();

export const zAmountExpr = z.union([
  z.number().int(),
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("count"), target: zTargetSpec }).strict(),
    z.object({ kind: z.literal("perTurnCardsPlayed") }).strict(),
    z.object({ kind: z.literal("cardsPlayedLastTurn"), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ kind: z.literal("obsession"), side: z.enum(["friendly", "enemy"]) }).strict(),
    z.object({ kind: z.literal("counter"), key: z.string(), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ kind: z.literal("hypeSpentThisTurn") }).strict(),
    z.object({ kind: z.literal("fatigueCounter"), side: z.enum(["friendly", "enemy"]) }).strict(),
  ]),
]);

export type ZConditionExpr = z.ZodType<unknown>;
export const zConditionExpr: ZConditionExpr = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("controlsAtLeast"), target: zTargetSpec, min: z.number().int() }).strict(),
    z.object({ kind: z.literal("obsessionAtLeast"), side: z.enum(["friendly", "enemy"]), value: z.number().int() }).strict(),
    z.object({ kind: z.literal("handSizeAtLeast"), side: z.enum(["friendly", "enemy"]), value: z.number().int() }).strict(),
    z.object({ kind: z.literal("cardsPlayedThisTurnAtLeast"), value: z.number().int() }).strict(),
    z.object({ kind: z.literal("leaderHealthAtMost"), side: z.enum(["friendly", "enemy"]), value: z.number().int() }).strict(),
    z.object({ kind: z.literal("currentPlayedThisTurn"), current: zCurrentId }).strict(),
    z.object({ kind: z.literal("counterAtLeast"), key: z.string(), value: z.number().int(), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ kind: z.literal("topOfDeckMatches"), filter: zTargetFilter }).strict(),
    z.object({ kind: z.literal("not"), c: zConditionExpr }).strict(),
    z.object({ kind: z.literal("and"), list: z.array(zConditionExpr) }).strict(),
    z.object({ kind: z.literal("or"), list: z.array(zConditionExpr) }).strict(),
  ])
);

export type ZEffectOp = z.ZodType<unknown>;
export const zEffectOp: ZEffectOp = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("damage"), target: zTargetSpec, amount: zAmountExpr, cantBeHealedUntilNextTurn: z.boolean().optional(), ignoresShield: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("heal"), target: zTargetSpec, amount: zAmountExpr }).strict(),
    // no `permanent` flag: a buff is written onto the instance and always lasts.
    // `.strict()` now refuses one, which is the point — see EffectOp in types.ts.
    z.object({ op: z.literal("buff"), target: zTargetSpec, attack: zAmountExpr.optional(), health: zAmountExpr.optional() }).strict(),
    z.object({ op: z.literal("setStats"), target: zTargetSpec, attack: z.number().int(), health: z.number().int() }).strict(),
    z.object({ op: z.literal("summon"), cardId: z.string(), count: zAmountExpr.optional(), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("draw"), count: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("discard"), target: zTargetSpec, count: zAmountExpr.optional() }).strict(),
    z.object({ op: z.literal("returnToHand"), target: zTargetSpec }).strict(),
    z.object({ op: z.literal("applyStatus"), target: zTargetSpec, status: zStatusId, amount: z.number().int().optional(), durationTurns: z.number().int().optional() }).strict(),
    z.object({ op: z.literal("removeStatus"), target: zTargetSpec, status: zStatusId.optional(), polarity: z.enum(["negative", "positive"]).optional() }).strict(),
    z.object({ op: z.literal("destroy"), target: zTargetSpec }).strict(),
    z.object({ op: z.literal("transform"), target: zTargetSpec, intoCardId: z.string() }).strict(),
    z.object({ op: z.literal("copyCardToHand"), target: zTargetSpec, costDelta: z.number().int().optional() }).strict(),
    z.object({ op: z.literal("stealCopy"), from: z.enum(["enemyHand", "enemyDeck", "enemyDiscard"]), count: z.number().int().optional() }).strict(),
    z.object({ op: z.literal("banish"), target: zTargetSpec, returnAtStartOfYourNextTurn: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("cancel"), target: zTargetSpec, durationTurns: z.number().int().optional() }).strict(),
    z.object({ op: z.literal("destroyEquipment"), target: zTargetSpec }).strict(),
    z.object({ op: z.literal("gainHype"), amount: zAmountExpr, permanent: z.boolean().optional(), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("lockHype"), amount: z.number().int() }).strict(),
    z.object({ op: z.literal("gainObsession"), amount: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("removeObsession"), amount: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("addKeyword"), target: zTargetSpec, keyword: zKeywordId }).strict(),
    z.object({ op: z.literal("removeKeyword"), target: zTargetSpec, keyword: zKeywordId }).strict(),
    z.object({ op: z.literal("modifyCost"), target: zTargetSpec, delta: z.number().int() }).strict(),
    z.object({ op: z.literal("modifyTriggeringCardCost"), delta: z.number().int() }).strict(),
    z.object({ op: z.literal("chooseOne"), options: z.array(z.object({ label: z.string(), ops: z.array(zEffectOp) }).strict()).min(2) }).strict(),
    z.object({ op: z.literal("randomOp"), options: z.array(z.object({ weight: z.number().optional(), ops: z.array(zEffectOp) }).strict()).min(2) }).strict(),
    z.object({ op: z.literal("forEach"), target: zTargetSpec, ops: z.array(zEffectOp) }).strict(),
    z.object({ op: z.literal("if"), condition: zConditionExpr, then: z.array(zEffectOp), else: z.array(zEffectOp).optional() }).strict(),
    z.object({ op: z.literal("scheduleDelayed"), delayTurns: z.number().int().min(1), ops: z.array(zEffectOp), label: z.string() }).strict(),
    z.object({ op: z.literal("disableAuras"), durationTurns: z.number().int().min(1) }).strict(),
    z.object({ op: z.literal("resurrect"), target: zTargetSpec, count: z.number().int().optional() }).strict(),
    z.object({ op: z.literal("revive"), target: zTargetSpec, health: z.number().int().min(1) }).strict(),
    z.object({ op: z.literal("rotateLeaderCurrent"), side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("mill"), count: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({
      op: z.literal("scry"),
      count: z.number().int().min(1),
      mode: z.enum(["reorder", "bottomOne"]),
      side: z.enum(["friendly", "enemy"]).optional(),
      pick: z.enum(["random", "mostPlayable"]).optional(),
    }).strict(),
    z.object({ op: z.literal("swapAttackHealth"), target: zTargetSpec }).strict(),
    z.object({ op: z.literal("refract"), intoCurrent: zCurrentId.optional() }).strict(),
    z.object({ op: z.literal("attackAgain"), target: zTargetSpec }).strict(),
    z.object({ op: z.literal("addCounter"), key: z.string(), amount: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("setCounter"), key: z.string(), amount: zAmountExpr, side: z.enum(["friendly", "enemy"]).optional() }).strict(),
    z.object({ op: z.literal("winMatch") }).strict(),
    z.object({ op: z.literal("repeatAfterpartyThisTurn") }).strict(),
    z.object({ op: z.literal("aura"), target: zTargetSpec, attack: z.number().int().optional(), health: z.number().int().optional(), costDelta: z.number().int().optional(), grantKeyword: zKeywordId.optional() }).strict(),
  ])
);

export const zEffectDef = z
  .object({
    trigger: zTriggerId,
    target: zTargetSpec.optional(),
    playedFilter: zTargetFilter.optional(),
    reactionOn: zReactionConditionId.optional(),
    condition: zConditionExpr.optional(),
    ops: z.array(zEffectOp),
    once: z.boolean().optional(),
    oncePerTurn: z.boolean().optional(),
    text: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const zLeaderAbility = z
  .object({
    name: z.string().min(1),
    obsessionCost: z.number().int().min(0),
    target: zTargetSpec.optional(),
    ops: z.array(zEffectOp),
    text: z.string().min(1),
  })
  .strict();

export const zCardDef = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id required"),
    name: z.string().min(1),
    faction: zFactionId,
    current: zCurrentId,
    type: zCardType,
    rarity: zRarity,
    cost: z.number().int().min(0).max(12),
    tags: z.array(z.string()),
    keywords: z.array(zKeywordId),
    effects: z.array(zEffectDef),
    text: z.string(),
    flavor: z.string().optional(),
    art: z.string().optional(),
    token: z.boolean().optional(),
    variantOf: z.string().nullable().optional(),
    collab: z.object({ kind: z.enum(["current", "faction", "tag"]), value: z.string() }).strict().optional(),
    comeback: z.object({ mode: z.enum(["hand", "play"]), delayTurns: z.number().int().min(1) }).strict().optional(),
    grow: z.object({ turns: z.number().int().min(1), ops: z.array(zEffectOp) }).strict().optional(),
    overload: z.number().int().min(1).optional(),
    finale: z.boolean().optional(),
    // per-type fields
    attack: z.number().int().min(0).optional(),
    health: z.number().int().min(1).optional(),
    equipAttack: z.number().int().optional(),
    equipHealth: z.number().int().optional(),
    grantKeywords: z.array(zKeywordId).optional(),
    durability: z.number().int().min(1).optional(),
    durationTurns: z.number().int().min(1).optional(),
    primaryCurrent: zCurrentId.optional(),
    secondaryCurrent: zCurrentId.nullable().optional(),
    passive: z.array(zEffectDef).optional(),
    fixation: zLeaderAbility.optional(),
    ultimate: zLeaderAbility.optional(),
    title: z.string().optional(),
  })
  .strict()
  .superRefine((card, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `[${card.id}] ${message}` });
    if (card.type === "character") {
      if (card.attack === undefined || card.health === undefined) fail("characters need attack and health");
    }
    if (card.type === "event" && card.durationTurns === undefined) fail("events need durationTurns");
    if (card.type === "leader") {
      if (card.health === undefined) fail("leaders need health");
      if (!card.primaryCurrent) fail("leaders need primaryCurrent");
      if (card.primaryCurrent && card.current !== card.primaryCurrent) fail("leader.current must equal primaryCurrent");
      if (!card.fixation || !card.ultimate) fail("leaders need fixation and ultimate abilities");
      if (!card.title) fail("leaders need a title");
      if (!card.passive) fail("leaders need a passive array (may be empty)");
    }
    if (card.type === "reaction") {
      const reactionEffects = card.effects.filter((e) => e.trigger === "reaction");
      if (reactionEffects.length !== 1) fail("reaction cards need exactly one effect with trigger 'reaction'");
      if (reactionEffects[0] && !reactionEffects[0].reactionOn) fail("reaction effect needs reactionOn");
    }
    if (card.keywords.includes("collab") && !card.collab) fail("keyword collab requires the collab field");
    if (card.keywords.includes("comeback") && !card.comeback) fail("keyword comeback requires the comeback field");
    if (card.keywords.includes("grow") && !card.grow) fail("keyword grow requires the grow field");
    if (card.keywords.includes("overload") && card.overload === undefined) fail("keyword overload requires the overload field");
    if (card.type !== "leader" && (card.fixation || card.ultimate || card.passive || card.primaryCurrent)) {
      fail("leader-only fields present on non-leader card");
    }
    if (card.type !== "character" && card.type !== "leader" && (card.attack !== undefined || card.health !== undefined)) {
      fail("attack/health only allowed on characters (and health on leaders)");
    }
    if (!card.token && card.text.trim() === "" && card.effects.length > 0) fail("non-token cards with effects need rules text");
    for (const e of card.effects) {
      if (e.trigger === "reaction" && card.type !== "reaction") fail("trigger 'reaction' only on reaction cards");
      if (e.trigger === "eventTick" && card.type !== "event") fail("trigger 'eventTick' only on event cards");
      if (e.trigger === "activate" && card.type !== "location") fail("trigger 'activate' only on location cards");
    }
  });

export const zCardArray = z.array(zCardDef);

/**
 * A per-match card patch (`MatchConfig.cardOverrides`).
 *
 * Every numeric field is a delta and may be negative — "cost −1" is the single
 * most common upgrade in the game. The RESULT is validated against zCardDef, so
 * this schema only has to reject nonsense shapes; it cannot and should not try
 * to know whether a given delta lands in range.
 */
export const zCardPatch = z
  .object({
    cost: z.number().int().optional(),
    attack: z.number().int().optional(),
    health: z.number().int().optional(),
    keywords: z.array(zKeywordId).optional(),
    passive: z.array(zEffectDef).optional(),
    fixationCost: z.number().int().optional(),
    ultimateCost: z.number().int().optional(),
    textSuffix: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Other data files
// ---------------------------------------------------------------------------

export const zCurrentDef = z
  .object({
    id: zCurrentId,
    name: z.string(),
    element: z.string(),
    beats: z.array(zCurrentId),
    signatureKeyword: zKeywordId.nullable(),
    resonance: z.object({ name: z.string(), text: z.string(), ops: z.array(zEffectOp) }).strict().nullable(),
    icon: z.string(),
    colorToken: z.string(),
    frameShape: z.string(),
  })
  .strict();

export const zFactionDef = z
  .object({ id: zFactionId, name: z.string(), currents: z.array(zCurrentId).min(1), colorToken: z.string(), crest: z.string(), tagline: z.string() })
  .strict();

export const zConfluenceDef = z
  .object({
    id: zConfluenceId,
    name: z.string(),
    currents: z.tuple([zCurrentId, zCurrentId]).nullable(),
    text: z.string(),
    target: zTargetSpec.optional(),
    choice: z.array(z.object({ label: z.string(), ops: z.array(zEffectOp) }).strict()).optional(),
    ops: z.array(zEffectOp),
  })
  .strict();

export const zStatusDef = z
  .object({ id: zStatusId, name: z.string(), text: z.string(), polarity: z.enum(["positive", "negative"]), iconShape: z.string() })
  .strict();

export const zKeywordDef = z.object({ id: zKeywordId, name: z.string(), reminderText: z.string() }).strict();

/**
 * Balance numbers. Every field is non-negative: a negative deck size or hand
 * limit is nonsense, and `MatchConfig.balanceOverrides` lets boss fights and
 * weekly modifiers write these at runtime — so a typo'd modifier should fail
 * loudly at match start rather than deal a game nobody can play.
 */
export const zBalanceConfig = z
  .object({
    deck: z
      .object({
        size: z.number().int().nonnegative(),
        maxCopies: z.number().int().nonnegative(),
        maxCopiesLegendary: z.number().int().nonnegative(),
        prismSplashLimit: z.number().int().nonnegative(),
        /** 03 §4.3.2 twelve deck slots */
        slots: z.number().int().positive(),
      })
      .strict(),
    hand: z.object({ first: z.number().int().nonnegative(), second: z.number().int().nonnegative(), limit: z.number().int().nonnegative() }).strict(),
    leader: z.object({ startingHealth: z.number().int().nonnegative() }).strict(),
    board: z.object({ characterSlots: z.number().int().nonnegative(), locationSlots: z.number().int().nonnegative(), equipmentPerCharacter: z.number().int().nonnegative(), maxSetReactions: z.number().int().nonnegative() }).strict(),
    hype: z.object({ cap: z.number().int().nonnegative() }).strict(),
    draw: z.object({ perTurn: z.number().int().nonnegative() }).strict(),
    fatigue: z.object({ start: z.number().int().nonnegative(), increment: z.number().int().nonnegative() }).strict(),
    timer: z.object({ turnSeconds: z.number().int().nonnegative(), ropeSeconds: z.number().int().nonnegative() }).strict(),
    obsession: z
      .object({
        max: z.number().int().nonnegative(),
        fixationCost: z.number().int().nonnegative(),
        ultimateCost: z.number().int().nonnegative(),
        obsessedThreshold: z.number().int().nonnegative(),
        fullFixationResetTo: z.number().int().nonnegative(),
        supportPerTurn: z.number().int().nonnegative(),
        obsessedExtraDamageTaken: z.number().int().nonnegative(),
      })
      .strict(),
    resonance: z.object({ threshold: z.number().int().nonnegative() }).strict(),
    rules: z.object({ triggerCap: z.number().int().nonnegative(), elementalBonusDamage: z.number().int().nonnegative() }).strict(),
    economy: z
      .object({
        craftCost: z.record(zRarity, z.number().int().nonnegative()),
        dustValue: z.record(zRarity, z.number().int().nonnegative()),
        packSize: z.number().int().nonnegative(),
        /**
         * Merch Drops. Every number here is published to the player on the shop
         * panel, which is why they live in data rather than in the module: the
         * screen and the algorithm read the same source, so the printed odds
         * cannot drift away from the rolled ones.
         */
        pack: z
          .object({
            price: z.number().int().positive(),
            /** per-card rarity odds; must sum to 1 (checked in crossValidate) */
            rates: z.record(zRarity, z.number().min(0).max(1)),
            /** slot 5 upgrades if the Drop has produced nothing this good */
            minRarePerPack: z.number().int().min(0),
            /** a Legendary within this many Drops, counted since the last one */
            legendaryPity: z.number().int().positive(),
          })
          .strict(),
        /**
         * Headliner Banners (§4). Every number here is printed on the banner
         * page — the odds table, the Encore Meter's threshold, the Backstage
         * Shop's prices — and read by the pull resolver, so what a player is
         * shown and what is rolled come from one object.
         *
         * `featuredShare` is §4.2's split: of the 2% Legendary rate, half is the
         * featured Legendary and half is every other Legendary; likewise 4% of
         * the 8% Epic rate is split across the two featured Epics.
         */
        banner: z
          .object({
            pullPrice: z.number().int().positive(),
            /** §6 F2: the ×10 costs exactly ten pulls, never a discount */
            tenPullMultiple: z.number().int().positive(),
            rates: z.record(zRarity, z.number().min(0).max(1)),
            featuredShare: z.object({ legendary: z.number().min(0).max(1), epic: z.number().min(0).max(1) }).strict(),
            /** an Epic or better within every N pulls, rolling */
            epicPityWindow: z.number().int().positive(),
            /** the Target Card is granted on this pull since the meter last reset */
            hardPity: z.number().int().positive(),
            wishlistLimit: z.number().int().positive(),
            tokensPerPull: z.number().int().nonnegative(),
            tokenPrices: z.record(zRarity, z.number().int().positive()),
          })
          .strict(),
        /** a duplicate past the playable cap converts at this multiple of dust */
        dupeConversionBonus: z.number().min(1),
        /**
         * What finishing the Grand Tour pays (§3.4). Here rather than in the
         * module for the same reason the pack odds are: the tour screen prints
         * these three numbers as a promise before the first loaner match, and
         * the grant reads the same object, so the promise cannot drift from the
         * payment.
         */
        grandTour: z
          .object({
            clout: z.number().int().nonnegative(),
            drops: z.number().int().nonnegative(),
            /** how many Legendaries the player gets to choose */
            legendaryChoices: z.number().int().nonnegative(),
          })
          .strict(),
        /**
         * Mission income. §3.5 publishes a weekly total and calls it a contract,
         * so these live in data next to the pack odds for the same reason: the
         * screen prints them and the claim pays them from one object.
         */
        missions: z
          .object({
            dailyClout: z.number().int().nonnegative(),
            dailyXp: z.number().int().nonnegative(),
            weeklyClout: z.number().int().nonnegative(),
            weeklyXp: z.number().int().nonnegative(),
            firstWinOfDayClout: z.number().int().nonnegative(),
            weeklyWrapDrops: z.number().int().nonnegative(),
            weeklyRestockDrops: z.number().int().nonnegative(),
            /** F6 forbids expiry, so a banking window of zero is a policy failure */
            rookieRoadDays: z.number().int().positive(),
            rookieRoadMultiplier: z.number().positive(),
            /**
             * What finishing a match pays, win or lose.
             *
             * These were two literals inside `recordMatch` — the last two
             * numbers in the economy that the architecture contract's
             * data-driven mandate did not cover, and the two everything else in
             * `economy.*` is calibrated against.
             */
            match: z
              .object({ winClout: z.number().int().nonnegative(), lossClout: z.number().int().nonnegative() })
              .strict(),
            /**
             * 09 §3's AI daily Clout cap, expressed in **wins rather than
             * Clout**.
             *
             * §3 writes the cap as 200 against its own 20–30-per-win schedule,
             * which is eight wins at the top of it. This build pays more per
             * match than §3 assumes, so copying the 200 across would have made
             * the cap bite after three matches instead of eight — the same
             * number, a different rule. Storing the rule and deriving the number
             * is what `aiDailyCap()` does.
             */
            /** 09 §11's Daily Puzzle, called out separately from the daily rate */
            dailyPuzzleClout: z.number().int().nonnegative(),
            /**
             * 09 §11 pays a pack for seven completed dailies. It writes that as a
             * "7-day completion streak"; 07 §6 policy F6 forbids streak resets
             * outright. Storing the seven and paying it cumulatively keeps the
             * reward and drops the mechanic — see `game/dailies`.
             */
            dailyBonusDrops: z.number().int().nonnegative(),
            dailyBonusEvery: z.number().int().positive(),
            aiDailyCapWins: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const zAiProfile = z
  .object({
    id: z.string(),
    difficulty: z.enum(["beginner", "casual", "intermediate", "advanced", "expert", "boss"]),
    noise: z.number(),
    lethalAwareness: z.number().min(0).max(1),
    confluenceAwareness: z.number().min(0).max(1),
    searchDepth: z.number().int().min(1),
    style: z.enum(["aggressive", "defensive", "balanced", "combo"]),
    bossCards: z.array(z.string()).optional(),
    balanceOverrides: z.record(z.string(), z.number()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Cross-content checks
// ---------------------------------------------------------------------------

/** Referential integrity + design-rule checks across the whole ContentIndex. */
export function crossValidate(content: ContentIndex): string[] {
  const errors: string[] = [];
  const cards = Object.values(content.cards);
  const ids = new Set<string>();

  for (const card of cards) {
    if (ids.has(card.id)) errors.push(`duplicate card id: ${card.id}`);
    ids.add(card.id);
  }

  const opWalk = (ops: unknown[], visit: (op: Record<string, unknown>) => void): void => {
    for (const raw of ops) {
      const op = raw as Record<string, unknown>;
      visit(op);
      for (const key of ["ops", "then", "else"]) {
        if (Array.isArray(op[key])) opWalk(op[key] as unknown[], visit);
      }
      if (Array.isArray(op["options"])) {
        for (const opt of op["options"] as { ops?: unknown[] }[]) {
          if (Array.isArray(opt.ops)) opWalk(opt.ops, visit);
        }
      }
    }
  };

  const collectAllOps = (card: CardDef): unknown[] => {
    const groups: unknown[][] = card.effects.map((e) => e.ops as unknown[]);
    if (card.grow) groups.push(card.grow.ops as unknown[]);
    if (card.type === "leader") {
      const leader = card as LeaderCardDef;
      groups.push(leader.fixation.ops as unknown[], leader.ultimate.ops as unknown[]);
      for (const p of leader.passive) groups.push(p.ops as unknown[]);
    }
    return groups.flat();
  };

  for (const card of cards) {
    const faction = content.factions[card.faction];
    if (!faction) {
      errors.push(`[${card.id}] unknown faction ${card.faction}`);
      continue;
    }
    if (card.type !== "leader" && !card.token && !faction.currents.includes(card.current)) {
      errors.push(`[${card.id}] current '${card.current}' not permitted for faction '${card.faction}' (allowed: ${faction.currents.join(", ")})`);
    }
    if (card.type === "leader") {
      const leader = card as LeaderCardDef;
      if (!faction.currents.includes(leader.primaryCurrent)) {
        errors.push(`[${card.id}] leader primaryCurrent '${leader.primaryCurrent}' not in faction currents`);
      }
      if (leader.secondaryCurrent && !faction.currents.includes(leader.secondaryCurrent)) {
        errors.push(`[${card.id}] leader secondaryCurrent '${leader.secondaryCurrent}' not in faction currents`);
      }
    }
    if (card.variantOf && !content.cards[card.variantOf]) {
      errors.push(`[${card.id}] variantOf references unknown card '${card.variantOf}'`);
    }
    opWalk(collectAllOps(card), (op) => {
      if (op["op"] === "summon" && typeof op["cardId"] === "string") {
        const target = content.cards[op["cardId"] as string];
        if (!target) errors.push(`[${card.id}] summon references unknown card '${op["cardId"]}'`);
        else if (target.type !== "character") errors.push(`[${card.id}] summon target '${op["cardId"]}' is not a character`);
      }
      if (op["op"] === "transform" && typeof op["intoCardId"] === "string") {
        const target = content.cards[op["intoCardId"] as string];
        if (!target) errors.push(`[${card.id}] transform references unknown card '${op["intoCardId"]}'`);
        else if (target.type !== "character") errors.push(`[${card.id}] transform target '${op["intoCardId"]}' is not a character`);
      }
    });
  }

  // confluence integrity: every canonical pair present exactly once
  for (const conf of Object.values(content.confluences)) {
    if (conf.id !== "refraction" && !conf.currents) errors.push(`[confluence ${conf.id}] missing currents pair`);
  }

  // advantage cycle sanity: each natural current beats exactly one; prism beats none
  for (const current of Object.values(content.currents)) {
    if (current.id === "prism" && current.beats.length !== 0) errors.push("prism must have no natural advantage");
    if (current.id !== "prism" && current.beats.length !== 1) errors.push(`current ${current.id} must beat exactly one current`);
  }

  return errors;
}
