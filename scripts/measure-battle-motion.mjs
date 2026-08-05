/**
 * The instrument for the battle board's motion, because stills cannot see it.
 *
 * Four rounds of review were wasted judging §3 from screenshots. This drives a
 * real match on the real GPU and records the three things a photograph cannot
 * show: which CSS animations start and when, how long the main thread was
 * blocked, and what the frame rate actually was across a transition.
 *
 * It is deliberately a separate file from `shot.mjs`. That one is a camera and
 * has to stay simple; this one has to install observers before the page has
 * booted, click through the mulligan while recording, and print numbers.
 *
 *   node scripts/measure-battle-motion.mjs curtain
 *   node scripts/measure-battle-motion.mjs hand
 *   node scripts/measure-battle-motion.mjs all --size 1600x900
 */

import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const what = argv[0] ?? "all";
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);

const RECORDER = () => {
  const w = /** @type {any} */ (window);
  w.__m = { anim: [], long: [], frames: [], t0: performance.now() };
  document.addEventListener(
    "animationstart",
    (e) => {
      const target = /** @type {Element} */ (e.target);
      w.__m.anim.push({
        t: Math.round(performance.now() - w.__m.t0),
        name: e.animationName,
        cls: target.className && String(target.className).slice(0, 48),
        tag: target.tagName,
      });
    },
    true
  );
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__m.long.push({ t: Math.round(entry.startTime - w.__m.t0), ms: Math.round(entry.duration) });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* no longtask support */
  }
  const tick = (now) => {
    w.__m.frames.push(now);
    w.__raf = requestAnimationFrame(tick);
  };
  w.__raf = requestAnimationFrame(tick);
  w.__mark = () => {
    w.__m.t0 = performance.now();
    w.__m.anim.length = 0;
    w.__m.long.length = 0;
    w.__m.frames.length = 0;
  };
};

