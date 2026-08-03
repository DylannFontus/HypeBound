/**
 * Accessibility, in a real browser — §4.6.2 and `13-accessibility.md`.
 *
 * The unit suite proves the palettes clear §7.2's bar and that the settings
 * model behaves. What only a browser can prove is the thing this block was
 * really about: **that the settings do something.**
 *
 * Two of them did not. Nothing anywhere read `data-colorblind` or `data-labels`,
 * so three colour-blind modes and the written-labels toggle were switches
 * attached to nothing — which for an accessibility option is the worst version
 * of that bug, because the person it fails is the person who needed it.
 *
 * So every check here is of the form "change the setting, then measure the page
 * and the rendered card": the root font size in pixels, the pixels in a card's
 * badge, the outline on a focused button, the letter spacing of body text.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

let failures = 0;
const fail = (m) => {
  console.log(`   FAIL: ${m}`);
  failures += 1;
};
const ok = (m) => console.log(`   ok: ${m}`);

const settleOn = async (selector) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
};

const set = async (patch) => {
  await page.evaluate((p) => window.hypeboundA11y.set(p), patch);
  await page.waitForTimeout(120);
};

await seedPlayedAccount(page);

// --- 1. reachable ------------------------------------------------------------------
console.log("\n1. §4.6.2 asks for a dedicated, discoverable surface");
await page.goto("http://localhost:5173/#settings", { waitUntil: "networkidle" });
await settleOn(".settings-screen");
if ((await page.locator("#set-a11y").count()) === 0) fail("Settings has no accessibility link");
else {
  await page.locator("#set-a11y").click();
  await settleOn(".a11y-screen");
  ok("Settings opens the accessibility screen");
}
if ((await page.locator("#set-accessibility").count()) === 0) {
  // the links row is on the settings screen, not this one
  await page.goto("http://localhost:5173/#settings", { waitUntil: "networkidle" });
  await settleOn(".settings-screen");
  if ((await page.locator("#set-accessibility").count()) === 0) fail("the links row has no accessibility entry");
  else ok("and it is in §4.6.1's links row too");
}
await page.goto("http://localhost:5173/#a11y", { waitUntil: "networkidle" });
await settleOn(".a11y-screen");

// --- 2. the interface scale ----------------------------------------------------------
console.log("\n2. Interface size — §3.2's seven steps");
const scales = await page.evaluate(() => window.hypeboundA11y.scales());
if (scales.length !== 7) fail(`${scales.length} steps, §3.2 specifies 7`);
else ok(`${scales.length} steps from ${scales[0] * 100}% to ${scales[scales.length - 1] * 100}%`);

const measured = [];
for (const scale of scales) {
  await set({ uiScale: scale });
  const px = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  measured.push({ scale, px });
}
const wrong = measured.filter((entry) => Math.abs(entry.px - 16 * entry.scale) > 0.6);
if (wrong.length > 0) fail(`the root font size does not follow the scale: ${JSON.stringify(wrong)}`);
else ok(`the root font size follows every step (${measured.map((m) => `${m.px}px`).join(", ")})`);

/** §3.2: no layout may horizontally scroll the page body at any step. */
await set({ uiScale: 1.6 });
const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
if (overflows) fail("the page scrolls horizontally at 160%");
else ok("and the page body still does not scroll sideways at 160%");
await set({ uiScale: 1 });

// --- 3. colour-blind modes, which used to do nothing ------------------------------------
console.log("\n3. Colour-blind modes — the setting that was inert");
const pressure = await page.evaluate(() => window.hypeboundA11y.pressure());
for (const entry of pressure) {
  if (entry.confusableByDefault === 0) fail(`${entry.mode} claims to fix nothing`);
  if (entry.confusableInMode !== 0) fail(`${entry.mode} leaves ${entry.confusableInMode} pairs confusable`);
}
ok(
  `each mode states its effect: ${pressure
    .map((e) => `${e.mode} ${e.confusableByDefault}→${e.confusableInMode}`)
    .join(", ")}`
);

const swatchFor = async (mode) => {
  await set({ colorblindMode: mode });
  return page.evaluate(() => ({
    palette: window.hypeboundA11y.swatches(),
    cssVeil: getComputedStyle(document.documentElement).getPropertyValue("--current-veil").trim(),
    attr: document.documentElement.dataset.colorblind,
  }));
};
const off = await swatchFor("off");
const deut = await swatchFor("deuteranopia");
if (off.palette.veil === deut.palette.veil) fail("switching mode did not change the palette");
else ok(`the palette moves — Veil ${off.palette.veil} → ${deut.palette.veil}`);
if (!deut.cssVeil || deut.cssVeil === off.cssVeil) fail("the CSS custom property did not follow the mode");
else ok(`and the CSS token follows it (--current-veil: ${deut.cssVeil})`);
if (deut.attr !== "deuteranopia") fail(`the root attribute reads "${deut.attr}"`);

/** The canvas has to move too, or cards and DOM would disagree about a Current. */
const cardPixels = async () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".a11y-card-preview canvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
    return sum;
  });
await set({ colorblindMode: "off" });
const cardOff = await cardPixels();
await set({ colorblindMode: "deuteranopia" });
const cardDeut = await cardPixels();
if (cardOff === cardDeut) fail("the rendered card is identical in both modes — the canvas ignores the palette");
else ok("and the rendered card changes with it, so cards and DOM agree");

