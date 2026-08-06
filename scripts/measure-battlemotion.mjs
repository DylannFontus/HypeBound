/**
 * Photograph the core verb of the game, frame by frame, on the real GPU.
 *
 * Four rounds of battle-motion review were run from stills and all four missed
 * the actual defect, because the thing being judged — "is the object the player
 * just dragged on screen right now?" — is a question about consecutive frames
 * and a still cannot answer it. This drives a live match through a card play and
 * a turn handover while a CDP screencast runs at the display's own rate, writes
 * every frame with its offset from the event in the filename, and prints a DOM
 * timeline beside it so the pictures and the numbers can be checked against each
 * other.
 *
 *   node scripts/measure-battlemotion.mjs                 # both phases
 *   node scripts/measure-battlemotion.mjs --phase play
 *   node scripts/measure-battlemotion.mjs --phase turn
 *   node scripts/measure-battlemotion.mjs --size 1280x720
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const phase = String(flag("phase", "both"));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const outDir = String(flag("dir", path.join(HERE, "screenshots", "w2", "battlemotion", "cast")));
const keepEvery = Number(flag("every", 2));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const cdp = await page.context().newCDPSession(page);
let frames = [];
let casting = false;
cdp.on("Page.screencastFrame", async (f) => {
  try {
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
  } catch {
    /* the cast was stopped between the frame and the ack */
  }
  if (casting) frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
});

const startCast = async () => {
  frames = [];
  casting = true;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
};
const stopCast = async (label, zeroAt) => {
  casting = false;
  await cdp.send("Page.stopScreencast");
  const kept = frames.filter((_, i) => i % keepEvery === 0);
  for (const [i, f] of kept.entries()) {
    const ms = Math.round(f.t - zeroAt);
    const name = `${label}-${String(i).padStart(2, "0")}-t${ms >= 0 ? "+" : ""}${ms}.jpeg`;
    writeFileSync(path.join(outDir, name), Buffer.from(f.data, "base64"));
  }
  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(Math.round(frames[i].t - frames[i - 1].t));
  console.log(
    `  cast ${label}: ${frames.length} frames over ${Math.round(frames.at(-1).t - frames[0].t)}ms ` +
      `(median gap ${median(gaps)}ms), wrote ${kept.length}`
  );
};
const median = (a) => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]);

/**
 * A rAF probe inside the page.
 *
 * It records only what is cheap to read — the drag ghost, the turn ribbon, any
 * element large enough to be covering the board, and long tasks — so it can run
 * at the frame rate without becoming the thing it is measuring.
 */
const PROBE = `
window.__probe = { rows: [], marks: [], longtasks: [], anims: [], faces: [] };
window.__probeT0 = performance.now();
/*
 * Every full card face drawn during the window, with its offset.
 *
 * A long-task entry says "something took 366ms" and a CPU profile says
 * "renderCard" without saying how many of them or when. A card face is the only
 * thing in this app that asks a canvas this size for a 2D context, so counting
 * those calls counts the renders exactly — and their offsets say whether the
 * prewarm moved them off the frames a token is moving through, which is the
 * whole question.
 */
if (!HTMLCanvasElement.prototype.__faceCounted) {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  proto.__faceCounted = true;
  proto.getContext = function (type, ...rest) {
    if (type === '2d' && this.width >= 300 && this.height >= 420 && window.__probe) {
      window.__probe.faces.push(Math.round(performance.now() - window.__probeT0));
    }
    return original.call(this, type, ...rest);
  };
}
const rect = (n) => { if (!n) return null; const r = n.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
const tick = () => {
  const ghost = document.querySelector('.hand-drag-ghost');
  const banner = document.querySelector('.turn-banner:not([hidden])');
  const blockers = [...document.querySelectorAll('.battle-hud > *, .battle-overlay, .turn-banner, .trigger-rail > *, .toast')]
    .filter((n) => { const r = n.getBoundingClientRect();
      return r.width * r.height > (innerWidth * innerHeight) * 0.04 &&
             r.left < innerWidth * 0.72 && r.right > innerWidth * 0.28 &&
             r.top < innerHeight * 0.66 && r.bottom > innerHeight * 0.24; })
    .map((n) => n.className);
  window.__probe.rows.push({
    t: Math.round(performance.now() - window.__probeT0),
    ghost: ghost ? { ...rect(ghost), o: +getComputedStyle(ghost).opacity } : null,
    banner: banner ? { ...rect(banner), o: +getComputedStyle(banner).opacity, cls: banner.className } : null,
    blockers,
  });
  window.__probeRaf = requestAnimationFrame(tick);
};
window.__probeRaf = requestAnimationFrame(tick);
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries())
    window.__probe.longtasks.push({ t: Math.round(e.startTime - window.__probeT0), d: Math.round(e.duration) }); })
    .observe({ entryTypes: ['longtask'] });
} catch {}
for (const type of ['animationstart', 'animationend', 'transitionstart']) {
  document.addEventListener(type, (e) => {
    const n = e.target;
    if (!(n instanceof Element)) return;
    window.__probe.anims.push({ t: Math.round(performance.now() - window.__probeT0), type,
      name: e.animationName || e.propertyName, cls: String(n.className).slice(0, 60) });
  }, true);
}
window.__mark = (name) => window.__probe.marks.push({ t: Math.round(performance.now() - window.__probeT0), name });
`;

