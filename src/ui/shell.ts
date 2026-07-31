/**
 * Screen router and app shell.
 *
 * Screens are registered by id and mounted into #app one at a time. Navigation
 * is hash-based so the browser back button works and a reload returns you to
 * the same place. Each screen owns its own DOM and disposes cleanly.
 *
 * ## What changed, and why it is worth the extra code
 *
 * This used to fade the outgoing screen out over 200ms and let the incoming one
 * run a single shared `screen-in` keyframe — one 10px rise and a fade, the same
 * for all 49 routes. That is a cross-fade, and a cross-fade is what you reach
 * for when you have nothing to say about the relationship between two screens.
 *
 * There is always a relationship. The lobby is a hub and almost everything is
 * its child; the collection and the deck slots are siblings; the policy hub is
 * five siblings under Settings; and pressing PLAY is not a route change at all,
 * it is the curtain going up. `ROUTES` below is that hierarchy written down,
 * `planNavigation` turns a pair of route ids into which transition applies and
 * exactly how long each half of it lasts, and `transitions.css` holds the
 * vocabulary of moves it draws from.
 *
 * The timing numbers live **here** rather than in the stylesheet, because this
 * file also has to schedule the disposal of the outgoing screen against them.
 * Two copies of a timing table is one copy too many, so the CSS is handed
 * `--nav-dur` and `--nav-delay` and does as it is told.
 *
 * ## Two rules that shaped the lifecycle
 *
 * **Never a blank frame.** `atmosphere.ts` is the real guarantee — it lives
 * outside `#app` and nothing here can unmount it — but this file adds a second
 * one: an outgoing screen is never *removed* until the incoming screen is in the
 * document, even if its exit animation finished first. Together, no ordering of
 * a slow factory and a fast animation can produce an empty frame.
 *
 * **No transition delays input.** The incoming screen is appended and live from
 * the frame it exists; nothing here ever puts `pointer-events: none` on it. The
 * outgoing one gets `pointer-events: none` instead, which is what lets an
 * ascending child stay painted *above* its parent while every click still lands
 * on the parent underneath.
 *
 * Disposal used to be a bare `setTimeout(…, 200)`, which is a bet that the CSS
 * agrees with a number written in a different file. It is now driven by
 * `animationend` with a timer only as a backstop, and a new navigation
 * hard-finishes whatever was still leaving — so a player clicking through five
 * menus in a second can never stack three screens or dispose one mid-flight.
 */

import "./theme/transitions.css";
import { getAtmosphere, mountAtmosphere, type AtmosphereRoom, type TravelKind } from "./atmosphere";
import { motionEnabled, scaledDuration } from "./motion";

export interface Screen {
  root: HTMLElement;
  dispose?: () => void;
  /** called when the screen becomes visible again after a child screen closes */
  resume?: () => void;
}

export type ScreenFactory = (params: URLSearchParams) => Screen | Promise<Screen>;

// --- the route relationship table --------------------------------------------

/** The five moves, plus the one for the very first screen of the session. */
export type NavRelation = "arrive" | "descend" | "ascend" | "sibling" | "curtain" | "replace";

export interface RouteNode {
  /** Where "back" goes. `null` only for the hub itself. */
  parent: string | null;
  /**
   * Position among its siblings, left to right, as the parent presents them.
   * This is the only thing that decides which way a sibling slide travels, and
   * it is why left is always left.
   */
  order: number;
  /** Which of `atmosphere.ts`'s ten rooms this destination is lit by. */
  room: AtmosphereRoom;
  /** A live match. Entering or leaving one is always the curtain. */
  battle?: boolean;
}

/**
 * Every route in the game, and what it is to the route beside it.
 *
 * Derived from the `register()` calls in `main.ts` — specifically from where
 * each screen's own "back" goes, which is the only honest definition of a
 * parent. `#patchnotes` backs out to `#news`, so News is its parent even though
 * the lobby links to both; `#banner` backs out to `#shop`; the five policy
 * screens all back out to Settings and cross-link to each other, which makes
 * them siblings and gives that whole hub a consistent left-to-right axis.
 *
 * `order` follows the order the lobby actually paints its destinations in, so
 * sliding from Collection to Deck Slots travels the same direction on screen as
 * the two buttons sit in the nav. Getting that backwards is not a bug anyone
 * reports; it is a thing that makes a menu feel wrong for reasons nobody can
 * name.
 *
 * A route missing from this table still works — see `routeNode` — so adding a
 * screen does not require editing this file first. It just gets the defaults.
 */
