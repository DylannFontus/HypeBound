/**
 * Application entry point.
 *
 * Loads and validates content, applies settings, wires the screen router, and
 * mounts the lobby. Any content-validation failure is shown as a readable
 * report rather than a blank page — with data-driven cards, a typo in a JSON
 * file is the most likely startup failure and it should say exactly what broke.
 */

import "./ui/theme/base.css";
import "./ui/theme/screens.css";
import "./ui/theme/battle.css";

import { ContentError, getContent, selectableLeaders } from "./engine/content";
import { getEncounters } from "./engine/encounters";
import { applySettings } from "./save/settings";
import {
  claimOnce,
  getProfile,
  grantTutorialCompletion,
  grantTutorialReward,
  completeDailyPuzzle,
  needsStarterChoice,
  todaysPuzzleIndex,
  playableDeck,
  recordRemixWin,
  recordMatch,
  recordTourWin,
  activeDeck,
} from "./save/profile";
import { loanerDeckFor, tourOpponentDeck } from "./game/progression/grandTour";
import { tutorialConfig } from "./game/progression/data";
import { autoBuildDeck } from "./engine/deck";
import { Shell, watchOrientation } from "./ui/shell";
import { mountAtmosphere } from "./ui/atmosphere";
import { startIntro } from "./ui/intro";
import { createLobbyScreen } from "./ui/screens/lobbyScreen";
import { createPlayScreen } from "./ui/screens/playScreen";
import { createShopScreen } from "./ui/screens/shopScreen";
import { createStarterScreen } from "./ui/screens/starterScreen";
import { createCollectionScreen } from "./ui/screens/collectionScreen";
import { createDeckBuilderScreen } from "./ui/screens/deckBuilderScreen";
import { createDeckSlotsScreen } from "./ui/screens/deckSlotsScreen";
import { createSignInScreen } from "./ui/screens/signInScreen";
import { createQueueScreen } from "./ui/screens/queueScreen";
import { createCloudSaveScreen } from "./ui/screens/cloudSaveScreen";
import { installIconStyles } from "./ui/art/iconAssets";
import { planSync, startAutoSync, syncNow } from "./save/cloudSaves";
import { SaveClient } from "./net/saveClient";
import { accessToken, currentAccount } from "./auth/account";
import { matchSocketUrl } from "./config";
import { WsTransport, browserSockets } from "./net/wsTransport";
import { contentHash } from "./engine/content";
import { createEventsScreen } from "./ui/screens/eventsScreen";
import { createRemixScreen } from "./ui/screens/remixScreen";
import { createCustomScreen } from "./ui/screens/customScreen";
import { customMatchConfig, paysRewards, type CustomSettings } from "./game/custom";
import { REMIX_MODE, modifierById, remixMatchConfig } from "./game/remix";
import { createSettingsScreen } from "./ui/screens/settingsScreen";
import { createReplayScreen } from "./ui/screens/replayScreen";
import { createLabScreen } from "./ui/screens/labScreen";
import { createDoomscrollScreen } from "./ui/screens/doomscrollScreen";
import { createStoryScreen } from "./ui/screens/storyScreen";
import { createSceneScreen } from "./ui/screens/sceneScreen";
import { getStory } from "./game/story/chapters";
import { storyMatchSetup } from "./game/story/battle";
import { pendingBattle, recordStoryLoss, setPendingBattle } from "./save/storySave";
import type { StoryChapter, StoryEpisode } from "./game/story/types";
import { getRoguelikeData } from "./game/doomscroll/data";
import { battleFor, resolveBattle, startFight } from "./game/doomscroll/run";
import { activeRun, saveRun } from "./save/doomscrollSave";
import { createGauntletScreen } from "./ui/screens/gauntletScreen";
import { botDeck, deckListFor, enterFight, resolveFight } from "./game/gauntlet";
import { activeGauntlet, saveGauntlet } from "./save/gauntletSave";
import { BOSS_TIERS, bossById, bossMatchConfig, clearKey, tierById } from "./game/weeklyBoss";
import { BattleScreen } from "./ui/screens/battleScreen";
import { renderCardToCanvas, setRulesLens } from "./ui/cardRenderer/renderCard";
import { renderLeaderToCanvas } from "./ui/cardRenderer/renderLeader";
import { getCardArt } from "./ui/art/artLoader";
import { createGrandTourScreen } from "./ui/screens/grandTourScreen";
import { createMissionsScreen } from "./ui/screens/missionsScreen";
import { createMasteryScreen } from "./ui/screens/masteryScreen";
import { createProfileScreen } from "./ui/screens/profileScreen";
import { createAchievementsScreen } from "./ui/screens/achievementsScreen";
import { createStatsScreen } from "./ui/screens/statsScreen";
import { createGalleryScreen } from "./ui/screens/galleryScreen";
import { createLeaderboardsScreen } from "./ui/screens/leaderboardsScreen";
import { createHypeWaveScreen } from "./ui/screens/hypeWaveScreen";
import { createBannerScreen } from "./ui/screens/bannerScreen";
import { createInboxScreen } from "./ui/screens/inboxScreen";
import { createNewsScreen } from "./ui/screens/newsScreen";
import { createPatchNotesScreen } from "./ui/screens/patchNotesScreen";
import { createFairnessScreen } from "./ui/screens/fairnessScreen";
import { createPrivacyScreen } from "./ui/screens/privacyScreen";
import { createLegalScreen } from "./ui/screens/legalScreen";
import { createSupportScreen } from "./ui/screens/supportScreen";
import { createA11yScreen } from "./ui/screens/a11yScreen";
import type { AiDifficulty, ContentIndex, DeckList, FactionId } from "./engine/types";

/** Clout per tutorial stage, per docs/design/09-game-modes.md section 2.3. */
const TUTORIAL_CLOUT_PER_STAGE = 100;

/**
 * The unsaved draft handed over by the deck builder's "Test vs AI".
 *
 * In memory rather than in a slot, because the point is trying a list you have
 * not committed to — writing it to storage first would overwrite the deck being
 * experimented on.
 */
let testDeck: DeckList | null = null;

/**
 * The Custom Lobby's chosen settings, handed to the battle route in memory.
 *
 * Same reasoning as `testDeck`: a dozen fields including a ban list do not
 * belong in a query string, and a query string is editable past the ranges the
 * lobby enforces.
 */
let customSettings: { settings: CustomSettings; deckIndex: number } | null = null;

/** Clout for a story episode's first clear. Every branch pays the same. */
const STORY_CLOUT_PER_EPISODE = 75;

/** The chapter and episode a story route is pointing at, if they still exist. */
function findEpisode(
  content: ContentIndex,
  chapterId: string | null,
  episodeId: string | null
): { chapter: StoryChapter; episode: StoryEpisode } | null {
  if (!chapterId || !episodeId) return null;
  const chapter = getStory(content).chapters.find((entry) => entry.id === chapterId);
  const episode = chapter?.episodes.find((entry) => entry.id === episodeId);
  return chapter && episode ? { chapter, episode } : null;
}

