/**
 * The Custom Lobby in a real browser — `09-game-modes.md` §17.
 *
 * One check here matters more than the rest, and it is the reason this script
 * exists: **Hotseat's hand-hiding handoff.**
 *
 * Its failure mode is silent and serious — a single frame of the wrong player's
 * hand on screen — and it is easy to write a check that cannot catch it.
 * "The overlay exists" is not the assertion. The assertion is that **the board
 * is not drawn underneath it**: that the hand behind the cover belongs to nobody
 * yet, and that the cover does not lift until somebody says they are ready.
 *
 * The rest is §17's other binding line — every knob "clearly displayed to both
 * seats before start" — plus the anti-farming rule, which has to be visible
 * *before* the match rather than discovered after it.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
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

await seedPlayedAccount(page);

// ---------------------------------------------------------------------------

console.log("\n1. Reachable, and every knob on one page");
await page.goto(`${ORIGIN}/#custom`, { waitUntil: "networkidle" });
await settleOn(".custom-screen");

const knobs = await page.evaluate(() => ({
  health: Boolean(document.querySelector("#custom-health")),
  deckSize: Boolean(document.querySelector("#custom-deck-size")),
  handFirst: Boolean(document.querySelector("#custom-hand-first")),
  handSecond: Boolean(document.querySelector("#custom-hand-second")),
  timer: Boolean(document.querySelector("#custom-timer")),
  timerOff: Boolean(document.querySelector("#custom-timer-off")),
  modifier: Boolean(document.querySelector("#custom-modifier")),
  hotseat: Boolean(document.querySelector('[data-opponent="hotseat"]')),
  settings: window.hypeboundCustom.settings(),
}));
const missing = Object.entries(knobs).filter(([key, value]) => key !== "settings" && !value).map(([key]) => key);
if (missing.length > 0) fail(`§17 asks for these knobs and they are not on the page: ${missing.join(", ")}`);
else ok("every §17 knob is on one page, visible without opening anything");

// ---------------------------------------------------------------------------

console.log("\n2. The ranges are enforced, not suggested");
const clamped = await page.evaluate(() => {
  window.hypeboundCustom.set({ startingHealth: 9999, deckSize: 1 });
  return window.hypeboundCustom.settings();
});
if (clamped.startingHealth > 40 || clamped.deckSize < 20) {
  fail(`out-of-range values survived: health ${clamped.startingHealth}, deck ${clamped.deckSize}`);
} else {
  ok(`out-of-range values are clamped to §17's bounds (health ${clamped.startingHealth}, deck ${clamped.deckSize})`);
}

// ---------------------------------------------------------------------------

console.log("\n3. Whether it pays is stated before the match, not after");
const paying = await page.evaluate(() => {
  window.hypeboundCustom.set({ startingHealth: 30, deckSize: 30, handFirst: 4, handSecond: 5, opponent: "ai" });
  return { flags: window.hypeboundCustom.flags(), text: document.querySelector("#custom-pays")?.textContent?.trim() ?? "" };
});
if (paying.flags.length !== 0) fail(`a standard game reports as unpaid: ${paying.flags.join("; ")}`);
else if (!/Sparring/i.test(paying.text)) fail(`a standard game does not say it pays: "${paying.text}"`);
else ok(`a standard game says it pays — "${paying.text.slice(0, 70)}"`);

const easier = await page.evaluate(() => {
  window.hypeboundCustom.set({ startingHealth: 20 });
  return {
    flags: window.hypeboundCustom.flags(),
    text: document.querySelector("#custom-pays")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    reasons: [...document.querySelectorAll(".custom-flags li")].map((li) => li.textContent.trim()),
  };
});
if (easier.flags.length === 0) fail("lowering starting health below standard still pays — §17's farming rule is not enforced");
else if (!/nothing/i.test(easier.text)) fail(`the screen does not say it pays nothing: "${easier.text}"`);
else ok(`an easier-than-standard game says it pays nothing, and why — "${easier.reasons[0]?.slice(0, 70)}"`);

const harder = await page.evaluate(() => {
  window.hypeboundCustom.set({ startingHealth: 40 });
  return window.hypeboundCustom.flags();
});
if (harder.length !== 0) fail("a HARDER-than-standard game was flagged; nobody farms a game they made harder");
else ok("and a harder-than-standard game still pays");

await page.screenshot({ path: path.join(OUT, "custom-lobby.png"), fullPage: true });

// ---------------------------------------------------------------------------

console.log("\n4. Hotseat — the board is not drawn underneath the handoff");
await page.evaluate(() => {
  window.hypeboundCustom.set({ opponent: "hotseat", startingHealth: 30, deckSize: 30 });
});
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector("#custom-start")?.click());
await settleOn(".battle-screen");
await page.waitForTimeout(2500);

/**
 * Get to a handoff, however the coin flip fell.
 *
 * The first version of this assumed the local player always moves first and so
 * always has to *end* a turn before the device changes hands. Not so: when the
 * flip gives the first turn to seat two, the handoff is owed the moment the
 * mulligan clears — which is the case this actually caught. So: dismiss the
 * mulligan, and only end a turn if the cover has not already gone up.
 */
