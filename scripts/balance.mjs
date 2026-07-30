/**
 * Runs the balance harness.
 *
 * A wrapper rather than an inline env assignment in package.json, because
 * `BALANCE=1 vitest` is bash syntax and npm scripts run through cmd on Windows.
 *
 *   npm run balance                       one match per ordered pair, casual AI
 *   npm run balance -- --rounds 3         three matches per ordered pair
 *   npm run balance -- --ai expert        a stronger opponent on both sides
 *   npm run balance -- --only mirror      just the deck-builder comparison
 *   npm run balance -- --only roundrobin  just the win-rate table
 *   npm run balance -- --only tour        can a loaner deck win its tour match?
 *
 * `--only` matters more than it looks: the round robin is 380 matches per round
 * and the mirror is 40, so asking a question about deck building at expert
 * difficulty costs half an hour if you run both and half a minute if you do not.
 *
 * Runtime, measured: casual plays ~11 matches a second. Expert is roughly two
 * orders of magnitude slower — 240 mirror matches did not finish in 25 minutes —
 * because its lookahead re-simulates whole intent sequences per decision. Use
 * casual for anything you want an answer to today, and treat an expert run as
 * something you start and come back to.
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const result = spawnSync("npx", ["vitest", "run", "tests/balance.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    BALANCE: "1",
    BALANCE_ROUNDS: flag("rounds", "1"),
    BALANCE_AI: flag("ai", "casual"),
    BALANCE_ONLY: flag("only", "all"),
  },
});

process.exit(result.status ?? 1);