function showFatalError(error: unknown): void {
  const host = document.getElementById("app");
  if (!host) return;
  const problems = error instanceof ContentError ? error.problems : [String(error)];

  host.innerHTML = `
    <div class="screen error-screen">
      <div class="ambient-bg"></div>
      <div class="panel panel-chrome error-panel">
        <div class="eyebrow">Content validation failed</div>
        <h2 class="title">Your card data has ${problems.length} problem${problems.length === 1 ? "" : "s"}</h2>
        <p class="muted">Fix these in <code>data/</code> and the page will reload automatically.</p>
        <ul class="error-list scroll">${problems.map((p) => `<li>${p}</li>`).join("")}</ul>
      </div>
    </div>`;
}

/**
 * Take down the boot plate, whatever else happened.
 *
 * `index.html` opens with `<html class="hb-boot">` and a full-bleed
 * `#hb-boot-plate` at `z-index: 1`, so the first paint is a composed dark field
 * with the wordmark on it rather than a flash of unstyled void. Its own comment
 * says "main.ts drops the class" — and main.ts never did. The only code that
 * cleared it lived on the opening cinematic's completion path.
 *
 * That is fine exactly when the cinematic plays and catastrophic when it does
 * not, and `src/ui/intro/index.ts` lists four reasons it legitimately might not:
 * a deep link to anything that is not the front door, `?nointro`, a browser
 * with no WebGL, and a missing brand asset. In every one of those the plate
 * stayed up forever, covering a game that had booted perfectly well underneath
 * it. Reloading into `#collection` showed a wordmark and nothing else.
 *
 * So the teardown belongs here, on the one path that always runs, rather than
 * inside the feature that is allowed to opt out. `finally` because a screen that
 * fails to mount still has to reveal the error it wants to show, and a plate
 * over a stack trace is worse than either alone.
 */
function clearBootPlate(): void {
  document.documentElement.classList.remove("hb-boot");
  // The CSS transitions opacity for 420ms and then this removes the node, so a
  // late-arriving layer cannot end up stacked underneath a spent cover.
  window.setTimeout(() => document.getElementById("hb-boot-plate")?.remove(), 600);
}

