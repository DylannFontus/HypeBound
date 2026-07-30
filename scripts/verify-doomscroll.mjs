/**
 * The Doomscroll, in a real browser.
 *
 * The run rules are covered by 42 unit tests; what only a browser can prove is
 * the wiring — that the map renders what the run says, that clicking a node
 * actually enters it, that the fight route deals THE RUN'S deck at THE RUN'S
 * health, that the result comes back through the battle screen's own exit path,
 * and that the summary pays the profile.
 *
 * One fight is played for real (opened, dealt, inspected, conceded, exited).
 * After that a second run is walked from top to bottom, settling fights through
 * the run's debug hook and answering every node with real clicks — because every
 * path down the map starts with a battle, so the node types worth clicking are
 * all behind one.
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

const runState = () => page.evaluate(() => window.hypeboundRun.state());

/**
 * A fixed run seed, typed into the field a player would type it into.
 *
 * Left to its random default this check walks a different map every invocation,
 * so it passed or failed by luck — which is worse than not running it, because
 * a flaky verification teaches you to re-run until it goes green. The mode
 * already promises "same seed + same choices ⇒ same map, events, shops and
 * offers"; this just holds it to that. Override with SEED= to explore others.
 */
const SEED = process.env.SEED ?? "20260727";
const startRun = async () => {
  await page.waitForSelector(".doom-leader", { timeout: 10000 });
  // the seed is read when the leader is picked, so it has to be typed first
  await page.fill("#doom-seed", SEED);
  await page.locator(".doom-leader").first().click();
  await page.waitForSelector(".doom-map", { timeout: 10000 });
  const seeded = (await runState()).seed;
  if (String(seeded) !== SEED) fail(`asked for seed ${SEED}, run started on ${seeded}`);
};

// --- start a run through the real UI -----------------------------------------
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#doomscroll", { waitUntil: "networkidle" });
await page.waitForSelector(".doom-screen", { timeout: 20000 });
// a run left over from a previous check would skip the setup panel entirely
if (await page.locator("#doom-abandon").count()) {
  await page.click("#doom-abandon");
  await page.waitForSelector("#doom-collect", { timeout: 10000 });
  await page.click("#doom-collect");
  await page.waitForTimeout(300);
}
await startRun();

const opening = await page.evaluate(() => {
  const run = window.hypeboundRun.state();
  return {
    nodes: document.querySelectorAll(".doom-node").length,
    open: document.querySelectorAll(".doom-node-open").length,
    edges: document.querySelectorAll(".doom-edge").length,
    mapNodes: run.map.floors.reduce((n, row) => n + row.length, 0),
    mapEdges: run.map.floors.reduce((n, row) => n + row.reduce((m, node) => m + node.next.length, 0), 0),
    floorZero: run.map.floors[0].length,
    health: run.health,
    deck: run.deck.length,
    reachable: window.hypeboundRun.reachable().length,
  };
});
console.log(`opened a run: ${JSON.stringify(opening)}`);
if (opening.nodes !== opening.mapNodes) fail(`drew ${opening.nodes} nodes for a map of ${opening.mapNodes}`);
if (opening.edges !== opening.mapEdges) fail(`drew ${opening.edges} edges for a map of ${opening.mapEdges}`);
if (opening.open !== opening.floorZero) fail(`${opening.open} nodes are clickable, expected the ${opening.floorZero} on floor 1`);
if (opening.reachable !== opening.floorZero) fail("the run and the map disagree about what is reachable");
await page.screenshot({ path: path.join(OUT, "doomscroll-map.png") });

/**
 * Two artifacts that reach into the battle, granted before the first fight.
 *
 * Which artifacts a run is offered is seeded, so proving that a particular one
 * reaches the board means putting it there. Both are `battlePatch` artifacts —
 * a CardPatch on the run leader carried in `MatchConfig.cardOverrides` — and
 * both have consequences visible the moment the board is dealt.
 */
