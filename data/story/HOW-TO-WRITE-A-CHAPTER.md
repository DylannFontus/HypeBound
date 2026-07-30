# How to write a story chapter

**You do not need to know anything about this project, and you will not touch any
code.** A chapter is one plain text file in this folder. Write it, save it, and
it is in the game.

---

## Start here

1. Copy `TEMPLATE.story.txt` and give it a new name ending in `.story.txt` —
   for example `02-the-server-is-closing.story.txt`.
2. Open it in any text editor (Notepad is fine).
3. Write.
4. Save.

Chapters are listed in **file-name order**, so numbering them at the front
(`01-`, `02-`, `03-`) is how you decide what comes first.

You can rename a file freely — progress is tracked by the chapter's **title**,
not its file name, so reordering the campaign never wipes anyone's save.

### Seeing your changes

If somebody has started the game for you with `npm run dev`, save the file and
the browser reloads by itself. Otherwise open the game and go to
**Play → Story Chapters**.

**If you get something wrong, nothing breaks.** Your chapter appears on the
story list with a red card saying exactly which line is wrong and what to do
about it. Every other chapter still works. Fix the line, save, and it comes back.

You can also check every chapter without opening the game at all, by running:

```
npm run story
```

---

## The five things you can write

### 1. Somebody says something

Put their name, a colon, then what they say.

```
Lumi Starcall: Positions.
Rin Halfstep: Sorry — sorry — the door was open —
```

That is the whole rule. You never introduce a character, register them, or list
them anywhere. Writing a new name is how a new character exists.

Put a mood in brackets to change their expression:

```
Lumi Starcall (smiling): Breathe. Then name.
PPX-9 (offline): AUDIENCE COUNT: ZERO.
```

Any word works as a mood. It shows on screen next to their name.

### 2. Narration

Anything the reader sees that nobody says out loud:

```
NARRATION: There are no positions. There is no one to take them.
```

Use `POST:` instead to show it as a social-media post:

```
POST: Vertical video, badly stabilised. 11,204 likes. Comments disabled.
```

### 3. A choice

```
CHOICE: What do you say to that?
  * Then you're late for rehearsal.
      Lumi Starcall: Warm-ups. Eight counts. Go.
  * There is no unit left to understudy.
      Lumi Starcall: Third understudy. To a unit of one.

Rin Halfstep: Okay.
```

Each option starts with a `*`. **The lines under an option must be indented
further than the `*`** — that is what makes them belong to it. Two extra spaces
is plenty; tabs work too.

Lines that go back to the left (like `Rin Halfstep: Okay.` above) play whichever
option was picked. That is how the story comes back together.

### 4. Remembering, and reacting later

`REMEMBER:` writes something down. It lasts for the whole chapter — later
episodes can still read it.

```
REMEMBER: she stayed              ← remembers that it happened
REMEMBER: tone is warm            ← remembers a word
REMEMBER: rin trust + 1           ← counts up; starts at 0
```

`IF` reads it back. The lines under it only play when it is true.

```
IF she stayed:
  Lumi Starcall: You're still here.

IF tone is warm:
  Nova Encore: I heard you were kind about it.
OTHERWISE:
  Nova Encore: I heard you weren't.

IF rin trust is at least 2:
  Rin Halfstep: Ask her what happens to the name afterwards.
```

You can also write `IF NOT she stayed:` and `IF tone is not warm:`.

**Flags cross chapters.** If Chapter 1 wrote `REMEMBER: invited vex`, then
Chapter 3 can write `IF invited vex:` and it just works — no extra syntax, and
the game will still tell you if you misspell it. That is how a decision in one
chapter pays off in another. Your chapter's own flags always win if two chapters
happen to use the same name.

To remember that something *didn't* happen, say so — `REMEMBER: she stayed is
false` — and `IF she stayed:` will correctly not run. The words `false`, `no`,
`none`, `never` and `off` all mean no.

Names are just words — `REMEMBER: Rin Trust + 1` and `IF rin trust is at least 1`
are the same thing. Spelling matters, capitals do not.

> If you check something nothing ever remembers, the game tells you, and offers
> the closest name you did use. That catches typos before a player ever sees one.

### 5. A battle

```
BATTLE: Vex Klipp
  PLAYS: Cyra Swipe
