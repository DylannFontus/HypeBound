/**
 * The build step that makes the art light enough to arrive.
 *
 * ## Why this exists
 *
 * `public/` holds the owner's hand-made masters: 296 card paintings as 512x680
 * PNG, twelve 4K board backdrops, forty 512px icons and the wordmark. Those are
 * the source of truth and this file never writes to that folder, never deletes
 * from it and never invents anything to put in it. What it does is produce a
 * *second*, lighter copy of each one somewhere else, and hand the build a list
 * saying which copy belongs in `dist`.
 *
 * The trap it avoids is the one the owner actually hit. Every wiring check the
 * project has says the art is fine — `verify:art` reports 296/296 painted, all
 * at 512x680, no orphans — and the deployed page still looks like the art never
 * landed, because a PNG-only `dist` is 295 MB and 122 MB of that is card art at
 * 423 KB a card. Nothing is broken. The pictures are simply arriving after the
 * player has stopped looking. **"Wired" and "arrives" are different properties
 * and only one of them had a verifier.**
 *
 * ## Two copies, and only one of them ships
 *
 * A PNG master and its WebP are the same picture, so shipping both is shipping
 * the picture twice. That is exactly what the board backdrops were doing before
 * this existed: `assetLoader` has preferred WebP for boards since they were
 * added, the owner hand-encoded twelve WebPs, and `dist` still carried all
 * twelve 4K PNG masters beside them — 93 MB, of which 87 MB was never requested
 * by anything. Half of that pattern was in place; this is the other half.
 *
 * So `vite.config.ts` turns Vite's own `public/` copy off (`copyPublicDir:
 * false`) and copies the folder itself, substituting the light encode and
 * leaving the master behind. `public/` is untouched on disk and still served
 * verbatim in dev.
 *
 * ## Why the cache is keyed by content and not by mtime
 *
 * CI checks the repository out fresh, so every file has a brand-new mtime and
 * an mtime-keyed cache would re-encode all 350 images on every single push —
 * which is its own bug, and the one the brief names. The key here is a SHA-1 of
 * the source bytes plus the encode options, so a cache restored from a previous
 * run is valid no matter what the timestamps say, and changing a quality
 * setting invalidates exactly the files that setting touches.
 *
 * ## The encode is measured, not asserted
 *
 * "High quality" is the kind of claim that is never checked. Every output here
 * is decoded back to raw pixels and compared against its source: same
 * dimensions, and a root-mean-square error over **alpha-premultiplied** RGBA.
 * Premultiplied because the colour under a fully transparent pixel is arbitrary
 * — comparing it would report large errors in regions nobody can see, on the
 * forty icons that are mostly transparent. The worst RMSE in the run is printed
 * and a wrong-sized output is a hard failure, because a silently downscaled
 * card is exactly the kind of defect that survives a build and a screenshot.
 *
 * ## Settings, and where they came from
 *
 * `scripts/_enc_calib.mjs` swept quality 78/82/86/90 across the smallest,
 * quartile, median, upper-quartile and largest card. q82 puts every card under
 * 60 KB with an RMSE of 1.8–4.8 out of 255. `scripts/_enc_decode.mjs` then
 * timed `createImageBitmap` in a real Chrome, twenty samples per format with
 * the codec warm-up discarded, and found WebP and AVIF decode within 0.2ms of
 * each other — so the reason this ships WebP and not AVIF is not decode cost,
 * which was the assumption going in and was wrong. It is that AVIF needs a
 * third extension in a loader whose whole failure mode is silent fallback,
 * triples encode time, and buys about 20% more on top of the 93% WebP already
 * takes off.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const CACHE_DIR = path.join(ROOT, ".asset-cache");
const CACHE_OUT = path.join(CACHE_DIR, "out");
const CACHE_INDEX = path.join(CACHE_DIR, "index.json");

/**
 * Bumped by hand when a policy below changes in a way that should invalidate
 * work already cached. It is folded into every cache key, so a bump re-encodes
 * everything and leaving it alone re-encodes nothing.
 */
