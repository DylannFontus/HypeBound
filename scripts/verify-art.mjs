/**
 * Every card image, checked the only way that counts.
 *
 * Art is bound by filename: `public/assets/art/<card-id>.png` and the renderer
 * picks it up with no registration step anywhere. That convention is what makes
 * dropping in a painting a one-file change, and it is also why nothing in the
 * build has an opinion about whether the file is any good — or whether the name
 * matches a card that exists.
 *
 * Two failures hide in that gap, and neither one produces an error message:
 *
 * - **A misspelled id.** `viral-trendsurfer.png` next to a card called
 *   `viral-trend-surfer` is a file the game will never ask for. The card keeps
 *   its procedural placeholder and the art sits in the repo looking done.
 * - **A file a browser cannot decode.** `artLoader.tryLoad` treats a decode
 *   failure as "try the next extension", and once the extensions run out, as
 *   `"missing"`. There is no `console.error`, no thrown exception, no visible
 *   difference from a card that was never painted. A truncated download or a
 *   mislabelled JPEG therefore renders the placeholder forever.
 *
 * So the signature bytes are not enough and neither is `existsSync`. This walks
 * the folder, matches every file against the real card ids, and then asks an
 * actual browser to load each one through the same `Image` the game uses.
 *
 * Needs a dev server on :5173, because the point is to fetch the files as they
 * are served rather than as they sit on disk.
 */

import { chromium } from "playwright-core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART_DIR = path.join(ROOT, "public", "assets", "art");
const CARD_DIR = path.join(ROOT, "data", "cards");
const ORIGIN = "http://localhost:5173";

/** The canonical card size from `palette.ts`. Art is full-bleed, so it must match. */
const CARD_W = 512;
const CARD_H = 680;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

