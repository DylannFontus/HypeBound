/**
 * Doomscroll map generation.
 *
 * A map is a pure function of (run seed, act index). Nothing is stored that
 * could not be regenerated, which is what makes a run seed shareable: the design
 * promises "same seed + same choices ⇒ same map, events, shops, offers and
 * battles", and that only holds if generation never reads a clock, a global RNG
 * or anything outside its arguments.
 *
 * Edges are generated non-crossing on purpose. Each node on a floor connects to
 * a contiguous, monotonically advancing range of the next floor, so the map can
 * be drawn as straight lines without a single crossing — a crossed edge on a
 * branching map reads as "these two paths merge", which is a lie the player only
 * discovers after committing to a node.
 */

import { nextInt, pickWeightedIndex, seedRng, subSeed, type RngState } from "../../engine/rng";
import { ROLLED_NODE_KINDS, type ActDef, type NodeKind, type RolledNodeKind } from "./data";

export interface MapNode {
  id: string;
  floor: number;
  index: number;
  kind: NodeKind;
  /** indexes into the NEXT floor's node array */
  next: number[];
}

export interface RunMap {
  actIndex: number;
  actId: string;
  floors: MapNode[][];
}

/**
 * Combine any number of parts into a uint32 seed (FNV-1a over their text).
 *
 * Used everywhere a sub-seed is needed — per act, per node, per shop — so that a
 * node's offer depends only on the run seed and where the node is, never on the
 * order in which the player happened to open things.
 *
 * It lives in the engine now: the Gauntlet's draft needs exactly the same thing,
 * and two modes seeding themselves two different ways would be two things to
 * keep honest. Re-exported here so this module's callers never had to care that
 * it moved. The U+001F separator between parts moved with it, spelled out rather
 * than left as the raw control byte it was written as here.
 */
export { subSeed } from "../../engine/rng";

export const nodeId = (actIndex: number, floor: number, index: number): string => `a${actIndex}f${floor}n${index}`;

/**
 * Nodes that should not appear twice on the same floor.
 *
 * A floor of three Merch Tables is not a choice, it is a corridor with extra
 * steps. Fights and Notifications may repeat — their contents differ — but the
 * service nodes are interchangeable, so a duplicate wastes the branch.
 */
const UNIQUE_PER_FLOOR: ReadonlySet<NodeKind> = new Set<NodeKind>(["shop", "rest", "recruit"]);

/** Elites are held back from the opening floors; act 1 floor 1 is far too early. */
const EARLIEST_ELITE_FLOOR = 2;

function rollKind(rng: RngState, act: ActDef, floor: number, taken: Set<NodeKind>): RolledNodeKind {
  /**
   * Excluded kinds are dropped from the candidate list rather than given a
   * weight of zero: `pickWeightedIndex` treats a non-positive weight as 1, so
   * "elite: 0" would still roll elites about one time in ninety. That matters
   * twice over — it is how an act says "no Elites on the opening floors", and it
   * is how someone editing the weight table turns a node type off.
   */
  const candidates = ROLLED_NODE_KINDS.filter((kind) => {
    if (kind === "elite" && floor < EARLIEST_ELITE_FLOOR) return false;
    return act.weights[kind] > 0;
  });
  if (candidates.length === 0) return "battle";
  const weights = candidates.map((kind) => act.weights[kind]);

  // Reroll once against a duplicate service node, then fall back to a fight
  // rather than looping — a weight table where every non-duplicate kind is 0
  // would otherwise spin forever.
  for (let attempt = 0; attempt < 2; attempt++) {
    const kind = candidates[pickWeightedIndex(rng, weights)]!;
    if (!UNIQUE_PER_FLOOR.has(kind) || !taken.has(kind)) return kind;
  }
  return "battle";
}

/**
 * Wire floor `f` to floor `f+1`.
 *
 * Each source i owns a contiguous range [lo, hi] of targets, and the base
 * partition hands every target to exactly one source — so every node on the next
 * floor is reachable and every node on this floor leads somewhere.
 *
 * Branching comes from letting two neighbouring sources SHARE the node on their
 * boundary, and only that node. That restriction is the whole point: edges cross
 * exactly when the target sequence, read in source order, goes backwards, so
 * ranges may touch at an endpoint but must never properly overlap. Widening both
 * bounds freely keeps `lo` and `hi` monotonic and still crosses — source 0
 * reaching target 1 while source 1 reaches target 0 is an inversion no amount of
 * monotonicity in the bounds prevents.
 */
