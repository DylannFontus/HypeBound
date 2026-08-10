/**
 * Give an account currency, from a terminal, and only from a terminal.
 *
 *     node scripts/grant.mjs --account <user-id> --clout 5000 --reason "beta tester" --dry-run
 *     node scripts/grant.mjs --account <user-id> --clout 5000 --reason "beta tester"
 *     node scripts/grant.mjs --account <user-id> --list
 *     node scripts/grant.mjs --self-test
 *
 * Operator tooling of the kind every live game has: compensation for a match
 * the server lost, a thank-you to somebody who found a bug, a refund. It is
 * deliberately not reachable from inside the game, and the guarantee is one
 * sentence: **the only route that writes another account's save requires a
 * secret that lives in the Worker's environment and the operator's gitignored
 * `.dev.vars`, is in no bundle, is not in `Access-Control-Allow-Headers`, and
 * sits behind a check that refuses any request carrying an `Origin` header at
 * all** — so a page cannot reach it by being clever, only by not being a page.
 *
 * ## Where the grant is written, and why not straight into the wallet
 *
 * Into the account's `profile` save section, at `inbox.grants`, as a *record of
 * a decision* rather than as currency. The player then claims it in the inbox
 * like any other attachment. That reuses the claim path, the `inbox.claimed`
 * ledger — which is never pruned, so an attachment pays exactly once, for ever
 * — and the reward animation, instead of inventing a second way for currency to
 * appear, which is also a second way for it to go wrong. Adding to `clout`
 * directly would arrive as a number that changed on its own, with no reason
 * attached and nothing to audit.
 *
 * It also composes with the three-way merge instead of fighting it.
 * `cloudSaves.ts` merges `clout` as a `counter` (`remote + (local - base)`) and
 * `inbox.claimed` as a `set`. A new key under `inbox` that only ever this tool
 * writes hits the merge's "only one side moved" branch and is carried through
 * intact, while the payment itself happens on the device, once, and unions
 * through the ledger. A grant written as raw `clout` would instead have to
 * survive counter arithmetic against whatever the player spent offline.
 *
 * ## Why the read-modify-write is here rather than on the server
 *
 * `server/src/saves/store.ts` opens by promising the server never parses a
 * save, and draws the conclusion: *"a compromised server can withhold or
 * corrupt a save but cannot mint currency out of one."* A server-side grant
 * composer deletes that sentence. So the Worker route is a byte proxy, and the
 * splice happens here — under the same `If-Match` and checksum discipline the
 * client uses, because it is literally the client's own `canonicalJson` and the
 * server's own `applyPut` that this file imports rather than reimplements.
 *
 * ## How it is authorised
 *
 * `ADMIN_TOKEN`, the same secret already guarding match creation. Read from
 * `HYPEBOUND_ADMIN_TOKEN`, from `--token-file`, or from `server/.dev.vars` —
 * never from a command-line flag, because a flag ends up in shell history. With
 * no token the tool refuses to run, and the route refuses to answer. There is
 * deliberately no Supabase service-role key anywhere near this: the match
 * server holds no Supabase credential at all, which is why `--account` takes a
 * user id and cannot take an email.
 *
 * ## The mistakes it is shaped to make hard
 *
 * `--dry-run` prints the exact message and writes nothing. `--reason` is
 * required and is shown to the player verbatim. A grant id already present on
 * the account is refused rather than duplicated. A stale revision is a loud
 * 409 with nothing applied, never a half-write. And `--self-test` proves all of
 * that against the real server decision function, offline, in about a second.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The three modules below are imported, not copied.
 *
 * Node 22+ strips types from `.ts` on the fly, so the tool runs the *same*
 * canonical serialiser the client hashes with, the *same* grant rules the game
 * validates with, and — in `--self-test` — the *same* function the Durable
 * Object uses to decide a write. Two copies of any of those would agree right
 * up until one of them was edited, which is the whole argument
 * `server/src/shared/saves.ts` makes for re-exporting `SAVE_SECTIONS` rather
 * than restating it.
 *
 * This is also why `src/game/inbox/grants.ts` has no imports of its own: one
 * extensionless specifier in there and Node could not load it, in a way the
 * browser build would never notice.
 */
