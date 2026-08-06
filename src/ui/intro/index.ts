/**
 * The opening cinematics: which one plays, when it does not play at all, and
 * the guarantee that the game is never waiting on either of them.
 *
 * Two sequences share one set (`stage.ts`) and one clock (`timeline.ts`). This
 * file is the part with judgement in it — the decisions about *whether* a title
 * card is the right thing to put in front of somebody right now, which is a
 * harder question than it looks and the one that separates an opening a player
 * remembers fondly from one they learn to click through.
 *
 * ## The cinematic is an overlay, and that is the whole safety story
 *
 * `startIntro()` returns synchronously, before anything has loaded. The layer it
 * mounts is a sibling of `#app`, so the content index still parses, the router
 * still resolves the hash, the screen still builds and the atmosphere still
 * lights — all underneath, on the ordinary boot path, with nothing awaiting a
 * frame of video. Skipping does not "cancel" anything and cannot strand
 * anybody, because there was never a state in which the game was inside the
 * cinematic; it was always behind it.
 *
 * That also means the failure modes are all the same failure mode. No WebGL, no
 * brand artwork, a canvas that throws — every one of them removes the overlay
 * and leaves a booting game exactly as it would have been.
 *
 * ## Four reasons not to play at all
 *
 * 1. **The landing route is not the front door.** A reload into `#collection` or
 *    a deep link into `#deckbuilder?deck=3` is somebody resuming, and a logo
 *    sting over it would be a title card in front of the middle of a session.
 *    Only an empty hash, `#lobby` and `#starter` get one.
 * 2. **`?nointro`.** An explicit switch, for the screenshot harness and for
 *    anyone driving the app from a script. In the query string rather than the
 *    hash, because this app routes on the hash and the query is the one part of
 *    the URL it never reads.
 * 3. **The player navigated.** Any `hashchange` ends the sequence immediately.
 *    A player who reaches for a menu mid-title has told you what they want, and
 *    so has a script that navigated a route.
 * 4. **The tab went away.** Ended rather than paused. The shared frame loop
 *    already stops when the page is hidden, so the alternative is a player
 *    alt-tabbing during boot and coming back ten minutes later to the second
 *    half of a title sequence.
 *
 * ## Sound
 *
 * There is none, and there cannot be: browser autoplay policy means no audio
 * context exists until the player has interacted, and this plays before they
 * have. So the sequence is *designed* silent — the impact is carried by a
 * shockwave, a camera flinch and nine things moving at once rather than by a
 * hit that would not sound. The one honest opportunity is the skip gesture
 * itself, which is a real user gesture: the skip listener deliberately does not
 * call `stopPropagation`, so `audio.ts`'s own unlock-on-first-input handler runs
 * from the same event and the lobby theme it has been holding since boot starts
 * as the picture clears. Sound joins when it legitimately can and never before.
 */

import "./intro.css";

import { brandPath } from "../art/iconAssets";
import { awaitAsset, preloadAssets } from "../art/assetLoader";
import { scaledAsset } from "../art/texture";

import { motionEnabled, onMotionFrame } from "../motion";
import { animationScale } from "../../save/settings";
import { needsStarterChoice } from "../../save/profile";
import { createIntroStage, restingLook, type IntroLook, type IntroStage, type IntroTier } from "./stage";
import type { Sequence } from "./timeline";
import {
  FIRST_RUN_GATES,
  FIRST_RUN_HANDOVER,
  FIRST_RUN_HANDOVER_MS,
  FIRST_RUN_REST,
  firstRunSequence,
} from "./firstRun";
import { RETURNING_REST, returningSequence } from "./returning";
import { forgetTitle, markTitlePlayed, titleAlreadyPlayed } from "./introStore";

export type IntroKind = "first-run" | "returning";

/** Routes that count as the front door. Anything else is somebody resuming. */
const FRONT_DOOR = new Set(["", "lobby", "starter"]);

/**
 * How long the first-run title will hold its clock at a gate.
 *
 * Generous, because it costs nothing to wait: the room is already playing and
 * still moving while the clock is stopped, so the player is watching a lit set
 * rather than a loading state. Past it the sequence gives up and hands over —
 * a title with no logo in it is not worth finishing.
 */
