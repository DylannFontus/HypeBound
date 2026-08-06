/**
 * Calibrate the *stopwatch*, not the arithmetic. This is the file that exists
 * because instrument eleven did not.
 *
 * ## What went wrong, in one sentence
 *
 * Two probes sampled a screen at rest with `screenshot()` + `waitForTimeout(200)`
 * and compared the answer to a floor written per 200ms, while the loop actually
 * ran at 843ms — and both of them had "calibrated", because both had reproduced
 * the reference set's n=203 / min 0.501 / median 1.713 with their own copy of
 * `meanDelta`. Reproducing a distribution proves the arithmetic. It says nothing
 * whatever about the interval, and the interval is half the metric: "mean
 * absolute delta" is meaningless without "per what".
 *
 * ## The five things this proves, in the order they need proving
 *
 *   node scripts/_w9grid.mjs ref [--crop 1600x900]
 *     The reference set's own clock, read off its own filenames, and the
 *     reference distribution recomputed at 200/400/600/800/1000ms. This is what
 *     turns "the old figures were on an 843ms grid" from an accusation into an
 *     exchange rate. `--crop` answers the second unchecked assumption: the
 *     reference is 1920x1080 and the sweep runs at 1600x900.
 *
 *   node scripts/_w9grid.mjs pixels
 *     `optimizeForSpeed` is what makes a 200ms grid affordable at all. It is a
 *     zlib level and not a colour transform — asserted here byte for byte on a
 *     frozen page, because a cheap capture that quietly resampled would be
 *     instrument twelve.
 *
 *   node scripts/_w9grid.mjs cost [route]
 *     The old loop and the new sampler run back to back against the same live
 *     route, each reporting the grid it actually achieved.
 *
 *   node scripts/_w9grid.mjs crosscheck [route]
 *     Does the cure introduce its own disease? The honest sampler captures five
 *     times a second where the old one managed once, so the same route is
 *     measured a second time through a screencast reel — a completely different
 *     capture path — and the two medians are compared. A camera that slows its
 *     subject reports a low number, which is a new lie pointing the other way.
 *
 *   node scripts/_w9grid.mjs replay
 *     The end-to-end proof, and the only one that cannot be argued with. The
 *     reference frames are replayed into a browser at a known 200ms cadence and
 *     photographed back out by both samplers. Every capture is then *identified*
 *     — matched against the forty known frames — so the answer is not a delta to
 *     be interpreted but a list of frame numbers. A 200ms sampler must walk
 *     1,2,3,4,5. If it walks 1,5,9,13 its grid is four frames wide, whatever its
 *     label says. There is no way for this to return a confident wrong answer:
 *     the units are reference frames.
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import {
  FRAMES_DIR,
  createIdleSampler,
  f3,
  gridNote,
  meanDelta,
  quantiles,
  referenceAtLag,
  referenceGrid,
} from "./lib/idle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  path.join("C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join("C:", "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "ref";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);

/* ---------------------------------------------------------------------- ref */

