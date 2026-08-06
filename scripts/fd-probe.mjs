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

/**
 * The queue's socket, stubbed in the page, so nothing here touches the network.
 *
 * `stage` decides what the fake server says: "connect" holds the socket open and
 * says nothing (the Connecting… state every arrival sees), "search" answers with
 * a real `queued` frame, "offer" adds the four-minute AI offer.
 */
function socketStub(stage) {
  return `(() => {
    if (${stage === "off"}) return;
    const Real = window.WebSocket;
    class Fake extends EventTarget {
      constructor(url) {
        super();
        this.url = url; this.readyState = 0;
        this.addEventListener("__x", () => {});
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
          if (${stage === "connect"}) return;
          const send = (o) => this.onmessage?.({ data: JSON.stringify({ v: 1, ts: Date.now(), ...o }) });
          send({ t: "queued", ticketId: "probe", waiting: 1 });
          setTimeout(() => send({ t: "searching", waitedMs: 42000, band: 120, waiting: 1 }), 120);
          if (${stage === "offer"}) setTimeout(() => send({ t: "aiOffer", waitedMs: 240000 }), 260);
        }, ${stage === "connect" ? 100000 : 140});
      }
      send() {}
      close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: "" }); }
    }
    Fake.OPEN = 1; Fake.CONNECTING = 0; Fake.CLOSED = 3; Fake.CLOSING = 2;
    window.WebSocket = Fake;
    window.__realWebSocket = Real;
  })();`;
}

async function open(size = { width: 1600, height: 900 }, scale = 1, stage = "search") {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--allow-file-access-from-files", "--force-device-scale-factor=1"],
  });
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale });
  // Nothing leaves the machine: the identity service answers with the probe's
  // own session and the match server answers 404, so no measurement here is
  // ever waiting on a real host.
  await context.route("**://vnvaqwbnmawcnvhodbel.supabase.co/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "probe-token",
        refresh_token: "probe-refresh",
        expires_in: 86_400,
        user: { id: "00000000-0000-4000-8000-000000000001", email: "probe@example.com" },
      }),
    })
  );
  await context.route("**://hypebound.dylann-andre-fontus-1.workers.dev/**", (r) =>
    r.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  );
  await context.addInitScript(socketStub(stage));
  // Written before any page script runs, on every navigation, because the auth
  // module caches its answer the first time anything asks.
  await context.addInitScript(`localStorage.setItem("hypebound-auth:session", ${JSON.stringify(JSON.stringify(FAKE_SESSION))});`);
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
  const stage = process.argv[4] ?? "search";
  const sizes = (process.argv[5] ?? "1600x900,1280x720,844x390").split(",").map((s) => s.split("x").map(Number));
  for (const [w, h] of sizes) {
    const { browser, page } = await open({ width: w, height: h }, 1, stage);
    for (const route of ["signin", "queue"]) {
      await goto(page, route);
      await page.waitForTimeout(700);
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

// --- fit: does anything sit outside its container or the viewport? -----------

if (mode === "fit") {
  const stage = process.argv[4] ?? "offer";
  const scale = Number(process.argv[5] ?? 1);
  for (const [w, h] of [
    [1600, 900],
    [1280, 720],
    [844, 390],
  ]) {
    const { browser, page } = await open({ width: w, height: h }, 1, stage);
    if (scale !== 1) await page.addInitScript(`document.documentElement.style.setProperty("--ui-scale", "${scale}")`);
    for (const route of ["signin", "queue"]) {
      await goto(page, route);
      if (scale !== 1)
        await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), scale);
      await page.waitForTimeout(600);
      const bad = await page.evaluate(() => {
        const out = [];
        const root = document.querySelector(".screen:last-of-type") ?? document.body;
        for (const el of root.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          // A closed <details> still reports rects for its skipped subtree.
          if (el.closest("details:not([open])") && !el.closest("summary")) continue;
          if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1) {
            // Only report things that carry text or take a click.
            const tag = el.tagName.toLowerCase();
            const interactive = ["button", "a", "input", "summary"].includes(tag);
            const text = (el.textContent ?? "").trim().length > 0 && el.children.length === 0;
            if (interactive || text) {
              out.push({
                sel: `${tag}.${String(el.className).split(" ")[0]}`,
                r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
              });
            }
          }
        }
        // Anything clipped by an `overflow: hidden` ancestor.
        const clipped = [];
        for (const host of document.querySelectorAll(".queue-call, .signin-panel, .signin-stage, .queue-note")) {
          const hr = host.getBoundingClientRect();
          for (const el of host.querySelectorAll("button, input, p, h3")) {
            const r = el.getBoundingClientRect();
            if (r.height && (r.bottom > hr.bottom + 1 || r.top < hr.top - 1)) {
              clipped.push({
                host: String(host.className).split(" ")[0],
                el: `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`,
                over: Math.round(Math.max(r.bottom - hr.bottom, hr.top - r.top)),
              });
            }
          }
        }
        const scroller = document.querySelector(".signin-body, .queue-body");
        return {
          out,
          clipped,
          scroll: scroller ? [scroller.scrollHeight, scroller.clientHeight] : null,
        };
      });
      console.log(
        `${w}x${h} @${scale} ${route}: outside=${bad.out.length} clipped=${bad.clipped.length} scroll=${JSON.stringify(bad.scroll)}`
      );
      for (const b of bad.out.slice(0, 6)) console.log("   outside", b.sel, b.r.join(","));
      for (const c of bad.clipped.slice(0, 6)) console.log("   clipped", c.host, c.el, `${c.over}px`);
    }
    await browser.close();
  }
}

