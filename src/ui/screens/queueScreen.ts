/**
 * The casual queue, told truthfully.
 *
 * §9.3's last row says casual should offer *"Play the AI instead* (never a fake
 * human)" after four minutes. At this game's population that is not a fallback
 * for an unlucky player — it is the expected outcome of most attempts to queue,
 * and this screen is built around that being true rather than around hiding it.
 *
 * So there is no indeterminate spinner. There is a number, and the number is
 * real: `waiting` is how many people are actually in this queue, including you.
 * When it says **1**, you are the only person here, and saying so is the
 * difference between a game that is quiet and a game that looks broken. A
 * spinner cannot tell those apart, which is precisely why it is the wrong
 * component.
 *
 * The AI offer is a button that appears, not a redirect. §9.3 says *offer*, and
 * the player stays in the queue while it is on screen — if somebody joins while
 * they are reading it, they get the human match they asked for.
 */

import type { ContentIndex, DeckList, Seat } from "../../engine/types";
import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { accessToken, currentAccount } from "../../auth/account";
import { onlineAvailable, queueSocketUrl } from "../../config";
import { LobbySocket, type QueueStatus } from "../../net/lobbySocket";
import { browserSockets } from "../../net/wsTransport";
import { contentHash } from "../../engine/content";

export interface QueueCallbacks {
  onBack: () => void;
  /** Signed out, or the session expired while waiting. */
  onNeedsSignIn: () => void;
  /** No legal deck selected — there is nothing to queue with. */
  onNeedsDeck: () => void;
  onMatchFound: (match: { matchId: string; seat: Seat }) => void;
  /** §9.3's honest offer: the player chose the AI rather than keep waiting. */
  onPlayAi: () => void;
}

export function createQueueScreen(content: ContentIndex, deck: DeckList | null, callbacks: QueueCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen queue-screen";

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="queue-back">← Leave the queue</button>
      <h1 class="title">Casual Match</h1>
    </header>

    <main class="queue-body">
      <section class="panel panel-chrome queue-panel">
        <div class="queue-state" id="queue-state" role="status" aria-live="polite">Connecting…</div>
        <div class="queue-detail muted" id="queue-detail"></div>

        <div class="queue-offer" id="queue-offer" hidden>
          <p class="queue-offer-text">
            Nobody has turned up in four minutes. You can keep waiting — if somebody joins,
            you will be matched with them — or play the AI instead.
          </p>
          <button class="btn btn-primary" id="queue-play-ai" type="button">Play the AI instead</button>
        </div>
      </section>

      <section class="panel panel-chrome queue-note">
        <h3 class="profile-section-title">What this number means</h3>
        <p class="muted">
          The count is the real number of people in this queue, including you. This game is
          new and usually that number is one. It is shown rather than hidden because a
          spinner that never resolves and an empty queue look identical, and only one of
          them is a bug.
        </p>
      </section>
    </main>`;

  const stateEl = root.querySelector<HTMLElement>("#queue-state");
  const detailEl = root.querySelector<HTMLElement>("#queue-detail");
  const offerEl = root.querySelector<HTMLElement>("#queue-offer");

  const say = (state: string, detail = ""): void => {
    if (stateEl) stateEl.textContent = state;
    if (detailEl) detailEl.textContent = detail;
  };

  let lobby: LobbySocket | null = null;
  let disposed = false;

  const start = async (): Promise<void> => {
    if (!onlineAvailable()) return say("This build has no server configured.", "Nothing to connect to.");
    if (!currentAccount()) return callbacks.onNeedsSignIn();
    if (!deck) return callbacks.onNeedsDeck();

    const token = await accessToken();
    if (disposed) return;
    if (!token) {
      // The session expired or the refresh token was spent. Sending them to
      // sign in again is the only thing that helps, and it is better than a
      // socket that closes with a 401 they cannot interpret.
      return callbacks.onNeedsSignIn();
    }

    lobby = new LobbySocket({
      url: queueSocketUrl(token),
      connect: browserSockets(),
      build: "dev",
      contentHash: contentHash(content),
      handlers: {
        onQueued: (_ticketId, waiting) => say("Looking for an opponent…", describe(waiting, 0)),
        onSearching: (status) => say("Looking for an opponent…", describeStatus(status)),
        onAiOffer: () => {
          offerEl?.removeAttribute("hidden");
          // Announced, not just revealed: a player on a screen reader has been
          // listening to a live region say "looking" for four minutes.
          say("Still looking — nobody else is queuing", "You are still in the queue while you decide.");
          root.querySelector<HTMLButtonElement>("#queue-play-ai")?.focus();
        },
        onMatchFound: (found) => {
          audio.play("sfx.ui.confirm");
          say("Match found", "Loading the board…");
          callbacks.onMatchFound({ matchId: found.matchId, seat: found.seat });
        },
        onRejected: (rejection) => {
          if (rejection.code === "buildMismatch") {
            return say("This tab is running an older version", "Reload the page and try again.");
          }
          if (rejection.code === "invalidDeck") {
            return say("That deck cannot be queued", rejection.message);
          }
          say("The queue refused the request", rejection.message);
        },
        onClosed: (reason) => {
          if (disposed) return;
          say("Disconnected from the queue", reason);
        },
      },
    });

    lobby.enqueue(deck);
  };

  root.querySelector("#queue-play-ai")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    lobby?.dequeue();
    callbacks.onPlayAi();
  });

  root.querySelector("#queue-back")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onBack();
  });

  void start().catch((error: unknown) => {
    say("Could not join the queue", error instanceof Error ? error.message : String(error));
  });

  return {
    root,
    dispose: () => {
      disposed = true;
      /**
       * Leaving tells the server, rather than waiting for the socket to drop.
       *
       * The ticket goes immediately, and so does the deck the server was
       * holding to validate — otherwise a player who backs out leaves a
       * decklist in storage for a pairing that will never happen.
       */
      lobby?.dequeue();
      lobby = null;
    },
  };
}

/** "1 player searching" — with the singular, because it will usually be one. */
function describe(waiting: number, waitedMs: number): string {
  const people = waiting === 1 ? "1 player searching (just you)" : `${waiting} players searching`;
  if (waitedMs < 1000) return people;
  return `${people} · ${Math.round(waitedMs / 1000)}s`;
}

function describeStatus(status: QueueStatus): string {
  const base = describe(status.waiting, status.waitedMs);
  // §9.3 widens the rating band as the wait grows. Saying so is more honest
  // than a bar that fills: it is the actual rule the server is applying.
  return status.band >= 400 ? `${base} · matching anyone` : base;
}