export const ROUTES: Readonly<Record<string, RouteNode>> = {
  // --- the hub ---
  lobby: { parent: null, order: 0, room: "hub" },

  // --- the lobby's own children, in the order the lobby lists them ---
  play: { parent: "lobby", order: 0, room: "play" },
  collection: { parent: "lobby", order: 1, room: "forge" },
  decks: { parent: "lobby", order: 2, room: "forge" },
  shop: { parent: "lobby", order: 3, room: "market" },
  missions: { parent: "lobby", order: 4, room: "record" },
  mastery: { parent: "lobby", order: 5, room: "record" },
  pass: { parent: "lobby", order: 6, room: "market" },
  achievements: { parent: "lobby", order: 7, room: "record" },
  events: { parent: "lobby", order: 8, room: "signal" },
  inbox: { parent: "lobby", order: 9, room: "signal" },
  news: { parent: "lobby", order: 10, room: "signal" },
  profile: { parent: "lobby", order: 11, room: "record" },
  settings: { parent: "lobby", order: 12, room: "system" },
  replays: { parent: "lobby", order: 13, room: "record" },
  gallery: { parent: "lobby", order: 14, room: "forge" },
  lab: { parent: "lobby", order: 15, room: "forge" },
  doomscroll: { parent: "lobby", order: 16, room: "descent" },
  remixhub: { parent: "lobby", order: 17, room: "play" },
  starter: { parent: "lobby", order: 18, room: "hub" },

  // --- mode select's children ---
  tour: { parent: "play", order: 0, room: "play" },
  story: { parent: "play", order: 1, room: "stage" },
  gauntlet: { parent: "play", order: 2, room: "descent" },
  custom: { parent: "play", order: 3, room: "play" },
  signin: { parent: "play", order: 4, room: "system" },
  cloudsave: { parent: "play", order: 5, room: "system" },
  queue: { parent: "play", order: 6, room: "arena" },

  // --- one level further down ---
  deckbuilder: { parent: "decks", order: 0, room: "forge" },
  banner: { parent: "shop", order: 0, room: "market" },
  patchnotes: { parent: "news", order: 0, room: "signal" },
  stats: { parent: "profile", order: 0, room: "record" },
  leaderboards: { parent: "profile", order: 1, room: "record" },
  storyscene: { parent: "story", order: 0, room: "stage" },

  // --- the policy hub: five siblings under Settings, all cross-linked ---
  a11y: { parent: "settings", order: 0, room: "system" },
  fairness: { parent: "settings", order: 1, room: "system" },
  privacy: { parent: "settings", order: 2, room: "system" },
  legal: { parent: "settings", order: 3, room: "system" },
  support: { parent: "settings", order: 4, room: "system" },

  /**
   * Matches. Every one of these is `battle: true`, which overrides the
   * hierarchy entirely: going into a match is the curtain going up and coming
   * out of one is the curtain coming down, wherever in the tree the two screens
   * happen to sit relative to each other.
   */
  battle: { parent: "lobby", order: 20, room: "arena", battle: true },
  tutorial: { parent: "lobby", order: 21, room: "arena", battle: true },
  puzzle: { parent: "lobby", order: 22, room: "arena", battle: true },
  boss: { parent: "lobby", order: 23, room: "arena", battle: true },
  online: { parent: "queue", order: 0, room: "arena", battle: true },
  remix: { parent: "remixhub", order: 0, room: "arena", battle: true },
  custombattle: { parent: "custom", order: 0, room: "arena", battle: true },
  doomfight: { parent: "doomscroll", order: 0, room: "descent", battle: true },
  gauntletfight: { parent: "gauntlet", order: 0, room: "descent", battle: true },
  storybattle: { parent: "storyscene", order: 0, room: "stage", battle: true },
};

