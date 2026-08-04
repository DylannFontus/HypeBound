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
 *
 * ## The longest wait in the game used to be a paragraph
 *
 * "Connecting…" set in body copy inside a static panel, with two thirds of the
 * screen empty near-black behind it: no loader, no motion, no world. §3 says
 * idle is never dead and §7 says loading is part of the world rather than a
 * spinner — and a sentence is worse than a spinner, because it does not even
 * move. Gwent keeps the leader animated on a lit plinth while you wait; Arena
 * runs the planeswalker idle and a slowly filling searchlight.
 *
 * What is here is a searchlight: an arc that sweeps the room on a fixed 4s
 * period. Fixed is the important word. A bar that fills would be a promise
 * about progress this screen cannot keep — the queue has no idea when somebody
 * will turn up — so the light says "still looking" for as long as that is true
 * and never implies it is getting closer. The number underneath it is the real
 * one, in tabular figures, and it usually says 1.
 *
 * ## A room with a subject and a sign, rather than a centred file
 *
 * Building the room fixed the dead screen and left a hollow one. Everything was
 * still one centred column — figure, sentence, count, offer, essay, each
 * narrower than the last — so at 1600×900 nothing at all occupied the outer
 * thirds and the 95th-percentile pixel measured 80 against the lobby's 155.
 * That is §6's value structure failing as arithmetic: squint and no light mass
 * resolves.
 *
 * The markup below is therefore two things standing in one place. `.queue-stage`
 * is the person, on the floor, lit from behind by a practical at the horizon so
 * her silhouette reads against something brighter than she is — which is what
 * actually stops a cropped painting looking pasted on, rather than another pass
 * of edge feathering. `.queue-call` is the sign on the wall beside her, and it
 * carries every word: the state, the wait, the count, the record, and the AI
 * offer, which now opens *inside* the board instead of arriving under it and
 * pushing the composition down the screen at the four-minute mark.
 */

import type { ContentIndex, DeckList, Seat } from "../../engine/types";
import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { accessToken, currentAccount } from "../../auth/account";
import { onlineAvailable, queueSocketUrl } from "../../config";
import { LobbySocket, type QueueStatus } from "../../net/lobbySocket";
import { browserSockets } from "../../net/wsTransport";
import { describeRecord, fetchMyRecord } from "../../net/playerRecord";
import { contentHash } from "../../engine/content";
import { paintLeaderPortrait, paintVenue } from "../art/leaderPortrait";
import { icon } from "../art/uiIcons";
import { duration, num } from "../format";

export interface QueueCallbacks {
  onBack: () => void;
  /** Signed out, or the session expired while waiting. */
  onNeedsSignIn: () => void;
  /** No legal deck selected — there is nothing to queue with. */
  onNeedsDeck: () => void;
  onMatchFound: (match: { matchId: string; seat: Seat; opponentLeaderCardId: string }) => void;
  /** §9.3's honest offer: the player chose the AI rather than keep waiting. */
  onPlayAi: () => void;
}

