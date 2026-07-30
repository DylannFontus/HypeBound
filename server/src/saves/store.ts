/**
 * Cloud saves — the arithmetic, with no Durable Object in sight.
 *
 * Same split as every other core in this package: this decides, `saveStore.ts`
 * stores. It takes the current row, a request and a clock reading, and returns
 * an outcome. That means the rules about *when a player's save may be
 * overwritten* can be tested exhaustively in vitest without workerd, which for
 * this particular decision is the difference between confidence and hope.
 *
 * ## The payload is opaque, and that is load-bearing
 *
 * The server never parses a save. It stores the exact bytes it was given and
 * hands them back. Three things follow, all of them good:
 *
 * - It cannot corrupt a save it does not understand. Multiplayer §12.4 puts
 *   migrations on the client for this reason, and an opaque server is how that
 *   promise is kept rather than merely stated.
 * - A save schema change needs no deploy here. `version` is recorded so a
 *   client can refuse a save newer than it knows, and is otherwise inert.
 * - There is nothing in a save this server can act on, so a compromised server
 *   can withhold or corrupt a save but cannot mint currency out of one.
 *
 * ## The checksum is verified, not trusted
 *
 * The client uploads the *canonical* serialisation and the checksum of it. The
 * server hashes what arrived and compares. A checksum the server merely records
 * is a label; one it re-derives is an integrity check, and it costs a single
 * SHA-256 over at most 512 KB.
 */

/** §12.3. Comfortably inside the 2 MB a Durable Object allows for one value. */
export const SECTION_BYTE_CAP = 512 * 1024;

export interface StoredSection {
  /** The client's envelope version. Recorded, never interpreted. */
  readonly version: number;
  /** Server-assigned, monotonic, starts at 1. */
  readonly revision: number;
  /** ISO 8601 from the server clock — §12.1, because client clocks are untrusted. */
  readonly updatedAt: string;
  readonly checksum: string;
  readonly bytes: number;
  /** Canonical JSON text, exactly as uploaded. */
  readonly payload: string;
}

/** One row of `GET /v1/saves`, which is a `StoredSection` minus the payload. */
export interface ManifestEntry {
  readonly section: string;
  readonly version: number;
  readonly revision: number;
  readonly updatedAt: string;
  readonly checksum: string;
  readonly bytes: number;
}

export interface PutRequest {
  readonly version: number;
  /** Canonical JSON text. */
  readonly payload: string;
  /** What the client says the payload hashes to. */
  readonly claimedChecksum: string;
  /**
   * The revision the client believes it is replacing. `0` means "I believe
   * there is nothing here". `null` means the header was absent.
   */
  readonly ifMatch: number | null;
}

export type PutOutcome =
  | { readonly status: 200; readonly entry: StoredSection }
  /** No `If-Match`. A blind write is the one thing this design exists to prevent. */
  | { readonly status: 428; readonly reason: string }
  /** Somebody else wrote first. The current row travels with the refusal. */
  | { readonly status: 409; readonly current: StoredSection | null }
  | { readonly status: 413; readonly bytes: number; readonly cap: number }
  | { readonly status: 400; readonly reason: string };

export function manifestOf(section: string, entry: StoredSection): ManifestEntry {
  return {
    section,
    version: entry.version,
    revision: entry.revision,
    updatedAt: entry.updatedAt,
    checksum: entry.checksum,
    bytes: entry.bytes,
  };
}

/**
 * Decide a write.
 *
 * `actualChecksum` is the hash of `request.payload` as computed by the caller —
 * passed in rather than computed here so this stays synchronous and pure, since
 * `crypto.subtle` is async.
 *
 * The order of the checks is deliberate. Cheap structural refusals come before
 * the concurrency check, so a malformed request never consumes the revision it
 * would have been refused for anyway.
 */
export function applyPut(
  current: StoredSection | null,
  request: PutRequest,
  actualChecksum: string,
  nowMs: number
): PutOutcome {
  const bytes = utf8Bytes(request.payload);
  if (bytes > SECTION_BYTE_CAP) return { status: 413, bytes, cap: SECTION_BYTE_CAP };

  if (!Number.isInteger(request.version) || request.version < 1) {
    return { status: 400, reason: "version must be a positive integer" };
  }

  if (actualChecksum !== request.claimedChecksum) {
    // Either the upload was truncated or the client canonicalised differently.
    // Both are bugs, and storing the payload anyway would hide them behind a
    // save that silently fails its next comparison.
    return { status: 400, reason: "checksum does not match the uploaded bytes" };
  }

  /**
   * A missing `If-Match` is refused rather than treated as "overwrite".
   *
   * This is the whole safety property in one branch. A client that does not say
   * what it expects to replace cannot be told it was wrong, and a save that can
   * be replaced without being expected is a save that disappears the first time
   * two devices are open at once.
   */
  if (request.ifMatch === null) {
    return { status: 428, reason: "If-Match is required, and 0 means 'I expect nothing here'" };
  }

  const currentRevision = current?.revision ?? 0;
  if (request.ifMatch !== currentRevision) return { status: 409, current };

  return {
    status: 200,
    entry: {
      version: request.version,
      revision: currentRevision + 1,
      updatedAt: new Date(nowMs).toISOString(),
      checksum: actualChecksum,
      bytes,
      payload: request.payload,
    },
  };
}

/**
 * Byte length of a UTF-8 string, without allocating an encoder per call.
 *
 * `string.length` counts UTF-16 code units, so it under-reports every emoji in
 * a deck name and every accented character in a display name. A cap measured in
 * the wrong unit is not a cap.
 */
const ENCODER = new TextEncoder();
export function utf8Bytes(value: string): number {
  return ENCODER.encode(value).length;
}

/** SHA-256, hex. Matches `src/save/cloudSync.ts`'s `checksumOf`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ENCODER.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