/**
 * Unknown routes are children of the hub in the default room.
 *
 * Deliberately forgiving. Fifteen builders are adding screens; a new route that
 * has not been classified yet should get a sensible descend/ascend pair and a
 * lit background, not an exception or a hard cut.
 */
const UNKNOWN_ROUTE: RouteNode = { parent: "lobby", order: 99, room: "hub" };

export function routeNode(id: string): RouteNode {
  return ROUTES[id] ?? UNKNOWN_ROUTE;
}

/** Distance from the hub. Guarded against a table that accidentally loops. */
function depthOf(id: string): number {
  let depth = 0;
  let cursor: string | null = id;
  while (cursor !== null && depth < 8) {
    const parent: string | null = routeNode(cursor).parent;
    if (parent === null) return depth;
    cursor = parent;
    depth += 1;
  }
  return depth;
}

// --- timing -------------------------------------------------------------------

interface NavTiming {
  /** how long the outgoing screen animates */
  out: number;
  /** how long the incoming screen waits before it starts */
  inDelay: number;
  /** how long the incoming screen animates */
  in: number;
}

/**
 * The budget, per relation. Contract §E2: 260–420ms end to end, 80–120ms of
 * overlap, never sequential.
 *
 *   relation   out   delay    in   total   overlap
 *   descend    170      60   320     380       110
 *   ascend     170      60   320     380       110
 *   sibling    160      50   270     320       110
 *   curtain    200     110   310     420        90
 *   replace    130      30   250     280       100
 *
 * The shape is the interesting part: the outgoing half is always the *shorter*
 * one. A screen that is leaving should leave briskly — §3's sharper ease-in for
 * things departing — while the one arriving gets the long eased settle, because
 * that is the one the player is about to look at. Starting the incoming at
 * 50–60ms and finishing the outgoing at 160–200 lands the overlap in range
 * while keeping the new screen visible almost immediately, instead of the
 * obvious alternative of delaying the entrance until the exit is nearly over.
 */
const TIMING: Readonly<Record<NavRelation, NavTiming>> = {
  arrive: { out: 0, inDelay: 0, in: 300 },
  descend: { out: 170, inDelay: 60, in: 320 },
  ascend: { out: 170, inDelay: 60, in: 320 },
  sibling: { out: 160, inDelay: 50, in: 270 },
  curtain: { out: 200, inDelay: 110, in: 310 },
  replace: { out: 130, inDelay: 30, in: 250 },
};

/**
 * Reduced motion. Not a scaled-down version of the table above — a different
 * one, because the requirement is a fast fade and nothing else. `transitions.css`
 * swaps the keyframes for a pair of opacity ramps at the same time; both sides
 * read the same flag so they can never disagree about how long it takes.
 */
const REDUCED_TIMING: NavTiming = { out: 90, inDelay: 0, in: 110 };

/**
 * The player's animation-speed preference, applied to a whole relation.
 *
 * `scaledDuration` is module D's, and it is the same multiplier the battle
 * presenter uses — so "Fast" means the same thing walking into the shop as it
 * does playing a card, and "Instant" collapses navigation to a cut instead of
 * being the one place in the game that ignores the setting. It can take a
 * duration below the 260ms floor; that floor is a design budget, and a player
 * who has explicitly asked for faster outranks it.
 *
 * Deliberately not applied to `REDUCED_TIMING`. `scaledDuration` already folds
 * reduced motion into its own multiplier, and running the reduced table through
 * it would compress a considered 110ms fade to 27ms for no reason.
 */
function scaleTiming(timing: NavTiming): NavTiming {
  return {
    out: scaledDuration(timing.out),
    inDelay: scaledDuration(timing.inDelay),
    in: scaledDuration(timing.in),
  };
}

/**
 * The curtain's own two phases, in ms.
 *
 * Separate from `TIMING` because they are not a share of the navigation budget
 * — the hold between them is however long the battle screen takes to build. The
 * moving parts add up to 380ms, inside the same 260–420 band as everything
 * else; what sits between them is a load, and covering a load is the reason the
 * curtain exists.
 */