const summarise = (frames) => {
  if (frames.length < 3) return { fps: 0, worst: 0, over33: 0, over50: 0, n: frames.length };
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) gaps.push(frames[i] - frames[i - 1]);
  gaps.sort((a, b) => a - b);
  const total = frames[frames.length - 1] - frames[0];
  return {
    fps: Number((((frames.length - 1) / total) * 1000).toFixed(1)),
    worst: Number(gaps[gaps.length - 1].toFixed(1)),
    p95: Number(gaps[Math.floor(gaps.length * 0.95)].toFixed(1)),
    over33: gaps.filter((g) => g > 33).length,
    over50: gaps.filter((g) => g > 50).length,
    n: frames.length,
  };
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const out = {};

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.addInitScript(RECORDER);
  await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
  await page.waitForTimeout(1200);

  if (what === "curtain" || what === "all") {
    // --- the mulligan -> board curtain -------------------------------------
    out.mulliganGeometry = await page.evaluate(() => {
      const panel = document.querySelector(".mulligan-panel");
      const r = panel?.getBoundingClientRect();
      const pick = (sel) => {
        const el = panel?.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
      };
      return {
        panel: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
        eyebrow: pick(".eyebrow"),
        title: pick("h2.title"),
        cards: panel?.querySelectorAll(".mulligan-card").length ?? 0,
      };
    });

    await page.evaluate(() => window.__mark());
    await page.click(".mulligan-actions .btn-primary");
    await page.waitForTimeout(3000);
    const curtain = await page.evaluate(() => ({
      anim: window.__m.anim,
      long: window.__m.long,
      frames: window.__m.frames,
    }));
    out.curtain = {
      fps: summarise(curtain.frames),
      longtasks: curtain.long.filter((l) => l.ms > 40),
      handEntrances: curtain.anim.filter((a) => a.name === "hand-card-in").map((a) => a.t),
      firstAnims: curtain.anim.slice(0, 24),
    };
  } else {
    await page.click(".mulligan-actions .btn-primary");
  }

  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  if (what === "hand" || what === "all") {
    out.handGeometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".hand-card")];
      return cards.map((c) => {
        const s = getComputedStyle(c);
        const canvas = c.querySelector("canvas");
        const cs = canvas ? getComputedStyle(canvas) : null;
        const r = c.getBoundingClientRect();
        return {
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          tilt: s.getPropertyValue("--tilt").trim(),
          enterDelay: s.getPropertyValue("--enter-delay").trim(),
          animDelay: cs?.animationDelay ?? s.animationDelay,
          animName: cs?.animationName ?? s.animationName,
          animDuration: cs?.animationDuration ?? s.animationDuration,
          dataNew: c.hasAttribute("data-new"),
        };
      });
    });

    // --- idle: does the hand re-animate when nothing asked it to? -----------
    await page.evaluate(() => window.__mark());
    await page.click(".end-turn-btn").catch(() => {});
    await page.waitForTimeout(6000);
    const turn = await page.evaluate(() => ({ anim: window.__m.anim, long: window.__m.long, frames: window.__m.frames }));
    out.opponentTurn = {
      fps: summarise(turn.frames),
      handEntranceRestarts: turn.anim.filter((a) => a.name === "hand-card-in").map((a) => a.t),
      shakes: turn.anim.filter((a) => a.name === "board-shake").map((a) => a.t),
      longtasks: turn.long.filter((l) => l.ms > 40),
      byName: turn.anim.reduce((acc, a) => {
        acc[a.name] = (acc[a.name] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  if (what === "hover" || what === "all") {
    await page.waitForTimeout(500);
    out.hover = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll(".hand-card")];
      if (cards.length < 3) return { error: `only ${cards.length} cards` };
      const read = () => cards.map((c) => getComputedStyle(c).transform);
      const before = read();
      const target = cards[Math.floor(cards.length / 2)];
      target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      // :hover cannot be forced from script; drive the sibling rule's class hook
      target.classList.add("hover-probe");
      await new Promise((r) => setTimeout(r, 260));
      const after = read();
      target.classList.remove("hover-probe");
      return {
        index: Math.floor(cards.length / 2),
        changed: before.map((b, i) => b !== after[i]),
        before,
        after,
      };
    });
  }

  if (what === "ghost" || what === "all") {
    out.ghost = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll(".hand-card.playable")];
      const card = cards[0];
      if (!card) return { error: "no playable card" };
      const r = card.getBoundingClientRect();
      card.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + 20, pointerId: 1, button: 0 })
      );
      await new Promise((res) => setTimeout(res, 60));
      for (let i = 0; i < 6; i += 1) {
        window.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: r.x + r.width / 2 + i * 28, clientY: r.y - 120 - i * 18, pointerId: 1 })
        );
        await new Promise((res) => setTimeout(res, 24));
      }
      const ghost = document.querySelector(".hand-drag-ghost");
      const gc = ghost?.querySelector("canvas");
      const gr = gc?.getBoundingClientRect();
      const result = {
        source: { w: Math.round(r.width), h: Math.round(r.height) },
        ghost: gr ? { w: Math.round(gr.width), h: Math.round(gr.height) } : null,
        rotate: ghost ? getComputedStyle(ghost).rotate : null,
        transform: ghost ? ghost.style.transform : null,
        shadowLayer: !!ghost?.querySelector(".ghost-shadow"),
      };
      window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
      return result;
    });
  }

  if (what === "arrow" || what === "all") {
    out.arrow = await page.evaluate(async () => {
      const layer = document.querySelector(".targeting-layer");
      if (!layer) return { error: "no targeting layer" };
      const paths = [...layer.querySelectorAll("path")];
      return {
        paths: paths.length,
        animated: paths.map((p) => getComputedStyle(p).animationName),
        classes: paths.map((p) => p.getAttribute("class")),
      };
    });
  }
} catch (error) {
  out.error = String(error && error.stack ? error.stack : error);
} finally {
  out.consoleErrors = errors.slice(0, 8);
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
