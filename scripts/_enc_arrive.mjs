/**
 * Does the art arrive? Measured against the built site, not the dev server.
 *
 * The owner's report was "it didn't wire properly from what I'm seeing on the
 * deployed page", and every existing check disagreed — because every existing
 * check runs against `localhost:5173`, which serves `public/` verbatim over a
 * loopback interface where 423 KB is free. `verify:art` was right about wiring
 * and structurally unable to see weight.
 *
 * So this one serves `dist` through `vite preview` and watches the network: how
 * many card images the collection actually requests, in what format, and what
 * they weigh on the wire.
 *
 * ## Why it cannot report a comfortable zero
 *
 * The obvious failure of a bytes-downloaded metric is that it looks best when
 * nothing loads. Four assertions stop that:
 *
 * - a floor on how many card images were requested, so an empty grid fails;
 * - every response must be `image/webp`, so a silent fallback to the PNG that
 *   is no longer in `dist` shows up as a failure rather than as a bigger number
 *   nobody reads;
 * - no request may be made for `assets/art/*.png` at all — the loader tries
 *   extensions in order and a wasted 404 per card is its own defect;
 * - every image is read back through the DOM and must be 512x680, because a
 *   404 body is very light and decodes to nothing.
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4183;
const ORIGIN = `http://localhost:${PORT}`;
const ROUTE = process.argv[2] ?? "collection";
/**
 * Low, and deliberately so. The grids virtualise — the collection paints ten
 * cards into a 1280x720 viewport and fetches art for those ten — so a high
 * floor here would be measuring the grid's window size. The floor that matters
 * is "more than none"; the real coverage question is settled below by asking
 * for all 296.
 */
const MIN_CARDS = 8;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

/**
 * A dumb static server, and it has to be dumb.
 *
 * The first version of this used `vite preview`, which defaults to `appType:
 * "spa"` and answers **any** unmatched path with `index.html` and a 200. So the
 * request the game makes for `assets/brand/hb-wordmark.webp` — a file that is
 * deliberately not in `dist` — came back 200, the instrument's own
 * failed-request check reported "failed requests: 0", and the number was
 * meaningless. GitHub Pages does not do that; it 404s.
 *
 * Twenty lines of `node:http` model the deployed server exactly: the file, or
 * 404. No fallback, no rewrite, no index resolution beyond a bare directory.
 */
const DIST = path.join(ROOT, "dist");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
};