const CURTAIN = { close: 170, open: 210, linger: 140 } as const;

/**
 * One definition of "is motion on", and it is module D's.
 *
 * This file needs the boolean rather than the tokens, because the same answer
 * has to reach two places that cannot see each other: the disposal schedule
 * here, and the keyframe swap in `transitions.css`. `motionEnabled` reads the
 * `data-reduced-motion` attribute on the root first and the saved setting only
 * as a fallback — which is exactly the attribute the stylesheet keys off, so
 * the two cannot end up disagreeing about how long a navigation lasts.
 */
function reducedMotion(): boolean {
  return !motionEnabled();
}

export interface NavPlan {
  relation: NavRelation;
  /** +1 forward/right, -1 back/left, 0 where direction is meaningless */
  direction: -1 | 0 | 1;
  outMs: number;
  inDelayMs: number;
  inMs: number;
  /** first frame of the exit to last frame of the entrance */
  totalMs: number;
  /** how long both screens are on screen and moving */
  overlapMs: number;
  /** what the world behind them does */
  travel: TravelKind;
  reduced: boolean;
}

function travelFor(relation: NavRelation, direction: -1 | 0 | 1): TravelKind {
  switch (relation) {
    case "descend":
      return "descend";
    case "ascend":
      return "ascend";
    case "sibling":
      return direction < 0 ? "sibling-left" : "sibling-right";
    case "curtain":
      return direction < 0 ? "curtain-out" : "curtain-in";
    case "replace":
      return "replace";
    default:
      return "arrive";
  }
}

/**
 * Which move applies, and which way it goes.
 *
 * Order matters. A match is checked before the hierarchy because `#battle` is a
 * child of the lobby in the table and "descend into the lobby's child" is not
 * what pressing PLAY should feel like. Everything after that is the tree: your
 * child, your parent, your sibling — and then, for the cross-links that skip
 * around the tree entirely (Profile → Collection, Fairness → Merch Drops),
 * relative depth decides, so going somewhere deeper always descends and going
 * somewhere shallower always ascends, whatever branch it is on.
 */
export function planNavigation(from: string | null, to: string): NavPlan {
  const { relation, direction } = relationBetween(from, to);
  const reduced = reducedMotion();
  const timing = reduced ? REDUCED_TIMING : scaleTiming(TIMING[relation]);
  return {
    relation,
    direction,
    outMs: timing.out,
    inDelayMs: timing.inDelay,
    inMs: timing.in,
    totalMs: timing.inDelay + timing.in,
    overlapMs: Math.max(0, timing.out - timing.inDelay),
    travel: travelFor(relation, direction),
    reduced,
  };
}

function relationBetween(from: string | null, to: string): { relation: NavRelation; direction: -1 | 0 | 1 } {
  if (!from) return { relation: "arrive", direction: 0 };

  const here = routeNode(from);
  const there = routeNode(to);

  // the same route with different params: a rematch, the next tutorial stage,
  // a puzzle retry. Nobody travelled, but something was definitely dealt again.
  if (from === to) return { relation: there.battle ? "curtain" : "replace", direction: there.battle ? 1 : 0 };

  if (there.battle) return { relation: "curtain", direction: 1 };
  if (here.battle) return { relation: "curtain", direction: -1 };

  if (there.parent === from) return { relation: "descend", direction: 0 };
  if (here.parent === to) return { relation: "ascend", direction: 0 };
  if (here.parent !== null && here.parent === there.parent) {
    return { relation: "sibling", direction: there.order >= here.order ? 1 : -1 };
  }

  const deeper = depthOf(to) - depthOf(from);
  if (deeper > 0) return { relation: "descend", direction: 0 };
  if (deeper < 0) return { relation: "ascend", direction: 0 };
  return { relation: "sibling", direction: there.order >= here.order ? 1 : -1 };
}

// --- the shell ----------------------------------------------------------------

/** Two frames, so an animation that has just been declared actually paints. */
function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

interface Mounted {
  id: string;
  key: string;
  screen: Screen;
  /** stops the entrance watcher; called when this screen starts leaving */
  cancelSettle: () => void;
}

