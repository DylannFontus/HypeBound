# HYPEBOUND — Full Requirements Brief (verbatim intent from project owner)

> This file preserves the complete original specification. It is the
> completeness checklist for all design docs and implementation phases.
> Canonical rules decisions derived from it live in `docs/design/00-core-rules.md`.

## Platform & technology
- Hearthstone-like gameplay; owner supplies AI-generated card art later (game must run with placeholder art keyed by card id).
- Code must be malleable: adding/modifying cards, real music files, new game modes and mechanics must be easy, without breaking the game and without needing AI assistance.
- Premium feel in card frame design (not the art itself) and gameplay visuals.
- Board like the Hearthstone reference image but slightly more 3D with a slightly more top-down view.
- three.js; playable on PC via browser and on mobile (landscape mode only). Mouse is the main input; touch supported.
- Take time; features and code must be high quality.

## Theme
Comedic, exaggerated internet-culture theme: fandoms, streamers, influencers, virtual idols, online celebrities, meme communities, digital demons, cosplay champions, fan clubs, conventions, social-media rivalries. Stylish anime-inspired presentation, self-aware humor, dramatic characters, satire about being chronically online. Must remain entertaining even without references/memes.

## Core vision
- Easy to understand; supports advanced deck building, combos, counterplay, competitive mastery.
- Matches last ~5–12 minutes.
- Combat UI clearly communicates: valid targets, damage predictions, status effects, triggered abilities, card history, available actions.
- Primary resource: **Hype** (increases naturally each turn, spent to play cards).
- Secondary system: **Obsession** (chosen from Attention/Influence/Momentum/Obsession) — meaningful strategic choices, not a second currency; rewards repeatedly supporting a character; risky when too high.
- Card categories: Leader, Character, Action, Reaction, Equipment, Location, Transformation, Event.
- Thematic keywords: Viral, Spotlight, Parasocial, Trending, Collaboration, Cancelled, Comeback, Afterparty, Raid, Touch Grass — all clearly defined; consistent templating system.

## Factions (each needs: visual identity, color language, strategy, strengths, weaknesses, signature mechanics, unique leaders, several deck archetypes)
1. **Neon Idols** — teamwork, buffs, performances, long combo chains; stronger with several performers active.
2. **Gothic Royalty** — curses, healing, sacrifice, resurrection; slow strategies that grow over time.
3. **Viral Influencers** — follower tokens, copied effects, trends, spreading abilities; fast board fill; weak to AoE.
4. **Corporate Creators** — sponsorships, contracts, resource generation, expensive finishers; lots of Hype but needs preparation.
5. **Digital Demons** — risky power, corruption, glitches, transformations; power at unpredictable/dangerous cost.
6. **Cosplay Champions** — equipment, costumes, alternate forms, adaptation; abilities change with equipment.
7. **Afterparty Crew** — end-of-turn abilities, delayed effects, chaotic interactions; rewards predicting future board states.
8. **Touch-Grass Order** — control; removes buffs, stops trends, counters combos; outdoor/park/mountain/sports visual identity contrasting digital factions.
9. **Algorithm Syndicate** — card draw, deck manipulation, recommendations, controlling upcoming cards; enables planning.
10. **Meme Collective** — bounded randomness, repeated jokes, unusual interactions; unpredictable but not pure luck.

## Match structure (must define)
Deck size; max copies; starting hand; mulligan; max board size; leader health; Hype progression; turn timer; fatigue; card draw; combat; targeting; status effects; victory/defeat conditions. Alternate win conditions for specific archetypes, with counterplay windows.

## Card rarity
Common, Rare, Epic, Legendary + animated premium variants, alternate artwork, special event variants. Rarity = uniqueness/complexity/collectability; Legendaries not automatically stronger.

## Game modes (design all)
Interactive tutorial; AI practice; casual constructed; ranked seasonal ladder; draft/arena; roguelike single-player campaign; character story chapters; daily challenges; weekly rotating rule modifiers; puzzle battles; limited-time events; boss battles; co-op raid encounters; custom matches; friend battles; tournament mode; spectator mode; match replays; training sandbox; offline AI matches.

## Ranked mode
Placement matches; divisions; MMR; seasonal resets; rank protection at milestones; seasonal cosmetic rewards; leaderboards; deck statistics; anti-smurfing; anti-cheat; reconnection. No competitive advantage from spending money.

## Roguelike campaign
Small temporary starting deck; branching paths; normal/elite fights; random events; temporary cards; card upgrades; passive artifacts; shops; healing nodes; temporary recruits; narrative decisions; faction-themed bosses. Runs feel different but plannable.

## Story campaign
Chapters per major leader/faction. Themes: online fame, rival communities, friendship, competition, creativity, burnout, algorithm changes, virtual worlds, conventions, teamwork, online vs real identity. Dialogue sequences, animated portraits, battle encounters, branching decisions.

## Collection interface
Text search; filters (faction, cost, rarity, type, keyword, ownership); grid + detail views; animated previews; favorites; locks; crafting; dismantling; duplicate protection; missing-card indicators; suggested replacements; card-lore pages; card interaction explanations.

## Deck builder
Resource curve; type distribution; faction restrictions; validation; suggested cards/replacements; auto deck generation; AI-assisted building; naming; custom covers; leader selection; card-back selection; import/export codes; multiple saved slots; per-deck stats; immediate AI testing; compare deck versions.