const POLICY_VERSION = 2;

/**
 * On by default for every lossy encode here, and it is not a micro-optimisation.
 *
 * WebP subsamples chroma 4:2:0, which halves the colour resolution — and this
 * game is neon, so almost every edge that matters is a saturated magenta or
 * cyan against near-black, exactly the case 4:2:0 smears. Measured on the
 * faction crest that came out worst in the first run, `smartSubsample` took the
 * error from RMSE 7.68 to 5.25 for three kilobytes; pushing quality from 86 to
 * 94 without it only reached 7.48 for sixteen. The defect was never quantisation
 * and more quality could not have fixed it.
 */
const CHROMA = { smartSubsample: true };

// ---------------------------------------------------------------------------
// What happens to each kind of file
// ---------------------------------------------------------------------------

/**
 * `keep` is what `dist` gets. `drop` is a master that stays in `public/` and is
 * left out of `dist` because something lighter carries the same pixels.
 *
 * The one file that is *not* dropped is `hb-wordmark.png`. `index.html`
 * hard-codes it twice — a `<link rel="preload" as="image">` in the head and the
 * boot plate's `background: url(...)` — and `index.html` is not this builder's
 * file. A preload the page then ignores would be the worst of both: the PNG
 * downloaded at high priority and a WebP downloaded beside it. So the wordmark
 * ships as a recompressed PNG only, and the follow-up that makes it a WebP is a
 * two-line change in `index.html`.
 */
const POLICIES = [
  {
    id: "card-art",
    /** 512x680 paintings, drawn full-bleed into a 512x680 canvas. Size is fixed by `verify:art`. */
    match: (rel) => rel.startsWith("assets/art/") && rel.endsWith(".png"),
    /**
     * 80 rather than the 82 the sweep landed on, because with `smartSubsample`
     * the pair is strictly better than 82 without it on both sampled cards —
     * same bytes to the kilobyte, lower error (4.40 against 4.80 on the
     * heaviest). Free is free.
     */
    outputs: [{ ext: "webp", options: { quality: 80, effort: 6, alphaQuality: 100, ...CHROMA } }],
    dropSource: true,
  },
  {
    id: "boards",
    /**
     * 4K backdrops. The owner already hand-encoded WebPs for all twelve and
     * they are better than anything a default quality would produce, so a
     * committed sibling wins and only a board without one is encoded here.
     */
    match: (rel) => rel.startsWith("assets/boards/") && rel.endsWith(".png"),
    outputs: [{ ext: "webp", options: { quality: 78, effort: 6, ...CHROMA } }],
    preferCommittedSibling: true,
    dropSource: true,
  },
  {
    id: "icons",
    /**
     * 512x512 with a real alpha channel, drawn onto card canvases at 28–96px.
     * `alphaQuality: 100` because lossy alpha on a hard-edged emblem shows as a
     * dirty halo against the dark board, which is precisely where these sit.
     * Kept at 512 rather than downscaled: `texture.ts::scaledAsset` already
     * mip-chains them down per draw, and the confluence emblems appear large.
     */
    match: (rel) => rel.startsWith("assets/icons/") && rel.endsWith(".png"),
    outputs: [{ ext: "webp", options: { quality: 86, effort: 6, alphaQuality: 100, ...CHROMA } }],
    dropSource: true,
  },
  {
    id: "brand-mark",
    /** 2048x2048, requested only through `getAsset` by the intro sting. */
    match: (rel) => rel === "assets/brand/hb-mark-master.png",
    outputs: [{ ext: "webp", options: { quality: 86, effort: 6, alphaQuality: 100, ...CHROMA } }],
    dropSource: true,
  },
  {
    id: "brand-wordmark",
    match: (rel) => rel === "assets/brand/hb-wordmark.png",
    outputs: [{ ext: "png", options: { png: true } }],
    dropSource: true, // replaced by the recompressed PNG of the same name
  },
];