interface Retirement {
  root: HTMLElement;
  /** the replacement is in the document — go as soon as the animation is done */
  release: () => void;
  /** go now, whatever state you are in */
  finish: () => void;
}

export class Shell {
  private readonly host: HTMLElement;
  private readonly routes = new Map<string, ScreenFactory>();
  private current: Mounted | null = null;
  private retiring: Retirement | null = null;
  private curtain: HTMLElement | null = null;
  private curtainTimer = 0;
  private navigating = false;
  /** a hash that arrived while we were busy, replayed once we are not */
  private queued = false;
  private fallback = "lobby";

  constructor(host: HTMLElement) {
    this.host = host;
    /**
     * Idempotent, and it returns the layer `main.ts` already mounted. It is
     * called anyway so that a Shell built in any other context — a test, a
     * harness, a future second host — still has a world behind it, and the
     * "never a blank frame" guarantee is a property of the router rather than
     * of one call site in one file remembering to make it true.
     */
    mountAtmosphere();
    window.addEventListener("hashchange", () => void this.handleHash());
  }

  register(id: string, factory: ScreenFactory): this {
    this.routes.set(id, factory);
    return this;
  }

  setFallback(id: string): this {
    this.fallback = id;
    return this;
  }

  /** Navigate by pushing a hash; the hashchange handler does the mounting. */
  navigate(id: string, params: Record<string, string> = {}): void {
    const query = new URLSearchParams(params).toString();
    const hash = query ? `#${id}?${query}` : `#${id}`;
    if (window.location.hash === hash) {
      void this.handleHash();
      return;
    }
    window.location.hash = hash;
  }

  back(): void {
    window.history.back();
  }

  async start(): Promise<void> {
    if (!window.location.hash) {
      this.navigate(this.fallback);
      return;
    }
    await this.handleHash();
  }

