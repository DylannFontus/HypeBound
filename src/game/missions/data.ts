/**
 * `data/missions.json`, parsed and cross-checked.
 *
 * Same contract as the story rule library, the Doomscroll data and the starter
 * lists: the file is the source of truth, it is validated on load, and a mission
 * naming something that does not exist is a load error rather than a mission
 * that can never be completed.
 *
 * That last failure mode is the one worth guarding hardest. A card that names a
 * missing id fails loudly the first time it is played; a *mission* that names a
 * missing Current simply never progresses, and looks exactly like a player who
 * has not got round to it.
 */

import { z } from "zod";
import type { ContentIndex } from "../../engine/types";
import type { MissionDef } from "./types";
import { SUM_STATS } from "./types";
import raw from "../../../data/missions.json";

const zSumStat = z.enum(SUM_STATS as unknown as [string, ...string[]]);

const zFilter = z
  .object({
    won: z.boolean().optional(),
    modes: z.array(z.string().min(1)).min(1).optional(),
    primaryCurrents: z.array(z.string().min(1)).min(1).optional(),
    atLeast: z.object({ stat: zSumStat, value: z.number().positive() }).strict().optional(),
    deckEditedThisPeriod: z.boolean().optional(),
    factionMasteryBelow: z.number().int().positive().optional(),
    leaderMasteryBelow: z.number().int().positive().optional(),
  })
  .strict();

const zRequirement = z.union([
  z.object({ need: z.literal("sum"), stat: zSumStat, target: z.number().int().positive(), filter: zFilter.optional() }).strict(),
  z.object({ need: z.literal("matches"), target: z.number().int().positive(), filter: zFilter.optional() }).strict(),
  z
    .object({
      need: z.literal("distinct"),
      of: z.enum(["faction", "primaryCurrent", "mode"]),
      target: z.number().int().positive(),
      filter: zFilter.optional(),
    })
    .strict(),
]);

/**
 * Exported because events author objectives too.
 *
 * `data/events.json` carries the same `objective` block, and the only thing
 * worse than two schemas for one shape is two schemas for one shape that agree
 * today. There is one definition of what a valid objective looks like, and this
 * is it; `src/game/events/data.ts` imports it rather than restating it.
 */
export const zObjective = z
  .object({ all: z.array(zRequirement).min(1).optional(), any: z.array(zRequirement).min(1).optional() })
  .strict()
  // an objective with neither is a mission nothing can ever complete; one with
  // both is a mission whose meaning depends on which branch the reader assumes
  .refine((value) => Boolean(value.all) !== Boolean(value.any), {
    message: "an objective needs exactly one of `all` or `any`",
  });

const zMission = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    specific: z.boolean().optional(),
    objective: zObjective,
  })
  .strict();

const fileSchema = z.object({ daily: z.array(zMission).min(1), weekly: z.array(zMission).min(1) });

export class MissionDataError extends Error {}

let cache: { daily: MissionDef[]; weekly: MissionDef[] } | null = null;

function load(): { daily: MissionDef[]; weekly: MissionDef[] } {
  if (cache) return cache;
  const stripped = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_")));
  const parsed = fileSchema.safeParse(stripped);
  if (!parsed.success) {
    throw new MissionDataError(
      "data/missions.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = {
    daily: parsed.data.daily.map((mission) => ({ ...mission, cadence: "daily" }) as MissionDef),
    weekly: parsed.data.weekly.map((mission) => ({ ...mission, cadence: "weekly" }) as MissionDef),
  };
  return cache;
}

export const dailyPool = (): MissionDef[] => load().daily;
export const weeklyPool = (): MissionDef[] => load().weekly;
export const allMissions = (): MissionDef[] => [...load().daily, ...load().weekly];

export function missionById(id: string): MissionDef | null {
  return allMissions().find((mission) => mission.id === id) ?? null;
}

/**
 * Every problem with the pool, checked against real content.
 *
 * Separate from parsing because it needs the content index: the schema can say a
 * filter names two Currents, and only `currents.json` can say whether they are
 * Currents that exist.
 */
export function checkMissionData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const mission of allMissions()) {
    const where = `${mission.cadence} "${mission.id}"`;
    if (seen.has(mission.id)) problems.push(`${where}: duplicate id`);
    seen.add(mission.id);

    const requirements = mission.objective.all ?? mission.objective.any ?? [];
    for (const requirement of requirements) {
      const filter = requirement.filter;
      for (const current of filter?.primaryCurrents ?? []) {
        if (!content.currents[current as keyof typeof content.currents]) {
          problems.push(`${where}: names Current "${current}", which does not exist`);
        }
      }
      if (requirement.need === "distinct" && requirement.target < 2) {
        // "1 different faction" is satisfied by any single match and reads as a
        // variety mission that is not one
        problems.push(`${where}: a distinct requirement of ${requirement.target} asks for no variety at all`);
      }
    }
  }
  return problems;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetMissionData(): void {
  cache = null;
}
