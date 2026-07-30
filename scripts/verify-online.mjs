/**
 * Two browsers, two accounts, one real match against the deployed server.
 *
 * Everything else in this suite tests a layer. This tests the whole thing: two
 * separate browser contexts sign up on the real Supabase project, queue on the
 * real Cloudflare Worker, get paired by the real matchmaker, and play a real
 * match in a real Durable Object. Nothing here is stubbed, and that is the
 * point — every layer had passing tests while the stack had never once been run
 * end to end.
 *
 * It is deliberately NOT part of `npm test`. It creates accounts and costs
 * network round trips against a live service, which is not something a unit
 * suite should do on every commit. Run it by hand:
 *
 *     node scripts/verify-online.mjs
 *
 * It needs a dev server on :5173, because that origin is in the Worker's
 * `ALLOWED_ORIGINS`.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
/** A distinct pair per run, so a re-run is not blocked by "already registered". */
const STAMP = process.env.HYPEBOUND_E2E_STAMP ?? String(Math.floor(Math.random() * 1e9));
const ACCOUNTS = [
  { email: `hypebound-e2e-a-${STAMP}@example.com`, password: "e2e-password-one" },
  { email: `hypebound-e2e-b-${STAMP}@example.com`, password: "e2e-password-two" },
];

let failures = 0;
const ok = (m) => console.log(`   ok: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`   FAIL: ${m}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

/** One player: their own context, so their own localStorage and their own session. */
async function makePlayer(label, account) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${label}: ${m.text().slice(0, 400)}`));
  page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message.slice(0, 160)}`));
  return { label, account, context, page, errors };
}

async function onboard({ page }) {
  await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
  await page.waitForSelector(".starter-screen", { timeout: 20000 });
  await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });
}

async function signUp({ page, account }) {
  await page.goto(`${ORIGIN}/#signin`, { waitUntil: "networkidle" });
  await page.waitForSelector(".signin-screen", { timeout: 20000 });
  await page.click("#signin-toggle"); // switch to "create account"
  await page.fill("#signin-email", account.email);
  await page.fill("#signin-password", account.password);
  await page.click("#signin-submit");

  // Either we land on the queue, or the status line says why not.
  const landed = await Promise.race([
    page.waitForSelector(".queue-screen", { timeout: 25000 }).then(() => "queue"),
    page
      .waitForFunction(() => (document.querySelector("#signin-status")?.textContent ?? "").length > 0 &&
        !/Creating your account/.test(document.querySelector("#signin-status")?.textContent ?? ""), { timeout: 25000 })
      .then(() => "status"),
  ]).catch(() => "timeout");

  if (landed !== "queue") {
    const message = await page.locator("#signin-status").innerText().catch(() => "(no status)");
    throw new Error(`sign-up did not reach the queue: ${message}`);
  }
}

console.log(`\nHYPEBOUND online end-to-end — run ${STAMP}`);
console.log("Two accounts will be created on the live Supabase project.\n");

const [a, b] = await Promise.all([makePlayer("A", ACCOUNTS[0]), makePlayer("B", ACCOUNTS[1])]);