  private parseHash(): { id: string; params: URLSearchParams } {
    const raw = window.location.hash.replace(/^#/, "");
    const [id, query] = raw.split("?");
    return { id: id || this.fallback, params: new URLSearchParams(query ?? "") };
  }

  private async handleHash(): Promise<void> {
    /**
     * A navigation arriving mid-navigation used to be dropped on the floor —
     * `main.ts` documents the cost against the async `#online` route. It is now
     * remembered and replayed instead, which costs one boolean and makes
     * clicking two things quickly do the second one rather than nothing. The
     * replay is safe against a loop because an identical hash returns early.
     */
    if (this.navigating) {
      this.queued = true;
      return;
    }
    const { id, params } = this.parseHash();

    const factory = this.routes.get(id);
    if (!factory) {
      this.navigate(this.fallback);
      return;
    }
    /**
     * Compare the WHOLE route, params included. Comparing only the id meant
     * #tutorial -> #tutorial?stage=2 was treated as "already here" and never
     * remounted, so the tutorial could never advance past the stage it opened
     * on. Any route that carries state in its params (tutorial stage, deck
     * builder slot) has the same hazard.
     */
    const key = window.location.hash.replace(/^#/, "");
    if (this.current?.key === key) return;

    this.navigating = true;
    try {
      const outgoing = this.current;
      const plan = planNavigation(outgoing?.id ?? null, id);

      /**
       * Light the room first. The crossfade behind the UI is 900ms and the
       * transition in front of it is 380 — starting the slower one first is
       * what makes them land together, and it is the difference between
       * "the background changed too" and "you walked into another room".
       */
      const world = getAtmosphere();
      world?.enterRoom(routeNode(id).room);

      const veiled = outgoing !== null && plan.relation === "curtain" && !plan.reduced;
      /**
       * A curtain left over from a navigation the player abandoned halfway
       * would sit at z-index 900 across the screen that replaced it. If this
       * one is not a curtain, there is not supposed to be one on screen.
       */
      if (!veiled) this.dropCurtain();
      if (outgoing) {
        this.retire(outgoing, plan);
        if (veiled) this.raiseCurtain();
      }
      world?.travel(plan.travel);

      /**
       * Two frames, so the exit and the closing curtain are actually painted
       * before the main thread disappears into a constructor. One is not
       * enough: the continuation of a single `requestAnimationFrame` still runs
       * *before* that frame is drawn.
       *
       * Only the curtain pays for the ~32ms. Everywhere else the screen is
       * built first and every animation starts on the same frame, which is what
       * keeps the exit and the entrance in step even when the factory blocks —
       * the collection builds 245 card canvases and freezing a coherent lobby
       * for that is far better than starting to dismantle it and then stopping.
       * The battle screen is the one case where the wait is long enough to be
       * worth covering, and the curtain covers it for as long as it takes.
       */
      if (veiled) await twoFrames();

      const screen = await factory(params);
      this.place(screen, id, key, plan, outgoing);
      if (veiled) this.partCurtain(plan);
    } catch (error) {
      console.error(`Failed to mount screen "${id}":`, error);
      this.showError(id, error);
    } finally {
      /**
       * Belt and braces. Every path above reaches `place`, and `place`
       * releases — but a retirement that is never released is a screen that
       * stays mounted and undisposed until the next navigation, and that is too
       * unpleasant a failure to leave depending on the exhaustiveness of a
       * `catch`.
       */
      this.retiring?.release();
      this.navigating = false;
      if (this.queued) {
        this.queued = false;
        void this.handleHash();
      }
    }
  }

  /**
   * Put the incoming screen in the document, already animating.
   *
   * `data-nav` and the two custom properties are written **before** the element
   * is appended, so the very first frame the browser paints is the first frame
   * of the entrance rather than a flash of the screen at rest.
   */
  private place(screen: Screen, id: string, key: string, plan: NavPlan, outgoing: Mounted | null): void {
    const root = screen.root;
    root.style.setProperty("--nav-dur", `${plan.inMs}ms`);
    root.style.setProperty("--nav-delay", `${plan.inDelayMs}ms`);
    if (plan.relation === "sibling") root.style.setProperty("--nav-dir", String(plan.direction));
    root.dataset["nav"] = plan.relation === "arrive" ? "arrive" : `${plan.relation}-in`;

    /**
     * Ascending puts the *leaving* screen on top.
     *
     * A descend has the child rise over its parent, so an ascend has to have
     * the child drop away over its parent or the pair is not a mirror — and a
     * pair that is not a mirror is how a player loses track of where they are.
     * Painting the outgoing screen above the incoming one is only safe because
     * it never takes a click; see `transitions.css` §2.
     */
    if (plan.relation === "ascend" && outgoing && outgoing.screen.root.isConnected) {
      this.host.insertBefore(root, outgoing.screen.root);
    } else {
      this.host.appendChild(root);
    }

    // whatever we just inserted, the curtain stays above it
    if (this.curtain?.isConnected) this.host.appendChild(this.curtain);

    this.current = { id, key, screen, cancelSettle: this.watchEntrance(root, plan) };
    this.retiring?.release();
  }

  /**
   * Take the element back to a true resting state once it has arrived.
   *
   * The attribute is set to `settled` rather than removed, because `.screen` in
   * `base.css` still carries `animation: screen-in` — removing `data-nav` would
   * let that rule take over and replay the old placeholder entrance the instant
   * this one finished. Settling also drops `will-change`, so a screen that has
   * been sitting there for ten minutes is not still holding a composited layer
   * for an animation that ended in the first half second.
   *
   * Driven by `animationend`, with a timer only as a backstop for the cases
   * where an animation never runs at all — an element hidden at mount, a
   * stylesheet that has not arrived. `event.target === root` matters: screens
   * stagger their own contents, and every one of those animations ends on this
   * element too.
   */
  private watchEntrance(root: HTMLElement, plan: NavPlan): () => void {
    let done = false;
    const settle = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      root.removeEventListener("animationend", onEnd);
      root.removeEventListener("animationcancel", onEnd);
      if (!root.isConnected) return;
      root.dataset["nav"] = "settled";
      root.style.removeProperty("--nav-dur");
      root.style.removeProperty("--nav-delay");
      root.style.removeProperty("--nav-dir");
    };
    const onEnd = (event: AnimationEvent): void => {
      if (event.target === root) settle();
    };
    root.addEventListener("animationend", onEnd);
    root.addEventListener("animationcancel", onEnd);
    const timer = window.setTimeout(settle, plan.inDelayMs + plan.inMs + 400);

    return (): void => {
      done = true;
      window.clearTimeout(timer);
      root.removeEventListener("animationend", onEnd);
      root.removeEventListener("animationcancel", onEnd);
    };
  }

  /**
   * Start the outgoing screen leaving, and arrange for it to be disposed of
   * exactly once.
   *
   * Three things have to be impossible here and all three used to be reachable
   * with a bare 200ms timer:
   *
   *  - **a screen left mounted.** Every exit path — the animation ending, the
   *    backstop timer, a fresh navigation arriving — runs the same `finish`,
   *    and `finish` is idempotent.
   *  - **a screen disposed mid-transition.** Disposal only happens on `finish`,
   *    and `finish` will not run until the incoming screen has been placed;
   *    `release` is what says it has.
   *  - **screens stacking up.** At most one screen is ever retiring. A second
   *    navigation inside the first one's transition finishes the first
   *    immediately, so five fast clicks leave two elements in the DOM, not six.
   *
   * A `dispose` that throws is logged and swallowed. One badly-behaved screen
   * should not be able to wedge the router on its way out.
   */
  private retire(entry: Mounted, plan: NavPlan): void {
    this.retiring?.finish();
    entry.cancelSettle();

    const root = entry.screen.root;
    root.style.setProperty("--nav-dur", `${plan.outMs}ms`);
    root.style.removeProperty("--nav-delay");
    if (plan.relation === "sibling") root.style.setProperty("--nav-dir", String(plan.direction));
    root.dataset["nav"] = `${plan.relation}-out`;
    /**
     * `.screen-out` stays. `screens.css` hangs the pointer-events guard off it
     * and, more importantly, `shot.mjs` and `verify-screens.mjs` both wait for
     * it to disappear to know a swap has finished. Breaking that would break
     * every screenshot in the project to save one class name.
     */
    root.classList.add("screen-out");
    /**
     * `pointer-events: none` only stops the mouse. A screen that is on its way
     * out still holds its buttons in the tab order and its headings in the
     * accessibility tree, and on an ascend it is now painted *above* the screen
     * that replaced it — so somebody navigating by keyboard could tab into a
     * panel that is about to be disposed of. `inert` takes the whole subtree out
     * of both, and moves focus off it if that is where the focus was.
     */
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");

    let done = false;
    let animationEnded = false;
    let released = false;
    let timer = 0;

    const complete = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      root.removeEventListener("animationend", onEnd);
      root.removeEventListener("animationcancel", onEnd);
      if (this.retiring?.root === root) this.retiring = null;
      try {
        entry.screen.dispose?.();
      } catch (error) {
        console.error("Screen dispose threw on the way out:", error);
      }
      root.remove();
    };

    const maybeComplete = (): void => {
      if (animationEnded && released) complete();
    };

    const onEnd = (event: AnimationEvent): void => {
      if (event.target !== root) return;
      animationEnded = true;
      maybeComplete();
    };

    root.addEventListener("animationend", onEnd);
    root.addEventListener("animationcancel", onEnd);

    this.retiring = {
      root,
      release: (): void => {
        if (released) return;
        released = true;
        /**
         * The backstop starts **here**, not where the exit did.
         *
         * This was measured, not guessed. The collection screen builds 245 card
         * canvases and blocks the main thread for the better part of a second;
         * a timer armed before that call fires the instant the thread comes
         * back, and the outgoing screen is torn out one frame into an animation
         * that has not been rendered even once. That is precisely the
         * "disposed mid-transition" failure, and starting the clock from the
         * moment the replacement actually exists is what makes it impossible.
         *
         * Generous on purpose, too. It is not the mechanism — `animationend`
         * is — it is only the answer to "what if the animation never runs".
         * A screen held one extra frame is invisible; a screen removed one
         * frame early is a hole in the world.
         */
        timer = window.setTimeout(() => {
          animationEnded = true;
          maybeComplete();
        }, plan.outMs + 400);
        maybeComplete();
      },
      finish: complete,
    };
  }