await page.evaluate(() => {
  window.hypeboundRun.grantArtifact("pocket-hotspot");
  window.hypeboundRun.grantArtifact("ring-light-of-focus");
});
await page.waitForTimeout(200);
const armed = await runState();
if (armed.artifacts.length !== 2) fail(`expected 2 artifacts, got ${JSON.stringify(armed.artifacts)}`);

/**
 * Remaster ONE copy of a card the starting deck holds twice.
 *
 * The whole mechanism exists so an upgraded copy and a plain copy can sit in the
 * same deck, so the check has to be run on a duplicate — upgrading a singleton
 * would pass just as happily if the implementation patched the card id and
 * upgraded every copy.
 */
const duplicated = armed.deck.findIndex(
  (card, i) => armed.deck.some((other, j) => j !== i && other.cardId === card.cardId)
);
if (duplicated < 0) fail("the starting deck holds no duplicate, so per-copy upgrading cannot be proved here");
else {
  await page.evaluate((index) => window.hypeboundRun.upgradeCardAt(index), duplicated);
  await page.waitForTimeout(200);
  const upgradedRun = await runState();
  const target = armed.deck[duplicated].cardId;
  const marked = upgradedRun.deck.filter((card) => card.cardId === target && card.upgraded).length;
  const plain = upgradedRun.deck.filter((card) => card.cardId === target && !card.upgraded).length;
  if (marked !== 1) fail(`Remastering marked ${marked} copies of ${target}, expected exactly 1`);
  else if (plain < 1) fail(`no plain copy of ${target} survived, so the per-copy claim is untested`);
  else ok(`Remastered 1 of ${marked + plain} copies of ${target}`);
}

// --- walk onto the first fight, by clicking it -------------------------------
await page.locator(".doom-node-open").first().click();
await page.waitForSelector("#doom-fight", { timeout: 10000 });
const beforeFight = await runState();
if (beforeFight.status !== "battle") fail(`clicking a Battle node left the run in "${beforeFight.status}"`);
else ok("clicking a node entered it");

await page.click("#doom-fight");
await page.waitForSelector(".battle-screen", { timeout: 20000 });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 });

// --- the fight is dealt from the run, not from the collection ----------------
const dealt = await page.evaluate((runDeck) => {
  const view = window.hypeboundBattle.view();
  const state = window.hypeboundBattle.state();
  /**
   * The deck comes from the authoritative state, not the view.
   *
   * The view's own deck is sanitized to opaque placeholders — a seat may not
   * read its own draw order, online or off (§5.2) — so reading it here returns
   * a list of "hidden" and this check quietly compares nothing. What is being
   * asserted is a fact about how the match was DEALT, which is a question for
   * the authority; `hypeboundBattle.state()` is the omniscient handle kept for
   * exactly these single-player assertions.
   */
  const mine = [...view.you.hand, ...state.players[view.seat].deck].map((c) => c.cardId);
  const borrowed = mine.filter((id) => id === "token-borrowed-clout").length;
  // a Remastered copy is dealt under its own card id, which is legitimately not
  // the id the run deck records for it
  const owned = new Set(runDeck.flatMap((id) => [id, `${id}-remastered`]));

  /** Every Remastered card in this match, with the card it upgrades. */
  const remastered = mine
    .filter((id) => id.endsWith("-remastered"))
    .map((id) => {
      const upgraded = state.config.cardVariants?.[id] ? id : null;
      const base = state.config.cardVariants?.[id] ?? null;
      return { id: upgraded, base };
    });

  return {
    health: view.you.leaderHealth,
    maxHealth: view.you.leaderMaxHealth,
    leader: view.you.leaderCardId,
    cardCount: mine.length - borrowed,
    foreign: mine.filter((id) => id !== "token-borrowed-clout" && !owned.has(id)),
    enemyLeader: view.opponent.leaderCardId,
    enemyHealth: view.opponent.leaderHealth,
    remastered,
    variants: state.config.cardVariants ?? null,
  };
}, beforeFight.deck.map((c) => c.cardId));
console.log(`dealt: ${JSON.stringify(dealt)}`);
if (dealt.health !== beforeFight.health || dealt.maxHealth !== beforeFight.maxHealth) {
  fail(`the run's ${beforeFight.health}/${beforeFight.maxHealth} health did not reach the board (${dealt.health}/${dealt.maxHealth})`);
} else ok("run health carried onto the board");
if (dealt.cardCount !== beforeFight.deck.length) {
  fail(`dealt ${dealt.cardCount} cards from a ${beforeFight.deck.length}-card run deck`);
} else ok(`the ${dealt.cardCount}-card run deck was dealt`);
if (dealt.foreign.length > 0) fail(`cards that are not in the run deck were dealt: ${dealt.foreign.join(", ")}`);