if (mode === "boot") {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 400)));
  page.on("response", (r) => {
    if (r.status() >= 400) console.log("HTTP", r.status(), r.url().replace(ORIGIN, ""));
  });
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("hash", await page.evaluate(() => location.hash));
  console.log("screens", await page.evaluate(() => [...document.querySelectorAll(".screen")].map((e) => e.className)));
  console.log("appHTML", (await page.evaluate(() => document.getElementById("app")?.innerHTML ?? "")).slice(0, 400));
  await browser.close();
}

// --- zoom: a region of a route, at 3x, so an artefact is legible ------------

if (mode === "zoom") {
  const route = process.argv[4] ?? "signin";
  const region = (process.argv[5] ?? "0,700,700,200").split(",").map(Number);
  const { browser, page } = await open({ width: 1600, height: 900 }, 3);
  await signInLocally(page);
  await goto(page, route);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, `zoom-${tag}.png`),
    clip: { x: region[0], y: region[1], width: region[2], height: region[3] },
  });
  console.log(`zoom-${tag}.png`);
  await browser.close();
}

// --- scan: pixel measurements, decoded in the browser ------------------------

if (mode === "scan") {
  const route = process.argv[4] ?? "signin";
  const { browser, page } = await open();
  await signInLocally(page);
  await goto(page, route);
  await page.waitForTimeout(700);
  const heroSel = route === "signin" ? "#signin-submit" : "#queue-play-ai";
  const rects = await page.evaluate(
    (sel) => {
      const el = document.querySelector(sel);
      const hero = el ? el.getBoundingClientRect() : null;
      const panel = document.querySelector(".signin-panel, .queue-call")?.getBoundingClientRect() ?? null;
      const pick = (r) => (r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null);
      return { hero: pick(hero), panel: pick(panel), vw: innerWidth, vh: innerHeight };
    },
    heroSel
  );
  const shot = (await page.screenshot({ type: "png" })).toString("base64");
  const stats = await page.evaluate(
    async ({ shot, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const grey = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

      const out = {};
      if (rects.hero) {
        const { x, y, w, h } = rects.hero;
        // A text-free band across the top sixth of the plate.
        const yy = Math.round(y + h * 0.16);
        // Six pixels in from each end, so the plate's own outer edge is not read
        // as a cap artefact.
        const row = g.getImageData(Math.round(x) + 6, yy, Math.round(w) - 12, 1).data;
        const line = [];
        for (let i = 0; i < row.length; i += 4) line.push(grey(row, i));
        out.heroMean = +(line.reduce((a, b) => a + b, 0) / line.length).toFixed(1);
        // Largest rise and fall over any 8px window, and where.
        let best = { d: 0 };
        let worst = { d: 0 };
        for (let i = 0; i + 8 < line.length; i++) {
          const d = line[i + 8] - line[i];
          if (d > best.d) best = { d: +d.toFixed(1), at: Math.round(x) + 6 + i };
          if (d < worst.d) worst = { d: +d.toFixed(1), at: Math.round(x) + 6 + i };
        }
        out.heroRise = best;
        out.heroFall = worst;
        // High-frequency energy on the plate: mean |p - blur3| over its interior.
        const band = g.getImageData(
          Math.round(x + w * 0.06),
          Math.round(y + h * 0.1),
          Math.round(w * 0.88),
          Math.round(h * 0.24)
        ).data;
        const bw = Math.round(w * 0.88);
        const bh = Math.round(h * 0.24);
        let hf = 0;
        let n = 0;
        let sum = 0;
        for (let yy2 = 1; yy2 < bh - 1; yy2++) {
          for (let xx = 1; xx < bw - 1; xx++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) s += grey(band, ((yy2 + dy) * bw + xx + dx) * 4);
            const p = grey(band, (yy2 * bw + xx) * 4);
            hf += Math.abs(p - s / 9);
            sum += p;
            n++;
          }
        }
        out.heroGrain = +(hf / n).toFixed(2);
        out.heroFace = +(sum / n).toFixed(1);
      }
      if (rects.panel) {
        const { x, y, w, h } = rects.panel;
        const band = g.getImageData(Math.round(x + 8), Math.round(y + 8), Math.round(w - 16), 40).data;
        const bw = Math.round(w - 16);
        let hf = 0;
        let n = 0;
        let sum = 0;
        for (let yy2 = 1; yy2 < 39; yy2++) {
          for (let xx = 1; xx < bw - 1; xx++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) s += grey(band, ((yy2 + dy) * bw + xx + dx) * 4);
            hf += Math.abs(grey(band, (yy2 * bw + xx) * 4) - s / 9);
            sum += grey(band, (yy2 * bw + xx) * 4);
            n++;
          }
        }
        out.panelGrain = +(hf / n).toFixed(2);
        out.panelFace = +(sum / n).toFixed(1);
      }

      // Value structure: 16px blocks, whole frame and bottom fifth.
      const stats = (x0, y0, x1, y1) => {
        const vals = [];
        let dead = 0;
        let blocks = 0;
        for (let by = y0; by + 16 <= y1; by += 16) {
          for (let bx = x0; bx + 16 <= x1; bx += 16) {
            const d = g.getImageData(bx, by, 16, 16).data;
            let s = 0;
            let s2 = 0;
            for (let i = 0; i < d.length; i += 4) {
              const v = grey(d, i);
              s += v;
              s2 += v * v;
              vals.push(v);
            }
            const m = s / 256;
            const sd = Math.sqrt(Math.max(0, s2 / 256 - m * m));
            blocks++;
            if (m < 34 && sd < 6) dead++;
          }
        }
        vals.sort((a, b) => a - b);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
        return {
          mean: +mean.toFixed(1),
          sd: +sd.toFixed(1),
          p50: Math.round(vals[Math.floor(vals.length * 0.5)]),
          p95: Math.round(vals[Math.floor(vals.length * 0.95)]),
          deadPct: +((dead / blocks) * 100).toFixed(1),
        };
      };
      out.frame = stats(0, 0, c.width, c.height);
      out.bottomFifth = stats(0, Math.round(c.height * 0.8), c.width, c.height);
      return out;
    },
    { shot, rects }
  );
  console.log(JSON.stringify(stats, null, 2));
  await browser.close();
}

if (mode === "diag") {
  const { browser, page } = await open();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 220)));
  await signInLocally(page);
  await goto(page, "queue");
  await page.waitForTimeout(2200);
  console.log("hash", await page.evaluate(() => location.hash));
  console.log("session", await page.evaluate(() => localStorage.getItem("hypebound-auth:session")));
  console.log(
    "account",
    await page.evaluate(async () => {
      const m = await import("/src/auth/account.ts");
      const d = await import("/src/save/profile.ts");
      const before = m.currentAccount();
      m.resetSessionCache?.();
      return { before, afterReset: m.currentAccount(), deck: Boolean(d.activeDeck()) };
    })
  );
  console.log("deck", await page.evaluate(() => Boolean(document.querySelector(".queue-screen"))));
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
