# HYPEBOUND — Canonical Core Rules Specification

> **Status: CANONICAL.** This document is the single source of truth for game rules.
> Every other document, data file, and engine module must agree with it. If a
> conflict is found, this document wins and the conflict must be reported.
> All numeric values here are *defaults* and live in `data/balance.json` —
> the engine must read them from data, never hardcode them.

**Working title:** HYPEBOUND (internal codename; folder name is historical)
**Tagline:** *A card game about being chronically online, for people who are chronically online.*

---

## 1. Theme & Tone

A comedic, exaggerated internet-culture world: fandoms, streamers, virtual idols,
meme communities, digital demons, cosplay champions, conventions, and
social-media rivalries. Presentation is stylish anime-inspired "digital
nightlife" (neon, chrome, glass, holograms). Humor is self-aware satire about
being chronically online — but the game must be genuinely fun and readable even
if every joke is removed. Never mock real, named people; all characters are
original archetypes.

---

## 2. Match Structure (canonical numbers)

| Rule | Value | balance.json key |
|---|---|---|
| Deck size | exactly 30 cards | `deck.size` |
| Max copies per card | 2 (Legendary: 1) | `deck.maxCopies`, `deck.maxCopiesLegendary` |
| Leader | 1, chosen at deck creation, not part of the 30 | — |
| Starting leader health | 30 | `leader.startingHealth` |
| Board slots (characters) | 6 per player | `board.characterSlots` |
| Location slot | 1 per player (new location replaces old) | `board.locationSlots` |
| Equipment | max 1 per character (replaced on new equip) | `board.equipmentPerCharacter` |
| Starting hand | first player 4, second player 5 | `hand.first`, `hand.second` |
| Second-player compensation | 1 **Borrowed Clout** card (0 cost, Action: "+1 Hype this turn only") | — |
| Hand limit | 10 — excess drawn cards are destroyed ("**Lost in the Feed**") | `hand.limit` |
| Card draw | 1 at start of your turn | `draw.perTurn` |
| Hype | Max Hype = turn number (yours), capped at 10; refills at start of your turn | `hype.cap` |
| Turn timer | 75 s, then 15 s "Stream Buffering" warning rope | `timer.turnSeconds`, `timer.ropeSeconds` |
| Fatigue ("**Burnout**") | drawing from an empty deck deals 1, 2, 3, … escalating damage to your leader | `fatigue.start`, `fatigue.increment` |
| Mulligan | during setup, select any subset of opening hand once; selected cards are shuffled back and replaced with the same count | — |
| Obsession meter | 0–10 per player, starts at 0 | `obsession.max` |

**Turn sequence (canonical):**
1. Start of turn: refill Hype (apply Overload locks), draw 1, resolve `startOfTurn` triggers, tick down timed statuses/Comeback timers.
2. Main phase: play cards, attack, use Leader Fixation ability, activate at most one Confluence. Any order, any number of times as resources allow.
3. End of turn: resolve **Afterparty** (`endOfTurn`) triggers, then **Scorched** damage, then Grow counters tick, then hand/board state checks.
4. Priority passes to opponent. Reactions (see §5.5) may interrupt at defined windows.

**Victory / defeat:**
- You win when the enemy leader's health reaches 0.
- Simultaneous 0-0 is a draw.
- Alternate win conditions exist only as explicit Legendary cards ("Finale" cards). Every Finale card must: (a) be visible to the opponent while its condition progresses, (b) take at least 2 turns from reveal to trigger, (c) be interactable (the enemy can remove/delay it). Example archetype finishers are defined per faction in the faction guide.

---

## 3. Resources

### 3.1 Hype (primary)
Standard ramping resource (Hearthstone-style mana). Max Hype = your turn number, cap 10, refills every turn. No resource cards exist; you are never resource-screwed by draw. Cards cost Hype. Some effects grant temporary Hype (this turn only) or permanent extra max Hype (rare, capped at 10).

### 3.2 Obsession (secondary)
A 0–10 per-player meter representing how deep into the fandom you are. It is a *strategic dial with risk*, not a second currency for playing cards.

**Gaining Obsession (canonical sources):**
- +1 the first time each turn you *support* a friendly character (buff, heal, shield, or equip it). (`obsession.supportPerTurn`)
- +1 per **Parasocial** trigger (see keyword).
- Explicit card effects ("Gain 2 Obsession").

**Spending Obsession — Leader Fixation abilities.** Every Leader has:
- **Fixation** (minor): costs 3 Obsession, once per turn.
- **Ultimate Fixation** (major): costs 7 Obsession, once per match.