const endTurnAndWait = async () => {
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 40000,
  });
  await page.click(".end-turn-btn");
  /**
   * The confirmation is mounted from an async handler, so `count()` on the very
   * next tick can legitimately be zero and then the panel appears a frame later
   * and blocks everything for the rest of the run. Give it a moment, and dismiss
   * it if it turns up.
   */
  const confirm = page.locator(".confirm-panel .btn-primary");
  await confirm.waitFor({ state: "visible", timeout: 700 }).catch(() => {});
  if (await confirm.count()) await confirm.click().catch(() => {});
};

try {
  /**
   * Retried, because six builders are saving into this repo at once and the dev
   * server hot-reloads the page out from under the navigation. A broken module
   * somewhere else is not a finding about the battle board.
   */
  for (let attempt = 1; ; attempt++) {
    try {
      await seedPlayedAccount(page, ORIGIN);
      break;
    } catch (error) {
      if (attempt >= 8) throw error;
      console.log(`  (seed attempt ${attempt} failed — retrying)`);
      await page.goto(`${ORIGIN}/#starter`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(5000);
    }
  }
  await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(900);

  // -------------------------------------------------------------- PHASE: PLAY
  if (phase === "play" || phase === "both") {
    // ramp Hype so a real character is affordable
    for (let i = 0; i < 3; i++) {
      await endTurnAndWait();
      await page.waitForTimeout(1600);
    }
    await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
      timeout: 40000,
    });
    await page.waitForTimeout(700);

    const pick = await page.evaluate(() => {
      const d = window.hypeboundBattle.debug();
      const c = d.hand.filter((h) => h.ok && h.needsSlot && h.screen);
      return c[0] ?? null;
    });
    if (!pick) {
      console.log("PLAY: no slot-needing playable card in hand — skipping");
    } else {
      const box = await page.locator("canvas").first().boundingBox();
      await page.evaluate(PROBE);
      await startCast();

      await page.mouse.move(pick.screen.x, pick.screen.y);
      await page.waitForTimeout(220);
      await page.evaluate(() => window.__mark("pointerdown"));
      await page.mouse.down();
      await page.waitForTimeout(90);
      const dropX = box.x + box.width * 0.5;
      const dropY = box.y + box.height * 0.62;
      await page.mouse.move(dropX, dropY, { steps: 14 });
      await page.waitForTimeout(320);
      await page.evaluate(() => window.__mark("overSlot"));
      await page.waitForTimeout(120);
      await page.evaluate(() => window.__mark("mouseup"));
      const upAt = await page.evaluate(() => performance.timeOrigin + performance.now());
      await page.mouse.up();
      await page.waitForTimeout(2400);

      await stopCast("play", upAt);
      const probe = await page.evaluate(() => {
        cancelAnimationFrame(window.__probeRaf);
        return window.__probe;
      });
      const zero = probe.marks.find((m) => m.name === "mouseup")?.t ?? 0;
      console.log("\n=== PHASE PLAY (t=0 at mouse-up) ===");
      console.log(" marks:", probe.marks.map((m) => `${m.name}@${m.t - zero}`).join("  "));
      const g = probe.rows.filter((r) => r.ghost);
      console.log(
        ` drag ghost present ${g.length ? `${g[0].t - zero}..${g.at(-1).t - zero}ms` : "never"}` +
          `${g.length ? `, last opacity ${g.at(-1).ghost.o}` : ""}`
      );
      const blocked = probe.rows.filter((r) => r.blockers.length);
      console.log(
        ` centre-of-board blockers: ${
          blocked.length
            ? `${blocked[0].t - zero}..${blocked.at(-1).t - zero}ms — ${[...new Set(blocked.flatMap((b) => b.blockers))].join(", ")}`
            : "none"
        }`
      );
      console.log(
        " longtasks:",
        probe.longtasks.filter((l) => l.t >= zero - 400).map((l) => `${l.t - zero}ms/${l.d}ms`).join(" ") || "none"
      );
      console.log(
        ` card faces drawn (${probe.faces.length}):`,
        probe.faces.map((t) => `${t - zero}ms`).join(" ") || "none"
      );
      const gaps = [];
      for (let i = 1; i < probe.rows.length; i++) gaps.push(probe.rows[i].t - probe.rows[i - 1].t);
      console.log(` rAF median ${median(gaps)}ms, worst ${Math.max(...gaps)}ms`);
    }
  }

  // -------------------------------------------------------------- PHASE: TURN
  if (phase === "turn" || phase === "both") {
    await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
      timeout: 40000,
    });
    await page.waitForTimeout(600);
    await page.evaluate(PROBE);
    await startCast();
    const startTurn = await page.evaluate(() => window.hypeboundBattle.view().turn);
    await page.evaluate(() => window.__mark("clickEndTurn"));
    const clickAt = await page.evaluate(() => performance.timeOrigin + performance.now());
    await page.click(".end-turn-btn");
    const confirm = page.locator(".confirm-panel .btn-primary");
    if (await confirm.count()) await confirm.click();
    /**
     * The handover is not over when the button re-enables — it re-enables for a
     * moment inside the batch. It is over when the engine says the turn number
     * has moved and the seat is yours again, which is the first instant the
     * player can act.
     */
    await page.waitForFunction(
      (from) => {
        const v = window.hypeboundBattle.view();
        return v.turn > from && v.activeSeat === v.seat && v.phase === "main";
      },
      startTurn,
      { timeout: 60000 }
    );
    await page.evaluate(() => window.__mark("yoursAgain"));
    await page.waitForTimeout(700);

    await stopCast("turn", clickAt);
    const probe = await page.evaluate(() => {
      cancelAnimationFrame(window.__probeRaf);
      return window.__probe;
    });
    const zero = probe.marks.find((m) => m.name === "clickEndTurn")?.t ?? 0;
    console.log("\n=== PHASE TURN (t=0 at End Turn click) ===");
    console.log(" marks:", probe.marks.map((m) => `${m.name}@${m.t - zero}`).join("  "));
    const b = probe.rows.filter((r) => r.banner);
    const runs = [];
    for (const r of b) {
      const last = runs.at(-1);
      if (last && r.t - last.end < 80) {
        last.end = r.t;
        last.cls.add(r.banner.cls);
      } else runs.push({ start: r.t, end: r.t, cls: new Set([r.banner.cls]), rect: r.banner });
    }
    for (const r of runs) {
      console.log(
        ` ribbon ${r.start - zero}..${r.end - zero}ms (${r.end - r.start}ms) ` +
          `at ${r.rect.x},${r.rect.y} ${r.rect.w}x${r.rect.h} — ${[...r.cls].join(" | ")}`
      );
    }
    if (runs.length === 0) console.log(" ribbon: never shown");
    const blocked = probe.rows.filter((r) => r.blockers.length);
    console.log(
      ` centre-of-board blockers: ${
        blocked.length
          ? `${blocked[0].t - zero}..${blocked.at(-1).t - zero}ms — ${[...new Set(blocked.flatMap((x) => x.blockers))].join(", ")}`
          : "none"
      }`
    );
    console.log(
      " longtasks:",
      probe.longtasks.map((l) => `${l.t - zero}ms/${l.d}ms`).join(" ") || "none"
    );
    console.log(
      ` card faces drawn (${probe.faces.length}):`,
      probe.faces.map((t) => `${t - zero}ms`).join(" ") || "none"
    );
    const gaps = [];
    for (let i = 1; i < probe.rows.length; i++) gaps.push(probe.rows[i].t - probe.rows[i - 1].t);
    console.log(` rAF median ${median(gaps)}ms, worst ${Math.max(...gaps)}ms`);
  }

  if (errors.length) {
    console.log(`\n${errors.length} console error(s):`);
    for (const e of errors.slice(0, 8)) console.log("  " + e);
  }
  console.log(`\nframes in ${outDir}`);
} finally {
  await browser.close();
}
