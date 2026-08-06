/**
 * Two questions about the arena, both asked of pixels rather than of opinions,
 * and both calibrated against `hearthstone_frames/frame_00060` on the same run.
 *
 * The brief says the mat is still a rectangle because *nothing crosses the
 * boundary in either direction*, and that the playfield interior is "a uniform
 * lavender hex field with one soft gradient". Those are two different claims and
 * they need two different instruments:
 *
 *   edge   Where does the play surface stop, column by column, and how far does
 *          that boundary run without anything interrupting it? A smooth analytic
 *          silhouette — a rounded rectangle, however large its radius — is a
 *          low-order curve, so a quadratic fitted through the *median* of the
 *          boundary explains almost all of it. Every prop, leaf, rock or spill
 *          that crosses the boundary shows up as a run of columns whose boundary
 *          is not on that curve. The number reported is therefore "the longest
 *          run of the silhouette the eye can follow without being interrupted",
 *          which is the thing frame 60 does not have and we do.
 *
 *   field  Is the interior one gradient? A 2-D quadratic is fitted to the block
 *          means of the interior and the residual is reported. A surface that a
 *          single quadratic explains *is* one soft gradient, whatever texture is
 *          drawn on top of it; a painted, lit and worn ground is not.
 *
 * ## What is calibrated, and it is the grid as well as the arithmetic
 *
 * Instrument eleven in this project got its arithmetic right and its **sample
 * interval** wrong. This one has no time axis at all — it reads a PNG that
 * `shot.mjs` already wrote — so its "grid" is spatial: the block size for
 * `field` and the column step for `edge`, both printed with every result, and
 * both checked by running the identical code over the reference frame. A number
 * from this file is only ever quoted next to the reference number produced by
 * the same invocation.
 */
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";

const argv = process.argv.slice(2);
const mode = argv[0] ?? "edge";

/* --------------------------------------------------------------- capture */

/**
 * A board capture that refuses to hand back a picture of something else.
 *
 * `shot.mjs --battle` wraps its mulligan click and both of its waits in
 * `.catch(() => {})`, which is the right call for a camera — a screenshot script
 * that exits non-zero on a slow frame is a screenshot script nobody runs — and
 * the wrong one for a measurement. Caught once during this work: the Confirm
 * click did not land, the script wrote a perfectly good PNG of the **mulligan
 * panel**, and the boundary and border-luminance numbers computed from it came
 * back as a 3.10:1 "improvement" that was really a comparison between a board
 * and a modal. That is the twelfth instrument on this project to answer a
 * narrower question than the one asked, and the only reason it did not survive
 * is that the PNG was opened and looked at.
 *
 * So this asserts, before writing anything: the mulligan is gone, the renderer's
 * canvas exists at full size, and the frame is not a flat fill. Any of the three
 * failing is a non-zero exit and no file.
 */
