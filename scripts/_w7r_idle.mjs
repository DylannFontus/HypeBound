/**
 * How alive a screen is when nobody is touching it.
 *
 * AAA bar §3 says "idle is never dead", and that requirement is invisible in a
 * still. The number this prints is the one the brief is written against: the
 * **median mean-absolute pixel delta between two frames 200ms apart**, on a
 * 0–255 scale, over a settled screen with no input. Hearthstone's own floor is
 * 1.71 and never reaches zero; this game's lobby is 3.01 and its board 5.47.
 *
 * ## Why a CDP screencast and not `page.screenshot`
 *
 * `page.screenshot` forces a fresh raster of the page and waits for it. If the
 * main thread is blocked it blocks with it, which means the one thing it can
 * never photograph is a stall — and worse, taking a screenshot is itself a
 * compositor event, so a burst of screenshots on a dead page can manufacture
 * differences that a player would never see. `Page.startScreencast` is passive:
 * Chrome pushes a frame **when it composites one**, which is exactly the signal
 * being measured. Nothing here asks the page for anything.
 *
 * ## Real 200ms pairs, plus a separate dead-window count
 *
 * Two traps sit on either side of this measurement and the estimator has to
 * dodge both. Diffing *consecutive delivered frames* flatters a dead page
 * enormously, because the screencast emits nothing when nothing changes and two
 * frames four seconds apart then get compared as though they were 200ms apart.
 * Holding the last delivered frame at each 200ms tick fixes that and introduces
 * the opposite bias, because delivery is throttled by a CDP round trip on a
 * megabyte PNG and runs at 12–25fps whatever the page is doing — so the held
 * frame is up to 70ms stale and the reading tracks the transport. It did:
 * `#settings` read 2.024 and 2.697 on two runs of the same build minutes apart,
 * and the difference was 186 delivered frames against 114.
 *
 * So deltas are taken between frames whose own timestamps are 200±45ms apart and
 * nothing else is used, while the dead-page question is answered separately by
 * counting the 200ms windows that received no new frame at all and scoring each
 * one a hard zero. `see pairsOf`. The Hearthstone reference is unaffected either
 * way: those frames are exactly 0.2s apart.
 *
 * ## PNG, not JPEG
 *
 * The interesting readings are between 0.2 and 3.0 on a 0–255 scale. JPEG
 * quantisation noise on a neon gradient is comfortably larger than that, so a
 * JPEG screencast would measure its own encoder and report every screen as
 * "alive". PNG is lossless and the delta of two identical frames is exactly 0.
 * `--selftest` proves that rather than assuming it.
 *
 * ## Decoding
 *
 * Node has no image library here and is not getting one. A second, otherwise
 * empty browser page does the decode and the arithmetic in a canvas — the same
 * trick `_w4b_diff.mjs` uses. It is a different page from the one under test, so
 * the measurement cannot perturb the measurement.
 *
 * usage:
 *   node scripts/_w7r_idle.mjs lobby stats profile
 *   node scripts/_w7r_idle.mjs --selftest          validate the instrument first
 *   node scripts/_w7r_idle.mjs stats --frozen      control: all animation paused
 *   node scripts/_w7r_idle.mjs stats --secs 8 --size 1600x900
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);
const routes = argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);

const ORIGIN = "http://localhost:5173";
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const SECS = Number(flag("secs", 6));
const TICK = Number(flag("tick", 200));
const SETTLE = Number(flag("settle", 2600));

/** The same flags `shot.mjs` validated: permit SwiftShader, never force it. */
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

/** The arithmetic page. Never navigated anywhere; only ever decodes data URIs. */
const maths = await browser.newPage();
await maths.goto("data:text/html,<title>maths</title>");

/**
 * Mean absolute per-channel delta between two PNG data URIs, 0–255.
 *
 * Alpha is ignored: a screencast frame is always opaque, and including it would
 * halve every reading for no reason. The two images are asserted to be the same
 * size — a resize mid-capture would otherwise silently compare a 1600px row
 * against a 1584px one and report a screen full of motion.
 */
async function meanDelta(a, b) {
  return maths.evaluate(async ([sa, sb]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return -1;
    const w = ia.width;
    const h = ia.height;
    const px = (img) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = px(ia);
    const db = px(ib);
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) {
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return sum / (w * h * 3);
  }, [a, b]);
}

