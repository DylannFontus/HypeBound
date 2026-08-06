/**
 * One idle metric, on a grid that is provably the grid it claims to be.
 *
 * ## The lie this file was written to end
 *
 * Instrument eleven in this project's list, and the first whose error reached a
 * committed test. `_w7rw_probe.mjs::idle` and `_w8room_sweep.mjs::idleAt` both
 * sampled a screen at rest like this:
 *
 *     shots.push(decodePng(await page.screenshot()));
 *     await page.waitForTimeout(200);
 *
 * and then compared the answer to a floor written **per 200ms**. Both had
 * calibrated their *arithmetic* against `hearthstone_frames/` and got the
 * published n=203 / min 0.501 / median 1.713 back, so both believed they were
 * calibrated. Neither had calibrated the *grid*. Measured on this machine, one
 * `page.screenshot()` at 1600x900 costs a median of 691ms and `decodePng` a
 * further 64ms, so the loop above achieves a median start-to-start gap of
 * **843ms** — the label was out by a factor of 4.2, in the direction that
 * flatters. A slow breathe moves four times as far in 843ms as in 200ms, so
 * every idle figure that path ever published was an 843ms number wearing a 200ms
 * badge. Calibrating a metric is not calibrating a sample interval.
 *
 * 843ms is this machine on a day with three other builders' browsers on it, and
 * the exact figure is not the point: the loop had **no budget for the capture at
 * all**, so its interval was `200ms + whatever the camera took`, on any machine.
 * A ten-times-faster computer would have run it at 260ms and published a 30%
 * error instead of a 320% one, and nothing in the output would have said which.
 * That is why the fix below is "publish the achieved interval" and not "make the
 * capture faster" — the second is a mitigation and the first is a measurement.
 *
 * ## What is done about it
 *
 * Three things, and the third is the one that matters.
 *
 * 1. **The capture got cheap enough for the grid to exist.** Playwright's
 *    `page.screenshot()` and CDP's plain `Page.captureScreenshot` both spend
 *    most of their time in maximum-compression PNG encoding, which this has no
 *    use for — the bytes are decoded and thrown away microseconds later.
 *    `optimizeForSpeed: true` is the same lossless PNG at a cheaper zlib level:
 *    169ms median instead of 691ms, byte-identical pixels (asserted by
 *    `_w9grid.mjs pixels`). That leaves room to sleep the remainder of the
 *    period rather than sleeping a whole period on top of the capture.
 *
 * 2. **The remainder is what is slept.** Each capture is scheduled one period
 *    after the *previous capture began*, so the camera's cost comes out of the
 *    sleep rather than being added to it. Not an absolute `t0 + k·lag`
 *    schedule, which is what the first version did and which made the loop
 *    sprint to catch up after one slow capture — `#lobby` came back at 159ms.
 *
 *
 * 3. **The achieved grid is measured, published beside every figure, and is a
 *    hard gate.** `sample()` returns `grid`, and a run whose achieved median gap
 *    is more than 8% off the nominal is marked `onGrid: false` and its numbers
 *    must not be compared to any floor. This is the part that would have caught
 *    instrument eleven on the day it was written: the old loop would have come
 *    back `onGrid: false, achieved 843ms` rather than a confident 0.9.
 *
 * ## Why the reference is a function of the lag, and not a constant
 *
 * `hearthstone_frames/` is 204 frames of real gameplay whose filenames carry
 * their own timestamps — `frame_00042_t00008.40s.png` — and those timestamps are
 * exactly 0.200s apart, which is the only reason a "per 200ms" floor was ever
 * meaningful. `referenceAtLag()` differences frames k apart to give the same
 * reference on a 400, 600 or 800ms grid, because the honest way to state what
 * the old figures were worth is to compare them to the floor **at the interval
 * they were actually taken on**. It rises steeply: the floor is not a property
 * of a screen, it is a property of a screen and a stopwatch together.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FRAMES_DIR = path.join(HERE, "..", "..", "hearthstone_frames");

/**
 * Mean absolute per-channel delta.
 *
 * Character for character the routine every published figure in this project
 * was produced with — `_ic6_calib.mjs`, `_w7rw_probe.mjs`, `_w8room_sweep.mjs`.
 * It is exported rather than copied so that the next probe cannot quietly drift
 * a `+= 4` into a `+= a.channels` and produce numbers on a private scale.
 */
export function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < n; i += a.channels) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

export const quantiles = (values) => {
  const s = [...values].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: q(0),
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
};