const TITLE_GATE_PATIENCE = 5000;

/**
 * How long the returning sting will wait before starting.
 *
 * This player has loaded the game before, so both PNGs are in the HTTP cache —
 * but "in the cache" is not "on the GPU", and a 2048×2048 PNG still has to be
 * decoded. Measured, the first attempt at 300ms lost that race often enough that
 * the sting simply did not appear: two frames out of nine in a capture run were
 * an untouched lobby, with no error anywhere, because a `Promise.race` had
 * quietly returned null.
 *
 * 550ms is a decode budget rather than a download one. Past it the sting is
 * abandoned, which is still the right answer — a logo arriving most of a second
 * into a lobby the player is already reading is worse than no logo.
 */
const STING_ASSET_DEADLINE = 550;

const MARK_ASSET = "hb-mark-master";
const WORDMARK_ASSET = "hb-wordmark";

/**
 * There is one wordmark, and only one of the two things drawing it may be lit.
 *
 * The sting's whole argument is §3a's shared-element rule: the brand does not
 * blink out of existence in the middle of the screen and reappear in the header,
 * it *travels* there. That was written, and then only half implemented — the
 * lockup flew correctly and the header's own copy stayed lit underneath it the
 * entire time. Photographed at 1600×900, t=420ms: HYPEBOUND across the middle of
 * the lobby at 460px wide, and HYPEBOUND in the header rail at 84px, both at full
 * strength. At t=700, mid-flight, the two were 23px apart and 32% different in
 * size — a straight double exposure of the brand against itself for about a fifth
 * of a second, on every launch, forever. On a phone in landscape it is worse,
 * because the two are closer together.
 *
 * So the header lends its wordmark to the cinematic and takes it back. The
 * attribute goes on the root element rather than on the header, because the
 * header belongs to another module and this one is only allowed to know its
 * class name — which it already had to, to fly anything at it.
 *
 * The handover point is late on purpose. By 88% of the flight the two bitmaps
 * are within about two pixels and the same size, so the header coming back is a
 * crossfade between a thing and itself; any earlier and it is a visible swap.
 */
const BRAND_HANDOVER = 0.88;

/** Above this the cinematic's own wordmark is legible and must be the only one. */
const BRAND_CLAIM = 0.15;

/** What the root element currently says, so a frame loop is not a DOM write. */
let brandClaim: string | null = null;

function claimBrand(state: "flight" | null): void {
  if (brandClaim === state) return;
  brandClaim = state;
  if (state === null) delete document.documentElement.dataset["introBrand"];
  else document.documentElement.dataset["introBrand"] = state;
}

/** Read the sting's own composition and decide who owns the wordmark this frame. */
function syncBrand(look: IntroLook): void {
  claimBrand(look.wordOpacity > BRAND_CLAIM && look.dock < BRAND_HANDOVER ? "flight" : null);
}

/**
 * Start both fetches at import, which is as early as this module can act.
 *
 * `boot()` calls `startIntro()` a few statements later, so the practical gain is
 * small — but it is free, it costs nothing when the cinematic turns out not to
 * play, and it means the request is in flight before the content index is
 * parsed rather than after it.
 */
preloadAssets([brandPath(MARK_ASSET), brandPath(WORDMARK_ASSET)]);