/**
 * Record a passive screencast of whatever is currently on `page`.
 *
 * Returns the raw frames with the timestamps Chrome attached to them, plus how
 * many distinct images arrived — which is the instrument's own liveness check.
 * A screencast that delivered four frames in six seconds and a screencast that
 * delivered four hundred are very different situations and a median hides both.
 */
async function screencast(page, ms) {
  const client = await page.context().newCDPSession(page);
  const frames = [];
  client.on("Page.screencastFrame", async (ev) => {
    frames.push({ t: (ev.metadata.timestamp ?? 0) * 1000, data: ev.data });
    try {
      await client.send("Page.screencastFrameAck", { sessionId: ev.sessionId });
    } catch {
      /* the cast was stopped between the push and the ack */
    }
  });
  await client.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, ms));
  await client.send("Page.stopScreencast");
  await client.detach();
  return frames;
}

/**
 * Pair up delivered frames that are genuinely ~200ms apart.
 *
 * The first version of this held the last delivered frame at each 200ms tick —
 * "what was on screen at time t", which is what the eye does — and it had a bias
 * big enough to invalidate a comparison. `Page.screencastFrameAck` gates the
 * next frame on a round trip, and a full-size PNG of a 1600×900 viewport is
 * upwards of a megabyte, so delivery runs at 12–25fps regardless of what the
 * page is doing. At 14fps the held frame is up to 71ms stale, the *actual*
 * interval between two held frames wanders between about 130 and 270ms, and the
 * measured delta wanders with it. Measured, same build, same routes, minutes
 * apart: `#settings` read 2.024 on a run that delivered 186 frames and 2.697 on
 * one that delivered 114. **The instrument was reporting its own transport.**
 *
 * So the interval is now taken from Chrome's own frame timestamps rather than
 * assumed. For each frame, the partner closest to +200ms is found, and the pair
 * is used only if it lands within 45ms of the target. Everything else is
 * discarded rather than stretched, because a delta over 260ms is not a 200ms
 * delta and no amount of scaling makes it one — grain saturates, so the relation
 * between displacement and delta is not linear and cannot be normalised.
 *
 * `hearthstone_frames/` is unaffected by any of this: those frames are exactly
 * 0.2s apart, so the pairing is the identity and the 1.713 calibration still
 * means what it meant.
 *
 * The dead-page detector is kept separately, because pairing alone cannot see a
 * stall: a page that composites nothing delivers no frames, produces no pairs,
 * and would report "no samples", which reads as a pass to anyone skimming. Every
 * 200ms window of the capture that received **no new frame at all** is counted
 * and scored as a hard zero, so a frozen screen still reports a median of 0 over
 * a full set of samples rather than an empty table.
 */
