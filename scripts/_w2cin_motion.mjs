/**
 * Cinematics round-1 instrument: screencast + animation event tape.
 *
 * Stills cannot show motion. This records a CDP screencast (real GPU frames,
 * timestamped by the browser) alongside every `animation*` event and every
 * long task, then decodes each frame's mean luminance and an 8x8 signature in a
 * second page so "was there a blank frame" and "did anything change between
 * these two frames" are measured rather than eyeballed.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const OUT = path.join(process.cwd(), "scripts", "screenshots", "w2", "cinematics");
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const scenario = argv[0] ?? "nav";
const raw = argv.includes("--raw");
const size = (argv.includes("--size") ? argv[argv.indexOf("--size") + 1] : "1600x900").split("x").map(Number);
const reduced = argv.includes("--reduced");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
const decoder = await browser.newPage();
await decoder.goto("about:blank");

const RECORDER = () => {
  const w = window;
  w.__tape = { anim: [], long: [], marks: [] };
  const t0 = performance.now();
  w.__t0 = t0;
  const label = (t) => {
    if (!(t instanceof Element)) return String(t);
    const id = t.id ? `#${t.id}` : "";
    const cls = typeof t.className === "string" ? `.${t.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
    return `${t.tagName.toLowerCase()}${id}${cls}`;
  };
  for (const type of ["animationstart", "animationend", "animationcancel"]) {
    document.addEventListener(
      type,
      (e) => {
        w.__tape.anim.push({
          t: Math.round(performance.now() - t0),
          type: type.replace("animation", ""),
          name: e.animationName,
          el: label(e.target),
          elapsed: Math.round(e.elapsedTime * 1000),
        });
      },
      true
    );
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__tape.long.push({ t: Math.round(e.startTime - t0), dur: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* no longtask support */
  }
  // per-frame sampler: how many .screen elements, and the max opacity of any
  let last = performance.now();
  w.__frames = [];
  const tick = () => {
    const now = performance.now();
    const screens = Array.from(document.querySelectorAll(".screen"));
    let maxOpacity = 0;
    for (const s of screens) {
      const o = Number(getComputedStyle(s).opacity);
      if (o > maxOpacity) maxOpacity = o;
    }
    const curtain = document.querySelector(".nav-curtain");
    w.__frames.push({
      t: Math.round(now - t0),
      dt: Math.round((now - last) * 10) / 10,
      screens: screens.length,
      op: Math.round(maxOpacity * 100) / 100,
      curtain: curtain ? curtain.dataset.phase + ":" + curtain.dataset.veil : null,
    });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function startCast() {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
    } catch {
      /* torn down */
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  return {
    frames,
    stop: async () => {
      try {
        await cdp.send("Page.stopScreencast");
      } catch {
        /* ignore */
      }
    },
  };
}

async function analyse(frames) {
  const stats = [];
  for (let start = 0; start < frames.length; start += 150) {
    stats.push(...(await decodeChunk(frames.slice(start, start + 150).map((f) => f.data))));
  }
  let prev = null;
  return stats.map((s, i) => {
    let diff = 0;
    if (prev) {
      for (let k = 0; k < s.sig.length; k++) diff += Math.abs(s.sig[k] - prev[k]);
      diff = Math.round(diff / s.sig.length);
    }
    prev = s.sig;
    return { i, lum: s.lum, diff, ts: frames[i].ts };
  });
}

async function decodeChunk(payload) {
  return await decoder.evaluate(async (list) => {
    const out = [];
    for (const b64 of list) {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 18;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      const sig = [];
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        sig.push(Math.round(l));
      }
      out.push({ lum: Math.round((sum / (d.length / 4)) * 10) / 10, sig });
    }
    return out;
  }, payload);
}

function dump(frames, rows, tag) {
  const dir = path.join(OUT, `cast-${tag}`);
  mkdirSync(dir, { recursive: true });
  const t0 = frames[0].ts;
  for (const r of rows) {
    const rel = Math.round((r.ts - t0) * 1000);
    writeFileSync(
      path.join(dir, `f${String(r.i).padStart(3, "0")}-t${String(rel).padStart(5, "0")}.jpg`),
      Buffer.from(frames[r.i].data, "base64")
    );
  }
  return dir;
}

function report(title, rows, t0) {
  const lines = [`\n=== ${title} ===`];
  for (const r of rows) {
    const rel = Math.round((r.ts - t0) * 1000);
    lines.push(
      `  f${String(r.i).padStart(3)}  t=${String(rel).padStart(5)}ms  lum=${String(r.lum).padStart(5)}  Δ=${String(r.diff).padStart(3)}${r.lum < 6 ? "   <<< BLANK" : ""}${r.diff === 0 ? "   (identical)" : ""}`
    );
  }
  return lines.join("\n");
}

