/**
 * Wire protocol v1 — envelopes and their zod schemas.
 * `docs/tech/03-multiplayer-architecture.md` §7.
 *
 * Shared verbatim by client and server and **validated on both ends**. Nothing
 * above `src/net` imports this; the local path does not use it at all. It is
 * written now, one phase before the server exists, because §15 phase 2 says so
 * and because the exercise of writing it is what finds the places the design
 * cannot be built as drafted. It found fourteen (§7 conflicts C1–C14, recorded
 * in the design doc).
 *
 * ## The one that shapes this file
 *
 * §7.1 declares the envelope with payload fields **flat**:
 * `{ v, t, id?, ts, /* + payload *\/ }`. Then §7.2 gives `intent { id, … }` and
 * `ping { ts }`, and §7.4 gives `pong { ts, serverTs }`. Flattened, `intent.id`
 * collides with the envelope's `id`, and both `ts` fields collide with the
 * envelope's `ts`. **The document cannot be implemented verbatim.**
 *
 * Resolved by keeping it flat and removing the duplicates rather than nesting
 * everything under a `p` key: `intent` uses the envelope's `id`, `ping` uses the
 * envelope's `ts`, and `pong` carries `clientTs`/`serverTs`. Flat keeps frames
 * small and readable in a network log, which matters more here than the
 * theoretical tidiness of a namespace that would exist only to avoid three
 * collisions.
 *
 * ## Why the client validates too
 *
 * The server validating client frames is the obvious half — it is the trust
 * boundary (§3), and `PlayerIntent` is the entire client→server attack surface.
 * The client validating *server* frames is the half people skip, and it is what
 * turns "the opponent's board renders wrong for the rest of the match" into a
 * single loud error naming the field. A malformed frame is a bug in the room,
 * and a bug in the room should not be debugged from a screenshot.
 */

import { z } from "zod";
import { zConfluenceId, zCurrentId } from "../engine/validation";
import type { PlayerIntent, TargetRef } from "../engine/types";
import type { EventCause } from "./transport";

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * `Seat = 0 | 1` is a **numeric** literal union, and `z.enum` is string-only,
 * so this cannot be `z.enum([0, 1])`.
 */
export const zSeat = z.union([z.literal(0), z.literal(1)]);

/**
 * An engine instance id: a short prefix and a counter (`nextId` in
 * `src/engine/state.ts`), never user-authored. Bounded because it is used as a
 * map key and compared in loops — an unbounded string here is a cheap way to
 * make the room do expensive work.
 */
export const zInstanceId = z.string().min(1).max(64);

/**
 * A runtime pointer at something on the board. **Not** `zTargetSpec` from
 * `validation.ts` — that validates card-authoring data (`{ select: "choose", … }`),
 * whereas this is what an intent sends to name a specific body. Nothing
 * validated it before, because until now nothing untrusted produced one.
 */
export const zTargetRef: z.ZodType<TargetRef> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), instanceId: zInstanceId }),
  z.object({ kind: z.literal("leader"), seat: zSeat }),
]);

/**
 * Branch indexes for `chooseOne`, and slots.
 *
 * The real bound on `slot` is `balance.board.characterSlots`, but
 * `balanceOverrides` can move it per match, so the schema stays deliberately
 * generous and lets the engine raise the canonical `invalidSlot` instead. A
 * schema that hardcoded 6 would reject a legal intent in a modified room.
 */
const zSlot = z.number().int().min(0).max(32);
const zChoice = z.number().int().nonnegative().max(64);
const zTargets = z.array(zTargetRef).max(16);

// ---------------------------------------------------------------------------
// PlayerIntent — the entire client → server attack surface
// ---------------------------------------------------------------------------

/**
 * All eight variants. An unvalidated variant is an unvalidated message, so this
 * is exhaustive by construction: `zPlayerIntent` is annotated
 * `z.ZodType<PlayerIntent>`, which fails to compile if a variant is missing or
 * a field's type drifts from `types.ts`.
 *
 * Note `activateConfluence.choice` (singular number) and `playCard.choices`
 * (plural array) — two different fields one letter apart on the same wire.
 */
