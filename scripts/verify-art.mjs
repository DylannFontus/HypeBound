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

console.log(`\nHYPEBOUND art — ${files.length} image(s), ${cardIds.size} cards\n`);

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
  }
} finally {
  await browser.close();
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

console.log(failures === 0 ? "\nPASS — every image binds to a card and paints." : `\nFAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