const policyFor = (rel) => POLICIES.find((p) => p.match(rel)) ?? null;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Recompress a PNG without changing a pixel of what it depicts.
 *
 * Two candidates, because which one wins depends entirely on the picture:
 * palette quantisation is a huge saving on flat illustration and visible
 * banding on a soft neon glow. So both are produced, the fidelity of the
 * quantised one is measured against the source, and it is only accepted when it
 * is both smaller *and* within the same error budget the lossy formats are held
 * to. Otherwise the losslessly recompressed one ships.
 */
async function encodePng(source, referenceRaw) {
  const lossless = await sharp(source).png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  const quantised = await sharp(source).png({ compressionLevel: 9, effort: 10, palette: true, quality: 90, dither: 1 }).toBuffer();
  if (quantised.length >= lossless.length) return lossless;
  const error = await fidelity(referenceRaw, quantised);
  return error.rmse <= RMSE_BUDGET ? quantised : lossless;
}

async function encodeOne(source, output, referenceRaw) {
  if (output.options.png) return encodePng(source, referenceRaw);
  return sharp(source)[output.ext](output.options).toBuffer();
}

/** Fully transparent pixels have arbitrary colour, so compare what is visible. */
async function premultipliedRaw(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    out[i] = (data[i] * a) / 255;
    out[i + 1] = (data[i + 1] * a) / 255;
    out[i + 2] = (data[i + 2] * a) / 255;
    out[i + 3] = a;
  }
  return { data: out, width: info.width, height: info.height };
}

/**
 * The error budget every output is held to, in RMSE over 0–255.
 *
 * Set from the calibration sweep rather than from taste: the worst of the five
 * sampled cards measured 4.80 at q82, so 8 leaves headroom for a card unlike
 * any of them while still being nowhere near the 20–40 a genuinely botched
 * encode produces. It is a tripwire for a mistake, not a quality target — the
 * quality target is the q82 setting itself.
 */
const RMSE_BUDGET = 8;

async function fidelity(reference, encoded) {
  const got = await premultipliedRaw(encoded);
  if (got.width !== reference.width || got.height !== reference.height) {
    return { rmse: Infinity, size: `${got.width}x${got.height}`, wrongSize: true };
  }
  let sum = 0;
  for (let i = 0; i < reference.data.length; i++) {
    const d = reference.data[i] - got.data[i];
    sum += d * d;
  }
  return { rmse: Math.sqrt(sum / reference.data.length), size: `${got.width}x${got.height}`, wrongSize: false };
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

function loadIndex() {
  if (!existsSync(CACHE_INDEX)) return { policyVersion: POLICY_VERSION, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(CACHE_INDEX, "utf8"));
    if (parsed.policyVersion !== POLICY_VERSION) return { policyVersion: POLICY_VERSION, entries: {} };
    return parsed;
  } catch {
    // A half-written index is not worth diagnosing — throwing it away costs one
    // slow build and cannot produce a wrong file, which the alternative can.
    return { policyVersion: POLICY_VERSION, entries: {} };
  }
}

const keyFor = (bytes, policy) =>
  createHash("sha1")
    .update(bytes)
    .update(`|${POLICY_VERSION}|${policy.id}|${JSON.stringify(policy.outputs)}`)
    .digest("hex");