/**
 * **Every variant is `.strict()`.** Zod ignores unknown keys by default, which
 * is a sane default for parsing config and the wrong one at a trust boundary:
 * `{ type: "playCard", choice: 0 }` would validate by silently dropping the
 * stray field, and the player would watch a card resolve the wrong half of a
 * Choose One. Worse, `choice` and `choices` differ by a letter and belong to
 * different intents, so the typo is a plausible client bug rather than an
 * exotic attack. Strict turns both into a named refusal.
 *
 * Found by this file's own tests: two of them passed a deliberately malformed
 * intent and zod accepted it.
 */
export const zPlayerIntent: z.ZodType<PlayerIntent> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mulligan"),
    seat: zSeat,
    replaceInstanceIds: z.array(zInstanceId).max(64),
  }).strict(),
  z.object({
    type: z.literal("playCard"),
    seat: zSeat,
    instanceId: zInstanceId,
    slot: zSlot.optional(),
    targets: zTargets.optional(),
    choices: z.array(zChoice).max(16).optional(),
    refractChoice: zCurrentId.optional(),
  }).strict(),
  z.object({
    type: z.literal("attack"),
    seat: zSeat,
    attackerInstanceId: zInstanceId,
    target: zTargetRef,
  }).strict(),
  z.object({
    type: z.literal("useFixation"),
    seat: zSeat,
    kind: z.enum(["fixation", "ultimate"]),
    targets: zTargets.optional(),
    choices: z.array(zChoice).max(16).optional(),
  }).strict(),
  z.object({
    type: z.literal("activateLocation"),
    seat: zSeat,
    targets: zTargets.optional(),
    choices: z.array(zChoice).max(16).optional(),
  }).strict(),
  z.object({
    type: z.literal("activateConfluence"),
    seat: zSeat,
    confluence: zConfluenceId,
    targets: zTargets.optional(),
    choice: zChoice.optional(),
  }).strict(),
  z.object({ type: z.literal("endTurn"), seat: zSeat }).strict(),
  z.object({ type: z.literal("concede"), seat: zSeat }).strict(),
]) as z.ZodType<PlayerIntent>;

// ---------------------------------------------------------------------------
// Errors and clocks
// ---------------------------------------------------------------------------

/**
 * The canonical refusal codes, exactly as `types.ts` declares them. A room that
 * invented a code here would give the client an untranslatable error, which is
 * why §4.3 insists a rejection is "never a free-text-only error".
 */
export const zRulesErrorShape = z.object({
  code: z.enum([
    "notYourTurn",
    "wrongPhase",
    "notEnoughHype",
    "invalidTarget",
    "invalidSlot",
    "boardFull",
    "cannotAttack",
    "alreadyAttacked",
    "spotlightEnforced",
    "unknownInstance",
    "confluenceUnavailable",
    "fixationUnavailable",
    "reactionLimit",
    "missingChoice",
    "invalidIntent",
  ]),
  message: z.string().max(512),
});

export const zMatchClocks = z.object({
  activeSeat: zSeat,
  turnMsRemaining: z.number().int().nonnegative(),
  ropeMsRemaining: z.number().int().nonnegative(),
  serverNowMs: z.number().int().nonnegative(),
});

/**
 * `MatchSnapshot.seq` means "current as of this batch", which is a different
 * thing from a stream counter and is why it is `nonnegative` rather than
 * `positive`: a snapshot taken before any batch has been sent legitimately
 * reads 0. §7.5 says sequence numbers start at 1, and that is true of *batches*.
 *
 * The view itself is deliberately **not** schema-validated field by field. It is
 * a large, deeply nested engine type that already has one source of truth in
 * `types.ts`, and a second hand-written copy here would be a maintenance trap
 * that drifts silently. The frame is checked for shape; the view is checked by
 * `viewHash` comparison, which is stronger and free.
 */
export const zMatchSnapshot = z.object({
  seq: z.number().int().nonnegative(),
  view: z.unknown(),
  revealedDeckInstanceIds: z.array(zInstanceId).max(256),
  clocks: zMatchClocks,
  spectatorCount: z.number().int().nonnegative(),
});

