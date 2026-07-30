/**
 * `data/events.json`, parsed and validated once.
 *
 * An event is a **data bundle** — `09-game-modes.md` §14: *"each event is a data
 * bundle (`data/events.json`): duration, modifiers, featured mode(s), missions,
 * currency id, shop stock."* Adding an event is a JSON edit and nothing else,
 * which is the requirement `00-core-rules.md` states for every content type.
 *
 * Two schemas are deliberately **not** defined here:
 *
 * - the mission `objective` block, imported from `../missions/data`, because
 *   events author the same objectives the daily and weekly missions do and a
 *   second definition would be a rule with two owners;
 * - the emblem name, imported from `../cosmetics/data`, because an event's card
 *   back and frame are drawn by the same renderer everything else uses and a
 *   shape it cannot draw must fail here rather than resolve to a blank.
 */

import { z } from "zod";
import raw from "../../../data/events.json";
import { zObjective } from "../missions/data";
import type { Objective } from "../missions/types";
import type { EffectDef } from "../../engine/types";
import { zEffectDef } from "../../engine/validation";
import { EMBLEMS, type EmblemId } from "../cosmetics/data";

const note = z.array(z.string()).optional();

const runSchema = z
  .object({ startAt: z.string().datetime(), days: z.number().int().positive() })
  .strict();

export type EventRun = z.infer<typeof runSchema>;

const currencySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** one glyph, drawn beside a balance — not an image, like every other icon here */
    symbol: z.string().min(1).max(2),
  })
  .strict();

export type EventCurrency = z.infer<typeof currencySchema>;

const missionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    objective: zObjective,
    /** event currency paid on completion */
    reward: z.number().int().positive(),
  })
  .strict();

/**
 * Declared rather than inferred, for one reason: `zObjective` builds its stat
 * enum from `SUM_STATS` through a cast, so Zod infers `stat: string` and loses
 * the union. The missions loader has the same boundary and solves it the same
 * way — validate with the schema, then assert the narrower type the rest of the
 * code actually wants. The validation is real; only the typing is asserted.
 */
export interface EventMissionDef {
  id: string;
  name: string;
  text: string;
  objective: Objective;
  reward: number;
}

/**
 * A shop row.
 *
 * `kind` decides what is paid out, and the union is closed so a typo cannot ship
 * a row that costs currency and grants nothing — the inert-reward bug, which
 * this project has now found often enough to schema against by default.
 */
const shopSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("cosmetic"),
      id: z.string().min(1),
      name: z.string().min(1),
      /** a cosmetic id, resolved through `cosmeticById` — checked, not trusted */
      ref: z.string().min(1),
      cost: z.number().int().positive(),
      stock: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["drops", "signal", "clout"]),
      id: z.string().min(1),
      name: z.string().min(1),
      amount: z.number().int().positive(),
      cost: z.number().int().positive(),
      stock: z.number().int().positive(),
    })
    .strict(),
]);

export type EventShopEntry = z.infer<typeof shopSchema>;

const completionSchema = z
  .object({
    /** how many of the event's missions earn the meta-reward */
    missionsRequired: z.number().int().positive(),
    /** §14's *"completion meta-reward (e.g., event profile frame)"* */
    cosmeticId: z.string().min(1),
  })
  .strict();

const eventSchema = z
  .object({
    _note: note,
    id: z.string().min(1),
    name: z.string().min(1),
    blurb: z.string().min(1),
    /** the accent the screen, the card back and the frame all draw in */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    emblem: z.enum(EMBLEMS as unknown as [string, ...string[]]),
    /** §4.4.3's *"rules popup per event"* */
    rules: z.array(z.string().min(1)).min(1),
    currency: currencySchema,
    /** mode ids the event points at, matched against the mode-select list */
    featuredModes: z.array(z.string().min(1)).min(1),
    /**
     * Every run window this event will ever have, reruns included, from the
     * start. §14 makes reruns policy rather than goodwill, and `checkEventData`
     * holds the data to it.
     */
    runs: z.array(runSchema).min(2),
    missions: z.array(missionSchema).min(1),
    shop: z.array(shopSchema).min(1),
    completion: completionSchema,
  })
  .strict();

