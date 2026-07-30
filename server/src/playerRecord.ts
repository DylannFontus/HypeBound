/**
 * One Durable Object per account, holding that account's match results.
 *
 * Addressed by `idFromName(userId)`, so the userId out of a verified token is
 * the whole of the routing. Thin, like every other adapter here: storage and an
 * HTTP surface, with the arithmetic in `player/record.ts`.
 *
 * Only two things can reach it, and both are inside the trust boundary: a
 * `MatchRoom` writing a result it adjudicated, and the gateway answering a
 * player asking about themselves. Neither route lets one account write — or
 * read — another's.
 */

import { DurableObject } from "cloudflare:workers";
import { EMPTY_RECORD, apply, publicView, type MatchResult, type PlayerRecordData } from "./player/record";
import type { Env } from "./env";

const STORAGE_RECORD = "record";

export class PlayerRecord extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stored = (await this.ctx.storage.get<PlayerRecordData>(STORAGE_RECORD)) ?? EMPTY_RECORD;

    if (request.method === "POST" && url.pathname.endsWith("/result")) {
      const result = (await request.json()) as MatchResult;
      const next = apply(stored, result);
      /**
       * Written even when nothing changed, so the caller cannot tell a
       * duplicate from a first write by timing. It is one small write to a
       * SQLite-backed object; the alternative is a branch whose only purpose is
       * to make retries observable.
       */
      await this.ctx.storage.put(STORAGE_RECORD, next);
      return Response.json({ ok: true, played: next.played });
    }

    if (request.method === "DELETE") {
      /**
       * Erase everything this game's server holds about the account.
       *
       * `deleteAll()` rather than writing `EMPTY_RECORD`: a zeroed row is still
       * a row, and "we kept a record of you with the numbers set to nought" is
       * not what a deletion request means.
       *
       * It does **not** delete the login itself, which lives at Supabase and
       * needs an admin credential this server deliberately does not hold. The
       * caller is responsible for saying so rather than implying otherwise —
       * see the privacy screen.
       */
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true, deleted: stored.played });
    }

    return Response.json(publicView(stored));
  }
}