## Banner & card-pack system
Premium banner page: featured art, name, duration, featured cards, interactive previews, 1-pack & 10-pack options, currency balances, exact probability rates, guaranteed-card progress, opening history, duplicate-conversion details, first-time rewards, banner rules, animation skip, wishlist, targeted-card system.
**Forbidden:** hidden probabilities; fake discounts; misleading countdowns; changing odds; real-money-exclusive cards; unhealthy-playtime pressure.
**Required:** duplicate protection; direct crafting; published probabilities; spending controls; reliable free progression; catch-up for new players; returning-player rewards; event reruns; guaranteed-card progress; free starter decks. Cosmetics-first monetization: card backs, leader skins, portraits, emotes, battlefields, profile frames, intro/victory animations, alt art, holo effects, music packs, UI themes.

## Progression
Account level; faction mastery; leader mastery; character affinity; daily/weekly missions; achievements; seasonal battle pass; ranked rewards; login rewards; event currencies; crafting materials; titles; cosmetic unlocks. Rewards experimentation and regular play, no unhealthy playtime requirements, seasonal catch-up.

## Required screens (design + navigation between them)
Splash; loading; login; account creation; cloud-save selection; onboarding; main lobby; mode selection; ranked overview; collection; deck builder; character gallery; banner page; pack opening; shop; crafting workshop; battle pass; daily missions; weekly missions; achievements; event hub; story campaign map; roguelike campaign map; friends list; guilds/communities; inbox; reward claim; player profile; match history; statistics dashboard; leaderboards; news; patch notes; settings; accessibility settings; probability disclosures; privacy info; legal info; customer support.

## Main lobby
Shows: selected leader (animated bg), big Play button, current deck, ranked division, daily mission progress, active events, featured banner, battle-pass progress, online friends, unclaimed rewards, news carousel, currency balances. Play/Collection/Deck Builder always easy to find; promos never dominate or hide navigation.

## Battle interface
Both leaders + health; Hype; Obsession meter; hand; deck counter; discard counter; board slots; turn timer; end-turn; action history; settings; emotes; status inspection; card enlargement; targeting arrows; damage previews; healing previews; trigger-order display; victory/defeat sequences. Animations exciting but fast; skippable/shortenable after first view.

## Visual direction
Digital nightlife: neon signs, arcades, virtual concert stages, streaming studios, convention halls, futuristic cities, glossy black, chrome, glass panels, holographic card effects; purple/blue/pink/red/gold accents; social-notification motifs, live-chat references, follower counters, meme VFX, dramatic anime characters. Readable, not overloaded; important info never color-only.

## Audio direction
Faction themes; dynamic battle music; leader intro lines; card voice lines; ability SFX; victory/defeat music; pack-opening sounds; menu ambience; event music; streamer-safe setting. Separate volumes: music, voice, interface, battle effects, ambient.

## Social systems
Friends; online status; direct challenges; deck sharing; spectating; guilds/clubs; guild missions; friendly tournaments; emotes; moderated communication; reporting; blocking; privacy controls. No unrestricted public voice chat; safe defaults; strong moderation.

## Eight Currents elemental system
(Canonicalized in 00-core-rules.md §8 — includes: 8 Currents with icon/frame/VFX/SFX/lore/strategy each; First Signal & Great Fracture lore; per-Current identities and signature keywords: Scorched, Flow, Grow, Rushwind, Overload, Inspire, Corrupt, Refract; advantage cycle Cinder→Gale→Root→Pulse→Tide→Cinder +1 dmg; Halo↔Veil mutual; Prism neutral w/ Refract; 9 Confluences: Steamveil, Bloom, Sandstorm, Tempest, Starflare, Blackflame, Sanctuary, Eclipse, Refraction; one Confluence per player per turn; leader Primary/Secondary Current deck rules + Prism splash limit; Perfect Resonance for pure decks; no separate elemental resource; interface requirements: name+symbol+frame+badge+animation, in-game interaction guide, advantage indicator + damage preview, confluence preview, accessibility reinforcement; balance guardrails; example leaders/cards/statuses/archetypes for every Current, weakness interaction, and Confluence.)

## Accessibility
Scalable text; reduced motion; color-blind modes; high contrast; subtitles; screen-shake control; animation-speed control; keyboard nav; controller support; mouse primary; touch support; remappable controls; icon labels; audio cues; detailed card-text explanations.

## Technical architecture
Data-driven (cards/factions/keywords/missions/events/balance in JSON); deterministic battle engine; separation of rules vs presentation; server-authoritative multiplayer (designed); reconnection; replays from action logs; secure auth; cloud saves; versioned player data; automated card validation; unit tests for card interactions; AI difficulty levels; localization; responsive desktop+mobile; performance budgets. Modular folders: card defs, rules engine, battle state, deck management, player profiles, inventory, progression, missions, events, matchmaking, networking, AI, UI, audio, VFX, save data, analytics, testing.

## AI opponents
Levels: Beginner, Casual, Intermediate, Advanced, Expert, Boss. Understands: resource efficiency, board control, trading, combos, win conditions, defensive/aggressive play, long-term planning. Boss AI may use unique cards/rules.

## Required design documents
Complete GDD; core gameplay loop; match-flow diagram; screen-navigation diagram; card data schema; example cards for every faction; keyword glossary; faction identity guide; economy model; progression model; UI component list; multiplayer architecture; AI design; development milestones; testing plan; initial balance assumptions; placeholder art requirements; animation requirements; audio requirements.

**Priority: a genuinely enjoyable, readable, strategically deep card game.**