function pairsOf(frames, tickMs, spanMs, toleranceMs = 45) {
  const out = { pairs: [], dead: 0, windows: 0, gaps: [] };
  if (frames.length === 0) return out;
  const t0 = frames[0].t;

  for (let i = 0; i < frames.length; i++) {
    const target = frames[i].t + tickMs;
    let best = -1;
    let bestErr = Infinity;
    for (let j = i + 1; j < frames.length; j++) {
      const err = Math.abs(frames[j].t - target);
      if (err < bestErr) {
        bestErr = err;
        best = j;
      } else if (frames[j].t > target) break;
    }
    if (best >= 0 && bestErr <= toleranceMs) {
      out.pairs.push([frames[i].data, frames[best].data]);
      out.gaps.push(frames[best].t - frames[i].t);
    }
  }

  for (let t = 0; t < spanMs; t += tickMs) {
    out.windows += 1;
    const fresh = frames.some((f) => f.t - t0 > t && f.t - t0 <= t + tickMs);
    if (!fresh) out.dead += 1;
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function measure(page, label, spanMs = SECS * 1000) {
  const frames = await screencast(page, spanMs + 400);
  const { pairs, dead, windows, gaps } = pairsOf(frames, TICK, spanMs);

  /**
   * A cap on how many pairs get decoded, evenly spread over the capture.
   *
   * At 20fps a ten-second window offers about 190 usable pairs and each one
   * costs two full-frame canvas decodes. Sixty is comfortably enough for a
   * median and keeps a twelve-route sweep inside a few minutes; taking every
   * nth rather than the first sixty matters because the first three seconds of
   * any capture are the least representative part of it.
   */
  const step = Math.max(1, Math.ceil(pairs.length / 60));
  const deltas = [];
  for (let i = 0; i < pairs.length; i += step) {
    const [a, b] = pairs[i];
    const d = await meanDelta(`data:image/png;base64,${a}`, `data:image/png;base64,${b}`);
    if (d >= 0) deltas.push(d);
  }
  /** Every window that composited nothing is a real zero and is counted as one. */
  for (let i = 0; i < dead; i++) deltas.push(0);

  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const row = {
    label,
    median: median(deltas),
    min: deltas.length ? Math.min(...deltas) : 0,
    max: deltas.length ? Math.max(...deltas) : 0,
    dead,
    windows,
    samples: deltas.length,
    delivered: frames.length,
    gap: meanGap,
  };
  console.log(
    `${label.padEnd(26)} median ${row.median.toFixed(3).padStart(7)}   ` +
      `min ${row.min.toFixed(3).padStart(7)}   max ${row.max.toFixed(3).padStart(7)}   ` +
      `dead ${String(dead).padStart(2)}/${String(windows).padStart(2)} windows   ` +
      `n=${String(deltas.length).padStart(3)} @ ${meanGap.toFixed(0)}ms   ` +
      `delivery ${(frames.length / (spanMs / 1000)).toFixed(0).padStart(3)}fps`
  );
  return row;
}

// ---------------------------------------------------------------------------
// Self-test: prove the instrument before believing a single reading
// ---------------------------------------------------------------------------

/**
 * Four controls, chosen so that each one can only fail for one reason.
 *
 * **Dead** is a static page. It must read exactly 0 across a full set of ticks.
 * Anything else means the screencast, the PNG path or the canvas decode is
 * manufacturing difference, and every number the instrument prints is that noise
 * floor plus the truth. The tick count is asserted too, because "0.000 over zero
 * samples" is not a measurement and has been mistaken for one before.
 *
 * **Known** is a 1200px-wide white bar translating 240px across a 1600×900 black
 * field every 2s, linear. Between two ticks 200ms apart it moves 24px, so 24
 * columns turn white→black at the trailing edge and 24 turn black→white at the
 * leading edge. Every changed pixel moves the full 255 on all three channels, so
 * the mean over the frame is
 *
 *     48 columns × 900 rows × 255  /  (1600 × 900)  =  7.650
 *
 * independent of channel count, since the divisor carries the same ×3. The
 * expected value is therefore **7.650** and the instrument must land on it. The
 * first run of this self-test asserted 2.55 — the author had divided by three
 * twice — and the instrument read 7.651. The instrument was right and the
 * expectation was wrong, which is the only reason this note exists: a calibration
 * control is worth nothing unless its expected value is derived rather than
 * copied from whatever the code happened to print.
 *
 * **Jammed** starts the cast, lets it run, then jams the renderer's main thread
 * with a 2.5s busy loop. `page.screenshot` cannot return across that. This must:
 * deliver no frames while the thread is jammed, score those ticks as dead rather
 * than skipping them, and come back. It is checked for *returning*, not for
 * returning on time — Chrome will not acknowledge `stopScreencast` until the
 * renderer is free again, and a instrument that waits is honest where one that
 * times out and reports a partial window is not.
 *
 * **Blind** is the control for the failure that actually happened to a previous
 * A/B compositor: an instrument that reports numbers for a region it is not
 * looking at. Two visibly different pages must not compare equal.
 */
async function selftest() {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });

  await page.goto(`data:text/html,<body style="margin:0;background:%23101018">`);
  const dead = await measure(page, "control: static page", 2000);

  await page.goto(
    "data:text/html," +
      encodeURIComponent(
        `<body style="margin:0;background:#000;overflow:hidden">
         <div style="width:1200px;height:900px;background:#fff;
           animation:s 2s linear infinite"></div>
         <style>@keyframes s{from{transform:translateX(0)}to{transform:translateX(240px)}}</style>`
      )
  );
  await page.waitForTimeout(300);
  const known = await measure(page, "control: 24px/tick bar", 4000);

  await page.goto(`data:text/html,<body style="margin:0;background:%23101018">`);
  setTimeout(() => {
    page
      .evaluate(() => {
        const end = Date.now() + 2500;
        while (Date.now() < end) {
          /* jam the renderer's main thread */
        }
      })
      .catch(() => {});
  }, 700);
  const t = Date.now();
  const jammed = await measure(page, "control: main thread jammed", 3000);
  const took = Date.now() - t;

  /** Two solid fills 16/255 apart: the delta is exactly 16 or the maths is blind. */
  await page.goto(`data:text/html,<body style="margin:0;background:%23202020">`);
  await page.waitForTimeout(200);
  const one = (await screencast(page, 500)).at(-1);
  await page.goto(`data:text/html,<body style="margin:0;background:%23303030">`);
  await page.waitForTimeout(200);
  const two = (await screencast(page, 500)).at(-1);
  const blind = await meanDelta(`data:image/png;base64,${one.data}`, `data:image/png;base64,${two.data}`);

  await page.close();

  const verdicts = [
    [
      dead.median === 0 && dead.max === 0 && dead.samples >= 9,
      `static page reads exactly 0 over ${dead.samples} windows (max ${dead.max.toFixed(4)})`,
    ],
    [
      Math.abs(known.median - 7.65) < 0.05,
      `24px/tick bar reads ${known.median.toFixed(3)} against 7.650 derived by hand`,
    ],
    [
      jammed.dead >= 8 && jammed.samples >= 14,
      `a jammed renderer scores ${jammed.dead}/${jammed.windows} windows dead and the probe returned (${took}ms)`,
    ],
    [Math.abs(blind - 16) < 0.5, `#202020 vs #303030 reads ${blind.toFixed(3)} against 16 exactly`],
  ];
  console.log("");
  for (const [ok, why] of verdicts) console.log(`  ${ok ? "PASS" : "FAIL"}  ${why}`);
  console.log("");
  return verdicts.every(([ok]) => ok);
}

