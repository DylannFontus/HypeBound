/**
 * Play the game the way a player does, and film every step of it.
 *
 * Every previous integration review jumped straight to a hash and photographed
 * what landed. That measures forty-nine screens; it does not measure a *game*,
 * because the things a player actually complains about live in the joins — the
 * frame after the click, the screen that is alive for two seconds and then dies,
 * the drag that has no mat under it. So this drives one long-lived page through
 * the real click path, with a PNG screencast running across each join.
 *
 * ## Why PNG and not JPEG
 *
 * `lib/png.mjs` explains it: JPEG's own quantisation noise sits near 0.3 mean
 * absolute delta between two identical frames, which is half the measured
 * Hearthstone idle floor (0.50 min, 1.71 median across 203 reference pairs, see
 * `_ic6_calib.mjs`). A JPEG reel reports a frozen screen as alive. Lossless or
 * the number is fiction.
 *
 * ## Why every stage prints its own landing hash
 *
 * The census learned this the hard way with `#queue`, which redirects to
 * `#signin` and was surveyed for years as though it were the queue. A stage that
 * says "collection" and is actually looking at the lobby is the same defect, so
 * each step records `location.hash` and the selector it found, and a step that
 * could not find its control says so instead of quietly photographing whatever
 * was already on screen.
 *
 *   node scripts/_ic6_journey.mjs <stage> [--size WxH] [--scale-ui 1.4] [--dir d]
 *
 * stages: cold | menus | match | back | tail
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { createIdleSampler, gridNote } from "./lib/idle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const stage = argv[0] ?? "menus";
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const UI_SCALE = Number(flag("scale-ui", 0)) || 0;
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w6", "critic-final")));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`console: ${m.text()}`));

const session = await page.context().newCDPSession(page);
let reel = [];
let filming = false;
session.on("Page.screencastFrame", (f) => {
  if (filming) reel.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

async function startFilm() {
  reel = [];
  filming = true;
  await session.send("Page.startScreencast", {
    format: "png",
    everyNthFrame: 1,
    maxWidth: VW,
    maxHeight: VH,
  });
}

function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < n; i += a.channels * 2) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

/**
 * Stop the reel and report it. `t0` is the wall clock of the action, so the
 * first column answers "how long after the click did any pixel move".
 */
async function stopFilm(label, t0, { keep = 0 } = {}) {
  filming = false;
  await session.send("Page.stopScreencast").catch(() => {});
  const frames = reel.map((f) => ({ t: Math.round(f.t - t0), buf: Buffer.from(f.data, "base64") }));
  const rows = [];
  let prev = null;
  for (const f of frames) {
    const img = decodePng(f.buf);
    const d = prev ? meanDelta(prev, img) : null;
    rows.push({ t: f.t, d });
    prev = img;
  }
  const moved = rows.find((r) => r.d !== null && r.d > 0.5);
  const last = [...rows].reverse().find((r) => r.d !== null && r.d > 0.5);
  console.log(
    `\n[film] ${label}: ${rows.length} frames  ` +
      `first-move=${moved ? moved.t + "ms" : "NEVER"}  ` +
      `last-move=${last ? last.t + "ms" : "-"}  ` +
      `peak=${Math.max(0, ...rows.map((r) => r.d ?? 0)).toFixed(2)}`
  );
  console.log(
    "       " +
      rows
        .map((r) => `${r.t}:${r.d === null ? "-" : r.d.toFixed(2)}`)
        .join(" ")
        .slice(0, 1600)
  );
  // keep a handful of frames spread across the reel, so the join can be looked at
  if (keep > 0 && frames.length) {
    for (let k = 0; k < keep; k += 1) {
      const f = frames[Math.min(frames.length - 1, Math.round((k * (frames.length - 1)) / (keep - 1 || 1)))];
      writeFileSync(path.join(OUT, `${label}-f${k}-t${f.t}.png`), f.buf);
    }
  }
  return rows;
}

/**
 * Sample the screen on a 200ms grid, exactly like the reference frames.
 *
 * It did not used to be a 200ms grid. This function was `screenshot()` then
 * `waitForTimeout(200)`, which on this machine runs at 843ms because a 1600x900
 * `page.screenshot()` costs 691ms — so every "per 200ms" figure this file has
 * printed was over-stated by about four times the interval. `lib/idle.mjs` has
 * the sampler and the argument; the short version is that the capture is now
 * cheap enough to sleep the *remainder* of the period, and the interval it
 * achieved is printed beside the number so that this cannot recur silently.
 */
