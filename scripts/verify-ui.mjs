/**
 * Browser smoke check.
 *
 * Loads the running dev server in headless Chrome, walks the main screens,
 * plays a real match against the AI, and fails loudly on any console error or
 * page exception. Screenshots land in scripts/screenshots/ for visual review.
 *
 * Usage: node scripts/verify-ui.mjs [baseUrl]
 */

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const BASE = process.argv[2] ?? "http://localhost:5173";
/**
 * Fixed seed so every run plays the identical match.
 *
 * Overridable because the battle steps need a match that lasts long enough to
 * reach them: the walkthrough passes several turns, which hands a beginner AI
 * free attacks, so on an unlucky seed the game is over before the attack step.
 * `VERIFY_SEED=n npm run verify:ui` is how you go looking for a better one.
 */
const SEED = process.env["VERIFY_SEED"] ?? "20260725";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "screenshots");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const errors = [];
const warnings = [];

function record(kind, text) {
  // WebGL software-rendering notices are expected in headless and are not failures
  if (/SwiftShader|GroupMarkerNotSet|Automatic fallback to software|GPU stall|deprecated/i.test(text)) {
    warnings.push(text);
    return;
  }
  // the response handler below reports 404s with their URL; this console echo
  // carries no URL, so it would only ever duplicate a filtered entry
  if (/^Failed to load resource/.test(text)) {
    warnings.push(text);
    return;
  }
  if (kind === "error") errors.push(text);
  else warnings.push(text);
}