const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
  const file = path.join(DIST, rel === "" ? "index.html" : rel);
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
let failures = 0;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  /**
   * The listener goes on **before** anything is fetched.
   *
   * Attaching it after the starter picker had already been driven produced a
   * report saying the page downloaded 0 KB of JavaScript, which is not a
   * plausible number and was believed for one run anyway. Everything is
   * recorded, and a marker splits the session into the two phases that mean
   * different things.
   */
  const wire = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    wire.push({ url: url.pathname, type: response.headers()["content-type"] ?? "", status: response.status(), response });
  });

  // Phase 1 — a cold first load by a brand-new player. `?nointro` for the
  // reason recorded as instrument three: without it the title card composites
  // over everything while every selector still resolves.
  await page.goto(`${ORIGIN}/?nointro#${ROUTE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const bootEnd = wire.length;

  /**
   * Phase 2 — past the starter picker, which every route redirects to on a
   * fresh profile. That redirect is why three different routes first measured
   * byte-for-byte identically.
   *
   * `scripts/lib/account.mjs` is the shared way to do this and cannot be used
   * against a build: it fills the collection with
   * `await import("/src/save/profile.ts")`, a dev-server URL that does not
   * exist in `dist`. So only its first step is reproduced, the part that goes
   * through the app's own picker. The account ends up owning a starter deck
   * rather than everything, which is fine — the decisive measurement asks for
   * all 296 images directly and does not care what the profile owns.
   */
  if ((await page.locator(".starter-screen").count()) > 0) {
    await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
    await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20_000 });
  }
  await page.evaluate((r) => (location.hash = r), ROUTE);
  await page.waitForTimeout(2500);

  const boot = wire.slice(0, bootEnd);
  const sized = (rel) => wire.filter((w) => w.url.includes(rel));
  const bytesOf = async (rows) => {
    let total = 0;
    for (const row of rows) {
      try {
        total += (await row.response.body()).length;
      } catch {
        /* a response with no retrievable body contributes nothing, and the count still counts it */
      }
    }
    return total;
  };

  const art = sized("/assets/art/");
  const artWebp = art.filter((w) => w.url.endsWith(".webp") && w.status === 200);
  const artPng = art.filter((w) => w.url.endsWith(".png"));
  const artBytes = await bytesOf(artWebp);

  const everything = boot.filter((w) => w.status === 200);
  const totalBytes = await bytesOf(everything);
  const scriptBytes = await bytesOf(everything.filter((w) => w.url.endsWith(".js")));
  const cssBytes = await bytesOf(everything.filter((w) => w.url.endsWith(".css")));

  /**
   * The route that was reached, not the route that was asked for.
   *
   * A fresh profile is redirected — `#lobby`, `#collection` and `#gallery` all
   * land on the starter picker until a faction is chosen — so the first version
   * of this printed three different headings above three identical
   * measurements. That is exactly the shape of instrument thirteen in
   * `docs/VISUAL-OVERHAUL-STATE.md`: a true measurement under a false label.
   */
  const reached = await page.evaluate(() => location.hash.replace(/^#/, "") || "(none)");
  const label = reached === ROUTE ? `#${ROUTE}` : `#${ROUTE} → redirected to #${reached}`;

  console.log(`\n${label} on the built site (${ORIGIN}, serving dist/ with no SPA fallback)\n`);
  console.log(`  COLD FIRST LOAD — what a stranger downloads before touching anything`);
  console.log(`    JS                    ${(scriptBytes / 1024).toFixed(0)} KB`);
  console.log(`    CSS                   ${(cssBytes / 1024).toFixed(0)} KB`);
  console.log(`    everything            ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${everything.length} responses`);
  for (const group of ["/assets/icons/", "/assets/boards/", "/assets/brand/", "/assets/art/", "/assets/audio/"]) {
    const rows = everything.filter((w) => w.url.includes(group));
    if (rows.length) console.log(`    ${group.padEnd(20)}  ${String(rows.length).padStart(3)} responses, ${((await bytesOf(rows)) / 1024).toFixed(0)} KB`);
  }

  /**
   * The same page, before this change — arithmetic, not an estimate.
   *
   * The request list is fixed: the loaders ask for the same *pictures* either
   * way, only the extension differs. So swapping each response's byte count for
   * the byte count of the master it was encoded from gives exactly what this
   * page weighed when `dist` carried the masters. Anything with no master
   * (the JS, the CSS, the font) contributes its real size unchanged.
   */
  const { readFileSync } = await import("node:fs");
  let asMasters = 0;
  for (const row of everything) {
    const master = path.join(ROOT, "public", row.url.replace(/^\//, "").replace(/\.webp$/, ".png"));
    if (row.url.startsWith("/assets/") && existsSync(master)) {
      asMasters += readFileSync(master).length;
    } else {
      try {
        asMasters += (await row.response.body()).length;
      } catch {
        /* nothing retrievable, nothing to add */
      }
    }
  }
  console.log(
    `    the same page as masters ${(asMasters / 1024 / 1024).toFixed(2)} MB` +
      ` — ${(asMasters / Math.max(totalBytes, 1)).toFixed(1)}x what it is now`
  );

  console.log(`\n  #${reached} ONCE IT IS ON SCREEN`);
  console.log(`    card images requested ${art.length}`);
  console.log(`    ...as webp, 200       ${artWebp.length}`);
  console.log(`    ...as png (fallback)  ${artPng.length}`);
  console.log(`    on the wire           ${(artBytes / 1024).toFixed(0)} KB` + (artWebp.length ? `  (${(artBytes / artWebp.length / 1024).toFixed(1)} KB each)` : ""));

  const check = (ok, message) => {
    console.log(`   ${ok ? "ok" : "FAIL"}: ${message}`);
    if (!ok) failures++;
  };

  /**
   * The whole set, not the handful a grid happened to show.
   *
   * A card grid virtualises, so "how many did this screen request" is a fact
   * about the screen and not about the art. The question this instrument exists
   * to answer — *does the art arrive, and what does it weigh* — is only decided
   * by asking for all 296, which is also the deployed-shape twin of what
   * `verify:art` §3 does against the dev server.
   */
  const { readdirSync } = await import("node:fs");
  const every = readdirSync(path.join(ROOT, "public", "assets", "art"))
    .filter((f) => f.endsWith(".png"))
    .map((f) => `assets/art/${f.replace(/\.png$/, ".webp")}`);

  const all = await page.evaluate(
    (urls) =>
      Promise.all(
        urls.map(
          (u) =>
            new Promise((resolve) => {
              const image = new Image();
              image.onload = () => resolve({ u, size: `${image.naturalWidth}x${image.naturalHeight}` });
              image.onerror = () => resolve({ u, size: "failed" });
              image.src = u;
            })
        )
      ),
    every
  );

  let allBytes = 0;
  let counted = 0;
  for (const row of wire.filter((w) => w.url.endsWith(".webp") && w.url.includes("/assets/art/") && w.status === 200)) {
    try {
      allBytes += (await row.response.body()).length;
      counted++;
    } catch {
      /* ignore */
    }
  }
  const bad = all.filter((r) => r.size !== "512x680");

  console.log(`\n  all ${every.length} card images fetched from the built site`);
  console.log(`  decoded at 512x680      ${all.length - bad.length}/${all.length}`);
  console.log(`  total on the wire       ${(allBytes / 1024 / 1024).toFixed(2)} MB over ${counted} responses (${(allBytes / Math.max(counted, 1) / 1024).toFixed(1)} KB each)`);
  console.log(`  the same set as PNG     122.42 MB — the figure the owner was served before this change`);

  /**
   * Every failed request, listed rather than counted.
   *
   * The loader walks an extension list and a miss is *designed* to be silent —
   * that is what lets a card with no painting fall back to procedural art with
   * no error anywhere. The same silence hides a miss that is nobody's intention,
   * so the ones this build makes are printed and have to be explained.
   */
  const missed = wire.filter((w) => w.status === 404);
  console.log(`\n  failed requests: ${missed.length}`);
  for (const m of [...new Set(missed.map((w) => w.url))]) console.log(`     404  ${m}`);

  console.log("");
  check(all.length - bad.length === every.length, `every one of the ${every.length} card images decoded at 512x680 (${bad.length} did not)`);
  check(artPng.length === 0, `#${ROUTE} requested no card PNG (got ${artPng.length}) — the master is not in dist, so one would be a wasted 404`);
  const wrongType = artWebp.filter((w) => !w.type.includes("image/webp"));
  check(wrongType.length === 0, `every card image the screen asked for was served as image/webp (${wrongType.length} were not)`);
  check(artWebp.length >= MIN_CARDS, `#${ROUTE} painted at least ${MIN_CARDS} cards from art (got ${artWebp.length}) — a light page with no art is not a pass`);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nPASS — the art arrives, as webp, at full size." : `\nFAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
