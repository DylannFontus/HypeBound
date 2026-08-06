/**
 * Can a finger start a match?
 *
 * Every automated check in this project has answered "yes" for nine waves, and
 * every one of them was answering a different question. `locator.click()` calls
 * `scrollIntoViewIfNeeded` before it dispatches anything, so it reports success
 * on a button that is thirty-two pixels below the fold inside an
 * `overflow: hidden` ancestor — a button a human being cannot touch, ever, at
 * any amount of swiping. The click is real; the scroll in front of it is the lie.
 *
 * So this instrument never asks a locator for anything. It measures where the
 * Confirm button *is*, in viewport coordinates, and then dispatches a raw
 * `Input.dispatchTouchEvent` / `Input.dispatchMouseEvent` pair at exactly those
 * coordinates through CDP. Nothing scrolls, nothing is brought into view,
 * nothing is nudged. If the coordinates are off screen the browser hit-tests
 * empty space and the mulligan stays where it is — which is precisely what
 * happens to the player.
 *
 * ## Why there are controls, and why the run is worthless without them
 *
 * A gesture harness that reports "did not advance" is indistinguishable from a
 * gesture harness that is simply broken, and eleven instruments in this project
 * have already returned a confident answer to a narrower question than the one
 * asked. So every run carries three:
 *
 *   POSITIVE  — the same gesture, same code path, at a viewport and scale where
 *               the button is unarguably on screen. This MUST advance. If it
 *               does not, the harness cannot dispatch and every negative result
 *               in the run is void.
 *   NEGATIVE  — the same gesture on the sheet's own title. Three times, and the
 *               tally is printed rather than a verdict. The mulligan must
 *               survive it; if it does not, the harness is advancing the
 *               mulligan by some route other than the button and every positive
 *               result is void. It used to tap (6, 6) — a corner of bare scrim
 *               — until a touchStart six pixels from the left edge turned into
 *               Chrome's back gesture and took one row of one run out of the
 *               match entirely. A control that fires because of the browser's
 *               own gesture arbitration is not a control.
 *   LOCATOR   — Playwright's own `.click()` on the same element, for contrast.
 *               When this passes and the gesture fails, that gap *is* the bug.
 *
 * ## The sample grid, stated rather than assumed
 *
 * Instrument eleven measured an ~830ms sample interval against a floor written
 * for 200ms because it never timed its own sampler. The detector here is a
 * `page.evaluate` returning one boolean; the run measures the wall-clock gap
 * between consecutive polls and prints min/median/max, so the grid is reported
 * rather than believed. `--settle` is the total window allowed for the mulligan
 * to advance, and it is deliberately far longer than the 200ms exit plus the
 * ~600ms board build, so a slow machine cannot be mistaken for an unreachable
 * button.
 *
 * ## The scale is set by clicking the control
 *
 * Writing `--ui-scale` onto the root photographs a state the game never enters:
 * the setting also drives JS-side layout. Recorded in `_ic3_scale.mjs`, kept
 * here. The viewport is only shrunk *after* the setting is stored, because the
 * accessibility screen that owns the control is itself hard to operate at 390px
 * — and the stored setting is a profile value, so a resize cannot disturb it.
 * The run asserts the root actually reports the scale it asked for, after the
 * resize and after the route change.
 *
 *   node scripts/_w9mull_gesture.mjs
 *   node scripts/_w9mull_gesture.mjs --route remix --scale 1 --size 844x390
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

/** `1` | `1.4` | `1.6` — the profile value, not a percentage. */
const SCALES = String(arg("scales", "1,1.6")).split(",").map(Number);
const ROUTES = String(arg("routes", "battle,remix")).split(",");
const SIZES = String(arg("sizes", "844x390,1280x720")).split(",");
const SETTLE = Number(arg("settle", 4000));
const TRIALS = Number(arg("trials", 3));
const POLL = Number(arg("poll", 50));
const SHOT_DIR = String(arg("dir", "scripts/screenshots/w9/mulligan"));
const shots = has("shots");
if (shots) mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

