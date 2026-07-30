/**
 * AI profile loading. Difficulty tuning lives in data/ai-profiles.json so it
 * can be balanced without touching code.
 */

import type { AiDifficulty, AiProfile } from "../engine/types";
import { zAiProfile } from "../engine/validation";
import raw from "../../data/ai-profiles.json";

const profiles: Record<string, AiProfile> = {};

for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
  if (key.startsWith("_")) continue;
  const parsed = zAiProfile.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid AI profile '${key}': ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  }
  profiles[key] = parsed.data as AiProfile;
}

export function getAiProfile(difficulty: AiDifficulty): AiProfile {
  const profile = profiles[difficulty];
  if (!profile) throw new Error(`Unknown AI difficulty: ${difficulty}`);
  return profile;
}

export function allAiProfiles(): AiProfile[] {
  return Object.values(profiles);
}

export const AI_DIFFICULTY_ORDER: AiDifficulty[] = [
  "beginner",
  "casual",
  "intermediate",
  "advanced",
  "expert",
  "boss",
];

export const AI_DIFFICULTY_LABEL: Record<AiDifficulty, string> = {
  beginner: "Beginner",
  casual: "Casual",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
  boss: "Boss",
};

/** Flavourful blurbs for the mode-select screen. */
export const AI_DIFFICULTY_BLURB: Record<AiDifficulty, string> = {
  beginner: "Learning the ropes. Misses lethal about half the time.",
  casual: "Plays a fair game. Will not punish every mistake.",
  intermediate: "Trades well and notices your Confluences.",
  advanced: "Plans two steps ahead and closes games.",
  expert: "Optimal lines, full Confluence usage, no mercy.",
  boss: "Unique cards and rule twists. Bring a plan.",
};