if (mode === "ref") {
  const grid = referenceGrid();
  if (!grid) {
    console.log("!! hearthstone_frames/ is missing — nothing here can be calibrated");
    process.exit(2);
  }
  console.log(
    `[ref] ${grid.n} frames; filename timestamps step ${grid.gaps.join("/")}ms  ` +
      `${grid.uniform ? "UNIFORM — a per-200ms floor is meaningful" : "!! NOT UNIFORM — 'per 200ms' was never true"}`
  );
  if (!grid.uniform) process.exit(2);
  console.log("");
  console.log("      lag    n     min     p10  median     p90     max    mean");
  const table = {};
  for (const lag of [200, 400, 600, 800, 1000]) {
    const s = referenceAtLag(lag);
    table[lag] = s;
    console.log(
      `  ${String(lag).padStart(5)}ms ${String(s.n).padStart(4)}  ${f3(s.min)}  ${f3(s.p10)}  ` +
        `${f3(s.median)}  ${f3(s.p90)}  ${f3(s.max)}  ${f3(s.mean)}`
    );
  }
  const at200 = table[200];
  const agrees = at200.n === 203 && Math.abs(at200.min - 0.501) < 0.002 && Math.abs(at200.median - 1.713) < 0.002;
  console.log(
    `\n[ref] published n=203 min=0.501 median=1.713 -> ` +
      (agrees ? "AGREES; the arithmetic is unchanged from every earlier probe" : "!! DOES NOT AGREE")
  );
  /**
   * The other axis nobody had checked: the reference is 1920x1080 and the sweep
   * runs at 1600x900. `--crop WxH` recomputes the floor on a centred window of
   * the reference at the size we actually measure, so the size gap is a number
   * rather than an assumption.
   */
  if (flag("crop", null)) {
    const [cw, ch] = String(flag("crop")).split("x").map(Number);
    const c = referenceAtLag(200, undefined, { width: cw, height: ch });
    console.log(
      `[ref] the same 200ms reference cropped to ${cw}x${ch}: n=${c.n} min=${f3(c.min)} median=${f3(c.median)} ` +
        `(full frame ${f3(at200.min)} / ${f3(at200.median)})`
    );
  }
  console.log(
    `[ref] the exchange rate: a figure taken on an 843ms grid faces a floor of about ` +
      `${f3(table[800].min)} (min) / ${f3(table[800].median)} (median), not 0.501 / 1.713.`
  );
  process.exit(agrees ? 0 : 2);
}

/* -------------------------------------------------------------------------- */

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 1,
});

/**
 * The loop as it was committed, kept verbatim so the comparison is with the real
 * thing and not with a reconstruction of it.
 */
async function legacyIdle(seconds) {
  const shots = [];
  const starts = [];
  for (let i = 0; i * 0.2 < seconds; i += 1) {
    starts.push(performance.now());
    shots.push(decodePng(await page.screenshot()));
    await page.waitForTimeout(200);
  }
  const ds = [];
  for (let i = 1; i < shots.length; i += 1) ds.push(meanDelta(shots[i - 1], shots[i]));
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  return { ...quantiles(ds), grid: quantiles(gaps), shots };
}

