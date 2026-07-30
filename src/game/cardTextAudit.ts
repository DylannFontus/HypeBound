/**
 * Does a card do what it says?
 *
 * `docs/PROJECT-STATUS.md` listed this as unverifiable — "the validator cannot
 * verify that a card's `text` matches its `effects`" — and that is half wrong.
 * The *meaning* of a card is not checkable, but a great deal of the wiring is:
 * a keyword printed but not held, a number in the text that no op uses, a
 * trigger word naming a different trigger, a summoned token whose printed stats
 * are not the token's stats, an effect that quietly does something the text
 * never mentions.
 *
 * That last shape is the expensive one. **Flow** shipped firing on one of its
 * four canonical channels and nothing caught it, because the keyword existed and
 * so the card looked finished. A checker cannot read for meaning, but it can
 * refuse to let an ability be invisible.
 *
 * Nothing here knows any rules; it compares two descriptions of the same card
 * and reports where they disagree. The judgement about whether a disagreement is
 * a defect stays with a person, which is what the allowlist in the test is for.
 */

import type { CardDef, ContentIndex, EffectDef, EffectOp, LeaderCardDef } from "../engine/types";

export interface TextFinding {
  cardId: string;
  cardName: string;
  /** which part of the card — "text", "passive", "fixation", "ultimate" */
  part: string;
  /** the check that produced it, used as the allowlist key */
  check: TextCheck;
  message: string;
  text: string;
}

export type TextCheck =
  | "keyword-not-printed"
  | "trigger-word"
  | "numbers"
  | "once-limit"
  | "silent-op"
  | "gate-number"
  | "summon-stats"
  | "status-not-named"
  | "wrong-side"
  | "targeting";

/**
 * Reminder text — the `*(…)*` tail — is the engine explaining a keyword, not a
 * claim about this card. Stripped before checking anything the card asserts
 * about itself, and deliberately kept for the checks that only ask whether a
 * number was printed to the player at all.
 */
const stripReminders = (text: string): string => text.replace(/\*\([^)]*\)\*/g, " ");

/** Every op, however deeply nested inside if / forEach / chooseOne / randomOp. */
export function flattenOps(ops: readonly EffectOp[] | undefined, out: EffectOp[] = []): EffectOp[] {
  for (const op of ops ?? []) {
    out.push(op);
    const any = op as unknown as Record<string, unknown>;
    flattenOps(any["then"] as EffectOp[] | undefined, out);
    flattenOps(any["else"] as EffectOp[] | undefined, out);
    flattenOps(any["ops"] as EffectOp[] | undefined, out);
    for (const option of (any["options"] as { ops?: EffectOp[] }[] | undefined) ?? []) flattenOps(option.ops, out);
  }
  return out;
}

interface Unit {
  part: string;
  text: string;
  effects: EffectDef[];
}

/**
 * Split a card into the (text, ops) pairs a claim can be checked against.
 *
 * A leader's `text` describes its passive only — its Fixation and Ultimate carry
 * their own text and their own ops. An early version of this compared the card's
 * text against every op on the card and reported the entire leader roster as
 * broken, which was a bug in the check rather than in the content.
 */
function units(card: CardDef): Unit[] {
  if (card.type === "leader") {
    const leader = card as LeaderCardDef;
    const passive = leader.passive ?? [];
    const out: Unit[] = [
      { part: "passive", text: card.text?.trim() || passive.map((e) => e.text ?? "").join(" "), effects: passive },
    ];
    if (leader.fixation) out.push({ part: "fixation", text: leader.fixation.text, effects: [{ trigger: "activate", ops: leader.fixation.ops }] });
    if (leader.ultimate) out.push({ part: "ultimate", text: leader.ultimate.text, effects: [{ trigger: "activate", ops: leader.ultimate.ops }] });
    return out;
  }
  const effects: EffectDef[] = [...(card.effects ?? [])];
  if (card.grow) effects.push({ trigger: "growComplete", ops: card.grow.ops });
  return [{ part: "text", text: card.text ?? "", effects }];
}

