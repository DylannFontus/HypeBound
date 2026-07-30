/**
 * The Doomscroll: data, map generation and the run state machine.
 *
 * The run is a pure function of (seed, choices), which is what makes this
 * testable at all — the interesting failures in a roguelike are not "the button
 * did nothing", they are "the map had an unreachable node", "the shop charged
 * for a removal you cancelled" and "the run stranded the player with no legal
 * move on floor five". None of those are visible from a screenshot, and all of
 * them are visible from here.
 */

import { describe, expect, it } from "vitest";
import { getContent, resolveMatchContent } from "../src/engine/content";
import { parseRoguelikeData, upgradableCardIds, upgradeFor, type RoguelikeData } from "../src/game/doomscroll/data";
import { findNode, generateActMap, nextNodeIds, type MapNode, type RunMap } from "../src/game/doomscroll/map";
import {
  abandonRun,
  battleCardOverrides,
  battleCardVariants,
  battleFor,
  deckListFor,
  enterNode,
  reachableNodeIds,
  removalPrice,
  resolveBattle,
  resolvePrompt,
  runOver,
  startFight,
  startRun,
  summarize,
  type RunChoice,
  type RunState,
} from "../src/game/doomscroll/run";
import rawData from "../data/roguelike.json";

const content = getContent();
const data = parseRoguelikeData(rawData, content);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