function boot(): void {
  applySettings();
  watchOrientation();
  /**
   * The world goes up before anything else does.
   *
   * It is mounted outside `#app`, so it is the one layer no screen and no
   * navigation can ever take away — which is what lets the transitions in
   * `transitions.css` fade an outgoing screen all the way to zero without
   * anybody having to prove the incoming one has already covered the hole.
   *
   * Before the content check rather than after it, deliberately: a validation
   * failure is the one screen a player might sit and read for a while, and it
   * should be a room with the lights on rather than a slab on black. The call
   * is idempotent, so the Shell asking for it again below costs nothing.
   */
  mountAtmosphere();
  /**
   * Probe the interface icons. Fire-and-forget: each one that exists exposes
   * itself to CSS, each one that does not leaves the glyph in place, and
   * nothing waits for either outcome.
   */
  installIconStyles();

  /**
   * The opening cinematic, over the top of everything below.
   *
   * Started here — after the world exists and before a single line of content is
   * parsed — for two reasons. It is the earliest point at which the layer can go
   * up, which matters because the alternative to covering the boot is showing
   * the player half of it; and it is *before* the content check, so the two
   * competing failure modes cannot collide. A content-validation failure needs
   * to be readable, and `playIntro` ends the moment the route changes or the
   * player touches anything, so the report is one keypress away rather than
   * behind a five-second title.
   *
   * Nothing here is awaited and nothing below depends on it. `startIntro`
   * decides for itself whether this launch gets the long title, the short sting
   * or neither — a deep link, a `?nointro`, a browser with no WebGL and a
   * missing brand asset all resolve to "neither", and in every one of those
   * cases the boot underneath is bit-for-bit the boot that already existed.
   */
  startIntro();

  let content: ContentIndex;
  try {
    content = getContent();
  } catch (error) {
    console.error(error);
    showFatalError(error);
    return;
  }


  /**
   * The Rules Lens needs the keyword table, and this is the one place that has
   * both the content index and a guarantee of running before anything renders.
   */
  setRulesLens(
    false,
    Object.fromEntries(Object.values(content.keywords).map((keyword) => [keyword.id, keyword.reminderText]))
  );
  applySettings();

  const host = document.getElementById("app");
  if (!host) throw new Error("#app host element is missing");

  const shell = new Shell(host).setFallback("lobby");

  /**
   * A brand-new account has no cards at all until it picks a starting faction,
   * so the picker is a route rather than a modal: every other screen assumes a
   * collection exists, and a player who lands on the deck builder first would
   * find an empty one. Existing saves already hold a collection and never see it.
   */
  shell.register("starter", () =>
    createStarterScreen(content, {
      onChosen: () => shell.navigate("lobby"),
    })
  );

  shell.register("missions", () =>
    createMissionsScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onPlay: () => shell.navigate("play"),
      onOpenShop: () => shell.navigate("shop"),
      /**
       * 09 §11's two bonus dailies. Both hand off to the mode that already owns
       * them rather than opening a copy of it — the Daily Puzzle *is* a Puzzle
       * Rush scenario, and the Daily Doomscroll *is* a run on a chosen seed.
       */
      onDailyPuzzle: () => {
        const puzzles = getEncounters(new Set(Object.keys(content.cards)))["puzzles"];
        shell.navigate("puzzle", {
          n: String(todaysPuzzleIndex(puzzles?.stages.length ?? 0) + 1),
          try: "1",
        });
      },
      onDailyDoomscroll: () => shell.navigate("doomscroll"),
    })
  );

  shell.register("mastery", () =>
    createMasteryScreen(content, {
      onBack: () => shell.navigate("lobby"),
    })
  );

  shell.register("profile", () =>
    createProfileScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onMastery: () => shell.navigate("mastery"),
      onCollection: () => shell.navigate("collection"),
      onAchievements: () => shell.navigate("achievements"),
      onHistory: () => shell.navigate("replays"),
      onStats: () => shell.navigate("stats"),
      onGallery: () => shell.navigate("gallery"),
      onLeaderboards: () => shell.navigate("leaderboards"),
    })
  );

  shell.register("pass", () =>
    createHypeWaveScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onMissions: () => shell.navigate("missions"),
      onShop: () => shell.navigate("shop"),
    })
  );

  shell.register("banner", () =>
    createBannerScreen(content, {
      onBack: () => shell.navigate("shop"),
      onCollection: () => shell.navigate("collection"),
      onFairness: () => shell.navigate("fairness"),
    })
  );

  /**
   * The Inbox. Its messages carry a route rather than a callback, so a message
   * about the pass opens the pass — one link type, resolved here, instead of a
   * callback per sender that the next sender would have to add to.
   */
  shell.register("inbox", () =>
    createInboxScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onOpen: (screen, param) => shell.navigate(screen, param ? { a: param } : {}),
    })
  );

  /**
   * News and patch notes. `#news?a=<id>` opens straight to one article, which is
   * what an inbox announcement and the lobby's card both link to.
   */
  shell.register("news", (params) =>
    createNewsScreen(
      content,
      {
        onBack: () => shell.navigate("lobby"),
        onOpen: (screen) => shell.navigate(screen),
        onPatchNotes: () => shell.navigate("patchnotes"),
      },
      { ...(params.get("a") ? { articleId: params.get("a")! } : {}) }
    )
  );

  shell.register("patchnotes", () =>
    createPatchNotesScreen(content, {
      onBack: () => shell.navigate("news"),
      onCollection: () => shell.navigate("collection"),
    })
  );

  shell.register("achievements", () =>
    createAchievementsScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onProfile: () => shell.navigate("profile"),
    })
  );

  shell.register("lobby", () =>
    createLobbyScreen(content, {
      onMastery: () => shell.navigate("mastery"),
      onAchievements: () => shell.navigate("achievements"),
      onPass: () => shell.navigate("pass"),
      onInbox: () => shell.navigate("inbox"),
      onEvents: () => shell.navigate("events"),
      onNews: (articleId) => shell.navigate("news", articleId ? { a: articleId } : {}),
      onMissions: () => shell.navigate("missions"),
      onPlay: () => shell.navigate("play"),
      onCollection: () => shell.navigate("collection"),
      onDeckBuilder: () => shell.navigate("decks"),
      onShop: () => shell.navigate("shop"),
      onSettings: () => shell.navigate("settings"),
      onProfile: () => shell.navigate("profile"),
    })
  );

  shell.register("play", () =>
    createPlayScreen(content, {
      onStartAiMatch: (difficulty) => shell.navigate("battle", { difficulty }),
      onStartTutorial: () => shell.navigate("tutorial"),
      onStartPuzzles: () => shell.navigate("puzzle", { n: "1", try: "1" }),
      onStartTour: () => shell.navigate("tour"),
      onOpenReplays: () => shell.navigate("replays"),
      onOpenLab: () => shell.navigate("lab"),
      onStartDoomscroll: () => shell.navigate("doomscroll"),
      onStartGauntlet: () => shell.navigate("gauntlet"),
      onStartRemix: () => shell.navigate("remixhub"),
      onStartCustom: () => shell.navigate("custom"),
      onStartStory: () => shell.navigate("story"),
      onStartBoss: (tier) => shell.navigate("boss", { tier }),
      onBack: () => shell.navigate("lobby"),
      onDeckBuilder: () => shell.navigate("decks"),
      onStartCasual: () => shell.navigate(currentAccount() ? "queue" : "signin"),
    })
  );

  /**
   * Sign-in and the casual queue.
   *
   * Both exist only because the service behind them does — architecture
   * contract §7. `config.ts` is the switch: blank its `serverUrl` and the
   * casual tile goes back to being an explainer, and these routes become
   * unreachable rather than broken.
   */
  shell.register("signin", () =>
    // `content` so the screen can stand the player's own leader on its stage —
    // the same portrait the lobby and the queue show, rather than a form
    // floating in a void.
    createSignInScreen(content, {
      onBack: () => shell.navigate("play"),
      onSignedIn: () => void afterSignIn(),
    })
  );

  /**
   * Where signing in leads.
   *
   * Usually straight to the queue — signing in is not a destination, it is the
   * thing that was in the way of the one the player asked for. The exception is
   * a save that cannot be reconciled without a person, and that exception has
   * to be checked *before* navigating, because the alternative is a queue
   * screen that silently replaces a collection while somebody waits for a
   * match.
   *
   * A failure to reach the save service is not a reason to block sign-in. The
   * player wanted to play someone; the sync will be retried on the next boot.
   */
  async function afterSignIn(): Promise<void> {
    const account = currentAccount();
    if (!account) {
      shell.navigate("play");
      return;
    }

    const plan = await planSync(new SaveClient(), account.userId);
    if (!("error" in plan) && (plan.needsChoice || plan.conflicts.length > 0)) {
      shell.navigate("cloudsave");
      return;
    }

    void syncNow();
    startAutoSync();
    shell.navigate("queue");
  }

  shell.register("cloudsave", () =>
    createCloudSaveScreen({
      onBack: () => shell.navigate("play"),
      onResolved: () => {
        startAutoSync();
        shell.navigate("queue");
      },
    })
  );

  shell.register("queue", () =>
    createQueueScreen(content, activeDeck(), {
      onBack: () => shell.navigate("play"),
      onNeedsSignIn: () => shell.navigate("signin"),
      onNeedsDeck: () => shell.navigate("decks"),
      onPlayAi: () => shell.navigate("play"),
      onMatchFound: ({ matchId, seat, opponentLeaderCardId }) =>
        shell.navigate("online", { match: matchId, seat: String(seat), opp: opponentLeaderCardId }),
    })
  );

  /**
   * An online match: the same battle screen, a different authority.
   *
   * Async because the socket URL carries a freshly refreshed access token, and
   * `ScreenFactory` allows a promise for exactly this. The known cost is
   * `shell.ts`'s `navigating` guard, which drops a hashchange arriving during
   * the await — a second navigation in the ~50 ms this takes.
   */
  shell.register("online", async (params) => {
    const matchId = params.get("match") ?? "";
    const token = await accessToken();
    if (!matchId || !token) {
      shell.navigate(token ? "play" : "signin");
      return { root: document.createElement("div") };
    }

    const deck = activeDeck() ?? playableDeck(content, selectableLeaders(content)[0]?.id ?? "");
    const screen: BattleScreen = new BattleScreen({
      content,
      playerDeck: deck,
      transport: new WsTransport({
        url: matchSocketUrl(matchId, token),
        content,
        connect: browserSockets(),
        contentHash: contentHash(content),
      }),
      endActions: { primary: "Queue again", secondary: "Back to modes" },
      /**
       * The match pays, and the two halves of "pays" go to different places.
       *
       * The **authoritative** result — who won, against which leader, why — is
       * written by the server into the account's own Durable Object, because a
       * client that reports its own wins reports wins it did not have. That has
       * already happened by the time this runs; nothing here can affect it.
       *
       * The **local** rewards are Clout and XP in the on-device save, exactly
       * as an offline match pays them. That is not a new integrity hole: the
       * save is the player's own file and always has been, so a player editing
       * their own Clout is cheating nobody. What must not be client-authored is
       * the *record*, and it is not.
       *
       * `record` is null, so there is no replay to watch afterwards and no
       * per-match statistics — a client cannot reconstruct a game it did not
       * simulate. The history entry says the match happened and what it paid.
       */
      onSettle: (result) =>
        recordMatch(null, result.winner === "player" ? "win" : result.winner === "ai" ? "loss" : "draw", {
          deckName: deck.name,
          leaderCardId: deck.leaderCardId,
          // The opponent's leader is on the board, so it is read from the view
          // rather than guessed — this is the one fact about them a seat has.
          opponentLeaderCardId: params.get("opp") ?? "unknown",
          mode: "casual-online",
          content,
          ...(deck.editedAt !== undefined ? { deckEditedAt: deck.editedAt } : {}),
        }),
      onExit: (result) => shell.navigate(result.action === "again" ? "queue" : "play"),
    });
    return { root: screen.root, dispose: () => screen.dispose() };
  });

  shell.register("collection", () =>
    createCollectionScreen(content, {
      onBack: () => shell.navigate("lobby"),
    })
  );

  shell.register("shop", () =>
    createShopScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onOpenCollection: () => shell.navigate("collection"),
      onOpenBanner: () => shell.navigate("banner"),
      onOpenFairness: () => shell.navigate("fairness"),
    })
  );

  /**
   * The Grand Tour. The screen only picks the faction and the opponent; the
   * match it starts is the ordinary `#battle` route carrying `?tour=`, so a
   * loaner match is a practice match in every way the design says it is.
   */
  shell.register("tour", () =>
    createGrandTourScreen(content, {
      onBack: () => shell.navigate("play"),
      onPlayLoaner: (factionId, difficulty) => shell.navigate("battle", { tour: factionId, difficulty }),
      onOpenCollection: () => shell.navigate("collection"),
      onOpenShop: () => shell.navigate("shop"),
    })
  );

  /**
   * §4.3.2 names two hashes, and this is the first: the twelve save slots.
   * Until now the game had no way to see a second deck, let alone switch to it.
   */
  shell.register("decks", () =>
    createDeckSlotsScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onEdit: (index) => shell.navigate("deckbuilder", { deck: String(index) }),
      // a new deck is the first index past the end, which the builder treats as
      // an empty slot rather than an edit
      onNew: () => shell.navigate("deckbuilder", { deck: String(getProfile().decks.length) }),
    })
  );


  /**
   * The Event Hub — 03 §4.4.3, `#/events`.
   *
   * `onPlayMode` hands a featured mode id to mode select rather than routing it
   * here: an event points *at* modes, it does not own them, and a second copy of
   * "how does a boss match start" is the duplicate-rule bug this codebase keeps
   * finding the hard way.
   */
  shell.register("events", () =>
    createEventsScreen({
      onBack: () => shell.navigate("lobby"),
      onPlayMode: (modeId) => shell.navigate("play", modeId ? { mode: modeId } : {}),
    })
  );


  /**
   * The Remix Queue — 09 §12, "This Week's Meta".
   *
   * An ordinary constructed match against the AI, with one difference: the
   * week's rule is assembled into the config by `remixMatchConfig` and applied
   * to **both** leaders. Nothing about the battle screen knows what a Remix
   * match is, which is the point — the modifier is balance numbers and a leader
   * passive, both of which it already understood.
   */
  shell.register("remix", (params) => {
    const now = Date.now();
    // `?rule=<id>` reaches a specific modifier; without it, this week's
    const modifier = modifierById(params.get("rule"), now);
    const pickable = selectableLeaders(content);
    const playerDeck = playableDeck(content, pickable[0]?.id ?? "");

    const aiLeaderId =
      pickable.map((leader) => leader.id).find((id) => id !== playerDeck.leaderCardId) ??
      playerDeck.leaderCardId;
    const aiDeck = autoBuildDeck(content, aiLeaderId, "Remix Rival");

    const config = remixMatchConfig(content, modifier, [playerDeck.leaderCardId, aiDeck.leaderCardId]);

    const screen = new BattleScreen({
      content,
      playerDeck,
      aiDeck,
      difficulty: "intermediate",
      seed: Math.floor(now / 1000),
      ...(config.balanceOverrides ? { balanceOverrides: config.balanceOverrides } : {}),
      ...(config.cardOverrides ? { cardOverrides: config.cardOverrides } : {}),
      // §12: the rule is shown on the queue tile and again on the mulligan
      ruleNote: { name: modifier.name, text: modifier.text },
      onSettle: (result) => {
        const outcome = result.winner === "player" ? "win" : result.winner === "ai" ? "loss" : "draw";
        const paid = recordMatch(result.record, outcome, {
          deckName: playerDeck.name,
          leaderCardId: playerDeck.leaderCardId,
          opponentLeaderCardId: aiDeck.leaderCardId,
          // the mode string carries the rule, so match history says which week
          mode: `${REMIX_MODE}-${modifier.id}`,
          content,
          ...(playerDeck.editedAt !== undefined ? { deckEditedAt: playerDeck.editedAt } : {}),
        });
        // §12's weekly quest counts wins, and only wins
        const quest = outcome === "win" ? recordRemixWin(now) : null;
        return {
          ...paid,
          ...(quest?.justCompleted
            ? { extra: [`Remix quest complete: +${quest.clout} Clout`] }
            : {}),
        };
      },
      onExit: (result) => {
        // carry the rule, or "again" would quietly hand you a different week
        if (result.action === "again") shell.navigate("remix", { rule: modifier.id, r: String(Date.now()) });
        else shell.navigate("remixhub");
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /** The queue tile itself: this week's rule, the quest, and the way in. */
  shell.register("remixhub", () =>
    createRemixScreen({
      onBack: () => shell.navigate("lobby"),
      onPlay: (ruleId) => shell.navigate("remix", { rule: ruleId, r: String(Date.now()) }),
    })
  );


  /**
   * The Custom Lobby — 09 §17. Hybrid: vs AI and Hotseat ship, online lobbies
   * do not.
   *
   * The settings ride in memory rather than in the URL. They are a dozen fields
   * including a ban list, and a query string long enough to hold them is a query
   * string somebody can hand-edit past the ranges the lobby enforces.
   */
  shell.register("custom", () =>
    createCustomScreen(content, {
      onBack: () => shell.navigate("play"),
      onStart: (settings, deckIndex) => {
        customSettings = { settings, deckIndex };
        shell.navigate("custombattle", { r: String(Date.now()) });
      },
    })
  );

  shell.register("custombattle", () => {
    const pending = customSettings;
    if (!pending) {
      const missing = document.createElement("div");
      missing.className = "screen";
      missing.textContent = "No custom match set up.";
      return { root: missing };
    }
    const { settings, deckIndex } = pending;
    const now = Date.now();
    const pickable = selectableLeaders(content);
    const playerDeck = getProfile().decks[deckIndex] ?? playableDeck(content, pickable[0]?.id ?? "");

    /**
     * Hotseat's second deck comes from this account's slots too, because there
     * is one account on the device — see DEFERRED_CUSTOM. Against the AI it is
     * an ordinary built rival.
     */
    const aiLeaderId =
      pickable.map((leader) => leader.id).find((id) => id !== playerDeck.leaderCardId) ??
      playerDeck.leaderCardId;
    const opponentDeck =
      settings.opponent === "hotseat"
        ? (getProfile().decks[deckIndex === 0 ? 1 : 0] ?? autoBuildDeck(content, aiLeaderId, "Player Two"))
        : autoBuildDeck(content, aiLeaderId, "Rival Deck");

    const config = customMatchConfig(content, settings, [playerDeck.leaderCardId, opponentDeck.leaderCardId], now);
    const pays = paysRewards(content, settings);

    const screen = new BattleScreen({
      content,
      playerDeck,
      aiDeck: opponentDeck,
      difficulty: settings.difficulty,
      seed: Math.floor(now / 1000),
      ...(config.balanceOverrides ? { balanceOverrides: config.balanceOverrides } : {}),
      ...(config.cardOverrides ? { cardOverrides: config.cardOverrides } : {}),
      ...(settings.opponent === "hotseat"
        ? { hotseat: { seatNames: ["Player One", "Player Two"] as [string, string] } }
        : {}),
      onSettle: (result) => {
        /**
         * §17: flagged combinations pay zero to prevent farming, and Hotseat
         * pays nothing at all. Not recording the match is the honest form of
         * "pays nothing" — a zero-Clout entry in match history would still move
         * mission progress and the achievement tally.
         */
        if (!pays) return { clout: 0, xp: 0, extra: ["Custom rules — this match paid nothing."] };
        const outcome = result.winner === "player" ? "win" : result.winner === "ai" ? "loss" : "draw";
        return recordMatch(result.record, outcome, {
          deckName: playerDeck.name,
          leaderCardId: playerDeck.leaderCardId,
          opponentLeaderCardId: opponentDeck.leaderCardId,
          mode: `ai-${settings.difficulty}`,
          content,
          ...(playerDeck.editedAt !== undefined ? { deckEditedAt: playerDeck.editedAt } : {}),
        });
      },
      onExit: (result) => {
        if (result.action === "again") shell.navigate("custombattle", { r: String(Date.now()) });
        else shell.navigate("custom");
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  shell.register("deckbuilder", (params) =>
    createDeckBuilderScreen(content, {
      deckIndex: params.get("deck") ? Number(params.get("deck")) : undefined,
      onBack: () => shell.navigate("decks"),
      /**
       * §4.3.2's "Test vs AI". The draft is held in memory rather than saved,
       * because the point is trying a list you have not committed to — writing
       * it to the slot first would overwrite the deck being experimented on.
       */
      onTestDeck: (draft) => {
        testDeck = draft;
        shell.navigate("battle", { difficulty: "casual", test: "1", r: String(Date.now()) });
      },
    })
  );

  shell.register("settings", () =>
    createSettingsScreen({
      onBack: () => shell.navigate("lobby"),
      onAccessibility: () => shell.navigate("a11y"),
      onFairness: () => shell.navigate("fairness"),
      onPrivacy: () => shell.navigate("privacy"),
      onLegal: () => shell.navigate("legal"),
      onSupport: () => shell.navigate("support"),
    })
  );

  /**
   * The system hub — §4.6.3 to §4.6.6.
   *
   * `#fairness` is the screen policy F1 names by name; the other three are the
   * ones a player looks for when they want to know what the game knows about
   * them, who wrote it, and how to report that it is broken.
   */
  shell.register("a11y", () =>
    createA11yScreen(content, {
      onBack: () => shell.navigate("settings"),
    })
  );

  shell.register("fairness", () =>
    createFairnessScreen(content, {
      onBack: () => shell.navigate("settings"),
      onShop: () => shell.navigate("shop"),
      onBanner: () => shell.navigate("banner"),
      onPatchNotes: () => shell.navigate("patchnotes"),
    })
  );

  shell.register("privacy", () =>
    createPrivacyScreen({
      onBack: () => shell.navigate("settings"),
      onSupport: () => shell.navigate("support"),
      onLegal: () => shell.navigate("legal"),
    })
  );

  shell.register("legal", () =>
    createLegalScreen({
      onBack: () => shell.navigate("settings"),
      onPrivacy: () => shell.navigate("privacy"),
    })
  );

  shell.register("support", () =>
    createSupportScreen(content, {
      onBack: () => shell.navigate("settings"),
      onPrivacy: () => shell.navigate("privacy"),
      onFairness: () => shell.navigate("fairness"),
      onCollection: () => shell.navigate("collection"),
    })
  );

  /**
   * Weekly Boss. A normal constructed match against a boss leader whose rule
   * twist is a passive on its card — plus a difficulty tier expressed purely as
   * an AI profile, balance overrides and a leader-health setup op.
   */
  shell.register("boss", (params) => {
    const now = Date.now();
    // `?boss=<id>` reaches a specific one; without it, this week's
    const boss = bossById(params.get("boss"), now);
    const tier = tierById(params.get("tier") ?? "normal");
    const playerDeck = playableDeck(content, selectableLeaders(content)[0]?.id ?? "");

    // the boss plays its faction's deck, fronted by the boss leader
    const bossDeck = { ...autoBuildDeck(content, boss.deckLeaderCardId, boss.name), leaderCardId: boss.leaderCardId };
    const config = bossMatchConfig(tier, Math.floor(now / 1000));

    const screen = new BattleScreen({
      content,
      playerDeck,
      aiDeck: bossDeck,
      difficulty: tier.ai,
      seed: config.seed,
      ...(config.balanceOverrides ? { balanceOverrides: config.balanceOverrides } : {}),
      ...(config.scenario ? { scenario: config.scenario } : {}),
      onSettle: (result) => {
        // first clear per boss per tier per week; repeats pay the normal match
        // reward below, so beating it again is never worthless
        const firstClear = result.winner === "player" ? claimOnce(clearKey(boss, tier, now), tier.clout) : null;
        const outcome = result.winner === "player" ? "win" : result.winner === "ai" ? "loss" : "draw";
        const paid = recordMatch(result.record, outcome, {
          deckName: playerDeck.name,
          leaderCardId: playerDeck.leaderCardId,
          opponentLeaderCardId: boss.leaderCardId,
          mode: `boss-${tier.id}`,
          content,
          ...(playerDeck.editedAt !== undefined ? { deckEditedAt: playerDeck.editedAt } : {}),
        });
        return {
          ...paid,
          ...(firstClear ? { extra: [`First clear this week: +${firstClear.clout} Clout`] } : {}),
        };
      },
      onExit: (result) => {
        // a rematch needs a route the router will actually remount
        // carry the boss id, or "again" would quietly hand you a different boss
        if (result.action === "again") shell.navigate("boss", { tier: tier.id, boss: boss.id, r: String(Date.now()) });
        else shell.navigate("lobby");
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /**
   * The Doomscroll. The map screen owns the run; this route only ever hands off
   * to a fight and takes the result back. The run itself lives in storage, so a
   * reload — or the battle screen's own navigation — never loses it.
   */
  shell.register("doomscroll", () =>
    createDoomscrollScreen(content, {
      onBack: () => shell.navigate("lobby"),
      // the node id makes each fight its own route, so the router (which
      // correctly refuses to remount an identical hash) deals a new board
      onFight: () => shell.navigate("doomfight", { node: activeRun()?.nodeId ?? "" }),
    })
  );

  /**
   * The Gauntlet. Same shape as the Doomscroll: one screen owns the run, this
   * route only ever hands off to a fight and takes the result back.
   *
   * The one deliberate difference is the fight seed. A Doomscroll re-entry mixes
   * its count in so a restart is a different game; a Gauntlet re-entry gives the
   * *same* board back, because here a loss is the resource being spent and a
   * fresh roll would be worth farming. `enterFight` counts the re-entry and the
   * run screen says so.
   */
  shell.register("gauntlet", () =>
    createGauntletScreen(content, {
      onBack: () => shell.navigate("play"),
      // the record makes each fight its own route, so the router (which refuses
      // to remount an identical hash) deals a board rather than sitting still
      onFight: () => {
        const run = activeGauntlet();
        shell.navigate("gauntletfight", { r: `${run?.wins ?? 0}-${run?.losses ?? 0}` });
      },
    })
  );

  shell.register("gauntletfight", () => {
    const current = activeGauntlet();
    // count the entry before building the board, so walking out is on the record
    const run = current ? enterFight(content, current) : null;
    if (!run?.pending || !run.leaderCardId) {
      shell.navigate("gauntlet");
      const empty = document.createElement("div");
      empty.className = "screen";
      return { root: empty };
    }
    saveGauntlet(run);
    const fight = run.pending;

    /**
     * The opponent drafts too, through the same offer generator.
     *
     * `autoBuildDeck` would hand the AI the best thirty cards its faction has,
     * which is not the matchup: a drafted deck against a constructed one is a
     * different game with the same board. Same seed as the fight, so the
     * opponent you walked out on is the opponent you come back to.
     */
    const enemyName = content.leaders[fight.enemyLeaderCardId]?.name ?? "Rival";
    const enemyDeck = botDeck(content, fight.seed, fight.enemyLeaderCardId, enemyName);

    const screen = new BattleScreen({
      content,
      playerDeck: deckListFor(run),
      aiDeck: enemyDeck,
      difficulty: fight.difficulty,
      seed: fight.seed,
      // "Play Again" would mean replaying a match the run has already counted
      endActions: { primary: "Back to the run", secondary: null },
      onSettle: (result) => {
        const won = result.winner === "player";
        // the run's record moves here, so closing the tab on the result screen
        // cannot leave a match that was played and never counted
        saveGauntlet(resolveFight(run, won));
        return recordMatch(result.record, won ? "win" : result.winner === "draw" ? "draw" : "loss", {
          deckName: "Gauntlet Deck",
          leaderCardId: run.leaderCardId ?? "",
          opponentLeaderCardId: fight.enemyLeaderCardId,
          mode: "gauntlet-practice",
          content,
        });
      },
      onExit: () => shell.navigate("gauntlet"),
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  shell.register("doomfight", () => {
    const data = getRoguelikeData(content);
    const current = activeRun();
    // count the fight before building it: the battle seed mixes the count in
    const run = current ? startFight(current) : null;
    const battle = run ? battleFor(data, content, run) : null;
    if (!run || !battle) {
      shell.navigate("doomscroll");
      const empty = document.createElement("div");
      empty.className = "screen";
      return { root: empty };
    }
    saveRun(run);

    const screen = new BattleScreen({
      content,
      playerDeck: battle.playerDeck,
      aiDeck: battle.enemyDeck,
      difficulty: battle.difficulty,
      seed: battle.seed,
      scenario: battle.scenario,
      // artifacts that bend a battle are a patch on the run leader's card
      ...(battle.cardOverrides ? { cardOverrides: battle.cardOverrides } : {}),
      ...(battle.cardVariants ? { cardVariants: battle.cardVariants } : {}),
      // "Play Again" would mean replaying a node the run has already resolved
      endActions: { primary: "Back to the map", secondary: null },
      onSettle: (result) => {
        const won = result.winner === "player";
        saveRun(resolveBattle(data, content, run, { won, leaderHealth: result.playerLeaderHealth }));
        return recordMatch(result.record, won ? "win" : result.winner === "draw" ? "draw" : "loss", {
          deckName: battle.playerDeck.name,
          leaderCardId: battle.playerDeck.leaderCardId,
          opponentLeaderCardId: battle.enemyLeaderCardId,
          mode: `doomscroll-${battle.kind}`,
          content,
        });
      },
      onExit: () => shell.navigate("doomscroll"),
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /**
   * Story chapters.
   *
   * Three routes, because a story battle leaves the dialogue entirely and has to
   * come back to the exact step it left from. The runner's position is one
   * number, written to the save before the handoff, so `#storybattle` needs to
   * carry nothing but "which battle" — and a reload mid-battle still resumes.
   */
  shell.register("story", (params) =>
    createStoryScreen(content, params.get("ch"), {
      onBack: () => shell.navigate("play"),
      onPlayEpisode: (chapterId, episodeId) => shell.navigate("storyscene", { ch: chapterId, ep: episodeId }),
    })
  );

  shell.register("storyscene", (params) => {
    const found = findEpisode(content, params.get("ch"), params.get("ep"));
    if (!found) {
      shell.navigate("story");
      const empty = document.createElement("div");
      empty.className = "screen";
      return { root: empty };
    }
    const { chapter, episode } = found;

    /**
     * Resuming after a battle. The pending record is consumed here rather than
     * on the battle route, so quitting the battle screen mid-match lands back on
     * the brief — the design's "mid-battle quit costs nothing" rule — instead of
     * skipping past a fight that never happened.
     */
    const pending = pendingBattle();
    const outcome = params.get("result");
    const resuming =
      pending && outcome && pending.chapterId === chapter.id && pending.episodeId === episode.id ? pending : null;
    if (resuming) setPendingBattle(null);

    const screen = createSceneScreen({
      content,
      chapter,
      episode,
      ...(resuming ? { startAt: resuming.pc, flags: resuming.flags } : {}),
      ...(resuming ? { resumeWith: outcome === "won" ? ("won" as const) : ("lost" as const) } : {}),
      callbacks: {
        onExit: () => shell.navigate("story", { ch: chapter.id }),
        onFinished: () => {
          // once-only per episode, so replaying a chapter never farms Clout
          claimOnce(`story:${chapter.id}:${episode.id}`, STORY_CLOUT_PER_EPISODE);
          shell.navigate("story", { ch: chapter.id });
        },
        onBattle: () => shell.navigate("storybattle", { r: String(Date.now()) }),
      },
    });
    return screen;
  });

  shell.register("storybattle", () => {
    const pending = pendingBattle();
    const found = pending ? findEpisode(content, pending.chapterId, pending.episodeId) : null;
    const step = found?.episode.steps[pending!.pc];
    if (!pending || !found || !step || step.s !== "battle") {
      shell.navigate("story");
      const empty = document.createElement("div");
      empty.className = "screen";
      return { root: empty };
    }

    const setup = storyMatchSetup(content, step.battle, { assist: pending.assist });
    const back = (result: "won" | "lost"): void =>
      shell.navigate("storyscene", { ch: pending.chapterId, ep: pending.episodeId, result, r: String(Date.now()) });

    const screen = new BattleScreen({
      content,
      playerDeck: setup.playerDeck,
      aiDeck: setup.aiDeck,
      difficulty: setup.difficulty,
      ...(setup.scenario ? { scenario: setup.scenario } : {}),
      ...(setup.cardOverrides ? { cardOverrides: setup.cardOverrides } : {}),
      ...(setup.balanceOverrides ? { balanceOverrides: setup.balanceOverrides } : {}),
      ...(setup.firstSeat !== undefined ? { firstSeat: setup.firstSeat } : {}),
      // the story decides what happens next, so there is nothing to play again
      endActions: { primary: "Continue", secondary: null },
      onSettle: (result) =>
        recordMatch(result.record, result.winner === "player" ? "win" : result.winner === "draw" ? "draw" : "loss", {
          deckName: setup.playerDeck.name,
          leaderCardId: setup.playerDeck.leaderCardId,
          opponentLeaderCardId: setup.aiDeck.leaderCardId,
          mode: `story-${pending.chapterId}`,
          content,
        }),
      onExit: (result) => {
        const won = result.winner === "player";
        if (result.winner === "quit") {
          // no penalty and no progress: back to the brief, exactly as it was
          shell.navigate("storyscene", { ch: pending.chapterId, ep: pending.episodeId, r: String(Date.now()) });
          return;
        }
        if (!won) recordStoryLoss(pending.chapterId, step.key);
        back(won ? "won" : "lost");
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  shell.register("lab", () => createLabScreen(content, { onBack: () => shell.navigate("lobby") }));

  shell.register("uikit", async () => (await import("./ui/screens/uiKitScreen")).createUiKitScreen());

  shell.register("replays", () =>
    createReplayScreen(content, {
      onBack: () => shell.navigate("lobby"),
      // a fresh seed, so "run it back" is another game rather than the same one
      onRematch: (difficulty) => shell.navigate("battle", { difficulty, r: String(Date.now()) }),
    })
  );

  shell.register("stats", () =>
    createStatsScreen(content, {
      onBack: () => shell.navigate("profile"),
      onHistory: () => shell.navigate("replays"),
      onDeckBuilder: () => shell.navigate("decks"),
    })
  );

  shell.register("gallery", () =>
    createGalleryScreen(content, {
      onBack: () => shell.navigate("lobby"),
      onCollection: () => shell.navigate("collection"),
      onMastery: () => shell.navigate("mastery"),
    })
  );

  shell.register("leaderboards", () =>
    createLeaderboardsScreen(content, {
      onBack: () => shell.navigate("profile"),
      onStats: () => shell.navigate("stats"),
    })
  );

  shell.register("battle", (params) => {
    const difficulty = (params.get("difficulty") ?? "casual") as AiDifficulty;
    // an explicit seed makes a match exactly reproducible — used by the browser
    // verification script and invaluable for reproducing a reported bug
    const seedParam = params.get("seed");
    const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
    // scripted-encounter leaders are excluded: the tutorial bot must never turn
    // up as your rival in a normal match
    const pickable = selectableLeaders(content);

    /**
     * `?tour=<faction>` is a Grand Tour loaner match: the same practice match in
     * every respect except two — the deck is lent rather than owned, and winning
     * it hands that deck over for good (§3.4).
     *
     * It is a parameter on the ordinary battle route rather than a route of its
     * own precisely because "AI Practice counts" is what the design says. A
     * separate mode would be a second definition of a practice match, and the
     * first thing to drift would be whichever of the two nobody plays.
     */
    const tourFaction = params.get("tour") as FactionId | null;
    const loaner = tourFaction ? loanerDeckFor(content, tourFaction) : null;
    // a faction already unlocked, or a bad id, falls back to a normal match
    // rather than dealing a deck the tour would refuse to pay out on
    const touring = loaner !== null && !getProfile().unlockedFactions.includes(tourFaction!);

    /**
     * `?test=1` is §4.3.2's "Test vs AI": the deck builder hands over an unsaved
     * draft in memory. Consumed on read so a later match cannot pick it up.
     */
    const draft = params.get("test") === "1" ? testDeck : null;
    if (draft) testDeck = null;

    const playerDeck =
      draft ?? (touring ? loaner : null) ?? playableDeck(content, pickable[0]?.id ?? "");

    // the AI plays a different leader from the same pool for variety
    const leaderIds = pickable.map((leader) => leader.id);
    const aiLeaderId =
      leaderIds.find((id) => id !== playerDeck.leaderCardId) ?? playerDeck.leaderCardId;
    /**
     * A tour match is starter against starter, per §3.4's *"the baseline used
     * for new-player matchmaking pools"*. The ordinary rival is built from a
     * Leader's whole legal pool, which is a fair fight for a constructed deck
     * and not one for seventeen Commons — played well, the loaner loses it.
     */
    const aiDeck =
      (touring ? tourOpponentDeck(content, tourFaction!) : null) ??
      autoBuildDeck(content, aiLeaderId, "Rival Deck");

    const screen = new BattleScreen({
      content,
      playerDeck,
      aiDeck,
      difficulty,
      ...(seed !== undefined ? { seed } : {}),
      // the way out of a tour match goes back to the tour, so it should say so
      ...(touring ? { endActions: { secondary: "Back to the Tour" } } : {}),
      onSettle: (result) => {
        const outcome = result.winner === "player" ? "win" : result.winner === "ai" ? "loss" : "draw";
        const paid = recordMatch(result.record, outcome, {
          deckName: playerDeck.name,
          leaderCardId: playerDeck.leaderCardId,
          opponentLeaderCardId: aiDeck.leaderCardId,
          mode: touring ? `tour-${tourFaction}` : `ai-${difficulty}`,
          content,
          ...(playerDeck.editedAt !== undefined ? { deckEditedAt: playerDeck.editedAt } : {}),
        });
        /**
         * The unlock hangs off a win and nothing else. A draw and a concede both
         * leave the tour where it was, which is what "win 1 match" means.
         *
         * It settles here rather than on the way out, which also removes the
         * trap `verify:tour` fell into once: the script read `winner`, navigated
         * away, reported the win and found the faction still locked.
         */
        const unlocked = touring && outcome === "win" ? recordTourWin(content, tourFaction!) : null;
        return {
          ...paid,
          ...(unlocked ? { extra: [`Grand Tour: ${tourFaction} unlocked, and the loaner deck is yours`] } : {}),
        };
      },
      onExit: (result) => {
        /**
         * "Play Again" used to go to the lobby, which is simply not what the
         * button says. A fresh seed also changes the route, which matters:
         * the router refuses to remount an identical hash, so re-navigating to
         * the same one would have done nothing at all.
         */
        if (result.action === "again") {
          shell.navigate("battle", {
            difficulty,
            seed: String(Math.floor(Math.random() * 0x7fffffff)),
            // a rematch on the tour is still a tour match; dropping the faction
            // here would silently hand the player their own deck instead
            ...(touring ? { tour: tourFaction! } : {}),
          });
        } else {
          shell.navigate(tourFaction ? "tour" : "lobby");
        }
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /**
   * The tutorial reuses the battle screen entirely — same board, same rules,
   * same driver — with a stage script layered on top. `#tutorial?stage=2` jumps
   * straight to a stage, which is how it is authored and tested.
   */
  shell.register("tutorial", (params) => {
    const encounter = getEncounters(new Set(Object.keys(content.cards)))["tutorial"];
    const index = Math.max(0, Number(params.get("stage") ?? "1") - 1);
    const stage = encounter?.stages[index] ?? encounter?.stages[0];
    if (!encounter || !stage) {
      const missing = document.createElement("div");
      missing.className = "screen";
      missing.textContent = "The tutorial is unavailable.";
      return { root: missing };
    }

    /**
     * `$player` means "the deck you actually own". The graduation stage is a
     * real match, so authoring a 30-card list into the encounter file would
     * both bloat it and teach the player with cards that are not theirs.
     * `$rival` builds a legal opponent deck the same way Quick Match does.
     */
    const resolveDeck = (id: string, fallbackLeader: string): DeckList => {
      if (id === "$player") return playableDeck(content, fallbackLeader);
      if (id === "$rival") return autoBuildDeck(content, fallbackLeader, "Rival Deck");
      return encounter.decks[id]!;
    };
    const pickableIds = selectableLeaders(content).map((l) => l.id);
    const playerDeck = resolveDeck(stage.decks[0], pickableIds[0] ?? "");
    const rivalLeader = pickableIds.find((id) => id !== playerDeck.leaderCardId) ?? pickableIds[0] ?? "";

    const screen = new BattleScreen({
      content,
      playerDeck,
      aiDeck: resolveDeck(stage.decks[1], rivalLeader),
      difficulty: (stage.opponent.kind === "ai" ? stage.opponent.difficulty : "beginner") as AiDifficulty,
      seed: stage.seed,
      stage,
      onStageComplete: () => {
        // once-only per stage, so replaying a lesson never farms Clout
        grantTutorialReward(stage.id, tutorialConfig().cloutPerStage);
        /**
         * §2.3's completion package, the moment the last stage is done.
         *
         * It has to be granted here rather than on the way out, because the
         * final stage is a real match and the player may quit it. Finishing the
         * lesson is what §2.3 pays for, not pressing the button afterwards.
         */
        grantTutorialCompletion(content, encounter.stages.map((entry) => entry.id));
        const next = encounter.stages[index + 1];
        // The final stage is a real match and shows VICTORY/DEFEAT with its own
        // way out. Navigating from here would yank the player off that screen
        // before they saw the result.
        if (next) shell.navigate("tutorial", { stage: String(index + 2) });
      },
      onExit: (result) => {
        // only the graduation stage reaches the end sequence, and there "Play
        // Again" means this stage again — with a param the router will remount
        if (result.action === "again") {
          shell.navigate("tutorial", { stage: String(index + 1), r: String(Date.now()) });
        } else {
          shell.navigate("lobby");
        }
      },
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /**
   * Puzzle Rush. Same battle screen, same scripted-encounter machinery — a
   * puzzle is just a stage with an objective and a fail condition.
   *
   * Retry carries an incrementing `try` param because the router (correctly)
   * refuses to remount an identical route, and a retry must deal the board
   * again from scratch rather than leave the solved-or-lost one on screen.
   */
  shell.register("puzzle", (params) => {
    const encounter = getEncounters(new Set(Object.keys(content.cards)))["puzzles"];
    const index = Math.max(0, Number(params.get("n") ?? "1") - 1);
    const attempt = Number(params.get("try") ?? "1");
    const stage = encounter?.stages[index];
    if (!encounter || !stage) {
      const missing = document.createElement("div");
      missing.className = "screen";
      missing.textContent = "No puzzle there.";
      return { root: missing };
    }

    const goto = (n: number, tryCount: number) =>
      shell.navigate("puzzle", { n: String(n), try: String(tryCount) });

    const screen = new BattleScreen({
      content,
      playerDeck: encounter.decks[stage.decks[0]]!,
      aiDeck: encounter.decks[stage.decks[1]]!,
      /**
       * The stage's own opponent, not a fixed one.
       *
       * Most puzzles face the idle bot and the difficulty is decoration, but a
       * Survival puzzle is decided by what the opponent actually does with its
       * turn — dealing "beginner" while the data says "intermediate" would make
       * the puzzle's asserted solution a claim about a game nobody plays.
       */
      difficulty: (stage.opponent.kind === "ai" ? stage.opponent.difficulty : "beginner") as AiDifficulty,
      seed: stage.seed,
      stage,
      onStageComplete: () => {
        /**
         * 09 §11's Daily Puzzle. It pays for *today's* scenario only, and only
         * the first time today — replaying a puzzle you enjoyed is free, and
         * farming it is not a thing.
         */
        completeDailyPuzzle(content, index, encounter.stages.length);
        const next = encounter.stages[index + 1];
        if (next) goto(index + 2, 1);
        else shell.navigate("lobby");
      },
      // Belt and braces against a puzzle that fails the instant it opens: the
      // validator rejects the shape that causes it, but a retry loop is bad
      // enough that it should also be impossible at runtime.
      onStageFailed: () => (attempt < 25 ? goto(index + 1, attempt + 1) : shell.navigate("lobby")),
      onExit: () => shell.navigate("lobby"),
    });

    return { root: screen.root, dispose: () => screen.dispose() };
  });

  /**
   * A new account goes to the picker first, whatever route the URL asked for.
   *
   * Checked here rather than inside the lobby because every screen downstream
   * assumes a collection exists — a deep link straight to the deck builder on a
   * fresh account would open an empty one with nothing to explain why.
   */
  if (needsStarterChoice()) {
    shell.navigate("starter");
    return;
  }

  void shell.start().finally(clearBootPlate);

  /**
   * Sync the save, if and only if somebody is signed in.
   *
   * The guard is the point. A signed-out boot makes no request at all, which is
   * what `scripts/verify-fairness.mjs` asserts by recording every request the
   * page makes — and what the privacy page claims when it says offline play
   * transmits nothing. Signing in is the moment that claim changes, and it is
   * the moment this starts.
   *
   * Deliberately not awaited. A save that is a few seconds stale is normal; a
   * lobby that will not render until a server answers is not.
   */
  if (currentAccount()) {
    void syncNow();
    startAutoSync();
  }

  // Debug handle. `renderCard` is genuinely useful while adding art: open the
  // console and run `hypebound.previewCard("idols-lumi-starcall")` to see any
  // card at full size with whatever art is currently on disk.
  (window as unknown as { hypebound?: unknown }).hypebound = {
    content,
    profile: getProfile,
    shell,
    previewCard: (cardId: string, width = 380) => {
      const card = content.cards[cardId];
      if (!card) throw new Error(`Unknown card: ${cardId}`);
      const canvas = renderCardToCanvas(card, width);
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(3,2,8,.9);backdrop-filter:blur(8px)";
      host.appendChild(canvas);
      host.addEventListener("click", () => host.remove());
      document.body.appendChild(host);
      return canvas;
    },
    /**
     * Every leader medallion side by side. The rim profile is the Current's
     * colourblind signal, so the useful check is whether the eight silhouettes
     * are separable with the colour ignored — which is what this lays out.
     */
    previewLeaders: (width = 260, ids?: string[]) => {
      const host = document.createElement("div");
      host.id = "leader-strip";
      host.style.cssText =
        "position:fixed;inset:0;z-index:9999;display:flex;flex-wrap:wrap;gap:10px;align-content:center;" +
        "justify-content:center;background:#0b0614;padding:20px";
      const seen = new Set<string>();
      const chosen: string[] = [];
      for (const [id, leader] of Object.entries(content.leaders)) {
        if (ids ? !ids.includes(id) : seen.has(leader.current)) continue;
        seen.add(leader.current);
        chosen.push(id);
      }
      for (const id of chosen) {
        const leader = content.leaders[id];
        if (!leader) continue;
        host.appendChild(
          renderLeaderToCanvas(leader, width, { health: 30, maxHealth: 30, armor: 3 })
        );
      }
      host.addEventListener("click", () => host.remove());
      document.body.appendChild(host);
      return chosen;
    },
  };
}

boot();
