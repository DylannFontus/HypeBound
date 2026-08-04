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
 *
 * ## The ordering rule, which is the whole of this file's difficulty
 *
 * **Nothing animates while the main thread is busy.** Everything below is in
 * service of that one sentence, and every measured failure this file has ever
 * had was a violation of it.
 *
 * The old order was: start the exit animation, then call the factory, then place
 * the incoming screen. That reads correctly and is wrong, because a factory is
 * synchronous and a CSS animation is not — `transform`, `opacity` and `filter`
 * are composited off-thread, so the exit *keeps playing* while the constructor
 * blocks and it plays to completion against a screen that does not exist yet.
 * Measured on `#lobby → #uikit`: a 239ms task at t=103, `nav-descend-out`
 * dispatching `animationstart` and `animationend` in the same millisecond at
 * t=346.7 — the whole recede having happened on the compositor with nobody
 * watching — and a composited frame at t=636 containing **nothing but the
 * atmosphere**: no lobby, no gallery. `#collection → #lobby` was worse: 909ms
 * and 434ms of blocked thread before a single animation frame, `nav-ascend-in`
 * firing start and end together at t=1835, one blank frame at t=1945, and the
 * destination appearing already settled at t=2124. AAA bar §3a makes "never a
 * blank frame" a non-negotiable, and two of the three most-travelled routes in
 * the game were producing one.
 *
 * So the order is now: **seal, cover, build, then move.** The outgoing screen is
 * sealed against input immediately and left *pixel-identical*; if the wait is
 * going to be long enough to notice, a curtain closes over it first, on the
 * compositor, where a blocked thread cannot stop it; the destination is built;
 * and only then does anything start moving, with both halves declared in the
 * same task so they share a start frame.
 *
 * Freezing a coherent screen for the length of a constructor is not free, but it
 * is the correct trade against starting to dismantle one and then stopping.
 * `heavy` and `HEAVY_BUILD_MS` are how this file decides which of the two waits
 * it is looking at, and the answer is measured rather than guessed — see
 * `Shell.isHeavy`.
 *
 * The same rule applies on the way out. A screen's `dispose()` is as synchronous
 * as its constructor — tearing down the collection's 245 card canvases measured
 * ~530ms — so disposal is queued rather than run, and paid once the arriving
 * screen has stopped moving. Detaching the element is what stops it being drawn;
 * the teardown is bookkeeping and can wait for a quiet frame.
 */

import "./theme/transitions.css";
import { ROOMS, getAtmosphere, mountAtmosphere, type AtmosphereRoom, type TravelKind } from "./atmosphere";
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
  /**
   * A prior, not a fact: this screen is expected to take long enough to build
   * that the wait wants covering.
   *
   * It is only the opening guess. `Shell.isHeavy` times every factory it calls
   * and the measurement replaces this flag the moment there is one, in both
   * directions — a route marked heavy here that turns out to build in a frame
   * stops being veiled, and a route nobody classified that turns out to cost
   * 900ms starts being veiled on the second visit. A table maintained by hand
   * across forty-nine screens and fifteen builders will always be a little
   * wrong; a stopwatch is never wrong about the screen it just built.
   *
   * What the flag still buys is the *first* visit, which is the one no
   * measurement exists for yet. `collection`, `gallery`, `deckbuilder` and
   * `uikit` are here because they have each been measured over half a second
   * (the collection: 245 card canvases, ~900ms), and being wrong about them on
   * the first navigation of a session is exactly the failure this whole file is
   * about.
   */
  heavy?: boolean;
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
  collection: { parent: "lobby", order: 1, room: "forge", heavy: true },
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
  gallery: { parent: "lobby", order: 14, room: "forge", heavy: true },
  lab: { parent: "lobby", order: 15, room: "forge" },
  doomscroll: { parent: "lobby", order: 16, room: "descent" },
  remixhub: { parent: "lobby", order: 17, room: "play" },
  starter: { parent: "lobby", order: 18, room: "hub" },
  /**
   * The foundation's own gallery. Registered in `main.ts` and missing from this
   * table for as long as both have existed, so it fell through to
   * `UNKNOWN_ROUTE` — which used to be cheap — while its constructor measured
   * six long tasks totalling ~1.18s. It is the route the blank frame was first
   * photographed on, and the one screen in the game whose entire job is to
   * demonstrate that the motion system works.
   */
  uikit: { parent: "lobby", order: 19, room: "forge", heavy: true },

  // --- mode select's children ---
  tour: { parent: "play", order: 0, room: "play" },
  story: { parent: "play", order: 1, room: "stage" },
  gauntlet: { parent: "play", order: 2, room: "descent" },
  custom: { parent: "play", order: 3, room: "play" },
  signin: { parent: "play", order: 4, room: "system" },
  cloudsave: { parent: "play", order: 5, room: "system" },
  queue: { parent: "play", order: 6, room: "arena" },

  // --- one level further down ---
  deckbuilder: { parent: "decks", order: 0, room: "forge", heavy: true },
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
 * Unknown routes are children of the hub in the default room, and they are
 * assumed **expensive** until something has timed one.
 *
 * Forgiving about the relationship, pessimistic about the cost, and the two are
 * not the same kind of guess. A new route that nobody has classified should get
 * a sensible descend/ascend pair and a lit background rather than an exception
 * — but an unclassified screen is by definition one whose build nobody has
 * measured, and `#uikit` is what that costs: registered, unlisted, 1.18 seconds
 * of constructor, and the only route in the game that produced a frame with no
 * screen in it.
 *
 * The pessimism is cheap because it is temporary. `Shell.isHeavy` times the
 * factory on that first visit and the measurement takes over from the second
 * one onward, so a new screen that actually builds in a frame is veiled exactly
 * once and never again.
 */
