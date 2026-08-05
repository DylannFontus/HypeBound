/**
 * Front-door probe: seed a signed-in account with a deck, then measure the
 * entrance of #signin and #queue at monitor rate.
 *
 *   node fd.mjs shots            -- PNGs at three sizes for both routes
 *   node fd.mjs entrance         -- opacity/top samples through signin -> queue
 *   node fd.mjs overlap          -- animationstart/animationend on both screens
 *   node fd.mjs cast             -- CDP screencast of signin -> queue
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const OUT = "D:/Gooner Card Game/scripts/screenshots/w2/frontdoor2";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const mode = process.argv[2] ?? "shots";
const tag = process.argv[3] ?? "after";
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const FAKE_SESSION = {
  accessToken: "probe-token",
  refreshToken: "probe-refresh",
  expiresAtMs: Date.now() + 86_400_000,
  account: { userId: "00000000-0000-4000-8000-000000000001", email: "probe@example.com" },
};

async function open(size = { width: 1600, height: 900 }, scale = 1) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--allow-file-access-from-files", "--force-device-scale-factor=1"],
  });
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "domcontentloaded" });
  await seedPlayedAccount(page, ORIGIN);
  return { browser, context, page };
}

/** Sign the probe account in, without a network round trip. */
async function signInLocally(page) {
  await page.evaluate((session) => {
    localStorage.setItem("hypebound-auth:session", JSON.stringify(session));
  }, FAKE_SESSION);
}

async function goto(page, route) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
}

// --- shots -------------------------------------------------------------------

if (mode === "shots") {
  for (const [w, h] of [[1600, 900], [1280, 720], [844, 390]]) {
    const { browser, page } = await open({ width: w, height: h });
    await signInLocally(page);
    for (const route of ["signin", "queue"]) {
      await goto(page, route);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${tag}-${route}-${w}x${h}.png`) });
    }
    await browser.close();
  }
  console.log("shots written");
}

// --- entrance: does any tracked element go backwards? ------------------------

if (mode === "entrance") {
  const { browser, page } = await open();
  await signInLocally(page);
  await goto(page, "lobby");

  const run = async (target, selectors) => {
    return page.evaluate(
      async ({ target, selectors }) => {
        const samples = [];
        const t0 = performance.now();
        location.hash = `#${target}`;
        await new Promise((resolve) => {
          const tick = () => {
            const t = performance.now() - t0;
            const row = { t: Math.round(t) };
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const cs = getComputedStyle(el);
              row[sel] = {
                o: Number(cs.opacity).toFixed(2),
                y: Math.round(el.getBoundingClientRect().top * 10) / 10,
              };
            }
            samples.push(row);
            if (t < 1600) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return samples;
      },
      { target, selectors }
    );
  };

  const report = (name, samples, selectors) => {
    console.log(`\n== ${name} ==`);
    for (const sel of selectors) {
      const seq = samples.filter((s) => s[sel]).map((s) => ({ t: s.t, ...s[sel] }));
      if (seq.length === 0) {
        console.log(`  ${sel}: never present`);
        continue;
      }
      let peak = 0;
      let regressions = [];
      for (const s of seq) {
        const o = Number(s.o);
        if (peak >= 0.999 && o < 0.995) regressions.push(s);
        peak = Math.max(peak, o);
      }
      const first1 = seq.find((s) => Number(s.o) >= 0.999);
      const last1 = [...seq].reverse().find((s) => Number(s.o) < 0.999);
      console.log(
        `  ${sel}: first opacity 1.00 at t=${first1 ? first1.t : "never"}ms;` +
          ` last sub-1.00 at t=${last1 ? last1.t : "n/a"}ms;` +
          ` BACKWARDS SAMPLES: ${regressions.length}` +
          (regressions.length ? ` (first ${regressions[0].t}ms o=${regressions[0].o} y=${regressions[0].y})` : "")
      );
    }
  };

  const signinSel = [".signin-stage", ".signin-panel", ".signin-note"];
  const queueSel = [".queue-call", ".queue-note", ".queue-stage"];
  report("lobby -> signin", await run("signin", signinSel), signinSel);
  await page.waitForTimeout(1200);
  report("signin -> queue", await run("queue", queueSel), queueSel);
  await browser.close();
}

if (mode === "diag") {
  const { browser, page } = await open();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 220)));
  await signInLocally(page);
  await goto(page, "queue");
  await page.waitForTimeout(2200);
  console.log("hash", await page.evaluate(() => location.hash));
  console.log("screens", await page.evaluate(() => [...document.querySelectorAll(".screen")].map((e) => e.className)));
  console.log("state", await page.evaluate(() => document.querySelector("#queue-state")?.textContent));
  console.log("detail", await page.evaluate(() => document.querySelector("#queue-detail")?.textContent));
  await page.screenshot({ path: path.join(OUT, `diag-queue.png`) });
  await browser.close();
}

// --- overlap: when does out end and in start? --------------------------------

if (mode === "overlap") {
  const { browser, page } = await open();
  await signInLocally(page);
  await goto(page, "signin");

  const events = await page.evaluate(async () => {
    const log = [];
    const t0 = performance.now();
    const on = (kind) => (e) =>
      log.push({
        kind,
        name: e.animationName,
        t: Math.round(performance.now() - t0),
        el: (e.target.className || "").toString().slice(0, 46),
      });
    document.addEventListener("animationstart", on("start"), true);
    document.addEventListener("animationend", on("end"), true);
    document.addEventListener("animationcancel", on("cancel"), true);
    location.hash = "#queue";
    await new Promise((r) => setTimeout(r, 1800));
    return log;
  });
  const nav = events.filter((e) => /nav-|front-panel|queue-|signin-/.test(e.name));
  for (const e of nav) console.log(`${String(e.t).padStart(5)}ms  ${e.kind.padEnd(6)} ${e.name.padEnd(22)} ${e.el}`);
  const last = Math.max(...nav.filter((e) => e.kind === "end").map((e) => e.t));
  console.log(`\nlast animationend: ${last}ms`);
  await browser.close();
}

// --- cast: frame-by-frame over the navigation --------------------------------

if (mode === "cast") {
  const { browser, context, page } = await open();
  await signInLocally(page);
  await goto(page, "signin");
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: Date.now() - t0, data: f.data });
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
    } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });
  await page.evaluate(() => {
    location.hash = "#queue";
  });
  await page.waitForTimeout(1600);
  await cdp.send("Page.stopScreencast");
  const dir = path.join(OUT, `cast-${tag}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let gapMax = 0;
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) gapMax = Math.max(gapMax, frames[i].t - frames[i - 1].t);
    writeFileSync(path.join(dir, `f-${String(frames[i].t).padStart(5, "0")}.jpg`), Buffer.from(frames[i].data, "base64"));
  }
  console.log(`${frames.length} frames, largest gap ${gapMax}ms -> ${dir}`);
  await browser.close();
}
