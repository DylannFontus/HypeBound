/**
 * Deterministic seeded PRNG (sfc32). The ONLY source of randomness in the
 * engine. State lives inside MatchState.rngState as a 4-word tuple and is
 * mutated in place (the reducer operates on a cloned state, so this is safe
 * and keeps replays byte-exact).
 */

import type { MatchState } from "./types";

export type RngState = [number, number, number, number];

/** splitmix32 — used only to expand a single seed into sfc32 state. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const mix = splitmix32(seed);
  const state: RngState = [mix(), mix(), mix(), mix()];
  // warm up so nearby seeds diverge fully
  for (let i = 0; i < 12; i++) nextU32(state);
  return state;
}

/** Advance the generator and return a uint32. Mutates `state` in place. */
export function nextU32(state: RngState): number {
  const [a, b, c, dIn] = state;
  let t = (a + b) | 0;
  const a2 = b ^ (b >>> 9);
  const b2 = (c + (c << 3)) | 0;
  const c2 = ((c << 21) | (c >>> 11)) >>> 0;
  const d2 = (dIn + 1) | 0;
  t = (t + d2) | 0;
  const c3 = (c2 + t) | 0;
  state[0] = a2;
  state[1] = b2;
  state[2] = c3;
  state[3] = d2;
  return t >>> 0;
}

/** Uniform integer in [0, maxExclusive). maxExclusive must be >= 1. */
export function nextInt(state: RngState, maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  // rejection sampling to avoid modulo bias
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let x = nextU32(state);
  while (x >= limit) x = nextU32(state);
  return x % maxExclusive;
}

/** Fisher-Yates shuffle in place. */
export function shuffle<T>(state: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Pick one element (undefined for empty arrays). */
export function pickOne<T>(state: RngState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[nextInt(state, arr.length)];
}

/** Pick up to n distinct elements. */
export function pickMany<T>(state: RngState, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  shuffle(state, copy);
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

/** Weighted pick over indexes of `weights` (weights default to 1). */
export function pickWeightedIndex(state: RngState, weights: (number | undefined)[]): number {
  const w = weights.map((x) => (x === undefined || x <= 0 ? 1 : x));
  const total = w.reduce((s, x) => s + x, 0);
  let roll = nextInt(state, total);
  for (let i = 0; i < w.length; i++) {
    roll -= w[i]!;
    if (roll < 0) return i;
  }
  return w.length - 1;
}

/** Convenience for modules holding a MatchState. */
export const rngOf = (state: MatchState): RngState => state.rngState;

/**
 * U+001F between parts, so `subSeed("a","bc")` and `subSeed("ab","c")` differ.
 *
 * Named rather than typed inline as the raw control byte it used to be. The
 * separator is load-bearing: remove it and every seed derived through here
 * silently re-rolls. An invisible character is exactly the kind a reformat, a
 * copy-paste or a careless editor deletes without anybody seeing it.
 */
const SEED_SEPARATOR = String.fromCharCode(0x1f);

/**
 * Derive a stable sub-seed from a run seed and whatever names the thing being
 * rolled — FNV-1a over the stringified parts.
 *
 * Every seeded mode needs this and each one needs the *same* one: a roll keyed
 * by (run seed, where it is, what it is) is what lets a map, a shop or a draft
 * pick be re-derived instead of stored, and two modes with two hashes would be
 * two things to keep honest. It began in the Doomscroll's map and moved here
 * when the Gauntlet's draft wanted it too.
 */
export function subSeed(...parts: (number | string)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = `${part}${SEED_SEPARATOR}`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

/**
 * Uniform float in [0, 1). Needed wherever weights are fractional — `nextInt`
 * takes an integer bound, so a weighted pick over non-integer weights cannot go
 * through it without first destroying the fractions it was given.
 */
export const nextFloat = (state: RngState): number => nextU32(state) / 0x100000000;