const { canonicalJson } = await import(`file://${ROOT}/src/save/cloudSync.ts`);
const { checkGrantRecord, grantMessage, GRANT_CLOUT_CAP } = await import(`file://${ROOT}/src/game/inbox/grants.ts`);
const { applyPut, manifestOf, sha256Hex, SECTION_BYTE_CAP } = await import(`file://${ROOT}/server/src/saves/store.ts`);
const { ONLINE } = await import(`file://${ROOT}/src/config.ts`);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument "${token}" — every option is --named`);
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args.flags.add(name);
    } else {
      args.values.set(name, next);
      i++;
    }
  }
  return args;
}

const USAGE = `
Give one account Clout, delivered as a claimable inbox message.

  node scripts/grant.mjs --account <user-id> --clout <n> --reason "<why>" [--dry-run]
  node scripts/grant.mjs --account <user-id> --list
  node scripts/grant.mjs --self-test

  --account <user-id>   Supabase user id. NOT an email — see below.
  --clout <n>           whole number, 1 to ${GRANT_CLOUT_CAP}
  --reason "<why>"      required, shown to the player word for word
  --id <slug>           grant id; generated if omitted. Re-running with the
                        same id is refused, so it doubles as an idempotency key.
  --dry-run             print the exact message and change nothing
  --list                print the grants this account already holds
  --server <url>        default ${ONLINE.serverUrl}
  --token-file <path>   default server/.dev.vars
  --self-test           run the offline harness and exit

The token is never a flag. Set HYPEBOUND_ADMIN_TOKEN, or leave ADMIN_TOKEN in
server/.dev.vars, which is gitignored and must stay that way.
`.trim();

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

/**
 * Find the admin token, or say precisely what is missing.
 *
 * Environment first, file second. Never an argument: `--token abc` is one
 * `history | grep` away from being somebody else's, and a tool that offers the
 * unsafe way alongside the safe one has offered the unsafe way.
 */
function readToken(tokenFile) {
  const fromEnv = (process.env.HYPEBOUND_ADMIN_TOKEN ?? "").trim();
  if (fromEnv) return { token: fromEnv, source: "HYPEBOUND_ADMIN_TOKEN" };

  const file = tokenFile ?? path.join(ROOT, "server", ".dev.vars");
  if (!existsSync(file)) {
    return { token: null, source: null, why: `no HYPEBOUND_ADMIN_TOKEN in the environment, and ${rel(file)} does not exist` };
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*ADMIN_TOKEN\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value) return { token: value, source: rel(file) };
    return { token: null, source: null, why: `${rel(file)} has ADMIN_TOKEN, but it is empty` };
  }
  return { token: null, source: null, why: `${rel(file)} has no ADMIN_TOKEN line` };
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

// ---------------------------------------------------------------------------
// Talking to the admin route
// ---------------------------------------------------------------------------

const grantUrl = (server, account) => `${server.replace(/\/+$/, "")}/admin/saves/${account}/profile`;

/**
 * Read the account's profile section, and refuse anything it cannot trust.
 *
 * The checksum is verified here for the same reason `saveClient.pull` verifies
 * it: a truncated response is valid JSON more often than is comfortable, and a
 * grant spliced into half a save and uploaded with a fresh checksum would look
 * perfectly correct to everything downstream. Bytes that do not hash to what
 * the server says they hash to are not a save to write on top of.
 */
async function fetchSection(server, account, token) {
  let response;
  try {
    response = await fetch(grantUrl(server, account), { headers: { "X-Hypebound-Admin": token } });
  } catch (error) {
    return { ok: false, message: `could not reach ${server} — ${error.message}` };
  }

  if (response.status === 403) {
    return { ok: false, message: "the server refused the admin token (403). Check ADMIN_TOKEN matches the deployed secret." };
  }
  if (response.status === 404) {
    return {
      ok: false,
      message:
        `this account has no profile save on the server (404).\n` +
        `   Nothing can be granted into a save that does not exist yet: the section's\n` +
        `   version and revision both come from what is already there, and inventing a\n` +
        `   whole profile here would overwrite the player's first upload.\n` +
        `   Ask them to sign in once on any device, then run this again.`,
    };
  }
  if (!response.ok) return { ok: false, message: `the server answered ${response.status}` };

  const body = await response.json();
  if (typeof body.payload !== "string") return { ok: false, message: "the server returned no payload" };

  const actual = await sha256Hex(body.payload);
  if (actual !== body.checksum) {
    return { ok: false, message: `the stored save does not match its own checksum (${body.checksum} vs ${actual}) — refusing to write on top of it` };
  }

  let data;
  try {
    data = JSON.parse(body.payload);
  } catch {
    return { ok: false, message: "the stored save is not JSON" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, message: "the stored save is not an object" };
  }

  return { ok: true, data, revision: body.revision, version: body.version, bytes: body.bytes };
}