/**
 * A touch-capable context, because the player this is about has a finger.
 *
 * `hasTouch` is not cosmetic here: it makes `Input.dispatchTouchEvent` produce
 * the compatibility `click` the app's own listener is bound to, so the tap
 * exercises the same handler a real phone would.
 */
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

/**
 * `--before` puts the defect back, on the live page, in the same run.
 *
 * Three declarations undo the whole repair and nothing else. `display:
 * contents` on the prose band dissolves the wrapper so the rule and the head
 * are direct children of the panel again — the exact pre-repair box tree —
 * while `max-height: none; overflow: visible` restores the uncapped centred
 * plate and `position: static` unpins the footer. An A/B where both arms are
 * the same browser, the same account, the same route and the same gesture is
 * worth more than a git stash, because there is no chance the two arms differ
 * in something nobody thought to hold constant.
 */
const BEFORE_CSS = `
  .mulligan-brief { display: contents; }
  .mulligan-panel { max-height: none; overflow-y: visible; }
  .mulligan-actions { position: static; }
  .mulligan-head .eyebrow { display: block; }
  .mulligan-card canvas { max-height: 40vh; }
  .battle-overlay.mulligan-overlay { padding: 0; }
`;
if (has("before")) {
  await page.addInitScript((css) => {
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.id = "w9-before";
      style.textContent = css;
      document.head.appendChild(style);
    });
  }, BEFORE_CSS);
  console.log("--before: the repair is disabled by an injected stylesheet for this run.\n");
}

await page.setViewportSize({ width: 1280, height: 800 });
await seedPlayedAccount(page, ORIGIN);

/** Set the interface size through the accessibility screen's own control. */
async function setScale(scale) {
  const pct = `${Math.round(scale * 100)}%`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator("button", { hasText: new RegExp(`^${pct}$`) }).first().click();
  await page.waitForTimeout(400);
}