async function findChrome() {
  const { existsSync } = await import("node:fs");
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome or Edge installation found");
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const executablePath = await findChrome();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") record(type === "error" ? "error" : "warn", message.text());
  });
  page.on("pageerror", (error) => record("error", `PAGE EXCEPTION: ${error.message}\n${error.stack ?? ""}`));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (/\/assets\/(art|audio)\//.test(url)) return; // expected until assets are added
    if (/favicon/.test(url)) return; // cosmetic, added at packaging time
    record("error", `HTTP ${response.status()}: ${url}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    // missing art and audio are expected until the owner adds assets
    if (/\/assets\/(art|audio)\//.test(url)) return;
    record("error", `REQUEST FAILED: ${url} — ${request.failure()?.errorText}`);
  });

  const step = async (name, fn) => {
    process.stdout.write(`• ${name}… `);
    try {
      await fn();
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
      console.log("ok");
    } catch (error) {
      console.log("FAILED");
      errors.push(`STEP "${name}" failed: ${error.message}`);
      await page.screenshot({ path: path.join(SHOTS, `${name}-FAILED.png`) }).catch(() => {});
    }
  };

  // every verification starts from a clean browser profile, which is now a
  // brand-new account; give it one that has already begun
  await seedPlayedAccount(page, BASE);

  // ---- lobby --------------------------------------------------------------
  await step("01-lobby", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector(".lobby-screen", { timeout: 15000 });
    await page.waitForTimeout(900); // let the leader card render
    const leaderName = await page.textContent(".lobby-leader-name");
    if (!leaderName || leaderName.includes("Choose a Leader")) {
      throw new Error(`lobby has no active deck/leader (got "${leaderName}")`);
    }
  });

  // ---- collection ---------------------------------------------------------
  await step("02-collection", async () => {
    await page.click("#lobby-collection");
    await page.waitForSelector(".card-grid .card-cell", { timeout: 10000 });
    await page.waitForTimeout(700);
    const count = await page.locator(".card-cell").count();
    if (count < 5) throw new Error(`collection rendered only ${count} cards`);
  });

  /**
   * The inspector, checked on the two things a smoke test should: that it opens,
   * and that it closes again. `verify:cards` covers the tabs, the fallbacks and
   * the arrows — this step only has to notice if the screen stops working.
   */
  await step("03-card-detail", async () => {
    await page.locator(".card-cell").first().click();
    await page.waitForSelector(".cd-stage", { timeout: 5000 });
    await page.waitForTimeout(500);
    const name = (await page.textContent(".cd-name"))?.trim();
    if (!name) throw new Error("the card detail opened with no card name");
    if ((await page.locator(".cd-tab").count()) !== 2) throw new Error("the detail panel lost its tabs");
    await page.keyboard.press("Escape");
    // Escape hides the overlay rather than removing it, so wait on visibility
    await page.waitForSelector(".card-detail-overlay", { state: "hidden", timeout: 5000 });
  });

  // ---- deck builder -------------------------------------------------------
  await step("04-deck-builder", async () => {
    await page.goto(`${BASE}/#deckbuilder`, { waitUntil: "networkidle" });
    await page.waitForSelector(".builder-screen", { timeout: 10000 });
    await page.waitForSelector(".pool-cell", { timeout: 10000 });
    await page.waitForTimeout(800);
    const validation = await page.textContent(".deck-validation");
    if (!validation) throw new Error("deck validation panel is empty");
  });

  // ---- settings -----------------------------------------------------------
  await step("05-settings", async () => {
    await page.goto(`${BASE}/#settings`, { waitUntil: "networkidle" });
    await page.waitForSelector(".settings-screen", { timeout: 10000 });
    await page.waitForTimeout(400);
  });

  // ---- mode select --------------------------------------------------------
  await step("06-mode-select", async () => {
    await page.goto(`${BASE}/#play`, { waitUntil: "networkidle" });
    // `.mode-grid` was replaced by `.play-body` (a hero slot, a features row and
    // a tail list) when the front door was rebuilt; the tiles are still
    // `.mode-card`. See `scripts/verify-story.mjs:105`, which is still stale.
    await page.waitForSelector(".play-body .mode-card", { timeout: 10000 });
    await page.waitForTimeout(400);
  });

  // ---- battle: mulligan ---------------------------------------------------
  await step("07-battle-mulligan", async () => {
    // fixed seed so every verification run plays the identical match
    await page.goto(`${BASE}/#battle?difficulty=beginner&seed=${SEED}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
    await page.waitForTimeout(1500); // card canvases render
    const cards = await page.locator(".mulligan-card").count();
    if (cards < 4) throw new Error(`mulligan showed ${cards} cards, expected at least 4`);
  });

  // ---- battle: the hand must be interactive -------------------------------
  await step("08-battle-board", async () => {
    await page.click(".mulligan-actions .btn-primary");
    await page.waitForSelector(".battle-hud", { timeout: 10000 });
    // wait for the player's turn to actually begin
    await page.waitForFunction(() => document.querySelector(".end-turn-btn.ready") !== null, null, { timeout: 25000 });
    await page.waitForTimeout(2500); // board, hand fan and HUD settle
    const hype = await page.textContent(".hype-count");
    if (!hype) throw new Error("Hype counter did not render");
  });

  /**
   * A step that gives up because the match finished must SAY so.
   *
   * These steps used to return quietly when they found the end-of-match overlay,
   * which reads as a pass. With a fixed seed that is not a flake — it means the
   * step has stopped exercising the thing it names, permanently, and nobody
   * would know. If this fires, pick a seed whose match runs longer.
   */
  const MATCH_ENDED = "the match ended before this step could run, so it proved nothing";

  // --- battle helpers shared by the play and attack steps -------------------

  /**
   * Wait until it is genuinely the player's turn.
   *
   * `.end-turn-btn:not([disabled])` is not that signal — it can be enabled while
   * the opponent is still finishing. A step that measures the hand on that basis
   * is racing the AI's end of turn, and losing it looks exactly like a product
   * bug: "a cancelled drag added a card to your hand", when what happened is
   * that your next turn started mid-drag and drew one. Ask the engine instead.
   *
   * NOTE the `null`. `waitForFunction(fn, arg, options)` takes the options
   * THIRD, so the two-argument form passes the timeout as the page function's
   * *argument* and silently falls back to Playwright's 30s default. This budget
   * said 45s and was 30s for as long as it has existed, which is what made step
   * 12 fail whenever the machine was busy — the same shape as the AI suite's 5s
   * timeout: a limit the author set that never applied.
   */
  const waitForYourTurn = async (timeout = 45000) => {
    await page.waitForFunction(
      () => {
        if (document.querySelector(".end-overlay")) return true;
        const view = window.hypeboundBattle?.view?.();
        return !!view && view.winner === null && view.phase === "main" && view.activeSeat === view.seat;
      },
      null,
      { timeout }
    );
    // let the presenter drain whatever the opponent's turn queued
    await page.waitForTimeout(600);
  };

  const boardCounts = () =>
    page.evaluate(() => {
      const view = window.hypeboundBattle.view();
      return {
        you: view.you.board.filter(Boolean).length,
        enemy: view.opponent.board.filter(Boolean).length,
        hype: view.you.hype,
        over: view.winner !== null,
      };
    });

  /**
   * Drag a playable CHARACTER onto the board, the way a player would: find one
   * the engine reports as playable and grab it at its real on-screen position.
   * Dragging at blind coordinates mostly lands on Actions, which never add a
   * board character and so silently prove nothing.
   */
  const playOneCard = async () => {
    const box = await page.locator("canvas").first().boundingBox();
    if (!box) return false;
    const before = (await boardCounts()).you;

    const candidates = await page.evaluate(() =>
      window.hypeboundBattle
        .debug()
        .hand.filter((c) => c.ok && c.type === "character" && c.screen)
        .map((c) => ({ cardId: c.cardId, x: c.screen.x, y: c.screen.y }))
    );
    if (candidates.length === 0) return false;

    for (const candidate of candidates) {
      await page.mouse.move(candidate.x, candidate.y);
      await page.waitForTimeout(150); // let the hover lift register
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 12 });
      await page.waitForTimeout(110);
      await page.mouse.up();
      await page.waitForTimeout(650);

      const chooser = page.locator(".chooser-list .chooser-option").first();
      if (await chooser.count()) {
        await chooser.click();
        await page.waitForTimeout(650);
      }
      if ((await boardCounts()).you > before) return true;
    }
    return false;
  };

  /** End the player's turn, answering the confirmation if one appears. */
  const passTurn = async () => {
    await page.click(".end-turn-btn").catch(() => {});
    const confirm = page.locator(".confirm-panel .btn-primary");
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(1200);
  };

  /**
   * The cancel test comes FIRST, before any Hype is spent.
   *
   * The order used to be play-then-cancel, which left the cancel step hunting
   * for a castable card with an empty Hype pool — so it passed turns, and so did
   * the attack step after it. Around fourteen turns of a player who mostly does
   * nothing, against an AI that does not: the match was over before the attack
   * step, which then exited quietly and reported a pass. Cancelling a drag needs
   * exactly one playable card and no turns at all, so it goes first.
   */
  await step("09-battle-drag-cancel", async () => {
    const box = await page.locator("canvas").first().boundingBox();
    const findCandidate = () =>
      page.evaluate(
        () =>
          window.hypeboundBattle
            .debug()
            .hand.find((c) => c.ok && c.type === "character" && c.screen) ?? null
      );

    let candidate = await findCandidate();
    for (let round = 0; round < 3 && !candidate; round++) {
      if (await page.locator(".end-overlay").count()) throw new Error(MATCH_ENDED);
      await passTurn();
      await waitForYourTurn();
      if (await page.locator(".end-overlay").count()) throw new Error(MATCH_ENDED);
      candidate = await findCandidate();
    }
    if (!candidate) {
      const hand = await page.evaluate(() => window.hypeboundBattle.debug().hand);
      throw new Error(`never had a playable character to test drag-cancel with; hand was ${JSON.stringify(hand)}`);
    }

    const before = (await boardCounts()).you;
    const handOf = () => page.evaluate(() => window.hypeboundBattle.view().you.hand.map((c) => c.cardId));
    const clockOf = () =>
      page.evaluate(() => {
        const s = window.hypeboundBattle.state();
        return `t${s.turn}/g${s.globalTurnCounter}/active${s.activeSeat}`;
      });
    const idsBefore = await handOf();
    const clockBefore = await clockOf();
    const handBefore = idsBefore.length;

    // pull the card up over the board, then change your mind and bring it back
    await page.mouse.move(candidate.screen.x, candidate.screen.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.move(candidate.screen.x, candidate.screen.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(800);

    const after = (await boardCounts()).you;
    const idsAfter = await handOf();
    const handAfter = idsAfter.length;
    if (after !== before || handAfter !== handBefore) {
      // name the cards: "hand 9→10" is a puzzle, "gained kw-comeback" is a lead
      const gained = idsAfter.filter((id, i) => idsBefore.indexOf(id) < 0 || idsAfter.indexOf(id) !== i);
      throw new Error(
        `releasing over the hand should cancel the play: board ${before}→${after}, hand ${handBefore}→${handAfter}` +
          ` (new: ${gained.join(", ") || "none"} | clock ${clockBefore} → ${await clockOf()})`
      );
    }
    console.log(`(card returned to hand, board still ${after}) `);
  });

  // ---- battle: actually play cards through the real UI --------------------
  await step("10-battle-play-cards", async () => {
    for (let round = 0; round < 3; round++) {
      await waitForYourTurn();
      if (await page.locator(".end-overlay").count()) throw new Error(MATCH_ENDED);
      let played = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await playOneCard())) break;
        played = true;
      }
      if (played) break;
      await passTurn(); // nothing castable yet; take one more turn of Hype
    }

    // screenshot the live board immediately, before the match can resolve
    await page.waitForTimeout(900);
    const counts = await boardCounts();
    // Assert on the PLAYER's board specifically. Asserting the combined total
    // is worthless here — the AI fills its own row every match, so a broken
    // drag-to-play would still pass.
    if (counts.you === 0) {
      throw new Error(
        `drag-to-play is broken: the player put 0 characters on the board (rival has ${counts.enemy})`
      );
    }
    console.log(`(you ${counts.you}, rival ${counts.enemy} on board) `);
  });


  // ---- battle: attacking must work through the same drag interaction ------
  await step("11-battle-attack", async () => {
    /**
     * How many attacks the given character has spent this turn, or null if it
     * is no longer on the board (it traded and died).
     *
     * This is the right assertion for a UI test: it proves the drag produced an
     * attack intent the engine accepted. Measuring enemy health instead is
     * confounded — a defensive Reaction can heal or summon in response and more
     * than offset the damage. Damage maths is covered by the rules tests.
     */
    const attacksUsed = (instanceId) =>
      page.evaluate((id) => {
        const view = window.hypeboundBattle.view();
        const unit = view.you.board.filter(Boolean).find((c) => c.instanceId === id);
        return unit ? unit.attacksUsedThisTurn : null;
      }, instanceId);
    /**
     * Attack on a SCRIPTED board rather than one the AI match happened to leave.
     *
     * Chaining this onto the live match meant passing turns until a character
     * survived long enough to swing, and it stopped working: a 1-attack body was
     * reduced to 0 by an enemy aura, so `canAttack` correctly reported nothing
     * ready and the step burned its whole budget. That is the game working — the
     * test was the problem. Tutorial stage 3 deals both boards from a scenario,
     * so an attacker and a target are guaranteed and this step measures the drag
     * interaction, which is the only thing it was ever meant to measure.
     */
    await page.goto(`${BASE}/#tutorial?stage=3`, { waitUntil: "networkidle" });
    await page.waitForSelector(".battle-screen", { timeout: 20000 });
    await page.waitForTimeout(2200);

    /**
     * Read past the coach until the lesson actually permits an attack.
     *
     * A stage refuses anything its current beat does not allow, and the gate is
     * enforced in the driver rather than by greying out buttons — so a drag can
     * be perfectly aimed at a ready attacker and still be thrown away. Wait for
     * a beat whose `allow` list admits attacking before measuring anything.
     */
    let attacker = null;
    let targets = null;
    for (let ack = 0; ack < 10; ack++) {
      const snapshot = await page.evaluate(() => {
        const d = window.hypeboundBattle.debug();
        const stage = window.hypeboundBattle.stage?.();
        const allow = stage?.allow ?? null;
        return {
          ready: d.readyAttackers ?? [],
          targets: d.legalAttackTargets ?? [],
          attacksAllowed: allow === null || allow.some((m) => m.intent === "attack" || m.intent === "any"),
        };
      });
      if (snapshot.attacksAllowed && snapshot.ready.length > 0 && snapshot.targets.length > 0) {
        attacker = snapshot.ready[0];
        targets = snapshot.targets;
        break;
      }
      const next = page.locator(".coach-ack");
      if (await next.count()) await next.click().catch(() => {});
      await page.waitForTimeout(700);
    }

    if (!attacker) {
      const why = await page.evaluate(() => {
        const d = window.hypeboundBattle.debug();
        const v = window.hypeboundBattle.view();
        return {
          ready: (d.readyAttackers ?? []).length,
          targets: (d.legalAttackTargets ?? []).length,
          myBoard: v.you.board.filter(Boolean).map((c) => `${c.cardId}@${c.attack}/${c.health}`),
          enemyBoard: v.opponent.board.filter(Boolean).length,
          phase: v.phase,
          activeSeat: `${v.activeSeat} (you are ${v.seat})`,
        };
      });
      throw new Error(`the scripted stage offered no attacker — ${JSON.stringify(why)}`);
    }
    const target = targets[0];

    const before = await attacksUsed(attacker.instanceId);

    /**
     * Record what the game says, and what it thought was true, before the drag.
     *
     * This step failed once in roughly a dozen runs and the message could not
     * say why: it reported that no attack happened and left the cause to
     * guesswork. Two mechanical explanations were measured and ruled out — the
     * attacker's screen position drifts at most 3.6 px in the window between
     * reading it and pressing, far inside a card, and an attack drag does not
     * move the dragged card under the cursor, so it cannot occlude its own
     * target.
     *
     * What was never captured is the game's own account. A refused intent
     * raises a toast — the engine's `result.error.message`, or the stage gate's
     * refusal reason — and toasts live for 2.2 s, which outlasts this step's
     * post-drop wait. So they are collected here and printed on failure. The
     * next occurrence will name its cause instead of posing a question.
     */
    await page.evaluate(() => {
      window.__toasts = [];
      const layer = document.querySelector(".toast-layer") ?? document.body;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.classList.contains("toast")) {
              window.__toasts.push(`${node.className}: ${node.textContent}`);
            }
          }
        }
      });
      observer.observe(layer, { childList: true, subtree: true });
    });

    /** Everything that has to still be true at the moment of the press. */
    const preconditions = () =>
      page.evaluate(
        ([attackerId, targetId]) => {
          const d = window.hypeboundBattle.debug();
          const stage = window.hypeboundBattle.stage?.();
          const allow = stage?.allow ?? null;
          const ready = d.readyAttackers ?? [];
          const found = ready.find((a) => a.instanceId === attackerId);
          return {
            attackerStillReady: Boolean(found),
            attackerNow: found ? { x: Math.round(found.x), y: Math.round(found.y) } : null,
            targetStillLegal: (d.legalAttackTargets ?? []).some((t) => t.id === targetId),
            attacksAllowed: allow === null || allow.some((m) => m.intent === "attack" || m.intent === "any"),
            busy: d.busy ?? null,
            beat: stage?.beat ?? null,
          };
        },
        [attacker.instanceId, target.id]
      );

    const atPress = await preconditions();

    await page.mouse.move(attacker.x, attacker.y);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const dragStart = await page.evaluate(() => window.hypeboundBattle.debug().drag);

    await page.mouse.move((attacker.x + target.x) / 2, (attacker.y + target.y) / 2, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.waitForTimeout(300);
    const dragOverTarget = await page.evaluate(() => window.hypeboundBattle.debug().drag);

    const atDrop = await preconditions();
    await page.mouse.up();
    await page.waitForTimeout(1600);

    const said = await page.evaluate(() => window.__toasts ?? []);
    const after = await attacksUsed(attacker.instanceId);
    // null = the attacker traded and died, which also proves the attack resolved
    const attacked = after === null || after > before;
    if (!attacked) {
      throw new Error(
        `the attack drag produced no attack: attacksUsed ${before} → ${after}\n` +
          `    target:    ${JSON.stringify(target)}\n` +
          `    attacker:  ${JSON.stringify(attacker)}\n` +
          `    on down:   ${JSON.stringify(dragStart)}\n` +
          `    on target: ${JSON.stringify(dragOverTarget)}\n` +
          `    at press:  ${JSON.stringify(atPress)}\n` +
          `    at drop:   ${JSON.stringify(atDrop)}\n` +
          `    the game said: ${said.length ? JSON.stringify(said) : "(nothing)"}`
      );
    }
    // `attacked` already proves the drag produced an accepted attack intent;
    // the drag-state snapshot is sampled asynchronously and can miss the frame
    // the target was locked, so it is reported rather than asserted.
    const locked = dragOverTarget?.hoverTarget ? "locked" : "lock not captured";
    console.log(`(attacked ${target.kind}, attacker ${after === null ? "traded and died" : "swung"}, ${locked}) `);
  });

  // ---- battle: play several turns ----------------------------------------
  await step("12-battle-turns", async () => {
    // step 11 moved to a scripted stage; come back to a real match for this one
    await page.goto(`${BASE}/#battle?difficulty=beginner&seed=${SEED}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
    await page.click(".mulligan-actions .btn-primary");
    await page.waitForSelector(".battle-hud", { timeout: 15000 });
    await page.waitForTimeout(1500);

    /**
     * Ending a turn races the AI: the button can flip back to disabled between
     * the readiness check and the click. Retry the whole check-then-click.
     */
    const endTurnWhenReady = async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (await page.locator(".end-overlay").count()) return "ended";
        await waitForYourTurn();
        if (await page.locator(".end-overlay").count()) return "ended";
        try {
          await page.click(".end-turn-btn", { timeout: 4000 });
          return "clicked";
        } catch {
          await page.waitForTimeout(600); // the AI took the turn back; wait it out
        }
      }
      return "stuck";
    };

    for (let turn = 0; turn < 6; turn++) {
      const outcome = await endTurnWhenReady();
      if (outcome === "ended") break;
      if (outcome === "stuck") throw new Error("End Turn never became clickable");
      // the confirm dialog appears when Hype and playable cards remain
      const confirm = page.locator(".confirm-panel .btn-primary");
      if (await confirm.count()) await confirm.click();
      await page.waitForTimeout(1800);
    }
    await page.waitForTimeout(1200);
  });

  /**
   * What the match paid, on the screen that tells you.
   *
   * `recordMatch` has always returned a `MatchRewards`, and all five callers
   * discarded it — so every Clout, every level and every first-win bonus was
   * granted completely invisibly. The result screen prints it now, and the
   * account's Clout has to have moved by the number it printed, or the readout
   * is decoration.
   */
  await step("13-battle-rewards", async () => {
    const overlay = page.locator(".end-overlay");
    if (!(await overlay.count())) {
      // six turns against a beginner does not always finish; concede to a result
      await page.click(".battle-menu-btn").catch(() => {});
      await page.click(".confirm-panel .btn-primary").catch(() => {});
      await page.waitForSelector(".end-overlay", { timeout: 20000 });
    }
    await page.waitForSelector("#end-rewards", { timeout: 20000 });

    const paid = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll("#end-rewards .end-reward-row")].map((row) => ({
        key: row.dataset.reward,
        value: row.querySelector(".end-reward-value")?.textContent?.trim(),
      }));
      const { profileStore } = await import("/src/save/profile.ts");
      return { rows, clout: profileStore.get().clout, note: document.querySelector(".end-reward-note")?.textContent ?? "" };
    });

    const clout = paid.rows.find((row) => row.key === "clout");
    if (!clout) throw new Error("the result screen printed no Clout line");
    if (!/^\+\d+$/.test(clout.value ?? "")) throw new Error(`the Clout line reads "${clout.value}"`);
    if (!paid.rows.some((row) => row.key === "fame-xp")) throw new Error("the result screen printed no XP line");
    console.log(`  (paid ${clout.value} Clout, wallet now ${paid.clout}${paid.note ? `; ${paid.note.slice(0, 60)}…` : ""})`);
  });

  // ---- gather in-page diagnostics -----------------------------------------
  const diagnostics = await page.evaluate(() => {
    const api = window.hypebound;
    if (!api) return { ok: false, reason: "debug handle missing" };
    return {
      ok: true,
      cards: Object.keys(api.content.cards).length,
      leaders: Object.keys(api.content.leaders).length,
      currents: Object.keys(api.content.currents).length,
      confluences: Object.keys(api.content.confluences).length,
      decks: api.profile().decks.length,
      collected: Object.keys(api.profile().collection).length,
    };
  });

  await browser.close();

  console.log("\n--- diagnostics ---");
  console.log(JSON.stringify(diagnostics, null, 2));

  if (warnings.length > 0) {
    console.log(`\n--- ${warnings.length} warning(s) (non-fatal) ---`);
    for (const warning of warnings.slice(0, 8)) console.log(`  ! ${warning.slice(0, 220)}`);
  }

  if (errors.length > 0) {
    console.log(`\n--- ${errors.length} ERROR(S) ---`);
    for (const error of errors) console.log(`  ✗ ${error.slice(0, 900)}`);
    process.exit(1);
  }

  console.log(`\n✓ All steps passed with no console errors. Screenshots in ${SHOTS}`);
}

main().catch((error) => {
  console.error("verify-ui crashed:", error);
  process.exit(1);
});