/**
 * `cause` is a discriminated union rather than §6's flat
 * `{ kind; seat; clientIntentId? }`.
 *
 * `Seat` has no null member, so a `"system"` cause — match start, a scripted
 * wave landing — had to name a seat it does not have. `LocalTransport` passed
 * `activeSeat`, which reads like a fact and is not one. Splitting the union
 * makes the absence expressible instead of requiring a plausible lie.
 *
 * Annotated `z.ZodType<EventCause>` so the schema and `EventBatch.cause` cannot
 * drift: this correction was first made here alone, and `transport.ts` went on
 * declaring `seat` required for a while afterwards — which is precisely the
 * failure this annotation makes impossible.
 */
export const zEventCause: z.ZodType<EventCause> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("intent"), seat: zSeat, clientIntentId: z.number().int().positive().optional() }),
  z.object({ kind: z.literal("timer"), seat: zSeat }),
  z.object({ kind: z.literal("system"), seat: zSeat.optional() }),
]);

export const zEventBatch = z.object({
  /**
   * A batch the client has already applied, resent so the *animation* is not
   * lost (§8.3). State is already correct from the resume snapshot; these exist
   * only so a player who was away for forty seconds can see what happened
   * rather than find the board rearranged.
   *
   * Optional and absent in the normal case, so an old client ignores it and a
   * new one can tell a catch-up from a duplicate — which it otherwise cannot,
   * both being "a seq I have already seen".
   */
  catchUp: z.boolean().optional(),
  seq: z.number().int().positive(),
  cause: zEventCause,
  events: z.array(z.unknown()).max(512),
  clocks: zMatchClocks,
  viewHash: z.string().regex(/^[0-9a-f]{8}$/),
  snapshot: zMatchSnapshot.optional(),
});

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

const envelope = { v: z.literal(PROTOCOL_VERSION), ts: z.number().int().nonnegative() };

/**
 * `hello` has no `protocol` field. §7.2 lists one, but it duplicates the
 * envelope's `v` with no stated precedence, and a version mismatch already has
 * a documented path (`fatal { code: "protocolVersion" }`). Two version numbers
 * that can disagree is worse than one.
 */
export const zClientHello = z.object({
  ...envelope,
  t: z.literal("hello"),
  matchToken: z.string().min(1).max(4096),
  build: z.string().min(1).max(64),
  contentHash: z.string().min(1).max(64),
  resume: z
    .object({
      sessionId: z.string().min(1).max(64),
      // 32 bytes base64url is 43 characters (§7.5)
      resumeToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
      lastAckSeq: z.number().int().nonnegative(),
    })
    .optional(),
});

export const zClientIntent = z.object({
  ...envelope,
  t: z.literal("intent"),
  // the envelope's id, not a second one — see C1 in the header
  id: z.number().int().positive().max(2 ** 31 - 1),
  intent: zPlayerIntent,
});

/**
 * `ack` carries the cumulative sequence, and optionally the client's own
 * `viewHash` for that point — the divergence-detection channel of §11.5.
 * Constrained to eight lowercase hex because it is compared, never displayed.
 */
export const zClientAck = z.object({
  ...envelope,
  t: z.literal("ack"),
  seq: z.number().int().nonnegative(),
  viewHash: z.string().regex(/^[0-9a-f]{8}$/).optional(),
});

export const zClientResync = z.object({
  ...envelope,
  t: z.literal("resync"),
  reason: z.enum(["hashMismatch", "userRequest", "resume"]),
});

/**
 * `ping` piggybacks the latest ack explicitly.
 *
 * §7.2 says a ping "also carries the latest `ack`" and then gives it no field
 * to carry one in. Rather than leave that to an unwritten "send an ack first"
 * convention — which §7.5's backpressure counter would silently depend on —
 * the fields are here and optional.
 */
export const zClientPing = z.object({
  ...envelope,
  t: z.literal("ping"),
  ackSeq: z.number().int().nonnegative().optional(),
  viewHash: z.string().regex(/^[0-9a-f]{8}$/).optional(),
});

/**
 * An emote is a **cosmetic id**, not a phrase.
 *
 * The shipped client passes free text — `emoteWheel()` returns strings like
 * "Well played", resolved from owned cosmetics. Putting that on the wire makes
 * the emote channel arbitrary user-authored text, which is chat, which drags in
 * the moderation question §17.1 explicitly leaves open. Sending the id and
 * letting the room resolve it against the sender's entitlements keeps the
 * channel closed and makes an unowned emote unsendable rather than merely
 * unclicked.
 */