let sampler = null;
async function idle(label, seconds = 3) {
  if (!sampler) sampler = await createIdleSampler(page, { lagMs: 200 });
  const s = await sampler({ seconds });
  console.log(
    `[idle] ${label}: n=${s.n} min=${s.min.toFixed(3)} median=${s.median.toFixed(3)} max=${s.max.toFixed(3)}  ` +
      `[reference: min 0.50 median 1.71]  ` +
      (!s.onGrid ? "NO VERDICT" : s.median < 0.5 ? "BELOW REFERENCE FLOOR" : "alive") +
      `   ${gridNote(s)}`
  );
  return s;
}

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return name;
};

const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});

const where = async () => page.evaluate(() => location.hash);

/** Click a real control, filming the join. Reports what it found. */
async function navigate(label, selector, { keep = 5, hold = 1400 } = {}) {
  const loc = page.locator(selector).first();
  const n = await loc.count();
  if (!n) {
    console.log(`\n!! ${label}: selector ${selector} NOT FOUND (still at ${await where()})`);
    return false;
  }
  await startFilm();
  const t0 = Date.now();
  await loc.click({ timeout: 8000 }).catch((e) => console.log(`   click failed: ${e.message.slice(0, 80)}`));
  await page.waitForTimeout(hold);
  await stopFilm(label, t0, { keep });
  await settled();
  console.log(`   landed: ${await where()}`);
  return true;
}

async function applyUiScale() {
  if (!UI_SCALE) return;
  await page.evaluate((s) => {
    const store = document.documentElement;
    store.style.setProperty("--ui-scale", String(s));
    try {
      const key = "hypebound:settings";
      const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
      raw.data = { ...(raw.data ?? {}), uiScale: s };
      localStorage.setItem(key, JSON.stringify(raw));
    } catch {}
  }, UI_SCALE);
}