export type EventDef = Omit<z.infer<typeof eventSchema>, "missions" | "emblem"> & {
  missions: EventMissionDef[];
  emblem: EmblemId;
};

/**
 * A weekly rule modifier — `09-game-modes.md` §12, the Remix Queue.
 *
 * §12 puts these in `data/events.json` rather than a file of their own, so here
 * they are. Three general mechanisms, no new engine concepts:
 *
 * - `balance` becomes `MatchConfig.balanceOverrides`, whose own comment in
 *   `types.ts` already reads *"balance overrides for boss battles / weekly
 *   modifiers"*;
 * - `passive` becomes a `CardPatch.passive` appended to **both** leaders —
 *   *"how an artifact attaches to a player"*, applied twice instead of once;
 * - `costCeiling` becomes computed `cardOverrides`.
 *
 * `passive` is validated with the engine's own `zEffectDef`. A modifier is a
 * card rule written in the ordinary DSL, exactly as a boss twist is, so it must
 * answer to the same schema — a second one would let a modifier ship an op no
 * card could use.
 */
const remixModifierSchema = z
  .object({
    _note: note,
    id: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    balance: z.record(z.string(), z.number()).optional(),
    passive: z.array(zEffectDef).optional(),
    /** every card costing more than this costs exactly this */
    costCeiling: z.number().int().positive().optional(),
    /** present when the modifier is in the launch table but not playable yet */
    deferred: z.string().min(1).optional(),
  })
  .strict();

const remixSchema = z
  .object({
    _note: note,
    /** §12's weekly quest: "Win 3 Remix matches" */
    questWinsRequired: z.number().int().positive(),
    questClout: z.number().int().positive(),
    modifiers: z.array(remixModifierSchema).min(1),
  })
  .strict();

/** Declared rather than inferred, so `passive` keeps the engine's `EffectDef`. */
export interface RemixModifierDef {
  id: string;
  name: string;
  text: string;
  balance?: Record<string, number>;
  passive?: EffectDef[];
  costCeiling?: number;
  deferred?: string;
}

export interface RemixFile {
  questWinsRequired: number;
  questClout: number;
  modifiers: RemixModifierDef[];
}

const fileSchema = z
  .object({
    _readme: note,
    /** §14's "within 2 seasons"; a season is eight weeks */
    rerunWithinWeeks: z.number().int().positive(),
    /** 07 §3's 1 : 5 — one place, so the promise and the payout cannot drift */
    conversionToClout: z.number().int().positive(),
    /** §12's weekly rule modifiers, which §12 puts in this file */
    remix: remixSchema,
    events: z.array(eventSchema).min(1),
  })
  .strict();

export type EventsFile = Omit<z.infer<typeof fileSchema>, "events" | "remix"> & {
  events: EventDef[];
  remix: RemixFile;
};

export class EventDataError extends Error {}

let cache: EventsFile | null = null;

/** Strip `_note` and `_readme` keys at any level — they are comments, not data. */
function stripNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, entry]) => [key, stripNotes(entry)])
    );
  }
  return value;
}

/** `data/events.json`, parsed once. Throws on a malformed file rather than limping. */
export function eventsData(): EventsFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new EventDataError(`data/events.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cache = parsed.data as EventsFile;
  return cache;
}

/**
 * One event by id.
 *
 * Lives in the data module rather than beside the rest of the calendar helpers
 * so that  can resolve an event's card back and frame
 * without importing the events module — which imports cosmetics, and would
 * close a cycle.
 */
export const eventById = (id: string): EventDef | null =>
  eventsData().events.find((event) => event.id === id) ?? null;