function currentRoute(): string {
  return (globalThis.location?.hash ?? "").replace(/^#/, "").split("?")[0] ?? "";
}

/**
 * `?nointro`, in either query string.
 *
 * The switch lives in the *query* rather than the hash because this app routes
 * on the hash and the query is the one part of the URL it never reads — but the
 * screenshot harness navigates by appending `#<route>` to a bare origin, so the
 * only place a caller can put a parameter is after the hash. Honouring both is
 * two lines and it is the difference between a camera that can photograph this
 * sequence and one that photographs a live playback composited over a seeked
 * frame. That is not hypothetical: it happened, twice, and both times the
 * screenshot was subtly wrong in a way that looked like a rendering bug.
 */
function suppressed(): boolean {
  const hash = globalThis.location?.hash ?? "";
  const hashQuery = hash.slice(hash.indexOf("?") + 1);
  return (
    new URLSearchParams(globalThis.location?.search ?? "").has("nointro") ||
    (hash.includes("?") && new URLSearchParams(hashQuery).has("nointro"))
  );
}

function detectTier(): IntroTier {
  const declared = document.documentElement.dataset["gfxTier"];
  if (declared === "high" || declared === "medium" || declared === "low") return declared;
  // `atmosphere.ts` writes that attribute at mount and this runs after it, so
  // the fallback is only reached in a test. Matching its default keeps the two
  // from disagreeing about what a device can afford.
  return "medium";
}

/** Which cinematic, if any, this launch should get. */
export function chooseIntro(): IntroKind | null {
  if (typeof document === "undefined" || typeof globalThis.location === "undefined") return null;
  if (suppressed()) return null;
  if (!FRONT_DOOR.has(currentRoute())) return null;
  return needsStarterChoice() && !titleAlreadyPlayed() ? "first-run" : "returning";
}

// ---------------------------------------------------------------------------
// building a reel
// ---------------------------------------------------------------------------

const race = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

interface Reel {
  host: HTMLElement;
  stage: IntroStage;
  look: IntroLook;
  film: Sequence;
  /** The moment the composition is fully settled — the reduced-motion still. */
  rest: number;
  first: boolean;
  still: boolean;
  /** Resolves true when each half of the lockup has reached the set. */
  artwork: { mark: Promise<boolean>; wordmark: Promise<boolean> };
}

/**
 * The wordmark master's aspect ratio, overwritten from the real bitmap.
 *
 * The manifest says 3072×1024 and the fallback agrees with it, so a wrong guess
 * is impossible in practice — but the artwork is on disk and the number it
 * actually has is the one the header's `contain` fit will use, so this is read
 * rather than assumed.
 */
let brandAspect = 3;

/**
 * The lobby's own wordmark, if this viewport is drawing one.
 *
 * The sting's exit flies its lockup onto this element and lets go — see
 * `StageOptions.dockTarget`. Read-only and defensive by design: the header is
 * another module's furniture, the class name is the only thing this depends on,
 * and every way it can be absent resolves to `null` rather than to a wrong
 * answer. The screen hides it outright below 900px and again in the phone
 * breakpoint, and it only paints at all once `installIconStyles` has proved the
 * PNG exists — so "there is no wordmark up there" is a *normal* outcome on a
 * good few devices, not a failure.
 *
 * The rect test catches all of those at once: `display: none` reports zero, and
 * so does an element the layout has not settled yet.
 */
function headerWordmark(): { x: number; y: number; width: number } | null {
  const element = document.querySelector<HTMLElement>(".lobby-wordmark");
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 6) return null;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || Number(style.opacity) < 0.4) return null;
  /**
   * The *drawn* width, not the element's.
   *
   * The header paints the wordmark as a `background-size: contain` image inside
   * a box whose width is a `clamp` against the viewport, so at 1600px the box is
   * 232px wide and the artwork inside it is 92 — the fit is limited by the
   * box's height, and the remaining 140px is empty. Flying the lockup to the
   * element's width parks a copy of the wordmark two and a half times the size
   * of the one underneath it, which is exactly what the last frame photographed
   * as: a doubled edge on every letter.
   *
   * `contain` is `min` of the two ratios, and this is that same `min`.
   */
  const drawnHeight = Math.min(rect.height, rect.width / brandAspect);
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: drawnHeight * brandAspect,
  };
}