const UNKNOWN_ROUTE: RouteNode = { parent: "lobby", order: 99, room: "hub", heavy: true };

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
 *   ascend     170      20   320     340       150
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
 *
 * **Ascend is the one that is not symmetrical with descend, and it has to be.**
 * The two keyframe pairs are mirrors, but the *stacking* is not: on a descend the
 * departing parent is painted behind the arriving child, and on an ascend the
 * departing child is painted on top of its parent. So the child's opacity has to
 * come off early or the frame is a mush of two screens, and `nav-ascend-out`
 * front-loads it for exactly that reason — at which point a 60ms delay on the
 * incoming parent opens a hole. Measured with the old pair, the combined visible
 * opacity bottomed out at 0.33 and there was never a frame with both screens
 * above 30%: sequential out-then-in, on the most-pressed control in a menu tree.
 * 20ms puts the parent's first frame under the child's fall, and the two are both
 * above 0.3 for an 84ms window. Total is 340ms, still inside the 260–420 budget.
 */
const TIMING: Readonly<Record<NavRelation, NavTiming>> = {
  arrive: { out: 0, inDelay: 0, in: 300 },
  descend: { out: 170, inDelay: 60, in: 320 },
  ascend: { out: 170, inDelay: 20, in: 320 },
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
 *
 * There used to be a third number, `linger: 140`, holding the element in the
 * document for 140ms after the panels had finished parting. On `#collection`,
 * `#deckbuilder` and `#gallery` — the three `heavy` routes — that made the whole
 * click-to-usable path 170 close + ~950 constructor + 210 part + 140 linger, so
 * about 1.3 seconds to open the card list, which is the most routine navigation
 * a card game has. §3a's budget is 260–420ms and it names over 500ms on routine
 * navigation as an obstacle. The linger bought nothing a player could see — the
 * panels are already off-screen — so it is gone, and `partCurtain` now starts on
 * the incoming screen's first *painted* frame rather than after its entrance
 * delay, which recovers the rest.
 *
 * That is a partial fix and the honest version of it is written at
 * `RouteNode.heavy`: the real answer is for those three screens to mount a shell
 * and build their card canvases in chunked frames afterwards, at which point
 * `heavy` comes out of the table entirely and they run the ordinary descend.
 * That is a change to three screens this phase does not own.
 *
 * `lead` is the third number and it is the same rule §3a states for two screens,
 * applied to a screen and a curtain: the arriving thing starts first and the
 * leaving thing overlaps it by 80–120ms. `partCurtain` rewinds the destination's
 * entrance to frame zero so the reveal shows a screen arriving — and an entrance
 * at frame zero is an `opacity: 0` screen, so parting on the same frame opens
 * onto nothing. Measured on `#collection → #lobby`: panels gone at t=2347, the
 * lobby not painted until t=2373, one composited frame of bare atmosphere in
 * between. 110ms of lead puts the screen at about 60% before the panels move,
 * which is a cross-dissolve rather than a hole and reads as the light coming up
 * under a rising curtain.
 */
const CURTAIN = { close: 170, open: 210, lead: 110 } as const;

/**
 * The line between "freeze a coherent screen" and "cover the wait".
 *
 * Both are legitimate answers to a slow constructor and the only question is
 * which one a given wait deserves. Under ~220ms, freezing wins: the outgoing
 * screen is still fully painted, nothing has started moving that can be caught
 * half-done, and the whole transition then plays afterwards on a free thread —
 * the player reads it as one gesture that started a beat late. Over ~220ms the
 * freeze becomes a stall, the screen stops answering for longer than the entire
 * transition budget, and the honest thing to do is admit there is a wait and
 * draw something over it.
 *
 * 220 rather than a round number because it is the bottom of §3a's own
 * 260–420ms band with a frame's slack: a pause shorter than the shortest
 * legitimate transition is not a pause the player can name.
 */
/**
 * Above this, a build gets the curtain. Measured, not guessed.
 *
 * This was 220ms, on the reasoning that a frozen screen only stops reading as a
 * beat once it is quite long. That is true of a *frozen* screen and false of a
 * frozen transition, which is what actually happens: a CSS animation's clock
 * runs in real time, so declaring one and then blocking for 116ms does not
 * delay it — it consumes it. Four separate reviews caught the result and one
 * caught it exactly, on `#collection → #lobby`: `nav-ascend-out` firing
 * `animationstart` and `animationend` *in the same millisecond*, then one
 * half-dismantled dark frame, then a cut to a settled lobby. The 320ms ascend
 * had already elapsed inside the block.
 *
 * Attributed long tasks on this machine (75.2fps at rest, worst gap 13.5ms):
 *
 *     #lobby -> #play        116ms   under the old threshold, so unveiled
 *     #lobby -> #settings     78ms + 97 + 80 + 74 + 50
 *     #lobby -> #collection  489ms   over it, so this one was already covered
 *
 * So the two legs a player uses most were the two the veil declined to protect.
 * 60ms is about four frames — the point at which a 260-420ms transition loses a
 * visible fraction of itself. Below that a hitch is a hitch; above it, the whole
 * move is gone and the player sees a cut.
 *
 * The curtain is the right tool and already works: it is a `translate3d` on the
 * compositor, so once it has been given one frame by `twoFrames()` it keeps
 * playing for the whole of the block underneath it.
 */
const HEAVY_BUILD_MS = 60;

/**
 * How long the reveal will wait for a frame worth revealing on.
 *
 * A ceiling rather than a duration: on almost every veiled navigation the two
 * calm frames arrive within a handful, and this number is never reached. It is
 * reached on exactly the screens it was written for — the collection's raster
 * runs about 960ms past the moment its element enters the document — and the
 * question there is whether to cut to a finished screen at 1.79s or draw the
 * reveal at 2.0s. §3a says nothing pops and everything that appears has an
 * entrance, and 210ms is not the part of that number the player is waiting on.
 *
 * Past the ceiling the cover has stopped being a loading state and started
 * being the thing being waited for, and a reveal drawn in three frames beats a
 * reveal that never comes.
 */
const REVEAL_PATIENCE_MS = 1100;

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

/** A monotonic clock that still works in a test environment without one. */
function now(): number {
  return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/**
 * A frame the page can actually afford to animate on.
 *
 * `twoFrames()` answers "has the destination been composited"; this answers the
 * harder question the curtain needs, which is "has it *stopped* costing so much
 * that an animation would be drawn". They are not the same. Measured on
 * `#lobby → #collection`: the destination's first frame lands at t≈1160 and the
 * screen then keeps the main thread for another 480ms of style, layout and
 * paint in chunks of 100–430ms — so a reveal fired two frames after `place()`
 * ran its 210ms part in **two composited frames**, one of which was already the
 * settled screen. A curtain that opens in two frames is a cut with extra steps.
 *
 * So the reveal waits for a frame that arrived on time, with a hard ceiling
 * because a cover that never opens is worse than a rough one. 34ms rather than
 * 17 so that a low tier honestly running at 30fps counts as keeping up — the
 * question is whether the page is hitting *its* budget, not whether it is
 * hitting 60.
 */
const QUIET_FRAME_MS = 34;

/**
 * **Two** on-time frames in a row, and the second one is not pedantry.
 *
 * Parting a curtain exposes an area the compositor has never rasterised, so the
 * reveal is raster-bound rather than script-bound: measured on the collection,
 * the panels were told to open at t=1633 and the first frame anyone could see
 * through them arrived at t=1788, because between those two the renderer was
 * still turning 245 card canvases into pixels. A single cheap frame is the gap
 * between two expensive ones; two in a row is a page that has actually stopped.
 */
function quietFrame(patienceMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    const deadline = now() + patienceMs;
    let previous = now();
    let seen = 0;
    let calm = 0;
    const step = (): void => {
      const stamp = now();
      const delta = stamp - previous;
      previous = stamp;
      seen += 1;
      calm = delta <= QUIET_FRAME_MS ? calm + 1 : 0;
      // Never fewer than two frames: the first one is the destination's own
      // first paint and says nothing about what the next one will cost.
      if ((seen >= 2 && calm >= 2) || stamp >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Take the incoming screen's entrance back to its first frame.
 *
 * Only ever used behind a closed curtain, and it exists because of an ordering
 * that cannot be avoided: the destination has to be *in the document* before
 * anyone can know whether it has finished painting, so its entrance is declared
 * while the cover is still down and is spent underneath it. Measured on
 * `#lobby → #collection`, `nav-descend-in` ran from t=821 to t=1161 behind an
 * opaque veil that did not part until t=1645 — so the three heaviest routes in
 * the game each had a carefully written entrance that no player has ever seen,
 * and the reveal showed a screen that was already at rest. §3a: everything that
 * appears has an entrance.
 *
 * Seeking rather than re-declaring. Rewriting `data-nav` to restart the
 * animation would flash the base `screen-in` rule from `base.css` in the gap,
 * and cancelling would reject the `finished` promises `watchEntrance` is
 * holding. Setting `currentTime` back to zero rewinds the cascade, the sheen
 * and the root's own entrance together, keeps their relative delays exact, and
 * leaves every promise intact so the settle still fires at the true end.
 */
function rewindEntrance(root: HTMLElement): void {
  if (typeof root.getAnimations !== "function") return;
  for (const animation of root.getAnimations({ subtree: true })) {
    if (!isNavAnimation(animation)) continue;
    try {
      animation.currentTime = 0;
    } catch {
      // A finished animation whose effect has been torn down. Nothing to rewind.
    }
  }
}

/**
 * Is this one of ours?
 *
 * Every keyframe in `transitions.css` is named `nav-*`, and every animation a
 * *screen* declares for its own reasons is not — the lobby's `lobby-pulse`, the
 * gallery's `kit-rise`, a skeleton shimmer, a breathing glow. That naming
 * convention is load-bearing in one place, `watchEntrance`, which has to wait
 * for the transition to finish without waiting for an infinite idle animation
 * that will never finish.
 *
 * `animationName` is on `CSSAnimation`, which is not in every lib.dom, so it is
 * read structurally rather than through an `instanceof` that would not compile
 * everywhere.
 */
function isNavAnimation(animation: Animation): boolean {
  const name = (animation as Animation & { animationName?: unknown }).animationName;
  return typeof name === "string" && name.startsWith("nav-");
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

/**
 * Give a range input the two-tone track the stylesheet has always been able to
 * draw and never had the number for.
 *
 * `foundation.css` §8 paints the filled portion from `--slider-fill`, because
 * Chromium has no `::-webkit-slider-progress` and CSS cannot read an input's
 * value. That left the property as "a hook a caller can set", and the measured
 * consequence was that **every slider in the game rendered empty on the engine
 * we ship to** — all six on `#settings` had `--slider-fill` unset, so six
 * identical black rails with a knob floating on them, no indication of value.
 * The only thing in the codebase that ever wrote it was the gallery specimen.
 * Firefox got a real fill free from `::-moz-range-progress`; GitHub Pages does
 * not serve Firefox.
 *
 * Ten lines, and every slider in the game — including ones written next month by
 * somebody who has never opened the stylesheet — is correct with no consumer
 * edits at all. That is the same argument A6 makes for binding the form kit to
 * the elements rather than to an opt-in class, and it is why the sync belongs
 * with the foundation rather than in whichever screen remembers.
 */
function syncRange(el: HTMLInputElement): void {
  const min = Number(el.min === "" ? 0 : el.min);
  const max = Number(el.max === "" ? 100 : el.max);
  const span = max - min;
  // A zero or inverted range is a caller's bug, not a reason to divide by zero
  // and write `NaN%` into the cascade, which would take the whole track with it.
  const fraction = span > 0 ? (Number(el.value) - min) / span : 0;
  el.style.setProperty("--slider-fill", `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`);
}

/** Every range under `root`, including `root` itself if it is one. */
function syncRangesIn(root: ParentNode | HTMLElement): void {
  if (root instanceof HTMLInputElement && root.type === "range") {
    syncRange(root);
    return;
  }
  for (const el of root.querySelectorAll<HTMLInputElement>('input[type="range"]')) syncRange(el);
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
  /**
   * How long each route's factory actually took, the last time it was asked.
   *
   * The stopwatch behind `isHeavy`. Latest sample rather than the worst one on
   * purpose: the expensive first call to a lazily-imported route is mostly the
   * module graph arriving, and the honest predictor of the *next* build is the
   * one before it, not the coldest one of the session.
   */
  private readonly buildCost = new Map<string, number>();
  /**
   * Teardowns that have been earned but not yet paid.
   *
   * A screen's `dispose()` is exactly as synchronous as its constructor — the
   * collection's measured ~530ms of canvas teardown froze the ascend it was
   * supposed to be leaving on — so `complete()` detaches the element, which is
   * what stops it being drawn, and drops the actual teardown in here. It is
   * flushed when the arriving screen settles, or at the top of the next
   * navigation, whichever comes first: both are moments where the thread is
   * allowed to be busy.
   */
  private readonly pendingDisposals: Array<() => void> = [];
  private disposalTimer = 0;

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
    /**
     * The other half of `syncRange`: one delegated listener for the whole
     * document, in the capture phase so a screen that calls `stopPropagation()`
     * on its own control cannot silently leave the track behind. `input` covers
     * dragging, `change` covers the keyboard and the programmatic set that some
     * screens do on reset. The per-screen sweep is in `place()`, which is the one
     * moment this file knows a batch of new controls exists.
     */
    const onRangeInput = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "range") syncRange(target);
    };
    document.addEventListener("input", onRangeInput, true);
    document.addEventListener("change", onRangeInput, true);
    syncRangesIn(document);
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
    /**
     * Hoisted out of the `try`, because the failure path needs them. A factory
     * that throws leaves an outgoing screen that has been sealed and never
     * retired — inert, silent and permanently in the document — and the only
     * way to be sure that cannot happen is for the `catch` to be able to see it.
     */
    const outgoing = this.current;
    const plan = planNavigation(outgoing?.id ?? null, id);
    try {
      /**
       * Pay for the last navigation's teardown before this one starts moving.
       *
       * There is at most a screen or two in here and they are already detached,
       * so this costs nothing visible; what it buys is the guarantee that a
       * queued `dispose()` can never land in the middle of the transition about
       * to be started. This is the moment in the whole cycle where the thread is
       * *allowed* to block: nothing is animating and the outgoing screen is
       * still fully painted.
       */
      this.flushDisposals();

      /**
       * Anything whose wait cannot be hidden gets covered instead.
       *
       * Two cases, one mechanism, **two surfaces**. A battle is covered because
       * entering a match should feel like the curtain going up; the collection,
       * the deck builder and the gallery are covered because their constructors
       * block the main thread for the better part of a second, and past
       * `HEAVY_BUILD_MS` a frozen screen stops reading as a beat and starts
       * reading as a hang. The veil closes over the outgoing screen, holds for
       * however long the build takes, and parts onto a screen that is already
       * settling.
       *
       * **Either endpoint, not just the destination.** This used to ask only
       * where you were going, which left the most-pressed control in the menu
       * tree — Back, out of the collection — completely unprotected: measured at
       * 909ms and 434ms of blocked thread before a single animation frame, one
       * composited frame containing nothing but the atmosphere, and the lobby
       * appearing already settled at t=2124. Leaving a heavy screen costs what
       * entering one costs, because the browser has to lay out and paint a
       * frame that still contains it.
       *
       * Reduced motion is covered too, which it did not used to be. That
       * setting asks for less *movement*, not for less information — leaving
       * somebody who has switched it on to stare at a frozen unresponsive
       * screen for a second is not an accessibility win. §2.9 of
       * `transitions.css` swaps the sliding panels for a plain cross-fade, so
       * what they get is a cover that appears rather than a cover that travels.
       *
       * What the two cases must *not* share is the drawing. `raiseCurtain`
       * takes the relation and picks an occluder for a match and a room-lit
       * veil for a menu; the long note there says why, and it is the difference
       * between holding a second of black on the way into the Collection and
       * holding a second of the world.
       */
      const veiled =
        outgoing !== null &&
        (plan.relation === "curtain" || this.isHeavy(id) || this.isHeavy(outgoing.id));

      /**
       * A curtain left over from a navigation the player abandoned halfway
       * would sit at z-index 900 across the screen that replaced it. If this
       * one is not a curtain, there is not supposed to be one on screen.
       */
      if (!veiled) this.dropCurtain();

      /**
       * Seal the outgoing screen, and do not move it.
       *
       * The player has committed, so it stops taking clicks and comes out of
       * the tab order this instant — the factory below can block for the better
       * part of a second and a screen that is on its way to the bin must not
       * spend that time answering. Not one pixel changes: the exit animation is
       * not started here, because starting an animation and then blocking the
       * thread is the entire defect this ordering exists to remove.
       */
      if (outgoing) this.seal(outgoing.screen.root, outgoing.cancelSettle);

      /**
       * Light the room first. The crossfade behind the UI is 900ms and the
       * transition in front of it is 380 — starting the slower one first is
       * what makes them land together, and it is the difference between
       * "the background changed too" and "you walked into another room".
       * It is a compositor opacity animation on two pre-painted layers, so it
       * is also the one thing here that keeps running through a blocked thread.
       */
      const world = getAtmosphere();
      world?.enterRoom(routeNode(id).room);

      /**
       * Two frames, so the closing curtain is actually painted before the main
       * thread disappears into a constructor. One is not enough: the
       * continuation of a single `requestAnimationFrame` still runs *before*
       * that frame is drawn.
       *
       * Only a veiled navigation pays for the ~32ms, and it is the only kind
       * that needs to: the curtain's close is a `translate3d` on the
       * compositor, so once it has a frame it keeps playing smoothly for the
       * whole of the block underneath it. That is the one animation in this
       * file that is *supposed* to run while the thread is busy, because it is
       * the one whose job is to say the thread is busy.
       */
      if (veiled && outgoing) {
        this.raiseCurtain(plan, routeNode(id).room);
        await twoFrames();
      }

      /**
       * Build. Nothing on screen is mid-animation while this blocks, which is
       * the whole point of the ordering — and the elapsed time is kept, because
       * the best available answer to "will this screen be slow next time" is
       * how slow it was this time.
       */
      const startedBuild = now();
      const screen = await factory(params);
      this.buildCost.set(id, now() - startedBuild);

      /**
       * Both halves, declared in one task, so they share a start frame.
       *
       * `retire` before `place` because the exit is the shorter animation and
       * the pair is timed from its first frame; `travel` last because
       * `atmosphere.ts` forces a reflow to restart it, and a forced reflow
       * between the two declarations is a chance for them to be given different
       * start times.
       */
      if (outgoing) this.retire(outgoing, plan);
      this.place(screen, id, key, plan, outgoing, veiled);
      world?.travel(plan.travel);
      if (veiled) this.partCurtain(screen.root, plan);
    } catch (error) {
      console.error(`Failed to mount screen "${id}":`, error);
      // The outgoing screen was sealed and never retired, so it is still in the
      // document with no exit and no disposal scheduled. Retire it through the
      // ordinary path before the error screen takes its place.
      if (outgoing && this.current === outgoing) this.retire(outgoing, plan);
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
  private place(
    screen: Screen,
    id: string,
    key: string,
    plan: NavPlan,
    outgoing: Mounted | null,
    veiled = false
  ): void {
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
    /**
     * ...and the curtain is never moved to get out of its way.
     *
     * This used to append the incoming screen and then re-append the curtain
     * over it. Re-parenting an element cancels its running CSS animations —
     * measured: `nav-curtain-close-top` fired `animationstart` at t=712.4 and
     * `animationcancel` at t=726.6, fourteen milliseconds later, on the frame
     * after `place()` ran — and the panels then restarted their close from
     * off-screen, so the veil visibly re-opened onto the frozen lobby and shut
     * again. That is the "pumps back to full brightness" in the middle of the
     * Collection's load, and it was this line.
     *
     * Nothing needed moving in the first place: `.nav-curtain` is `z-index:
     * 900` and `.screen` has no stacking of its own, so the curtain is above
     * every screen whatever the document order. Inserting *under* it keeps that
     * true and leaves its animation alone.
     */
    const before =
      plan.relation === "ascend" && outgoing && outgoing.screen.root.isConnected
        ? outgoing.screen.root
        : this.curtain?.isConnected
          ? this.curtain
          : null;
    if (before) this.host.insertBefore(root, before);
    else this.host.appendChild(root);

    /**
     * Every range this screen brought with it gets its track filled before its
     * first frame is painted. The delegated listener in the constructor keeps
     * them right afterwards; this is the one that stops a slider being drawn
     * empty for as long as nobody has touched it, which on a settings screen is
     * the entire time.
     */
    syncRangesIn(root);

    /**
     * The settle watcher waits for the reveal on a veiled navigation.
     *
     * Behind a closed curtain the entrance runs, finishes and settles without
     * anybody seeing it — measured on `#collection → #lobby`, `nav-ascend-in`
     * ended at t=1181 and the panels did not part until t=1194, so by the time
     * there was anything to look at the screen had already been written
     * `settled`, its animations removed, and `rewindEntrance` had nothing left
     * to rewind. `partCurtain` arms it instead, on the same frame it rewinds
     * the entrance, so the clock starts when the player can see the screen.
     */
    const entry: Mounted = { id, key, screen, cancelSettle: () => {} };
    if (!veiled) entry.cancelSettle = this.watchEntrance(root, plan);
    this.current = entry;
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
   * ## Settling is the end of the *whole* entrance, not the end of the root's
   *
   * This used to key off the first `animationend` whose `event.target` was the
   * root element, which is wrong twice over.
   *
   * `event.target` for a **pseudo-element** animation is the element that owns
   * the pseudo-element, so §2.7's arrival sheen — which runs on
   * `.screen[data-nav$="-in"]::after` and finishes at 348ms — reported itself as
   * the root's own animation ending and settled the screen 32ms before the
   * root's actual entrance was done. Measured on `#lobby → #collection`:
   * `nav-sheen` ended at t=989.3 and `animationcancel` came back at t=1119 on
   * `nav-descend-in` itself, on `nav-ambient-in`, and on two `nav-child-rise`
   * animations. The screen's own entrance was being cancelled by its own
   * highlight.
   *
   * And even without that, the root finishing is not the transition finishing.
   * §2.7's default cascade staggers up to seven children per container at 30ms
   * intervals, so the last panel of a first body container starts at 360ms and
   * lands at 558 — a hundred and seventy-eight milliseconds after a 380ms
   * descend root is done. Writing `settled` there drops the selector the
   * cascade hangs off and snaps three in-flight panels from about 83% straight
   * to rest. §3a: nothing pops.
   *
   * So it waits for every `nav-*` animation in the subtree instead, taken from
   * `getAnimations({ subtree: true })` rather than from events. That list
   * includes animations still inside their `animation-delay` — which is the
   * whole reason events cannot do this job, since `animationstart` fires
   * *after* the delay and the count would hit zero between cascade items — and
   * it includes pseudo-elements. Filtering on the `nav-` prefix is what keeps a
   * screen's own infinite idle animation from holding the settle open forever.
   *
   * The timer is a backstop and nothing more: an element hidden at mount, a
   * stylesheet that has not arrived, an engine with no `getAnimations`.
   */
  private watchEntrance(root: HTMLElement, plan: NavPlan): () => void {
    let done = false;
    const settle = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (root.isConnected) {
        root.dataset["nav"] = "settled";
        root.style.removeProperty("--nav-dur");
        root.style.removeProperty("--nav-delay");
        root.style.removeProperty("--nav-dir");
      }
      /**
       * And this is the quiet moment the outgoing screen's teardown was saved
       * for. Nothing is moving, the arriving screen has stopped, and a screen
       * that wants a second to release 245 canvases can have it without
       * standing on anything. `scheduleFlush` and not `flushDisposals`: soon,
       * but never on this frame.
       */
      this.scheduleFlush();
    };

    /**
     * Taken synchronously, which forces one style recalculation — the same one
     * the frame after this was going to do anyway. Deferring it to a
     * `requestAnimationFrame` would be tidier and would also be a frame in which
     * a slow first paint could let a cascade item slip past unseen.
     */
    const running =
      typeof root.getAnimations === "function"
        ? root.getAnimations({ subtree: true }).filter(isNavAnimation)
        : [];

    if (running.length > 0) {
      void Promise.allSettled(running.map((animation) => animation.finished)).then(() => settle());
    }

    /**
     * Generous, and it has to clear the cascade rather than the root: seven
     * items at 30ms plus the child-rise's own 62% of the duration lands the
     * last panel of a second container well past the root's own end. A screen
     * settled a frame late costs a dropped `will-change`; a screen settled
     * early cancels its own entrance.
     *
     * A veiled navigation does not need extra slack here: `partCurtain` arms
     * this watcher at the reveal rather than at `place()`, so the clock always
     * starts from the frame the entrance actually begins on.
     */
    const timer = window.setTimeout(settle, plan.inDelayMs + plan.inMs + 460);

    return (): void => {
      done = true;
      window.clearTimeout(timer);
    };
  }

  /**
   * Will this route make the player wait?
   *
   * The table's `heavy` is the opening guess and the stopwatch overrules it,
   * because a hand-maintained list of expensive screens across forty-nine
   * routes and fifteen builders is wrong in both directions and nobody finds
   * out. A route measured under `HEAVY_BUILD_MS` stops being veiled even if the
   * table says otherwise; a route measured over it starts being veiled even if
   * nobody ever classified it. The only navigation that runs on a guess is the
   * first one of the session to each destination, which is exactly the one no
   * measurement can exist for.
   *
   * This deliberately answers for a route rather than for a direction, and is
   * asked about both endpoints. Leaving a heavy screen and entering one cost
   * the same thing — the browser has to lay out and paint a frame containing
   * it either way — and the version of this that only asked about the
   * destination left Back out of the collection completely uncovered.
   */
  private isHeavy(id: string): boolean {
    const measured = this.buildCost.get(id);
    if (measured !== undefined) return measured >= HEAVY_BUILD_MS;
    return routeNode(id).heavy === true;
  }

  /**
   * Take the outgoing screen out of play without moving it.
   *
   * Split out of `retire` because the two things happen at opposite ends of a
   * navigation now. The player has committed the moment the hash changes, so
   * the screen they are leaving must stop taking clicks and leave the tab order
   * *immediately* — the factory below it can block for the better part of a
   * second and a screen on its way to the bin should not spend that second
   * answering. But it must also not start moving, because there is nothing to
   * replace it with yet.
   *
   * Everything here is invisible by construction: `inert`, `aria-hidden` and
   * `pointer-events` change no pixels, and `.screen-out` carries only the
   * pointer guard once `transitions.css` has overridden its keyframes. The
   * screen the player is looking at stays exactly as it was drawn.
   *
   * `.screen-out` stays for a second reason: `shot.mjs` and every
   * `verify-*.mjs` wait for it to disappear to know a swap has finished.
   * Breaking that would break every screenshot in the project to save a class
   * name.
   */
  private seal(root: HTMLElement, cancelSettle: () => void): void {
    cancelSettle();
    root.classList.add("screen-out");
    /**
     * `pointer-events: none` only stops the mouse. A screen that is on its way
     * out still holds its buttons in the tab order and its headings in the
     * accessibility tree, and on an ascend it is painted *above* the screen
     * that replaced it — so somebody navigating by keyboard could tab into a
     * panel that is about to be disposed of. `inert` takes the whole subtree out
     * of both, and moves focus off it if that is where the focus was.
     */
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
  }

  /**
   * Hold a teardown until there is a frame to spare for it.
   *
   * `dispose()` is a screen's constructor run backwards and costs the same kind
   * of money: the collection's measured ~530ms of canvas teardown used to run
   * the instant its exit animation ended, which is 170ms into a 340ms ascend —
   * so the parent's return was frozen from its second frame onward and arrived
   * already settled. Detaching the element is what stops it being drawn, and
   * that happens immediately; the teardown is bookkeeping and can wait for
   * `watchEntrance` to say the arriving screen has stopped moving.
   *
   * The timer is a backstop for a settle that never comes. Nothing here is
   * allowed to leak: `flushDisposals` runs on settle, on the backstop, and at
   * the top of the next navigation, and it is idempotent.
   */
  private queueDisposal(run: () => void): void {
    this.pendingDisposals.push(run);
    window.clearTimeout(this.disposalTimer);
    this.disposalTimer = window.setTimeout(() => this.flushDisposals(), 1200);
  }

  /**
   * Ask for the teardown to happen soon, but never *now*.
   *
   * The first version of this ran the queue inline from `settle()`, which moved
   * the collection's 1.1 second teardown from the middle of the ascend to the
   * frame immediately before the curtain parted — measured, the reveal slipped
   * from t=1194 to t=2333 and the lobby appeared already settled. Trading one
   * badly-placed second for another is not a fix.
   *
   * So it goes on an idle callback. There is genuinely nothing to be gained by
   * running it a frame sooner, and an idle callback is the one scheduling
   * primitive that means "when nothing else wants the thread". The timeout is
   * the promise that it happens at all on a page that never goes idle, and
   * `handleHash` flushes synchronously before the next build regardless — a
   * teardown queued behind a navigation is paid behind that navigation's seal.
   */
  private scheduleFlush(): void {
    if (this.pendingDisposals.length === 0) return;
    const idle = (
      globalThis as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") idle(() => this.flushDisposals(), { timeout: 700 });
    else window.setTimeout(() => this.flushDisposals(), 120);
  }

  private flushDisposals(): void {
    window.clearTimeout(this.disposalTimer);
    this.disposalTimer = 0;
    while (this.pendingDisposals.length > 0) {
      const run = this.pendingDisposals.shift();
      try {
        run?.();
      } catch (error) {
        // One badly-behaved screen must not be able to wedge the router on its
        // way out, and a teardown that throws has already stopped being drawn.
        console.error("Screen dispose threw on the way out:", error);
      }
    }
  }

  /**
   * Start the outgoing screen leaving, and arrange for it to be disposed of
   * exactly once.
   *
   * Called **after** the incoming screen has been built, which is the ordering
   * the whole file turns on: the exit and the entrance are declared in the same
   * task, so they are given the same start frame and neither can play against a
   * blocked thread. `seal` has already taken this screen out of play.
   *
   * Three things have to be impossible here and all three used to be reachable
   * with a bare 200ms timer:
   *
   *  - **a screen left mounted.** Every exit path — the animation ending, the
   *    backstop timer, a fresh navigation arriving — runs the same `finish`,
   *    and `finish` is idempotent.
   *  - **a screen disposed mid-transition.** Disposal only happens on `finish`,
   *    and `finish` will not run until the incoming screen has been placed;
   *    `release` is what says it has. It is then *queued* rather than run, for
   *    the reason at `queueDisposal`.
   *  - **screens stacking up.** At most one screen is ever retiring. A second
   *    navigation inside the first one's transition finishes the first
   *    immediately, so five fast clicks leave two elements in the DOM, not six.
   */
  private retire(entry: Mounted, plan: NavPlan): void {
    this.retiring?.finish();

    const root = entry.screen.root;
    root.style.setProperty("--nav-dur", `${plan.outMs}ms`);
    root.style.removeProperty("--nav-delay");
    if (plan.relation === "sibling") root.style.setProperty("--nav-dir", String(plan.direction));
    root.dataset["nav"] = `${plan.relation}-out`;
    // Idempotent: `seal` already did these when the player committed. Repeated
    // here so a caller that reaches `retire` by some other path is still safe.
    this.seal(root, entry.cancelSettle);

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
      // Out of the document now — that is what stops it being drawn — and torn
      // down once the arriving screen has stopped moving. See `queueDisposal`.
      root.remove();
      this.queueDisposal(() => entry.screen.dispose?.());
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
   *
   * ## Two veils, and the reason the relation has to come in here
   *
   * This used to build the identical element for both callers, so opening the
   * Collection and entering a match were the same gesture — the same opaque
   * panels closing over the same seam. Measured on lobby → collection, that
   * meant the screen sat at RGB (7,4,14) — black — for the 949ms the collection
   * constructor takes, with the persistent world this module goes to such
   * lengths to keep continuous completely occluded, on the most-visited menu
   * step in a card game. It also spent the game's biggest gesture on opening a
   * card list, which leaves nothing left to say when the player presses PLAY.
   *
   * So the element is the same and the surface is not: `data-veil` picks between
   * an occluder and a scrim in `transitions.css` §2.8. A battle blacks out. A
   * heavy menu route holds behind a lit, room-tinted, grained surface with the
   * near plane's dust still drifting across it — `.atmosphere-fore` is a sibling
   * of `#app`, so it paints over the curtain and the world is genuinely still
   * moving in front of the cover.
   *
   * **The menu veil is opaque, and that is a correction.** It was translucent,
   * on the reasoning above that occluding the world contradicts the module's
   * own thesis. Measured, what that actually bought was the lobby staying
   * legible through a bright horizontal seam for about 550ms — a screen the
   * player can read and cannot use, which is worse than an honest cover — while
   * the swap underneath it happened in plain sight. Continuity is not the same
   * promise as transparency: what has to stay continuous is the *light*, and a
   * cover painted in the destination's own key, lit from the same 315°, carrying
   * the same grain and with the same dust crossing it, is a surface inside the
   * world rather than a hole punched through it. Hearthstone's book is opaque
   * too.
   *
   * The room's key colour is written on as `--room-key` so the tint is the
   * destination's own light. Without it the `color-mix` in the stylesheet falls
   * back to the house violet and the forge and the market hold on the same
   * colour, which is the one thing a per-route lighting model exists to stop.
   */
  private raiseCurtain(plan: NavPlan, room: AtmosphereRoom): void {
    this.dropCurtain();
    const curtain = document.createElement("div");
    curtain.className = "nav-curtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.dataset["phase"] = "close";
    curtain.dataset["veil"] = plan.relation === "curtain" ? "battle" : "menu";
    curtain.style.setProperty("--nav-dur", `${CURTAIN.close}ms`);
    curtain.style.setProperty("--room-key", ROOMS[room].key);
    curtain.innerHTML =
      '<div class="nav-curtain-panel is-top"></div>' +
      '<div class="nav-curtain-panel is-bottom"></div>' +
      '<div class="nav-curtain-seam"></div>';
    this.host.appendChild(curtain);
    this.curtain = curtain;
  }

  /**
   * Part it, on the incoming screen's first painted frame.
   *
   * It used to wait `plan.inDelayMs`, on the reasoning that the screen behind the
   * curtain should already be in motion when the halves move — which is right,
   * and a timer is the wrong way to know it. The three routes this covers block
   * the main thread for the better part of a second inside their constructors, so
   * by the time `place()` returns the entrance has not started and a further
   * 110ms of timer is 110ms of held veil on the slowest navigation in the game.
   *
   * A double `requestAnimationFrame` asks the question the timer was guessing at:
   * the continuation of the second one runs after the frame carrying the incoming
   * screen's first keyframe has actually been drawn, so the reveal still shows a
   * live screen and it shows it as soon as there is one. With `CURTAIN.linger`
   * gone as well that is about 250ms off every `heavy` route.
   *
   * Two frames turned out not to be enough, and the reason is instructive: the
   * frame that carries the destination's first paint is followed by several more
   * that carry the rest of it. Measured on `#lobby → #collection`, `place()`
   * returned at t≈1160 and the screen then took the main thread for another
   * 480ms in chunks of 100–430ms; a part fired two frames later ran its whole
   * 210ms in two composited frames. So the wait is now `quietFrame` — the first
   * frame that arrived on time — with `REVEAL_PATIENCE_MS` as the ceiling.
   *
   * And the entrance is rewound to meet it. The destination's own descend was
   * spent under an opaque cover in every measurement of every heavy route, so
   * the curtain parted onto a screen already at rest. `rewindEntrance` puts the
   * cascade, the sheen and the root's own arrival back at frame zero, so the
   * reveal shows a screen arriving rather than a screen that has arrived.
   */
  private partCurtain(root: HTMLElement, plan: NavPlan): void {
    const curtain = this.curtain;
    window.clearTimeout(this.curtainTimer);
    const reveal = (): void => {
      /**
       * Rewind and arm now; part `CURTAIN.lead` later. The screen comes up
       * behind the closed panels and is already most of the way in when they
       * start to move, which is both the §3a overlap rule and the only thing
       * that stops the reveal opening onto an `opacity: 0` screen.
       */
      const entry = this.current;
      if (root.isConnected && entry?.screen.root === root) {
        rewindEntrance(root);
        entry.cancelSettle();
        entry.cancelSettle = this.watchEntrance(root, plan);
      }
      if (this.curtain !== curtain || !curtain?.isConnected) return;
      this.curtainTimer = window.setTimeout(() => {
        if (this.curtain !== curtain || !curtain.isConnected) return;
        curtain.style.setProperty("--nav-dur", `${CURTAIN.open}ms`);
        curtain.dataset["phase"] = "open";
        this.curtainTimer = window.setTimeout(() => {
          if (this.curtain === curtain) this.dropCurtain();
        }, CURTAIN.open);
      }, CURTAIN.lead);
    };
    if (!curtain?.isConnected) {
      reveal();
      return;
    }
    void quietFrame(REVEAL_PATIENCE_MS).then(reveal);
  }

  private dropCurtain(): void {
    window.clearTimeout(this.curtainTimer);
    this.curtainTimer = 0;
    this.curtain?.remove();
    this.curtain = null;
    // A veiled navigation can settle while the veil is still up, so the queue
    // gets a second chance here: with the cover gone there is nothing left that
    // a long teardown could hold up.
    this.scheduleFlush();
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