export const f3 = (x) => (x === undefined || x === null || Number.isNaN(x) ? "    -" : x.toFixed(3).padStart(5));

/**
 * The reference set with its own clock read off its own filenames.
 *
 * Nobody has ever checked this, and the entire meaning of "per 200ms" rests on
 * it. If a frame is missing from the middle of the sequence the remaining
 * neighbours are 400ms apart and the published floor is silently a 400ms floor.
 */
export function referenceGrid(dir = FRAMES_DIR) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  const stamped = files.map((f) => {
    const m = /frame_(\d+)_t(\d+\.\d+)s\.png$/.exec(f);
    return { file: f, index: m ? Number(m[1]) : null, t: m ? Number(m[2]) * 1000 : null };
  });
  const gaps = [];
  for (let i = 1; i < stamped.length; i += 1) {
    if (stamped[i].t === null || stamped[i - 1].t === null) continue;
    gaps.push(stamped[i].t - stamped[i - 1].t);
  }
  const unique = [...new Set(gaps.map((g) => Math.round(g)))];
  return { files: stamped, n: stamped.length, gaps: unique, uniform: unique.length === 1, stepMs: unique[0] ?? null };
}

/**
 * The reference distribution on a grid of `lagMs`, which must be a whole number
 * of reference steps.
 *
 * Streams through the directory with a ring buffer of k+1 decoded frames rather
 * than holding all 204: at 1920x1080x3 the whole set is 1.27GB, which is how a
 * calibration ends up being run once and never again.
 */
export function referenceAtLag(lagMs, dir = FRAMES_DIR, crop = null) {
  const grid = referenceGrid(dir);
  if (!grid || !grid.uniform) return null;
  const k = Math.round(lagMs / grid.stepMs);
  if (k < 1 || Math.abs(k * grid.stepMs - lagMs) > 1) return null;
  const ring = new Array(k + 1).fill(null);
  const deltas = [];
  grid.files.forEach((entry, i) => {
    const img = crop
      ? cropTo(decodePng(readFileSync(path.join(dir, entry.file))), crop)
      : decodePng(readFileSync(path.join(dir, entry.file)));
    ring[i % (k + 1)] = img;
    const older = ring[(i + 1) % (k + 1)];
    if (i >= k && older) deltas.push(meanDelta(older, img));
  });
  return { ...quantiles(deltas), lagMs: k * grid.stepMs, steps: k };
}

/**
 * A centred crop, never a scale.
 *
 * The reference frames are 1920x1080 and the sweep runs at 1600x900, and the
 * floor has been quoted across that gap since the first wave without anybody
 * checking whether it survives the trip. Checking it means putting the two on
 * the same canvas, and there are only two ways: resample the reference, or take
 * a window of it. Resampling puts an unvalidated filter between the reference
 * and the number — and a box filter over a grain field averages the grain away,
 * which would lower the reference and make our screens look better, which is
 * the wrong direction for a mistake. A crop is the identical pixels of a real
 * frame, so `_w9grid.mjs ref --crop 1600x900` answers the question without
 * introducing a second one.
 */
export function cropTo(img, { width, height }) {
  const ox = Math.max(0, Math.floor((img.width - width) / 2));
  const oy = Math.max(0, Math.floor((img.height - height) / 2));
  const w = Math.min(width, img.width);
  const h = Math.min(height, img.height);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const src = ((y + oy) * img.width + ox) * img.channels;
    if (img.channels === 3) {
      out.set(img.data.subarray(src, src + w * 3), y * w * 3);
    } else {
      for (let x = 0; x < w; x += 1) {
        out[y * w * 3 + x * 3] = img.data[src + x * 4];
        out[y * w * 3 + x * 3 + 1] = img.data[src + x * 4 + 1];
        out[y * w * 3 + x * 3 + 2] = img.data[src + x * 4 + 2];
      }
    }
  }
  return { width: w, height: h, channels: 3, data: out };
}

/**
 * A capture cheap enough that the interval can be the interval.
 *
 * `optimizeForSpeed` is a zlib level, not a colour transform — the PNG is still
 * lossless and still colour type 2, which `lib/png.mjs` is the only decoder for.
 * `_w9grid.mjs pixels` asserts the two encoders agree byte for byte on a frozen
 * page, because a "fast" capture that quietly resampled would be instrument
 * twelve rather than the cure for eleven.
 */