export const zClientEmote = z.object({
  ...envelope,
  t: z.literal("emote"),
  emoteId: z.string().min(1).max(64),
});

export const zClientLeave = z.object({
  ...envelope,
  t: z.literal("leave"),
  reason: z.enum(["menu", "closing"]),
});

export const zClientEnvelope = z.discriminatedUnion("t", [
  zClientHello,
  zClientIntent,
  zClientAck,
  zClientResync,
  zClientPing,
  zClientEmote,
  zClientLeave,
]);

export type ClientEnvelope = z.infer<typeof zClientEnvelope>;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const zNetConfig = z.object({
  heartbeatSeconds: z.number().int().positive(),
  resumeGraceSeconds: z.number().int().positive(),
  seatHoldSeconds: z.number().int().positive(),
  maxFrameBytes: z.number().int().positive(),
  turnSeconds: z.number().int().positive(),
  ropeSeconds: z.number().int().nonnegative(),
});

/**
 * `welcome` says whether you are playing or watching.
 *
 * §7.4's payload has only `seat`, but §10.2 mints spectator tokens carrying a
 * `role` and a `watchSeat`, and §13.3 has the spectator service answer with a
 * `welcome`. Without `role` a spectator client cannot distinguish "I am seat 0"
 * from "I am watching seat 0" — and that difference decides whether the UI
 * offers an End Turn button.
 *
 * The top-level `seq` and `clocks` §7.4 lists are dropped: `MatchSnapshot`
 * already carries both, and shipping them twice with no stated winner is an
 * invitation to read the wrong one.
 */
export const zServerWelcome = z.object({
  ...envelope,
  t: z.literal("welcome"),
  sessionId: z.string().min(1).max(64),
  resumeToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
  seat: zSeat,
  role: z.enum(["player", "spectator"]),
  matchId: z.string().min(1).max(64),
  netConfig: zNetConfig,
  snapshot: zMatchSnapshot,
});

/**
 * A batch. The refinement pins §6's other duplication: when a batch carries a
 * snapshot, the two sequence numbers must agree — which is what the local
 * implementation already emits, and what a client would otherwise have to guess
 * between.
 */
export const zServerBatch = z
  .object({ ...envelope, t: z.literal("batch") })
  .merge(zEventBatch)
  .refine((frame) => frame.snapshot === undefined || frame.snapshot.seq === frame.seq, {
    message: "batch.snapshot.seq must equal batch.seq",
  });

export const zServerSnapshot = z.object({ ...envelope, t: z.literal("snapshot") }).merge(zMatchSnapshot);

export const zServerRejected = z.object({
  ...envelope,
  t: z.literal("rejected"),
  id: z.number().int().positive(),
  error: zRulesErrorShape,
});

/**
 * The success half of `SubmitResult`, which §7.4 has no frame for.
 *
 * `SubmitResult` is `{ ok: true; seq } | { ok: false; error }`. §7.4 gives
 * `rejected` for the failure and nothing at all for the success, leaving a
 * `WsTransport` to resolve `submit()` by watching for a batch whose
 * `cause.clientIntentId` matches — a correlation rule the document never
 * states. It also leaves §4.3's idempotency promise ("a re-sent intent is
 * answered with the original batch seq") describing a frame that does not
 * exist. This is that frame.
 */
export const zServerAccepted = z.object({
  ...envelope,
  t: z.literal("accepted"),
  id: z.number().int().positive(),
  seq: z.number().int().positive(),
});

export const zServerPresence = z.object({
  ...envelope,
  t: z.literal("presence"),
  seat: zSeat,
  status: z.enum(["connected", "unstable", "disconnected"]),
  graceRemainingMs: z.number().int().nonnegative(),
  spectators: z.number().int().nonnegative(),
});

export const zServerClock = z.object({ ...envelope, t: z.literal("clock"), clocks: zMatchClocks });

export const zServerEmote = z.object({
  ...envelope,
  t: z.literal("emote"),
  seat: zSeat,
  emoteId: z.string().min(1).max(64),
});