**Risk — the parasocial danger zone:**
- At **8+** Obsession you are **Obsessed**: your leader takes +1 damage from all enemy sources, and certain enemy cards (notably Touch-Grass Order) gain bonus effects against you.
- At **10**, **Full Fixation** triggers: this turn only, your Ultimate Fixation costs 0 (still once per match); at end of turn your Obsession resets to 5.
- Obsession never decays on its own below 8; some cards remove it (yours or the enemy's).

This creates the intended push-your-luck: charging toward your ultimate makes you fragile at the worst time.

---

## 4. Card Categories

| Category | In deck? | Summary |
|---|---|---|
| **Leader** | No (1 per deck, separate) | Health 30, passive ability, Fixation + Ultimate Fixation, defines deck's Faction + Currents |
| **Character** | Yes | Attack/Health, occupies a board slot, attacks once per turn, summoning sickness unless **Raid** |
| **Action** | Yes | One-shot spell, resolves then discards |
| **Reaction** | Yes | Set face-down (max 2 set at once); triggers automatically on its stated condition during either turn; costs Hype when set |
| **Equipment** | Yes | Attaches to a friendly character; grants stats/keywords; destroyed with the character unless stated |
| **Location** | Yes | Occupies your location slot; persistent aura or activated ability; replaced by playing a new location; has Durability consumed by activated use |
| **Transformation** | Yes | Action subtype that permanently transforms a target (yours or with Corrupt, the enemy's) into a stated form |
| **Event** | Yes | Global effect lasting N turns, visible to both players in an Event banner zone (max 1 per player active; new replaces old) |

Board totals: 6 characters + 1 location per side; Reactions and Events sit in their own visible zones (Reactions face-down, count shown).

---

## 5. Combat & Interaction Rules

### 5.1 Attacking
- Characters may attack the turn after they are played (summoning sickness), unless they have **Raid**.
- One attack per character per turn (keywords may modify).
- Valid targets: enemy leader or enemy characters. If any enemy character has **Spotlight**, you must attack a Spotlight character (Lurking characters cannot be attacked until revealed).
- Combat is simultaneous: attacker and defender deal damage equal to their Attack to each other. Leaders deal no counter-damage unless armed by an effect.

### 5.2 Elemental damage bonus
When a character (or damaging card) attacks/damages a target whose Current is weak to its own (see §8.4), it deals **+1 damage**. Exactly +1 unless a card explicitly states otherwise. The UI must preview this before confirmation.

### 5.3 Targeting
- All targeting is explicit: the acting player drags an arrow to a legal target; illegal targets are visually excluded.
- "Choose" effects on played cards require a target before the card resolves; if no legal target exists the card cannot be played (unless text says "if able").
- Damage/heal previews (including elemental bonus, Shield absorption, statuses) are computed by the engine's `predict()` API and shown before confirmation.

### 5.4 Status effects (canonical set)
| Status | Effect | Duration |
|---|---|---|
| **Scorched** | Takes 1 damage at end of its controller's turn | Removed after triggering unless renewed |
| **Shielded** | Negates the next instance of damage | Until consumed |
| **Armor X** | Absorbs the next X total damage (leaders too) | Until depleted |
| **Cancelled** | Text blank, cannot attack or use abilities | Stated duration (∞ if unstated) or until it leaves play; removed by Comeback-type effects |
| **Lurking** | Cannot be targeted/attacked by the enemy | Until it attacks or deals damage |
| **Warded** | Cannot be targeted by enemy Actions or abilities (can still be attacked) | Stated duration |
| **Weakened X** | −X Attack (min 0) | Stated duration |
| **Empowered X** | +X Attack | Stated duration |
| **Cursed** | Marked by Veil; takes stated effect when the stated trigger occurs | Per card |
| **Banished** | Removed from play (Touch Grass); returns at stated time with base stats, no buffs/statuses | Stated duration |

Statuses are visible as icons with tooltips; every status icon has a distinct shape (never color-only).

### 5.5 Reaction windows & trigger order
- Reactions trigger automatically when their condition occurs (no manual interrupt play from hand — keeps pace fast).
- Trigger resolution order: active player's triggers first, then opponent's; within a player, board order left→right, then hand/other zones. The UI's trigger-order display shows the queue as it resolves.
- A "trigger storm" cap: a single action may cascade at most 20 triggered effects (`rules.triggerCap`); further triggers fizzle (prevents infinite loops; the engine must enforce this deterministically).

---

## 6. Keyword Glossary (canonical wording)

Thematic keywords:

| Keyword | Canonical rules text |
|---|---|
| **Viral** | *When you play this, add a copy to your hand that costs (1) less (minimum 1) and loses Viral.* |
| **Spotlight** | *Enemies must attack characters with Spotlight before other targets.* |
| **Parasocial** | *When you target this friendly character with a card or ability, it gains +1/+1 and you gain 1 Obsession.* |
| **Trending** | *While in your hand, this costs (1) less for each other card you've played this turn (minimum 1). Resets each turn.* |
| **Collab (X)** | *Bonus effect if you control another character that shares the stated Current, faction, or tag X.* |
| **Cancelled** | *(Status — see §5.4.) "Cancel a character" applies Cancelled.* |
| **Comeback** | *When this character is defeated, return it to your hand at the start of your next turn.* Variants may state "Comeback (play)" or a different delay. |
| **Afterparty** | *Triggers at the end of your turn while this is in play.* |
| **Raid** | *Can attack the turn it is played.* |
| **Touch Grass** | *Banish a character until the start of your next turn; it returns with base stats and no statuses or attachments.* |

Current keywords (one signature per Current):

| Keyword | Current | Canonical rules text |
|---|---|---|
| **Scorched** | Cinder | *(Status — see §5.4.)* |
| **Flow** | Tide | *Triggers when a friendly card is returned to your hand, replayed, healed, or exchanged.* |
| **Grow X** | Root | *After surviving X of your turn-ends in play (or meeting a stated defensive condition), gains the stated permanent upgrade.* |
| **Rushwind** | Gale | *Bonus effect if this is not the first card you played this turn.* |
| **Overload (X)** | Pulse | *Powerful immediate effect; you have (X) less Hype next turn.* |
| **Inspire** | Halo | *Triggers when this or another friendly character is healed, shielded, or buffed.* |
| **Corrupt** | Veil | *Replaces a card's or effect's normal benefit with the stated darker version.* |
| **Refract** | Prism | *When played, choose a Current available to your deck; this card becomes that Current while in play.* |

**Templating rules:** Keyword names are always bold. Reminder text in italics on Common/Rare cards; omitted on Epic/Legendary. Numbers in effects use digits. Cost references use "(N)". The card-text templating system is defined in `docs/design/05-keyword-glossary.md` and enforced by the card validator.

---

## 7. Factions (10)

Every card belongs to exactly one faction or is **Neutral**. A deck may contain: cards of its Leader's faction + Neutral cards, further restricted by Currents (§8.6).

| Faction | Currents | Identity | Strategy | Weakness |
|---|---|---|---|---|
| **Neon Idols** | Halo / Pulse | Idol groups, virtual concerts, unit synergy | Wide boards, buffs, performance combo chains that scale with multiple performers | Fragile individually; combo pieces removable |
| **Gothic Royalty** | Veil / Root | Vampire courts of dead fandoms, elegant doom | Curses, sacrifice, healing, resurrection; inevitability over time | Slow starts; graveyard hate |
| **Viral Influencers** | Gale / Cinder | Clout chasers, trend hijackers | Follower tokens, copying, going wide fast | Board wipes; runs out of steam |
| **Corporate Creators** | Root / Halo | Media megacorp, sponsorships, contracts | Hype ramp, resource generation, expensive finishers | Clunky early game; contract downsides |
| **Digital Demons** | Cinder / Veil | Glitch demons, cursed hardware | High-risk high-power, corruption, transformations | Self-damage; unpredictability |
| **Cosplay Champions** | Prism / Tide | Con-floor heroes, craftsmanship | Equipment, costume swaps, adaptation | Answer-dependent; equipment removal |
| **Afterparty Crew** | Cinder / Tide | The 3 A.M. friend group | Afterparty (end-of-turn) engines, delayed payoffs | Telegraphed; disruption of timing |
| **Touch-Grass Order** | Root / Gale | Hiking-club paladins, digital detox monks | Removal of buffs, anti-combo, Banish, punishing Obsessed enemies | Low proactive pressure |
| **Algorithm Syndicate** | Pulse / Tide | The recommendation engine as a crime family | Draw, deck manipulation, foresight, "next card" control | Thin bodies; setup time |
| **Meme Collective** | Prism / Gale | An anarchic meme commune | Bounded randomness, repeated-joke escalation | Variance; inconsistent curves |

Full identities, color language, leaders, and 3 deck archetypes each: `docs/design/04-faction-guide.md`.

---

## 8. The Eight Currents (elemental system)

### 8.1 Lore seed
The **First Signal** once connected all things. The **Great Fracture** split it into seven natural Currents — Cinder, Tide, Root, Gale, Pulse, Halo, Veil. **Prism** emerged later where fragments recombine; restoring the First Signal may be salvation or catastrophe. Full lore: `docs/design/06-currents-and-lore.md`.

### 8.2 The Currents
| Current | Element | Identity | Signature | Frame shape language |
|---|---|---|---|---|
| **Cinder** | Fire | Ambition, performance, destructive creativity | **Scorched** | Sharp flame-notched frame, ember glow |
| **Tide** | Water | Memory, adaptation, repetition | **Flow** | Rounded wave-edge frame, liquid sheen |
| **Root** | Earth | Stability, patience, legacy | **Grow X** | Heavy hexagonal stone frame |
| **Gale** | Wind | Freedom, speed, rumor | **Rushwind** | Swept, ribbon-cut asymmetric frame |
| **Pulse** | Lightning | Technology, urgency, unstable energy | **Overload (X)** | Circuit-notched angular frame |
| **Halo** | Light | Hope, truth, unity | **Inspire** | Circular radiant frame, gold filigree |
| **Veil** | Darkness | Secrets, fear, forbidden ambition | **Corrupt** | Fractured mirror-shard frame |
| **Prism** | All | Possibility, harmony, instability | **Refract** | Crystal-facet frame with shifting spectrum |

Each Current has a unique icon, badge, summon animation, SFX palette, and written label on every card. Color must never be the only differentiator.

### 8.3 Card ↔ Current
Every Character, Action, Reaction, Equipment, Location, Transformation, Event, and Leader card is attuned to exactly one Current.

### 8.4 Advantage cycle (+1 damage, never more, unless a card states otherwise)
- Cinder → Gale → Root → Pulse → Tide → Cinder (each defeats the next)
- Halo ↔ Veil (mutual +1 both directions)
- Prism: neutral; after **Refract**, adopts the chosen Current's advantages/weaknesses while in play.

### 8.5 Confluences
If you have played cards of two compatible Currents this turn, you may activate their Confluence (free, **once per player per turn**, button appears with both symbols and a rules preview):

| Pair | Confluence | Effect |
|---|---|---|
| Cinder + Tide | **Steamveil** | Choose a friendly character: it cannot be targeted by enemy Actions until your next turn |
| Tide + Root | **Bloom** | Heal a character 3 and summon a 1/1 Sprout follower |
| Root + Gale | **Sandstorm** | Enemy characters get Weakened 1 until your next turn |
| Gale + Pulse | **Tempest** | Deal 1 damage to up to 3 enemy characters, OR a friendly character may attack again |
| Pulse + Cinder | **Starflare** | Deal 4 damage to a character; this ignores Shielded (Armor still applies) |
| Cinder + Veil | **Blackflame** | Deal 2 damage to a character; it can't be healed until your next turn |
| Root + Halo | **Sanctuary** | Give a friendly character Shielded and remove one negative status from it |
| Halo + Veil | **Eclipse** | All Location, Event, and aura effects are disabled for both players until your next turn |
| Prism + any | **Refraction** | The next card of the paired Current you play this turn triggers its on-play effect twice |

All Confluence rules are inspectable in-match.

### 8.6 Deck construction & Currents
- A Leader has a **Primary Current** and may have a **Secondary Current**.
- Deck cards must belong to the Leader's Primary or Secondary Current; up to **3** Prism cards may be splashed regardless (`deck.prismSplashLimit`).
- **Pure decks** (all cards one natural Current, no Prism splash) unlock **Perfect Resonance**: after playing 7 cards of that Current in a match (`resonance.threshold`), a one-time Current-specific bonus activates (defined per Current in `data/currents.json`).
- **Dual decks** trade Resonance for Confluence access (their two Currents' pair).
- **Prism leaders** (Cosplay Champions, Meme Collective) build Prism-primary decks: maximum flexibility, but Prism cards are costed ~1 higher or statted lower, enforced at design time.
- No elemental resource exists. Everything uses Hype.

### 8.7 Balance guardrails (binding)
- Advantage = exactly +1 damage unless a card states otherwise. No double damage, no resistances.
- No Current can fully lock out another; every Current gets both offensive and defensive tools.
- One Confluence per player per turn (cards may state rare exceptions).
- Random Current-changing effects are rare (Epic+ only) and clearly worded.
- Pure and dual decks must both be viable; competitive play must not require Prism.

---

## 9. Rarity & Variants

Rarities: **Common, Rare, Epic, Legendary** — representing complexity and collectability, *not* raw power. Craft/dust values in `data/balance.json` (`economy.craftCost`, `economy.dustValue`).

Cosmetic variants of any card (same rules identity, `variantOf` field): **Animated Premium**, **Alternate Art**, **Event Variant** (e.g. seasonal). Variants are never gameplay-affecting.

---

## 10. Non-negotiable product principles

- **No pay-to-win.** All gameplay-affecting cards obtainable via play; money buys cosmetics and time-savers with published exact probabilities, duplicate protection, pity/guarantee progress, spending controls, and direct crafting. No hidden odds, fake discounts, misleading timers, or FOMO pressure loops.
- **Readable first.** Information never depends on color alone; all animations skippable/shortenable after first view; reduced-motion, colorblind, high-contrast, scalable text supported.
- **Deterministic engine.** Same seed + same action log ⇒ same result, always. Replays and server authority depend on this.
- **Data-driven.** Cards, keywords, factions, currents, balance, missions, and events are JSON — adding content must not require engine changes for existing mechanic types.