const passed = await page.evaluate(async () => {
  // the mulligan's own Confirm, not "the last button in the overlay" — that
  // picked up a REPLACE toggle on a card and left the mulligan standing
  const confirm = [...document.querySelectorAll(".mulligan-actions button")].find((b) =>
    /confirm/i.test(b.textContent ?? "")
  );
  confirm?.click();
  await new Promise((r) => setTimeout(r, 1600));

  if (document.querySelector(".handoff-overlay")) return { ended: true, via: "the opening flip" };

  const end = [...document.querySelectorAll("button")].find((b) => /end turn/i.test(b.textContent ?? ""));
  if (!end) return { ended: false, via: "" };
  end.click();
  await new Promise((r) => setTimeout(r, 2000));
  return { ended: true, via: "ending a turn" };
});
if (passed.ended) ok(`reached the handoff by ${passed.via}`);

const handoff = await page.evaluate(() => {
  const overlay = document.querySelector(".handoff-overlay");
  const panel = document.querySelector(".handoff-panel");
  const hand = [...document.querySelectorAll(".hand-card, .hand .card")];
  /**
   * The real question: is anything of the incoming player's hand reachable while
   * the cover is up? A visible overlay over a visible board is not a cover.
   */
  const overlayBox = overlay?.getBoundingClientRect();
  const handVisible = hand.filter((card) => {
    const style = getComputedStyle(card);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const box = card.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (!overlayBox) return true;
    // a card is covered when the overlay's rect contains its centre
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    return !(cx >= overlayBox.left && cx <= overlayBox.right && cy >= overlayBox.top && cy <= overlayBox.bottom);
  });
  return {
    open: Boolean(overlay),
    name: panel?.querySelector("#handoff-name")?.textContent?.trim() ?? "",
    opaque: overlay ? getComputedStyle(overlay).backgroundColor : "",
    uncoveredCards: handVisible.length,
    body: panel?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  };
});

if (!passed.ended) {
  fail("could not reach a handoff — no End Turn control and no opening handoff");
} else if (!handoff.open) {
  fail("Hotseat never raised the handoff — the next player would be looking at the previous one's board");
} else {
  ok(`the handoff is up and names who it is waiting for ("${handoff.name}")`);
  if (handoff.uncoveredCards > 0) {
    fail(`${handoff.uncoveredCards} hand card(s) are visible outside the cover — the point of the handoff is that they are not`);
  } else {
    ok("and no hand card is visible outside it");
  }
  /**
   * Near-total opacity, not merely "not transparent".
   *
   * The first version of this only rejected alpha 0, and happily passed a cover
   * computed at `rgba(3, 2, 8, 0.78)` — through which the outgoing player's hand
   * was plainly readable. A hand-hiding screen is either opaque or it is
   * decoration, and a check that cannot tell the difference is the same.
   */
  const alpha = Number(/rgba?\([^)]*?([\d.]+)\s*\)$/.exec(handoff.opaque)?.[1] ?? "1");
  if (alpha < 0.98) {
    fail(`the cover is only ${Math.round(alpha * 100)}% opaque (${handoff.opaque}) — the hand shows through it`);
  } else {
    ok(`the cover is opaque (${handoff.opaque})`);
  }
  if (!/do not press/i.test(handoff.body)) fail("the handoff does not warn against pressing on before the device changes hands");
  else ok("and it asks the player not to press on until the device is actually in front of them");
}

await page.screenshot({ path: path.join(OUT, "custom-handoff.png") });

// and it lifts only when asked
if (handoff.open) {
  const lifted = await page.evaluate(async () => {
    document.querySelector("#handoff-ready")?.click();
    await new Promise((r) => setTimeout(r, 800));
    return {
      stillUp: Boolean(document.querySelector(".handoff-overlay")),
      hand: document.querySelectorAll(".hand-card, .hand .card").length,
    };
  });
  if (lifted.stillUp) fail("the cover did not lift when the next player said they were ready");
  else ok(`the cover lifts on request, and the incoming player has a hand (${lifted.hand} cards)`);
}

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/custom-*.png");
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