describe("roguelike data", () => {
  it("validates against real content", () => {
    expect(data.acts.length).toBeGreaterThan(0);
    expect(data.leaders.length).toBeGreaterThan(0);
  });

  it("gives every act boss a leader whose twist is a real passive", () => {
    for (const act of data.acts) {
      const leader = content.leaders[act.boss.leaderCardId];
      expect(leader, `${act.id} boss card`).toBeDefined();
      // the twist IS the passive; an empty one means the map promised a rule
      // change and the fight delivers a normal opponent
      expect(leader!.passive.length, `${act.id} twist "${act.boss.twistName}" does nothing`).toBeGreaterThan(0);
    }
  });

  it("only offers run leaders the player could actually be", () => {
    for (const leader of data.leaders) {
      expect(content.leaders[leader.leaderCardId]!.token).not.toBe(true);
      for (const cardId of leader.deck) {
        expect(content.cards[cardId], `${leader.leaderCardId} deck card ${cardId}`).toBeDefined();
        expect(content.cards[cardId]!.token).not.toBe(true);
      }
    }
  });

  it("offers recruits that are characters from real factions", () => {
    for (const cardId of data.recruits) {
      const card = content.cards[cardId];
      expect(card, cardId).toBeDefined();
      expect(card!.type).toBe("character");
      expect(card!.token).not.toBe(true);
    }
  });

  const reject = (mutate: (draft: RoguelikeData) => void): string => {
    const draft = clone(rawData) as unknown as RoguelikeData;
    mutate(draft);
    try {
      parseRoguelikeData(draft, content);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  };

  it("refuses a Sponsor Drop placed on a fixed floor", () => {
    // this is the one that quietly eats the pre-boss Touch Grass Break
    expect(reject((d) => (d.acts[0]!.treasureFloors = [5]))).toContain("fixed");
  });

  it("refuses an act that does not end in a boss", () => {
    expect(reject((d) => (d.acts[0]!.floorPlan[6] = null))).toContain("last floor must be the boss");
  });

  it("refuses a token leader as a run leader or an enemy", () => {
    expect(reject((d) => (d.leaders[0]!.leaderCardId = "tut-practice-bot"))).toContain("token leader");
    expect(reject((d) => (d.acts[0]!.enemyLeaders[0] = "boss-dj-last-call"))).toContain("token leader");
  });

  it("refuses a boss whose twist is only a blurb", () => {
    // strip the passive off the real boss card: the twist text stays, the rule
    // change vanishes, and that is exactly the failure worth catching
    const bossId = data.acts[0]!.boss.leaderCardId;
    const gutted = {
      ...content,
      leaders: { ...content.leaders, [bossId]: { ...content.leaders[bossId]!, passive: [] } },
    };
    expect(() => parseRoguelikeData(clone(rawData), gutted)).toThrow(/does nothing/);
  });

  it("refuses a starting deck holding a token", () => {
    expect(reject((d) => (d.leaders[0]!.deck[0] = "token-sprout"))).toContain("token");
  });

  it("refuses an unknown enemy leader", () => {
    expect(reject((d) => (d.acts[0]!.enemyLeaders.push("nope-who")))).toContain("unknown enemy leader");
  });

  it("refuses a fragment gate no run could ever satisfy", () => {
    /**
     * Fragments come one per act, from that act's Elite. An act asking for more
     * than the acts in front of it can supply is a finale nobody ever sees — and
     * it fails silently, which is the whole reason this is checked at load.
     */
    expect(reject((d) => (d.acts[1]!.requiresFragments = 5))).toContain("can never be entered");
    // and the shipped gate is satisfiable, which is the other half of the claim
    expect(() => parseRoguelikeData(clone(rawData), content)).not.toThrow();
  });

  it("refuses an act that rolls fight nodes with no enemies to put in them", () => {
    expect(reject((d) => (d.acts[0]!.enemyLeaders = []))).toContain("no enemy leaders");
  });

  it("refuses a Sponsor Drop on an act with no rolled floors to put it on", () => {
    const finale = data.acts.findIndex((a) => a.requiresFragments !== undefined);
    expect(reject((d) => (d.acts[finale]!.treasureFloors = [0]))).toContain("nothing to replace");
  });
});

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

describe("map generation", () => {
  const forEachMap = (fn: (map: RunMap, actIndex: number, seed: number) => void): void => {
    for (const seed of SEEDS) {
      data.acts.forEach((act, index) => fn(generateActMap(act, index, seed), index, seed));
    }
  };

  it("connects every node in both directions", () => {
    forEachMap((map) => {
      for (let floor = 0; floor < map.floors.length - 1; floor++) {
        const from = map.floors[floor]!;
        const to = map.floors[floor + 1]!;
        // every node leads somewhere
        for (const node of from) expect(node.next.length, `${node.id} is a dead end`).toBeGreaterThan(0);
        // and every node can be arrived at
        const incoming = new Set(from.flatMap((n) => n.next));
        for (let i = 0; i < to.length; i++) {
          expect(incoming.has(i), `${to[i]!.id} is unreachable`).toBe(true);
        }
      }
    });
  });

  it("never crosses an edge", () => {
    /**
     * Two edges cross exactly when a later source reaches an earlier target, so
     * the test is: read every edge in source order and the targets must never go
     * backwards. Checking only that `lo` and `hi` advance is NOT the same claim
     * and passes on maps that visibly cross — source 0 → target 1 alongside
     * source 1 → target 0 satisfies monotonic bounds and still draws an X.
     */
    forEachMap((map, actIndex, seed) => {
      for (const row of map.floors) {
        let last = -1;
        for (const node of row) {
          for (let i = 1; i < node.next.length; i++) {
            expect(node.next[i], `${node.id} has a gap in its targets`).toBe(node.next[i - 1]! + 1);
          }
          for (const target of node.next) {
            expect(target, `crossing edge at ${node.id} (act ${actIndex}, seed ${seed})`).toBeGreaterThanOrEqual(last);
            last = target;
          }
        }
      }
    });
  });

  it("honours the floor plan, one Sponsor Drop and at least one Elite", () => {
    forEachMap((map, actIndex) => {
      const act = data.acts[actIndex]!;
      const all = map.floors.flat();
      const rollsFloors = act.floorPlan.some((f) => f === null);

      if (rollsFloors) {
        expect(all.filter((n) => n.kind === "treasure").length, `act ${actIndex}`).toBe(1);
        expect(all.some((n) => n.kind === "elite"), `act ${actIndex} has no Elite`).toBe(true);
      } else {
        /**
         * A single scripted fight — the optional finale. Asserted positively
         * rather than skipped: "this act rolls nothing" is a claim worth making,
         * and excusing it from the checks above would let a mis-authored act
         * quietly stop generating a map at all.
         */
        expect(map.floors.length, `act ${actIndex} should be one floor`).toBe(1);
        expect(all.length).toBe(1);
        expect(all.filter((n) => n.kind === "treasure").length).toBe(0);
        expect(all.filter((n) => n.kind === "elite").length).toBe(0);
      }

      expect(map.floors[map.floors.length - 1]!.map((n) => n.kind)).toEqual(["boss"]);
      act.floorPlan.forEach((fixed, floor) => {
        if (!fixed) return;
        for (const node of map.floors[floor]!) {
          // the Sponsor Drop is allowed to replace a rolled node only
          expect(node.kind, `act ${actIndex} floor ${floor}`).toBe(fixed);
        }
      });
    });
  });

  it("never repeats a service node on one floor", () => {
    forEachMap((map) => {
      for (const row of map.floors) {
        for (const kind of ["shop", "rest", "recruit"] as const) {
          const count = row.filter((n) => n.kind === kind).length;
          // fixed floors (the pre-boss Break) are allowed to be all one kind
          if (row.length > 1 && count > 1) expect(row.every((n) => n.kind === kind)).toBe(true);
        }
      }
    });
  });

  it("holds Elites back from the opening floors, and honours a zero weight", () => {
    // pickWeightedIndex reads a non-positive weight as 1, so a kind that is
    // meant to be off has to be excluded from the candidates, not zero-weighted
    const noEvents = { ...data.acts[0]!, weights: { ...data.acts[0]!.weights, event: 0 } };
    for (const seed of SEEDS) {
      for (const node of generateActMap(data.acts[0]!, 0, seed).floors.flat()) {
        if (node.kind === "elite") expect(node.floor, `elite on floor ${node.floor}`).toBeGreaterThanOrEqual(2);
      }
      for (const node of generateActMap(noEvents, 0, seed).floors.flat()) {
        expect(node.kind, "a zero-weight node kind still appeared").not.toBe("event");
      }
    }
  });

  it("distributes rolled nodes roughly as the weight table says", () => {
    // a silently wrong picker produces a map that looks plausible and plays
    // nothing like the design; only a count catches it
    const act = data.acts[0]!;
    const counts = new Map<string, number>();
    let total = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const map = generateActMap(act, 0, seed * 7919);
      map.floors.forEach((row, floor) => {
        if (act.floorPlan[floor] !== null) return;
        for (const node of row) {
          counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
          total += 1;
        }
      });
    }
    // the Sponsor Drop overwrites one rolled node per act, so shares run a
    // little under the table; generous bounds, because this is a smoke check
    const share = (kind: string): number => ((counts.get(kind) ?? 0) / total) * 100;
    expect(share("battle")).toBeGreaterThan(35);
    expect(share("event")).toBeGreaterThan(14);
    expect(share("event")).toBeLessThan(26);
    expect(share("recruit")).toBeLessThan(9);
    expect(share("treasure")).toBeGreaterThan(0);
  });

  it("is a pure function of seed and act", () => {
    const a = generateActMap(data.acts[0]!, 0, 12345);
    const b = generateActMap(data.acts[0]!, 0, 12345);
    const c = generateActMap(data.acts[0]!, 0, 12346);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});

// ---------------------------------------------------------------------------
// An automated player
// ---------------------------------------------------------------------------

/** Answer the head prompt with the first sensible option. */
function answer(run: RunState): RunChoice | null {
  const prompt = run.prompts[0];
  if (!prompt) return null;
  switch (prompt.kind) {
    case "cardPick":
      return prompt.cards.length > 0 ? { kind: "pickCard", cardId: prompt.cards[0]! } : { kind: "skip" };
    case "artifactPick":
      return { kind: "pickArtifact", artifactId: prompt.artifacts[0]! };
    case "treasure":
      return prompt.artifactId ? { kind: "pickArtifact", artifactId: prompt.artifactId } : { kind: "skip" };
    case "cardRemove": {
      const index = run.deck.findIndex((card) => !card.recruit);
      const affordable = run.clout >= prompt.cost;
      return index >= 0 && run.deck.length > 1 && affordable ? { kind: "removeCardAt", index } : { kind: "skip" };
    }
    case "cardUpgrade": {
      const index = run.deck.findIndex((card) => !card.upgraded);
      const affordable = run.clout >= prompt.cost;
      return index >= 0 && affordable ? { kind: "upgradeCardAt", index } : { kind: "skip" };
    }
    case "rest":
      return { kind: "rest", option: "heal" };
    case "event":
      return { kind: "eventChoice", index: 0 };
    case "shop":
      return { kind: "leaveShop" };
  }
}

interface PlayOptions {
  win: boolean;
  /** health lost per won fight */
  damage?: number;
  /** pick the Nth reachable node each floor */
  branch?: number;
  /** override the routing entirely — used to walk deliberately into Elites */
  chooseNode?: (state: RunState, open: string[]) => string;
}

function playRun(run: RunState, options: PlayOptions): RunState {
  let state = run;
  for (let step = 0; step < 500 && !runOver(state); step++) {
    if (state.prompts.length > 0) {
      const choice = answer(state);
      expect(choice, "a prompt with no possible answer").not.toBeNull();
      const before = JSON.stringify(state);
      state = resolvePrompt(data, content, state, choice!);
      expect(JSON.stringify(state), "a prompt answer that changed nothing would loop forever").not.toBe(before);
      continue;
    }
    if (state.status === "battle") {
      state = startFight(state);
      expect(battleFor(data, content, state)).not.toBeNull();
      state = resolveBattle(data, content, state, {
        won: options.win,
        leaderHealth: Math.max(1, state.health - (options.damage ?? 3)),
      });
      continue;
    }
    const open = reachableNodeIds(state);
    expect(open.length, `stranded at ${state.nodeId ?? "the entrance"}`).toBeGreaterThan(0);
    const pick = options.chooseNode
      ? options.chooseNode(state, open)
      : open[Math.min(options.branch ?? 0, open.length - 1)]!;
    state = enterNode(data, content, state, pick);
  }
  return state;
}

/** Is a node of `kind` still reachable from here, walking forward only? */
function canStillReach(map: RunMap, fromId: string, kind: string): boolean {
  let frontier = [findNode(map, fromId)].filter((n): n is MapNode => n !== null);
  const seen = new Set<string>();
  while (frontier.length > 0) {
    if (frontier.some((node) => node.kind === kind)) return true;
    const next: MapNode[] = [];
    for (const node of frontier) {
      for (const id of nextNodeIds(map, node)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const child = findNode(map, id);
        if (child) next.push(child);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Route towards this act's Elite until its Signal Fragment is in hand.
 *
 * "Walk in and hope" would not do: the greedy first-reachable node cannot reach
 * a node whose only approach is through a floor where greed went the other way,
 * so a test written that way would collect fragments on some seeds and not
 * others and read as flaky rather than as wrong.
 */
const seekElites = (state: RunState, open: string[]): string => {
  const act = data.acts[state.actIndex]!;
  if (state.fragments.includes(act.id)) return open[0]!;
  return open.find((id) => canStillReach(state.map, id, "elite")) ?? open[0]!;
};

/**
 * Can you get from here to the boss without setting foot on an Elite?
 *
 * Needs the same forward search as seeking one, for the same reason: choosing
 * the nearest non-Elite can walk you into a position where every continuation is
 * an Elite. Measured across 400 maps per act, an Elite-free route exists in
 * 96.5–99.3% of them, so avoiding them is a real routing decision rather than
 * either a formality or an impossibility.
 */
function canAvoidElites(map: RunMap, fromId: string): boolean {
  const start = findNode(map, fromId);
  if (!start || start.kind === "elite") return false;
  let frontier = [start];
  const seen = new Set([start.id]);
  while (frontier.length > 0) {
    if (frontier.some((node) => node.floor === map.floors.length - 1)) return true;
    const next: MapNode[] = [];
    for (const node of frontier) {
      for (const id of nextNodeIds(map, node)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const child = findNode(map, id);
        if (child && child.kind !== "elite") next.push(child);
      }
    }
    frontier = next;
  }
  return false;
}

const avoidElites = (state: RunState, open: string[]): string =>
  open.find((id) => canAvoidElites(state.map, id)) ?? open[0]!;

describe("a whole run", () => {
  it("never strands the player, and ends when the last boss falls", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const finished = playRun(startRun(data, data.leaders[0]!.leaderCardId, seed, 0), { win: true });
      expect(finished.status, `seed ${seed}`).toBe("won");
      expect(finished.battlesWon).toBeGreaterThanOrEqual(data.acts.length);
      // one node per floor, per act
      expect(finished.deck.length).toBeGreaterThan(data.leaders[0]!.deck.length - 1);
    }
  });

  it("ends the run at the first defeat", () => {
    const dead = playRun(startRun(data, data.leaders[0]!.leaderCardId, 4242, 0), { win: false });
    expect(dead.status).toBe("dead");
    expect(dead.health).toBe(0);
    expect(summarize(data, dead).cleared).toBe(false);
  });

  it("reproduces exactly from the same seed and the same choices", () => {
    const first = playRun(startRun(data, data.leaders[1]!.leaderCardId, 777, 0), { win: true, branch: 1 });
    const second = playRun(startRun(data, data.leaders[1]!.leaderCardId, 777, 0), { win: true, branch: 1 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("diverges on a different seed", () => {
    const a = playRun(startRun(data, data.leaders[0]!.leaderCardId, 111, 0), { win: true });
    const b = playRun(startRun(data, data.leaders[0]!.leaderCardId, 222, 0), { win: true });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("converts run-Clout at the published rate", () => {
    const finished = playRun(startRun(data, data.leaders[0]!.leaderCardId, 31337, 0), { win: true });
    const summary = summarize(data, finished);
    expect(summary.accountClout).toBe(Math.floor(summary.runClout / data.run.cloutConversion));
    expect(summary.fightsEntered).toBeGreaterThanOrEqual(summary.battlesWon);
  });

  /**
   * The optional true finale.
   *
   * Act 4 is gated on three Signal Fragments, one per act, each from that act's
   * first Elite. Both halves are worth pinning: routing through the Elites has
   * to open it, and NOT routing through them has to still finish the run rather
   * than leaving it stuck at a door.
   */
  describe("Signal Fragments and the optional finale", () => {
    const finaleIndex = data.acts.findIndex((a) => a.requiresFragments !== undefined);
    const needed = data.acts[finaleIndex]?.requiresFragments ?? 0;

    it("is real content, gated on more than nothing", () => {
      expect(finaleIndex, "no act is marked as the optional finale").toBeGreaterThan(0);
      expect(needed).toBeGreaterThan(0);
      // every act in front of it must be able to supply a fragment
      const suppliers = data.acts.slice(0, finaleIndex).filter((a) => a.weights.elite > 0).length;
      expect(suppliers).toBeGreaterThanOrEqual(needed);
    });

    it("awards one fragment per act, from the first Elite in it", () => {
      let run = runOnNodeKind("elite");
      const act = data.acts[run.actIndex]!;
      expect(run.fragments).toEqual([]);

      run = startFight(run);
      run = resolveBattle(data, content, run, { won: true, leaderHealth: run.health });
      expect(run.fragments, "beating an Elite should yield this act's fragment").toEqual([act.id]);

      // a second Elite in the same act gives nothing more
      run = resolveBattle(data, content, run, { won: true, leaderHealth: run.health });
      expect(run.fragments).toEqual([act.id]);
    });

    it("gives no fragment for an ordinary fight", () => {
      let run = runOnNodeKind("battle");
      run = startFight(run);
      run = resolveBattle(data, content, run, { won: true, leaderHealth: run.health });
      expect(run.fragments).toEqual([]);
    });

    it("opens the finale when every act's Elite was taken", () => {
      const finished = playRun(startRun(data, data.leaders[0]!.leaderCardId, 20260727, 0), {
        win: true,
        damage: 0,
        chooseNode: seekElites,
      });

      expect(finished.status).toBe("won");
      expect(finished.fragments.length, "should have taken every act's Elite").toBe(needed);
      expect(finished.actIndex, "should have reached the finale act").toBe(finaleIndex);

      const summary = summarize(data, finished);
      expect(summary.reachedFinale).toBe(true);
      expect(summary.actsCleared).toBe(data.acts.length);
    });

    /**
     * The gate itself, with the map taken out of it.
     *
     * The walking tests below are the realistic proof, but they depend on a map
     * that happens to allow the route; this drives `advanceAct` directly so the
     * rule is pinned whatever the seed rolls.
     */
    it("turns you away at the gated act, and lets you in once you qualify", () => {
      /**
       * Beat the last mandatory boss holding `fragments`, then drain the spoils
       * prompts — the act only advances once the queue is empty, so checking the
       * status straight after the battle would read "node" every time.
       */
      const clearLastMandatoryBoss = (fragments: string[]): RunState => {
        let run: RunState = { ...runOnNodeKind("boss"), actIndex: finaleIndex - 1, fragments };
        run = resolveBattle(data, content, run, { won: true, leaderHealth: 20 });
        for (let guard = 0; guard < 20 && run.prompts.length > 0; guard++) {
          run = resolvePrompt(data, content, run, answer(run)!);
        }
        return run;
      };

      const short = clearLastMandatoryBoss(["act-1"]);
      expect(short.status).toBe("won");
      expect(short.actIndex, "must not have entered the gated act").toBe(finaleIndex - 1);
      expect(short.log.join(" ")).toContain("Signal Fragments");

      const qualified = clearLastMandatoryBoss(data.acts.slice(0, finaleIndex).map((a) => a.id));
      expect(qualified.status, "should be walking the finale, not finished").not.toBe("won");
      expect(qualified.actIndex).toBe(finaleIndex);
      // the finale is one fight: a single floor holding a single boss node
      expect(qualified.map.floors.length).toBe(1);
      expect(qualified.map.floors[0]!.map((n) => n.kind)).toEqual(["boss"]);
    });

    it("still finishes the run when the fragments were not collected", () => {
      const finished = playRun(startRun(data, data.leaders[0]!.leaderCardId, 5150, 0), {
        win: true,
        damage: 0,
        chooseNode: avoidElites,
      });

      expect(finished.status).toBe("won");
      expect(finished.fragments.length).toBeLessThan(needed);
      expect(finished.actIndex, "must not have entered the gated act").toBe(finaleIndex - 1);

      const summary = summarize(data, finished);
      expect(summary.reachedFinale).toBe(false);
      /**
       * Not `data.acts.length`. This used to report every act on any win, which
       * was true while all of them were mandatory and became a lie — in the
       * summary and in the saved best-run record — the moment one was optional.
       */
      expect(summary.actsCleared).toBe(finaleIndex);
      expect(finished.log.join(" ")).toContain("Signal Fragments");
    });
  });

  it("abandoning pays what the run earned rather than nothing", () => {
    let run = runOnNodeKind("battle");
    run = startFight(run);
    run = resolveBattle(data, content, run, { won: true, leaderHealth: 25 });
    while (run.prompts.length > 0) run = resolvePrompt(data, content, run, answer(run)!);
    const abandoned = abandonRun(run);
    expect(abandoned.status).toBe("dead");
    expect(summarize(data, abandoned).runClout).toBeGreaterThan(0);
  });
});

/**
 * The chain of node ids from floor 0 to the first node of `kind`, or null.
 *
 * A breadth-first search rather than "walk and hope": picking greedily at each
 * floor cannot reach a node whose only approach is through a floor where the
 * greedy choice went the other way, and a helper that silently walks past its
 * target turns a shop test into a test of whatever it landed on instead.
 */
function pathToKind(map: RunMap, kind: string): string[] | null {
  const parent = new Map<string, string | null>();
  const queue: { floor: number; index: number }[] = [];
  for (const node of map.floors[0] ?? []) {
    parent.set(node.id, null);
    queue.push({ floor: 0, index: node.index });
  }
  while (queue.length > 0) {
    const { floor, index } = queue.shift()!;
    const node = map.floors[floor]![index]!;
    if (node.kind === kind) {
      const chain: string[] = [];
      for (let id: string | null | undefined = node.id; id; id = parent.get(id)) chain.unshift(id);
      return chain;
    }
    for (const nextIndex of node.next) {
      const child = map.floors[floor + 1]?.[nextIndex];
      if (!child || parent.has(child.id)) continue;
      parent.set(child.id, node.id);
      queue.push({ floor: floor + 1, index: nextIndex });
    }
  }
  return null;
}

/** A run standing on the first node of `kind` reachable in some test seed. */
function runOnNodeKind(kind: string, patch: Partial<RunState> = {}, leaderIndex = 0): RunState {
  for (const seed of SEEDS) {
    const base = startRun(data, data.leaders[leaderIndex]!.leaderCardId, seed, 0);
    const chain = pathToKind(base.map, kind);
    if (!chain) continue;
    let state: RunState = { ...base, ...patch };
    for (const id of chain) {
      // clear whatever the previous node left behind before moving on
      for (let guard = 0; guard < 40; guard++) {
        if (state.prompts.length > 0) {
          state = resolvePrompt(data, content, state, answer(state)!);
          continue;
        }
        if (state.status === "battle") {
          state = startFight(state);
          state = resolveBattle(data, content, state, { won: true, leaderHealth: state.health });
          continue;
        }
        break;
      }
      if (runOver(state)) break;
      state = enterNode(data, content, state, id);
      if (findNode(state.map, id)!.kind === kind) return { ...state, ...patch };
    }
  }
  throw new Error(`no "${kind}" node in any test seed`);
}

// ---------------------------------------------------------------------------
// Battle handoff
// ---------------------------------------------------------------------------

describe("battle setup", () => {
  const runAt = (kind: "battle" | "elite" | "boss"): RunState => runOnNodeKind(kind);

  it("carries run health onto the player's seat only", () => {
    let run = runAt("battle");
    run = { ...run, health: 17 };
    const battle = battleFor(data, content, run)!;
    expect(battle.scenario.setup).toEqual([{ op: "leaderHealth", seat: 0, value: 17, max: 30 }]);
    expect(battle.playerDeck.cards.length).toBe(run.deck.length);
    expect(battle.playerDeck.leaderCardId).toBe(run.leaderCardId);
  });

  it("gives an Elite extra health without touching yours", () => {
    const run = runAt("elite");
    const battle = battleFor(data, content, run)!;
    expect(battle.kind).toBe("elite");
    const enemy = battle.scenario.setup!.filter((op) => op.op === "leaderHealth" && op.seat === 1);
    expect(enemy.length).toBe(1);
    const base = content.leaders[battle.enemyLeaderCardId]!.health;
    expect(enemy[0]).toMatchObject({ value: base + data.acts[0]!.eliteBonusHealth });
    const you = battle.scenario.setup!.find((op) => op.op === "leaderHealth" && op.seat === 0);
    expect(you).toMatchObject({ value: run.health, max: run.maxHealth });
  });

  it("fields the act boss with its twist card and bonus health", () => {
    const run = runAt("boss");
    const battle = battleFor(data, content, run)!;
    const act = data.acts[run.actIndex]!;
    expect(battle.enemyDeck.leaderCardId).toBe(act.boss.leaderCardId);
    expect(battle.difficulty).toBe(act.difficulty.boss);
    const enemy = battle.scenario.setup!.find((op) => op.op === "leaderHealth" && op.seat === 1);
    expect(enemy).toMatchObject({ value: 30 + act.bossBonusHealth });
  });

  it("re-entering a fight deals a different game rather than the same one", () => {
    const run = runAt("battle");
    const first = battleFor(data, content, startFight(run))!;
    const second = battleFor(data, content, startFight(startFight(run)))!;
    expect(second.seed).not.toBe(first.seed);
  });
});

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

describe("the Merch Table", () => {
  const shopRun = (): RunState => runOnNodeKind("shop", { clout: 1000 });

  it("charges for a card once and marks it sold", () => {
    let run = shopRun();
    const prompt = run.prompts[0]!;
    if (prompt.kind !== "shop") throw new Error("expected a shop");
    const entry = prompt.cards[0]!;
    const before = run.clout;
    const size = run.deck.length;
    run = resolvePrompt(data, content, run, { kind: "buyCard", cardId: entry.cardId });
    expect(run.clout).toBe(before - entry.price);
    expect(run.deck.length).toBe(size + 1);
    // buying it twice must not work
    run = resolvePrompt(data, content, run, { kind: "buyCard", cardId: entry.cardId });
    expect(run.clout).toBe(before - entry.price);
    expect(run.deck.length).toBe(size + 1);
  });

  it("refuses what you cannot afford", () => {
    let run = { ...shopRun(), clout: 0 };
    const prompt = run.prompts[0]!;
    if (prompt.kind !== "shop") throw new Error("expected a shop");
    const size = run.deck.length;
    run = resolvePrompt(data, content, run, { kind: "buyCard", cardId: prompt.cards[0]!.cardId });
    expect(run.deck.length).toBe(size);
    expect(run.clout).toBe(0);
  });

  it("charges for a removal only when a card is actually cut", () => {
    let run = shopRun();
    const before = run.clout;
    const price = removalPrice(data, run);

    // cancel: no charge, no cut
    run = resolvePrompt(data, content, run, { kind: "buyRemoval" });
    expect(run.prompts[0]!.kind).toBe("cardRemove");
    run = resolvePrompt(data, content, run, { kind: "skip" });
    expect(run.clout).toBe(before);
    expect(run.prompts[0]!.kind).toBe("shop");

    // and then actually cut something
    const size = run.deck.length;
    run = resolvePrompt(data, content, run, { kind: "buyRemoval" });
    run = resolvePrompt(data, content, run, { kind: "removeCardAt", index: 0 });
    expect(run.clout).toBe(before - price);
    expect(run.deck.length).toBe(size - 1);
    expect(removalPrice(data, run)).toBeGreaterThan(price);
  });

  it("closes when you leave", () => {
    let run = shopRun();
    run = resolvePrompt(data, content, run, { kind: "leaveShop" });
    expect(run.prompts.length).toBe(0);
    expect(run.status).toBe("map");
  });
});

describe("the Touch Grass Break", () => {
  const restRun = (health: number, artifacts: string[] = []): RunState =>
    runOnNodeKind("rest", { health, artifacts });

  it("heals up to the maximum and no further", () => {
    const healed = resolvePrompt(data, content, restRun(5), { kind: "rest", option: "heal" });
    expect(healed.health).toBe(5 + data.rest.heal);
    const capped = resolvePrompt(data, content, restRun(28), { kind: "rest", option: "heal" });
    expect(capped.health).toBe(capped.maxHealth);
  });

  it("gives the Break back if you open the cut list and change your mind", () => {
    let run = restRun(10);
    run = resolvePrompt(data, content, run, { kind: "rest", option: "remove" });
    expect(run.prompts[0]!.kind).toBe("cardRemove");
    run = resolvePrompt(data, content, run, { kind: "skip" });
    expect(run.prompts[0]!.kind).toBe("rest");
    expect(run.health).toBe(10);
  });

  it("cuts for free", () => {
    const before = restRun(10);
    const size = before.deck.length;
    let run = resolvePrompt(data, content, before, { kind: "rest", option: "remove" });
    run = resolvePrompt(data, content, run, { kind: "removeCardAt", index: 0 });
    expect(run.deck.length).toBe(size - 1);
    expect(run.clout).toBe(before.clout);
    expect(run.removalsBought).toBe(before.removalsBought);
    expect(run.prompts.length).toBe(0);
  });
});

describe("Notifications", () => {
  it("resolves every choice of every event without stranding the run", () => {
    for (const event of data.events) {
      event.choices.forEach((_choice, index) => {
        const base = startRun(data, data.leaders[0]!.leaderCardId, 8080, 0);
        // stand the run on an event with plenty of health to absorb the cost
        let run: RunState = {
          ...base,
          health: 30,
          clout: 200,
          nodeId: base.map.floors[0]![0]!.id,
          status: "node",
          prompts: [{ kind: "event", eventId: event.id }],
        };
        run = resolvePrompt(data, content, run, { kind: "eventChoice", index });
        while (run.prompts.length > 0 && !runOver(run)) {
          run = resolvePrompt(data, content, run, answer(run)!);
        }
        expect(run.health, `${event.id} choice ${index}`).toBeGreaterThan(0);
        expect(run.deck.length).toBeGreaterThan(0);
        expect(["map", "node"]).toContain(run.status);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/**
 * Remastered upgrades.
 *
 * The claim that needs proving hardest is per-COPY identity: upgrading one copy
 * of a card must leave the copy beside it alone. That is the whole reason this
 * feature waited for a variant mechanism instead of reusing `cardOverrides`
 * directly, and it is the failure a shallower test would sail past — patch the
 * card id and both copies improve, which looks fine until someone notices they
 * paid once for two upgrades.
 */
describe("Remastered upgrades", () => {
  const twoCopies = (cardId: string): RunState => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 4242, 0);
    return { ...base, deck: [{ cardId }, { cardId }] };
  };

  it("upgrades one copy and leaves the other untouched", () => {
    const cardId = data.leaders[0]!.deck[0]!;
    let run = twoCopies(cardId);
    run = { ...run, prompts: [{ kind: "cardUpgrade", title: "Remaster a card", cost: 0 }] };
    run = resolvePrompt(data, content, run, { kind: "upgradeCardAt", index: 0 });

    expect(run.deck[0]!.upgraded).toBe(true);
    expect(run.deck[1]!.upgraded, "the second copy must be untouched").toBeUndefined();

    // and the deck dealt to a battle names two DIFFERENT cards
    const list = deckListFor(data, run);
    expect(list.cards[0]).toBe(`${cardId}-remastered`);
    expect(list.cards[1]).toBe(cardId);
  });

  it("actually improves the upgraded copy in a real match's card pool", () => {
    const cardId = data.leaders[0]!.deck.find((id) => content.cards[id]?.type === "character")!;
    let run = twoCopies(cardId);
    run = { ...run, prompts: [{ kind: "cardUpgrade", title: "Remaster a card", cost: 0 }] };
    run = resolvePrompt(data, content, run, { kind: "upgradeCardAt", index: 0 });

    const { variants, patches } = battleCardVariants(data, content, run);
    const resolved = resolveMatchContent(content, undefined, patches, variants);

    const before = content.cards[cardId]!;
    const after = resolved.cards[`${cardId}-remastered`]!;
    expect(after, "the variant card should exist in the match pool").toBeDefined();
    expect(after.variantOf).toBe(cardId);
    if (before.type === "character" && after.type === "character") {
      expect(after.attack + after.health).toBeGreaterThan(before.attack + before.health);
    }
    // the base card is not touched, so the un-upgraded copy stays as it was
    expect(JSON.stringify(resolved.cards[cardId])).toBe(JSON.stringify(before));
  });

  it("refuses to Remaster the same copy twice", () => {
    const cardId = data.leaders[0]!.deck[0]!;
    let run = twoCopies(cardId);
    run = { ...run, deck: [{ cardId, upgraded: true }, { cardId }] };
    run = { ...run, prompts: [{ kind: "cardUpgrade", title: "Remaster a card", cost: 100 }], clout: 500 };
    const before = JSON.stringify(run);
    run = resolvePrompt(data, content, run, { kind: "upgradeCardAt", index: 0 });
    expect(JSON.stringify(run), "an already-Remastered copy should be refused, not charged").toBe(before);
  });

  it("charges the Merch Table price on success and nothing on cancel", () => {
    let run = runOnNodeKind("shop", { clout: 1000 });
    const shop = run.prompts[0]!;
    expect(shop.kind).toBe("shop");
    const price = shop.kind === "shop" ? shop.upgradePrice : 0;
    expect(price).toBeGreaterThan(0);

    // open the picker, then back out: nothing charged, and the offer survives
    run = resolvePrompt(data, content, run, { kind: "buyUpgrade" });
    expect(run.prompts[0]!.kind).toBe("cardUpgrade");
    run = resolvePrompt(data, content, run, { kind: "skip" });
    expect(run.clout).toBe(1000);
    const reopened = run.prompts[0]!;
    expect(reopened.kind === "shop" && reopened.upgradeSold, "cancelling must not spend the offer").toBe(false);

    // now actually buy one
    run = resolvePrompt(data, content, run, { kind: "buyUpgrade" });
    run = resolvePrompt(data, content, run, { kind: "upgradeCardAt", index: 0 });
    expect(run.clout).toBe(1000 - price);
    expect(run.deck[0]!.upgraded).toBe(true);
    const after = run.prompts[0]!;
    expect(after.kind === "shop" && after.upgradeSold, "one upgrade per visit").toBe(true);
  });

  it("gives the Touch Grass Break a Remaster option that does not waste the node", () => {
    let run = runOnNodeKind("rest");
    run = resolvePrompt(data, content, run, { kind: "rest", option: "upgrade" });
    expect(run.prompts[0]!.kind).toBe("cardUpgrade");

    // backing out returns the Break rather than burning the floor
    run = resolvePrompt(data, content, run, { kind: "skip" });
    expect(run.prompts[0]!.kind).toBe("rest");
  });

  it("hands out recruits pre-upgraded, as the design says", () => {
    let run = runOnNodeKind("recruit");
    const prompt = run.prompts[0]!;
    expect(prompt.kind).toBe("cardPick");
    const cardId = prompt.kind === "cardPick" ? prompt.cards[0]! : "";
    run = resolvePrompt(data, content, run, { kind: "pickCard", cardId });

    const recruit = run.deck.find((card) => card.recruit);
    expect(recruit?.upgraded, "recruits arrive Remastered").toBe(true);
  });

  it("gives every collectible card an upgrade that changes it", () => {
    /**
     * The load-time validator already refuses a no-op upgrade, so this asserts
     * the validator is actually reaching the whole pool rather than an empty
     * list — a check that iterates nothing passes loudly and proves nothing.
     */
    const ids = upgradableCardIds(content);
    expect(ids.length).toBeGreaterThan(150);
    for (const cardId of ids) {
      expect(upgradeFor(data, content, cardId), `${cardId} has no upgrade`).not.toBeNull();
    }
  });
});

describe("artifacts", () => {
  const withArtifact = (id: string, patch: Partial<RunState> = {}): RunState => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    return { ...base, artifacts: [id], ...patch };
  };

  it("Ergonomic Throne raises the ceiling, not just the current health", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    let run: RunState = {
      ...base,
      nodeId: base.map.floors[0]![0]!.id,
      status: "node",
      prompts: [{ kind: "artifactPick", title: "t", artifacts: ["ergonomic-throne"] }],
    };
    run = resolvePrompt(data, content, run, { kind: "pickArtifact", artifactId: "ergonomic-throne" });
    expect(run.maxHealth).toBe(base.maxHealth + 5);
    expect(run.health).toBe(base.health + 5);
  });

  it("Sponsored Hydration Bot heals after a win and respects the cap", () => {
    const run = withArtifact("hydration-bot", { status: "battle", nodeId: null });
    const onNode = enterNode(data, content, { ...run, status: "map" }, run.map.floors[0]![0]!.id);
    const fought = resolveBattle(data, content, startFight(onNode), { won: true, leaderHealth: 10 });
    expect(fought.health).toBe(14);
    const full = resolveBattle(data, content, startFight(onNode), { won: true, leaderHealth: 29 });
    expect(full.health).toBe(full.maxHealth);
  });

  it("Golden Play Button discounts, Extended Warranty freezes removal price", () => {
    const plain = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    const discounted = withArtifact("golden-play-button");
    expect(removalPrice(data, discounted)).toBeLessThan(removalPrice(data, plain));

    const frozen = withArtifact("extended-warranty", { removalsBought: 4 });
    expect(removalPrice(data, frozen)).toBe(data.shop.removalPrice);
    expect(removalPrice(data, { ...plain, removalsBought: 4 })).toBeGreaterThan(data.shop.removalPrice);
  });

  it("Brand Deal Binder pays extra on fights but not on bosses", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    const node = base.map.floors[0]![0]!.id;
    const plain = resolveBattle(data, content, startFight(enterNode(data, content, base, node)), {
      won: true,
      leaderHealth: 20,
    });
    const boosted = resolveBattle(
      data,
      content,
      startFight(enterNode(data, content, { ...base, artifacts: ["brand-deal-binder"] }, node)),
      { won: true, leaderHealth: 20 }
    );
    expect(boosted.clout - plain.clout).toBe(15);
  });

  it("Signal Booster widens the card reward", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    const node = base.map.floors[0]![0]!.id;
    const plain = resolveBattle(data, content, startFight(enterNode(data, content, base, node)), {
      won: true,
      leaderHealth: 20,
    });
    const wide = resolveBattle(
      data,
      content,
      startFight(enterNode(data, content, { ...base, artifacts: ["signal-booster"] }, node)),
      { won: true, leaderHealth: 20 }
    );
    const cardsIn = (run: RunState): number => {
      const prompt = run.prompts.find((p) => p.kind === "cardPick");
      return prompt && prompt.kind === "cardPick" ? prompt.cards.length : 0;
    };
    expect(cardsIn(wide)).toBe(cardsIn(plain) + 1);
  });

  it("Clip of Your Lowest Moment saves the run exactly once", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    const node = base.map.floors[0]![0]!.id;
    const onNode = enterNode(data, content, { ...base, artifacts: ["lowest-moment-clip"] }, node);
    const survived = resolveBattle(data, content, startFight(onNode), { won: false, leaderHealth: 0 });
    expect(survived.status).toBe("map");
    expect(survived.health).toBe(1);
    expect(survived.artifacts).not.toContain("lowest-moment-clip");

    // and the next defeat is final
    const again = enterNode(data, content, survived, reachableNodeIds(survived)[0]!);
    if (again.status === "battle") {
      const dead = resolveBattle(data, content, startFight(again), { won: false, leaderHealth: 0 });
      expect(dead.status).toBe("dead");
    }
  });

  it("Weighted Blanket adds to the Break", () => {
    // the heal is baked into the prompt when the node is entered, so the
    // artifact has to be held before arriving — which is what this checks
    const plain = runOnNodeKind("rest", { health: 1 });
    const boosted = runOnNodeKind("rest", { health: 1, artifacts: ["weighted-blanket"] });
    const healOf = (run: RunState): number => (run.prompts[0]!.kind === "rest" ? run.prompts[0]!.heal : -1);
    expect(healOf(plain)).toBe(data.rest.heal);
    expect(healOf(boosted)).toBe(data.rest.heal + 6);
    expect(resolvePrompt(data, content, boosted, { kind: "rest", option: "heal" }).health).toBe(
      1 + data.rest.heal + 6
    );
  });
});

// ---------------------------------------------------------------------------
// Artifacts that reach into a battle
// ---------------------------------------------------------------------------

describe("battle artifacts", () => {
  const battleArtifacts = data.artifacts.filter((a) => a.effect.kind === "battlePatch");

  it("ships some, and every one applies cleanly to every run leader", () => {
    expect(battleArtifacts.length).toBeGreaterThan(0);
    for (const artifact of battleArtifacts) {
      if (artifact.effect.kind !== "battlePatch") continue;
      // capture before the closure: TS cannot keep a property narrowed across one
      const { patch } = artifact.effect;
      for (const leader of data.leaders) {
        expect(
          () => resolveMatchContent(content, undefined, { [leader.leaderCardId]: patch }),
          `${artifact.id} on ${leader.leaderCardId}`
        ).not.toThrow();
      }
    }
  });

  it("carries nothing when the run holds no battle artifact", () => {
    const run = startRun(data, data.leaders[0]!.leaderCardId, 1, 0);
    expect(battleCardOverrides(data, run)).toBeUndefined();
  });

  it("merges every held artifact onto the run leader, and only the run leader", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1, 0);
    const run: RunState = { ...base, artifacts: ["ring-light-of-focus", "off-brand-energy-drink", "merch-cannon"] };
    const overrides = battleCardOverrides(data, run)!;
    expect(Object.keys(overrides)).toEqual([run.leaderCardId]);

    const patched = resolveMatchContent(content, undefined, overrides);
    const mine = patched.leaders[run.leaderCardId]!;
    const plain = content.leaders[run.leaderCardId]!;
    expect(mine.fixation.obsessionCost).toBe(plain.fixation.obsessionCost - 1);
    expect(mine.ultimate.obsessionCost).toBe(plain.ultimate.obsessionCost - 1);
    expect(mine.passive.length).toBe(plain.passive.length + 1);

    // the other run leader — who could be the opponent — is untouched
    const other = data.leaders[1]!.leaderCardId;
    expect(patched.leaders[other]!.fixation.obsessionCost).toBe(content.leaders[other]!.fixation.obsessionCost);
  });

  it("hands them to the battle, and a run without them carries none", () => {
    const plain = runOnNodeKind("battle");
    expect(battleFor(data, content, plain)!.cardOverrides).toBeUndefined();

    const armed: RunState = { ...plain, artifacts: ["pocket-hotspot"] };
    const battle = battleFor(data, content, armed)!;
    expect(battle.cardOverrides).toBeDefined();
    expect(battle.cardOverrides![armed.leaderCardId]!.passive).toHaveLength(1);
  });

  it("refuses a battle artifact that could not be applied", () => {
    const draft = clone(rawData) as unknown as RoguelikeData;
    // attack is a character stat; a leader has none, so this must not ship
    draft.artifacts.push({
      id: "broken-artifact",
      name: "Broken",
      text: "does nothing",
      effect: { kind: "battlePatch", patch: { attack: 1 } },
    });
    expect(() => parseRoguelikeData(draft, content)).toThrow(/cannot be applied/);
  });
});

// ---------------------------------------------------------------------------
// Deck integrity
// ---------------------------------------------------------------------------

describe("the run deck", () => {
  it("never cuts a Collab recruit, and never empties", () => {
    const base = startRun(data, data.leaders[0]!.leaderCardId, 1234, 0);
    let run: RunState = {
      ...base,
      deck: [{ cardId: base.deck[0]!.cardId }, { cardId: data.recruits[0]!, recruit: true }],
      prompts: [{ kind: "cardRemove", title: "t", cost: 0 }],
      status: "node",
      nodeId: base.map.floors[0]![0]!.id,
    };
    // the recruit is index 1 and must be refused
    const refused = resolvePrompt(data, content, run, { kind: "removeCardAt", index: 1 });
    expect(refused.deck.length).toBe(2);
    expect(refused.prompts.length).toBe(1);

    run = resolvePrompt(data, content, run, { kind: "removeCardAt", index: 0 });
    expect(run.deck.length).toBe(1);

    // one card must always remain
    const last: RunState = { ...run, prompts: [{ kind: "cardRemove", title: "t", cost: 0 }], status: "node" };
    expect(resolvePrompt(data, content, last, { kind: "removeCardAt", index: 0 }).deck.length).toBe(1);
  });

  it("only ever offers cards the run leader could legally play", () => {
    const run = runOnNodeKind("battle", {}, 1);
    const fought = resolveBattle(data, content, startFight(run), { won: true, leaderHealth: 20 });
    const prompt = fought.prompts.find((p) => p.kind === "cardPick");
    expect(prompt).toBeDefined();
    if (prompt?.kind !== "cardPick") return;
    const leader = content.leaders[run.leaderCardId]!;
    for (const cardId of prompt.cards) {
      const card = content.cards[cardId]!;
      expect(card.token).not.toBe(true);
      expect([leader.faction, "neutral"]).toContain(card.faction);
    }
  });
});
