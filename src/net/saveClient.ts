/**
 * Talking to the save server.
 *
 * One class, four calls, and every one of them returns a described outcome
 * rather than throwing. That is not a style preference: the caller is sync
 * logic that has to decide whether to overwrite a collection, and a thrown
 * error there collapses "the server said no" and "the wifi dropped" into the
 * same catch block. Those need opposite responses — one is a conflict to
 * resolve, the other is a retry in thirty seconds.
 *
 * ## Integrity is checked in both directions
 *
 * Uploads carry the canonical text and its hash, and the server re-derives the
 * hash before storing. Downloads are hashed again here and compared to the
 * metadata that came with them. A payload that fails is reported as `corrupt`
 * and **never parsed into the game**, because the failure mode this guards
 * against is a truncated response quietly becoming a smaller collection.
 *
 * ## `fetch` and the token are injected
 *
 * So the whole surface is testable without a network and without a signed-in
 * account. The defaults are the real ones, so nothing has to remember to wire
 * it up in production.
 */

import { ONLINE, type OnlineConfig } from "../config";
import { accessToken } from "../auth/account";
import {
  SECTION_BYTE_CAP,
  canonicalJson,
  checksumOf,
  type ManifestEntry,
  type SaveSection,
} from "../save/cloudSync";

export type PushResult =
  | { readonly kind: "ok"; readonly entry: ManifestEntry }
  /** Another device wrote first. `current` is what is actually there. */
  | { readonly kind: "conflict"; readonly current: ManifestEntry | null }
  | { readonly kind: "too-large"; readonly bytes: number; readonly cap: number }
  | { readonly kind: "signed-out" }
  | { readonly kind: "error"; readonly message: string };

export type PullResult =
  | { readonly kind: "ok"; readonly entry: ManifestEntry; readonly data: unknown }
  /** The server holds nothing for this section. Not an error. */
  | { readonly kind: "absent" }
  /** What arrived does not hash to what the metadata says. Never applied. */
  | { readonly kind: "corrupt"; readonly expected: string; readonly actual: string }
  | { readonly kind: "signed-out" }
  | { readonly kind: "error"; readonly message: string };

export type ManifestResult =
  | { readonly kind: "ok"; readonly sections: readonly ManifestEntry[] }
  | { readonly kind: "signed-out" }
  | { readonly kind: "error"; readonly message: string };

export interface SaveClientOptions {
  readonly config?: OnlineConfig;
  readonly fetchImpl?: typeof fetch;
  readonly token?: () => Promise<string | null>;
}

export class SaveClient {
  private readonly config: OnlineConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly token: () => Promise<string | null>;

  constructor(options: SaveClientOptions = {}) {
    this.config = options.config ?? ONLINE;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.token = options.token ?? (() => accessToken(this.config));
  }

  private base(): string {
    return `${this.config.serverUrl.replace(/\/+$/, "")}/me/saves`;
  }

  private async authorized(): Promise<Record<string, string> | null> {
    const token = await this.token();
    return token ? { authorization: `Bearer ${token}` } : null;
  }

  /** Every section the server holds, without any payloads. */
  async manifest(): Promise<ManifestResult> {
    const headers = await this.authorized();
    if (!headers) return { kind: "signed-out" };

    try {
      const response = await this.fetchImpl(this.base(), { headers });
      if (!response.ok) return { kind: "error", message: `the save service answered ${response.status}` };
      const body = (await response.json()) as { sections?: ManifestEntry[] };
      return { kind: "ok", sections: body.sections ?? [] };
    } catch {
      return { kind: "error", message: "could not reach the save service" };
    }
  }

  async pull(section: SaveSection): Promise<PullResult> {
    const headers = await this.authorized();
    if (!headers) return { kind: "signed-out" };

    try {
      const response = await this.fetchImpl(`${this.base()}/${section}`, { headers });
      if (response.status === 404) return { kind: "absent" };
      if (!response.ok) return { kind: "error", message: `the save service answered ${response.status}` };

      const body = (await response.json()) as ManifestEntry & { payload?: string };
      if (typeof body.payload !== "string") return { kind: "error", message: "the save service returned no payload" };

      /**
       * Hashed before it is parsed, and parsed only if it matches.
       *
       * A truncated response is still valid JSON surprisingly often — an object
       * cut at a comma is not, but an array cut between elements can be — and a
       * save that is quietly missing its last few hundred cards is worse than
       * one that fails to load.
       */
      const actual = await sha256OfText(body.payload);
      if (actual !== body.checksum) return { kind: "corrupt", expected: body.checksum, actual };

      let data: unknown;
      try {
        data = JSON.parse(body.payload);
      } catch {
        return { kind: "corrupt", expected: body.checksum, actual };
      }

      const { payload: _payload, ...entry } = body;
      return { kind: "ok", entry, data };
    } catch {
      return { kind: "error", message: "could not reach the save service" };
    }
  }

  /**
   * Upload one section.
   *
   * `ifMatch` is required by the type, not defaulted, because there is no safe
   * default. `0` means "I expect nothing there" and any other number means "I
   * expect exactly this revision" — and a caller that has not thought about
   * which one it means is a caller about to overwrite something.
   */
  async push(section: SaveSection, version: number, data: unknown, ifMatch: number): Promise<PushResult> {
    const headers = await this.authorized();
    if (!headers) return { kind: "signed-out" };

    const payload = canonicalJson(data);
    const bytes = new TextEncoder().encode(payload).length;
    if (bytes > SECTION_BYTE_CAP) {
      // Refused here as well as on the server so the player gets a sentence
      // instead of a 413, and so an oversized save does not burn one of the
      // day's writes to be told no.
      return { kind: "too-large", bytes, cap: SECTION_BYTE_CAP };
    }

    try {
      const response = await this.fetchImpl(`${this.base()}/${section}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json", "If-Match": String(ifMatch) },
        body: JSON.stringify({ version, payload, checksum: await checksumOf(data) }),
      });

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { current?: ManifestEntry | null };
        return { kind: "conflict", current: body.current ?? null };
      }
      if (response.status === 413) {
        return { kind: "too-large", bytes, cap: SECTION_BYTE_CAP };
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { kind: "error", message: body.error ?? `the save service answered ${response.status}` };
      }

      return { kind: "ok", entry: (await response.json()) as ManifestEntry };
    } catch {
      return { kind: "error", message: "could not reach the save service" };
    }
  }

  /** Erase every section. Used by account deletion, and by nothing else. */
  async deleteAll(): Promise<boolean> {
    const headers = await this.authorized();
    if (!headers) return false;
    try {
      const response = await this.fetchImpl(this.base(), { method: "DELETE", headers });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * SHA-256 of text already in canonical form.
 *
 * Separate from `checksumOf`, which canonicalises a *value* first. Downloads
 * arrive as text that must be hashed exactly as received — canonicalising it
 * again would compute the hash of a re-serialisation and could not detect the
 * corruption it exists to catch.
 */
async function sha256OfText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