/**
 * `ended` mirrors `matchEnded`, and its unions are therefore fixed by
 * `types.ts` — there is no `"timeout"`, `"disconnect"` or `"abandoned"`. §4.4
 * and §8.2 both handle those by injecting a real `{ type: "concede", seat }`,
 * so they arrive as `"concede"`. A room inventing a reason string here would
 * break the canonical type, so the schema is exactly the four.
 */
export const zServerEnded = z.object({
  ...envelope,
  t: z.literal("ended"),
  winner: z.union([zSeat, z.literal("draw")]),
  reason: z.enum(["leaderDefeated", "concede", "finale", "draw"]),
  matchId: z.string().min(1).max(64),
  replayAvailable: z.boolean(),
});

export const zServerPong = z.object({
  ...envelope,
  t: z.literal("pong"),
  // renamed from §7.4's `ts` so it cannot collide with the envelope's — see C1
  clientTs: z.number().int().nonnegative(),
  serverTs: z.number().int().nonnegative(),
});

export const zServerFatal = z.object({
  ...envelope,
  t: z.literal("fatal"),
  code: z.enum([
    "protocolVersion",
    "buildMismatch",
    "authFailed",
    "notAParticipant",
    "roomGone",
    "streamOverflow",
    "rateLimited",
    "kicked",
  ]),
  message: z.string().max(512),
});

/**
 * `zServerBatch` is a `ZodEffects` (it has a `.refine`), which
 * `discriminatedUnion` will not accept, so the server side is a plain union
 * discriminated by hand. The cost is a slightly worse error message on an
 * unknown `t`; the alternative was dropping the refinement that stops the two
 * sequence numbers disagreeing.
 */
export const zServerEnvelope = z.union([
  zServerWelcome,
  zServerBatch,
  zServerSnapshot,
  zServerRejected,
  zServerAccepted,
  zServerPresence,
  zServerClock,
  zServerEmote,
  zServerEnded,
  zServerPong,
  zServerFatal,
]);

export type ServerEnvelope = z.infer<typeof zServerEnvelope>;

// ---------------------------------------------------------------------------
// Limits (§7.6)
// ---------------------------------------------------------------------------

/**
 * The caps the gateway enforces. Here rather than in `data/` because these are
 * deployment parameters, not game content — `data/` is loaded and validated by
 * `content.ts` and is the same on every machine, while these belong to whoever
 * is running the server.
 */
export const WIRE_LIMITS = {
  maxFrameBytes: 65536,
  messagesPerSecond: 20,
  messageBurst: 40,
  intentsPerTurn: 60,
  illegalIntentsPerMatch: 5,
  resyncPerSeconds: 5,
  emotePerSeconds: 3,
  emotesPerMatch: 20,
  helloDeadlineSeconds: 5,
  maxUnackedBatches: 256,
} as const;

/**
 * Parse a client frame at the trust boundary.
 *
 * Returns a discriminated result rather than throwing, because at the edge a
 * malformed frame is an expected event — it is what a hostile client sends —
 * and exceptions are the wrong control flow for the common case.
 *
 * **Size is checked before parsing.** A 10 MB frame that fails validation has
 * already cost the room the memory and the parse; the cap has to come first to
 * mean anything.
 */
export function parseClientFrame(
  raw: string
): { ok: true; frame: ClientEnvelope } | { ok: false; code: "tooLarge" | "malformed" | "schema"; detail: string } {
  if (raw.length > WIRE_LIMITS.maxFrameBytes) {
    return { ok: false, code: "tooLarge", detail: `${raw.length} bytes` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code: "malformed", detail: error instanceof Error ? error.message : "unparseable" };
  }
  const result = zClientEnvelope.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, code: "schema", detail: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid" };
  }
  return { ok: true, frame: result.data };
}

// ---------------------------------------------------------------------------
// Lobby protocol — §9's queue, on its own socket
// ---------------------------------------------------------------------------

/**
 * The queue speaks a different language from a match, and gets a different
 * socket.
 *
 * §7 is the *match* protocol: every frame in it presupposes a room, a seat and a
 * sequence number, and none of the three exists while somebody is waiting to be
 * paired. §15.1 already anticipated this with `lobbySocket.ts`; these are the
 * frames it carries.
 *
 * They share the `{ v, ts }` envelope so that a version mismatch is one problem
 * rather than two, and so a network log reads the same either side of a pairing.
 */