/**
 * Splice one grant into a profile payload, and touch nothing else.
 *
 * Appending rather than replacing, and spreading rather than rebuilding, so a
 * field this tool has never heard of survives being written through it. The
 * only thing invented is the `inbox` block itself on a save old enough not to
 * have one, and only in the shape `profile.ts`'s own `inboxBlock` would give it
 * the next time the player touched their mail.
 */
function withGrant(data, record) {
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const inbox = isObject(data.inbox) ? data.inbox : { read: [], claimed: [], deleted: [] };
  const grants = Array.isArray(inbox.grants) ? inbox.grants : [];
  return { ...data, inbox: { ...inbox, grants: [...grants, record] } };
}

const existingGrants = (data) =>
  data.inbox && Array.isArray(data.inbox.grants) ? data.inbox.grants : [];

// ---------------------------------------------------------------------------
// The grant itself
// ---------------------------------------------------------------------------

/** Time-ordered and collision-proof without a dependency: base-36 millis plus 24 random bits. */
const newGrantId = (now) => `${now.toString(36)}-${randomBytes(3).toString("hex")}`;

function describe(record, message) {
  const lines = [];
  lines.push("   The message the player will see");
  lines.push("   " + "-".repeat(62));
  lines.push(`   From:    System`);
  lines.push(`   Subject: ${message.subject}`);
  lines.push("");
  for (const paragraph of message.body) {
    for (const line of wrap(paragraph, 66)) lines.push(`   ${line}`);
    lines.push("");
  }
  lines.push(`   [ Attached: ${record.clout} Clout ]   ( Take it )`);
  lines.push(`   Kept until you take what is attached. It will not expire.`);
  lines.push("   " + "-".repeat(62));
  return lines.join("\n");
}

function wrap(text, width) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length + word.length + 1 > width && line) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * The whole operation, as one function, so `--self-test` drives exactly the
 * code path a real grant takes rather than a rehearsal of it.
 *
 * Returns a described outcome instead of throwing, for the reason
 * `saveClient.ts` gives: "the server said no" and "the wifi dropped" need
 * opposite responses and a shared catch block collapses them.
 */
