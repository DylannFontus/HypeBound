/**
 * One Durable Object per account, holding that account's save.
 *
 * Addressed by `idFromName(userId)` exactly like `PlayerRecord`, so the user id
 * out of a verified token is the whole of the routing and there is no request
 * shape that names somebody else's save. Thin: storage and an HTTP surface,
 * with every rule in `saves/store.ts`.
 *
 * ## Why an object per account rather than a table
 *
 * A save is read and written by one person, and a Durable Object is a
 * serialisation point. That means the read-modify-write behind `If-Match` is
 * atomic for free — two devices pushing at the same instant are ordered by the
 * input gate, and the second one gets its `409` because the first one really
 * did land first. The same operation against a shared table would need a
 * transaction to say as much.
 *
 * ## What it will not do
 *
 * It does not parse a save, so it cannot repair, merge or interpret one. It
 * cannot enumerate accounts. It holds no credential. The worst a compromised
 * copy of this class can do to a player is withhold or corrupt bytes it was
 * given — which is bad, and is bounded by the fact that the authoritative copy
 * of a save is the one on the player's own device.
 */

import { DurableObject } from "cloudflare:workers";
import { applyPut, manifestOf, sha256Hex, type ManifestEntry, type StoredSection } from "./saves/store";
import { SAVE_SECTIONS, isSaveSection } from "./shared/saves";
import type { Env } from "./env";

const keyFor = (section: string): string => `section:${section}`;

export class SaveStore extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/manifest") return this.manifest();
    if (url.pathname === "/all" && request.method === "DELETE") return this.deleteEverything();

    const section = url.pathname.startsWith("/section/") ? url.pathname.slice("/section/".length) : null;
    if (!section) return Response.json({ error: "not found" }, { status: 404 });

    /**
     * An unknown section is refused before it is stored, not after.
     *
     * This is the allowlist doing its job: without it the section name is
     * attacker-chosen and an account becomes unbounded storage against a 5 GB
     * account-wide free allowance.
     */
    if (!isSaveSection(section)) {
      return Response.json({ error: `unknown section "${section}"` }, { status: 404 });
    }

    if (request.method === "GET") return this.read(section);
    if (request.method === "PUT") return this.write(section, request);
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  /**
   * Every section's metadata, without any payload.
   *
   * One `get` with a key list rather than five, because a Durable Object bills
   * rows read and there is no reason to spend five when the API takes an array.
   */
  private async manifest(): Promise<Response> {
    const stored = await this.ctx.storage.get<StoredSection>([...SAVE_SECTIONS].map(keyFor));
    const sections: ManifestEntry[] = [];
    for (const section of SAVE_SECTIONS) {
      const entry = stored.get(keyFor(section));
      if (entry) sections.push(manifestOf(section, entry));
    }
    return Response.json({ sections });
  }

  private async read(section: string): Promise<Response> {
    const entry = await this.ctx.storage.get<StoredSection>(keyFor(section));
    if (!entry) return Response.json({ error: "no save for this section" }, { status: 404 });
    return Response.json({
      ...manifestOf(section, entry),
      /**
       * The payload travels as the canonical *text*, not as parsed JSON.
       *
       * Re-serialising it here would reorder keys and break the checksum the
       * client is about to verify — the whole point of a canonical form is that
       * exactly these bytes come back.
       */
      payload: entry.payload,
    });
  }

  private async write(section: string, request: Request): Promise<Response> {
    let body: { version?: unknown; payload?: unknown; checksum?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }

    if (typeof body.payload !== "string" || typeof body.checksum !== "string" || typeof body.version !== "number") {
      return Response.json({ error: "expected { version: number, payload: string, checksum: string }" }, { status: 400 });
    }

    const header = request.headers.get("If-Match");
    const ifMatch = header === null ? null : Number.parseInt(header, 10);
    if (ifMatch !== null && !Number.isInteger(ifMatch)) {
      return Response.json({ error: "If-Match must be an integer revision" }, { status: 400 });
    }

    const current = (await this.ctx.storage.get<StoredSection>(keyFor(section))) ?? null;
    const outcome = applyPut(
      current,
      { version: body.version, payload: body.payload, claimedChecksum: body.checksum, ifMatch },
      await sha256Hex(body.payload),
      Date.now()
    );

    if (outcome.status === 200) {
      await this.ctx.storage.put(keyFor(section), outcome.entry);
      return Response.json(manifestOf(section, outcome.entry));
    }

    if (outcome.status === 409) {
      /**
       * The refusal carries the current state, so the client can resolve
       * without a second round trip — and, more importantly, so it can *see*
       * what it would have overwritten rather than being told only that it
       * failed.
       */
      return Response.json(
        {
          error: "another device wrote first",
          current: outcome.current ? manifestOf(section, outcome.current) : null,
        },
        { status: 409 }
      );
    }

    if (outcome.status === 413) {
      return Response.json({ error: "save too large", bytes: outcome.bytes, cap: outcome.cap }, { status: 413 });
    }

    return Response.json({ error: outcome.reason }, { status: outcome.status });
  }

  /**
   * Erase the account's save, for account deletion.
   *
   * `deleteAll()` rather than writing empty sections, for the same reason
   * `PlayerRecord` does it: an empty row is still a row, and "we kept your save
   * with nothing in it" is not what a deletion request means.
   */
  private async deleteEverything(): Promise<Response> {
    const stored = await this.ctx.storage.get<StoredSection>([...SAVE_SECTIONS].map(keyFor));
    await this.ctx.storage.deleteAll();
    return Response.json({ ok: true, sectionsDeleted: stored.size });
  }
}