/**
 * Ask for the two brand assets and hand each one to the set as it lands.
 *
 * Resampled to 1024 on a canvas rather than uploaded at 2048² and 3072×1024,
 * and the numbers behind that are worth recording because the intuition goes
 * the wrong way. Handing the masters straight to the GPU *feels* cheaper — no
 * CPU filtering, `glGenerateMipmap` does the downscale — and measured on this
 * page it made a rebuild twice as slow (187–212ms against 77–151ms), because
 * 28 MB of texture upload plus mip generation costs more than one memoised
 * canvas resample. `scaledAsset` also caches, so the CPU cost is paid once per
 * session and a second cinematic is free.
 *
 * 1024 is chosen against the size each is drawn at. The wordmark spans 43% of
 * the frame — 688 device pixels on a 1600-wide screen — and never grows. The
 * mark keeps the same budget for the opposite reason: the handoff flies the
 * camera through it, and at the end of that dive it is nearly three times the
 * height of the frame.
 *
 * Returns a promise per asset so the caller can decide what to do about a slow
 * one: the title stalls its clock, the sting declines to play.
 */
function loadArtwork(
  stage: IntroStage,
  tier: IntroTier,
  deadline: number
): { mark: Promise<boolean>; wordmark: Promise<boolean> } {
  const px = tier === "low" ? 512 : 1024;
  const take = (id: string, attach: (source: HTMLCanvasElement | HTMLImageElement) => void) =>
    race(awaitAsset(brandPath(id)), deadline).then((image) => {
      if (!image) return false;
      attach(scaledAsset(brandPath(id), px) ?? image);
      return true;
    });

  return {
    mark: take(MARK_ASSET, (source) => stage.setMark(source)),
    wordmark: take(WORDMARK_ASSET, (source) => stage.setWordmark(source)),
  };
}

/**
 * Mount the layer and put the set up. The artwork follows separately.
 *
 * Split out from playback because it is also what the review seam needs: a
 * stage that can be seeked to an exact millisecond and photographed there. Four
 * earlier rounds of motion work in this repo were wasted judging animation from
 * stills taken at whatever moment the camera happened to fire, and a sequence
 * you cannot photograph at 2,080ms on demand is a sequence nobody will iterate
 * on properly.
 *
 * `cancelled` is checked after every await. The player can skip while this is
 * happening, and a reel that finishes building after that should quietly throw
 * itself away rather than appearing a second later.
 */
async function buildReel(kind: IntroKind, cancelled: () => boolean): Promise<Reel | null> {
  const first = kind === "first-run";
  const tier = detectTier();
  const still = !motionEnabled();

  /**
   * The layer, and the plate behind it on the once-ever path only.
   *
   * The starter picker is being built on the other side of this element right
   * now. Without the plate the player sees it for a couple of hundred
   * milliseconds and then watches a title sequence cover it up, which reads as
   * two screens fighting — it is the "never a blank frame" rule in its other
   * form: never a frame that contradicts the next one. The sting has no plate,
   * because there the lobby underneath *is* the picture.
   */
  const host = document.createElement("div");
  host.className = "hb-intro";
  host.setAttribute("aria-hidden", "true");
  if (first) host.dataset["plate"] = "true";

  /**
   * The sting is the one that waits, and it waits before it mounts.
   *
   * A transparent layer over a live lobby takes pointer events, so mounting one
   * and *then* discovering the artwork is slow would eat a click on PLAY for a
   * third of a second. The title has the opposite shape — it owns the screen
   * anyway, so it mounts first and stalls its clock later.
   */
  if (!first) {
    const [markReady, wordReady] = await Promise.all([
      race(awaitAsset(brandPath(MARK_ASSET)), STING_ASSET_DEADLINE),
      race(awaitAsset(brandPath(WORDMARK_ASSET)), STING_ASSET_DEADLINE),
    ]);
    if (cancelled() || !markReady || !wordReady) return null;
    if (wordReady.width > 0 && wordReady.height > 0) brandAspect = wordReady.width / wordReady.height;
  }

  document.body.appendChild(host);
  if (cancelled()) {
    host.remove();
    return null;
  }

  let stage: IntroStage | null = null;
  try {
    stage = createIntroStage(host, {
      tier,
      /*
       * The lobby's own room. The title hands over to the starter picker and the
       * sting to the lobby, and both of those are lit by `hub` — so the
       * cinematic is that room with the house lights down rather than a separate
       * place the player is then moved out of.
       */
      room: "hub",
      ...(first
        ? {}
        : {
            lockupScale: 0.62,
            lockupAnchor: "centre" as const,
            dockTarget: headerWordmark,
          }),
    });
  } catch (error) {
    console.warn("[intro] stage failed to build", error);
  }
  if (!stage || cancelled()) {
    stage?.dispose();
    host.remove();
    return null;
  }

  const artwork = loadArtwork(stage, tier, first ? TITLE_GATE_PATIENCE : STING_ASSET_DEADLINE);
  const look = restingLook();
  return {
    host,
    stage,
    look,
    film: first ? firstRunSequence(look) : returningSequence(look),
    rest: first ? FIRST_RUN_REST : RETURNING_REST,
    first,
    still,
    artwork,
  };
}