/** Triggers that can only fire once in a turn anyway, so `oncePerTurn` adds nothing. */
const NATURALLY_ONCE = new Set(["startOfTurn", "afterparty", "eventTick", "enemyStartOfTurn", "onPlay", "growComplete", "reaction", "activate"]);

/** Words the house style uses for a count of one. */
const WORD_ONE: Record<string, number> = { a: 1, an: 1, another: 1, one: 1 };

function numbersIn(text: string, patterns: RegExp[]): Set<number> {
  const out = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      out.add(raw === undefined ? 1 : (WORD_ONE[raw.toLowerCase()] ?? Number(raw)));
    }
  }
  return out;
}

/** The numbers a condition turns on, and whether a `not` inverts them. */
function conditionNumbers(condition: unknown, negated = false, out: [number, boolean][] = []): [number, boolean][] {
  if (!condition || typeof condition !== "object") return out;
  const c = condition as Record<string, unknown>;
  // `min: 1` is structural — "you control at least one matching thing" — and is
  // never a number the card prints, so it is not a claim to check
  if (typeof c["min"] === "number" && (c["min"] as number) > 1) out.push([c["min"] as number, negated]);
  if (typeof c["value"] === "number") out.push([c["value"] as number, negated]);
  for (const child of (c["list"] as unknown[] | undefined) ?? []) conditionNumbers(child, negated, out);
  if (c["c"]) conditionNumbers(c["c"], !negated, out);
  return out;
}

/** Ops whose presence the text has to acknowledge, and the words that count. */
const FOOTPRINTS: [string, RegExp][] = [
  ["draw", /draw/i],
  ["heal", /restore|heal/i],
  ["banish", /banish|touch grass/i],
  ["destroy", /destroy|defeat/i],
  ["discard", /discard/i],
  ["summon", /summon/i],
  ["returnToHand", /return|bounce|back to (?:your|their) hand/i],
  ["gainHype", /hype/i],
  ["gainObsession", /obsession/i],
  ["removeObsession", /obsession/i],
  ["transform", /transform|becomes/i],
  ["cancel", /cancel/i],
  ["mill", /mill|top of|bottom of|deck/i],
  ["scry", /recommend|bury|look at/i],
  ["winMatch", /win the match/i],
];

/** Trigger words the house style uses, and the triggers each may legitimately mean. */
const TRIGGER_WORDS: [RegExp, string, string[]][] = [
  [/\bon play\b/i, "onPlay", ["onPlay"]],
  [/\*\*Afterparty[:.]/i, "afterparty", ["afterparty"]],
  [/(?<!\*\*)\bAfterparty:/i, "afterparty", ["afterparty"]],
  [/at the start of your turns?\b/i, "startOfTurn", ["startOfTurn", "eventTick", "activate"]],
  [/when this attacks/i, "onAttack", ["onAttack"]],
  [/\*\*Inspire[:.]/i, "inspire", ["inspire"]],
  [/\*\*Flow[:.]/i, "flow", ["flow"]],
  [/when this is defeated/i, "onDefeat", ["onDefeat"]],
];

/**
 * Every disagreement between what the cards say and what they do.
 *
 * Returns findings rather than throwing, so the caller decides which of them are
 * defects and which are the house style the checker has not been taught.
 */
