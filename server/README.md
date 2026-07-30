# HYPEBOUND server

The authoritative match server: Cloudflare Workers at the edge, one Durable
Object per match. The design it implements is
[`../docs/tech/03-multiplayer-architecture.md`](../docs/tech/03-multiplayer-architecture.md);
where this code disagrees with that document, the disagreements are written down
in its §7.7 and §15 rather than left for someone to find.

## What runs where

| | |
|---|---|
| **Client** | GitHub Pages, static. Cannot hold a socket, run code, or keep a secret — which is the whole reason this package exists. |
| **Gateway** (`src/worker.ts`) | Origin check, Supabase token verification, routing. The only place a stranger's bytes are read. |
| **Room** (`src/room/room.ts`) | The match. Holds `MatchState`, applies intents, redacts per seat, runs the clock. **No Cloudflare in it at all.** |
| **Adapter** (`src/matchRoom.ts`) | The Durable Object: sockets, storage, alarms. Thin on purpose. |

The room/adapter split is the important one. Because `Room` takes the current
time as an argument and *returns* frames instead of sending them, the entire
authoritative path is tested in the ordinary vitest suite at the repo root
(`tests/room.test.ts`) with no workerd, no sockets and no wrangler. A room that
called `Date.now()` and `ws.send()` inline would be testable only by playing.

## The engine is not forked

`src/shared/engine.ts` and `src/shared/wire.ts` are the *only* files that reach
back into `../src`. Everything the server knows about the rules comes through
them, so the shared surface is a short list you can read rather than a property
of forty scattered imports.

Two things keep it honest:

- **`tsconfig.json` compiles the engine a second time with no DOM in `lib`.** If
  a rules file ever grows a `document.` or a `window.`, this package stops
  compiling. That is a better guard than any test, because it is exact.
- **`tests/server-portability.test.ts`** (at the repo root) walks the real import
  graph from `src/worker.ts` and fails if it reaches `src/ui`, `src/game`, pulls
  in a package other than zod, or contains `import.meta` anywhere. The engine
  used to discover its card files with `import.meta.glob`, which does not throw
  on workerd — it evaluates to `undefined` and deals a match from an empty card
  pool.

## Cost

Everything here is inside Cloudflare's free plan, and one line in
`wrangler.toml` is what keeps it there:

```toml
new_sqlite_classes = ["MatchRoom"]
```

SQLite-backed Durable Objects are free-plan eligible; the older key-value-backed
ones are not. The storage backend of a class is fixed by the migration that
creates it, so changing this later means a new class name and a data migration,
not a config edit.

The server also holds **no Supabase secret**. Access tokens are verified against
the project's public JWKS, so there is no service-role key to leak — and nothing
a leak of this Worker's config would let an attacker do to the database.

## Running it

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in SUPABASE_URL and ADMIN_TOKEN
npm run dev                      # wrangler dev, on http://localhost:8787
npm run typecheck                # tsc over the server AND the shared engine
```

`GET /health` answers without any configuration and reports what is missing:

```json
{ "ok": true, "protocolVersion": 1, "build": "dev", "contentHash": "…", "identityConfigured": false }
```

`identityConfigured: false` means `SUPABASE_URL` is empty, and sockets are
refused. That is deliberate — a server with no identity provider rejects players
rather than admitting anonymous ones.

## Not built yet

Phase 3 is the room. These are named here so their absence is a decision rather
than an oversight:

- **Matchmaking (§9).** `POST /match/:id/init` creates a match and is guarded by
  `ADMIN_TOKEN` until the queue exists to own it. With no token set, the route is
  closed entirely.
- **The disconnect grace window (§8.2).** A dropped socket currently does not
  forfeit; the turn clock keeps running and the AFK path ends the match. Honest,
  but not yet the two-tier window the design specifies.
- **Emotes (§7.3), spectators (§13.3), resume tokens.** The `welcome` frame mints
  a resume token that nothing yet accepts.
- **Backpressure and rate limits (§7.6).** `WIRE_LIMITS` is defined and enforced
  only for frame size.