/**
 * Compose the reduced-motion still.
 *
 * Not a separate static layout — `seek(rest)` composes the sequence at the
 * moment it is fully settled, so the title card a player with the setting on
 * sees is *the* title card, correct in every position and value, with nothing
 * having moved to get there and no frame loop ever started.
 *
 * Two adjustments, and both are about the card having to read on its own. The
 * sting's settled frame is deliberately almost transparent, because animated it
 * is over a lobby that is arriving; frozen, that is a logo floating on a menu,
 * so it gets enough wash to be a card. And the grain comes off, because a static
 * grain is not grain — it is a dirty screen.
 */
async function composeStill(reel: Reel): Promise<void> {
  const draw = (): void => {
    reel.film.seek(reel.rest);
    if (!reel.first) reel.look.wash = Math.max(reel.look.wash, 0.36);
    reel.look.grain = 0;
    reel.stage.apply(reel.look, reel.rest);
    // The still is the settled frame of the same sequence, so it holds the same
    // wordmark in the same place — and would double against the header exactly
    // as the animated version did.
    if (!reel.first) syncBrand(reel.look);
  };

  /**
   * Draw the room *first*, before waiting for anything.
   *
   * This path used to open with the await below, and photographed cold it was a
   * black rectangle: the first-run layer carries an opaque plate, no frame loop
   * ever starts on the still path, and nothing had been drawn — so a
   * reduced-motion player's first second of HYPEBOUND was an unlit screen for
   * however long two megabytes of PNG took to decode. The requirement is a
   * *near-instant* title card, and "instant once the artwork lands" is not that.
   *
   * The set needs no artwork to be a room. This composes it at its settled
   * moment with the lockup's opacities gated off — which is one draw, costs
   * nothing, and means the worst case is a lit street with the sign not yet on
   * rather than a black hole with a plate over it.
   */
  draw();
  // Then again with the lockup in it. A still with half a lockup is not a title
  // card, and this is the one path where waiting is genuinely invisible: nothing
  // is animating, so there is nothing for a delay to interrupt.
  await Promise.all([reel.artwork.mark, reel.artwork.wordmark]);
  draw();
}

// ---------------------------------------------------------------------------
// playback
// ---------------------------------------------------------------------------

/**
 * Play a cinematic. Returns a function that ends it early; safe to ignore.
 *
 * Nothing awaits this. It is `void`-called from `boot()` and everything it does
 * afterwards happens beside the game rather than in front of it.
 */
