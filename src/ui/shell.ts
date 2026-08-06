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
import { dressMatchCurtain } from "./intro/matchCurtain";
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
  /**
   * What to call this place on a cover, when the id is not the answer.
   *
   * Only the veil reads it, and only where `titleCase(id)` would be wrong or
   * ugly — `deckbuilder` is not "Deckbuilder" and `uikit` is not "Uikit". Every
   * other route derives its own, so adding a screen still requires nothing here.
   */
  title?: string;
  /** A live match. Entering or leaving one is always the curtain. */
  battle?: boolean;
  /**
   * A prior, not a fact: this screen is expected to take long enough to build
   * that the wait wants covering.
   *
   * It is only the opening guess, and it is the guess for **the first visit**,
   * which is the one no measurement exists for yet. `collection`, `gallery`,
   * `deckbuilder` and `uikit` are here because they were each once measured over
   * half a second, and being wrong about them on the first navigation of a
   * session is exactly the failure this whole file is about.
   *
   * From the second visit the stopwatch outranks it, in both directions — see
   * `Shell.isHeavy`, which is where the rule and the measurements behind it are
   * written down. A route marked heavy here that turns out to build *and* tear
   * down inside a frame stops being veiled; a route nobody classified that turns
   * out to cost 900ms starts being veiled. A table maintained by hand across
   * forty-nine screens and fifteen builders will always be a little wrong; a
   * stopwatch is never wrong about the screen it just built.
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
  /**
   * The gallery has stopped being heavy, and this is the flag coming off.
   *
   * It was the most expensive route in the game to enter — 138 framed portraits
   * built whatever the fold held, 1,636 nodes, 15fps and 1,077ms of long tasks —
   * and it now builds eleven shelves' worth of furniture and about twenty faces,
   * for 666 nodes. Measured with `_w9heavy.mjs` across a warm walk carrying
   * `#missions` as an untouched control, with and without this flag:
   *
   *     veiled     first visit 36.9fps  settled 643    second 47.5fps  settled 543
   *     unveiled   first visit 41.9fps  settled 583    second 41.3fps  settled 586
   *
   * So the cover is no longer buying anything on this route — which is what
   * `RouteNode.heavy` says a stale prior looks like, and the stopwatch had
   * already been overruling it from the second visit onward. Off the flag, a
   * player never sees a title card on the way into the cast, at either end.
   *
   * `collection` and `deckbuilder` keep theirs on the same evidence read the
   * other way: both still rasterise a fold's worth of card canvases on a first
   * visit — twenty-one on the deck builder, measured — and dropping their flags
   * took that visit from 18.8fps to 8.1 and from 17.5 to 8.8 against the same
   * control. Their build *cost* is under `HEAVY_BUILD_MS`, which is why the
   * stopwatch unveils them from visit two, and their first visit is still a
   * second of dropped frames that the cover is the right thing to put over.
   */
  gallery: { parent: "lobby", order: 14, room: "forge" },
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
  uikit: { parent: "lobby", order: 19, room: "forge", heavy: true, title: "Foundation" },

  // --- mode select's children ---
  tour: { parent: "play", order: 0, room: "play" },
  story: { parent: "play", order: 1, room: "stage" },
  gauntlet: { parent: "play", order: 2, room: "descent" },
  custom: { parent: "play", order: 3, room: "play" },
  signin: { parent: "play", order: 4, room: "system" },
  cloudsave: { parent: "play", order: 5, room: "system" },
  queue: { parent: "play", order: 6, room: "arena" },

  // --- one level further down ---
  deckbuilder: { parent: "decks", order: 0, room: "forge", heavy: true, title: "Deck Builder" },
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

/**
 * Not exported, and `tests/no-orphan-ui.test.ts` is why.
 *
 * This and `planNavigation` are both called all over this file and nowhere
 * else in the repository, which is exactly the shape that test names: an export
 * is a promise that something outside is using it, and an unkept one is
 * indistinguishable from a feature that was built and never plugged in. They
 * are internal helpers; the module's actual contract is `Shell`, `ROUTES` and
 * the two types.
 */
function routeNode(id: string): RouteNode {
  return ROUTES[id] ?? UNKNOWN_ROUTE;
}

/**
 * What to call a route on a cover when the table has not said.
 *
 * Forty-nine route ids are already words a human chose — `collection`,
 * `missions`, `leaderboards` — so the default is those words with a capital on
 * the front and hyphens opened out. The half-dozen that read badly that way
 * carry a `title` in `ROUTES` instead. A screen added next month needs neither.
 */