export const zDeckList = z
  .object({
    name: z.string().min(1).max(64),
    leaderCardId: z.string().min(1).max(64),
    // The cap is deliberately loose: canon's deck size is content, checked by
    // `validateDeck` with the real rules. This only stops a 10 MB array from
    // reaching the validator.
    cards: z.array(z.string().min(1).max(64)).max(120),
    cardBackId: z.string().max(64).optional(),
    coverCardId: z.string().max(64).optional(),
    editedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const zLobbyEnqueue = z.object({
  ...envelope,
  t: z.literal("enqueue"),
  queueId: z.literal("casual"),
  deck: zDeckList,
  /** §14.5 again: refused rather than widened, so it is checked before a ticket exists. */
  build: z.string().min(1).max(64),
  contentHash: z.string().min(1).max(64),
});

export const zLobbyDequeue = z.object({ ...envelope, t: z.literal("dequeue") });
export const zLobbyPing = z.object({ ...envelope, t: z.literal("lobbyPing") });

export const zLobbyClientEnvelope = z.discriminatedUnion("t", [zLobbyEnqueue, zLobbyDequeue, zLobbyPing]);
export type LobbyClientEnvelope = z.infer<typeof zLobbyClientEnvelope>;

export const zLobbyQueued = z.object({
  ...envelope,
  t: z.literal("queued"),
  ticketId: z.string().min(1).max(64),
  waiting: z.number().int().nonnegative(),
});

/**
 * Honest queue statistics, sent on a cadence rather than only at the end.
 *
 * §9.3's last row promises ranked "honest queue statistics" and casual an AI
 * offer. Casual gets both: `waiting` is the true number of people in the queue,
 * which at this population is usually zero, and saying so is the difference
 * between a game that is quiet and a game that appears broken.
 */
export const zLobbySearching = z.object({
  ...envelope,
  t: z.literal("searching"),
  waitedMs: z.number().int().nonnegative(),
  /** Current rating band, so the UI can say "looking wider" truthfully. */
  band: z.number().nonnegative(),
  waiting: z.number().int().nonnegative(),
});

/** §9.3: "offer *Play the AI instead* (never a fake human)". */
export const zLobbyAiOffer = z.object({
  ...envelope,
  t: z.literal("aiOffer"),
  waitedMs: z.number().int().nonnegative(),
});

export const zLobbyMatchFound = z.object({
  ...envelope,
  t: z.literal("matchFound"),
  matchId: z.string().min(1).max(64),
  seat: zSeat,
  opponentLeaderCardId: z.string().min(1).max(64),
});

export const zLobbyRejected = z.object({
  ...envelope,
  t: z.literal("queueRejected"),
  code: z.enum(["invalidDeck", "buildMismatch", "notAuthenticated", "alreadyQueued", "unavailable"]),
  message: z.string().max(512),
});

export const zLobbyPong = z.object({
  ...envelope,
  t: z.literal("lobbyPong"),
  clientTs: z.number().int().nonnegative(),
  serverTs: z.number().int().nonnegative(),
});

export const zLobbyServerEnvelope = z.discriminatedUnion("t", [
  zLobbyQueued,
  zLobbySearching,
  zLobbyAiOffer,
  zLobbyMatchFound,
  zLobbyRejected,
  zLobbyPong,
]);
export type LobbyServerEnvelope = z.infer<typeof zLobbyServerEnvelope>;

/** The lobby's half of `parseClientFrame`, with the same size-first discipline. */
export function parseLobbyFrame(
  raw: string
): { ok: true; frame: LobbyClientEnvelope } | { ok: false; code: "tooLarge" | "malformed" | "schema"; detail: string } {
  if (raw.length > WIRE_LIMITS.maxFrameBytes) {
    return { ok: false, code: "tooLarge", detail: `${raw.length} bytes` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code: "malformed", detail: error instanceof Error ? error.message : "unparseable" };
  }
  const result = zLobbyClientEnvelope.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, code: "schema", detail: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid" };
  }
  return { ok: true, frame: result.data };
}