  /**
   * Close the curtain, and hold it closed.
   *
   * Two phases rather than one continuous close-and-part, because the thing
   * behind a curtain takes an unknown length of time to build. A single 420ms
   * animation started before the battle screen's constructor would have parted
   * again while the main thread was still inside it, revealing whatever was
   * left of the lobby; a close that holds parts only when there is something
   * to reveal.
   *
   * That also makes it the loading state the AAA bar asks for. No spinner —
   * where the wait is short you never notice the hold, and where it is long the
   * game has drawn a curtain over it, which is a thing that happens in a
   * theatre rather than a thing that happens in a browser.
   *
   * Built here rather than declared in the markup because a permanent
   * full-screen element at z-index 900 over every route is a trap waiting for
   * the next person, and because the battle screen is not this module's to add
   * DOM to.
   */
  private raiseCurtain(): void {
    this.dropCurtain();
    const curtain = document.createElement("div");
    curtain.className = "nav-curtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.dataset["phase"] = "close";
    curtain.style.setProperty("--nav-dur", `${CURTAIN.close}ms`);
    curtain.innerHTML =
      '<div class="nav-curtain-panel is-top"></div>' +
      '<div class="nav-curtain-panel is-bottom"></div>' +
      '<div class="nav-curtain-seam"></div>';
    this.host.appendChild(curtain);
    this.curtain = curtain;
  }

