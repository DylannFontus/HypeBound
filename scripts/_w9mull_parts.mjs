/**
 * What the mulligan is made of, part by part, at every scale and viewport.
 *
 * "The Confirm button is 32px below the fold" says the panel is too tall. It
 * does not say *which* pixels are the ones that do not fit, and the difference
 * decides the repair: if the head is the offender the type has to give, if the
 * tray is the offender the cards have to give, and if the fixed chrome alone
 * already exceeds the viewport then no amount of shrinking the cards will ever
 * be enough and the footer has to be pinned against a scroll region.
 *
 * So this measures the box model rather than the outcome: every direct child of
 * the panel, its own margin-box height, the panel's padding and gaps, the
 * viewport, and the surplus. It reports the same three numbers the fix has to
 * move — `fixedChrome` (everything that must never be squeezed), `tray` (the
 * only part allowed to give) and `surplus` (how much has to come from
 * somewhere).
 *
 * The scale is set by clicking the accessibility control, never by writing
 * `--ui-scale` onto the root — the setting drives JS layout decisions too, and a
 * hand-set property photographs a state the game never enters (`_ic3_scale.mjs`).
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const SCALES = String(arg("scales", "1,1.4,1.6")).split(",").map(Number);
const SIZES = String(arg("sizes", "844x390,1280x720")).split(",");
/** `battle?seed=4` deals a six-card hand going second — the longest head text
 *  and therefore the tallest panel the ordinary mulligan can produce. */
const ROUTES = String(arg("routes", "battle?seed=4,remix")).split(",");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await seedPlayedAccount(page, ORIGIN);

const PARTS = () => {
  const panel = document.querySelector(".mulligan-panel");
  if (!panel) return { error: "no panel" };
  const cs = getComputedStyle(panel);
  const pr = panel.getBoundingClientRect();
  const gap = parseFloat(cs.rowGap) || 0;
  const parts = [...panel.children].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el: String(el.className).trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      h: Math.round(r.height),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
    };
  });
  const canvas = panel.querySelector(".mulligan-card canvas");
  const btn = panel.querySelector(".mulligan-actions .btn-primary");
  const br = btn?.getBoundingClientRect();
  const tray = parts.find((p) => p.el === "mulligan-cards");
  const chrome =
    parseFloat(cs.paddingTop) +
    parseFloat(cs.paddingBottom) +
    gap * Math.max(0, parts.length - 1) +
    parts.filter((p) => p.el !== "mulligan-cards").reduce((s, p) => s + p.h, 0);
  return {
    vh: window.innerHeight,
    scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
    panelTop: Math.round(pr.top),
    panelH: Math.round(pr.height),
    padTop: Math.round(parseFloat(cs.paddingTop)),
    padBottom: Math.round(parseFloat(cs.paddingBottom)),
    gap: Math.round(gap),
    parts,
    trayH: tray?.h ?? 0,
    cardH: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0,
    cards: panel.querySelectorAll(".mulligan-card").length,
    fixedChrome: Math.round(chrome),
    surplus: Math.round(Math.max(0, pr.height - window.innerHeight)),
    btnBottom: br ? Math.round(br.bottom) : null,
    btnBelowFold: br ? Math.round(Math.max(0, br.bottom - window.innerHeight)) : null,
    btnAboveFold: br ? Math.round(Math.max(0, 0 - br.top)) : null,
    panelOverflows: panel.scrollHeight > panel.clientHeight + 2,
  };
};

for (const scale of SCALES) {
  const pct = `${Math.round(scale * 100)}%`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator("button", { hasText: new RegExp(`^${pct}$`) }).first().click();
  await page.waitForTimeout(400);

  for (const size of SIZES) {
    const [w, h] = size.split("x").map(Number);
    await page.setViewportSize({ width: w, height: h });
    for (const route of ROUTES) {
      const sep = route.includes("?") ? "&" : "?";
      await page.goto(`${ORIGIN}/?nointro#${route}${sep}r=${Date.now()}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0).catch(() => {});
      await page.waitForTimeout(900);
      const p = await page.evaluate(PARTS);
      if (p.error) {
        console.log(`${route.padEnd(16)} ${size} @${pct}  ${p.error}`);
        continue;
      }
      console.log(
        `${route.padEnd(16)} ${size} @${pct} (root ${p.scale})  panel ${p.panelH} in ${p.vh}  ` +
          `surplus ${p.surplus}  Confirm bottom ${p.btnBottom} (below ${p.btnBelowFold}, above ${p.btnAboveFold})`
      );
      console.log(
        `    pad ${p.padTop}/${p.padBottom} gap ${p.gap} | fixedChrome ${p.fixedChrome} | tray ${p.trayH} (card ${p.cardH} x${p.cards}) | panelScrolls ${p.panelOverflows}`
      );
      console.log(`    ${p.parts.map((x) => `${x.el}:${x.h}`).join("  ")}`);
    }
  }
}
await browser.close();