let failures = 0;
const ok = (m) => console.log(`   ok: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`   FAIL: ${m}`);
};

// ---------------------------------------------------------------------------
// What the data says exists
// ---------------------------------------------------------------------------

/**
 * Card ids, and the `art` overrides.
 *
 * A card may point at a shared image with an `art` field, so the set of legal
 * filenames is not simply the set of card ids — treating it as such would
 * report a deliberately shared painting as an orphan.
 */
const cards = [];
const cardIds = new Set();
const artKeys = new Set();
for (const file of readdirSync(CARD_DIR).filter((f) => f.endsWith(".json"))) {
  const parsed = JSON.parse(readFileSync(path.join(CARD_DIR, file), "utf8"));
  for (const card of Array.isArray(parsed) ? parsed : (parsed.cards ?? [])) {
    if (!card?.id) continue;
    cards.push(card);
    cardIds.add(card.id);
    artKeys.add(card.art ?? card.id);
  }
}

const files = readdirSync(ART_DIR).filter((f) => /\.(png|webp|jpg)$/i.test(f));

// ---------------------------------------------------------------------------
// The declared assets — everything that is not card art
// ---------------------------------------------------------------------------

/**
 * Card art binds by card id with no registration step. Everything else — the
 * logo, the icons, the board backdrops — is a fixed small set the code refers
 * to by name, so it is declared once in `data/asset-manifest.json` and read
 * from here *and* from the loaders. Two lists would eventually disagree, and
 * the disagreement would be silent: a file nothing asks for looks exactly like
 * a file that is working.
 */
const PUBLIC_DIR = path.join(ROOT, "public");
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, "data", "asset-manifest.json"), "utf8"));
const ASSET_EXTENSIONS = ["png", "webp", "jpg"];

function declaredAssets() {
  const out = [];
  const { brand, icons, boards } = MANIFEST;
  for (const asset of brand.assets) {
    out.push({ base: `${brand.dir}/${asset.id}`, w: asset.width, h: asset.height, group: "brand" });
  }
  for (const [group, ids] of Object.entries(icons.groups)) {
    for (const id of ids) {
      out.push({ base: `${icons.dir}/${group}/${id}`, w: icons.width, h: icons.height, group: `icons/${group}` });
    }
  }
  for (const id of boards.assets) {
    out.push({ base: `${boards.dir}/${id}`, w: boards.width, h: boards.height, group: "boards" });
  }
  return out;
}

/** The file on disk for a declared asset, whatever extension it arrived as. */
function presentFile(base) {
  for (const extension of ASSET_EXTENSIONS) {
    if (existsSync(path.join(PUBLIC_DIR, `${base}.${extension}`))) return `${base}.${extension}`;
  }
  return null;
}

const declared = declaredAssets();
const declaredBases = new Set(declared.map((asset) => asset.base));
const presentAssets = declared
  .map((asset) => ({ ...asset, file: presentFile(asset.base) }))
  .filter((asset) => asset.file !== null);

console.log(`\nHYPEBOUND assets — ${files.length} card image(s), ${presentAssets.length}/${declared.length} declared asset(s)\n`);

// ---------------------------------------------------------------------------
// 1. Does each file belong to a card?
// ---------------------------------------------------------------------------

console.log("1. Every image is addressed to a card that exists");
const orphans = files.filter((f) => !artKeys.has(f.replace(/\.[a-z]+$/i, "")));
if (orphans.length === 0) ok("no image is named after a card that is not there");
else for (const o of orphans) fail(`${o} matches no card id — the game will never request it`);

// ---------------------------------------------------------------------------
// 2. Is it the right shape on disk?
// ---------------------------------------------------------------------------

console.log("\n2. Full-bleed at the canonical size");

/** PNG header only. Enough to read a size without a decoder; not enough to trust the body. */
function pngSize(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

let sized = 0;
for (const file of files) {
  if (!file.toLowerCase().endsWith(".png")) continue; // only PNG headers are parsed here
  const size = pngSize(readFileSync(path.join(ART_DIR, file)));
  if (!size) fail(`${file} is named .png but does not start with a PNG header`);
  else if (size.w !== CARD_W || size.h !== CARD_H) fail(`${file} is ${size.w}x${size.h}, not ${CARD_W}x${CARD_H}`);
  else sized++;
}
ok(`${sized} PNG(s) at ${CARD_W}x${CARD_H}`);

// ---------------------------------------------------------------------------
// 3. Can a browser actually paint it?
// ---------------------------------------------------------------------------

console.log("\n3. A browser decodes every one of them");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

try {
  const page = await browser.newPage();
  const response = await page.goto(ORIGIN, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!response) {
    fail(`no dev server on ${ORIGIN} — start one with \`npm run dev\``);
  } else {
    /**
     * Loaded through `Image`, not `fetch`, and that is the whole point: a 200
     * response with corrupt bytes is exactly the case a status check passes and
     * the renderer fails. Only a decode tells them apart.
     */
    const results = await page.evaluate(
      (names) =>
        Promise.all(
          names.map(
            (name) =>
              new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve({ name, ok: true, w: image.naturalWidth, h: image.naturalHeight });
                image.onerror = () => resolve({ name, ok: false, w: 0, h: 0 });
                image.src = `assets/art/${name}`;
              })
          )
        ),
      files
    );

    const broken = results.filter((r) => !r.ok);
    const wrong = results.filter((r) => r.ok && (r.w !== CARD_W || r.h !== CARD_H));
    for (const b of broken) fail(`${b.name} did not decode — it would render as a placeholder, silently`);
    for (const w of wrong) fail(`${w.name} decoded at ${w.w}x${w.h}, not ${CARD_W}x${CARD_H}`);
    if (broken.length === 0 && wrong.length === 0) ok(`all ${results.length} decode at ${CARD_W}x${CARD_H}`);

    // -----------------------------------------------------------------------
    console.log("\n4. The declared assets that have arrived");

    if (presentAssets.length === 0) {
      ok("none yet — the game runs on procedural icons and a flat backdrop until they do");
    } else {
      const assetResults = await page.evaluate(
        (items) =>
          Promise.all(
            items.map(
              (item) =>
                new Promise((resolve) => {
                  const image = new Image();
                  image.onload = () => resolve({ ...item, ok: true, w: image.naturalWidth, h: image.naturalHeight });
                  image.onerror = () => resolve({ ...item, ok: false, w: 0, h: 0 });
                  image.src = item.file;
                })
            )
          ),
        presentAssets.map((asset) => ({ file: asset.file, expectW: asset.w, expectH: asset.h, group: asset.group }))
      );

      let good = 0;
      for (const result of assetResults) {
        if (!result.ok) {
          fail(`${result.file} did not decode — it would fall back to procedural art, silently`);
        } else if (result.w !== result.expectW || result.h !== result.expectH) {
          /**
           * Size is enforced here and not merely reported. An icon a few pixels
           * off does not look broken, it looks *slightly* wrong — a hairline of
           * misalignment in a row of four currencies — and that is the kind of
           * defect that survives for months because nobody can point at it.
           */
          fail(`${result.file} is ${result.w}x${result.h}, expected ${result.expectW}x${result.expectH}`);
        } else {
          good++;
        }
      }
      if (good === assetResults.length) ok(`all ${good} decode at their declared size`);
    }

    // -----------------------------------------------------------------------
    console.log("\n5. The interface icons are actually wired to the interface");

    /**
     * A file that decodes is not the same as a file that is used.
     *
     * The currency and interface icons are swapped in by `installIconStyles()`,
     * which sets a class and a custom property on the root element for each one
     * it finds. If that never ran — or ran before the file existed, or looked in
     * the wrong folder — the game keeps drawing the Unicode glyph and looks
     * completely normal. Nothing errors. This is the only check that can tell
     * "there is no icon yet" apart from "there is an icon and it is being
     * ignored".
     */
    const htmlGroups = ["currency", "ui"];
    const expectWired = [];
    for (const group of htmlGroups) {
      for (const id of MANIFEST.icons.groups[group] ?? []) {
        if (presentFile(`${MANIFEST.icons.dir}/${group}/${id}`)) expectWired.push({ group, id });
      }
    }

    if (expectWired.length === 0) {
      ok("no interface icons present yet, so nothing to wire");
    } else {
      await page.goto(ORIGIN, { waitUntil: "networkidle" }).catch(() => null);
      await page.waitForTimeout(1200);
      const installed = await page.evaluate(() => [...document.documentElement.classList].filter((c) => c.startsWith("has-icon-")));
      const notWired = expectWired.filter(({ group, id }) => !installed.includes(`has-icon-${group}-${id}`));
      for (const { group, id } of notWired) {
        fail(`${group}/${id}.png exists but the interface never picked it up — the glyph is still showing`);
      }
      if (notWired.length === 0) ok(`all ${expectWired.length} present interface icon(s) are in use`);
    }
  }
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------
// 6. Nothing sitting in an asset folder that nothing will ever ask for
// ---------------------------------------------------------------------------