function linkFloors(rng: RngState, from: MapNode[], toWidth: number): void {
  const n = from.length;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * toWidth) / n);
    lo.push(start);
    // a range can collapse to a single target when there are more sources than
    // targets; two sources then feed the same node, which is a merge, not a cross
    hi.push(Math.max(start, Math.floor(((i + 1) * toWidth) / n) - 1));
  }

  for (let i = 0; i < n - 1; i++) {
    if (hi[i]! + 1 !== lo[i + 1]!) continue; // already touching
    const roll = nextInt(rng, 100);
    if (roll < 35) hi[i] = hi[i]! + 1; // this node also leads right
    else if (roll < 70) lo[i + 1] = lo[i + 1]! - 1; // the next node also leads left
  }

  for (let i = 0; i < n; i++) {
    const targets: number[] = [];
    for (let j = lo[i]!; j <= hi[i]!; j++) targets.push(j);
    from[i]!.next = targets;
  }
}

export function generateActMap(act: ActDef, actIndex: number, runSeed: number): RunMap {
  const rng = seedRng(subSeed(runSeed, "act", actIndex, act.id));
  const floorCount = act.floorPlan.length;
  const floors: MapNode[][] = [];

  for (let floor = 0; floor < floorCount; floor++) {
    const width = act.widths[floor] ?? 1;
    const fixed = act.floorPlan[floor];
    const taken = new Set<NodeKind>();
    const nodes: MapNode[] = [];
    for (let index = 0; index < width; index++) {
      const kind: NodeKind = fixed ?? rollKind(rng, act, floor, taken);
      taken.add(kind);
      nodes.push({ id: nodeId(actIndex, floor, index), floor, index, kind, next: [] });
    }
    floors.push(nodes);
  }

  /**
   * The act's single Sponsor Drop replaces one rolled node. The validator has
   * already refused a treasureFloor that points at a fixed floor.
   *
   * Guarded rather than left to index into an empty array: an act that is one
   * scripted fight has no treasure floors, and `nextInt(rng, 0)` would both draw
   * from the stream and land on `undefined` — a silent no-op that happens to
   * work, which is the kind that stops working later.
   */
  if (act.treasureFloors.length > 0) {
    const treasureFloor = act.treasureFloors[nextInt(rng, act.treasureFloors.length)]!;
    const treasureRow = floors[treasureFloor];
    if (treasureRow && treasureRow.length > 0) {
      treasureRow[nextInt(rng, treasureRow.length)]!.kind = "treasure";
    }
  }

  /**
   * Guarantee one Elite per act when the act wants them at all.
   *
   * Elites are where artifacts come from, so a run that rolls none is a run with
   * a materially different power curve through no decision of the player's. The
   * player still chooses whether to walk into it.
   */
  if (act.weights.elite > 0 && !floors.some((row) => row.some((node) => node.kind === "elite"))) {
    const candidates = floors
      .flat()
      .filter((node) => node.floor >= EARLIEST_ELITE_FLOOR && act.floorPlan[node.floor] === null && node.kind !== "treasure");
    const chosen = candidates[nextInt(rng, Math.max(1, candidates.length))];
    if (chosen) chosen.kind = "elite";
  }

  for (let floor = 0; floor < floorCount - 1; floor++) {
    linkFloors(rng, floors[floor]!, floors[floor + 1]!.length);
  }

  return { actIndex, actId: act.id, floors };
}

/** The nodes reachable from `node`, as ids. The entry floor is reachable from nothing. */
export function nextNodeIds(map: RunMap, node: MapNode): string[] {
  const nextRow = map.floors[node.floor + 1];
  if (!nextRow) return [];
  return node.next.map((index) => nextRow[index]?.id).filter((id): id is string => id !== undefined);
}

export function findNode(map: RunMap, id: string): MapNode | null {
  for (const row of map.floors) {
    for (const node of row) if (node.id === id) return node;
  }
  return null;
}