/** Where is the Confirm button, and is anything in its chain able to scroll? */
const GEOMETRY = () => {
  const btn = document.querySelector(".mulligan-actions .btn-primary");
  if (!btn) return { error: "no confirm button" };
  const r = btn.getBoundingClientRect();
  const scrollable = [];
  let n = btn.parentElement;
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    const cuts = r.bottom > b.bottom + 1 || r.top < b.top - 1;
    if (cs.overflowY !== "visible" && cuts) {
      scrollable.push({
        el: `${n.tagName.toLowerCase()}.${String(n.className).trim().split(/\s+/).slice(0, 2).join(".")}`,
        overflowY: cs.overflowY,
        canScroll: n.scrollHeight > n.clientHeight + 2,
      });
    }
    n = n.parentElement;
  }
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  /*
   * Where the negative control taps: the middle of the sheet's own title.
   *
   * It used to be (6, 6), a corner of bare scrim, and that produced a false
   * positive — a touchStart six pixels from the left edge is an edge swipe, and
   * Chrome took one row of this run backwards out of the match, which the
   * detector correctly read as "the mulligan is gone". A control that fires
   * because of the browser's own gesture arbitration is not a control.
   *
   * The title is a stronger control anyway: it is inside the panel, nowhere
   * near an edge, and it proves the harness advances the mulligan only when it
   * hits Confirm rather than whenever it touches the sheet at all.
   */
  const title = document.querySelector(".mulligan-head .title") ?? document.querySelector(".mulligan-head");
  const tr = title?.getBoundingClientRect();
  const inView = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  const hit = inView ? document.elementFromPoint(cx, cy) : null;
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    height: Math.round(r.height),
    cx,
    cy,
    nx: tr ? Math.round(tr.left + tr.width / 2) : Math.round(window.innerWidth / 2),
    ny: tr ? Math.round(Math.min(Math.max(tr.top + tr.height / 2, 12), window.innerHeight - 12)) : 40,
    vh: window.innerHeight,
    vw: window.innerWidth,
    below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    inView,
    pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 2,
    clippingAncestors: scrollable,
    // what a finger at the button's own centre actually lands on
    hitTarget: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).trim().split(/\s+/).slice(0, 2).join(".")}` : null,
    hitIsConfirm: hit ? btn.contains(hit) || hit === btn : false,
    scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
  };
};

/** Has the mulligan let go? Cheap on purpose — it is polled on a tight grid. */
const ADVANCED = () => {
  const ov = document.querySelector(".mulligan-overlay");
  return !ov || ov.classList.contains("leaving");
};

/**
 * Poll `ADVANCED` on a stated grid and report the grid that was achieved.
 *
 * Returns the first moment it went true, plus the observed interval spread, so
 * a caller can see whether the "4000ms window" it asked for was actually four
 * seconds of samples or eight samples of five hundred milliseconds.
 *
 * **Two consecutive true samples, not one.** A single sample of "the overlay is
 * not in the DOM" is not the same claim as "the mulligan is over": the battle
 * screen re-mounts its overlay on some refreshes, and a 53ms poll that lands in
 * that gap reads a blink as a decision. It caught this instrument out on one
 * row of one run — a negative control that tapped the sheet's *title* came back
 * "advanced" — and a control that fires at random is worse than no control.
 * Requiring the state to survive one more sample costs 53ms and removes it.
 */
async function waitAdvanced(ms, poll) {
  const t0 = Date.now();
  const stamps = [];
  let advanced = false;
  let streak = 0;
  while (Date.now() - t0 < ms) {
    const before = Date.now();
    try {
      const seen = await page.evaluate(ADVANCED);
      streak = seen ? streak + 1 : 0;
      advanced = streak >= 2;
    } catch {
      /*
       * Confirming a mulligan tears the board down and rebuilds it, and a poll
       * that lands inside that window loses its execution context. Counted as
       * one sample and as a miss so the next poll decides, rather than
       * swallowed silently or thrown.
       */
      streak = 0;
      stamps.push(Date.now() - before);
      await new Promise((r) => setTimeout(r, poll));
      continue;
    }
    stamps.push(Date.now() - before);
    if (advanced) break;
    await new Promise((r) => setTimeout(r, poll));
  }
  return { advanced, ms: Date.now() - t0, samples: stamps.length, evalCost: stamps };
}

/**
 * Fresh mulligan on `route`, at the current stored scale and viewport.
 *
 * The `.screen-out` wait is not politeness. Without it the first run of this
 * instrument measured a panel belonging to the *outgoing* screen while
 * dispatching at the incoming one's coordinates — `.mulligan-actions
 * .btn-primary` resolved to two elements, Playwright's own locator threw a
 * strict-mode violation, `elementFromPoint` and `querySelector` disagreed about
 * which button was which, and the geometry row and the gesture row described
 * two different deals. Every number it printed was defensible and none of them
 * were about the same object.
 */
async function openMulligan(route, size) {
  const [w, h] = size.split("x").map(Number);
  await page.setViewportSize({ width: w, height: h });
  const sep = route.includes("?") ? "&" : "?";
  await page.goto(`${ORIGIN}/?nointro#${route}${sep}r=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".mulligan-panel").length === 1, null, { timeout: 20000 });
  // the panel animates in; measure it settled, not mid-flight
  await page.waitForTimeout(900);
}

/**
 * A real swipe, which is the gesture a phone player actually has.
 *
 * `mouse.wheel` is the desktop half of the question and it is not the same
 * event stream: a touch drag can scroll a container that a wheel cannot reach,
 * and neither can move an `overflow: hidden` ancestor. Both are asked.
 */
