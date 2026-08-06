/**
 * Round-2 collection probe: entrance cascade, keyboard reach, detail exit and
 * the foil's response to a tilt. Every number the critic measured, re-measured.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5173/#collection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  if (location.hash !== "#collection") location.hash = "#collection";
});
await page.waitForTimeout(2500);

const out = {};

out.cascade = await page.evaluate(() => {
  const cells = [...document.querySelectorAll(".card-cell")].slice(0, 24);
  const grid = document.querySelector(".card-grid") ?? cells[0]?.parentElement;
  const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
  return {
    columns,
    delays: cells.map((c) => c.style.getPropertyValue("--enter-delay").trim()),
  };
});

out.keyboard = await (async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const seen = [];
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName,
        cls: el.className?.toString().slice(0, 40),
        label: el.getAttribute("aria-label")?.slice(0, 90) ?? null,
        role: el.getAttribute("role"),
      };
    });
    seen.push(info);
    if (info && String(info.cls).includes("card-cell")) {
      return { pressesToFirstTile: i + 1, at: info, before: seen.length - 1 };
    }
  }
  return { pressesToFirstTile: -1, tail: seen.slice(-3) };
})();

// -- detail: keyboard open, foil vs tilt, then exit -------------------------
out.detail = await page.evaluate(async () => {
  const cell = document.querySelector(".card-cell");
  cell.focus();
  cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  const overlay = document.querySelector(".card-detail-overlay");
  return { openedByKeyboard: overlay ? !overlay.hidden : false };
});

// find a legendary so the foil is live
out.foil = await page.evaluate(async () => {
  const overlay = document.querySelector(".card-detail-overlay");
  if (overlay) overlay.hidden = true;
  const cells = [...document.querySelectorAll(".card-cell")];
  const legendary = cells.find((c) => (c.getAttribute("aria-label") ?? "").includes("legendary"));
  if (!legendary) return { found: false };
  legendary.click();
  await new Promise((r) => setTimeout(r, 900));
  const wrap = document.querySelector(".cd-art");
  const canvas = document.querySelector(".cd-tilt canvas");
  if (!wrap || !canvas) return { found: false };
  const ctx = canvas.getContext("2d");
  const box = wrap.getBoundingClientRect();

  const snap = () => {
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Uint8Array(Math.floor(d.length / 4));
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
    return out;
  };
  const diff = (a, b) => {
    let sum = 0;
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      const v = Math.abs(a[i] - b[i]);
      sum += v;
      if (v > max) max = v;
    }
    return { mean: +(sum / a.length).toFixed(3), max };
  };

  const move = (fx, fy) => {
    wrap.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: box.left + box.width * fx,
        clientY: box.top + box.height * fy,
        bubbles: true,
      })
    );
  };

  // park at the left edge, let the clock settle, snapshot; then swing right
  move(0.06, 0.5);
  await new Promise((r) => setTimeout(r, 140));
  const before = snap();
  move(0.94, 0.5);
  await new Promise((r) => setTimeout(r, 140));
  const after = snap();

  /**
   * The control: the same elapsed time with no pointer movement at all, so a
   * change under the swing can be attributed to the swing rather than to the
   * clock that is also running.
   */
  const idleA = snap();
  await new Promise((r) => setTimeout(r, 140));
  const idleB = snap();

  return { found: true, swing: diff(before, after), idleOverSameTime: diff(idleA, idleB) };
});

out.exit = await page.evaluate(async () => {
  const overlay = document.querySelector(".card-detail-overlay");
  if (!overlay || overlay.hidden) return { ran: false };
  const close = overlay.querySelector(".cd-close");
  close.click();
  await new Promise((r) => setTimeout(r, 60));
  const mid = {
    leaving: overlay.classList.contains("cd-leaving"),
    hidden: overlay.hidden,
    opacity: getComputedStyle(overlay).opacity,
    transform: getComputedStyle(overlay).transform,
  };
  await new Promise((r) => setTimeout(r, 400));
  return { ran: true, mid, endHidden: overlay.hidden, classCleared: !overlay.classList.contains("cd-leaving") };
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