console.log("\n6. Every file in the asset folders is one the game asks for");

/**
 * The check that matters most while a batch is being generated.
 *
 * These bind by exact filename, so `back-stage-token.png` or `crest-neon-idols.png`
 * is not a broken asset — it is an *absent* one, sitting in the right folder,
 * looking finished. Nothing errors, the procedural fallback draws instead, and
 * the mistake is a typo nobody will look for. Card art has had this check from
 * the start and it is the same reasoning.
 */
function walkFiles(dir, prefix = "", pattern = /[.](png|webp|jpg)$/i) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(path.join(dir, entry.name), rel, pattern));
    else if (pattern.test(entry.name)) out.push(rel);
  }
  return out;
}

const assetRoots = [MANIFEST.brand.dir, MANIFEST.icons.dir, MANIFEST.boards.dir];
const strays = [];
for (const root of assetRoots) {
  for (const file of walkFiles(path.join(PUBLIC_DIR, root), root)) {
    if (!declaredBases.has(file.replace(/\.[a-z]+$/i, ""))) strays.push(file);
  }
}

if (strays.length === 0) {
  ok("no file is sitting in an asset folder unclaimed");
} else {
  for (const stray of strays) {
    fail(`${stray} is not in data/asset-manifest.json — the game will never load it (a typo, or a new asset to declare)`);
  }
}

// ---------------------------------------------------------------------------
// 7. Audio: the manifest and the folder agree
// ---------------------------------------------------------------------------

console.log("\n7. Every audio file is one a slot points at");