/** §8.1's hatch is forced on in any mode, and is a real difference in pixels. */
const patterns = await page.evaluate(() => window.hypeboundA11y.patternsOn());
if (!patterns) fail("patterns are not forced on inside a colour-blind mode");
else ok("hatch fills are forced on inside a mode (§8.1)");
await set({ colorblindMode: "off", currentPatterns: false });
const plain = await cardPixels();
await set({ currentPatterns: true });
const hatched = await cardPixels();
if (plain === hatched) fail("turning patterns on changed no pixels on the card");
else ok("and turning them on alone changes the card too");
await set({ currentPatterns: false });
await page.screenshot({ path: path.join(OUT, "a11y.png") });

// --- 4. written labels, the other inert one --------------------------------------------
console.log("\n4. Written labels");
await set({ verboseLabels: false });
const compact = await page.evaluate(() => document.documentElement.dataset.labels);
await set({ verboseLabels: true });
const verbose = await page.evaluate(() => document.documentElement.dataset.labels);
if (compact !== "compact" || verbose !== "verbose") fail(`the root attribute did not follow (${compact} / ${verbose})`);
else ok("the root attribute follows the toggle");
const revealed = await page.evaluate(() => {
  const probe = document.createElement("span");
  probe.className = "icon-label";
  probe.textContent = "Deck";
  document.body.appendChild(probe);
  const shown = probe.getBoundingClientRect().width;
  document.documentElement.dataset.labels = "compact";
  const hidden = probe.getBoundingClientRect().width;
  document.documentElement.dataset.labels = "verbose";
  probe.remove();
  return { shown, hidden };
});
if (!(revealed.shown > 4 && revealed.hidden <= 2)) {
  fail(`an icon label measures ${revealed.shown}px verbose and ${revealed.hidden}px compact — the rule does nothing`);
} else ok(`and an icon label really does appear (${Math.round(revealed.shown)}px vs ${revealed.hidden}px)`);

// --- 5. focus ring ----------------------------------------------------------------------
console.log("\n5. Keyboard focus — §12.2");
for (const [ring, expected] of [["thin", 2], ["medium", 3], ["thick", 5]]) {
  await set({ keyboardNav: true, focusRing: ring });
  const width = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--focus-width"))
  );
  if (Math.abs(width - expected) > 0.1) fail(`focus ring "${ring}" is ${width}px, expected ${expected}px`);
}
ok("the focus outline width follows thin / medium / thick");

/**
 * Focus has to arrive from the **keyboard**.
 *
 * `:focus-visible` deliberately does not match a programmatic `.focus()` or a
 * mouse click — that is the whole reason the rule uses it rather than `:focus`,
 * so a pointer user is not left with outlines behind every button they press.
 * An earlier version of this check called `.focus()` and concluded the ring was
 * broken; it was measuring something the rule is designed not to do.
 */
const tabToSomething = async () => {
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, outline: style.outlineWidth, style: style.outlineStyle };
  });
};

const outlined = await tabToSomething();
if (parseFloat(outlined.outline) <= 0 || outlined.style === "none") {
  fail(`tabbing to a ${outlined.tag} left it with no outline (${outlined.outline} ${outlined.style})`);
} else ok(`and tabbing to a control outlines it (${outlined.tag}, ${outlined.outline} ${outlined.style})`);

await set({ keyboardNav: false });
const unringed = await tabToSomething();
if (unringed.style !== "none") fail(`turning keyboard navigation off left the outline as "${unringed.style}"`);
else ok("turning it off removes the outline");
await set({ keyboardNav: true });

// --- 6. dyslexia-friendly text and the Rules Lens -----------------------------------------
console.log("\n6. Reading aids");
await set({ dyslexiaFont: false });
const normalSpacing = await page.evaluate(() => getComputedStyle(document.body).letterSpacing);
await set({ dyslexiaFont: true });
const wideSpacing = await page.evaluate(() => getComputedStyle(document.body).letterSpacing);
if (normalSpacing === wideSpacing) fail("the dyslexia-friendly setting changed no typography");
else ok(`letter spacing widens (${normalSpacing} → ${wideSpacing})`);
await set({ dyslexiaFont: false });

await set({ rulesLens: false });
const lensOff = await cardPixels();
await set({ rulesLens: true });
const lensOn = await cardPixels();
if (lensOff === lensOn) fail("the Rules Lens printed nothing on the card");
else ok("the Rules Lens changes what is printed on the card face");
await set({ rulesLens: false });

// --- 7. what is missing, and why -----------------------------------------------------------
console.log("\n7. What is not here yet");
const deferred = await page.evaluate(() => window.hypeboundA11y.deferred());
const printed = await page.locator(".mail-deferred-list li").count();
if (printed !== deferred.length) fail(`${deferred.length} deferred controls, ${printed} printed`);
else ok(`all ${printed} unbuilt controls are listed with a reason`);
const text = await page.locator(".policy-note").innerText();
for (const wanted of ["Screen-reader", "Controller"]) {
  if (!text.includes(wanted)) fail(`"${wanted}" is not accounted for on screen`);
}
ok("including the ones a player would go looking for");

// --- 8. and the battle still runs -----------------------------------------------------------
console.log("\n8. A match still deals a board with everything on");
await set({ colorblindMode: "tritanopia", uiScale: 1.25, highContrast: true, currentPatterns: true });
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=909", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
const board = await page.evaluate(() => document.querySelectorAll(".hand-card, .mulligan-card").length);
if (board === 0) fail("no cards were dealt");
else ok(`${board} cards dealt with a colour-blind mode, 125% text and high contrast all on`);
await page.screenshot({ path: path.join(OUT, "a11y-battle.png") });

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of errors.slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log(`\n   saved screenshots/a11y.png and a11y-battle.png`);
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