/**
 * The Remastered copy reached the board as a genuinely better card.
 *
 * Everything before this proves the run *recorded* an upgrade. This is the only
 * check that the improvement survives into a match — and it compares the variant
 * against its own base in the same resolved card pool, so it cannot pass on a
 * variant that was cloned but never patched.
 */
if (!dealt.variants || Object.keys(dealt.variants).length === 0) {
  fail("the Remastered card never reached the match config");
} else {
  const improved = await page.evaluate(() => {
    const content = window.hypeboundBattle.content();
    const variants = window.hypeboundBattle.state().config.cardVariants ?? {};
    return Object.entries(variants).map(([variantId, baseId]) => {
      const variant = content.cards[variantId];
      const base = content.cards[baseId];
      const score = (card) => (card?.cost ?? 0) * -10 + (card?.attack ?? 0) + (card?.health ?? 0);
      return { variantId, baseId, better: score(variant) > score(base), variantOf: variant?.variantOf ?? null };
    });
  });
  for (const entry of improved) {
    if (entry.variantOf !== entry.baseId) fail(`${entry.variantId} is not marked as a variant of ${entry.baseId}`);
    else if (!entry.better) fail(`${entry.variantId} was cloned but never actually improved on ${entry.baseId}`);
    else ok(`${entry.variantId} is on the board and better than ${entry.baseId}`);
  }
}
if (dealt.leader !== beforeFight.leaderCardId) fail(`wrong leader on the board (${dealt.leader})`);
if (dealt.enemyHealth !== 30) fail(`a normal Battle should not change enemy health (got ${dealt.enemyHealth})`);
await page.screenshot({ path: path.join(OUT, "doomscroll-battle.png") });

// --- the battle artifacts changed THIS board, and only this player's side ----
const artifactEffects = await page.evaluate(() => {
  const state = window.hypeboundBattle.state();
  const view = window.hypeboundBattle.view();
  const costOf = (kind) =>
    Number(document.querySelector(`.ability-${kind} .ability-cost`)?.textContent ?? NaN);
  return {
    overrideKeys: Object.keys(state.config.cardOverrides ?? {}),
    variantKeys: Object.keys(state.config.cardVariants ?? {}),
    myLeader: view.you.leaderCardId,
    enemyLeader: view.opponent.leaderCardId,
    hype: view.you.hype,
    turnOfSeat: state.turnOfSeat[view.seat],
    fixationShown: costOf("fixation"),
    ultimateShown: costOf("ultimate"),
  };
});
console.log(`artifacts on the board: ${JSON.stringify(artifactEffects)}`);
/**
 * Every patch in this match belongs to the player.
 *
 * This used to read "your leader alone", which was true while artifacts were the
 * only thing producing patches and became wrong the moment Remastered cards
 * started producing them too. The claim worth keeping is the one it was really
 * making: nothing here may bend the opponent. So each key must be either the
 * player's own leader or one of this run's Remastered cards — and the enemy
 * leader appearing would still fail, loudly.
 */