export function playIntro(kind: IntroKind): () => void {
  if (kind === "first-run") markTitlePlayed();

  let finished = false;
  let close: () => void = () => {
    finished = true;
  };

  void (async () => {
    const reel = await buildReel(kind, () => finished);
    if (!reel) return;
    const { host, stage, look, film, first, still } = reel;

    if (first && !still) {
      const hint = document.createElement("div");
      hint.className = "hb-intro-skip";
      const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
      hint.textContent = coarse ? "Tap to skip" : "Any key to skip";
      host.appendChild(hint);
    }

    /**
     * Whether the game behind the cinematic has been uncovered yet.
     *
     * See `FIRST_RUN_HANDOVER`. The plate is the thing that made the exit a
     * hole, and there are three ways out of this sequence — it runs to the end,
     * the player skips, or something goes wrong and `close()` is called
     * directly — so the reveal is a function all three go through rather than a
     * line in the frame loop that the other two would have missed.
     */
    let uncovered = false;
    const uncover = (): void => {
      if (uncovered) return;
      uncovered = true;
      delete host.dataset["plate"];
    };

    let stopFrames: (() => void) | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;
    /** Wall time at which the player asked to leave, or null. */
    let bailAt: number | null = null;
    /** The sequence clock. Stops at a gate; see the frame callback. */
    let clock = 0;
    /** Real elapsed time. Never stops, and drives the set's idle life. */
    let wall = 0;
    let stalledFor = 0;

    const teardown = (): void => {
      stopFrames?.();
      stopFrames = null;
      if (holdTimer !== null) clearTimeout(holdTimer);
      if (removeTimer !== null) clearTimeout(removeTimer);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("touchstart", skip);
      window.removeEventListener("wheel", skip);
      window.removeEventListener("hashchange", cut);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onHidden);
      /**
       * The element goes now; the GPU teardown waits for a quiet moment.
       *
       * `stage.dispose()` frees fifteen textures, drops a WebGL context and
       * calls `forceContextLoss`, and that is tens of milliseconds of driver
       * work — landing, by construction, a fraction of a second after the boot
       * finishes, which is exactly when the player is making their first
       * navigation and the shell is animating two screens against each other.
       * A frame dropped there is a frame dropped in the one place §3a says the
       * budget is tightest.
       *
       * Removing the host is what actually matters and it is one DOM mutation,
       * so it happens immediately: from this line on the layer is gone and
       * nothing it owns can take a click. The context is given back on the next
       * idle slot, with a two-second deadline so it is never merely leaked.
       */
      host.remove();
      // Unconditional, and before anything that can throw: a borrowed wordmark
      // that is never given back is a permanently empty header rail.
      claimBrand(null);
      const free = (): void => stage.dispose();
      if (typeof requestIdleCallback === "function") requestIdleCallback(free, { timeout: 2000 });
      else setTimeout(free, 400);
    };

    /**
     * The end of the picture and the end of the element are separate.
     *
     * The layer fades on the compositor for one transition after the last frame
     * is drawn, which covers the case the sequence itself cannot: the returning
     * sting's final frame is already transparent, but the *element* still takes
     * pointer events, and a click landing in that window would be eaten rather
     * than reaching the PLAY button underneath. Marking finished before the
     * fade and removing after it means there is no frame where the cinematic is
     * invisible and still in the way.
     */
    close = (): void => {
      if (finished) return;
      finished = true;
      /**
       * Whatever brought us here, the plate goes first and on the same frame.
       *
       * A black hold plate under a layer that is *fading out* is the hole this
       * sequence was measured producing: the picture dissolves to the plate,
       * and only then does the plate dissolve to the game. One of those two
       * dissolves has to be against the real destination, and it may as well be
       * both.
       */
      uncover();
      host.classList.add("is-leaving");
      // Already dissolved on the way through the handover: the element is
      // transparent and the only thing left to do is stop taking clicks with it.
      removeTimer = setTimeout(teardown, still ? 140 : host.classList.contains("is-handover") ? 90 : 300);
    };

    /**
     * A player-initiated exit: fold the picture out fast rather than cutting.
     *
     * Timed off the wall clock rather than the sequence clock, because the
     * sequence clock is allowed to stop — skipping during a stall would
     * otherwise start a fade whose progress never advanced.
     */
    function skip(): void {
      if (finished || bailAt !== null) return;
      /**
       * The header takes its wordmark back on the gesture, not on the teardown.
       *
       * A skip dissolves the lockup over 150ms. Holding the loan for those
       * 150ms would fade the travelling copy out over a header that is still
       * blank and then snap the header's own copy on afterwards — a pop, at the
       * exact moment the player has asked for the cinematic to stop being in the
       * way. Handing it back first means the brand is simply already where it
       * lives while the rest of the picture folds out around it.
       */
      claimBrand(null);
      /**
       * A skip folds the picture out over 150ms, and it folds it out over the
       * game rather than over the plate. Without this the player who asks for
       * the title to stop being in the way is answered with a black rectangle
       * for a sixth of a second, which is the same defect as the ending and is
       * worse for being the one they explicitly requested.
       */
      uncover();
      if (still) {
        close();
        return;
      }
      bailAt = wall;
    }

    /**
     * A navigation away from the front door, or a hidden tab: no flourish.
     *
     * The destination is checked, and that check is the difference between this
     * working and not working at all. `boot()` finishes by navigating: a new
     * account is sent to `#starter` and everyone else is sent to `#lobby` by
     * `shell.start()`, because the router only mounts on a hash. Both of those
     * fire a `hashchange` within a task of the cinematic starting — so a handler
     * that closed on *any* navigation closed on the app's own first one, every
     * time, and a real cold boot showed the starter picker at 2.3 seconds with
     * no title having played. It only survived review because the debug handle
     * replays a cinematic on a page that has already navigated.
     *
     * Leaving one front-door route for another is the boot settling. Leaving for
     * anything else is a player who wants to be somewhere.
     */
    function cut(): void {
      if (!FRONT_DOOR.has(currentRoute())) close();
    }

    /** The tab went away. No route to inspect and no reason to be gentle. */
    function leave(): void {
      close();
    }

    function onResize(): void {
      stage.resize();
    }

    function onHidden(): void {
      if (document.visibilityState === "hidden") leave();
    }

    /*
     * `passive` on all four, and no `stopPropagation` anywhere.
     *
     * Passive because none of them ever calls `preventDefault`, and a
     * non-passive `wheel` listener on `window` makes the whole page's scrolling
     * jankier for the rest of the session. No `stopPropagation` because
     * `audio.ts` has its own unlock handler on `window` for exactly these
     * events, and swallowing the gesture here would mean the first thing the
     * player ever does in this game is the one gesture that fails to turn the
     * sound on.
     */
    window.addEventListener("pointerdown", skip, { passive: true });
    window.addEventListener("keydown", skip, { passive: true });
    window.addEventListener("touchstart", skip, { passive: true });
    window.addEventListener("wheel", skip, { passive: true });
    window.addEventListener("hashchange", cut);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onHidden);

    if (still) {
      void composeStill(reel).then(() => {
        if (finished) return;
        host.classList.add("is-live");
        holdTimer = setTimeout(close, first ? 760 : 240);
      });
      return;
    }

    /**
     * The player's animation-speed preference drives the transport, not the
     * durations.
     *
     * Scaling every beat's length would mean fifty numbers scaled fifty times a
     * frame and a sequence whose overlaps drift apart as they shorten. Running
     * the clock faster keeps every relationship in the timeline exact and makes
     * "Fast" mean the same thing here as it does on the board.
     */
    const rate = 1 / Math.max(0.05, animationScale());
    const BAIL_MS = 150;

    /**
     * Two clocks, and the difference between them is the whole reason a slow
     * asset costs nothing to look at.
     *
     * `clock` drives the *sequence* and can stop. `wall` drives the set's idle
     * life — the camera's slow lissajous, the shafts breathing, the city
     * twinkling, the grain jittering — and never stops. So while the title is
     * waiting for its logo the room carries on being a room, at full frame rate,
     * with no loading state anywhere: exactly what §7 means by "loading is part
     * of the world, not a spinner".
     *
     * Only the title gates. The sting is only ever built once its artwork is
     * already in hand, so `gate` is `null` there and the branch costs nothing.
     */
    const gates = first ? FIRST_RUN_GATES : null;

    stopFrames = onMotionFrame((dt) => {
      wall += dt;

      const waitingForMark = gates !== null && clock >= gates.mark && !stage.hasMark();
      const waitingForWord = gates !== null && clock >= gates.word && !stage.hasWordmark();
      const stalled = bailAt === null && (waitingForMark || waitingForWord);
      if (stalled) {
        stalledFor += dt;
        // Something is genuinely wrong with the asset. Hand over rather than
        // holding a room the player cannot leave by waiting.
        if (stalledFor > TITLE_GATE_PATIENCE) {
          close();
          return;
        }
      } else {
        clock += dt * rate;
      }

      film.seek(clock);
      /**
       * The handover, and it is a frame-loop decision rather than a timer
       * because the clock it belongs to is the *sequence* clock — which stalls
       * at a gate and runs at the player's animation-speed multiplier. A
       * `setTimeout` would uncover the game in the middle of a stalled title on
       * a slow first load.
       */
      if (first && !uncovered && clock >= FIRST_RUN_HANDOVER) {
        uncover();
        // One source of truth for the length of the dissolve: the sequence
        // module owns it, because it is the sequence's last beat in everything
        // but name.
        host.style.setProperty("--hb-handover-ms", `${FIRST_RUN_HANDOVER_MS}ms`);
        host.classList.add("is-handover");
      }
      if (!first && bailAt === null) syncBrand(look);
      if (bailAt !== null) {
        const out = Math.min(1, (wall - bailAt) / BAIL_MS);
        look.master *= 1 - out;
        if (out >= 1) {
          close();
          return;
        }
      }
      stage.apply(look, wall);
      // The layer becomes solid to the pointer only once it is drawing — see
      // the note in `intro.css`.
      if (!host.classList.contains("is-live")) host.classList.add("is-live");
      if (clock >= film.duration) close();
    });
  })();

  return () => close();
}