```

Only the first line is required — it is the name shown to the player. Everything
below it is optional, and the lines must be at the same indentation or further in.

| Line | What it does | If you leave it out |
|---|---|---|
| `PLAYS: Cyra Swipe` | Which character's cards they fight with. A person or a whole faction. | The name after `BATTLE:` is used, if it is somebody the game knows |
| `YOU PLAY: Lumi Starcall` | Hands the player a ready-made deck for this battle | The player brings their own deck |
| `DIFFICULTY: casual` | How hard the opponent plays | `casual` |
| `THEIR HEALTH: 22` | Their starting leader health | 30 |
| `YOUR HEALTH: 25` | The player's starting leader health | 30 |
| `THEIR ARMOR: 10` | Armor the opponent's leader starts with. Armor soaks damage point for point and is never healed | none |
| `YOUR ARMOR: 10` | Armor the player's leader starts with — use both for a long, low, survivable fight | none |
| `GOES FIRST: them` | Who takes the first turn (`you` or `them`) | A coin flip |
| `RULE: clip farm` | A special rule for this battle. Repeat the line for more than one | No special rules |
| `WAVES: the support queue` | Reinforcements that keep arriving during the battle. One set per battle | Nobody arrives |
| `THEIR CARDS: Neon Idols` | Only needed when the character you named has no cards of their own | Worked out for you |

Add lines that play after a loss with `IF YOU LOSE:` — then the battle is
offered again.

```
BATTLE: Vex Klipp
  PLAYS: Cyra Swipe
  DIFFICULTY: beginner
  RULE: clip farm
  IF YOU LOSE:
    Lumi Starcall: Again.

Lumi Starcall: That's the show, everybody.
```

Losing a story battle costs nothing. After the first loss on any battle the
player is offered **Story Assist** — five extra health, same rewards.

### 6. An optional part, opened by a decision

Sometimes a decision should buy the player a whole extra scene. Give that part a
**side cut** heading instead of an episode heading, and say what opens it:

```
=== SIDE CUT: The Long Walk
UNLOCKED BY: she stayed

NARRATION: Forty minutes of pavement and nobody says anything for the first ten.
```

`UNLOCKED BY:` reads a memory exactly like `IF` does, so
`UNLOCKED BY: rin trust is at least 2` works too. It must be the line straight
underneath the heading.

A side cut is **always optional**. It shows up in the episode list wherever you
put it in the file, with a dashed edge — and if the player did not unlock it, it
still shows up, greyed, with your own words printed as the reason:

```
◇  The Long Walk        Side cut — opens if you she stayed
```

So write the memory as something that reads well in that sentence: `said it out
loud` gives *"opens if you said it out loud"*, which is what you want.

Playing it is never required. The chapter counts as finished without it, and the
"3 of 5 played" count ignores it entirely — a player who took the other option at
the decision can still finish everything.

---

## Names you can use

You never type an id or a code. If you misspell a name, the game tells you the
closest one that would have worked.

### Difficulty

`beginner` · `casual` · `intermediate` · `advanced` · `expert` · `boss`

Everyday words work too: `easy`, `normal`, `medium`, `hard`, `very hard`,
`nightmare`, `impossible`.

### Factions

Neon Idols · Gothic Royalty · Viral Influencers · Corporate Creators ·
Digital Demons · Cosplay Champions · Afterparty Crew · Touch-Grass Order ·
Algorithm Syndicate · Meme Collective

Naming a faction in `PLAYS:` or `FACTION:` is always allowed, and picks that
faction's first leader.

### Characters you can fight

| Faction | Leaders |
|---|---|
| Neon Idols | Lumi Starcall · DJ Kilowatt |
| Gothic Royalty | Countess Morvina Vane · Alaric Thornheart |
| Viral Influencers | Blayze Trendall · Cyra Swipe |
| Corporate Creators | Cressida Vale · Sterling Bright |
| Digital Demons | Ashvyre · The Blue Screen Baron |
| Cosplay Champions | Vera Foamhammer · Kiko Thousand-Faces |
| Afterparty Crew | DJ Last Call · Half-Four Mari |
| Touch-Grass Order | Prioress Juniper Vale · Coach Rhett Halloran |
| Algorithm Syndicate | Don Sortino · Cassia Cache |
| Meme Collective | Chairperson Nobody · Skree Nine-Tabs |

You can also fight any **boss**, and their cards are sorted out for you:

Prisma, the Final Encore · The Widow of Dead Fandoms · King Ratio ·
The Executive Producer · GLITCHLORD_EXE · The Grand Cosplayer ·
The Groundskeeper · The Recommendation · The Living Meme

> There is also a boss called DJ Last Call, who shares a name with the Afterparty
> Crew leader. Typing `DJ Last Call` always gets the leader; to fight the boss,
> write `PLAYS: boss-dj-last-call`.

### Battle rules

Written as `RULE: the crowd carries you`. Capitals and punctuation do not matter.

| Rule | What it does |
|---|---|
| **Clip Farm** | At the end of *their* turn, if they played 2 or more cards, they draw a card |
| **The Room Remembers** | At the start of your turn, if you control 3 or more characters, a random one gets +1/+1 |
| **Every Post Costs** | Whenever you play a card, deal 1 damage to your own leader |
| **Sponsor Segment** | At the start of your turn, a random card in your hand costs (1) more |
| **Suppressed Reach** | A random card in your hand costs (1) more each turn — and you draw an extra one at the end of it |
| **Autocomplete** | A random card in your hand costs (1) less each turn — and it deals 1 damage to your leader at the end of it |
| **Running on Fumes** | Maximum Hype is 6 for both players, and you draw an extra card each turn |
| **Hall Repair** | At the start of your turn, restore 1 health to each damaged friendly character |
| **Punchline Recursion** | Whenever you play an Action, a copy comes back to your hand costing (1) more |
| **Going Live** | *They* draw an extra card on their first turn |
| **Blown Fuse** | The first card you play each turn costs you 1 Hype next turn |
| **The Crowd Carries You** | At the end of your turn, if you control 3 or more characters, restore 2 health to your leader |
| **She Won't Swing First** | *Their* characters arrive Weakened — 1 less attack until their next turn |
| **The Court Reconvenes** | The first time each turn one of your characters is defeated, draw a card |
| **Nobody Really Dies Here** | The first character you lose each turn stands back up at 1 health |
| **It Came Back** | The same thing, aimed the other way — the first character *they* lose each turn stands back up |
| **Thirty Days' Notice** | At the start of your turn your leader takes 1 damage and you draw a card |
| **Best Mistake** | The first character you lose each turn leaves a 1/1 Glitchling behind |
| **Signal Dead Zone** | *Your* Fixation costs 2 more Obsession — you have no reception and they don't need any |

Rules are written by whoever maintains `rules.json` in this folder. If you want
one that does not exist, ask — you should never have to edit that file.

### Waves

Written as `WAVES: the support queue`. One set per battle.

A wave set is reinforcements that keep arriving *during* the fight, in a stated
order, on a stated cue. Use it when the point of the scene is that they keep
coming — a queue that will not go down, a crowd that will not disperse, a room
that keeps filling up. Use `RULE:` instead when the point is that the fight is
played differently.

| Wave set | What arrives |
|---|---|
| **The Support Queue** | Three bands land on *their* board — at nine, at noon, and on the Thursday. Each one arrives as soon as their side is empty, and arrives anyway on its scheduled turn if it is not |

The player is told the whole schedule on the pre-battle brief before a card is
dealt — every wave, what is in it, and what brings it. That is the point of a
wave set: it is a fight you can count down. Nothing in a wave can attack the
turn it lands, and nothing in it counts as a card the opponent played.

Wave sets live in `waves.json` in this folder, next to `rules.json`, and the
same rule applies: if you want one that does not exist, ask.

---

## Things worth knowing

**Blank lines and notes.** Blank lines never matter, use as many as you like.
A line starting with `#` is a note to yourself and never appears in the game.