if (mode === "board") {
  const { chromium } = await import("playwright-core");
  const { seedPlayedAccount } = await import("./lib/account.mjs");
  const { suppressHmrReload } = await import("./lib/nohmr.mjs");
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const CHROME = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => existsSync(p));
  const g = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : argv[i + 1];
  };
  const [vw, vh] = String(g("size", "1600x900")).split("x").map(Number);
  const dir = String(g("dir", path.join(HERE, "screenshots", "w9", "mat")));
  const out = path.join(dir, `${String(g("out", "board"))}.png`);
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("!! pageerror", e.message));
  try {
    await suppressHmrReload(page);
    await seedPlayedAccount(page, "http://localhost:5173");
    await page.goto("http://localhost:5173/?nointro#battle", { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
    await page.click(".mulligan-actions .btn-primary", { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
      timeout: 30000,
    });
    await page.waitForTimeout(Number(g("wait", 2200)));
    const state = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return {
        mulligan: Boolean(document.querySelector(".mulligan-panel")),
        canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      };
    });
    if (state.mulligan) throw new Error("still on the mulligan — the Confirm click did not land");
    if (!state.canvas || state.canvas[0] < vw * 0.5) throw new Error(`no full-size board canvas: ${JSON.stringify(state.canvas)}`);
    await page.screenshot({ path: out });
    // …and one last check on the pixels, because a canvas can be present and
    // black. A real board has a wide luminance spread; a cleared buffer does not.
    const img = decodePng(readFileSync(out));
    let lo = 255;
    let hi = 0;
    for (let y = 0; y < img.height; y += 7)
      for (let x = 0; x < img.width; x += 7) {
        const p = (y * img.width + x) * img.channels;
        const v = 0.2126 * img.data[p] + 0.7152 * img.data[p + 1] + 0.0722 * img.data[p + 2];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    if (hi - lo < 60) throw new Error(`the frame is nearly flat (L ${lo.toFixed(1)}..${hi.toFixed(1)}) — nothing rendered`);
    console.log(out);
    console.log(`[board] verified: no mulligan, canvas ${state.canvas.join("x")}, luminance ${lo.toFixed(1)}..${hi.toFixed(1)}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

const file = path.resolve(argv[1] ?? "");
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const nums = (s, d) => String(flag(s, d)).split(",").map(Number);

const img = decodePng(readFileSync(file));
const { width, height, channels, data } = img;
const L = (x, y) => {
  const i = ((y | 0) * width + (x | 0)) * channels;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
};

/** Least squares for y = a + bx + cx², on whatever points survive the trim. */
function quadFit(pts) {
  let n = 0, sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (const [x, y] of pts) {
    n += 1; sx += x; sx2 += x * x; sx3 += x ** 3; sx4 += x ** 4;
    sy += y; sxy += x * y; sx2y += x * x * y;
  }
  const A = [
    [n, sx, sx2, sy],
    [sx, sx2, sx3, sxy],
    [sx2, sx3, sx4, sx2y],
  ];
  for (let i = 0; i < 3; i += 1) {
    let p = i;
    for (let r = i + 1; r < 3; r += 1) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    if (Math.abs(A[i][i]) < 1e-12) return [pts.length ? sy / n : 0, 0, 0];
    for (let r = 0; r < 3; r += 1) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < 4; c += 1) A[r][c] -= f * A[i][c];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

if (mode === "edge") {
  /**
   * `--band x0,x1,y0,y1` is the search window and `--thr` the luminance the
   * play surface clears and its border does not. Both are given rather than
   * guessed, because the one thing a boundary detector must not do is decide
   * for itself which of two surfaces is the ground.
   */
  const [x0, x1, y0, y1] = nums("band", `${Math.round(width * 0.25)},${Math.round(width * 0.75)},0,${Math.round(height * 0.5)}`);
  const thr = Number(flag("thr", 70));
  const step = Number(flag("step", 1));
  const from = String(flag("from", "top"));
  const pts = [];
  for (let x = x0; x <= x1; x += step) {
    let hit = -1;
    if (from === "top") {
      for (let y = y0; y <= y1; y += 1) if (L(x, y) >= thr && L(x, y + 2) >= thr && L(x, y + 4) >= thr) { hit = y; break; }
    } else {
      for (let y = y1; y >= y0; y -= 1) if (L(x, y) >= thr && L(x, y - 2) >= thr && L(x, y - 4) >= thr) { hit = y; break; }
    }
    pts.push([x, hit]);
  }
  const found = pts.filter((p) => p[1] >= 0);
  if (found.length < 12) {
    console.log(`[edge] only ${found.length} columns found a boundary — wrong band or threshold`);
    process.exit(1);
  }
  /**
   * Fit on the trimmed middle, then measure everything against it.
   *
   * Fitting on all the points would let a big interruption drag the curve
   * towards itself and then report the *silhouette* as the anomaly. Two passes:
   * fit, drop the worst fifth, fit again.
   */
  let coef = quadFit(found);
  const resid0 = found.map(([x, y]) => [x, y, Math.abs(y - (coef[0] + coef[1] * x + coef[2] * x * x))]);
  const cut = [...resid0].sort((a, b) => a[2] - b[2])[Math.floor(resid0.length * 0.8)][2];
  coef = quadFit(resid0.filter((r) => r[2] <= cut).map((r) => [r[0], r[1]]));

  /**
   * A crossing is *sustained*; a single stray column is bloom.
   *
   * The first cut of this counted every column whose boundary was off the curve,
   * and reported 41 interruptions on a board with three props — 34 of them one
   * to three pixels wide, all of them the neon rope light's own fringe wobbling
   * the detected edge. A metric that a 2px fringe defeats is a metric that
   * measures the fringe. Deviations are therefore run-length encoded first and
   * anything narrower than `--minbreak` is bridged back into the clean run,
   * which is also the honest reading: a two-pixel notch does not interrupt a
   * silhouette for a viewer.
   */
  const tol = Number(flag("tol", 10));
  const minBreak = Number(flag("minbreak", 8));
  const off = pts.map(([x, y]) => {
    const fit = coef[0] + coef[1] * x + coef[2] * x * x;
    return y < 0 ? Infinity : Math.abs(y - fit);
  });
  const bad = off.map((o) => o > tol);
  for (let i = 0; i < bad.length; ) {
    if (!bad[i]) { i += 1; continue; }
    let j = i;
    while (j < bad.length && bad[j]) j += 1;
    if ((j - i) * step < minBreak) for (let k = i; k < j; k += 1) bad[k] = false;
    i = j;
  }
  let run = 0;
  let best = 0;
  let bestAt = 0;
  let clean = 0;
  const breaks = [];
  let inBreak = -1;
  for (let i = 0; i < pts.length; i += 1) {
    const x = pts[i][0];
    if (!bad[i]) {
      clean += 1;
      run += step;
      if (run > best) { best = run; bestAt = x; }
      if (inBreak >= 0) { breaks.push([inBreak, x - step]); inBreak = -1; }
    } else {
      run = 0;
      if (inBreak < 0) inBreak = x;
    }
  }
  if (inBreak >= 0) breaks.push([inBreak, x1]);
  const span = x1 - x0;
  console.log(`[edge] ${path.basename(file)} ${width}x${height}  band x=${x0}..${x1} y=${y0}..${y1} thr=${thr} step=${step}px tol=±${tol}px`);
  console.log(`       boundary follows one smooth curve for ${clean * step}/${span}px (${((clean * step) / span * 100).toFixed(1)}%)`);
  console.log(`       LONGEST UNINTERRUPTED RUN ${best}px (${((best / span) * 100).toFixed(1)}% of the span), ending at x=${bestAt}`);
  console.log(`       ${breaks.length} interruption(s): ${breaks.map(([a, b]) => `${a}-${b}(${b - a + step}px)`).join(" ") || "none"}`);
  process.exit(0);
}

if (mode === "field") {
  /**
   * How much of the interior is one smooth gradient.
   *
   * The interior is reduced to `--blocks` × `--blocks` block means, which throws
   * away grain and any weave finer than a block — deliberately, because §1's
   * texture and §2's lit surface are different claims and this one is about the
   * second. A 2-D quadratic is fitted to those means; what is left is structure
   * the gradient does not explain. R² near 1 says "one soft gradient".
   */
  const [bx, by, bw, bh] = nums("box", `${Math.round(width * 0.3)},${Math.round(height * 0.2)},${Math.round(width * 0.4)},${Math.round(height * 0.5)}`);
  const n = Number(flag("blocks", 16));
  const cells = [];
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const px0 = bx + Math.floor((bw * i) / n);
      const px1 = bx + Math.floor((bw * (i + 1)) / n);
      const py0 = by + Math.floor((bh * j) / n);
      const py1 = by + Math.floor((bh * (j + 1)) / n);
      let s = 0;
      let c = 0;
      for (let y = py0; y < py1; y += 2) for (let x = px0; x < px1; x += 2) { s += L(x, y); c += 1; }
      cells.push({ u: (i + 0.5) / n - 0.5, v: (j + 0.5) / n - 0.5, m: s / Math.max(1, c) });
    }
  // Six-term 2-D quadratic: 1, u, v, u², uv, v². Normal equations, solved by
  // Gaussian elimination — six unknowns is small enough that nothing clever is
  // warranted and clever is where a fitting bug hides.
  const basis = (c) => [1, c.u, c.v, c.u * c.u, c.u * c.v, c.v * c.v];
  const M = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const c of cells) {
    const b = basis(c);
    for (let r = 0; r < 6; r += 1) {
      for (let k = 0; k < 6; k += 1) M[r][k] += b[r] * b[k];
      M[r][6] += b[r] * c.m;
    }
  }
  for (let i = 0; i < 6; i += 1) {
    let p = i;
    for (let r = i + 1; r < 6; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 6; r += 1) {
      if (r === i || Math.abs(M[i][i]) < 1e-12) continue;
      const f = M[r][i] / M[i][i];
      for (let k = i; k < 7; k += 1) M[r][k] -= f * M[i][k];
    }
  }
  const beta = Array.from({ length: 6 }, (_, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : M[i][6] / M[i][i]));
  const mean = cells.reduce((a, c) => a + c.m, 0) / cells.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const c of cells) {
    const pred = basis(c).reduce((a, b, i) => a + b * beta[i], 0);
    ssTot += (c.m - mean) ** 2;
    ssRes += (c.m - pred) ** 2;
  }
  const r2 = 1 - ssRes / Math.max(1e-9, ssTot);
  const sd = Math.sqrt(cells.reduce((a, c) => a + (c.m - mean) ** 2, 0) / cells.length);
  const resSd = Math.sqrt(ssRes / cells.length);
  console.log(`[field] ${path.basename(file)}  box=${bx},${by},${bw},${bh}  ${n}x${n} blocks of ${Math.round(bw / n)}x${Math.round(bh / n)}px`);
  console.log(`        mean L=${mean.toFixed(1)}  block sd=${sd.toFixed(2)}`);
  console.log(`        one 2-D quadratic explains R²=${(r2 * 100).toFixed(1)}% of it; residual sd=${resSd.toFixed(2)} L`);
  console.log(`        (R² near 100% and a small residual IS "one soft gradient")`);
  process.exit(0);
}

if (mode === "periodic") {
  /**
   * The metric `field` should have been, and the reason it is a separate mode
   * rather than a replacement.
   *
   * `field` asks how *much* the interior varies and answered, honestly, that
   * ours varies more than the reference's does — residual sd 10.4 L against 4.2
   * on a comparable patch. That is a real answer to the wrong question. What
   * makes a surface read as a procedural fill is not the amplitude of its
   * variation but its **regularity**: a hex lattice at two per cent contrast is
   * still a lattice, and the eye finds a repeat far below the threshold at which
   * it can name one. Painted wear at ten per cent does not repeat and therefore
   * never resolves.
   *
   * So: strip the lighting with the same quadratic `field` fits, then
   * autocorrelate the residual along each axis. A painted surface decorrelates
   * and stays down. A lattice comes back up, at its own pitch, every time.
   */
  const [bx, by, bw, bh] = nums("box", `${Math.round(width * 0.3)},${Math.round(height * 0.2)},${Math.round(width * 0.4)},${Math.round(height * 0.5)}`);
  const cols = new Float64Array(bw);
  const rows = new Float64Array(bh);
  for (let y = 0; y < bh; y += 1)
    for (let x = 0; x < bw; x += 1) {
      const v = L(bx + x, by + y);
      cols[x] += v / bh;
      rows[y] += v / bw;
    }
  /**
   * A boxcar high-pass, not a quadratic.
   *
   * The first cut detrended with the same quadratic `field` uses and reported
   * 0.79 for our mat and **0.81 for the reference** — an instrument that cannot
   * tell a hex lattice from painted sand is not an instrument. The reason is
   * that a column-mean profile keeps plenty of smooth low-frequency shape that a
   * quadratic cannot follow, and any residual trend autocorrelates near 1 at
   * short lags whatever is drawn on top of it. Subtracting a running mean over
   * `--window` px removes everything slower than the feature being looked for
   * and leaves only the repeat, which is the whole question.
   */
  const win = Number(flag("window", 41));
  const detrend = (a) => {
    const out = new Float64Array(a.length);
    const h = Math.floor(win / 2);
    for (let i = 0; i < a.length; i += 1) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k += 1) { s += a[k]; n += 1; }
      out[i] = a[i] - s / n;
    }
    return out;
  };
  const acf = (a, maxLag) => {
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const d = Float64Array.from(a, (v) => v - mean);
    const v0 = d.reduce((s, v) => s + v * v, 0);
    const out = [];
    for (let k = 1; k <= maxLag; k += 1) {
      let s = 0;
      for (let i = 0; i + k < d.length; i += 1) s += d[i] * d[i + k];
      out.push([k, s / Math.max(1e-9, v0)]);
    }
    return out;
  };
  const report = (name, series) => {
    const a = acf(detrend(series), Math.min(120, Math.floor(series.length / 3)));
    // Ignore the first few lags: neighbouring pixels correlate in any image.
    const scan = a.filter(([k]) => k >= 6);
    const peak = scan.reduce((b, c) => (c[1] > b[1] ? c : b), scan[0]);
    console.log(`        ${name}: strongest repeat at lag ${peak[0]}px, autocorrelation ${peak[1].toFixed(3)}`);
    return peak[1];
  };
  console.log(`[periodic] ${path.basename(file)}  box=${bx},${by},${bw},${bh}`);
  const px = report("across", cols);
  const py = report("down  ", rows);
  console.log(`        worst axis ${Math.max(px, py).toFixed(3)}  (>0.30 is a legible repeat; a painted surface sits near 0)`);
  process.exit(0);
}

console.log("usage: node scripts/_w9mat_probe.mjs edge|field|periodic <png> [--band …] [--box …]");