/**
 * Boot hook. Picks a cinematic and starts it, or does nothing.
 *
 * Deliberately returns `void` rather than a promise: there is no sequencing
 * relationship between this and the rest of `boot()`, and offering one would
 * invite somebody to await it.
 */
/** The playback `startIntro` began, so the review seam can end it. */
let running: (() => void) | null = null;

export function startIntro(): void {
  const kind = chooseIntro();
  if (kind) running = playIntro(kind);
}

// ---------------------------------------------------------------------------
// the review seam
// ---------------------------------------------------------------------------

/**
 * Put one exact frame of a cinematic on screen and leave it there.
 *
 * This exists because a still cannot show motion and a burst capture cannot
 * choose its own timing: at ~322ms a photograph, a twelve-frame burst of a
 * five-second sequence samples it at whatever twelve moments the disk happened
 * to allow. Every earlier round of motion review in this repo that worked that
 * way reached the wrong conclusion. Seeking instead means "show me the impact"
 * is `frame("first-run", 2080)` and the answer is the frame at 2,080ms, every
 * time, on any machine.
 *
 * The frame is composed and drawn once with no loop running, so `--freeze` and
 * a long `--wait` cannot disturb it either.
 */
export async function frameIntro(kind: IntroKind, ms: number): Promise<() => void> {
  // Whatever this launch started, stop it: two reels on one page composite, and
  // a still of the sum of them is a photograph of something nobody will see.
  running?.();
  running = null;
  let cancelled = false;
  const reel = await buildReel(kind, () => cancelled);
  if (!reel) return () => {};
  await Promise.all([reel.artwork.mark, reel.artwork.wordmark]);
  reel.film.seek(ms);
  reel.stage.apply(reel.look, ms);
  // The seam has to photograph what the player sees, and who owns the wordmark
  // is part of that: without this the review frames of the sting were the one
  // composition the sting never actually puts on screen.
  if (!reel.first) syncBrand(reel.look);
  return () => {
    cancelled = true;
    claimBrand(null);
    reel.stage.dispose();
    reel.host.remove();
  };
}

/**
 * A handle for looking at the thing.
 *
 * Matches `window.hypeboundStarter`, which the verification scripts already use
 * for the same reason: driving the app from a script beats reproducing its state
 * by hand. `forget()` puts the browser back to never-having-played, so the
 * genuine cold-boot path can be exercised without clearing storage by hand.
 */
if (typeof window !== "undefined") {
  (window as unknown as { hypeboundIntro?: unknown }).hypeboundIntro = {
    play: (kind: IntroKind = "first-run") => {
      running?.();
      running = playIntro(kind);
      return running;
    },
    frame: (kind: IntroKind, ms: number) => frameIntro(kind, ms),
    stop: () => {
      running?.();
      running = null;
    },
    forget: forgetTitle,
    choose: chooseIntro,
  };
}