try {
  console.log("1. Two fresh browsers, onboarded");
  await Promise.all([onboard(a), onboard(b)]);
  ok("both have a starter deck");

  console.log("\n2. Both create an account and land in the queue");
  await signUp(a);
  ok(`A signed up as ${a.account.email}`);
  await signUp(b);
  ok(`B signed up as ${b.account.email}`);

  console.log("\n3. The queue tells the truth while waiting");
  const detail = await a.page.locator("#queue-detail").innerText().catch(() => "");
  console.log(`   A's queue line: "${detail.trim()}"`);
  if (/player/i.test(detail)) ok("it names a real count rather than spinning");
  else fail(`queue detail read "${detail.trim()}"`);

  console.log("\n4. The server pairs them");
  await Promise.all([
    a.page.waitForSelector(".battle-board-host", { timeout: 40000 }),
    b.page.waitForSelector(".battle-board-host", { timeout: 40000 }),
  ]);
  ok("both reached a battle board");

  const hashes = await Promise.all([a.page.evaluate(() => location.hash), b.page.evaluate(() => location.hash)]);
  const matchIds = hashes.map((h) => new URLSearchParams(h.split("?")[1] ?? "").get("match"));
  if (matchIds[0] && matchIds[0] === matchIds[1]) ok(`same room: ${matchIds[0]}`);
  else fail(`different rooms: ${matchIds.join(" vs ")}`);

  console.log("\n5. Each sees their own seat, and only their own cards");
  await a.page.waitForTimeout(1500);
  const views = await Promise.all(
    [a, b].map((p) => p.page.evaluate(() => window.hypeboundBattle?.view() ?? null))
  );
  if (!views[0] || !views[1]) {
    fail("a debug handle was missing, so the views could not be compared");
  } else {
    if (views[0].seat !== views[1].seat) ok(`seats differ: ${views[0].seat} and ${views[1].seat}`);
    else fail(`both clients think they are seat ${views[0].seat}`);

    const hidden = views.every((v) => v.you.deck.every((c) => c.cardId === "hidden"));
    if (hidden) ok("neither client can read its own deck order");
    else fail("a client can see its own deck");

    const aHand = views[0].you.hand.map((c) => c.cardId).sort().join(",");
    const bHand = views[1].you.hand.map((c) => c.cardId).sort().join(",");
    if (aHand && bHand && aHand !== bHand) ok("the two hands are different cards");
    else fail(`hands looked identical or empty (${aHand} / ${bHand})`);

    // The whole point of redaction: neither view contains the other's hand.
    if (typeof views[0].opponent.handCount === "number" && views[0].opponent.hand === undefined) {
      ok(`the opponent is a count (${views[0].opponent.handCount}), not a hand`);
    } else {
      fail("the opponent's hand is present in the view");
    }
  }

  console.log("\n6. A real intent, applied by the server and seen by both");
  const beforeB = await b.page.evaluate(() => window.hypeboundBattle?.view()?.turn ?? -1);
  const conceded = await a.page.evaluate(async () => {
    const handle = window.hypeboundBattle;
    if (!handle?.submit) return "no submit on the handle";
    const result = await handle.submit({ type: "concede", seat: handle.view().seat });
    return result?.ok === false ? `refused: ${result.error?.code}` : "ok";
  });
  if (conceded === "ok") ok("A conceded through the real socket");
  else fail(`concede: ${conceded}`);

  await Promise.all([
    a.page.waitForSelector(".end-overlay", { timeout: 20000 }).catch(() => {}),
    b.page.waitForSelector(".end-overlay", { timeout: 20000 }).catch(() => {}),
  ]);
  const overlays = await Promise.all([a, b].map((p) => p.page.locator(".end-overlay").count()));
  if (overlays[0] > 0 && overlays[1] > 0) ok("both players saw the match end");
  else fail(`end overlays: A=${overlays[0]} B=${overlays[1]}`);

  const outcomes = await Promise.all(
    [a, b].map((p) => p.page.locator(".end-title").innerText().catch(() => "(none)"))
  );
  console.log(`   A saw "${outcomes[0]}", B saw "${outcomes[1]}"`);
  if (outcomes[0] !== outcomes[1]) ok("and they disagree about who won, which is correct");
  else fail(`both saw "${outcomes[0]}" — a concede has a winner and a loser`);
  void beforeB;

  console.log("\n7. The server recorded the result, for both accounts");
  /**
   * Read from the page, so the request carries the real session and goes
   * through the real CORS path. Reading it from node with a hand-made token
   * would test a route nobody uses.
   */
  const records = await Promise.all(
    [a, b].map(({ page }) =>
      page.evaluate(async () => {
        const { accessToken } = await import("/src/auth/account.ts");
        const { ONLINE } = await import("/src/config.ts");
        const token = await accessToken();
        const response = await fetch(`${ONLINE.serverUrl}/me/record`, {
          headers: { authorization: `Bearer ${token}` },
        });
        return { status: response.status, body: await response.json() };
      })
    )
  );

  for (const [i, { status, body }] of records.entries()) {
    const who = i === 0 ? "A" : "B";
    if (status !== 200) {
      fail(`${who}: /me/record answered ${status}`);
      continue;
    }
    if (body.played === 1) ok(`${who}: played 1`);
    else fail(`${who}: played ${body.played}, expected 1`);
    const expected = i === 0 ? "lost" : "won";
    if (body[expected] === 1) ok(`${who}: ${expected} 1`);
    else fail(`${who}: ${expected} is ${body[expected]}`);
    if (body.recent?.[0]?.reason === "concede") ok(`${who}: reason recorded as concede`);
    else fail(`${who}: reason was ${body.recent?.[0]?.reason}`);
  }
  if (records[0]?.body?.winRate === 0 && records[1]?.body?.winRate === 100) {
    ok("win rates are 0% and 100%, from one match");
  } else {
    fail(`win rates: ${records[0]?.body?.winRate} and ${records[1]?.body?.winRate}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  const errors = [...a.errors, ...b.errors];
  if (errors.length) {
    console.log(`\n   console errors:\n     ${errors.slice(0, 6).join("\n     ")}`);
    failures++;
  }
  await browser.close();
}

console.log(
  failures === 0
    ? `\nPASS — a real match, end to end.\nDelete the two test accounts from the Supabase dashboard when you are done.`
    : `\nFAIL — ${failures} problem(s)`
);
process.exit(failures === 0 ? 0 : 1);
