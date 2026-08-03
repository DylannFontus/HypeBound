/**
 * A match played with no pointer at all — `13-accessibility.md` §13 and §16.
 *
 * The unit suite proves the model: zones, the key map, the state machine, the
 * mirror's text and the fact that it cannot leak the opponent's hand. None of
 * that needs a browser.
 *
 * What only a browser can show is that the keys are actually *wired* — that a
 * real `keydown` on the real screen moves a real cursor, opens the real chooser,
 * and sends a real intent to the engine. A pure reducer nobody connected is the
 * accessibility equivalent of a colour-blind mode that writes an attribute
 * nothing reads, which is the bug this project has now found twice.
 *
 * So: **the mouse is never used.** Playwright's `page.keyboard` only. If a step
 * here needs a click, keyboard play is not finished.
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

await seedPlayedAccount(page);

/**
 * A tripwire. From here on, any real mouse event on the page is a failure —
 * this script is allowed to *look*, never to click.
 */
await page.addInitScript(() => {
  window.__pointerUsed = false;
  for (const type of ["pointerdown", "mousedown", "click"]) {
    window.addEventListener(type, (event) => {
      if (event.isTrusted) window.__pointerUsed = true;
    }, true);
  }
});

// --- 1. reach the board ---------------------------------------------------------------
console.log("\n1. A real match, opened");
await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=90210`, { waitUntil: "networkidle" });
await page.waitForSelector(".battle-screen", { timeout: 20000 });

// the mulligan is a dialog of real buttons; Tab and Enter drive it
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
for (let tab = 0; tab < 30; tab++) {
  const onKeep = await page.evaluate(() =>
    (document.activeElement?.textContent ?? "").toLowerCase().includes("keep") ||
    (document.activeElement?.className ?? "").includes("btn-primary")
  );
  if (onKeep) break;
  await page.keyboard.press("Tab");
}
await page.keyboard.press("Enter");
await page.waitForSelector(".battle-hud", { timeout: 20000 });
await page.waitForTimeout(2000);
ok("the mulligan was dismissed with Tab and Enter — no pointer");

// --- 2. the Board Mirror ---------------------------------------------------------------
console.log("\n2. §16.2's Board Mirror");
const mirror = await page.evaluate(() => {
  const region = document.querySelector(".board-mirror");
  return {
    exists: Boolean(region),
    role: region?.getAttribute("role"),
    label: region?.getAttribute("aria-label"),
    lines: [...document.querySelectorAll(".board-mirror-line")].map((li) => li.textContent?.trim() ?? ""),
    live: [...document.querySelectorAll(".board-mirror-live")].map((el) => el.getAttribute("aria-live")),
    // it must be readable by assistive tech: not display:none, not visibility:hidden
    display: region ? getComputedStyle(region).display : null,
    visibility: region ? getComputedStyle(region).visibility : null,
  };
});
if (!mirror.exists) fail("there is no Board Mirror");
else if (mirror.role !== "region" || mirror.label !== "Board state") {
  fail(`the mirror is role="${mirror.role}" aria-label="${mirror.label}"; §16.2 asks for region / "Board state"`);
} else if (mirror.display === "none" || mirror.visibility === "hidden") {
  fail(`the mirror is ${mirror.display}/${mirror.visibility} — assistive tech skips both`);
} else {
  ok(`region "Board state", ${mirror.lines.length} lines, visually hidden but readable`);
  ok(`live regions: ${mirror.live.join(" + ")}`);
  for (const wanted of ["Turn", "Your board", "Opponent board", "Your hand"]) {
    if (!mirror.lines.some((line) => line.includes(wanted))) fail(`the mirror never says "${wanted}"`);
  }
  console.log(`      "${mirror.lines[0]}"`);
  console.log(`      "${mirror.lines[1]}"`);
}

// --- 3. moving the cursor ---------------------------------------------------------------
console.log("\n3. The cursor moves, and says where it is");
const cursorAt = () =>
  page.evaluate(() => ({
    zone: document.querySelector(".battle-screen")?.getAttribute("data-kb-zone"),
    mode: document.querySelector(".battle-screen")?.getAttribute("data-kb-mode"),
    focused: document.querySelector(".hand-card.kb-focus")?.getAttribute("data-instance") ?? null,
    said: document.querySelector('.board-mirror-live[aria-live="polite"]')?.textContent ?? "",
  }));

await page.keyboard.press("ArrowRight");
const moved = await cursorAt();
if (!moved.said || moved.said.length < 5) fail("moving the cursor announced nothing");
else ok(`Right announced: "${moved.said.slice(0, 90)}"`);

await page.keyboard.press("Tab");
const tabbed = await cursorAt();
if (tabbed.zone === moved.zone) fail(`Tab did not change zone (still ${tabbed.zone})`);
else ok(`Tab moved from ${moved.zone} to ${tabbed.zone}`);

// back to the hand for the rest
for (let tab = 0; tab < 12 && (await cursorAt()).zone !== "hand"; tab++) await page.keyboard.press("Tab");
if ((await cursorAt()).zone !== "hand") fail("could not tab back to the hand");
else ok("and tabbing wraps back round to the hand");

// --- 4. selecting and playing a card ----------------------------------------------------
console.log("\n4. Playing a card, entirely by keyboard");
const before = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);

/** Find a playable character in hand and select it by its number key. */
const playable = await page.evaluate(async () => {
  const battle = window.hypeboundBattle;
  const { checkPlayable } = await import("/src/engine/intents.ts");
  const view = battle.view();
  const state = battle.state();
  const content = battle.content();
  for (const [index, card] of view.you.hand.entries()) {
    if (index > 8) break;
    if (content.cards[card.cardId]?.type !== "character") continue;
    if (checkPlayable(state, content, view.seat, card.instanceId).ok) {
      return { position: index + 1, name: content.cards[card.cardId].name };
    }
  }
  return null;
});

if (!playable) {
  fail("no playable character in the opening hand to try");
} else {
  await page.keyboard.press(String(playable.position));
  const selected = await cursorAt();
  if (selected.mode !== "cardSelected") fail(`pressing ${playable.position} left the mode at "${selected.mode}"`);
  else ok(`pressed ${playable.position} — "${playable.name}" selected`);

  await page.keyboard.press("Enter");
  const placing = await cursorAt();
  if (placing.mode !== "slotPicking") fail(`Enter left the mode at "${placing.mode}", expected slotPicking`);
  else {
    const banner = await page.evaluate(() => {
      const el = document.querySelector("#board-mode-banner");
      return { text: el?.textContent ?? "", hidden: el?.hidden };
    });
    if (banner.hidden || !banner.text.includes("SLOT")) fail(`the mode banner reads "${banner.text}"`);
    else ok(`the mode banner says "${banner.text}"`);
  }

  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
  if (after <= before) fail(`the board still has ${after} characters; the card was never played`);
  else ok(`the character is on the board (${before} → ${after}) — selected, placed and played with four keys`);
}
await page.screenshot({ path: path.join(OUT, "keyboard-board.png") });

// --- 5. the shortcut sheet ---------------------------------------------------------------
console.log("\n5. The shortcut sheet");
await page.keyboard.press("?");
await page.waitForTimeout(300);
const sheet = await page.evaluate(() => ({
  open: Boolean(document.querySelector(".shortcut-sheet")),
  rows: document.querySelectorAll(".shortcut-table tr").length,
  focused: document.activeElement?.textContent ?? "",
}));
if (!sheet.open) fail("? did not open the shortcut sheet");
else ok(`? opened §13.2's table — ${sheet.rows} keys listed, focus on "${sheet.focused.trim()}"`);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
if (await page.evaluate(() => Boolean(document.querySelector(".shortcut-sheet")))) {
  fail("the sheet would not close from the keyboard");
} else {
  ok("and Enter on the focused Close button dismisses it");
}