/**
 * Audio wires up through `data/audio-manifest.json`, so the failure here is a
 * path that does not match a filename. It is silent in both directions: a slot
 * pointing at a missing file logs an info and plays nothing, and a file no slot
 * names is never requested. Neither looks like an error, and the game is meant
 * to be playable with no audio at all — so this reports, and only fails on a
 * file nothing can reach.
 */
const AUDIO_DIR = path.join(PUBLIC_DIR, "assets", "audio");
const audioManifest = JSON.parse(readFileSync(path.join(ROOT, "data", "audio-manifest.json"), "utf8"));
const audioSlots = audioManifest.slots ?? {};
const wanted = new Map();
for (const [slot, rel] of Object.entries(audioSlots)) {
  if (rel) wanted.set(rel.replace(/\\/g, "/"), slot);
}

const audioOnDisk = existsSync(AUDIO_DIR)
  ? walkFiles(AUDIO_DIR, "", /\.(mp3|ogg|wav|m4a|flac|opus)$/i)
  : [];

const unreachable = audioOnDisk.filter((file) => !wanted.has(file));
for (const file of unreachable) {
  fail(`assets/audio/${file} is not named by any slot in data/audio-manifest.json — nothing will ever play it`);
}

const present = [...wanted.keys()].filter((rel) => existsSync(path.join(AUDIO_DIR, rel)));
if (unreachable.length === 0) {
  ok(`${present.length}/${wanted.size} pointed slot(s) have a file; ${audioOnDisk.length} file(s) on disk, all reachable`);
}

// ---------------------------------------------------------------------------
// 8. Does the audio actually decode, and is it the right length?
// ---------------------------------------------------------------------------

console.log("\n8. Every audio file decodes, at a sane length");

/**
 * Existence is not playability, and this is the audio twin of the image decode
 * check in §3.
 *
 * `decodeAudioData` is the exact call the game makes. A file that fails it is
 * cached as failed and the slot goes quiet for the session — no error, no
 * visible difference from a slot with no file. A `.flac` that is secretly a WAV,
 * or a truncated download, both land there.
 *
 * Length is checked too, because the likeliest mistake with these is not
 * corruption but **forgetting to trim**. Stable Audio is asked for three or four
 * seconds and the brief says to cut down to the transient; an interface click
 * that shipped at its full generated length would be four seconds of sound on
 * every button press. That is not subtle in play and it is invisible on disk.
 */
if (present.length > 0) {
  const audioBrowser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await audioBrowser.newPage();
    const reachable = await page.goto(ORIGIN, { waitUntil: "domcontentloaded" }).catch(() => null);
    if (!reachable) {
      fail(`no dev server on ${ORIGIN}, so the audio was not decoded`);
    } else {
      const decoded = await page.evaluate(async (paths) => {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const out = [];
        for (const rel of paths) {
          try {
            const response = await fetch(`assets/audio/${rel}`);
            if (!response.ok) {
              out.push({ rel, ok: false, why: `HTTP ${response.status}` });
              continue;
            }
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            out.push({ rel, ok: true, seconds: buffer.duration, channels: buffer.numberOfChannels });
          } catch (error) {
            out.push({ rel, ok: false, why: String(error).slice(0, 80) });
          }
        }
        return out;
      }, present);

      /** Anything an interface click could not plausibly be. */
      const UI_MAX_SECONDS = 1.2;
      let good = 0;
      let longest = { rel: "", seconds: 0 };
      for (const result of decoded) {
        if (!result.ok) {
          fail(`assets/audio/${result.rel} did not decode (${result.why}) — the slot would be silent`);
          continue;
        }
        good++;
        if (result.seconds > longest.seconds) longest = { rel: result.rel, seconds: result.seconds };
        if (result.rel.startsWith("sfx/ui/") && result.seconds > UI_MAX_SECONDS) {
          fail(
            `assets/audio/${result.rel} is ${result.seconds.toFixed(2)}s — an interface sound this long was probably never trimmed`
          );
        }
      }
      if (good === decoded.length) {
        ok(`all ${good} decode; longest is ${longest.rel} at ${longest.seconds.toFixed(2)}s`);
      }

      const totalSeconds = decoded.filter((r) => r.ok).reduce((sum, r) => sum + r.seconds, 0);
      console.log(`   ${decoded.filter((r) => r.ok).length} file(s), ${totalSeconds.toFixed(0)}s of audio in total`);
    }
  } finally {
    await audioBrowser.close();
  }
} else {
  ok("no audio files yet, so nothing to decode");
}