const patchesArePlayers = artifactEffects.overrideKeys.every(
  (key) => key === artifactEffects.myLeader || (artifactEffects.variantKeys ?? []).includes(key)
);
if (!patchesArePlayers || artifactEffects.overrideKeys.includes(artifactEffects.enemyLeader)) {
  fail(`card patches must belong to the player, got ${JSON.stringify(artifactEffects.overrideKeys)}`);
} else ok("the patch is scoped to your leader card");
// Pocket Hotspot: +1 Hype on your first turn — 2 rather than the usual 1
if (artifactEffects.turnOfSeat === 1 && artifactEffects.hype !== 2) {
  fail(`Pocket Hotspot should give 2 Hype on turn 1, board shows ${artifactEffects.hype}`);
} else ok(`Pocket Hotspot: ${artifactEffects.hype} Hype on turn ${artifactEffects.turnOfSeat}`);
// Ring Light of Focus: the HUD must price the Fixation at what the engine charges
if (artifactEffects.fixationShown !== 2) {
  fail(`Ring Light of Focus should show a Fixation cost of 2, HUD shows ${artifactEffects.fixationShown}`);
} else ok("Ring Light of Focus: the ability bar prices Fixation at 2");
if (artifactEffects.ultimateShown !== 7) {
  fail(`the Ultimate was not patched and should still cost 7, HUD shows ${artifactEffects.ultimateShown}`);
}

// --- concede, and leave through the battle screen's own exit -----------------
await page.evaluate(() => window.hypeboundBattle.submit({ type: "concede", seat: 0 }));
await page.waitForSelector(".end-panel", { timeout: 20000 });
const endButtons = await page.locator(".end-actions .btn").allTextContents();
console.log(`end-sequence buttons: ${JSON.stringify(endButtons)}`);
if (endButtons.length !== 1 || !/map/i.test(endButtons[0] ?? "")) {
  fail(`a run fight should offer one way out, back to the map (got ${JSON.stringify(endButtons)})`);
}
await page.locator(".end-actions .btn").first().click();
await page.waitForSelector(".doom-screen", { timeout: 20000 });
await page.waitForTimeout(400);

const afterLoss = await runState();
console.log(`after conceding: status=${afterLoss.status} health=${afterLoss.health}`);
if (afterLoss.status !== "dead") fail(`losing a fight should end the run, got "${afterLoss.status}"`);
else ok("the fight result came back through the battle screen's exit");
await page.waitForSelector("#doom-collect", { timeout: 10000 });
await page.screenshot({ path: path.join(OUT, "doomscroll-summary.png") });
await page.click("#doom-collect");
await page.waitForTimeout(400);

// --- second run: answer every node the map deals, with real clicks -----------
await startRun();

/**
 * How much damage each simulated victory costs.
 *
 * Enough that Breaks and healing artifacts have visible work to do, low enough
 * that a run which wins every fight and takes the cheapest Notification survives
 * to the last boss. Take 7 a fight and pick every damaging option and the run
 * dies around act 2 — correctly, but then this check is a coin flip.
 */
const WOUND = 3;
const seen = new Set();

/** Total health an event option costs. */
const damageOf = (choice) =>
  choice.outcomes.reduce((sum, o) => sum + (o.kind === "damage" ? o.amount : 0), 0);

const prices = await page.evaluate(() => window.hypeboundRun.data().shop.cardPrice);
const artifactDefs = await page.evaluate(() => window.hypeboundRun.data().artifacts);
/** The published price after whatever discounts the run is carrying. */
const expectedPrice = (rarity, held) => {
  const discount = Math.min(
    90,
    held.reduce((sum, id) => {
      const effect = artifactDefs.find((a) => a.id === id)?.effect;
      return sum + (effect?.kind === "shopDiscountPercent" ? effect.amount : 0);
    }, 0)
  );
  return Math.max(0, Math.round((prices[rarity] * (100 - discount)) / 100));
};
const cardRarity = await page.evaluate(() =>
  Object.fromEntries(Object.entries(window.hypebound.content.cards).map(([id, c]) => [id, c.rarity]))
);