export function createQueueScreen(content: ContentIndex, deck: DeckList | null, callbacks: QueueCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen queue-screen";

  /** Whose face stands on the plinth: the leader of the deck being queued. */
  const leaderCard = deck ? content.leaders[deck.leaderCardId] : undefined;
  const leader = leaderCard?.type === "leader" ? leaderCard : undefined;

  root.innerHTML = `
    <div class="queue-world" aria-hidden="true">
      <div class="queue-room"></div>
      <div class="queue-backlight"></div>
      <div class="queue-floor"></div>
      <div class="queue-horizon"></div>
      <div class="queue-sweep"><span class="queue-beam"></span><span class="queue-beam queue-beam-b"></span></div>
      <div class="queue-haze"></div>
      <div class="queue-vignette"></div>
    </div>

    <header class="screen-header">
      <button class="btn btn-ghost queue-back" id="queue-back">${icon("arrow-left")}<span>Leave the queue</span></button>
      <h1 class="title">Casual Match</h1>
    </header>

    <main class="queue-body">
      <section class="queue-stage">
        <div class="queue-plinth" aria-hidden="true">
          <div class="queue-cast"></div>
          <div class="queue-leader"></div>
          <div class="queue-leader-lit"></div>
        </div>
      </section>

      <section class="queue-call mat-panel">
        <div class="queue-call-rail" aria-hidden="true"></div>

        <div class="queue-readout">
          <div class="t-label queue-call-head"><span class="queue-pip" aria-hidden="true"></span>Casual queue</div>
          <div class="queue-state t-display" id="queue-state" role="status" aria-live="polite">Connecting…</div>
          <div class="queue-detail" id="queue-detail"></div>
          <div class="queue-count" id="queue-count" hidden>
            <span class="num queue-count-value" style="--digits:2" id="queue-count-value">1</span>
            <span class="t-label" id="queue-count-label">in this queue</span>
          </div>
          <div class="queue-record t-label" id="queue-record" hidden></div>
        </div>

        <div class="queue-offer" id="queue-offer" hidden>
          <div class="hairline queue-offer-rule" aria-hidden="true"></div>
          <div class="t-label queue-offer-head">${icon("timer")} Four minutes, nobody here</div>
          <p class="queue-offer-text">
            You can keep waiting — if somebody joins, you will be matched with them —
            or play the AI instead.
          </p>
          <button class="queue-offer-btn mat-hero act" id="queue-play-ai" type="button">Play the AI instead</button>
        </div>
      </section>

      <aside class="queue-note mat-panel">
        <h3 class="t-label">${icon("eye")} What this number means</h3>
        <p>
          The count is the real number of people in this queue, including you. This game is
          new and usually that number is one. It is shown rather than hidden because a
          spinner that never resolves and an empty queue look identical, and only one of
          them is a bug.
        </p>
      </aside>
    </main>`;

  const stateEl = root.querySelector<HTMLElement>("#queue-state");
  const detailEl = root.querySelector<HTMLElement>("#queue-detail");
  const offerEl = root.querySelector<HTMLElement>("#queue-offer");
  const countEl = root.querySelector<HTMLElement>("#queue-count");
  const countValueEl = root.querySelector<HTMLElement>("#queue-count-value");
  const countLabelEl = root.querySelector<HTMLElement>("#queue-count-label");
  const light = root.querySelector<HTMLElement>(".queue-world");

  /**
   * The room, built before the light.
   *
   * The previous version was two rings, a hub sphere and two beams rotating over
   * a near-black field, with a comment on `.queue-stage::before` claiming to be
   * "the room the light is sweeping" and a render in which that room was
   * invisible. A beam with nothing to fall on is a diagram: it is the same
   * spinner §7 forbids, wearing a costume.
   *
   * So there is a floor with a horizon on it, haze standing in the air above it,
   * the venue at heavy blur behind, and the player's own leader standing on the
   * floor breathing. The beam sweeps *across the floor* on the same fixed 4s
   * period it always had — nothing here fills, ticks down or accelerates,
   * because the queue does not know when anybody will arrive — and as it passes
   * the leader, a rim light comes up on him and goes again. That single
   * secondary reaction is the whole difference between a widget and a place: the
   * light does something to something.
   */
  const roomHost = root.querySelector<HTMLElement>(".queue-room");
  if (roomHost) {
    roomHost.appendChild(
      paintVenue(leader?.faction ?? "default", {
        width: 1400,
        /**
         * Wide enough to be a room rather than a strip.
         *
         * It was 900×450 letterboxed into a rounded rectangle inset 17px from
         * each edge, and the measurable result was a queue where 66.6% of the
         * 16px blocks were both dark and flat and the 95th-percentile pixel sat
         * at 53.9 against the lobby's 157.9. The venue now fills the viewport
         * behind everything, so the light in the room is the light on the
         * screen.
         */
        aspect: 0.56,
        bias: 0.06,
        scrim: 0.22,
        dim: 0.12,
        className: "queue-room-art",
      })
    );
  }

  /**
   * Two copies of one plate, and the second one is what puts her in the room.
   *
   * Every leader painting is a *scene*: this one has a sunset window, a red
   * curtain and a monitor in it. Feathering the plate's four edges stops the
   * boundary being a razor line and does nothing at all about the fact that a
   * sharp, differently-lit room is sitting inside a blurred one — which is the
   * actual reason a crop reads as pasted on, and which four rounds of feathering
   * did not touch. Photographers do not solve this with a softer edge; they
   * solve it with depth of field.
   *
   * So the far copy is the whole plate under a blur, matched to the venue behind
   * it, and the near copy is the same plate sharp with an elliptical mask over
   * the figure. What survives at full resolution is a person; what surrounds her
   * is her own painting at the room's focal depth. The second call is a blit —
   * the options are identical, so it hits the memoised plate.
   */
  const leaderHost = root.querySelector<HTMLElement>(".queue-leader");
  if (leaderHost && leader) {
    for (const layer of ["queue-leader-far", "queue-leader-near"]) {
      leaderHost.appendChild(
        paintLeaderPortrait(leader, {
          /**
           * Wider, because she is half the composition now rather than an item
           * in a centred stack. Given a column of her own the plinth is 348px
           * across at 1600×900 and the plate is drawn a little over it, so the
           * figure is resampled down rather than up on a 1× display. It costs
           * 0.9ms — measured — because the mip and the plate are both memoised.
           */
          width: 560,
          /**
           * Taller, and the crop starts above the head rather than through it.
           *
           * At 1.42 the frame began at her chest and the missing `fadeTop`
           * turned the start of the frame into a horizontal line across her —
           * +64 luminance in a single pixel at 1600×900, +148 in two at
           * 1280×720. The aspect is now tall enough for the whole figure and the
           * bias small enough that the ramp lands in empty air above her.
           */
          aspect: 1.78,
          bias: 0.03,
          scrim: 0.3,
          // Cut on all four sides. A figure standing in a room has no frame; a
          // rectangle in the middle of a floor is a poster somebody left there.
          fadeTop: 0.24,
          fadeLeft: 0.26,
          fadeRight: 0.26,
          fadeBottom: 0.05,
          // ...and she leaves a mark on the floor she is standing on.
          reflect: 0.12,
          className: `queue-leader-art ${layer}`,
        })
      );
    }
    root.classList.add("has-leader");
  }

  const say = (state: string, detail = ""): void => {
    if (stateEl) stateEl.textContent = state;
    if (detailEl) detailEl.textContent = detail;
  };

  /**
   * The number, on its own, big and tabular.
   *
   * It is separated from the sentence because it is the one thing on the screen
   * a player is actually reading, and because a figure that reflows the line
   * when it goes from 9 to 10 is the defect §4 names. The sentence beside it
   * still carries the honesty ("just you"); the figure carries the fact.
   */
  const showCount = (waiting: number): void => {
    if (!countEl || !countValueEl || !countLabelEl) return;
    countValueEl.textContent = num(waiting);
    countLabelEl.textContent = waiting === 1 ? "in this queue — just you" : "in this queue";
    countEl.hidden = false;
  };

  /** The light stops sweeping the moment there is nothing left to look for. */
  const settle = (state: "searching" | "found" | "stopped"): void => {
    light?.setAttribute("data-state", state);
  };

  let lobby: LobbySocket | null = null;
  let disposed = false;

  /**
   * Your record, from the server that adjudicated it.
   *
   * Fetched here rather than at boot: the privacy page's claim is that the game
   * makes no network request until asked, and joining a queue is asking. Shown
   * only when there is something to show — a player with no matches is told
   * nothing rather than told `0-0`, which reads like an answer.
   */
  void fetchMyRecord().then((record) => {
    if (disposed) return;
    const line = describeRecord(record);
    const el = root.querySelector<HTMLElement>("#queue-record");
    if (!el || !line) return;
    el.textContent = `Your online record: ${line}`;
    el.hidden = false;
  });

  const start = async (): Promise<void> => {
    if (!onlineAvailable()) {
      settle("stopped");
      return say("This build has no server configured.", "There is nothing to connect to from here.");
    }
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
        onQueued: (_ticketId, waiting) => {
          settle("searching");
          showCount(waiting);
          say("Looking for an opponent…", describe(0));
        },
        onSearching: (status) => {
          settle("searching");
          showCount(status.waiting);
          say("Looking for an opponent…", describeStatus(status));
        },
        onAiOffer: () => {
          offerEl?.removeAttribute("hidden");
          // Announced, not just revealed: a player on a screen reader has been
          // listening to a live region say "looking" for four minutes.
          say("Still looking — nobody else is queuing", "You are still in the queue while you decide.");
          root.querySelector<HTMLButtonElement>("#queue-play-ai")?.focus();
        },
        onMatchFound: (found) => {
          audio.play("sfx.ui.confirm");
          settle("found");
          say("Match found", "Loading the board…");
          callbacks.onMatchFound({
            matchId: found.matchId,
            seat: found.seat,
            opponentLeaderCardId: found.opponentLeaderCardId,
          });
        },
        onRejected: (rejection) => {
          settle("stopped");
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
          settle("stopped");
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
    settle("stopped");
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

/**
 * The line under the number.
 *
 * The count itself moved out of this string and onto the stage, so what is left
 * is the wait and the rule — and the rule is worth printing. §9.3 widens the
 * rating band as the wait grows, and saying so is more honest than a bar that
 * fills: it is the actual thing the server is doing while nothing appears to
 * happen.
 */
function describe(waitedMs: number): string {
  if (waitedMs < 1000) return "The queue widens the longer you wait.";
  return `Waiting ${duration(waitedMs, { units: 2 })}.`;
}

function describeStatus(status: QueueStatus): string {
  const base = describe(status.waitedMs);
  return status.band >= 400 ? `${base} Matching anyone now.` : base;
}