function routeTitle(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Route ids and room names are both ours, and both go through here anyway.
 *
 * This string is written with `innerHTML`, and the rule about `innerHTML` is
 * that it does not matter how trustworthy today's inputs are — it matters what
 * the next person puts in the table. Four characters and the question never has
 * to be asked again.
 */
function escapeText(value: string): string {
  return value.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;"
  );
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
 *   descend    170       0   320     320       170
 *   ascend     170       0   320     320       170
 *   sibling    160       0   270     270       160
 *   curtain    200     110   310     420        90
 *   replace    130       0   250     250       130
 *
 * ## The entrance delays are zero now, and §2.0 of the stylesheet is why
 *
 * They were 20–60ms so that the screen being left had a beat to itself before
 * the screen being asked for arrived — the "old leaves while new arrives,
 * sharing 80–120ms" shape, with the sharing arranged by hand. The hold makes
 * that arrangement structural instead: by the time anything is placed, the
 * outgoing screen has already played the first 40% of its exit and has been
 * sitting receded for however long the constructor took. A delay on top of
 * that is not overlap, it is a gap — and it measured as one. On `lobby → play`,
 * with the parent entering its exit already blurred and dimmed while the child
 * was still pinned at zero by `--nav-delay`, the composited frame at t=253ms
 * came in at **40%** of the reference mean and **18%** of its 95th percentile:
 * darker than the defect that put the 0.12 floor in the stylesheet.
 *
 * So the exchange is now the whole of both halves and the overlap column is the
 * outgoing animation in full. `curtain` keeps its delay, because there the
 * reveal is scheduled against the panels rather than against the exit.
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
/**
 * How long the departing screen recedes *before* the destination is built.
 *
 * §2.0 of `transitions.css` has the argument and the measurements; this is the
 * number. 70ms is the first 40% of the shortest exit in the table, so a
 * navigation whose constructor happens to be instant plays a hold and an exit
 * back to back at the same speed the exit alone used to run at, and one whose
 * constructor takes a third of a second has a receded, lit, still-moving parent
 * on screen for the whole of it instead of a frozen one.
 *
 * It is not scaled by the animation-speed preference and it is not shortened by
 * reduced motion below 60ms: this is the frame that says the press was heard,
 * and the two frames `twoFrames()` costs to get it composited are the whole
 * budget. Anything shorter and the compositor never sees it.
 */
const HOLD_MS = 70;
const REDUCED_HOLD_MS = 60;

const TIMING: Readonly<Record<NavRelation, NavTiming>> = {
  arrive: { out: 0, inDelay: 0, in: 300 },
  descend: { out: 170, inDelay: 0, in: 320 },
  ascend: { out: 170, inDelay: 0, in: 320 },
  sibling: { out: 160, inDelay: 0, in: 270 },
  curtain: { out: 200, inDelay: 110, in: 310 },
  replace: { out: 130, inDelay: 0, in: 250 },
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
 *
 * ## It went to 60, it made things worse, and it is back
 *
 * The argument for 60 was sound and its premise had expired. A CSS animation's
 * clock does run in real time, so a 170ms exit declared in front of a 116ms
 * block used to be an exit nobody saw — but §2.0's hold and the `twoFrames()`
 * above the build fixed *that*, by giving the exit a composited frame before
 * the thread disappears. What lowering the bar afterwards did was hand a cover
 * to every navigation in the game, and the cover is the worst surface in it:
 * filmed at 1600×900, an ordinary `lobby → play` under the late veil put a
 * frame on the glass at 47% of the reference mean and **24%** of its 95th
 * percentile, against 77% and 55% for the same leg with no veil at all. The
 * thing drawn to prevent a dark frame was the dark frame.
 *
 * It is also self-concealing, which is why it survived a round: with every leg
 * veiled, `tests/never-a-blank-frame.test.ts` skips its pixel check on all of
 * them — "a veil is allowed to be dark" — and the suite's one honest failure is
 * the assertion that notices it has nothing left to measure.
 *
 * Measured on this machine, warm, at 1600×900 (`scripts/_w3nav_cost.mjs`):
 *
 *     play        200 nodes   0 long tasks   118 rAF frames in 1.6s
 *     mastery     213 nodes   0 long tasks   118
 *     settings    159 nodes   0 long tasks   120
 *     missions    356 nodes   one 57ms task  113
 *     collection 1529 nodes   16 tasks       65
 *
 * Four of those five want no cover at all, and the fifth is flagged `heavy` in
 * the route table. So the threshold goes back to a length a player can name,
 * and the node-count prior below it goes entirely.
 */
const HEAVY_BUILD_MS = 220;

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
  /** how long the departing screen recedes before the build starts */
  holdMs: number;
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
function planNavigation(from: string | null, to: string): NavPlan {
  const { relation, direction } = relationBetween(from, to);
  const reduced = reducedMotion();
  const timing = reduced ? REDUCED_TIMING : scaleTiming(TIMING[relation]);
  return {
    relation,
    direction,
    holdMs: reduced ? REDUCED_HOLD_MS : HOLD_MS,
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

/**
 * One frame, purely to break a task in half.
 *
 * Used between the destination's constructor and the moment it is placed, and
 * the reason is a measurement rather than tidiness. A factory's synchronous
 * body, `place()`, and the browser's first style/layout/paint of a whole new
 * screen all used to happen inside one task: on `lobby → missions` that was a
 * single **228ms** window in which nothing was sampled, nothing was composited
 * and no input was accepted, and `tests/never-a-blank-frame.test.ts` fails any
 * unobserved stretch over 200ms because that is where every hole this project
 * has found was hiding.
 *
 * Yielding once splits it into a ~140ms build and a ~90ms paint with a rendered
 * frame between them. It costs one frame of latency and it converts one window
 * the page is unaccountable for into two it is not. It also means the entrance
 * is declared at the *start* of a frame rather than at the tail of a long task,
 * so its first keyframe is the first thing painted rather than the third.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    requestAnimationFrame(() => resolve());
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

/**
 * How many children of a container carry the cascade, and how many carry the
 * de-sync index.
 *
 * Seven rise (§2.7's band starts at 30ms and seven of them keeps the tail
 * inside the settle); eight get `--cascade-i`, because `foundation.css` reads
 * the same number as the phase offset for its idle sheen and an eighth plate
 * sweeping in step with the first is exactly what that offset exists to stop.
 */
const CASCADE_RISERS = 7;
const CASCADE_INDEXED = 8;

/**
 * Which of a screen's own children the entrance cascade belongs to, decided
 * here rather than by a selector.
 *
 * §2.7 of `transitions.css` used to work this out in CSS, with
 * `> :is(header, nav, main, section, footer, [class*="-body"], [class*="-sheet"]) > *:nth-child(-n+7)`
 * and eight `> * > *:nth-child(N)` rules to number them. Both shapes force
 * Blink to register a *whole-subtree* invalidation set — the first against the
 * `class` attribute, because a substring match cannot be indexed by class name;
 * the second against `data-nav`, because a bare `*` as the rightmost compound
 * cannot be indexed at all. The consequence was that writing one attribute on a
 * screen root cost 23ms on the lobby, 34ms on Missions and 42ms on the
 * Collection, and adding *any* class — even one that matches nothing — cost 12
 * to 22ms. `seal()` adds a class and `beginExit()` writes `data-nav`, on the
 * frame the hash changes, which is where every measured leg's first long task
 * was coming from.
 *
 * Doing it in script is not a workaround for a slow browser; it is the correct
 * division. The shell is the only thing that knows a screen has just been built
 * and is not yet in the document — and an attribute written on a detached tree
 * invalidates nothing, because there is nothing to invalidate. One pass over
 * about five children and forty grandchildren, at mount, replaces a
 * per-mutation cost paid for the life of the screen.
 *
 * The container test is the stylesheet's, transcribed: the semantic sectioning
 * elements, plus anything named `*-body` or `*-sheet`, which is how the forty
 * screens that use a `<div>` wrapper spell one. `#uikit`'s `.kit-sheet` is the
 * reason the second half exists — see the note this replaces.
 */
function markCascade(root: HTMLElement): void {
  let bodies = 0;
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName;
    const head = tag === "HEADER" || tag === "NAV";
    const name = child.className;
    const body =
      tag === "MAIN" ||
      tag === "SECTION" ||
      tag === "FOOTER" ||
      name.includes("-body") ||
      name.includes("-sheet");
    if (!head && !body) continue;
    /**
     * Head at 0, the first body container at 4, everything after it at 11 —
     * the three `--cascade-base` values, resolved here and added straight into
     * the index. A cascade that restarts inside each container while its base
     * does not move with it puts a header's third item and a body's first item
     * on the same frame, which is the collision §2.7 documents.
     */
    const base = head ? 0 : bodies++ === 0 ? 4 : 11;
    child.dataset["cascade"] = head ? "head" : "body";
    let index = 0;
    for (const item of Array.from(child.children)) {
      if (index >= CASCADE_INDEXED) break;
      if (!(item instanceof HTMLElement)) continue;
      item.style.setProperty("--cascade-i", String(base + index));
      if (index < CASCADE_RISERS) item.dataset["rise"] = "";
      index += 1;
    }
  }
}

/**
 * The seven layers of the room, back to front, and the order matters.
 *
 * Alcove (the accent), crawl (the accent moving), the far dust, the near grid,
 * the near dust, the wall, then the floor **over everything** so the bottom of
 * the frame darkens the dust too. A floor under the dust would leave specks
 * glowing inside the dark mass, which is the one arrangement that reads as a
 * rendering fault rather than as air.
 *
 * A frozen array rather than a template string, because this is built with
 * `createElement` on a detached tree rather than written through `innerHTML`.
 * The screen's own markup has already been parsed by the time this runs, and
 * touching `innerHTML` again would re-parse all of it.
 */
export const ROOM_LAYERS = [
  "d-room-alcove",
  "d-room-crawl",
  "d-room-dust is-far",
  "d-room-grid",
  "d-room-dust",
  "d-room-wall",
  "d-room-floor",
] as const;

/**
 * What colour a route's room is lit in, as a pure function of its id.
 *
 * Split out of `dressScreen` and exported for one reason, and it is the reason
 * this whole wave exists: the claim being made is *"a route added tomorrow gets
 * a lit room without anybody remembering"*, and that claim is either executable
 * or it is a comment. `tests/every-screen-is-a-room.test.ts` hands this an id
 * that appears nowhere in the codebase and asserts it still comes back with a
 * colour — which is the assertion that would have failed two waves ago, when
 * the answer for thirty-eight of forty-nine routes was "nothing at all".
 *
 * `--hall-lit` is floored rather than passed straight through. `ROOMS`
 * intensities run 0.42 (Back Office) to 1.0 (the Lobby) and were chosen for a
 * full-viewport wash *behind* a screen; the alcove is a smaller, closer light
 * and the same number reads roughly half as strong on it, so the quiet rooms
 * would arrive at a tint nobody can see — which is exactly how a screen that is
 * nominally lit ends up measuring like an unlit one. The mapping keeps the
 * ordering and lifts the bottom: 0.42 becomes 0.65, 1.0 stays 1.0.
 */
export function roomLightFor(id: string): { accent: string; lit: string } {
  const light = ROOMS[routeNode(id).room];
  return { accent: light.key, lit: (0.42 + light.intensity * 0.58).toFixed(3) };
}

/**
 * Give a screen the room it gets for being a screen.
 *
 * ## The mistake this replaces
 *
 * The room — four depth planes, an accent alcove where the key light is, a
 * floor that gives the frame a dark mass, and layers that drift so the screen
 * is alive at rest — was built as `kit.ts::room()`, a helper a screen called
 * from inside its own template. Eleven screens called it. Measured with
 * `scripts/_w7rw_probe.mjs`: those eleven idled at 0.88–1.89 per 200ms and the
 * other thirty-eight at 0.18–0.71, minima down at 0.067, against a Hearthstone
 * reference of min 0.501 / median 1.713. Nothing about the room was wrong. The
 * *opt-in* was wrong, and the half of the game left out of it included the
 * front door.
 *
 * So it happens here instead, and "here" is chosen carefully. `place()` is the
 * one funnel every route in the game passes through — there is no second way to
 * mount a screen — and this runs on the **detached tree**, in the same pass as
 * `markCascade`, before the element has ever been in the document. Seven
 * appends and two custom properties on a tree nothing is observing invalidate
 * nothing; the same writes after insertion would each cost a style recalc on a
 * subtree the size of a screen, which is the exact cost `markCascade` exists to
 * document.
 *
 * ## What guarantees tomorrow's route
 *
 * Three things, and they are independent, which is the point:
 *
 * 1. A route does not opt in. It cannot: nothing in a screen factory is
 *    consulted. A screen is dressed because `place()` mounted it.
 * 2. The stylesheet is not the data domain's any more. §1.9 of
 *    `theme/transitions.css` is imported by `atmosphere.ts` and therefore
 *    present from boot, so the layers are painted whether or not the route in
 *    question has ever pulled in `screens/data/kit.ts`.
 * 3. The accent comes from `routeNode(id).room`, and `routeNode` already
 *    answers for a route that is not in `ROUTES` at all — `UNKNOWN_ROUTE` puts
 *    it in the hub's light. An unclassified screen gets a lit room, not an
 *    exception and not a black rectangle.
 *
 * ## What a screen may still decide
 *
 * Exactly one thing, and only by writing `--hall-accent` on its own root before
 * it is handed over: which colour the room is lit in. `profileScreen` is the
 * case that needs it — its accent is the player's chosen colour and cannot come
 * from a static table. Anything already set is left alone; everything else takes
 * the room the route belongs to, so the Collection and the Deck Builder are lit
 * as one workshop without either of them having said so.
 */
const roomWatchers = new WeakMap<HTMLElement, MutationObserver>();

function buildRoom(root: HTMLElement): void {
  // Idempotent, and it has to be: the observer below re-runs this on every
  // direct-child mutation, and a room stacked behind another room is two rooms.
  if (root.querySelector(":scope > .d-room")) return;
  const room = document.createElement("div");
  room.className = "d-room";
  room.setAttribute("aria-hidden", "true");
  for (const layer of ROOM_LAYERS) {
    const node = document.createElement("div");
    node.className = layer;
    room.appendChild(node);
  }
  /**
   * First child, which is where `.ambient-bg` used to sit and where a `z-index:
   * -1` box has to be if a screen paints anything of its own at the same level.
   * `insertBefore(node, null)` is `appendChild`, so an empty screen is fine.
   */
  root.insertBefore(room, root.firstChild);
}

function dressScreen(root: HTMLElement, id: string): void {
  const light = roomLightFor(id);
  /**
   * `style.getPropertyValue` rather than `getComputedStyle`, and that is not an
   * optimisation — it is the only thing that works. The tree is detached, so it
   * has no computed style to read; the inline declaration is the only place a
   * screen's own choice can be sitting at this point in its life.
   */
  if (!root.style.getPropertyValue("--hall-accent")) root.style.setProperty("--hall-accent", light.accent);
  if (!root.style.getPropertyValue("--hall-lit")) root.style.setProperty("--hall-lit", light.lit);

  buildRoom(root);

  /**
   * ## And then it has to survive the screen rebuilding itself
   *
   * This is the correction that came out of the first measured sweep, and it is
   * the one worth reading. Every route came back with seven planes and a lit
   * room — **except the lobby, which came back with none.** Not because the
   * shell skipped it: because `lobbyScreen` sets `root.innerHTML` inside its
   * own `render()`, and `render()` runs again whenever the profile changes or
   * the screen resumes from a child. One assignment removes every direct child
   * the shell put there, silently, with no error and no type change, and the
   * front door goes back to being the flat screen this whole wave exists to
   * fix. That is the *same class of failure* as the opt-in — a mechanism that
   * is true at one moment and quietly stops being true later — arrived at from
   * the other direction, and a fix that did not survive it would have shipped
   * looking correct in every still taken within a second of a navigation.
   *
   * A `MutationObserver` with `childList` and **no `subtree`** is the cheap
   * answer. It fires only when a screen's *direct* children change, which is
   * essentially only on a full re-render; the Collection rebuilding two hundred
   * cells inside its body mutates nodes several levels down and is not observed
   * at all. `buildRoom` is idempotent, so a re-render costs one query and one
   * insert, and a screen that never re-renders costs a registration and nothing
   * else.
   *
   * The custom properties survive an `innerHTML` write on their own — they are
   * inline styles on the root, and the root is the thing being written *into*.
   */
  roomWatchers.get(root)?.disconnect();
  const watcher = new MutationObserver(() => buildRoom(root));
  watcher.observe(root, { childList: true });
  roomWatchers.set(root, watcher);
}

/** Stop watching a screen that has left the document. */
function undressScreen(root: HTMLElement): void {
  roomWatchers.get(root)?.disconnect();
  roomWatchers.delete(root);
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
   * How long each route's `dispose()` actually took, the last time one ran.
   *
   * The other half of the stopwatch, and the reason `isHeavy` can be allowed to
   * demote again. The note there records why demotion was withdrawn: the
   * Collection's constructor was virtualised, came in under the bar, cleared its
   * flag — and *leaving* it still tore 245 canvases down in a 216ms block that
   * nothing covered. That was a correct objection to an incomplete measurement,
   * not to measurement. A factory's elapsed time is not the cost of a route;
   * build **and** teardown together are much closer to it, and both are numbers
   * this file already stands next to.
   */
  private readonly teardownCost = new Map<string, number>();
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
  private readonly pendingDisposals: Array<{ id: string; run: () => void }> = [];
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
      let veiled =
        outgoing !== null &&
        (plan.relation === "curtain" || this.isHeavy(id) || this.isHeavy(outgoing.id));

      /**
       * A curtain left over from a navigation the player abandoned halfway
       * would sit at z-index 900 across the screen that replaced it. If this
       * one is not a curtain, there is not supposed to be one on screen.
       */
      if (!veiled) this.dropCurtain();

      /**
       * Seal the outgoing screen, and start it receding.
       *
       * The player has committed, so it stops taking clicks and comes out of
       * the tab order this instant — the factory below can block for the better
       * part of a second and a screen that is on its way to the bin must not
       * spend that time answering.
       *
       * **And it moves, which is a reversal of what this file used to say.**
       * The old rule was that nothing may animate before the build, because a
       * CSS animation's clock runs in real time and a 170ms exit declared in
       * front of a 240ms block is an exit nobody sees. That reasoning is sound
       * about an animation that *ends*; it is exactly backwards about one that
       * ends in a state worth holding. `<relation>-hold` plays the first 40% of
       * the exit — the geometry, not the dim — and fills there for as long as
       * the wait lasts, on the compositor, where a blocked thread cannot reach
       * it. Measured before this: `lobby → mastery` held a pixel-identical
       * lobby for 583ms and then cut. See §2.0 of `transitions.css`.
       */
      if (outgoing) {
        this.seal(outgoing.screen.root, outgoing.cancelSettle);
        this.beginExit(outgoing.screen.root, plan);
      }

      /**
       * The cover goes up before anything else that can take the thread.
       *
       * It used to be raised after `enterRoom`, and that ordering cost it 96
       * milliseconds: traced on `collection` back to `lobby`, the first rAF gap
       * opened at t=2 and the curtain element was not appended until t=98 —
       * inside the block it existed to cover. Lighting the room forces a reflow
       * to restart the crossfade, which is exactly the kind of work a cover is
       * supposed to be in front of rather than behind.
       */
      if (veiled && outgoing) this.raiseCurtain(plan, id);

      /**
       * Light the room. The crossfade behind the UI is 900ms and the transition
       * in front of it is 320 — starting the slower one first is what makes
       * them land together, and it is the difference between "the background
       * changed too" and "you walked into another room". It is a compositor
       * opacity animation on two pre-painted layers, so it is also one of the
       * two things here that keep running through a blocked thread.
       */
      const world = getAtmosphere();
      world?.enterRoom(routeNode(id).room);

      /**
       * ## Behind a board, the room is not drawn
       *
       * A match fills the viewport with an opaque three.js scene, so the seven
       * planes behind the screen are invisible by definition — and they are not
       * free: sixteen interleaved arms at 1600×900 charge the room and the
       * front grain together at **+3.42ms and +4.43ms** of frame interval on
       * `#battle`, against **−0.47ms** for the same test on `#missions`, which
       * is inside the instrument's own noise.
       *
       * **A property, not a route list.** `battle` is the flag already on
       * `RouteNode` that decides a match gets the curtain rather than a descend,
       * so a match added tomorrow declares it or gets the wrong transition, and
       * a menu route added tomorrow declares nothing and keeps its room.
       *
       * §1.9a of `transitions.css` carries the rest, including the version of
       * this that was wrong: dropping the *grain* here as well took `#boss` to
       * 0.203, under the floor, because a match at rest is the mulligan — a
       * modal over a blurred still — and not a live board at all.
       */
      const board = document.documentElement.dataset;
      if (routeNode(id).battle) board["board"] = "true";
      else delete board["board"];

      /**
       * Two frames, and now they are paid on **every** navigation.
       *
       * They used to be the veiled path's alone, on the reasoning that only a
       * curtain has to be composited before the thread disappears. That was
       * true of the curtain and false of everything else: the hold above has
       * exactly the same requirement, and a hold declared and then immediately
       * blocked for 240ms is rendered for the first time already finished,
       * which is the defect in its original form.
       *
       * One is not enough — the continuation of a single `requestAnimationFrame`
       * still runs *before* that frame is drawn — and the ~32ms it costs is
       * bought back many times over by the destination's entrance no longer
       * being declared at the tail end of a long task.
       */
      if (outgoing) {
        await twoFrames();
        /**
         * ## And the last navigation's teardown is paid **here**, not at the top
         *
         * This used to be the first statement in the `try`, on the reasoning
         * that the top of a navigation is "the moment in the whole cycle where
         * the thread is *allowed* to block: nothing is animating and the
         * outgoing screen is still fully painted". That sentence was written
         * before §2.0's hold existed and it stopped being true the day it did.
         * Something *is* animating from the frame the hash changes — the hold
         * is declared four statements above this one — so a queued `dispose()`
         * at the top of the handler is a block sitting between the animation
         * being declared and its first composited frame, which is the precise
         * shape of the defect this whole file is about. On `lobby → play` the
         * pre-paint task measured 56ms and the first pixel did not move for
         * 119ms.
         *
         * Two frames later the hold is on the compositor and will keep playing
         * whatever happens underneath it, which is the same guarantee the
         * curtain has always had — so this is now genuinely the moment the
         * thread may block, and it still lands before the factory, which is the
         * only ordering guarantee `queueDisposal` ever needed.
         */
        this.flushDisposals();
        /**
         * And *then* put the match on it.
         *
         * The order is the whole of it. `dressMatchCurtain` downsamples two 4K
         * leader paintings, which is tens of milliseconds of raster; doing that
         * before `twoFrames()` would spend it inside the one window this
         * ordering exists to keep clear and the curtain would cut instead of
         * closing. Afterwards, the close is already a `translate3d` playing on
         * the compositor, the portraits fade up over the first 420ms of a hold
         * that has seconds in it, and the raster lands where there is nothing
         * for it to interrupt. See the header of `intro/matchCurtain.ts`.
         *
         * A route with no billing — every menu veil, and any battle route the
         * provider cannot answer without a side effect — returns false and gets
         * the lit, roomed, grained cover it already had.
         */
        if (this.curtain && plan.relation === "curtain") {
          /**
           * ...and then wait for it to be *composited*, which is the whole of it.
           *
           * The ordering above was already right and the result was still a dead
           * screen, because appending an element does not put it on the
           * compositor — a style, layout and paint pass does, and the very next
           * statement here disappears into a battle constructor for the better
           * part of a second. Filmed with a CDP screencast at 1280×720 on a warm
           * module cache: curtain closed by t=248ms, then **1041ms** in which the
           * mean frame-to-frame delta was 0.00–0.05/255 and the largest single
           * pixel change anywhere on screen was 3/255, and the billing — which
           * had been in the DOM since t≈40ms — did not produce its first pixel
           * until t=1316ms, the frame the factory let go of the thread. Its 620ms
           * staged entrance and its 8s breathe then had 630ms of the hold left to
           * run in. The card was assembled, correct and invisible.
           *
           * Two more frames costs ~32ms of a wait that is measured in seconds and
           * buys every one of those seconds a lit, moving, named screen: the
           * portraits and plates are on the compositor before the block starts,
           * so their entrance and their idle keep playing straight through it,
           * exactly as the curtain's own `translate3d` already did.
           */
          performance.mark("dress:start");
          const drew = dressMatchCurtain(this.curtain, id, params);
          performance.mark(`dress:end:${String(drew)}`);
          if (drew) await twoFrames();
          performance.mark("dress:composited");
        }
      } else {
        // The first screen of the session has nothing to leave and therefore no
        // hold to protect, but the invariant is the same: a queued teardown is
        // always paid before the next factory runs.
        this.flushDisposals();
      }

      /**
       * Build. What is on screen while this blocks is the hold — a receded, lit
       * parent playing on the compositor — and the elapsed time is kept,
       * because the best available answer to "will this screen be slow next
       * time" is how slow it was this time.
       */
      const startedBuild = now();
      const screen = await factory(params);
      const buildMs = now() - startedBuild;
      this.buildCost.set(id, buildMs);

      /**
       * ## The cover can be raised *after* the build, and on a first visit it
       * has to be
       *
       * Traced on a real click through to Missions with a rAF probe and a
       * long-task observer, first visit of the session:
       *
       *     t=149  the hold starts
       *     t=296  the missions element enters the document
       *     t=737  the first frame anybody saw of either animation
       *
       * The constructor is the 147ms in the middle. The **441ms** after it is
       * the browser laying out and painting a screen with sixty animated
       * children in it, and no amount of reordering inside this file makes that
       * frame cheaper. It is also the window that fails `never-a-blank-frame`'s
       * "never looks away from an uncovered navigation": over 200ms with
       * nothing sampled and nothing covering it.
       *
       * `isHeavy` cannot help, because it is asked before the build and a first
       * visit is exactly the navigation no measurement exists for. But the
       * stopwatch that has just stopped *is* a measurement, and it predicts the
       * paint that follows rather well — a constructor that built enough DOM to
       * cost 147ms has built enough DOM to be expensive to draw. So a build
       * that comes in over the threshold raises the cover here, before the
       * element is placed, and the paint happens behind it.
       *
       * The cover is a cross-fade rather than a closing curtain, and the
       * difference is deliberate: the panels never travelled, so nothing should
       * pretend they did. What the player sees is a click, a parent receding,
       * and then — only when the machine genuinely needed a moment — a lit
       * surface coming up over it. On the second visit `isHeavy` knows, and the
       * full curtain closes from the first frame instead.
       */
      /**
       * ## There was a node-count prior here as well, and it has been withdrawn
       *
       * It read "over 300 elements, cover it", on the strength of a measurement
       * that Missions cost 392ms to lay out and paint behind a cheap
       * constructor. That was true when it was taken and is not true now:
       * Missions builds 356 elements, produces one 57ms task and then draws 113
       * frames in the following 1.6 seconds — a screen that is doing fine and
       * was being blacked out for the crime of having a lot of small children in
       * it. A prior that fires on four of the five most-travelled routes has
       * stopped predicting anything and started being the default.
       *
       * What is left is the honest predictor and the honest correction: the
       * table's `heavy` flag for the first visit, and the line below, which
       * folds the *painted* cost of this navigation back into `buildCost` one
       * frame later so the second visit is judged on what actually happened
       * rather than on how many `<span>`s were involved.
       */
      void nextFrame().then(() => {
        const settled = now() - startedBuild;
        if (settled > (this.buildCost.get(id) ?? 0)) this.buildCost.set(id, settled);
      });

      if (!veiled && outgoing !== null && buildMs >= HEAVY_BUILD_MS) {
        this.raiseCurtain(plan, id, true);
        veiled = true;
        await twoFrames();
      } else if (outgoing) {
        await nextFrame();
      }

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
    /**
     * Named and furnished while it is still detached, which is the whole of why
     * both are cheap. See `markCascade` and `dressScreen`.
     */
    markCascade(root);
    dressScreen(root, id);
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
   * ## The flag is a prior again, and this time there is enough measurement to
   * clear it
   *
   * The history is worth keeping because both previous positions were right
   * about something. Demotion was allowed, and it broke `collection → lobby`:
   * the Collection's constructor was virtualised, came in under the bar, cleared
   * its own flag — and *leaving* it still tore 245 canvases down in a 216ms
   * block with nothing over it. So demotion was withdrawn and the flag became a
   * floor. That fixed the hole and left a worse one: a permanent, unconditional
   * cover on the three most-travelled routes in the menu tree, which is the
   * defect this pass exists to remove and which no amount of making the screens
   * faster could ever have shifted.
   *
   * The real fault was never the direction of the correction, it was that the
   * stopwatch was measuring one third of a route. `buildCost` now carries the
   * factory **and** the first painted frame (see the `nextFrame` fold in
   * `handleHash`), and `teardownCost` carries the `dispose()` — so the two of
   * them together are the whole of what a route costs the thread on the way in
   * and on the way out. A flag may be cleared only when *both* have a sample and
   * both are under the bar; a route that has been entered but never left is
   * still an unknown, and an unknown that the table called expensive stays
   * covered.
   *
   * Measured at 1280×720 on this machine, warm, with `_w7leg_phase.mjs`:
   *
   *     collection    element in the document at t=109ms   dispose 41ms
   *     deckbuilder   element in the document at t= 68ms   dispose 12ms
   *
   * against a `HEAVY_BUILD_MS` of 220. Both were being veiled on every visit by
   * a flag, and the veil was costing them 400ms each — the veil was the wait.
   *
   * Promotion is unchanged and needs no ceremony: a route nobody classified that
   * turns out to cost 900ms starts being veiled on its second visit, because
   * that direction cannot make a cover disappear.
   *
   * This deliberately answers for a route rather than for a direction, and is
   * asked about both endpoints. Leaving a heavy screen and entering one cost
   * the same thing — the browser has to lay out and paint a frame containing
   * it either way — and the version of this that only asked about the
   * destination left Back out of the collection completely uncovered.
   */
  private isHeavy(id: string): boolean {
    const build = this.buildCost.get(id);
    const teardown = this.teardownCost.get(id);
    if (build !== undefined && build >= HEAVY_BUILD_MS) return true;
    if (teardown !== undefined && teardown >= HEAVY_BUILD_MS) return true;
    if (routeNode(id).heavy !== true) return false;
    // The flag stands until the route has been both entered and left at least
    // once. Half a measurement is not a measurement.
    return build === undefined || teardown === undefined;
  }

  /**
   * Start the departing screen receding, on the frame the hash changed.
   *
   * Split from `retire` because the two now happen at opposite ends of the
   * wait: this is the acknowledgement, and `retire` is the departure. It writes
   * the hold's duration into `--nav-dur` and lets §2.0's keyframes fill there;
   * `retire` overwrites both the duration and the attribute, which restarts the
   * animation under a new name whose `from` is exactly this one's `to`, so the
   * pair reads as one continuous exit with a pause in the middle of it.
   *
   * `arrive` has nothing to leave and the reduced-motion path gets its own
   * two-frame dip — see §2.9. Nothing else is special-cased: a curtain covers
   * the hold a beat later, and covering something that has already started
   * moving is cheaper than covering something frozen.
   */
  private beginExit(root: HTMLElement, plan: NavPlan): void {
    if (plan.relation === "arrive") return;
    root.style.setProperty("--nav-dur", `${plan.holdMs}ms`);
    root.style.removeProperty("--nav-delay");
    if (plan.relation === "sibling") root.style.setProperty("--nav-dir", String(plan.direction));
    root.dataset["nav"] = `${plan.relation}-hold`;
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
  private queueDisposal(id: string, run: () => void): void {
    this.pendingDisposals.push({ id, run });
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

  /**
   * Pay the queue, and time each entry.
   *
   * The stopwatch is the whole reason this loop is not two lines. `isHeavy` used
   * to be forbidden from demoting a flagged route because the only measurement
   * it had was the factory's, and a factory is half of what a route costs — the
   * Collection's teardown of 245 canvases was the other half and was invisible
   * to it. It is not invisible here: `dispose()` runs on this line, and the
   * clock either side of it is the missing number.
   */
  private flushDisposals(): void {
    window.clearTimeout(this.disposalTimer);
    this.disposalTimer = 0;
    while (this.pendingDisposals.length > 0) {
      const entry = this.pendingDisposals.shift();
      if (!entry) continue;
      const started = now();
      try {
        entry.run();
      } catch (error) {
        // One badly-behaved screen must not be able to wedge the router on its
        // way out, and a teardown that throws has already stopped being drawn.
        console.error("Screen dispose threw on the way out:", error);
      } finally {
        this.teardownCost.set(entry.id, now() - started);
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
      // The room's watcher goes with the element. A `MutationObserver` holds
      // its target weakly, so this is tidiness rather than a leak fix — but a
      // detached screen that a stale reference re-renders would otherwise keep
      // rebuilding a room nobody can see.
      undressScreen(root);
      this.queueDisposal(entry.id, () => entry.screen.dispose?.());
    };

    const maybeComplete = (): void => {
      if (animationEnded && released) complete();
    };

    /**
     * The hold's own ending is not the exit's ending, and conflating them
     * deleted the outgoing screen.
     *
     * Declaring `<relation>-out` replaces `<relation>-hold` on the same
     * element, which **cancels** the hold — and `animationcancel` was being
     * read here as "the exit is over". Measured the first time this ran:
     * `missions → lobby` produced a frame containing one screen, the arriving
     * lobby, at `opacity: 0.000`, because the departing child had been removed
     * before its exit had been given a single frame; the `-out` animation never
     * started at all and the trace recorded no exchange. Filtering on the name
     * is enough — every hold in §2.0 ends in `-hold` and no exit does.
     */
    const onEnd = (event: AnimationEvent): void => {
      if (event.target !== root || event.animationName.endsWith("-hold")) return;
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
   *
   * ## And the menu veil now says where you are going
   *
   * The last thing wrong with it was not its colour, it was that it had nothing
   * on it. Two gradients, a grain tile and a bright horizontal rule is a
   * *surface*; a place you are being taken to is a **room**, and the difference
   * is whether anything in the frame tells you what you are waiting for. Filmed
   * losslessly on `lobby → collection`, the whole 562ms hold ran with a mean
   * frame-to-frame delta of 0.0–1.5/255 and three windows over 60ms in which
   * literally nothing changed — against Hearthstone's idle floor of 0.6–1.3 with
   * nothing happening at all.
   *
   * So the cover carries a plate: the room's name over the destination's, in the
   * room's own key, with an entrance and a specular that crosses the type. Text
   * is the highest-contrast thing this element can hold, which makes it both the
   * thing that answers "where am I going" and — because a sub-pixel drift of a
   * hard edge moves whole bytes rather than fractions of one — the only layer
   * here whose motion survives being written to eight bits. §3a: loading is part
   * of the world, and §4: text over imagery always gets a plate.
   *
   * `aria-hidden` on the element and no `role`: the plate is decoration for the
   * eye during a wait that the router is already announcing by changing the
   * document. A screen reader must not be told "Collection" twice, once by a
   * cover and once by the screen.
   */
  private raiseCurtain(plan: NavPlan, id: string, late = false): void {
    this.dropCurtain();
    const node = routeNode(id);
    const curtain = document.createElement("div");
    curtain.className = "nav-curtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.dataset["phase"] = "close";
    const menu = plan.relation !== "curtain";
    curtain.dataset["veil"] = menu ? "menu" : "battle";
    /**
     * A cover the build asked for, rather than one the route table predicted.
     *
     * `late` means the panels are already shut and the whole element fades up
     * where it stands — see §2.8 of `transitions.css`. Sliding two halves
     * together at this point would be a lie about when the button was pressed;
     * the honest gesture for "this is taking a moment" is a light coming on,
     * and the part at the other end is identical either way.
     */
    if (late) curtain.dataset["arm"] = "late";
    curtain.style.setProperty("--nav-dur", `${CURTAIN.close}ms`);
    curtain.style.setProperty("--room-key", ROOMS[node.room].key);
    curtain.style.setProperty("--room-rim", ROOMS[node.room].rim);
    curtain.innerHTML =
      '<div class="nav-curtain-panel is-top"></div>' +
      '<div class="nav-curtain-panel is-bottom"></div>' +
      '<div class="nav-curtain-seam"></div>' +
      /**
       * The battle veil is deliberately excluded. `matchCurtain.ts` puts two lit
       * leader portraits and a VS on those panels, and a second plate naming the
       * route would be competing with the best thing in the file.
       */
      (menu
        ? '<div class="nav-curtain-plate">' +
          `<span class="nav-curtain-room t-label">${escapeText(ROOMS[node.room].name)}</span>` +
          `<span class="nav-curtain-title t-display">${escapeText(node.title ?? routeTitle(id))}</span>` +
          '<span class="nav-curtain-underline"></span>' +
          "</div>"
        : "");
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
      /**
       * Pay the teardown here, while the panels are still shut.
       *
       * `queueDisposal` holds a screen's `dispose()` until the arriving screen
       * has settled, and on an ordinary navigation that is the right quiet
       * moment. Behind a curtain it is not: measured on `collection → lobby`,
       * the veil parted, the lobby settled, and *then* 245 canvases were torn
       * down in a 216ms block with nothing covering it — a freeze the player
       * gets after the transition has apparently finished, which reads as the
       * game hanging rather than as loading.
       *
       * The cover exists for exactly this, it is a `translate3d` playing on the
       * compositor, and the reveal is a handful of frames away. Spending the
       * teardown behind it costs the reveal its own length and buys back a
       * quarter of a second of unresponsive settled screen.
       */
      if (curtain?.isConnected === true) this.flushDisposals();
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
    /**
     * No `.ambient-bg`. It painted an opaque plate in front of the world and
     * §2.6 of `transitions.css` has taken its paint away, so all it was doing
     * here was occupying the slot `dressScreen` puts the room in.
     */
    node.innerHTML = `
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