for (let step = 0; step < 80; step++) {
  const run = await runState();
  if (!run || run.status === "won" || run.status === "dead") break;

  const prompt = run.prompts[0];
  if (prompt) {
    seen.add(prompt.kind);
    switch (prompt.kind) {
      case "cardPick": {
        await page.waitForSelector(".doom-card-tile", { timeout: 5000 });
        await page.locator(".doom-card-tile").first().click();
        await page.waitForTimeout(200);
        const after = await runState();
        if (after.deck.length !== run.deck.length + 1) fail("picking a card did not add it to the run deck");
        break;
      }
      case "artifactPick": {
        await page.waitForSelector(".doom-artifact-tile", { timeout: 5000 });
        await page.locator(".doom-artifact-tile").first().click();
        await page.waitForTimeout(200);
        const after = await runState();
        if (after.artifacts.length !== run.artifacts.length + 1) fail("picking an artifact did not grant it");
        else ok(`took the artifact ${after.artifacts[after.artifacts.length - 1]}`);
        break;
      }
      case "treasure": {
        if (prompt.artifactId) {
          await page.locator(".doom-artifact-tile").first().click();
          await page.waitForTimeout(200);
          const after = await runState();
          if (after.artifacts.length !== run.artifacts.length + 1) fail("the Sponsor Drop artifact never arrived");
          else ok("Sponsor Drop gave an artifact");
        } else {
          await page.click("#doom-take-clout");
          await page.waitForTimeout(200);
          const after = await runState();
          if (after.clout !== run.clout + prompt.clout) fail("the Sponsor Drop Clout never arrived");
        }
        break;
      }
      case "rest": {
        await page.waitForSelector("#doom-rest-heal", { timeout: 5000 });

        /**
         * Spend the FIRST Break on a Remaster, and heal at the rest.
         *
         * Keyed on coverage rather than on health. Tying it to "only at full
         * health" read as smarter play but meant the branch fired only when the
         * walk happened to arrive undamaged — on this seed it never did, and the
         * upgrade picker went unrendered while the check still reported OK.
         */
        const canUpgrade = run.deck.some((card) => !card.upgraded);
        if (!seen.has("cardUpgrade") && canUpgrade) {
          await page.click("#doom-rest-upgrade");
          await page.waitForTimeout(200);
          if ((await runState()).prompts[0]?.kind !== "cardUpgrade") fail("the Break's Remaster option opened nothing");
          else ok("Touch Grass Break offered a Remaster instead of a heal");
          break;
        }

        const expected = Math.min(run.maxHealth, run.health + prompt.heal);
        await page.click("#doom-rest-heal");
        await page.waitForTimeout(200);
        const after = await runState();
        if (after.health !== expected) fail(`the Break healed to ${after.health}, expected ${expected}`);
        else if (run.health >= run.maxHealth) ok("Touch Grass Break at full health (no-op, as designed)");
        else ok(`Touch Grass Break healed ${run.health} -> ${after.health}`);
        break;
      }

      case "cardUpgrade": {
        await page.waitForSelector(".doom-deck-pick", { timeout: 5000 });
        const pickable = page.locator(".doom-deck-pick:not([disabled])");
        if (!(await pickable.count())) {
          await page.click("#doom-cancel-upgrade");
          await page.waitForTimeout(200);
          break;
        }
        const index = Number(await pickable.first().getAttribute("data-index"));
        const before = run.deck[index];
        await pickable.first().click();
        await page.waitForTimeout(200);
        const after = await runState();

        if (after.deck[index]?.upgraded !== true) fail("Remastering a card did not mark the copy upgraded");
        else if (after.clout !== run.clout - prompt.cost) {
          fail(`Remastering charged ${run.clout - after.clout}, expected ${prompt.cost}`);
        } else {
          /**
           * The point of the whole mechanism: only THAT copy changed. If any
           * other copy of the same card also came back upgraded, the feature is
           * patching the card id and handing out two upgrades for one price.
           */
          const siblings = after.deck.filter((card, i) => i !== index && card.cardId === before.cardId);
          if (siblings.some((card) => card.upgraded)) fail("Remastering one copy upgraded another copy too");
          else ok(`Remastered ${before.cardId}${siblings.length ? ` (${siblings.length} plain copy left alone)` : ""}`);
        }
        break;
      }
      case "event": {
        await page.waitForSelector(".doom-event-choice", { timeout: 5000 });
        if (!seen.has("event-shot")) {
          await page.screenshot({ path: path.join(OUT, "doomscroll-event.png") });
          seen.add("event-shot");
        }
        // play it like a player would: take the cheapest way out
        const options = await page.evaluate(
          (id) => window.hypeboundRun.data().events.find((e) => e.id === id).choices,
          prompt.eventId
        );
        let best = 0;
        options.forEach((option, index) => {
          if (damageOf(option) < damageOf(options[best])) best = index;
        });

        /**
         * A heal at full health legitimately changes nothing, the same way a
         * Touch Grass Break does — so taking "the cheapest way out" can pick a
         * choice that is *correctly* a no-op, and calling that a bug would be
         * blaming the game for the walker's routing.
         */
        const healOnly = options[best].outcomes.every((o) => o.kind === "heal");
        const cappedOut = healOnly && run.health >= run.maxHealth;

        await page.locator(".doom-event-choice").nth(best).click();
        await page.waitForTimeout(300);
        const after = await runState();
        const changed =
          after.clout !== run.clout ||
          after.health !== run.health ||
          after.deck.length !== run.deck.length ||
          after.artifacts.length !== run.artifacts.length ||
          after.prompts.length > 0;
        if (changed) ok(`Notification "${prompt.eventId}" resolved`);
        else if (cappedOut) ok(`Notification "${prompt.eventId}" healed at full health (no-op, as designed)`);
        else fail(`event "${prompt.eventId}" choice ${best + 1} did nothing at all`);
        break;
      }
      case "shop": {
        await page.waitForSelector(".doom-card-tile", { timeout: 5000 });
        if (!seen.has("shop-shot")) {
          await page.screenshot({ path: path.join(OUT, "doomscroll-shop.png") });
          seen.add("shop-shot");
        }
        // prices are the published table less whatever discount the run holds,
        // whether or not this run can afford them
        for (const entry of prompt.cards) {
          const expected = expectedPrice(cardRarity[entry.cardId], run.artifacts);
          if (entry.price !== expected) fail(`${entry.cardId} priced at ${entry.price}, expected ${expected}`);
        }
        if (run.artifacts.some((id) => artifactDefs.find((a) => a.id === id)?.effect.kind === "shopDiscountPercent")) {
          ok("Merch Table prices reflect the Golden Play Button");
        }
        const affordable = prompt.cards.find((e) => e.price <= run.clout && !prompt.soldCards.includes(e.cardId));
        if (affordable) {
          await page.click(`.doom-card-tile[data-card="${affordable.cardId}"]`);
          await page.waitForTimeout(250);
          const after = await runState();
          if (after.clout !== run.clout - affordable.price) {
            fail(`the shop charged ${run.clout - after.clout} for a ${affordable.price} card`);
          } else if (after.deck.length !== run.deck.length + 1) {
            fail("a bought card never reached the run deck");
          } else ok(`bought a card for ${affordable.price}, ${after.clout} Clout left`);
          seen.add("shop-purchase");
        } else {
          ok(`Merch Table prices check out; nothing affordable at ${run.clout} Clout`);
        }
        // the Merch Table's one Remaster, if this run can afford it
        const beforeUpgrade = await runState();
        if (
          !prompt.upgradeSold &&
          beforeUpgrade.clout >= prompt.upgradePrice &&
          beforeUpgrade.deck.some((card) => !card.upgraded) &&
          (await page.locator("#doom-buy-upgrade").count())
        ) {
          await page.click("#doom-buy-upgrade");
          await page.waitForTimeout(200);
          if ((await runState()).prompts[0]?.kind !== "cardUpgrade") fail("buying a Remaster opened nothing");
          else {
            ok(`Merch Table offered a Remaster for ${prompt.upgradePrice}`);
            seen.add("shop-upgrade");
          }
          break; // the picker is the head prompt now; the loop handles it next
        }

        await page.click("#doom-leave-shop");
        await page.waitForTimeout(200);
        if ((await runState()).prompts.length !== 0) fail("leaving the shop did not close it");
        break;
      }
      case "cardRemove": {
        const enabled = page.locator(".doom-deck-pick:not([disabled])");
        if (await enabled.count()) {
          await enabled.first().click();
          await page.waitForTimeout(200);
          const after = await runState();
          if (after.deck.length !== run.deck.length - 1) fail("cutting a card did not shrink the run deck");
          else ok("cut a card from the run deck");
        } else {
          await page.click("#doom-cancel-remove");
          await page.waitForTimeout(200);
        }
        break;
      }
      default:
        fail(`no handler for prompt "${prompt.kind}"`);
        await page.evaluate(() => window.hypeboundRun.choose({ kind: "skip" }));
    }
    continue;
  }

  if (run.status === "battle") {
    seen.add(`fight:${run.map.floors.flat().find((n) => n.id === run.nodeId).kind}`);
    await page.evaluate((health) => window.hypeboundRun.resolveFight(true, health), Math.max(1, run.health - WOUND));
    await page.waitForTimeout(150);
    continue;
  }

  const open = await page.locator(".doom-node-open").count();
  if (open === 0) {
    fail(`stranded on the map at ${run.nodeId ?? "the entrance"}`);
    break;
  }

  /**
   * Pick the next node: cover something new, without losing this act's Elite.
   *
   * Two failure modes to steer between, and each of them produces a walk that
   * passes while proving less than it claims.
   *
   * Take the leftmost open node every floor and the run clears three acts and
   * stops — printing "cleared the run end to end" having never seen a Signal
   * Fragment, never opened act 4 and never fought the superboss. Beeline for
   * Elites instead and the finale gets covered but the Merch Table and the
   * Notifications stop being visited at all.
   *
   * So: prefer an unseen node kind that still leaves an Elite reachable, fall
   * back to any node that does, and only once this act's fragment is banked
   * chase coverage freely. The forward search is what makes "still reachable"
   * true — taking the nearest Elite-ward node greedily can strand you a floor
   * later, on a branch whose Elite was never on it.
   */
  const target = await page.evaluate((covered) => {
    const run = window.hypeboundRun.state();
    const open = window.hypeboundRun.reachable();
    const act = window.hypeboundRun.data().acts[run.actIndex];
    const at = (id) => run.map.floors.flat().find((n) => n.id === id) ?? null;

    const isFresh = (id) => {
      const node = at(id);
      if (!node) return false;
      const key = ["battle", "elite", "boss"].includes(node.kind) ? `fight:${node.kind}` : node.kind;
      return !covered.includes(key);
    };

    const reachesElite = (id) => {
      let frontier = [at(id)].filter(Boolean);
      const seen = new Set([id]);
      while (frontier.length > 0) {
        if (frontier.some((n) => n.kind === "elite")) return true;
        const next = [];
        for (const node of frontier) {
          const row = run.map.floors[node.floor + 1] ?? [];
          for (const index of node.next) {
            const child = row[index];
            if (!child || seen.has(child.id)) continue;
            seen.add(child.id);
            next.push(child);
          }
        }
        frontier = next;
      }
      return false;
    };

    if (act && !run.fragments.includes(act.id)) {
      return open.find((id) => isFresh(id) && reachesElite(id)) ?? open.find(reachesElite) ?? open[0];
    }
    return open.find(isFresh) ?? open[0];
  }, [...seen]);

  const button = page.locator(`.doom-node-open[data-node="${target}"]`);
  if (await button.count()) await button.click();
  else await page.locator(".doom-node-open").first().click();
  await page.waitForTimeout(200);

  // the fragment track has to appear on screen, not just in the run state
  const held = (await runState()).fragments.length;
  if (held > 0 && !seen.has("fragment-ui")) {
    const lit = await page.locator(".doom-fragment-held").count();
    if (lit !== held) fail(`the sidebar shows ${lit} Signal Fragments but the run holds ${held}`);
    else ok(`Signal Fragment shown in the sidebar (${lit} lit)`);
    seen.add("fragment-ui");
  }
}