// ---------------------------------------------------------------------------

if (has("selftest")) {
  const ok = await selftest();
  await browser.close();
  process.exit(ok ? 0 : 1);
}

const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.on("pageerror", (e) => console.log(`  ! pageerror: ${e.message}`));
if (has("raw")) await page.goto(ORIGIN, { waitUntil: "networkidle" });
else await seedPlayedAccount(page, ORIGIN);

const rows = [];
for (const route of routes) {
  const battle = route.startsWith("battle") || has("battle");
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "load" });
  if (battle) {
    await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    await page.click(".mulligan-panel button.btn-primary").catch(() => {});
  }
  await page.waitForTimeout(SETTLE);
  /**
   * An arbitrary probe, for attribution rather than for a score.
   *
   * A median that does not move after a change has two explanations — the change
   * does not move pixels, or it moves pixels nobody can see — and they call for
   * opposite fixes. `--eval "…"` lets a run hide the content and read the room
   * on its own, which distinguishes them in one measurement instead of an
   * afternoon of guessing.
   */
  const js = flag("eval", null);
  if (js) {
    await page.evaluate(String(js));
    await page.waitForTimeout(500);
  }
  if (has("frozen")) {
    await page.evaluate(() => {
      for (const a of document.getAnimations()) a.pause();
      const kill = document.createElement("style");
      kill.textContent = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
      document.head.append(kill);
    });
    await page.waitForTimeout(400);
  }
  /**
   * A throwaway capture first, and the reading taken from the second.
   *
   * This is the third and last bias found in this instrument, and it is the
   * nastiest because it inflates rather than deflates. Encoding a full-size PNG
   * per frame competes with the renderer, and on a cold page the competition is
   * won by the encoder: delivery falls to about 20fps and the *compositor* falls
   * with it, so a pair of frames whose timestamps are 200ms apart can hold 400ms
   * of animation. Measured on `#settings`, same build, one process: 1.479 on a
   * run that delivered 432 frames in 20s, then 0.587 and 0.588 on the next two,
   * which delivered 1364 and 1425. A separate probe (`_w7r_glass.mjs`) confirmed
   * the animated layer was present, opaque and running on all three, so the page
   * was not the variable.
   *
   * The warm run is the true one and the delivery rate is printed beside every
   * reading so the claim can be checked rather than trusted. Anything under
   * about 40fps of delivery should be treated as an upper bound, not a value.
   */
  await measure(page, `  (warm-up, discarded)`, Math.min(2500, SECS * 1000));
  rows.push(await measure(page, `#${route}${has("frozen") ? " (frozen)" : ""}`));
}

await browser.close();