try {
  /* ------------------------------------------------------------------ pixels */
  if (mode === "pixels") {
    // A page that cannot possibly change between two captures, so any difference
    // is the encoder's and not the subject's.
    await page.setContent(
      `<style>html,body{margin:0;height:100%}body{background:
       linear-gradient(135deg,#0b0d1a,#2a1140 40%,#07131a);animation:none}</style>
       <div style="position:absolute;inset:12% 8%;background:repeating-linear-gradient(
       45deg,#ff2fb0 0 3px,#12e0ff 3px 6px);filter:blur(0.4px)"></div>`
    );
    await page.waitForTimeout(600);
    const cdp = await page.context().newCDPSession(page);
    const slow = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64");
    const fast = Buffer.from(
      (
        await cdp.send("Page.captureScreenshot", {
          format: "png",
          optimizeForSpeed: true,
        })
      ).data,
      "base64"
    );
    const a = decodePng(slow);
    const b = decodePng(fast);
    const same = a.width === b.width && a.height === b.height && a.channels === b.channels;
    let differing = 0;
    for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) differing += 1;
    console.log(
      `[pixels] slow ${a.width}x${a.height}ch${a.channels} ${(slow.length / 1024).toFixed(0)}KB   ` +
        `fast ${b.width}x${b.height}ch${b.channels} ${(fast.length / 1024).toFixed(0)}KB`
    );
    console.log(
      `[pixels] geometry identical=${same}  differing bytes=${differing}  meanDelta=${meanDelta(a, b).toFixed(6)}  ` +
        (same && differing === 0
          ? "LOSSLESS — the fast encoder is the same picture"
          : "!! THE FAST PATH CHANGES PIXELS")
    );
    if (!same || differing !== 0) process.exitCode = 2;
  }

  /* -------------------------------------------------------------------- cost */
  if (mode === "cost") {
    const route = argv[1] ?? "lobby";
    const { seedPlayedAccount } = await import("./lib/account.mjs");
    // `?nointro` first: the seeder waits for the starter picker to be *visible*,
    // and the title cinematic is a sibling of `#app` that sits over it.
    await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(4000);

    const old = await legacyIdle(3);
    console.log(
      `[old] #${route} n=${old.n} min=${f3(old.min)} median=${f3(old.median)} max=${f3(old.max)}\n` +
        `      achieved grid ${old.grid.median.toFixed(0)}ms (${old.grid.min.toFixed(0)}–${old.grid.max.toFixed(0)}) ` +
        `against a 200ms label — off by ${(old.grid.median / 200).toFixed(1)}x`
    );

    const sample = await createIdleSampler(page, { lagMs: 200 });
    const now = await sample({ seconds: 3 });
    console.log(
      `[new] #${route} n=${now.n} min=${f3(now.min)} median=${f3(now.median)} max=${f3(now.max)}\n` +
        `      ${gridNote(now)}  capture ${now.captureMs.median?.toFixed(0)}ms`
    );
    console.log(
      `\n[cost] same screen, same arithmetic, two stopwatches: ` +
        `${f3(old.median)} at ${old.grid.median.toFixed(0)}ms vs ${f3(now.median)} at ${now.grid.median.toFixed(0)}ms ` +
        `— the old reading is ${(old.median / now.median).toFixed(2)}x the honest one.`
    );
  }

  /* --------------------------------------------------------------- attribute */
  /**
   * What is actually keeping a screen above the floor — the room, the grain, or
   * the screen's own content?
   *
   * The obvious way to ask is three separate runs of the sweep with different
   * layers switched off, and it does not work: `#news` measured 0.956 with
   * everything on and 1.398 with the grain *removed*, which is impossible and is
   * simply the spread of a screen whose own content moves on its own schedule.
   * Comparing arms across runs measures the schedule.
   *
   * So all four arms are measured in one session on one page, interleaved
   * A-B-C-D-A-B-C-D, and pooled — the same shape `_w8room_sweep.mjs cost` had to
   * adopt when an A-then-B ordering charged the room for a route's own warm-up.
   * Whatever drifts across the session lands on all four arms equally.
   *
   *   A  everything on          D  both off  (the floor of the screen itself)
   *   B  room hidden            C  grain hidden
   *
   * A − C is what the grain is worth; A − B is what the room is worth; D is what
   * is left when neither is drawn.
   */
  if (mode === "attribute") {
    const route = argv[1] ?? "legal";
    const rounds = Number(flag("rounds", 3));
    const { seedPlayedAccount } = await import("./lib/account.mjs");
    await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(6000);

    const ARMS = {
      "A everything on": "",
      "B room hidden": ".screen > .d-room",
      "C grain hidden": ".atm-fore-grain",
      "D both hidden": ".screen > .d-room, .atm-fore-grain",
    };
    /**
     * Apply the arm, then **read back what is actually drawn**, and let the
     * caller throw the round away if the two disagree.
     *
     * The first run of this mode produced a "both hidden" round reading 1.213
     * where its siblings read 0.19 and 0.39, and a "room hidden" round reading
     * 2.079 against 1.23 and 1.10. Both are the signature of the injected style
     * tag having gone away — three other builders are saving files into this
     * Vite server, and a full reload takes `#__attr` with it and restores every
     * layer without saying so. An experiment whose independent variable is not
     * verified at the moment of measurement is not an experiment; it is the same
     * mistake as a probe that cannot prove which screen it photographed.
     */
    const set = async (sel) => {
      const state = await page.evaluate((s) => {
        let tag = document.getElementById("__attr");
        if (!tag) {
          tag = document.createElement("style");
          tag.id = "__attr";
          document.head.appendChild(tag);
        }
        tag.textContent = s ? `${s} { display: none !important; }` : "";
        return null;
      }, sel);
      void state;
      await page.waitForTimeout(700);
      return page.evaluate(() => {
        const screen = [...document.querySelectorAll(".screen")].find((x) => !x.classList.contains("screen-out"));
        const room = screen?.querySelector(":scope > .d-room");
        const grain = document.querySelector(".atm-fore-grain");
        const shown = (el) => Boolean(el) && el.offsetParent !== null;
        return {
          room: shown(room),
          grain: shown(grain),
          tag: Boolean(document.getElementById("__attr")),
        };
      });
    };
    const WANT = {
      "A everything on": { room: true, grain: true },
      "B room hidden": { room: false, grain: true },
      "C grain hidden": { room: true, grain: false },
      "D both hidden": { room: false, grain: false },
    };

    /**
     * The page reloads underneath this, and that is not a hypothesis.
     *
     * A run of this mode died mid-round with "Execution context was destroyed,
     * most likely because of a navigation", and the arm check on the round
     * before it reported the layers as hidden going in and *visible* coming out.
     * Three other builders are saving into this Vite server; some of those saves
     * are full reloads rather than hot updates, and a reload takes the injected
     * style tag with it and puts every layer back. That is the whole explanation
     * for the scatter this mode showed on its first run, and it is why every
     * round is now bracketed by a load counter as well as by a state read.
     */
    let loads = 0;
    page.on("load", () => (loads += 1));
    const sample = await createIdleSampler(page, { lagMs: 200 });
    const pooled = Object.fromEntries(Object.keys(ARMS).map((k) => [k, []]));
    const grids = [];
    for (let r = 0; r < rounds; r += 1) {
      for (const [label, sel] of Object.entries(ARMS)) {
        try {
          const loadsBefore = loads;
          const before = await set(sel);
          const s = await sample({ seconds: 2.4 });
          const after = await page.evaluate(() => {
            const screen = [...document.querySelectorAll(".screen")].find((x) => !x.classList.contains("screen-out"));
            const room = screen?.querySelector(":scope > .d-room");
            const grain = document.querySelector(".atm-fore-grain");
            const shown = (el) => Boolean(el) && el.offsetParent !== null;
            return { room: shown(room), grain: shown(grain) };
          });
          const want = WANT[label];
          const held =
            before.room === want.room &&
            before.grain === want.grain &&
            after.room === want.room &&
            after.grain === want.grain;
          if (!s.onGrid || !held || loads !== loadsBefore) {
            console.log(
              `  round ${r + 1} ${label.padEnd(16)} DISCARDED — ` +
                (loads !== loadsBefore
                  ? `the page reloaded underneath the sample (${loads - loadsBefore} load(s))`
                  : !s.onGrid
                    ? `off grid (${s.grid.median?.toFixed(0)}ms)`
                    : `the arm did not hold: wanted room=${want.room} grain=${want.grain}, ` +
                      `saw ${before.room}/${before.grain} before and ${after.room}/${after.grain} after`)
            );
            continue;
          }
          pooled[label].push(s.median);
          grids.push(s.grid.median);
          console.log(
            `  round ${r + 1} ${label.padEnd(16)} median ${f3(s.median)}  grid ${s.grid.median.toFixed(0)}ms`
          );
        } catch (error) {
          console.log(`  round ${r + 1} ${label.padEnd(16)} DISCARDED — ${String(error.message).slice(0, 70)}`);
          await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" }).catch(() => {});
          await page.waitForTimeout(4000);
        }
      }
    }
    await set("");
    const g = quantiles(grids);
    console.log(
      `\n[attribute] #${route}, ${rounds} interleaved rounds, grid ${g.median?.toFixed(1)}ms (${g.min?.toFixed(0)}–${g.max?.toFixed(0)})`
    );
    /**
     * The verdict is taken from each arm's **minimum** across rounds, not its
     * median, and the reason is a property of the quantity rather than a taste
     * in statistics.
     *
     * Every contaminating event available on this machine — a Vite HMR update
     * from one of the three other builders saving a file, a scrollbar
     * appearing, a repaint from a devtools attach — **adds** pixel change. None
     * of them can subtract it. So the arm's true undisturbed level is bounded
     * above by every round and estimated best by the smallest, and a median over
     * five rounds of which two were disturbed is simply a disturbed number.
     * The tell that this is the right reading: with everything but the room
     * hidden, three of five rounds agree to within 0.02 (0.272 / 0.282 / 0.260)
     * and two sit near 1.3, which is one population and some interference, not a
     * distribution.
     *
     * The median is printed beside it so that the choice is visible rather than
     * silent.
     */
    const med = (k) => (pooled[k].length ? quantiles(pooled[k]).median : null);
    const low = (k) => (pooled[k].length ? Math.min(...pooled[k]) : null);
    for (const k of Object.keys(ARMS)) {
      console.log(
        `  ${k.padEnd(16)} quietest ${f3(low(k))}  (median ${f3(med(k))})  from [${pooled[k].map((x) => x.toFixed(2)).join(" ")}]`
      );
    }
    const a = low("A everything on");
    const b = low("B room hidden");
    const c = low("C grain hidden");
    const d = low("D both hidden");
    if (a !== null && b !== null && c !== null && d !== null) {
      console.log(
        `\n[attribute] the room is worth ${(a - b).toFixed(3)} (A−B); the grain is worth ${(a - c).toFixed(3)} (A−C); ` +
          `with neither drawn the screen reads ${f3(d)} against a floor of 0.501.`
      );
      console.log(
        `[attribute] room alone would ${c >= 0.501 ? "CLEAR" : "MISS"} the floor (${f3(c)}); ` +
          `grain alone would ${b >= 0.501 ? "CLEAR" : "MISS"} it (${f3(b)}).`
      );
    }
  }

  /* -------------------------------------------------------------- crosscheck */
  /**
   * Does the camera disturb the thing it is photographing?
   *
   * The honest sampler captures five times a second where the old one managed
   * about once, and each capture costs the browser process ~170ms of PNG
   * encoding. If that competes with the renderer, the page animates less than it
   * otherwise would and the figure comes out *low* — a new lie, in the opposite
   * direction from the one being fixed, and exactly the sort of thing that gets
   * noticed two waves later.
   *
   * So the same route is measured a second way, by a method whose cost lands
   * somewhere else entirely: a `Page.startScreencast` reel, which the browser
   * pushes when the compositor produces a frame and which stamps each frame with
   * its own capture time. Pairs of reel frames 200±25ms apart are differenced
   * with the identical arithmetic. The two methods share no capture path and no
   * clock, so agreement between them is evidence and disagreement is a lead.
   */
  if (mode === "crosscheck") {
    const route = argv[1] ?? "lobby";
    const { seedPlayedAccount } = await import("./lib/account.mjs");
    await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(5000);

    const sample = await createIdleSampler(page, { lagMs: 200 });
    const active = await sample({ seconds: 4 });
    console.log(
      `[active capture] n=${active.n} min=${f3(active.min)} median=${f3(active.median)} max=${f3(active.max)}  ` +
        `${gridNote(active)}`
    );

    const cdp = await page.context().newCDPSession(page);
    const reel = [];
    let filming = true;
    cdp.on("Page.screencastFrame", (f) => {
      if (filming) reel.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "png",
      everyNthFrame: 1,
      maxWidth: VW,
      maxHeight: VH,
    });
    await page.waitForTimeout(9000);
    filming = false;
    await cdp.send("Page.stopScreencast").catch(() => {});
    reel.sort((a, b) => a.t - b.t);

    const pairs = [];
    for (let i = 0; i < reel.length; i += 1) {
      let best = -1;
      let bestErr = Infinity;
      for (let j = i + 1; j < reel.length; j += 1) {
        const err = Math.abs(reel[j].t - reel[i].t - 200);
        if (err < bestErr) {
          bestErr = err;
          best = j;
        }
        if (reel[j].t - reel[i].t > 260) break;
      }
      if (best > 0 && bestErr <= 25) pairs.push([i, best]);
      if (pairs.length >= 24) break;
    }
    const ds = [];
    const lags = [];
    for (const [i, j] of pairs) {
      ds.push(
        meanDelta(decodePng(Buffer.from(reel[i].data, "base64")), decodePng(Buffer.from(reel[j].data, "base64")))
      );
      lags.push(reel[j].t - reel[i].t);
    }
    if (!ds.length) {
      console.log("[screencast] no frame pair landed within 25ms of a 200ms lag — no cross-check available");
    } else {
      const s = quantiles(ds);
      const l = quantiles(lags);
      console.log(
        `[screencast]     n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}  ` +
          `achieved lag median ${l.median.toFixed(0)}ms (${l.min.toFixed(0)}–${l.max.toFixed(0)}) over ${reel.length} frames`
      );
      const ratio = active.median / s.median;
      console.log(
        `\n[crosscheck] two capture paths, one subject: ${f3(active.median)} vs ${f3(s.median)} ` +
          `(ratio ${ratio.toFixed(2)}). ` +
          (Math.abs(ratio - 1) < 0.2
            ? "AGREE — five captures a second is not slowing the page it measures."
            : "!! DISAGREE — one of these two paths is disturbing the subject; do not quote either.")
      );
    }
  }

  /* ------------------------------------------------------------------ replay */
  /**
   * Replay the reference set into the browser and photograph it back out.
   *
   * The frames are 1920x1080 and the sweep runs at 1600x900, so they are
   * **cropped** rather than scaled: a crop is the identical pixels, and a scale
   * is a resampler nobody has validated sitting between the reference and the
   * measurement. The offline side crops to exactly the same window, so "which
   * frame is this?" is answered against the same bytes the browser is showing.
   */
  if (mode === "replay") {
    const COUNT = Number(flag("frames", 40));
    const grid = referenceGrid();
    const picked = grid.files.slice(0, COUNT);
    const ox = Math.floor((1920 - VW) / 2);
    const oy = Math.floor((1080 - VH) / 2);

    const crop = (img) => {
      const out = new Uint8Array(VW * VH * 3);
      for (let y = 0; y < VH; y += 1) {
        const src = ((y + oy) * img.width + ox) * img.channels;
        if (img.channels === 3) {
          out.set(img.data.subarray(src, src + VW * 3), y * VW * 3);
        } else {
          for (let x = 0; x < VW; x += 1) {
            out[y * VW * 3 + x * 3] = img.data[src + x * 4];
            out[y * VW * 3 + x * 3 + 1] = img.data[src + x * 4 + 1];
            out[y * VW * 3 + x * 3 + 2] = img.data[src + x * 4 + 2];
          }
        }
      }
      return { width: VW, height: VH, channels: 3, data: out };
    };

    console.log(`[replay] cropping ${COUNT} reference frames to ${VW}x${VH} at (${ox},${oy})…`);
    const bytes = picked.map((f) => readFileSync(path.join(FRAMES_DIR, f.file)));
    const truth = bytes.map((b) => crop(decodePng(b)));
    const own = [];
    for (let i = 1; i < truth.length; i += 1) own.push(meanDelta(truth[i - 1], truth[i]));
    const ownStats = quantiles(own);
    console.log(
      `[replay] these ${COUNT} crops, offline, at 200ms: n=${ownStats.n} min=${f3(ownStats.min)} ` +
        `median=${f3(ownStats.median)} max=${f3(ownStats.max)}   <- what a 200ms sampler must return`
    );

    await page.route("**/__hsframe/*", (route) => {
      const n = Number(/__hsframe\/(\d+)\.png/.exec(route.request().url())?.[1] ?? 0);
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: bytes[n],
      });
    });
    await page.route("**/__hsreplay", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body:
          `<!doctype html><meta charset=utf-8><title>replay</title>` +
          `<style>html,body{margin:0;background:#000;overflow:hidden;width:${VW}px;height:${VH}px}` +
          `img{position:absolute;left:${-ox}px;top:${-oy}px;display:none;image-rendering:pixelated}` +
          `img.on{display:block}</style>` +
          Array.from({ length: COUNT }, (_, i) => `<img id=f${i} src="/__hsframe/${i}.png">`).join("") +
          `<script>
             const imgs=[...document.querySelectorAll('img')];
             window.__ready=Promise.all(imgs.map(i=>i.decode())).then(()=>{window.__decoded=true});
             window.__slot=-1;
             window.__start=()=>{const t0=performance.now();
               const tick=()=>{const s=Math.min(${COUNT - 1},Math.floor((performance.now()-t0)/200));
                 if(s!==window.__slot){imgs[window.__slot]?.classList.remove('on');
                   imgs[s].classList.add('on');window.__slot=s;}
                 requestAnimationFrame(tick);};
               tick();};
           </script>`,
      })
    );
    await page.goto(`${ORIGIN}/__hsreplay`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__decoded === true, null, {
      timeout: 120000,
    });
    console.log(`[replay] ${COUNT} frames decoded in the renderer; starting the 200ms cadence`);

    /** Which reference frame is this capture showing? Nearest by the same metric. */
    const identify = (img) => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < truth.length; i += 1) {
        const d = meanDelta(truth[i], img);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return { frame: best, d: bestD };
    };

    // --- the new sampler, instrumented to keep its buffers for identification
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.captureScreenshot", {
      format: "png",
      optimizeForSpeed: true,
    });
    await page.evaluate(() => window.__start());
    await page.waitForTimeout(400);
    const newShots = [];
    const newStarts = [];
    {
      const t0 = performance.now();
      for (let k = 0; k * 200 < 3000; k += 1) {
        newStarts.push(performance.now());
        const r = await cdp.send("Page.captureScreenshot", {
          format: "png",
          optimizeForSpeed: true,
        });
        newShots.push(Buffer.from(r.data, "base64"));
        const rest = t0 + (k + 1) * 200 - performance.now();
        if (rest > 0) await new Promise((res) => setTimeout(res, rest));
      }
    }

    // --- the old loop, on the same page, restarted so it sees the same cadence
    await page.evaluate(() => window.__start());
    await page.waitForTimeout(400);
    const oldShots = [];
    const oldStarts = [];
    for (let i = 0; i * 0.2 < 3; i += 1) {
      oldStarts.push(performance.now());
      oldShots.push(await page.screenshot());
      await page.waitForTimeout(200);
    }

    const report = (label, shots, starts) => {
      const imgs = shots.map((b) => decodePng(b));
      const ids = imgs.map(identify);
      const gaps = starts.slice(1).map((t, i) => t - starts[i]);
      const steps = ids.slice(1).map((r, i) => r.frame - ids[i].frame);
      const ds = [];
      /**
       * The offline delta for the very frames this run turned out to photograph,
       * rather than for the whole reference set.
       *
       * Comparing a fifteen-tick window against the 203-pair published median is
       * how a correct sampler gets accused of being wrong: frames 2–16 are a
       * quiet stretch of the match and read 0.99 where the set as a whole reads
       * 1.71. Both numbers are right. Only the pairwise one is an *assertion*,
       * and it is the tight one — if the capture path is lossless and the grid is
       * real, measured and offline agree to zero.
       */
      const pairwise = [];
      for (let i = 1; i < imgs.length; i += 1) {
        ds.push(meanDelta(imgs[i - 1], imgs[i]));
        pairwise.push(meanDelta(truth[ids[i - 1].frame], truth[ids[i].frame]));
      }
      const s = quantiles(ds);
      const g = quantiles(gaps);
      const st = quantiles(steps);
      const worstPair = Math.max(...ds.map((d, i) => Math.abs(d - pairwise[i])));
      console.log(
        `\n[${label}] wall-clock gap median ${g.median.toFixed(0)}ms (${g.min.toFixed(0)}–${g.max.toFixed(0)})`
      );
      console.log(`[${label}] frames seen : ${ids.map((r) => r.frame).join(" ")}`);
      console.log(
        `[${label}] frames advanced per tick: ${steps.join(" ")}  -> median ${st.median} reference frames ` +
          `= ${st.median * 200}ms of subject time`
      );
      console.log(
        `[${label}] identification confidence: worst match ${f3(Math.max(...ids.map((r) => r.d)))} ` +
          `(0 = the capture is that reference frame exactly)`
      );
      console.log(
        `[${label}] delta n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}   ` +
          `same pairs offline: median ${f3(quantiles(pairwise).median)}, worst disagreement ${worstPair.toFixed(6)}`
      );
      console.log(
        `[${label}] whole reference set at ${st.median * 200}ms for scale: ` +
          `median ${f3(referenceAtLag(st.median * 200 || 200)?.median)}`
      );
      return { s, st, g };
    };

    const a = report("new 200ms sampler", newShots, newStarts);
    const b = report("old screenshot loop", oldShots, oldStarts);
    console.log(
      `\n[replay] VERDICT: the new sampler advances ${a.st.median} reference frame(s) per tick ` +
        `(${a.st.median === 1 ? "a true 200ms grid" : "NOT a 200ms grid"}); ` +
        `the old loop advances ${b.st.median} (${b.st.median * 200}ms of subject time per "200ms" tick).`
    );
  }
} finally {
  await browser.close();
}