export function auditCardText(content: ContentIndex): TextFinding[] {
  // leaders appear in `cards` as well as `leaders`, so this is deduplicated by
  // id — without it every leader was audited twice and reported twice
  const byId = new Map<string, CardDef>();
  for (const card of [...Object.values(content.cards), ...Object.values(content.leaders)]) byId.set(card.id, card);
  const everyCard = [...byId.values()];
  const findings: TextFinding[] = [];

  for (const card of everyCard) {
    const report = (part: string, check: TextCheck, message: string, text: string): void => {
      findings.push({ cardId: card.id, cardName: card.name, part, check, message, text });
    };

    // -- a keyword the card HAS that its text never names --------------------
    for (const id of card.keywords ?? []) {
      const name = content.keywords[id]?.name ?? id;
      if (!new RegExp(name.replace(/[-\s]/g, "[-\\s]"), "i").test(card.text ?? "")) {
        report("text", "keyword-not-printed", `has ${name}, which the text never prints`, card.text ?? "");
      }
    }

    for (const unit of units(card)) {
      const text = stripReminders(unit.text);
      const ops = flattenOps(unit.effects.flatMap((e) => e.ops ?? []));
      const kinds = new Set(ops.map((op) => op.op));
      const triggers = new Set(unit.effects.map((e) => e.trigger as string));
      // tokens and boss leaders print nothing; there is no claim to check
      if (card.token && !text.trim()) continue;

      // -- trigger words against trigger ids --------------------------------
      for (const [pattern, wanted, accepted] of TRIGGER_WORDS) {
        if (pattern.test(text) && !accepted.some((t) => triggers.has(t))) {
          report(unit.part, "trigger-word", `text reads as "${wanted}" but the effects are [${[...triggers].join(", ")}]`, unit.text);
        }
      }

      // -- numbers ----------------------------------------------------------
      const opNumbers = (kind: string, field = "amount"): Set<number> =>
        new Set(
          ops
            .filter((op) => op.op === kind && typeof (op as unknown as Record<string, unknown>)[field] === "number")
            .map((op) => (op as unknown as Record<string, number>)[field]!)
        );

      const claims: [string, Set<number>, Set<number>][] = [
        [
          "damage",
          numbersIn(text, [/deals? (\d+)(?: more)? damage/gi, /deals? (\d+) instead/gi, /takes? (\d+) damage/gi, /(\d+) damage to/gi]),
          opNumbers("damage"),
        ],
        ["healing", numbersIn(text, [/restores? (\d+)/gi, /heals? (\d+)/gi, /(\d+) health to/gi]), opNumbers("heal")],
        [
          "cards drawn",
          numbersIn(text, [/draws? (\d+) cards?/gi, /draws? (a|an|another) (?:additional |more )?card/gi, /draws? (\d+) instead/gi]),
          opNumbers("draw", "count"),
        ],
        ["Obsession gained", numbersIn(text, [/gains? (\d+) obsession/gi]), opNumbers("gainObsession")],
        ["Obsession removed", numbersIn(text, [/removes? (\d+) obsession/gi]), opNumbers("removeObsession")],
        ["Hype", numbersIn(text, [/gains? (\d+) (?:max )?hype/gi]), opNumbers("gainHype")],
      ];
      for (const [label, said, did] of claims) {
        if (said.size === 0 && did.size === 0) continue;
        for (const n of said) {
          if (!did.has(n)) report(unit.part, "numbers", `text says ${label} ${n}; the effects do [${[...did].join(", ") || "none"}]`, unit.text);
        }
        for (const n of did) {
          if (!said.has(n)) report(unit.part, "numbers", `the effects do ${label} ${n}; the text says [${[...said].join(", ") || "none"}]`, unit.text);
        }
      }

      /**
       * Stat changes come from three places: a `+A/+B` pair, a single-stat line
       * like "have -1 Attack", and an Equipment's own fields — which are not ops
       * at all, and which reported every Equipment in the game as promising a
       * bonus it did not grant until they were folded in here.
       */
      const said = new Set([...text.matchAll(/([+-]\d+)\/([+-]\d+)/g)].map((m) => `${Number(m[1])}/${Number(m[2])}`));
      for (const m of text.matchAll(/([+-]\d+) (attack|health)\b/gi)) {
        said.add(m[2]!.toLowerCase() === "attack" ? `${Number(m[1])}/0` : `0/${Number(m[1])}`);
      }
      const did = new Set(
        ops
          .filter((op) => {
            const any = op as unknown as Record<string, unknown>;
            return (op.op === "buff" || op.op === "aura") && (typeof any["attack"] === "number" || typeof any["health"] === "number");
          })
          .map((op) => {
            const any = op as unknown as Record<string, number | undefined>;
            return `${any["attack"] ?? 0}/${any["health"] ?? 0}`;
          })
      );
      if (unit.part === "text" && card.type === "equipment") {
        did.add(`${card.equipAttack ?? 0}/${card.equipHealth ?? 0}`);
      }
      for (const stat of said) {
        if (!did.has(stat)) report(unit.part, "numbers", `text says ${stat}; the effects give [${[...did].join(", ") || "none"}]`, unit.text);
      }
      for (const stat of did) {
        if (!said.has(stat)) report(unit.part, "numbers", `the effects give ${stat}; the text says [${[...said].join(", ") || "none"}]`, unit.text);
      }

      // -- once / oncePerTurn against a text that limits it ------------------
      for (const effect of unit.effects) {
        if (effect.oncePerTurn && !NATURALLY_ONCE.has(effect.trigger) && !/each turn|once per turn|first/i.test(unit.text)) {
          report(unit.part, "once-limit", `"${effect.trigger}" is once per turn but the text never limits it`, unit.text);
        }
        if (effect.once && !/first time|once per match|once a match|only once/i.test(unit.text)) {
          report(unit.part, "once-limit", `"${effect.trigger}" fires once per match but the text never says so`, unit.text);
        }
      }

      // -- an op with no textual footprint -----------------------------------
      for (const [kind, pattern] of FOOTPRINTS) {
        if (kinds.has(kind as EffectOp["op"]) && !pattern.test(unit.text)) {
          report(unit.part, "silent-op", `does "${kind}" but the text never mentions it`, unit.text);
        }
      }

      /**
       * The numbers a condition turns on.
       *
       * Deliberately weak: the number only has to appear somewhere in the printed
       * text, reminder included. Demanding "N or more" reported a third of the
       * pool, because the house style writes the same threshold as
       * "**Backlog (5):**", "At 4 Sunrise counters" and "up to 3 per turn". What
       * this is here to catch is a gate that turns on a number the card never
       * prints at all.
       */
      const printed = new Set([...(unit.text ?? "").matchAll(/\d+/g)].map((m) => Number(m[0])));
      const gates = [
        ...unit.effects.flatMap((e) => conditionNumbers(e.condition)),
        ...ops.filter((op) => op.op === "if").flatMap((op) => conditionNumbers((op as unknown as Record<string, unknown>)["condition"])),
      ];
      for (const [n, negated] of gates) {
        if (printed.has(n)) continue;
        // "2 or fewer" is encoded as not(atLeast 3), so a negated threshold sits
        // one above the number the player actually reads
        if (negated && printed.has(n - 1)) continue;
        report(unit.part, "gate-number", `a condition turns on ${n}, which the card never prints`, unit.text);
      }

      // -- summoned tokens, against the token actually summoned --------------
      for (const op of ops) {
        if (op.op !== "summon") continue;
        const token = byId.get(op.cardId);
        if (!token || token.type !== "character") {
          report(unit.part, "summon-stats", `summons "${op.cardId}", which is not a character card`, unit.text);
          continue;
        }
        const escaped = token.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`${token.attack}/${token.health}\\s+(?:\\*\\*)?${escaped}`, "i").test(text)) {
          report(unit.part, "summon-stats", `summons ${token.name} (${token.attack}/${token.health}), which the text does not print`, unit.text);
        }
      }

      /**
       * How a target is picked, and how long a change lasts.
       *
       * These are the claims that decide whether a card is playable rather than
       * how big it is: "a random enemy character" is a different card from "an
       * enemy character", and a buff that says "permanently" and is not is a
       * card that stops working at end of turn.
       */
      const targetsOf = (op: EffectOp): { select?: string; side?: string; filter?: { tag?: string[] } } | undefined =>
        (op as unknown as Record<string, { select?: string; side?: string; filter?: { tag?: string[] } } | undefined>)["target"];

      const saysRandom = /\brandom\b/i.test(text);
      // the effect's own target is where "a random friendly character" usually
      // lives; the op then reads `select: "triggering"` off that choice
      const anyRandom =
        ops.some((op) => targetsOf(op)?.select === "random") ||
        unit.effects.some((e) => (e.target as { select?: string } | undefined)?.select === "random");
      if (anyRandom && !saysRandom) report(unit.part, "targeting", "picks a RANDOM target but the text never says random", unit.text);
      // `discard` and `resurrect` pick at random by rule, so a card that says so
      // has nothing left to declare in its target spec
      if (saysRandom && !anyRandom && !ops.some((op) => op.op === "randomOp" || op.op === "discard" || op.op === "resurrect")) {
        report(unit.part, "targeting", "text says random but nothing is picked at random", unit.text);
      }

      /**
       * "Everyone" is written a dozen ways — "all", "each", "your other
       * characters", "the cards in your hand", "Enemy characters" — so this
       * looks for a determiner followed by a plural noun rather than a keyword.
       * A genuine mismatch still shows: "deal 2 damage to an enemy character"
       * is singular, and no phrasing of it matches.
       */
      const plain = text.replace(/\*\*/g, "");
      const saysEveryone =
        /\ball\b|\beach\b|\bevery\b|\bthem\b/i.test(plain) ||
        /\b(?:your|their|enemy|friendly|the|opposing|opponent's)\s+(?:other\s+)?(?:\w+\s+){0,2}\w{3,}s\b/i.test(plain) ||
        // a plural noun opening a sentence — "Characters in your hand cost (1) less."
        /(?:^|[.;:—]\s*)(?:\w+\s+){0,1}[A-Z]?\w{4,}s\b/.test(plain);
      const sweeps = (target: { select?: string; side?: string } | undefined, count: unknown): boolean =>
        // a spec with no side is the card's own binding, not a sweep; and a
        // `count` turns "all" into "this many of them", which is the idiom
        // `resurrect` uses for "return 2 characters from your discard"
        target?.select === "all" && target.side !== undefined && count === undefined;
      const hitsEveryone =
        ops.some((op) => sweeps(targetsOf(op), (op as unknown as Record<string, unknown>)["count"])) ||
        unit.effects.some((e) => sweeps(e.target as { select?: string; side?: string } | undefined, undefined));
      if (hitsEveryone && !saysEveryone) report(unit.part, "targeting", "hits EVERY matching character but the text reads as one", unit.text);

      /**
       * A tag the targeting filters on has to be a word the card prints, or the
       * player cannot tell which of their characters it means.
       */
      for (const op of ops) {
        for (const tag of targetsOf(op)?.filter?.tag ?? []) {
          if (!new RegExp(tag.replace(/-/g, "[-\\s]"), "i").test(unit.text)) {
            report(unit.part, "targeting", `only affects ${tag}s, which the text never says`, unit.text);
          }
        }
      }

      // -- statuses applied, against the status named in the text ------------
      for (const op of ops) {
        if (op.op !== "applyStatus") continue;
        const name = content.statuses[op.status]?.name ?? op.status;
        if (!new RegExp(name, "i").test(unit.text)) {
          report(unit.part, "status-not-named", `applies ${name} but the text never names it`, unit.text);
        }
      }

      /**
       * Which side an op lands on — checked only for damage and buffs, where
       * hitting the wrong side is a different card rather than a typo.
       * `select: "triggering"` inherits the effect's own target, so the side is
       * resolved through that first.
       */
      for (const effect of unit.effects) {
        for (const op of flattenOps(effect.ops)) {
          if (op.op !== "damage" && op.op !== "buff") continue;
          const target = op.target as unknown as { select?: string; side?: string } | undefined;
          const side = target?.select === "triggering" ? (effect.target as { side?: string } | undefined)?.side : target?.side;
          if (side !== "friendly" && side !== "enemy") continue;
          if (side === "enemy" && !/enem|opponent|their|rival/i.test(text)) {
            report(unit.part, "wrong-side", `${op.op}s an ENEMY but the text never says so`, unit.text);
          }
          if (side === "friendly" && !/friendly|your|yourself|its controller|\bthis\b/i.test(text)) {
            report(unit.part, "wrong-side", `${op.op}s a FRIENDLY but the text never says so`, unit.text);
          }
        }
      }
    }
  }

  return findings;
}
