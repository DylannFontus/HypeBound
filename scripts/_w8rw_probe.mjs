/**
 * The three claims in this wave's rewards brief, reproduced before they are
 * believed — and one of them turned out to be an artefact of *how* it was
 * counted rather than of what is on screen.
 *
 * Nine instruments have lied in this project, so this one only does the things
 * `_w7rw_probe.mjs` does not, and it never reports a motion number: that file is
 * the validated one for deltas (200ms lag, calibrated against
 * `hearthstone_frames/`) and duplicating its arithmetic here would be a tenth
 * candidate for no gain. What this does is geometry and computed style, both of
 * which are exact rather than statistical.
 *
 * Three modes:
 *
 *   flat   <route>   every element the census would call a flat fill, named,
 *                    with its computed background, its box and — the part the
 *                    census cannot see — whether it has a *painted child that
 *                    fills it*, which is the difference between a solid panel
 *                    and a tint over a photograph.
 *   pack             the overlay's own boxes: what fraction of the frame the
 *                    cards occupy, and how tall the empty band above them is.
 *   bands  <png>     the same emptiness measured off the pixels instead of the
 *                    DOM: per-scanline luminance range, so a band with nothing
 *                    in it is a run of rows whose range is under a threshold.
 *                    A DOM box can lie about what is visible; a scanline cannot.
 *
 * The `bands` mode exists because "85% empty" is a claim about pixels and the
 * honest way to check it is to look at pixels. It reads a PNG that
 * `shot.mjs` already wrote rather than driving its own browser, so the picture
 * being measured is exactly the picture that was looked at.
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "flat";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);

/* ------------------------------------------------------------------ bands */

if (mode === "bands") {
  const file = path.resolve(argv[1] ?? path.join(HERE, "screenshots", "w8", "rewards", "pk-base-dealt.png"));
  const img = decodePng(readFileSync(file));
  const { width, height, channels, data } = img;
  /*
   * The 99th percentile of a row's luminance, not its range.
   *
   * Range was the first attempt and it reported 0 empty scanlines on a frame
   * that is visibly two-thirds void — because `.rw-open-room::after` lays module
   * B's grain over the whole overlay at 50% opacity, and grain gives *every* row
   * a spread of fifteen or twenty levels. A metric that a texture defeats is a
   * metric that measures the texture. What actually separates a band with
   * something in it from a band without is whether anything in the row is
   * **bright**: a card face, a glyph, a lit edge. Grain on near-black is not.
   */
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const lums = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      lums[x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    lums.sort();
    rows.push(lums[Math.floor(width * 0.99)]);
  }
  /* Nothing in the row is brighter than 24% grey. Every card face, every piece
     of type and every lit rim in this overlay clears that by a wide margin. */
  const THRESHOLD = Number(flag("threshold", 60));
  const runs = [];
  let start = -1;
  for (let y = 0; y <= height; y += 1) {
    const empty = y < height && rows[y] < THRESHOLD;
    if (empty && start < 0) start = y;
    if (!empty && start >= 0) {
      if (y - start >= 24) runs.push([start, y - 1, y - start]);
      start = -1;
    }
  }
  const emptyRows = rows.filter((r) => r < THRESHOLD).length;
  console.log(`[bands] ${path.basename(file)}  ${width}x${height}`);
  console.log(
    `        empty scanlines ${emptyRows}/${height} (${((emptyRows / height) * 100).toFixed(1)}%)  ` +
      `p99 threshold=${THRESHOLD}/255`
  );
  for (const [a, b, n] of runs) console.log(`        dead band y=${a}..${b}  (${n}px)`);
  process.exit(0);
}

/* ------------------------------------------------------------------ browser */

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("!! pageerror", e.message));
const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});

/**
 * The census rule, and then the question the census does not ask.
 *
 * `_w4rec_census.mjs` calls an element flat when it has a background *colour*,
 * no background image and no box shadow, and is bigger than 120x60. That is the
 * right rule for a panel. It is the wrong rule for a box whose entire area is
 * covered by a painted child — a scrim over a card canvas is a *glaze*, and the
 * bar bans a solid fill on a surface, not a tint over an image. So this reports
 * both: the census verdict, and whether a child element covers the box.
 */