const walked = await runState();
console.log(`walked run: act ${walked?.actIndex}, ${walked?.battlesWon} wins, ${walked?.clout} run-Clout, ${walked?.artifacts.length} artifacts, deck ${walked?.deck.length}`);
console.log(`node kinds answered through the DOM: ${[...seen].sort().join(", ")}`);
await page.screenshot({ path: path.join(OUT, "doomscroll-run.png") });

if (!walked) fail("the walked run vanished");
else {
  if (walked.status !== "won") fail(`winning every fight should clear the run, got "${walked.status}"`);
  else ok(`cleared the run end to end (${walked.battlesWon} fights, ${walked.map.floors.length} floors per act)`);
  if (walked.clout <= 0) fail("a cleared run earned no run-Clout");
  /**
   * Named, not counted. `seen.size < 4` passes while quietly having stopped
   * visiting the Merch Table, which is how a routing change trades coverage for
   * coverage without anyone noticing. With a fixed seed this list is a fact
   * about this walk, so dropping one of them fails with its name.
   */
  const REQUIRED = [
    "fight:battle",
    "fight:elite",
    "fight:boss",
    "rest",
    "shop",
    "event",
    "treasure",
    "artifactPick",
    "cardPick",
    "fragment-ui",
    "cardUpgrade",
  ];
  const missing = REQUIRED.filter((kind) => !seen.has(kind));
  if (missing.length > 0) fail(`the walk never exercised: ${missing.join(", ")}`);

  /**
   * The optional finale, demanded rather than hoped for.
   *
   * A walk that wins every fight and takes every Elite must end in act 4. If it
   * does not, either the gate is wrong or the routing is — and "cleared the run"
   * on three of four acts is precisely the kind of pass that means nothing.
   */
  const acts = await page.evaluate(() => window.hypeboundRun.data().acts);
  const finaleIndex = acts.findIndex((a) => a.requiresFragments !== undefined);
  const needed = acts[finaleIndex]?.requiresFragments ?? 0;

  if (finaleIndex < 0) fail("no act is marked as the optional finale");
  else if (walked.fragments.length !== needed) {
    fail(`took every Elite but hold ${walked.fragments.length}/${needed} Signal Fragments`);
  } else if (walked.actIndex !== finaleIndex) {
    fail(`held all ${needed} fragments but finished on act ${walked.actIndex + 1}, not the finale`);
  } else {
    ok(`opened the true finale with ${needed} Signal Fragments and cleared ${acts[finaleIndex].name}`);
  }
  if (!seen.has("fight:elite")) fail("the walk never fought an Elite, so no fragment could have been earned");
  if (!seen.has("fragment-ui")) fail("a fragment was earned but never rendered in the sidebar");
}

// --- the summary pays the profile, for real this time ------------------------
await page.waitForSelector("#doom-collect", { timeout: 10000 });
const payout = await page.evaluate(() => {
  const run = window.hypeboundRun.state();
  return { before: window.hypeboundRun.profileClout(), runClout: run.clout, expected: Math.floor(run.clout / 10) };
});
await page.click("#doom-collect");
await page.waitForTimeout(400);
const paid = await page.evaluate(() => ({
  after: window.hypeboundRun.profileClout(),
  run: window.hypeboundRun.state(),
}));
console.log(`payout: ${JSON.stringify({ ...payout, after: paid.after })}`);
if (payout.expected <= 0) fail("the payout check is vacuous — the run banked nothing");
if (paid.after !== payout.before + payout.expected) {
  fail(`collected ${paid.after - payout.before} Clout, expected ${payout.expected}`);
} else ok(`${payout.runClout} run-Clout converted to ${payout.expected} account Clout`);
if (paid.run !== null) fail("collecting did not clear the finished run");

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
if (errors.length) failures += 1;
console.log(failures === 0 ? "\nThe Doomscroll OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