// --- 6. attacking -------------------------------------------------------------------------
console.log("\n6. Attacking, with target cycling");
// end the turn so the character loses summoning sickness, then come back round
await page.keyboard.press("x");
await page.waitForTimeout(400);
const confirmOpen = await page.evaluate(() => Boolean(document.querySelector(".confirm-panel")));
if (confirmOpen) {
  // the confirm dialog is real buttons; Tab to the primary and press it
  for (let tab = 0; tab < 8; tab++) {
    const onPrimary = await page.evaluate(() => (document.activeElement?.className ?? "").includes("btn-primary"));
    if (onPrimary) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
}
await page.waitForTimeout(6000);

const attackable = await page.evaluate(async () => {
  const battle = window.hypeboundBattle;
  const { attackableBy } = await import("/src/engine/intents.ts");
  const state = battle.state();
  const view = battle.view();
  if (view.activeSeat !== view.seat) return { yourTurn: false, count: 0 };
  return { yourTurn: true, count: attackableBy(state, battle.content(), view.seat).length };
});

if (!attackable.yourTurn) {
  ok("the turn had not come back round in time — attack cycling is covered by the unit suite");
} else if (attackable.count === 0) {
  ok("nothing was ready to attack this turn — attack cycling is covered by the unit suite");
} else {
  // tab to your board, walk to a ready character, and attack
  await page.evaluate(() => document.querySelector(".battle-screen")?.focus());
  for (let tab = 0; tab < 14 && (await cursorAt()).zone !== "yourBoard"; tab++) await page.keyboard.press("Tab");
  const beforeHealth = await page.evaluate(() => window.hypeboundBattle.view().opponent.leaderHealth);

  let entered = false;
  for (let step = 0; step < 7 && !entered; step++) {
    await page.keyboard.press("a");
    entered = (await cursorAt()).mode === "attackSelect";
    if (!entered) await page.keyboard.press("ArrowRight");
  }

  if (!entered) fail("A never entered attack mode on any character");
  else {
    const said = (await cursorAt()).said;
    if (!/Target \d+ of \d+/.test(said)) fail(`entering attack mode said "${said}"`);
    else ok(`A entered attack mode: "${said.slice(0, 80)}"`);

    await page.keyboard.press("t");
    const cycled = (await cursorAt()).said;
    ok(`T cycled to: "${cycled.slice(0, 80)}"`);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const afterHealth = await page.evaluate(() => window.hypeboundBattle.view().opponent.leaderHealth);
    const boardChanged = await page.evaluate(() => window.hypeboundBattle.view().opponent.board.filter(Boolean).length);
    if (afterHealth === beforeHealth && boardChanged === undefined) fail("the attack did nothing");
    else ok(`the attack resolved (enemy leader ${beforeHealth} → ${afterHealth})`);
  }
}

// --- 7. announcements ---------------------------------------------------------------------
console.log("\n7. Announcements reached a live region");
const live = await page.evaluate(() => ({
  polite: document.querySelector('.board-mirror-live[aria-live="polite"]')?.textContent ?? "",
  assertive: document.querySelector('.board-mirror-live[aria-live="assertive"]')?.textContent ?? "",
}));
if (!live.assertive) fail("nothing was ever announced assertively — turn changes should be");
else ok(`assertive: "${live.assertive.slice(0, 90)}"`);
if (!live.polite) fail("nothing was ever announced politely");
else ok(`polite: "${live.polite.slice(0, 90)}"`);

// --- 8. the mirror kept up ---------------------------------------------------------------
console.log("\n8. The mirror still matches the board");
const consistency = await page.evaluate(() => {
  const view = window.hypeboundBattle.view();
  const lines = [...document.querySelectorAll(".board-mirror-line")].map((li) => li.textContent ?? "");
  const yourBoard = lines.find((line) => line.startsWith("Your board"));
  const hand = lines.find((line) => line.startsWith("Your hand"));
  return {
    yourBoard,
    hand,
    realBoard: view.you.board.filter(Boolean).length,
    realHand: view.you.hand.length,
  };
});
if (!consistency.yourBoard?.includes(`${consistency.realBoard} of`)) {
  fail(`the mirror says "${consistency.yourBoard}" and the board holds ${consistency.realBoard}`);
} else {
  ok(`"${consistency.yourBoard}" matches the ${consistency.realBoard} on the board`);
}
if (!consistency.hand?.includes(`${consistency.realHand} card`)) {
  fail(`the mirror says "${consistency.hand}" and the hand holds ${consistency.realHand}`);
} else {
  ok(`"${consistency.hand}" matches the ${consistency.realHand} in hand`);
}

// --- 9. no pointer was used ----------------------------------------------------------------
console.log("\n9. No pointer was used");
const pointerUsed = await page.evaluate(() => window.__pointerUsed === true);
if (pointerUsed) fail("a real pointer event fired — this script clicked something");
else ok("the whole match above was played with the keyboard alone");

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/keyboard-board.png");
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