function walk(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Run `jobs` with at most `limit` in flight. sharp is async, so this is real parallelism. */
async function pool(jobs, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// The public entry points
// ---------------------------------------------------------------------------

/**
 * Encode everything that needs it and return the plan for `dist`.
 *
 * The plan is a flat map of `dist`-relative path → absolute source on disk. The
 * caller copies it and nothing else, which is what makes the master exclusion a
 * property of this list rather than a delete pass over a folder that already
 * has 295 MB in it.
 */
export async function buildAssetPlan({ log = () => {} } = {}) {
  mkdirSync(CACHE_OUT, { recursive: true });
  const index = loadIndex();
  const files = walk(PUBLIC_DIR);

  const plan = new Map();
  const stats = { encoded: 0, cached: 0, verbatim: 0, worst: { rmse: 0, rel: "" } };
  const jobs = [];

  for (const rel of files) {
    const abs = path.join(PUBLIC_DIR, rel);
    const policy = policyFor(rel);
    if (!policy) {
      plan.set(rel, abs);
      stats.verbatim++;
      continue;
    }

    // A hand-made WebP beside the master beats anything a default quality can do.
    if (policy.preferCommittedSibling) {
      const sibling = rel.replace(/\.png$/i, `.${policy.outputs[0].ext}`);
      if (existsSync(path.join(PUBLIC_DIR, sibling))) {
        stats.verbatim++;
        continue; // the sibling is itself in `files` and lands in the plan on its own pass
      }
    }

    const bytes = readFileSync(abs);
    const key = keyFor(bytes, policy);
    const cached = index.entries[rel];

    if (cached && cached.key === key && cached.outputs.every((o) => existsSync(path.join(CACHE_OUT, o.rel)))) {
      for (const output of cached.outputs) plan.set(output.rel, path.join(CACHE_OUT, output.rel));
      stats.cached++;
      if (cached.rmse > stats.worst.rmse) stats.worst = { rmse: cached.rmse, rel };
      continue;
    }

    jobs.push(async () => {
      const reference = await premultipliedRaw(bytes);
      const outputs = [];
      let worst = 0;
      for (const output of policy.outputs) {
        const encoded = await encodeOne(bytes, output, reference);
        const error = await fidelity(reference, encoded);
        if (error.wrongSize) {
          throw new Error(`${rel} encoded to ${error.size}, not ${reference.width}x${reference.height} — a silent downscale`);
        }
        if (error.rmse > RMSE_BUDGET) {
          throw new Error(`${rel} → .${output.ext} has RMSE ${error.rmse.toFixed(2)}, over the ${RMSE_BUDGET} budget`);
        }
        worst = Math.max(worst, error.rmse);
        const outRel = rel.replace(/\.[a-z0-9]+$/i, `.${output.ext}`);
        const outAbs = path.join(CACHE_OUT, outRel);
        mkdirSync(path.dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, encoded);
        outputs.push({ rel: outRel, bytes: encoded.length });
      }
      return { rel, key, outputs, rmse: worst };
    });
  }

  if (jobs.length) log(`encoding ${jobs.length} image(s) (${stats.cached} already cached)…`);
  const done = await pool(jobs, Math.max(2, availableParallelism()));

  for (const entry of done) {
    index.entries[entry.rel] = { key: entry.key, outputs: entry.outputs, rmse: entry.rmse };
    for (const output of entry.outputs) plan.set(output.rel, path.join(CACHE_OUT, output.rel));
    stats.encoded++;
    if (entry.rmse > stats.worst.rmse) stats.worst = { rmse: entry.rmse, rel: entry.rel };
  }

  /**
   * Note what is *not* here: no pass that removes masters from the plan. A file
   * with a policy is never added to the plan under its own name in the first
   * place — only its encode is. Exclusion by omission rather than by deletion,
   * so there is no ordering between "add everything" and "take some back out"
   * for a later change to get wrong.
   */
  writeFileSync(CACHE_INDEX, JSON.stringify(index));
  return { plan, stats };
}

/**
 * Encode one file on demand, for the dev server.
 *
 * The dev server keeps serving `public/` verbatim, so a request for
 * `assets/art/x.webp` would 404 and the loader would fall back to the PNG —
 * which works, but means **dev and production run different code paths**, and
 * this project has a documented history of instruments that were right about
 * the thing they measured and measuring the wrong build. So dev gets the WebP
 * too: the first request for one encodes it (about 70ms), caches it, and every
 * request after that is a file read. No startup cost, no background job, and
 * one extension order everywhere.
 *
 * Returns the absolute path to serve, or null when nothing here claims the URL.
 */
export async function encodeOnDemand(relRequested) {
  /**
   * A real file in `public/` always wins, and this line is load-bearing.
   *
   * Without it the middleware answered `assets/boards/neon-idols.webp` with its
   * own q78 encode of the PNG master — 435 KB — while `dist` shipped the
   * owner's hand-made 509 KB WebP, because `buildAssetPlan` prefers a committed
   * sibling and this function did not. Dev and production were serving two
   * different pictures of the same board, both correct-looking, differing only
   * in whose encoder made them. That is the precise failure this whole
   * encode-in-dev arrangement exists to prevent, reintroduced by the thing
   * meant to prevent it.
   */
  if (existsSync(path.join(PUBLIC_DIR, relRequested))) return null;

  const outAbs = path.join(CACHE_OUT, relRequested);
  if (existsSync(outAbs)) return outAbs;

  const ext = path.extname(relRequested).slice(1).toLowerCase();
  const stem = relRequested.slice(0, -(ext.length + 1));
  for (const policy of POLICIES) {
    if (!policy.outputs.some((o) => o.ext === ext)) continue;
    for (const sourceExt of ["png", "jpg", "jpeg"]) {
      const sourceRel = `${stem}.${sourceExt}`;
      if (!policy.match(sourceRel)) continue;
      const sourceAbs = path.join(PUBLIC_DIR, sourceRel);
      if (!existsSync(sourceAbs)) continue;
      const bytes = readFileSync(sourceAbs);
      const output = policy.outputs.find((o) => o.ext === ext);
      const reference = await premultipliedRaw(bytes);
      const encoded = await encodeOne(bytes, output, reference);
      mkdirSync(path.dirname(outAbs), { recursive: true });
      writeFileSync(outAbs, encoded);
      return outAbs;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI — `node scripts/encode-assets.mjs [--report] [--clean]`
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain && process.argv.includes("--weigh-dist")) {
  weighDist();
} else if (isMain) {
  if (process.argv.includes("--clean")) {
    rmSync(CACHE_DIR, { recursive: true, force: true });
    console.log("cache cleared");
  }

  const started = Date.now();
  const { plan, stats } = await buildAssetPlan({ log: (m) => console.log(m) });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `\n${stats.encoded} encoded, ${stats.cached} from cache, ${stats.verbatim} copied as-is, in ${seconds}s` +
      `\nworst fidelity: RMSE ${stats.worst.rmse.toFixed(2)}/255 on ${stats.worst.rel || "(nothing re-encoded)"}` +
      ` — budget ${RMSE_BUDGET}\n`
  );

  if (process.argv.includes("--report")) reportPlan(plan);
}

/**
 * Weigh what was actually written, not what was planned.
 *
 * The plan report below is computed from a `Map` in this process, which is a
 * statement of intent. This one walks `dist` on disk after the fact, and the
 * two answering differently is the failure mode worth catching: a copy that
 * silently did not happen, a master that got there by some route nobody
 * modelled, or a stale `dist` from a build before the change.
 *
 * It also prints every file over 1 MB, because a total is an average and an
 * average hides the one 8 MB file that ruins a first load.
 */
function weighDist() {
  const DIST = path.join(ROOT, "dist");
  if (!existsSync(DIST)) {
    console.log("no dist/ — run `npm run build` first");
    process.exit(1);
  }
  const files = walk(DIST).map((rel) => ({ rel, bytes: statSync(path.join(DIST, rel)).size }));
  const total = files.reduce((sum, f) => sum + f.bytes, 0);

  const groups = ["assets/art", "assets/boards", "assets/icons", "assets/brand", "assets/audio"];
  const bucket = (rel) => groups.find((g) => rel.startsWith(`${g}/`)) ?? "(code, fonts, root)";
  const seen = new Map();
  for (const f of files) {
    const key = bucket(f.rel);
    const e = seen.get(key) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += f.bytes;
    seen.set(key, e);
  }

  console.log(`\ndist — ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB\n`);
  for (const key of [...groups, "(code, fonts, root)"]) {
    const e = seen.get(key) ?? { n: 0, bytes: 0 };
    console.log(
      `  ${key.padEnd(22)}${String(e.n).padStart(4)} files ${(e.bytes / 1024 / 1024).toFixed(2).padStart(8)} MB ` +
        `${((e.bytes / total) * 100).toFixed(1).padStart(5)}%  avg ${(e.n ? e.bytes / e.n / 1024 : 0).toFixed(0).padStart(5)} KB`
    );
  }

  const heavy = files.filter((f) => f.bytes > 1024 * 1024).sort((a, b) => b.bytes - a.bytes);
  console.log(`\nfiles over 1 MB: ${heavy.length}`);
  for (const f of heavy) console.log(`  ${(f.bytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${f.rel}`);

  // A master that reached `dist` means the exclusion did not hold, and it is
  // invisible in a total that is otherwise fine.
  const masters = files.filter((f) => /^assets\/(art|boards|icons)\/.*\.png$/.test(f.rel));
  if (masters.length) {
    console.log(`\nFAIL — ${masters.length} PNG master(s) reached dist: ${masters.slice(0, 5).map((m) => m.rel).join(", ")}`);
    process.exit(1);
  }
  console.log("\nNo PNG master under art/, boards/ or icons/ reached dist.");
}

/**
 * What `dist` will weigh, per category, beside what `public/` weighs now.
 *
 * The comparison that matters is *public against the plan*, because that is the
 * before and after a player actually downloads — a `dist` measured after the
 * fact cannot tell you what it would have been.
 */
function reportPlan(plan) {
  const groups = ["assets/art", "assets/boards", "assets/icons", "assets/brand", "assets/audio"];
  const bucket = (rel) => groups.find((g) => rel.startsWith(`${g}/`)) ?? "(root + everything else)";

  const before = new Map();
  const after = new Map();
  const add = (map, key, bytes) => {
    const e = map.get(key) ?? { n: 0, bytes: 0, max: 0 };
    e.n++;
    e.bytes += bytes;
    e.max = Math.max(e.max, bytes);
    map.set(key, e);
  };

  for (const rel of walk(PUBLIC_DIR)) add(before, bucket(rel), statSync(path.join(PUBLIC_DIR, rel)).size);
  for (const [rel, abs] of plan) add(after, bucket(rel), statSync(abs).size);

  const mb = (n) => (n / 1024 / 1024).toFixed(2).padStart(8);
  const kb = (n) => (n / 1024).toFixed(0).padStart(6);
  console.log("category                 before                       after");
  console.log("                     files      MB   avg KB       files      MB   avg KB   max KB");
  let b0 = 0;
  let a0 = 0;
  for (const key of [...groups, "(root + everything else)"]) {
    const b = before.get(key) ?? { n: 0, bytes: 0, max: 0 };
    const a = after.get(key) ?? { n: 0, bytes: 0, max: 0 };
    b0 += b.bytes;
    a0 += a.bytes;
    console.log(
      `${key.padEnd(20)}${String(b.n).padStart(5)}${mb(b.bytes)}${kb(b.n ? b.bytes / b.n : 0)}      ` +
        `${String(a.n).padStart(5)}${mb(a.bytes)}${kb(a.n ? a.bytes / a.n : 0)}${kb(a.max)}`
    );
  }
  console.log(`${"TOTAL (public assets)".padEnd(20)}     ${mb(b0)}                     ${mb(a0)}`);
  console.log(`\nJS, CSS and the font are on top of the "after" figure; they are built, not copied.`);
}