  /**
   * Part it, once the incoming screen is in the document.
   *
   * The hold matches the incoming screen's own entrance delay, so the board
   * starts settling behind the curtain and is already in motion by the time
   * the halves are out of the way — the reveal shows a live screen rather than
   * a static one that then begins to move.
   */
  private partCurtain(plan: NavPlan): void {
    const curtain = this.curtain;
    if (!curtain?.isConnected) return;
    window.clearTimeout(this.curtainTimer);
    this.curtainTimer = window.setTimeout(() => {
      if (this.curtain !== curtain) return;
      curtain.style.setProperty("--nav-dur", `${CURTAIN.open}ms`);
      curtain.dataset["phase"] = "open";
      this.curtainTimer = window.setTimeout(() => this.dropCurtain(), CURTAIN.open + CURTAIN.linger);
    }, plan.inDelayMs);
  }

  private dropCurtain(): void {
    window.clearTimeout(this.curtainTimer);
    this.curtainTimer = 0;
    this.curtain?.remove();
    this.curtain = null;
  }

  /**
   * A route that threw. Mounted through the same path as any other screen, so
   * it gets an entrance, the outgoing screen is released rather than stranded,
   * and navigating away from it retires it normally.
   *
   * The key is deliberately unique: without it, a failed `#shop` would leave
   * `current.key === "shop"` and a second attempt at the same route would be
   * treated as "already here" and never retried.
   */
  private showError(id: string, error: unknown): void {
    const node = document.createElement("div");
    node.className = "screen error-screen";
    node.innerHTML = `
      <div class="ambient-bg"></div>
      <div class="panel panel-chrome error-panel">
        <div class="eyebrow">Something broke</div>
        <h2 class="title">Could not open “${id}”</h2>
        <pre class="error-detail">${error instanceof Error ? error.message : String(error)}</pre>
        <button class="btn btn-primary" id="error-home">Back to Lobby</button>
      </div>`;
    this.dropCurtain();
    this.place({ root: node }, id, `${id}!error:${Date.now()}`, planNavigation(null, id), null);
    node.querySelector("#error-home")?.addEventListener("click", () => {
      this.navigate(this.fallback);
    });
  }
}

/** Landscape enforcement for mobile — the game is landscape-only by design. */
export function watchOrientation(): void {
  const overlay = document.getElementById("rotate-overlay");
  if (!overlay) return;

  const update = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 820;
    overlay.hidden = !(portrait && smallScreen);
  };

  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => window.setTimeout(update, 120));
  update();
}
