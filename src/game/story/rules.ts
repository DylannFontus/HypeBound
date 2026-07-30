/**
 * The battle-rule library — `data/story/rules.json`.
 *
 * A story writer bends a battle by naming a rule, not by writing one. That is
 * the whole point of the split: the writer types `RULE: clip farm` and gets both
 * the mechanics and the sentence the player reads, while the mechanics
 * themselves are ordinary `EffectDef`s authored once by somebody who knows the
 * effects DSL and validated by the same schema every card in the game goes
 * through.
 *
 * The effects are injected into one seat's leader passive bundle, exactly like a
 * Weekly Boss twist or a Doomscroll artifact. There is no story-shaped hook in
 * the engine, and nothing here can invent a mechanic the game does not already
 * have.
 */

import { z } from "zod";
import type { StoryRule } from "./types";
import { zEffectDef } from "../../engine/validation";
import library from "../../../data/story/rules.json";

/**
 * Drop `_`-prefixed keys at every depth.
 *
 * JSON has no comments and this file is meant to be edited by hand, so a note
 * has to live in a key. Stripping at every level rather than only the top means
 * a note can sit next to the thing it is about.
 */
function stripNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      out[key] = stripNotes(child);
    }
    return out;
  }
  return value;
}

const ruleSchema = z
  .object({
    name: z.string().min(1),
    text: z.string().min(1),
    side: z.enum(["you", "opponent"]),
    /**
     * Optional, because a rule that only re-prices a leader's abilities has
     * nothing to add to the passive bundle. The refinement below is what keeps
     * "optional" from becoming "a rule that does nothing".
     */
    effects: z.array(zEffectDef).default([]),
    fixationCost: z.number().int().optional(),
    ultimateCost: z.number().int().optional(),
    balanceOverrides: z.record(z.string(), z.number()).optional(),
  })
  .strict()
  .refine(
    (rule) =>
      rule.effects.length > 0 ||
      rule.fixationCost !== undefined ||
      rule.ultimateCost !== undefined ||
      Object.keys(rule.balanceOverrides ?? {}).length > 0,
    { message: "does nothing: needs effects, fixationCost, ultimateCost or balanceOverrides" }
  );

const librarySchema = z.record(z.string(), ruleSchema);

export class StoryRuleError extends Error {}

let cache: StoryRule[] | null = null;

/** Every rule, in file order — which is the order the writer's menu is printed in. */
export function storyRules(): StoryRule[] {
  if (cache) return cache;
  const raw = stripNotes(library) as Record<string, unknown>;
  const parsed = librarySchema.safeParse(raw);
  if (!parsed.success) {
    throw new StoryRuleError(
      "data/story/rules.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = Object.entries(parsed.data).map(([id, rule]) => ({ id, ...rule }) as StoryRule);
  return cache;
}

/** Test hook: re-read the library after a fixture replaced it. */
export function resetStoryRules(): void {
  cache = null;
}