async function grab(cdp, timeoutMs) {
  const shot = cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  const bail = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const got = await Promise.race([shot.catch(() => null), bail]);
  return got ? Buffer.from(got.data, "base64") : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sample a screen at rest on a grid this returns the measurement of.
 *
 * The contract is the whole point: **no caller may quote a delta without also
 * quoting `grid.median`**, and `onGrid` is false whenever the loop failed to
 * hold the interval it was asked for. A route that is genuinely too expensive to
 * capture at 200ms then says so, instead of reporting a number from a slower
 * clock as though it were a fast one.
 *
 * One capture is thrown away when the sampler is created and one more at the
 * top of every call, because the first capture of a session and the first
 * capture on a freshly-arrived screen are both reliably 100–300ms slower than
 * the fourteen that follow. Taken inside the grid, either one puts the whole run
 * behind schedule before it has started.
 *
 * The obvious worry about capturing five times a second rather than once is
 * that the camera slows the subject — a new lie in the opposite direction.
 * `_w9grid.mjs crosscheck` answers it by measuring the same route a second way,
 * through a screencast reel whose cost lands in the browser's own pipeline
 * rather than in a synchronous encode, and comparing the two medians.
 */
export async function createIdleSampler(page, { lagMs = 200, timeoutMs = 6000 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  // One discarded capture per session, so the encoder warm-up is not in a grid.
  await grab(cdp, timeoutMs).catch(() => null);

  return async function sample({ seconds = 3 } = {}) {
    const count = Math.max(2, Math.round((seconds * 1000) / lagMs) + 1);
    const grabs = [];
    let lost = 0;
    // One throwaway per route as well as per session. Arriving on a screen
    // leaves Chrome with a cold raster cache for it, and the first capture is
    // reliably 100–300ms slower than the fourteen that follow; taken inside the
    // grid it puts the whole run behind schedule before it starts.
    await grab(cdp, timeoutMs).catch(() => null);
    for (let k = 0; k < count; k += 1) {
      const started = performance.now();
      const buf = await grab(cdp, timeoutMs);
      const ended = performance.now();
      if (buf) grabs.push({ k, started, ended, buf });
      else lost += 1;
      /**
       * The next capture starts one period after *this* one started, not one
       * period after a fixed schedule.
       *
       * An absolute schedule looks tidier and is wrong: one slow capture puts
       * the loop behind, and it then sprints — issuing captures back to back
       * with no sleep at all — until it catches up. Measured on `#lobby`, that
       * produced a 159ms median grid, which is as far off 200ms as it is in the
       * other direction and would have under-reported instead of over. Anchoring
       * on the previous capture makes the interval `max(lag, capture)`: it can
       * be too slow, which is visible and refused, but it cannot silently
       * oscillate.
       */
      const rest = started + lagMs - performance.now();
      if (rest > 0) await sleep(rest);
    }

    /**
     * Only consecutive captures count. If capture seven was lost, six and eight
     * are two lags apart, and folding that pair in would be the same mistake at
     * a smaller scale — one long interval hiding inside a short-interval figure.
     */
    const deltas = [];
    const gaps = [];
    let previous = null;
    let previousImage = null;
    for (const g of grabs) {
      const img = decodePng(g.buf);
      if (previous && g.k === previous.k + 1) {
        deltas.push(meanDelta(previousImage, img));
        gaps.push(g.started - previous.started);
      }
      previous = g;
      previousImage = img;
    }
    const costs = grabs.map((g) => g.ended - g.started);
    const grid = gaps.length ? quantiles(gaps) : { n: 0, min: null, median: null, max: null };
    const drift = grid.median === null ? null : Math.abs(grid.median - lagMs) / lagMs;
    return {
      ...(deltas.length
        ? quantiles(deltas)
        : { n: 0, min: null, p10: null, median: null, p90: null, max: null, mean: null }),
      lost,
      lagMs,
      grid,
      captureMs: costs.length ? quantiles(costs) : { median: null },
      onGrid: drift !== null && drift <= 0.08,
      drift,
    };
  };
}

/** `n=15 med=0.812 @ grid 200ms (199–206)` — the one line every figure wears. */
export function gridNote(stats) {
  if (!stats || !stats.grid || stats.grid.median === null) return "no grid (nothing captured)";
  const { grid, lagMs, onGrid } = stats;
  return (
    `grid ${grid.median.toFixed(0)}ms (${grid.min.toFixed(0)}–${grid.max.toFixed(0)}) vs ${lagMs}ms asked` +
    (onGrid ? "" : "  !! OFF GRID — not comparable to any floor")
  );
}