const log = [];
try {
  if (raw) {
    await page.goto(ORIGIN, { waitUntil: "networkidle" });
  } else {
    await seedPlayedAccount(page, ORIGIN);
  }
  if (reduced) {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-reduced-motion", "true");
    });
  }

  if (scenario === "returning" || scenario === "boot") {
    await page.addInitScript(RECORDER);
    const cast = await startCast();
    await page.reload({ waitUntil: "commit" });
    await page.waitForTimeout(Number(argv.includes("--hold") ? argv[argv.indexOf("--hold") + 1] : 7000));
    await cast.stop();
    const rows = await analyse(cast.frames);
    if (argv.includes("--dump")) log.push("dumped to " + dump(cast.frames, rows, scenario));
    log.push(report(scenario + " boot", rows, cast.frames[0].ts));
    const tape = await page.evaluate(() => window.__tape ?? null);
    log.push("\nanimation tape:\n" + (tape?.anim ?? []).map((a) => `${a.t}ms ${a.type} ${a.name} on ${a.el}`).join("\n"));
    log.push("\nlong tasks:\n" + JSON.stringify(tape?.long ?? []));
    const fr = await page.evaluate(() => window.__frames ?? []);
    log.push(`\nrAF frames: ${fr.length}, over 34ms: ${fr.filter((f) => f.dt > 34).length}`);
    log.push("slowest: " + JSON.stringify(fr.slice().sort((a, b) => b.dt - a.dt).slice(0, 10)));
  } else if (scenario === "firstrun") {
    // reload so the intro plays from zero with the cast already running
    await page.addInitScript(RECORDER);
    const cast = await startCast();
    await page.goto(ORIGIN + "/#lobby", { waitUntil: "commit" });
    await page.waitForTimeout(9000);
    await cast.stop();
    const rows = await analyse(cast.frames);
    log.push(report("first run: boot -> intro -> lobby", rows, cast.frames[0].ts));
    const tape = await page.evaluate(() => window.__tape ?? null);
    log.push("\nanimation tape:\n" + JSON.stringify(tape?.anim?.slice(0, 200) ?? [], null, 0));
    log.push("\nlong tasks:\n" + JSON.stringify(tape?.long ?? []));
  } else {
    await page.goto(ORIGIN + "/#lobby", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.evaluate(RECORDER);
    const cast = await startCast();
    const hops = (argv.includes("--hops") ? argv[argv.indexOf("--hops") + 1] : "collection,lobby,play,queue,lobby").split(",");
    for (const hop of hops) {
      await page.evaluate((h) => {
        window.__tape?.marks?.push({ t: Math.round(performance.now() - (window.__t0 ?? 0)), hop: h });
        window.location.hash = "#" + h;
      }, hop);
      await page.waitForTimeout(Number(argv.includes("--hold") ? argv[argv.indexOf("--hold") + 1] : 2200));
    }
    await cast.stop();
    const rows = await analyse(cast.frames);
    if (argv.includes("--dump")) log.push("dumped to " + dump(cast.frames, rows, scenario + (reduced ? "-reduced" : "")));
    log.push(report("navigation: " + hops.join(" -> "), rows, cast.frames[0].ts));
    const tape = await page.evaluate(() => window.__tape ?? null);
    log.push("\nmarks:\n" + JSON.stringify(tape?.marks ?? []));
    log.push("\nanimation tape:\n" + (tape?.anim ?? []).map((a) => `${a.t}ms ${a.type} ${a.name} on ${a.el}`).join("\n"));
    log.push("\nlong tasks:\n" + JSON.stringify(tape?.long ?? []));
    const fr = await page.evaluate(() => window.__frames ?? []);
    const slow = fr.filter((f) => f.dt > 20);
    log.push(`\nrAF frames: ${fr.length}, over 20ms: ${slow.length}, over 34ms: ${fr.filter((f) => f.dt > 34).length}`);
    log.push("slowest: " + JSON.stringify(fr.slice().sort((a, b) => b.dt - a.dt).slice(0, 12)));
    log.push("\nframe sample (screens/opacity/curtain) where screens>1 or op<0.9:");
    log.push(fr.filter((f) => f.screens !== 1 || f.op < 0.9 || f.curtain).map((f) => `${f.t}ms dt=${f.dt} screens=${f.screens} op=${f.op} curtain=${f.curtain}`).join("\n"));
  }
} finally {
  const text = log.join("\n");
  console.log(text.slice(0, 60000));
  writeFileSync(path.join(OUT, `tape-${scenario}${reduced ? "-reduced" : ""}.txt`), text);
  await browser.close();
}