**Punctuation is safe.** There is nothing to close, quote or escape. Apostrophes,
dashes, ellipses, emoji and colons inside a sentence are all fine —
`Lumi Starcall: Track nine: the encore.` works exactly as written.

**Narration with a colon early on.** The game decides who is speaking by looking
before the first colon, so a narration line like `The sign reads: CLOSED` would
be read as a character called "The sign reads". It will refuse rather than guess,
and tell you to write `NARRATION:` at the front. That is the fix.

**Reserved words.** These mean something to the game and cannot be character
names: `TITLE`, `FACTION`, `ABOUT`, `LOCKED UNTIL`, `EPISODE`, `SIDE CUT`,
`UNLOCKED BY`, `NARRATION`, `POST`, `CHOICE`, `REMEMBER`, `IF`, `OTHERWISE`,
`BATTLE`, `PLAYS`, `YOU PLAY`, `THEIR CARDS`, `DIFFICULTY`, `YOUR HEALTH`,
`THEIR HEALTH`, `YOUR ARMOR`, `THEIR ARMOR`, `GOES FIRST`, `RULE`, `IF YOU LOSE`.

**Locking a chapter behind another.** Put this at the top of the file, under
`TITLE:`, naming the other chapter exactly as its own `TITLE:` line does:

```
LOCKED UNTIL: Encore, Please
```

**Choices are permanent.** A player gets one version of a chapter per save. To
see the other side of a decision they replay the chapter, and the chapter screen
has a button for exactly that.

**No real people.** Every character is invented. The comedy is about behaviour
and systems — never about a real person or a real group.

**Branches change the story, never the rewards.** Every path through a chapter
pays the same. A decision buys story, not power.

---

## A complete, very short chapter

```
TITLE: A Very Short Chapter
FACTION: Neon Idols
ABOUT: An example, for reference.

=== EPISODE: The Only Episode

NARRATION: An empty arena, at three in the morning.

Lumi Starcall: Positions.
PPX-9 (offline): AUDIENCE COUNT: ZERO. PLAYING ANYWAY.

CHOICE: Does she stop?
  * Stop the music.
      REMEMBER: she stopped
      Lumi Starcall (quiet): ...Poppy. Kill the track.
  * Play it anyway.
      Lumi Starcall (radiant): From the top!

BATTLE: Vex Klipp
  PLAYS: Cyra Swipe
  DIFFICULTY: beginner
  IF YOU LOSE:
    Lumi Starcall: Again.

IF she stopped:
  NARRATION: The house lights come up. It is enormous, and empty, and over.
OTHERWISE:
  NARRATION: The encore plays out to twelve thousand empty seats. It always does.
```
