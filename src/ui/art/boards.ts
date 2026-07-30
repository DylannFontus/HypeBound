/**
 * Which backdrop a match is played against.
 *
 * **The opponent's faction, not yours.** A board is the place you have been
 * dragged to — their stage, their crypt, their boardroom — and picking by the
 * player's own faction would mean every match a Neon Idols player ever played
 * happened on the same stage. The opponent varies; the backdrop should too.
 *
 * A boss overrides everything, because a boss encounter is not a faction match
 * with a stronger deck in it.
 */

import { awaitAsset, getAsset } from "./assetLoader";
import { BOARD_EXTENSIONS, boardIds, boardPath } from "./iconAssets";

const DEFAULT_BOARD = "default";
const BOSS_BOARD = "boss";

/**
 * The board for an opponent, falling back until something exists.
 *
 * `faction → default → nothing`. Returning an id that has no file is fine and
 * expected: the loader answers null, the scene keeps the flat void, and the
 * match looks exactly as it does today. That chain is why the boards can ship
 * one at a time instead of all twelve at once.
 */
export function boardIdFor(opponentFactionId: string | undefined, isBoss = false): string {
  if (isBoss) return BOSS_BOARD;
  if (!opponentFactionId) return DEFAULT_BOARD;
  return boardIds().includes(opponentFactionId) ? opponentFactionId : DEFAULT_BOARD;
}

/**
 * The image to paint, or null.
 *
 * Tries the chosen board and then `default`, so a faction whose art has not
 * been made yet still gets *a* place rather than the void — the void is only
 * for a build with no boards at all.
 *
 * Hands back the `HTMLImageElement` rather than a url because the scene draws
 * it as a texture, and a texture needs decoded pixels. Returning a url would
 * make the caller load the same file a second time.
 */
export async function resolveBoardImage(
  opponentFactionId: string | undefined,
  isBoss = false
): Promise<HTMLImageElement | null> {
  const first = boardIdFor(opponentFactionId, isBoss);
  const chosen = await awaitAsset(boardPath(first), BOARD_EXTENSIONS);
  if (chosen) return chosen;
  if (first === DEFAULT_BOARD) return null;
  return await awaitAsset(boardPath(DEFAULT_BOARD), BOARD_EXTENSIONS);
}

/**
 * Start fetching a board before the match needs it.
 *
 * Called when a match is about to begin. A 4K backdrop takes a moment to
 * decode, and the alternative to warming it is the picture fading in a second
 * after the first card is dealt.
 */
export function preloadBoard(opponentFactionId: string | undefined, isBoss = false): void {
  getAsset(boardPath(boardIdFor(opponentFactionId, isBoss)), BOARD_EXTENSIONS);
  getAsset(boardPath(DEFAULT_BOARD), BOARD_EXTENSIONS);
}
