import type { MatchRoom } from "./matchRoom";
import type { CasualQueue } from "./casualQueue";
import type { PlayerRecord } from "./playerRecord";

/**
 * The bindings declared in `wrangler.toml`, plus the secrets that are not.
 *
 * `SUPABASE_URL` and `ALLOWED_ORIGINS` are plain vars because neither is
 * secret — the first is in the client bundle already and the second is a list of
 * origins anyone can observe by connecting. `ADMIN_TOKEN` is a real secret and
 * is deliberately **not** in `wrangler.toml`: it is set with `wrangler secret
 * put ADMIN_TOKEN`, and locally in `.dev.vars`, which is gitignored.
 */
export interface Env {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  CASUAL_QUEUE: DurableObjectNamespace<CasualQueue>;
  /** One per account, holding results the server adjudicated. */
  PLAYER_RECORD: DurableObjectNamespace<PlayerRecord>;
  /** Supabase project URL, e.g. `https://abcdefgh.supabase.co`. Empty means no identity provider. */
  SUPABASE_URL: string;
  /** Comma-separated browser origins allowed to open a socket. */
  ALLOWED_ORIGINS: string;
  /** Commit sha of the deployed build (§10.4). CI sets it; `dev` locally. */
  BUILD?: string;
  /** Guards the internal match-creation route until the matchmaker exists to own it. */
  ADMIN_TOKEN?: string;
}