async function runGrant({ server, account, token, record, dryRun, log }) {
  const say = log ?? (() => {});

  const current = await fetchSection(server, account, token);
  if (!current.ok) return { ok: false, message: current.message };

  const already = existingGrants(current.data).find((entry) => entry && entry.id === record.id);
  if (already) {
    return {
      ok: false,
      message:
        `this account already holds a grant with id "${record.id}" (${already.clout} Clout, "${already.reason}").\n` +
        `   Nothing was written. Re-running with the same --id is refused on purpose,\n` +
        `   so a repeated command cannot pay twice; drop --id to send a second one.`,
    };
  }

  const next = withGrant(current.data, record);
  const payload = canonicalJson(next);
  const bytes = Buffer.byteLength(payload, "utf8");
  const checksum = await sha256Hex(payload);

  say(`   account   ${account}`);
  say(`   section   profile   version ${current.version}   revision ${current.revision} -> ${current.revision + 1}`);
  say(`   size      ${current.bytes} -> ${bytes} bytes (+${bytes - current.bytes}), cap ${SECTION_BYTE_CAP}`);
  say(`   checksum  ${checksum}`);
  say(`   grants    ${existingGrants(current.data).length} -> ${existingGrants(next).length} on this account`);

  if (bytes > SECTION_BYTE_CAP) {
    return { ok: false, message: `the save would be ${bytes} bytes, over the ${SECTION_BYTE_CAP} cap. Nothing was written.` };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, revision: current.revision, payload, checksum, message: "dry run — nothing was written" };
  }

  let response;
  try {
    response = await fetch(grantUrl(server, account), {
      method: "PUT",
      headers: {
        "X-Hypebound-Admin": token,
        "content-type": "application/json",
        // The revision this grant expects to replace. Not optional and not
        // defaulted: the server refuses a blind write with a 428, and the whole
        // point of naming it is to be told when the guess was wrong.
        "If-Match": String(current.revision),
      },
      body: JSON.stringify({ version: current.version, payload, checksum }),
    });
  } catch (error) {
    return { ok: false, message: `the write could not be sent — ${error.message}. Nothing was applied.` };
  }

  if (response.status === 409) {
    return {
      ok: false,
      message:
        `the player's own device wrote first (409). NOTHING WAS APPLIED.\n` +
        `   The save moved between reading it and writing it, which is exactly what\n` +
        `   If-Match exists to catch — applying anyway would have silently thrown away\n` +
        `   whatever they just did. Run the same command again.`,
    };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, message: `the server refused the write (${response.status}) ${detail}. Nothing was applied.` };
  }

  const entry = await response.json();
  if (entry.revision !== current.revision + 1) {
    return { ok: false, message: `the server reported revision ${entry.revision}, expected ${current.revision + 1} — treat this as unresolved` };
  }
  if (entry.checksum !== checksum) {
    return { ok: false, message: `the server stored checksum ${entry.checksum}, not ${checksum} — treat this as unresolved` };
  }

  return { ok: true, revision: entry.revision, checksum, payload };
}

// ---------------------------------------------------------------------------
// The offline harness — the control for everything above
// ---------------------------------------------------------------------------

/**
 * A local stand-in for the admin route that runs the **real** `applyPut`.
 *
 * The point of using the server's own decision function rather than a mock is
 * that a mock proves the tool agrees with the mock. This proves the tool agrees
 * with the code that will actually refuse it — including the 428 for a missing
 * `If-Match`, the 400 for a checksum that does not match the bytes, and the 409
 * that this tool's whole failure story depends on.
 *
 * `bumpBeforeNextPut` is how the harness plays the player: it advances the
 * stored revision after the tool has read it and before it writes, which is the
 * race no amount of care in the tool can prevent and only `If-Match` can catch.
 */
function startHarness(token) {
  const store = { section: null };
  const seen = [];
  let bumpBeforeNextPut = false;

  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const send = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };

    if (!/^\/admin\/saves\/[A-Za-z0-9_-]{8,64}\/profile$/.test(req.url ?? "")) return send(404, { error: "not found" });
    if (req.headers["origin"]) return send(403, { error: "forbidden" });
    if (req.headers["x-hypebound-admin"] !== token) return send(403, { error: "forbidden" });

    if (req.method === "GET") {
      if (!store.section) return send(404, { error: "no save for this section" });
      return send(200, { ...manifestOf("profile", store.section), payload: store.section.payload });
    }
    if (req.method !== "PUT") return send(405, { error: "method not allowed" });

    if (bumpBeforeNextPut) {
      bumpBeforeNextPut = false;
      store.section = { ...store.section, revision: store.section.revision + 1 };
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const header = req.headers["if-match"];
    const ifMatch = header === undefined ? null : Number.parseInt(header, 10);

    const outcome = applyPut(
      store.section,
      { version: body.version, payload: body.payload, claimedChecksum: body.checksum, ifMatch },
      await sha256Hex(body.payload),
      Date.now()
    );
    if (outcome.status === 200) {
      store.section = outcome.entry;
      return send(200, manifestOf("profile", outcome.entry));
    }
    if (outcome.status === 409) return send(409, { error: "another device wrote first" });
    return send(outcome.status, { error: outcome.reason ?? "refused" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        store,
        seen,
        raceNextPut: () => {
          bumpBeforeNextPut = true;
        },
        async seed(data, version) {
          const payload = canonicalJson(data);
          store.section = {
            version,
            revision: 1,
            updatedAt: new Date().toISOString(),
            checksum: await sha256Hex(payload),
            bytes: Buffer.byteLength(payload, "utf8"),
            payload,
          };
        },
        /**
         * `closeAllConnections` first, and it is not tidiness.
         *
         * `fetch` keeps its sockets alive, so `close()` alone waits for a
         * keep-alive that nothing will ever use again — and exiting out from
         * under it trips a libuv assertion on Windows that looks exactly like a
         * failure in the thing being tested.
         */
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(done);
          }),
      });
    });
  });
}