// ---------------------------------------------------------------------------
// Coverage, reported and never enforced
// ---------------------------------------------------------------------------

/**
 * Not a failure. Placeholder art is a supported state — the game is designed to
 * be playable and presentable with zero images present — so a coverage
 * threshold here would turn an unfinished art pass into a broken build.
 */
const paintedKeys = new Set(files.map((f) => f.replace(/\.[a-z]+$/i, "")));
const isPainted = (card) => paintedKeys.has(card.art ?? card.id);
const painted = [...artKeys].filter((key) => paintedKeys.has(key)).length;
const percent = ((painted / cardIds.size) * 100).toFixed(1);
console.log(`\nCoverage: ${painted}/${cardIds.size} cards painted (${percent}%). The rest use procedural art.`);

/**
 * Which faction to finish next, and what is left in it.
 *
 * The art pass runs a faction at a time, and a half-painted faction is the one
 * state that actually looks broken in play — a board where three cards are
 * paintings and two are procedural reads as missing assets rather than as a
 * style. So the useful question is never "how many are left" but "which
 * faction is closest to whole", and that is what gets printed.
 */
const remaining = new Map();
for (const card of cards) {
  if (isPainted(card)) continue;
  const faction = card.faction ?? "(none)";
  if (!remaining.has(faction)) remaining.set(faction, []);
  remaining.get(faction).push(card);
}

if (remaining.size === 0) {
  console.log("Every card is painted.");
} else {
  const complete = [...new Set(cards.map((c) => c.faction ?? "(none)"))].filter((f) => !remaining.has(f));
  if (complete.length) console.log(`Complete: ${complete.sort().join(", ")}`);

  const [nextFaction, left] = [...remaining].sort((a, b) => a[1].length - b[1].length)[0];
  const RARITY = { legendary: 0, epic: 1, rare: 2, common: 3 };
  console.log(`\nClosest to finished: ${nextFaction}, ${left.length} left`);
  const shown = [...left].sort((a, b) => (RARITY[a.rarity] ?? 9) - (RARITY[b.rarity] ?? 9)).slice(0, 12);
  /**
   * Width from the longest id present, not a guess.
   *
   * A fixed 34 ran `corp-ambrose-kell-majority-shareholder` straight into the
   * rarity beside it — and the ids are the column a person copies to name the
   * next file, so the one that overflows is the one that matters most.
   */
  const width = Math.max(...shown.map((card) => (card.art ?? card.id).length)) + 2;
  for (const card of shown) {
    console.log(`   ${(card.art ?? card.id).padEnd(width)}${(card.rarity ?? "?").padEnd(11)}${card.name ?? ""}`);
  }
  if (left.length > 12) console.log(`   … and ${left.length - 12} more`);
}

// ---------------------------------------------------------------------------
// Declared-asset coverage, by group
// ---------------------------------------------------------------------------

const byGroup = new Map();
for (const asset of declared) {
  const entry = byGroup.get(asset.group) ?? { have: 0, want: 0, missing: [] };
  entry.want++;
  if (presentFile(asset.base)) entry.have++;
  else entry.missing.push(asset.base.split("/").pop());
  byGroup.set(asset.group, entry);
}

console.log("\nDeclared assets (docs/ASSET-BRIEF.md):");
for (const [group, entry] of [...byGroup].sort()) {
  const line = `   ${group.padEnd(20)} ${String(entry.have).padStart(3)}/${entry.want}`;
  console.log(entry.have === entry.want ? `${line}  complete` : `${line}  missing: ${entry.missing.join(", ")}`);
}

console.log(
  failures === 0 ? "\nPASS — every image binds to something the game asks for, and paints." : `\nFAIL — ${failures} problem(s)`
);
process.exit(failures === 0 ? 0 : 1);