try {
  if (stage === "cold") {
    // --- a brand-new account, with the cinematic allowed to play --------------
    await startFilm();
    const t0 = Date.now();
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await stopFilm("10-cold-boot", t0, { keep: 9 });
    console.log(`   after boot: ${await where()}`);
    await shot("11-cold-landing");
    await idle("cold landing", 3);

    // the skip affordance, then whatever the game shows a new player
    await page.keyboard.press("Space").catch(() => {});
    await page.waitForTimeout(1500);
    await settled();
    console.log(`   after skip: ${await where()}`);
    await shot("12-after-skip");
    const starter = await page.locator(".starter-screen").count();
    console.log(`   .starter-screen present: ${starter}`);
    if (starter) {
      await idle("starter", 3);
      await shot("13-starter");
      const cards = page.locator(".starter-screen button, .starter-option, .starter-card");
      console.log(`   starter choices found: ${await cards.count()}`);
      const names = await page.evaluate(() =>
        [...document.querySelectorAll(".starter-screen button")].map(
          (b) => (b.className || "") + " :: " + (b.textContent || "").trim().slice(0, 40)
        )
      );
      console.log("   " + names.join("\n   "));
    }
  }

  if (stage === "starterpick") {
    await page.goto(ORIGIN, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const o = document.querySelector(".intro-root, .intro-overlay, #intro");
      o?.remove();
    });
    await page.goto(`${ORIGIN}/?nointro#starter`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1200);
    await shot("13-starter");
    await idle("starter", 3);
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll(".starter-screen button")].map((b, i) => `${i} ${b.className} :: ${(b.textContent || "").trim().slice(0, 50)}`)
    );
    console.log(btns.join("\n"));
    // hover state on a faction
    const first = page.locator(".starter-screen button").first();
    if (await first.count()) {
      await first.hover();
      await page.waitForTimeout(400);
      await shot("13b-starter-hover");
    }
    // choose it for real, and film the join into the lobby
    await startFilm();
    const t0 = Date.now();
    await page.locator(".starter-screen button").nth(1).click({ timeout: 8000 }).catch((e) => console.log(e.message.slice(0, 90)));
    await page.waitForTimeout(3000);
    await stopFilm("14-starter-to-lobby", t0, { keep: 7 });
    await settled();
    console.log(`   landed: ${await where()}`);
    await shot("15-lobby-fresh");
  }

  if (stage === "menus") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1500);
    await shot("20-lobby");
    await idle("lobby at rest", 3);

    // hover the hero, then a destination tile
    await page.locator("#lobby-play").hover();
    await page.waitForTimeout(300);
    await shot("21-lobby-play-hover");
    await page.locator("#lobby-collection").hover().catch(() => {});
    await page.waitForTimeout(300);
    await shot("22-lobby-tile-hover");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    await shot("23-lobby-focus");

    await navigate("24-nav-lobby-to-collection", "#lobby-collection", { keep: 7, hold: 1800 });
    await page.waitForTimeout(900);
    await shot("25-collection");
    await idle("collection at rest", 3);

    const collControls = await page.evaluate(() =>
      [...document.querySelectorAll(".screen button, .screen a")]
        .map((b) => `${b.id || b.className} :: ${(b.textContent || "").trim().slice(0, 26)}`)
        .slice(0, 24)
    );
    console.log("   collection controls:\n   " + collControls.join("\n   "));
    await navigate("26-nav-collection-to-deckbuilder", "#collection-back", {
      keep: 7,
      hold: 1800,
    });
    await page.waitForTimeout(500);
    await navigate("26c-nav-lobby-to-builder", "#lobby-builder", { keep: 7, hold: 1800 });
    if ((await where()).replace("#", "").split("?")[0] !== "deckbuilder") {
      console.log("   fallback: hash to #deckbuilder");
      await startFilm();
      const t0 = Date.now();
      await page.evaluate(() => (location.hash = "#deckbuilder"));
      await page.waitForTimeout(1800);
      await stopFilm("26b-nav-to-deckbuilder", t0, { keep: 7 });
      await settled();
    }
    await page.waitForTimeout(900);
    await shot("27-deckbuilder");
    await idle("deck builder at rest", 3);

    await navigate("28-nav-back-to-lobby", ".screen-back, .back-btn, #db-back, [data-back]", { keep: 7, hold: 1600 });
    if ((await where()).replace("#", "").split("?")[0] !== "lobby") {
      await startFilm();
      const t0 = Date.now();
      await page.evaluate(() => (location.hash = "#lobby"));
      await page.waitForTimeout(1600);
      await stopFilm("28b-nav-ascend-to-lobby", t0, { keep: 7 });
      await settled();
    }
    await shot("29-lobby-return");
  }

  if (stage === "match") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1200);

    await navigate("30-nav-lobby-to-play", "#lobby-play", { keep: 7, hold: 1800 });
    await page.waitForTimeout(700);
    await shot("31-play");
    await idle("play menu at rest", 3);

    // the curtain: PLAY menu -> a live board
    const modes = await page.evaluate(() =>
      [...document.querySelectorAll(".screen button, .screen a")].map((b) => `${b.id || b.className} :: ${(b.textContent || "").trim().slice(0, 32)}`).slice(0, 40)
    );
    console.log("   play-screen controls:\n   " + modes.join("\n   "));

    const practice = page.locator(".mode-card", { hasText: "Practice vs AI" }).first();
    await practice.click({ timeout: 8000 }).catch((e) => console.log("   " + e.message.slice(0, 80)));
    await page.waitForTimeout(900);
    await shot("31b-difficulty-sheet");
    await startFilm();
    const t0 = Date.now();
    await page
      .locator(".difficulty-option", { hasText: "Casual" })
      .first()
      .click({ timeout: 8000 })
      .catch((e) => console.log("   " + e.message.slice(0, 80)));
    await page.waitForTimeout(6000);
    await stopFilm("32-curtain-into-battle", t0, { keep: 12 });
    console.log(`   landed: ${await where()}`);

    await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => console.log("   NO MULLIGAN PANEL"));
    await page.waitForTimeout(1200);
    await shot("33-mulligan");
    await idle("mulligan at rest", 3);

    // toggle one card, then keep
    const mullCards = page.locator(".mulligan-panel .card, .mulligan-card, .mulligan-panel canvas");
    console.log(`   mulligan cards: ${await mullCards.count()}`);
    if (await mullCards.count()) {
      await mullCards.first().click().catch(() => {});
      await page.waitForTimeout(500);
      await shot("34-mulligan-toggled");
    }
    await startFilm();
    const t1 = Date.now();
    await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
    await page.waitForTimeout(5000);
    await stopFilm("35-mulligan-to-board", t1, { keep: 8 });
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn") !== null, null, { timeout: 30000 })
      .catch(() => console.log("   NO END TURN BUTTON"));
    await page.waitForTimeout(2000);
    await shot("36-board");
    await idle("board at rest", 4);
  }

  if (stage === "drag") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
    await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
      .catch(() => console.log("   no enabled end-turn"));
    await page.waitForTimeout(2500);
    await shot("40-board-my-turn");

    const handInfo = await page.evaluate(() =>
      [...document.querySelectorAll(".hand-card")].map((e, i) => `${i} ${e.className}`)
    );
    console.log("   hand: \n   " + handInfo.join("\n   "));
    const hand = page.locator(".hand-card.playable");
    const nHand = await hand.count();
    console.log(`   playable hand cards: ${nHand}`);
    if (nHand) {
      const box = await hand.nth(0).boundingBox();
      console.log(`   grabbing card at ${JSON.stringify(box)}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
      await shot("41-hand-hover");

      await startFilm();
      const t0 = Date.now();
      await page.mouse.down();
      for (let i = 1; i <= 14; i += 1) {
        await page.mouse.move(
          box.x + box.width / 2 + (VW * 0.02 * i) / 14,
          box.y + box.height / 2 - (VH * 0.42 * i) / 14
        );
        await page.waitForTimeout(45);
      }
      await page.waitForTimeout(900);
      await stopFilm("42-drag-over-mat", t0, { keep: 9 });
      await shot("43-drag-held");
      const dropInfo = await page.evaluate(() => {
        const q = (s) => [...document.querySelectorAll(s)];
        return {
          dragging: q("[data-dragging], .dragging, .card-dragging").length,
          slots: q(".drop-slot, .board-slot, .slot-hint, [data-drop]").map(
            (e) => `${e.className} vis=${getComputedStyle(e).opacity}`
          ),
          canvasHint: q("canvas").length,
        };
      });
      console.log("   drop targets: " + JSON.stringify(dropInfo).slice(0, 700));

      await startFilm();
      const t1 = Date.now();
      await page.mouse.up();
      await page.waitForTimeout(2600);
      await stopFilm("44-drop-resolve", t1, { keep: 9 });
      await page.waitForTimeout(900);
      await shot("45-after-play");
    }
  }

  if (stage === "attack") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
    await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
      .catch(() => {});
    await page.waitForTimeout(2500);

    // play the cheapest playable card first, so there is something to attack with
    const playable = page.locator(".hand-card.playable");
    if (await playable.count()) {
      const box = await playable.nth(0).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - (VH * 0.3 * i) / 10);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
      await page.waitForTimeout(2200);
    }
    await shot("49-after-first-play");

    // end turn: does it confirm when Hype is still unspent?
    await startFilm();
    const t0 = Date.now();
    await page.locator(".end-turn-btn").first().click().catch(() => {});
    await page.waitForTimeout(1600);
    await stopFilm("50-end-turn-press", t0, { keep: 7 });
    await shot("51-end-turn-confirm");
    const confirm = await page.evaluate(() => {
      const m = document.querySelector(".modal, .confirm, .dialog, [role='dialog'], .end-turn-confirm");
      return m ? { cls: m.className, text: (m.textContent || "").trim().slice(0, 200) } : null;
    });
    console.log("   confirm dialog: " + JSON.stringify(confirm));
    if (confirm) {
      await startFilm();
      const t1 = Date.now();
      await page
        .locator("[role='dialog'] .btn-primary, .modal .btn-primary, .confirm .btn-primary")
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(2200);
      await stopFilm("52-confirm-accept", t1, { keep: 6 });
    }
    await page.waitForTimeout(3500);
    await shot("53-rival-turn");
    await idle("rival turn", 4);

    // wait for my turn again, then attack the rival leader with the unit I played
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 60000 })
      .catch(() => console.log("   never got the turn back"));
    await page.waitForTimeout(2500);
    await shot("54-my-second-turn");

    const geom = await page.evaluate(() => {
      const w = window;
      const api = w.__battleDebug ?? w.hypeboundBattle ?? null;
      return { api: Boolean(api), keys: api ? Object.keys(api).slice(0, 20) : [] };
    });
    console.log("   battle debug api: " + JSON.stringify(geom));

    // the mat is a canvas: attack by dragging from my unit's screen position to the
    // rival leader's. Both are drawn by three.js, so the coordinates come from the
    // stills rather than from the DOM.
    const from = { x: VW * 0.5, y: VH * 0.5 + 20 };
    const to = { x: VW * 0.5, y: VH * 0.17 };
    await startFilm();
    const t2 = Date.now();
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(400);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(500);
    await shot("55-attack-arrow");
    await page.mouse.up();
    await page.waitForTimeout(2600);
    await stopFilm("56-attack", t2, { keep: 9 });
    await shot("57-after-attack");
  }

  if (stage === "drop") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
    await settled();
    await page.waitForTimeout(1500);
    await shot("60-shop");
    await idle("shop at rest", 3);
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll(".screen button")].map((b) => `${b.id || b.className} :: ${(b.textContent || "").trim().slice(0, 34)}`)
    );
    console.log("   shop controls:\n   " + controls.join("\n   "));

    await startFilm();
    const t0 = Date.now();
    await page
      .locator("button", { hasText: "Open a free Drop" })
      .first()
      .click({ timeout: 8000 })
      .catch((e) => console.log("   " + e.message.slice(0, 90)));
    await page.waitForTimeout(4500);
    await stopFilm("61a-pack-open", t0, { keep: 10 });
    await shot("61b-pack-mid");
    await idle("pack opening at rest", 3);

    // tear it open, then walk the reveal
    await startFilm();
    const t1 = Date.now();
    await page.locator("#rw-pack").click({ timeout: 8000 }).catch((e) => console.log("   " + e.message.slice(0, 90)));
    await page.waitForTimeout(3800);
    await stopFilm("61c-pack-tear", t1, { keep: 10 });
    await shot("61d-pack-torn");
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Space").catch(() => {});
      await page.waitForTimeout(700);
      await shot(`61e-reveal-${i}`);
    }
    await page.waitForTimeout(1200);
    await shot("61f-pack-revealed");
    await idle("reveal at rest", 3);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll(".screen button, body > * button")].map((b) => `${b.id || b.className} :: ${(b.textContent || "").trim().slice(0, 30)}`).slice(0, 20)
    );
    console.log("   after-reveal controls:\n   " + after.join("\n   "));
  }

  if (stage === "tail") {
    await seedPlayedAccount(page, ORIGIN);
    await applyUiScale();
    const legs = [
      ["60-shop", "shop"],
      ["62-pass", "pass"],
      ["63-profile", "profile"],
      ["64-stats", "stats"],
      ["65-settings", "settings"],
      ["66-lab", "lab"],
      ["67-doomscroll", "doomscroll"],
      ["68-custom", "custom"],
      ["69-remixhub", "remixhub"],
      ["70-gallery", "gallery"],
      ["71-leaderboards", "leaderboards"],
      ["72-replays", "replays"],
      ["73-uikit", "uikit"],
      ["74-story", "story"],
      ["75-gauntlet", "gauntlet"],
      ["76-events", "events"],
      ["77-decks", "decks"],
    ];
    for (const [name, route] of legs) {
      await page.evaluate(() => (location.hash = "#lobby"));
      await settled();
      await page.waitForTimeout(500);
      await startFilm();
      const t0 = Date.now();
      await page.evaluate((r) => (location.hash = `#${r}`), route);
      await page.waitForTimeout(1500);
      await stopFilm(`nav-${route}`, t0, { keep: 0 });
      await settled();
      await page.waitForTimeout(900);
      await shot(name);
      console.log(`   ${name} landed ${await where()}`);
      await idle(route, 2);
    }
  }
} finally {
  if (pageErrors.length) {
    console.log(`\n${pageErrors.length} page error(s):`);
    for (const e of [...new Set(pageErrors)].slice(0, 12)) console.log("  " + e.slice(0, 160));
  }
  await browser.close();
}