async function selfTest() {
  const token = "self-test-token";
  const account = "00000000-0000-4000-8000-000000000001";
  const harness = await startHarness(token);
  let failures = 0;
  const ok = (m) => console.log(`   ok: ${m}`);
  const fail = (m) => {
    console.log(`   FAIL: ${m}`);
    failures += 1;
  };

  const baseSave = {
    clout: 1200,
    createdAt: 1_700_000_000_000,
    decks: [{ name: "Neon", cards: ["a", "b"] }],
    inbox: { read: ["welcome"], claimed: [], deleted: [] },
  };
  await harness.seed(baseSave, 1);
  const seededPayload = harness.store.section.payload;

  const record = { id: "selftest-1", clout: 5000, reason: "beta tester", issuedAt: Date.now() };

  console.log("\n1. The control: is the harness actually enforcing anything?");
  {
    // A mock that accepts everything would make every assertion below vacuous,
    // so the first two measurements are of the harness refusing.
    const payload = canonicalJson(baseSave);
    const blind = await fetch(grantUrl(harness.url, account), {
      method: "PUT",
      headers: { "X-Hypebound-Admin": token, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, payload, checksum: await sha256Hex(payload) }),
    });
    if (blind.status !== 428) fail(`a write with no If-Match returned ${blind.status}, expected 428`);
    else ok("a write with no If-Match is refused 428 — the concurrency check is live");

    const lying = await fetch(grantUrl(harness.url, account), {
      method: "PUT",
      headers: { "X-Hypebound-Admin": token, "content-type": "application/json", "If-Match": "1" },
      body: JSON.stringify({ version: 1, payload, checksum: "0".repeat(64) }),
    });
    if (lying.status !== 400) fail(`a wrong checksum returned ${lying.status}, expected 400`);
    else ok("a payload that does not match its checksum is refused 400 — the integrity check is live");

    const noToken = await fetch(grantUrl(harness.url, account), { headers: { "X-Hypebound-Admin": "wrong" } });
    if (noToken.status !== 403) fail(`a wrong token returned ${noToken.status}, expected 403`);
    else ok("a wrong admin token is refused 403");

    const browser = await fetch(grantUrl(harness.url, account), {
      headers: { "X-Hypebound-Admin": token, Origin: "https://dylannfontus.github.io" },
    });
    if (browser.status !== 403) fail(`a request carrying an Origin returned ${browser.status}, expected 403`);
    else ok("a request carrying an Origin is refused 403 even with the right token");

    if (harness.store.section.revision !== 1) fail(`four refusals moved the revision to ${harness.store.section.revision}`);
    else ok("and none of the four refusals changed the stored save");
  }

  console.log("\n2. --dry-run changes nothing");
  {
    const before = harness.store.section.revision;
    const result = await runGrant({ server: harness.url, account, token, record, dryRun: true });
    if (!result.ok) fail(`the dry run reported "${result.message}"`);
    else if (harness.store.section.revision !== before) fail(`the dry run moved the revision ${before} -> ${harness.store.section.revision}`);
    else if (harness.store.section.payload !== seededPayload) fail("the dry run changed the stored bytes");
    else ok(`revision stayed at ${before} and the stored bytes are byte-identical`);
  }

  console.log("\n3. A real grant writes once, and disturbs nothing else");
  {
    const result = await runGrant({ server: harness.url, account, token, record, dryRun: false });
    if (!result.ok) fail(`the grant reported "${result.message}"`);
    else {
      if (harness.store.section.revision !== 2) fail(`revision is ${harness.store.section.revision}, expected exactly 2`);
      else ok("revision moved 1 -> 2, exactly one write");

      const stored = JSON.parse(harness.store.section.payload);
      const grants = stored.inbox.grants ?? [];
      if (grants.length !== 1 || grants[0].id !== record.id) fail(`the stored save holds ${grants.length} grants`);
      else ok(`the grant is on the account once, worth ${grants[0].clout} Clout, reason "${grants[0].reason}"`);

      if (stored.clout !== baseSave.clout) fail(`clout moved ${baseSave.clout} -> ${stored.clout} — a grant must not pay itself`);
      else ok(`clout is untouched at ${stored.clout} — nothing is paid until the player claims it`);

      const { inbox: _a, ...restStored } = stored;
      const { inbox: _b, ...restBase } = baseSave;
      if (canonicalJson(restStored) !== canonicalJson(restBase)) fail("something outside inbox changed");
      else ok("every other field in the save is byte-identical");

      const { grants: _g, ...inboxRest } = stored.inbox;
      if (canonicalJson(inboxRest) !== canonicalJson(baseSave.inbox)) fail("the read/claimed/deleted ledgers changed");
      else ok("read, claimed and deleted are byte-identical");
    }
  }

  console.log("\n4. The same id is refused rather than paid twice");
  {
    const before = harness.store.section.revision;
    const result = await runGrant({ server: harness.url, account, token, record, dryRun: false });
    if (result.ok) fail("a repeated --id wrote a second grant");
    else if (harness.store.section.revision !== before) fail("the refusal still moved the revision");
    else ok(`refused, revision still ${before} — "${result.message.split("\n")[0]}"`);
  }

  console.log("\n5. A player writing first is a loud 409, not a half-write");
  {
    harness.raceNextPut();
    const second = { ...record, id: "selftest-2" };
    const result = await runGrant({ server: harness.url, account, token, record: second, dryRun: false });
    const stored = JSON.parse(harness.store.section.payload);
    if (result.ok) fail("the grant overwrote a save that had moved underneath it");
    else if (!/409/.test(result.message)) fail(`refused, but not with a 409: ${result.message}`);
    else if ((stored.inbox.grants ?? []).length !== 1) fail("the racing write landed anyway");
    else ok("refused 409, and the account still holds exactly the one earlier grant");
  }

  console.log("\n6. The derived message, from the module the game reads");
  {
    const message = grantMessage(record);
    if (message.id !== `grant:${record.id}`) fail(`message id is ${message.id}`);
    else ok(`message id is ${message.id}`);
    if (message.attachment.length !== 1 || message.attachment[0].amount !== record.clout) fail("the attachment does not carry the granted amount");
    else ok(`the attachment carries ${message.attachment[0].amount} Clout`);
    if (!message.body.some((p) => p.includes(record.reason))) fail("the reason is not in the message body");
    else ok(`the reason "${record.reason}" is quoted in the body`);
    const thin = message.body.filter((p) => p.trim().length < 20);
    if (thin.length > 0 || !message.subject.trim()) fail("the message has an empty subject or a thin paragraph");
    else ok(`subject "${message.subject}" and ${message.body.length} real paragraphs`);
  }

  console.log("\n7. The validation refuses what it should");
  {
    const now = Date.now();
    const cases = [
      ["an empty reason", { ...record, reason: "" }],
      ["zero Clout", { ...record, clout: 0 }],
      ["a fractional amount", { ...record, clout: 1.5 }],
      ["more than the cap", { ...record, clout: GRANT_CLOUT_CAP + 1 }],
      ["an id with a colon", { ...record, id: "bad:id" }],
      ["a reason that reads like a template hole", { ...record, reason: "sorry about the {thing}" }],
    ];
    for (const [label, bad] of cases) {
      if (checkGrantRecord(bad, now).length === 0) fail(`${label} was accepted`);
    }
    if (checkGrantRecord(record, now).length !== 0) fail("a valid record was rejected");
    else ok(`all ${cases.length} malformed records refused, and a valid one accepted`);
  }

  /**
   * Everything above drives `runGrant` directly, which leaves the actual
   * command line untested — the argument parsing, the token lookup, what gets
   * printed and, most of all, the exit code. A tool whose refusals are
   * invisible to `&&` is a tool that will one day be scripted into paying twice,
   * so the last step runs the real binary as a subprocess and reads its status.
   */
  console.log("\n8. The command line itself, as a subprocess");
  {
    /**
     * `spawn`, never `spawnSync`.
     *
     * The harness is an HTTP server in *this* process, and `spawnSync` blocks
     * this process's event loop until the child exits — so the child's first
     * request would go unanswered by a server that cannot run, and both sides
     * would wait for each other for ever. It deadlocks rather than failing, so
     * it does not look like a bug in the test, it looks like a hang in the tool.
     */
    const run = (argv, env) =>
      new Promise((done) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
          env: { ...process.env, ...env },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (status) => done({ status, stdout, stderr }));
      });

    const cli = (extra) =>
      run(["--server", harness.url, "--account", account, ...extra], { HYPEBOUND_ADMIN_TOKEN: token });

    const before = harness.store.section.revision;
    const dry = await cli(["--clout", "750", "--reason", "a refund for a lost match", "--id", "cli-1", "--dry-run"]);
    if (dry.status !== 0) fail(`the dry run exited ${dry.status}: ${dry.stdout}${dry.stderr}`);
    else if (harness.store.section.revision !== before) fail("the dry run moved the revision");
    else {
      // Whitespace-normalised, because the plan is word-wrapped for a terminal:
      // the reason lands across a line break more often than not, and a literal
      // `includes` would report a missing sentence that is plainly on screen.
      const printed = dry.stdout.replace(/\s+/g, " ");
      if (!printed.includes("A grant of 750 Clout") || !printed.includes("a refund for a lost match")) {
        fail(`the dry run did not print the message the player will see:\n${dry.stdout}`);
      } else ok(`--dry-run exited 0, printed the message and left the revision at ${before}`);
    }

    const real = await cli(["--clout", "750", "--reason", "a refund for a lost match", "--id", "cli-1"]);
    const stored = JSON.parse(harness.store.section.payload);
    if (real.status !== 0) fail(`the real run exited ${real.status}: ${real.stdout}${real.stderr}`);
    else if (harness.store.section.revision !== before + 1) fail(`revision is ${harness.store.section.revision}, expected ${before + 1}`);
    else if (!(stored.inbox.grants ?? []).some((g) => g.id === "cli-1")) fail("the CLI run did not land the grant");
    else ok(`the real run exited 0 and moved the revision ${before} -> ${before + 1}`);

    const again = await cli(["--clout", "750", "--reason", "a refund for a lost match", "--id", "cli-1"]);
    if (again.status === 0) fail("re-running the same command exited 0");
    else if (harness.store.section.revision !== before + 1) fail("the repeat still moved the revision");
    else ok(`re-running the identical command exits ${again.status} and writes nothing`);

    const requestsBefore = harness.seen.length;
    const noToken = await run(
      ["--server", harness.url, "--account", account, "--clout", "10", "--reason", "no token here",
       "--token-file", `${ROOT}/does-not-exist`],
      { HYPEBOUND_ADMIN_TOKEN: "" }
    );
    if (noToken.status === 0) fail("the tool ran without a token");
    else if (harness.seen.length !== requestsBefore) fail("the tool reached the network before finding it had no token");
    else ok(`with no token it exits ${noToken.status} before making any request`);
  }

  await harness.close();
  console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
  return failures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Every exit is `process.exitCode` and a `return`, never `process.exit()`.
 *
 * `process.exit()` tears the loop down while handles are still closing, and on
 * Windows that aborts the process with a libuv assertion **after** printing
 * PASS — an exit code of 127 on a run where every assertion succeeded. A test
 * harness that reports failure for a run that passed is an instrument lying in
 * the most expensive direction, so the shutdown is left to Node.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has("help") || process.argv.length === 2) {
    console.log(USAGE);
    return 0;
  }

  if (args.flags.has("self-test")) {
    return (await selfTest()) === 0 ? 0 : 1;
  }

  const problems = [];
  const account = args.values.get("account") ?? "";
  const server = args.values.get("server") ?? ONLINE.serverUrl;
  const dryRun = args.flags.has("dry-run");
  const listOnly = args.flags.has("list");

  if (!account) {
    problems.push("--account is required");
  } else if (account.includes("@")) {
    /**
     * The refusal is the architecture, not a missing feature.
     *
     * Resolving an email to a user id needs Supabase's admin API, which needs
     * the service-role key. `wrangler.toml`, `.dev.vars.example` and the privacy
     * page all state that this server holds no Supabase credential of any kind,
     * and that property is worth more than saving the operator a paste.
     */
    problems.push(
      `--account takes a Supabase user id, not an email.\n` +
        `   Resolving "${account}" would need a service-role key, and this game's server\n` +
        `   deliberately holds no Supabase credential — it reads a user id out of a signed\n` +
        `   token and stores only that, which is what the privacy page promises.\n` +
        `   The id is in Supabase Studio under Authentication > Users.`
    );
  } else if (!/^[A-Za-z0-9_-]{8,64}$/.test(account)) {
    problems.push(`--account "${account}" is not a user id (8-64 characters of letters, digits, hyphens and underscores)`);
  }

  const rawClout = args.values.get("clout");
  let clout = NaN;
  if (!listOnly) {
    if (rawClout === undefined) problems.push("--clout is required");
    else if (!/^\d+$/.test(rawClout)) problems.push(`--clout must be a whole number of Clout, with no separators (got "${rawClout}")`);
    else clout = Number(rawClout);
  }

  const reason = (args.values.get("reason") ?? "").trim();
  if (!listOnly && !reason) {
    problems.push('--reason is required, and is shown to the player word for word (e.g. --reason "beta tester")');
  }

  const record = { id: args.values.get("id") ?? newGrantId(Date.now()), clout, reason, issuedAt: Date.now() };
  if (!listOnly && problems.length === 0) problems.push(...checkGrantRecord(record, record.issuedAt));

  if (problems.length > 0) {
    console.log("\nRefusing to run:\n");
    for (const problem of problems) console.log(` - ${problem}`);
    console.log(`\n${USAGE}\n`);
    return 1;
  }

  const { token, source, why } = readToken(args.values.get("token-file"));
  if (!token) {
    console.log(
      `\nRefusing to run: no admin token.\n\n` +
        ` - ${why}\n\n` +
        `   This route is guarded by the same ADMIN_TOKEN that guards match creation.\n` +
        `   Set it in the environment:   HYPEBOUND_ADMIN_TOKEN=...\n` +
        `   or leave it in server/.dev.vars, which is gitignored and must stay that way.\n` +
        `   Generate one with: openssl rand -base64 32\n\n` +
        `   Do not pass it as a flag. A flag is one 'history | grep' from being public.\n`
    );
    return 1;
  }

  if (listOnly) {
    const current = await fetchSection(server, account, token);
    if (!current.ok) {
      console.log(`\n${current.message}\n`);
      return 1;
    }
    const grants = existingGrants(current.data);
    const claimed = new Set(current.data.inbox?.claimed ?? []);
    console.log(`\n${account} — profile revision ${current.revision}, ${grants.length} grant(s)\n`);
    for (const entry of grants) {
      const taken = claimed.has(`grant:${entry.id}`) ? "taken" : "waiting";
      console.log(
        `   ${entry.id}   ${String(entry.clout).padStart(8)} Clout   ${taken.padEnd(8)}  ` +
          `${new Date(entry.issuedAt).toISOString()}  ${entry.reason}`
      );
    }
    console.log("");
    return 0;
  }

  console.log(`\n${dryRun ? "DRY RUN — nothing will be written" : "Granting"}\n`);
  console.log(describe(record, grantMessage(record)));
  console.log("");
  console.log(`   grant id  ${record.id}`);
  console.log(`   token     from ${source}`);
  console.log(`   server    ${server}`);

  const result = await runGrant({ server, account, token, record, dryRun, log: (line) => console.log(line) });

  if (!result.ok) {
    console.log(`\nFAILED: ${result.message}\n`);
    return 1;
  }

  if (result.dryRun) {
    console.log(`\nDry run complete. Nothing was written. Re-run without --dry-run to send it.\n`);
    return 0;
  }

  console.log(
    `\nSent. The account's profile section is now revision ${result.revision}.\n` +
      `   It reaches the player the next time their device syncs; the Clout is not in\n` +
      `   their balance until they open the inbox and take it.\n`
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.log(`\nRefusing to run: ${error.message}\n\n${USAGE}\n`);
  process.exitCode = 1;
}