const FLAT = `(() => {
  const s = document.querySelector(".screen");
  if (!s) return { err: "no screen" };
  const out = [];
  for (const e of s.querySelectorAll("*")) {
    const b = e.getBoundingClientRect();
    if (!(b.width > 120 && b.height > 60)) continue;
    const cs = getComputedStyle(e);
    if (cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent") continue;
    if (cs.backgroundImage !== "none") continue;
    if (cs.boxShadow !== "none") continue;
    let covered = null;
    for (const c of e.children) {
      const cb = c.getBoundingClientRect();
      if (cb.width >= b.width - 2 && cb.height >= b.height - 2) covered = c.tagName.toLowerCase() + "." + String(c.className || "").split(" ")[0];
    }
    out.push({
      sel: e.tagName.toLowerCase() + "." + String(e.className || "").trim().split(/\\s+/).join("."),
      bg: cs.backgroundColor,
      box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      covered,
      kids: e.childElementCount,
    });
  }
  return out;
})()`;

try {
  if (mode === "flat") {
    const route = argv[1] ?? "banner";
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1400);
    const rows = await page.evaluate(FLAT);
    console.log(`[flat] #${route}: ${Array.isArray(rows) ? rows.length : rows.err} candidates`);
    for (const r of rows ?? []) {
      console.log(
        `   ${r.sel}\n      bg=${r.bg} box=${r.box.join(",")} kids=${r.kids} coveredBy=${r.covered ?? "-"}`
      );
    }
  }

  /*
   * What a bigger card actually costs to draw.
   *
   * `packOpening.ts` caps a revealed card at 212 CSS pixels and the note beside
   * the paint queue says one face is 150-250ms of main thread — which, if it
   * scales with area, would make a 282px card 260-440ms and rule the whole
   * composition fix out. Worth knowing rather than assuming, because the number
   * decides the design.
   */
  if (mode === "cost") {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1200);
    /* Bisecting a 615ms task that appeared on the frame the overlay mounts: the
       only new thing painting on that frame is the beam's blur, and the honest
       way to find out is to switch it off and press Buy again. */
    if (argv.includes("--noblur")) await page.addStyleTag({ content: ".rw-room-beam::before { filter: none !important; }" });
    if (argv.includes("--nobeam")) await page.addStyleTag({ content: ".rw-room-beam { display: none !important; }" });
    await page.evaluate(() => {
      window.__tasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__tasks.push([Math.round(e.startTime), Math.round(e.duration)]);
      }).observe({ entryTypes: ["longtask"] });
      window.__t0 = performance.now();
    });
    await page.locator("#shop-buy").click({ timeout: 8000 });
    await page.waitForSelector(".rw-open", { timeout: 8000 });
    /* The whole anticipation beat, which is where every face is painted. */
    await page.waitForTimeout(4200);
    const out = await page.evaluate(() => ({
      cardW: getComputedStyle(document.querySelector(".reveal-cards")).getPropertyValue("--rw-card-w").trim(),
      t0: Math.round(window.__t0),
      tasks: window.__tasks.filter((t) => t[0] >= window.__t0).map(([s, d]) => [s - Math.round(window.__t0), d]),
    }));
    const ds = out.tasks.map((t) => t[1]).sort((a, b) => a - b);
    console.log(
      `[cost] card width ${out.cardW}: ${ds.length} long tasks in the 4.2s after Buy, ` +
        `max=${ds.at(-1) ?? 0}ms  total=${ds.reduce((a, b) => a + b, 0)}ms`
    );
    console.log("       " + out.tasks.map(([s, d]) => `${s}:+${d}`).join(" "));
  }

  /*
   * When does a portrait actually arrive, and what is it a portrait of?
   *
   * The claim under test is "absent at 1300ms, present at 5000ms". Counting
   * canvases answers half of it; the other half is that a tile can hold a canvas
   * and still be wrong, because `portraitCanvas` draws the procedural
   * placeholder when the PNG has not loaded and then **repaints the same canvas
   * in place** when it does. So the tiles that are wearing the "art pending"
   * mark are counted separately: a tile that goes pending and then un-pends is a
   * second arrival the player sees, and §7 applies to it too.
   */
  if (mode === "gallery") {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(700);
    const t0 = Date.now();
    await page.evaluate(() => (location.hash = "#gallery"));
    const rows = [];
    for (let i = 0; i < 30; i += 1) {
      rows.push({
        t: Date.now() - t0,
        ...(await page.evaluate(() => {
          const tiles = [...document.querySelectorAll(".gal-tile")];
          const shown = tiles.filter((t) => t.getBoundingClientRect().top < innerHeight && t.getBoundingClientRect().bottom > 0);
          return {
            tiles: tiles.length,
            visible: shown.length,
            drawn: shown.filter((t) => t.querySelector("canvas")).length,
            pending: shown.filter((t) => t.classList.contains("no-art")).length,
          };
        })),
      });
      await page.waitForTimeout(200);
    }
    console.log("[gallery] t(ms)  visible  drawn  art-pending");
    for (const r of rows) console.log(`          ${String(r.t).padStart(5)}  ${String(r.visible).padStart(7)}  ${String(r.drawn).padStart(5)}  ${String(r.pending).padStart(11)}`);
    const full = rows.find((r) => r.visible > 0 && r.drawn >= r.visible);
    console.log(`[gallery] every visible tile drawn at ${full ? full.t + "ms" : "NEVER within 6s"}`);
    /* The entrance, read off the computed style rather than assumed from the
       stylesheet: a cascade that does not reach the canvas is a cascade that
       exists only in the source. */
    console.log(
      "[gallery] portrait entrance: " +
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll(".gal-tile")].slice(0, 14).map((t) => {
              const c = t.querySelector("canvas");
              if (!c) return null;
              const cs = getComputedStyle(c);
              return `${cs.animationName}@${cs.animationDelay}`;
            })
          )
        )
    );
  }

  if (mode === "pack") {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1200);
    /* Say whether the button was live before pressing it. A run of this probe
       reported "#rw-pack never appeared" on a screen where the real answer was
       that Buy was disabled — the same class of silent-miss the whole
       instrument-lies list is made of. */
    console.log(
      "[dom] #shop-buy ->",
      JSON.stringify(
        await page.evaluate(() => {
          const b = document.querySelector("#shop-buy");
          return b ? { disabled: b.disabled, text: b.textContent.trim().slice(0, 40) } : null;
        })
      )
    );
    await page.locator("#shop-buy").click({ timeout: 8000 });
    await page.waitForSelector(".rw-open", { timeout: 8000 });
    await page.waitForTimeout(2200);
    /* `locator.click()` waits for the element to be *stable*, and the pack is
       floating on a 5.2s loop for as long as it exists — so Playwright retries
       until the element detaches and then reports a timeout on a screen that was
       working perfectly. The mouse goes to the measured centre instead, which is
       what `_w7rw_probe.mjs` learned to do for the same reason. */
    const packBox = await page.locator("#rw-pack").boundingBox();
    await page.mouse.click(packBox.x + packBox.width / 2, packBox.y + packBox.height / 2);
    await page.waitForTimeout(2000);
    await page.locator("#reveal-all").click();
    await page.waitForTimeout(2600);
    const m = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (s) => {
        const e = q(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      };
      const slots = [...document.querySelectorAll(".reveal-slot")].map((e) => e.getBoundingClientRect());
      const hull = slots.length
        ? [
            Math.round(Math.min(...slots.map((r) => r.left))),
            Math.round(Math.min(...slots.map((r) => r.top))),
            Math.round(Math.max(...slots.map((r) => r.right)) - Math.min(...slots.map((r) => r.left))),
            Math.round(Math.max(...slots.map((r) => r.bottom)) - Math.min(...slots.map((r) => r.top))),
          ]
        : null;
      const foot = q(".rw-open-foot")?.getBoundingClientRect();
      const acts = q(".rw-open-actions")?.getBoundingClientRect();
      return {
        vw: innerWidth,
        vh: innerHeight,
        head: box(".rw-open-head"),
        title: box(".rw-open-title"),
        stage: box(".rw-stage"),
        grid: box(".reveal-cards"),
        cardW: getComputedStyle(q(".reveal-cards")).getPropertyValue("--rw-card-w").trim(),
        colGap: getComputedStyle(q(".reveal-cards")).columnGap,
        hull,
        foot: foot && [Math.round(foot.x), Math.round(foot.y), Math.round(foot.width), Math.round(foot.height)],
        acts: acts && [Math.round(acts.x), Math.round(acts.y), Math.round(acts.width), Math.round(acts.height)],
        footSlackLeft: foot && acts ? Math.round(acts.left - foot.left) : null,
        footSlackRight: foot && acts ? Math.round(foot.right - acts.right) : null,
        horizon: getComputedStyle(q(".rw-open-room")).getPropertyValue("--rw-horizon").trim(),
      };
    });
    const area = m.hull ? (m.hull[2] * m.hull[3]) / (m.vw * m.vh) : 0;
    console.log("[pack]", JSON.stringify(m, null, 2));
    console.log(`[pack] cards occupy ${(area * 100).toFixed(1)}% of the frame`);
    if (m.hull) console.log(`[pack] band above the cards: ${m.hull[1]}px  band below: ${m.vh - (m.hull[1] + m.hull[3])}px`);
  }
} finally {
  await browser.close();
}