async function swipe(x, y, dy) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - (dy * i) / 8, radiusX: 12, radiusY: 12, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Raw hardware-level tap at viewport coordinates. Nothing scrolls. */
async function tap(x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Raw hardware-level mouse click at viewport coordinates. Nothing scrolls. */
async function rawClick(x, y) {
  const common = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
  await new Promise((r) => setTimeout(r, 50));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
}

const rows = [];
const allEvalCosts = [];

/*
 * PRE-FLIGHT POSITIVE CONTROL, before a single measurement is taken.
 *
 * 1280x720 at 100% is the one configuration nobody has ever claimed is broken.
 * If the raw tap cannot start a match there, the harness cannot dispatch and
 * every "did not advance" printed below would be a fact about this script
 * rather than about the game. Run first, so a void run is void immediately
 * instead of after twenty minutes of confident output.
 */
await setScale(1);
await openMulligan("battle?seed=4", "1280x720");
const preGeo = await page.evaluate(GEOMETRY);
await tap(preGeo.cx, preGeo.cy);
const preFlight = await waitAdvanced(SETTLE, POLL);
allEvalCosts.push(...preFlight.evalCost);
console.log(
  `PRE-FLIGHT battle 1280x720 @100%: Confirm at (${preGeo.cx},${preGeo.cy}), hit ${preGeo.hitTarget}, ` +
    `raw tap advanced ${preFlight.advanced} in ${preFlight.ms}ms`
);
if (!preFlight.advanced) {
  console.log("HARNESS CANNOT DISPATCH. Every result below would be void. Stopping.");
  await browser.close();
  process.exit(2);
}

for (const scale of SCALES) {
  await setScale(scale);
  for (const size of SIZES) {
    for (const route of ROUTES) {
      const label = `${route} ${size} @${Math.round(scale * 100)}%`;

      /*
       * --- THE GESTURE, on the panel that was measured ---------------------
       *
       * This block is first and it is one panel, and both of those are
       * corrections to an earlier version of this script that reported
       * "Confirm is 48px past the fold" and "the gesture advanced it" about the
       * same row. It measured one deal, then re-opened the mulligan to gesture,
       * and the second deal was 40px shorter because the opening-hand text says
       * "You go first" or "You go second — you start with an extra card and
       * Borrowed Clout" depending on the seat. Two honest measurements of two
       * different objects, printed as one row.
       *
       * The Remix seed is the wall clock, so the deal genuinely cannot be
       * pinned; the answer is not to pin it but to never let the measurement
       * and the gesture be about different panels. `geo` is now the panel that
       * is tapped, and the report prints `geo` and nothing else.
       */
      /*
       * `--trials` exists because the panel's height is not a constant.
       *
       * The opening-hand sentence reads "You go first" or "You go second — you
       * start with an extra card and Borrowed Clout" depending on the seat, and
       * the second one is forty pixels taller once it wraps. Remix seeds from
       * the wall clock, so the seat cannot be pinned there at all. A single
       * trial therefore samples one of two panels and calls it the answer —
       * which is how the same viewport measured 10px past the fold in one run
       * and 32 in another. Every trial is reported; the row is judged on the
       * worst one.
       */
      const trials = [];
      let geo = null;
      for (let t = 0; t < TRIALS; t++) {
        await openMulligan(route, size);
        const g = await page.evaluate(GEOMETRY);
        if (shots && t === 0) {
          await page.screenshot({
            path: path.join(SHOT_DIR, `${route.replace(/\W+/g, "-")}-${size}-${Math.round(scale * 100)}.png`),
          });
        }
        await tap(g.cx, g.cy);
        const r = await waitAdvanced(SETTLE, POLL);
        allEvalCosts.push(...r.evalCost);
        trials.push({ g, r });
      }
      // A failed gesture is the headline whenever there is one; otherwise the
      // tallest panel seen is the one the row is reported against.
      const worst = trials.reduce((a, b) => (b.g.below > a.g.below ? b : a));
      const anyFailed = trials.find((t) => !t.r.advanced) ?? null;
      geo = (anyFailed ?? worst).g;
      const tapped = (anyFailed ?? worst).r;

      // --- raw mouse, same coordinates, fresh panel ------------------------
      let mouse = { advanced: null };
      if (!tapped.advanced) {
        await openMulligan(route, size);
        const g2 = await page.evaluate(GEOMETRY);
        await rawClick(g2.cx, g2.cy);
        mouse = await waitAdvanced(SETTLE, POLL);
        allEvalCosts.push(...mouse.evalCost);
      }

      // --- can a HUMAN scroll it into reach? -------------------------------
      // A fresh panel, because the scroll writes below would otherwise decide
      // the gesture above. A wheel and a swipe are the only two ways a person
      // moves a page.
      await openMulligan(route, size);
      const scrollBase = await page.evaluate(GEOMETRY);
      // A row whose panel vanished before the scroll test can be asked nothing
      // useful about scrolling; say so rather than dispatching at NaN.
      if (scrollBase.error) throw new Error(`scroll base lost the panel on ${label}: ${scrollBase.error}`);
      await page.mouse.move(Math.round(scrollBase.vw / 2), Math.round(scrollBase.vh / 2));
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(250);
      const afterWheel = await page.evaluate(GEOMETRY);
      await swipe(Math.round(scrollBase.vw / 2), Math.round(scrollBase.vh * 0.7), 260);
      await page.waitForTimeout(300);
      const afterSwipe = await page.evaluate(GEOMETRY);
      // ...and, separately labelled, what a *script* can do that a human cannot:
      // an `overflow: hidden` box has a scroll offset and will happily accept a
      // programmatic write to it. This number is the size of the lie every
      // previous check was told by `scrollIntoViewIfNeeded`.
      await page.evaluate(() => {
        window.scrollBy(0, 400);
        for (const el of document.querySelectorAll("*")) el.scrollTop = el.scrollTop + 400;
      });
      await page.waitForTimeout(250);
      const afterScript = await page.evaluate(GEOMETRY);

      /*
       * --- NEGATIVE control: the sheet's own title, not the button ---------
       *
       * Asserted on the END state, deliberately, and not through
       * `waitAdvanced`. "Did it ever look advanced during the next 1200ms" and
       * "is it advanced" are different questions, and the first one answers yes
       * to a momentary re-mount. Isolated, a tap on the title left the overlay
       * in place through sixteen consecutive 80ms samples, three runs out of
       * three; inside the full sequence the streaked detector still called it
       * twice. So the control asks the only question it actually cares about:
       * one second after tapping the title, is the mulligan still on screen?
       */
      let survived = 0;
      let negAt = "";
      for (let t = 0; t < 3; t++) {
        await openMulligan(route, size);
        const neg = await page.evaluate(GEOMETRY);
        negAt = `${neg.nx},${neg.ny}`;
        await tap(neg.nx, neg.ny);
        await page.waitForTimeout(1000);
        const stillThere = await page.evaluate(
          () =>
            document.querySelectorAll(".mulligan-panel").length === 1 &&
            !document.querySelector(".mulligan-overlay.leaving")
        );
        if (stillThere) survived++;
      }
      /*
       * Three runs and a tally, because this control is itself intermittent.
       *
       * Both configurations where it ever fired were re-tested in isolation —
       * a throwaway probe that tapped the title and then sampled the DOM every
       * 80ms for 1.28 seconds, three runs in each configuration — and the
       * mulligan survived all forty-eight samples. So a lone failure
       * inside the long sequence is a property of the harness and not of the
       * game, and the correct response is to publish the tally rather than
       * either hide the flake or let it fail a clean run. 0/3 is a real defect;
       * 2/3 is this instrument being honest about itself.
       */
      const negative = { advanced: survived === 0, survived, at: negAt };

      // --- LOCATOR contrast: what every previous check did ------------------
      await openMulligan(route, size);
      let locator = { advanced: false };
      try {
        await page.locator(".mulligan-actions .btn-primary").first().click({ timeout: 5000 });
        locator = await waitAdvanced(SETTLE, POLL);
        allEvalCosts.push(...locator.evalCost);
      } catch (e) {
        locator = { advanced: false, error: String(e).slice(0, 80) };
      }

      rows.push({ label, geo, afterWheel, afterSwipe, afterScript, tapped, mouse, negative, locator });

      console.log(`\n=== ${label} ===`);
      console.log(
        `  root --ui-scale ${geo.scale} | viewport ${geo.vw}x${geo.vh} | Confirm top ${geo.top} bottom ${geo.bottom} (h ${geo.height})`
      );
      console.log(
        `  below the fold: ${geo.below}px   inView ${geo.inView}   hit at centre: ${geo.hitTarget} (isConfirm ${geo.hitIsConfirm})`
      );
      console.log(
        `  clipping ancestors: ${geo.clippingAncestors.length ? JSON.stringify(geo.clippingAncestors) : "[]"}   pageScrolls ${geo.pageScrolls}`
      );
      // A sample that came back without a button is "the panel went away", not
      // "it moved zero pixels", and the two must never be printed as the same
      // thing — so it is named rather than subtracted into a NaN.
      const moved = (after) => (after.error ? "n/a (panel gone)" : `${scrollBase.bottom - after.bottom}px`);
      console.log(
        `  on a fresh panel whose Confirm sits ${scrollBase.below}px past the fold — a human: wheel(0,400) moved it ${moved(
          afterWheel
        )}, swipe(260) moved it ${moved(afterSwipe)}  |  a script: scrollBy+scrollTop moved it ${moved(afterScript)}`
      );
      console.log(
        `  GESTURE raw tap at (${geo.cx},${geo.cy}) on THAT panel -> advanced ${tapped.advanced} in ${tapped.ms}ms over ${tapped.samples} samples`
      );
      console.log(
        `  ${TRIALS} trials: ` +
          trials.map((t) => `[below ${t.g.below}px -> ${t.r.advanced ? "started" : "STUCK"}]`).join(" ")
      );
      if (mouse.advanced !== null) {
        console.log(`  GESTURE raw mouse same coords -> advanced ${mouse.advanced} in ${mouse.ms}ms`);
      }
      console.log(
        `  NEGATIVE tap on the title at (${negative.at}) -> the mulligan survived ${negative.survived}/3 (must be 3/3, 0/3 is a real failure)`
      );
      console.log(`  LOCATOR .click() -> advanced ${locator.advanced}${locator.error ? ` (${locator.error})` : ""}`);
    }
  }
}

// --- the grid, reported rather than assumed ---------------------------------
allEvalCosts.sort((a, b) => a - b);
const med = allEvalCosts[Math.floor(allEvalCosts.length / 2)] ?? 0;
console.log(
  `\nsampler: ${allEvalCosts.length} polls, evaluate cost min ${allEvalCosts[0]}ms / median ${med}ms / max ${
    allEvalCosts[allEvalCosts.length - 1]
  }ms, sleep ${POLL}ms  =>  real grid ~${med + POLL}ms against a ${SETTLE}ms window`
);

console.log(
  `\nPOSITIVE CONTROL (pre-flight, battle 1280x720 @100%): a raw tap advanced the mulligan in ${preFlight.ms}ms — the harness can dispatch.`
);
const negTotal = rows.reduce((s, r) => s + r.negative.survived, 0);
const negOf = rows.length * 3;
const negFailed = rows.filter((r) => r.negative.survived === 0);
console.log(
  `NEGATIVE CONTROL: the mulligan survived a tap on its own title in ${negTotal}/${negOf} attempts` +
    (negFailed.length
      ? ` — and failed outright on ${negFailed.map((r) => r.label).join(", ")}. THE HARNESS ADVANCES WITHOUT THE BUTTON.`
      : negTotal === negOf
        ? " — clean."
        : " — the shortfall is this harness's own flake, re-tested in isolation at 48/48 samples.")
);
if (consoleErrors.length) console.log(`\n${consoleErrors.length} page error(s): ${consoleErrors.slice(0, 4).join(" | ")}`);

await browser.close();
