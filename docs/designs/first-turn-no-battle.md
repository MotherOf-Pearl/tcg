# First Turn — Neither Player Can Battle

Status: DESIGN (solution-architect pass). Rules-sensitive — must be audited by rules-compliance-agent before coding.

## Problem

Per **§6-5-6-1** ("Neither player can battle on their first turn."), *both* players are forbidden from initiating an attack during their own first turn. The current engine check (`server.js:1513` and `server.js:1583`) reads:

```
if (game.turn === 1 && game.activePlayer === game.firstPlayer) { reject }
```

This only blocks the *first player's* first turn (game-turn 1). Under the engine's strictly alternating turn model (`doEnd` at server.js:1026-1027 flips `activePlayer` and increments `game.turn` in lockstep), the **second player's** first turn is game-turn 2 — and is **not** blocked. Live prod confirms: P2 can attack on turn 2. The invariant in §6-5-6-1 is about "the attacker's first turn", not "game-turn 1".

The hypothesis in the bug report is correct and verified at both attack-initiation sites in `server.js`.

## Scope

- **In scope:**
  - Correct the first-turn battle prohibition so both players are blocked on their respective first turns.
  - Centralise the predicate behind a named helper (`isAttackerOnTheirFirstTurn(game, playerId)` or equivalent) so future call sites cannot reintroduce the literal `game.turn === 1` check.
  - Audit every existing attack-initiation site and apply the corrected predicate.
  - Confirm the rule layers cleanly with §3-7-4 (summoning-sickness) and §10-1-1-1 ([Rush]): [Rush] overrides §3-7-4 only, **never** §6-5-6-1.
- **Out of scope:**
  - The `playedThisTurn` / [Rush] check at server.js:1518 and server.js:1586 — that gate is correct and stays as-is.
  - Refactoring the broader battle pipeline (DECLARE_ATTACK → SELECT_TARGET → COUNTER_STEP → RESOLVE_ATTACK).
  - Any change to the legacy `ATTACK` case beyond the predicate swap (the legacy path is suppressed by battleState anyway, server.js:1555).
  - Any UI/UX redesign — the error message is already surfaced via the existing toast path.
- **Cards/keywords/phases affected:**
  - Phase: MAIN (attack initiation only).
  - Keywords: [Rush] — verify it does not bypass §6-5-6-1.
  - Cards exercising the [Rush] path today (printed `[Rush]` or `gains [Rush]`): **OP09-004 Shanks** (printed [Rush]), **ST04-003 Gee, Infernal Hound-Shlawg** ([On Play] grants [Rush] for the turn), **ST07-003 Colossus, Slinger of Stone** (conditionally grants [Rush] for the turn). These are the cards the test author should exercise to confirm §10-1-1-1 does not override §6-5-6-1.

## Design

### Rules basis (citations)

- **§6-5-6-1** — "Neither player can battle on their first turn." The load-bearing rule. Applies to both players, indexed by the *attacker's* personal first turn, not by game-turn 1.
- **§3-7-4** — "Played cards cannot attack on the turn in which they are played unless otherwise…" Summoning sickness. Independent of §6-5-6-1; already enforced via `attacker.playedThisTurn` at server.js:1518/1586.
- **§10-1-1-1** — "[Rush] is a keyword effect that allows a Character card to attack during the same turn in which it is played." [Rush] is an *override of §3-7-4 only* — the rule grants exemption from summoning sickness, not from the first-turn battle prohibition. A [Rush] Character on its controller's first turn is still bound by §6-5-6-1 and **cannot** attack.
- **§6-3-1** — Confirms the asymmetric turn structure (going-first does not draw on turn 1) which proves the engine already models per-player first turns in other places (server.js:1267 for DRAW_DON amount). The fix can reuse the same predicate shape: `game.turn === 1 && playerId === game.firstPlayer` for first player, and the equivalent for second player.

### The correct invariant

Define **"attacker's first turn"** precisely. Under the current alternating-turn architecture:

- P1's first turn ↔ `game.turn === 1 && playerId === game.firstPlayer`
- P2's first turn ↔ `game.turn === 2 && playerId !== game.firstPlayer`

Equivalently (and this is the property the engine should encode): an attacker is on their first turn iff **they have not yet ended a turn**. Block attacks during their first turn.

### Data model

Two candidate shapes were considered.

#### Option (a) — Explicit per-player flag (recommended)

Add to `createPlayerState` / each entry in `game.players`:

```
players[pid].hasTakenFirstTurn = false;   // initialised at game start
```

Set to `true` at the moment that player's first turn *ends*. Concretely: inside `doEnd` (server.js:1006), right before the `activePlayer` flip, set `game.players[endingPlayerId].hasTakenFirstTurn = true;`. After this, the player has, by construction, taken their full first turn (DRAW → DON → MAIN → END), and §6-5-6-1 no longer applies to them.

The predicate becomes:

```
function isAttackerOnTheirFirstTurn(game, playerId) {
  return !game.players[playerId].hasTakenFirstTurn;
}
```

#### Option (b) — Derived from existing state

```
function isAttackerOnTheirFirstTurn(game, playerId) {
  // Strictly alternating turns: P1's first = turn 1, P2's first = turn 2.
  return game.turn <= 2;
}
```

Simpler — but assumes strict turn alternation forever. The moment a card (current or future) grants an extra turn, skips a turn, or otherwise breaks the `game.turn ∈ {1,2} ⇔ first-turn` equivalence, this predicate silently produces the wrong answer.

#### Recommendation: **Option (a)**

Per the architect's hard constraint on scalability, option (b) bakes in "strictly alternating turns" as an engine-wide invariant. We do not have such a card today, but the One Piece TCG / Boohaw design space includes mechanics like "Take an extra turn after this one" or "Skip your opponent's next turn" as well-known archetypes in adjacent TCGs. An explicit per-player flag survives those generalisations untouched. The cost is one boolean per player and one assignment in `doEnd`. Negligible.

The predicate is centralised in one helper so the next time it's needed it is not re-derived inline; the descriptor-coverage test pattern from the window-lifecycle design (`docs/designs/window-lifecycle.md`) is the model — one source of truth, every call site funnels through it.

### Engine changes

1. **State init.** Inside `createPlayerState` (or wherever players[pid] is constructed in `createGame` at server.js:631-635), add `hasTakenFirstTurn: false`.
2. **State transition.** In `doEnd` (server.js:1006), immediately before `game.activePlayer = ids.find(…)` at line 1026:
   ```
   game.players[endingPlayerId].hasTakenFirstTurn = true;
   ```
   `endingPlayerId` is already captured at line 1008. No new variable needed.
3. **Helper.** Add a free function near the existing `hasRush` / keyword helpers (around server.js:3431):
   ```
   function isAttackerOnTheirFirstTurn(game, playerId) {
     const p = game.players[playerId];
     return !p || !p.hasTakenFirstTurn;
   }
   ```
   Defensive: an unknown playerId is treated as "first turn" (fail-closed — reject the attack rather than silently allow it).
4. **Call-site swap.** Replace the broken check at **both** attack-initiation sites:
   - **server.js:1513 (legacy `ATTACK`)** — note this path is normally short-circuited by `if (game.battleState) break;` at line 1555 once `DECLARE_ATTACK` is in flight, but is still reachable on the very first attack of a turn before battleState exists. Fix it for completeness:
     ```
     if (isAttackerOnTheirFirstTurn(game, playerId)) {
       send(playerId, { type:'ERROR', msg:'Cannot attack on your first turn (§6-5-6-1).' });
       return;
     }
     ```
   - **server.js:1583 (new `DECLARE_ATTACK`)** — same replacement.

   The error message includes the rule cite per the architect persona's expectation that rules-sensitive rejections carry their source. The client toast renders the message verbatim.
5. **No change to [Rush] handling.** The [Rush] check at server.js:1518/1586 stays exactly where it is. The first-turn gate runs **before** the [Rush] check, so a [Rush] character on the controller's first turn is rejected by `isAttackerOnTheirFirstTurn` before [Rush]'s §10-1-1-1 exception is even considered. This is the correct rule-layer order: §6-5-6-1 (global) → §3-7-4 (per-card summoning sickness) → §10-1-1-1 ([Rush] override of §3-7-4).

### Enforcement-site audit

The architect persona's third rule is "every design must answer scalability". For this bug that means: identify *every* path that initiates an attack and confirm all of them route through the corrected predicate.

Grep results show **exactly two** attack-initiation sites in `server.js`:

- `case 'ATTACK'` at server.js:1506 — legacy path.
- `case 'DECLARE_ATTACK'` at server.js:1571 — new pipeline path. (`battleState` assignment at server.js:1595.)

No card effect today auto-declares an attack on the controller's behalf. Pipeline triggers that fire `[When Attacking]` (server.js:1547, 1330-area) all run **after** a player-initiated `DECLARE_ATTACK`, so they inherit the guard implicitly. There is no rules-text in the current `CARD_DB` that says "this card attacks automatically" or "force an attack" — confirmed by grepping for `attack` in ability strings; all hits are passive/buff effects, not attack-forcing effects.

**Future-proofing:** if a card is ever added with text like "At the start of your turn, this Character attacks", the implementer must route that auto-attack through the same predicate. The architect handoff to coding-agent (below) should call this out. Coding-agent should add a TODO/comment on `isAttackerOnTheirFirstTurn` noting that any future auto-attack mechanism must call it.

### Generalization check

- **Card universe:** the predicate is keyword-agnostic and card-agnostic. It cannot accidentally match a card-name or card-id; it is purely a per-player turn-history flag. Every attack-initiation path (current and future) gates on the same function.
- **Future-proofing:**
  - **A card grants an extra turn** ("Take another turn after this one") — `hasTakenFirstTurn` is set when the player's first END_TURN fires; subsequent turns (including extra ones) all see `hasTakenFirstTurn === true`. Correct.
  - **A card skips a player's turn** ("Skip your opponent's next turn") — if the skipped player never actually takes their first turn, the engine must still leave `hasTakenFirstTurn` false (they have not played a turn). If a "skip" is implemented as "fire doEnd twice in a row", we must NOT set `hasTakenFirstTurn` for the skipped player. Coding-agent: the assignment in `doEnd` is conditional on "the player actually played this turn" — for the bug at hand, every `doEnd` corresponds to a turn the active player actually took, so the assignment is unconditional. If a future skip mechanism is implemented, it must bypass `doEnd` or use a separate code path; this is consistent with how MTG/OPTCG-style skip rules typically work (the turn is not taken, end-of-turn triggers do not fire).
  - **A card lets you choose to "pass" your first turn** — only meaningful if the passer is then treated as having taken a turn. The predicate handles it correctly as long as the pass routes through `doEnd`.
  - **Multiplayer (>2 players)** — out of scope today, but the per-player flag generalises naturally; option (b)'s `game.turn <= 2` does not.
- **Edge cases enumerated:**
  - Player disconnects mid-first-turn, reconnects on second turn — `hasTakenFirstTurn` persists in `game.players[pid]`, broadcast via `GAME_STATE` JSON. Reconnect replays state; predicate is unchanged.
  - [Rush] character played on turn 1 by first player — blocked by `isAttackerOnTheirFirstTurn` *before* the [Rush] check is reached. Verified via the §10-1-1-1 test below.
  - [Rush] character played on turn 2 by second player — same: blocked first-turn before [Rush] is reached.
  - Leader-attack on turn 1 / 2 — same predicate, no special case for leader vs character (the predicate is per-player, not per-card).
  - A player who somehow reaches MAIN of game-turn 3 (their second turn) without `doEnd` having fired their first turn — impossible by construction since `nextPhase`/`doEnd` is the only path that flips `activePlayer`. If a bug ever broke that, this design is one of the things that would fail-closed: the flag stays false and attacks remain blocked.
- **Performance:** O(1) lookup on `game.players[playerId].hasTakenFirstTurn`. No data-structure change. No additional broadcasts (the flag rides on the existing GAME_STATE serialisation).

### Performance

- **Hot paths:** the predicate runs on every `ATTACK` / `DECLARE_ATTACK` action — at most a few per turn per player. Cost is a property read on a 2-entry map. Trivially O(1).
- **Memory:** +1 boolean per player per game. Negligible.
- **State broadcasts:** `hasTakenFirstTurn` is included in the existing JSON.stringify of `game.players[*]`. Adds ~25 bytes per `GAME_STATE` for two players; negligible against the existing ~100KB-typical broadcast size.

### Test strategy

- **Unit tests** (`tests/`):
  - `tests/first_turn_battle_p1.test.js` — P1 has a played character with `playedThisTurn=false`, game-turn 1, `activePlayer === firstPlayer`. `DECLARE_ATTACK` → asserts ERROR "Cannot attack on your first turn (§6-5-6-1)", no `battleState` created. (Regression guard for the already-working case.)
  - `tests/first_turn_battle_p2.test.js` — **THE BUG.** Advance to game-turn 2 (`activePlayer !== firstPlayer`). P2 has a played character with `playedThisTurn=false`. `DECLARE_ATTACK` → asserts ERROR "Cannot attack on your first turn (§6-5-6-1)", no `battleState`. This test FAILS on `main` today and PASSES after the fix.
  - `tests/second_turn_battle_p1.test.js` — Advance to game-turn 3 (P1's second turn). `DECLARE_ATTACK` succeeds (no first-turn error). Verifies the predicate doesn't over-block.
  - `tests/second_turn_battle_p2.test.js` — Advance to game-turn 4 (P2's second turn). `DECLARE_ATTACK` succeeds. Symmetric coverage.
  - `tests/first_turn_rush_does_not_bypass.test.js` — Play **OP09-004 Shanks** (printed [Rush]) on the controller's first turn (requires DON cost setup or test-helper short-circuit). `DECLARE_ATTACK` on Shanks → asserts ERROR with §6-5-6-1 cite, confirming [Rush]/§10-1-1-1 does NOT override §6-5-6-1. Repeat for P1 first turn and P2 first turn. Repeat with the **ST04-003 Gee** [On Play] [Rush]-grant path on turn 1/2 (gain-[Rush] route) and **ST07-003 Colossus** conditional-[Rush] path (conditional-grant route) to cover both "printed [Rush]" and "granted [Rush]" code paths through `hasRush(card)` at server.js:3433-3435.
  - `tests/has_taken_first_turn_flag.test.js` — Direct assertion on the flag transition: `createGame` → both players' `hasTakenFirstTurn === false`. After first `doEnd`: ending player's flag flips to true, incoming player's stays false. After second `doEnd`: both true. Locks the state machine.
- **E2E scenarios** (`.claude/agents/e2e-test-agent.md`):
  - Two-WS-client flow: P1 ends turn 1 → P2 plays a character (cost 0 or use test-config DON) → P2 sends `DECLARE_ATTACK` → asserts client receives ERROR with rule cite, asserts no battle UI appears, asserts P2's character remains un-rested.
  - Two-WS-client flow: P1 ends turn 1, P2 ends turn 2 → P1 attacks on turn 3 → asserts attack proceeds (counter step, resolution, etc.). Verifies the predicate doesn't silently over-block past first turns.
- **Rules-compliance audit needed: YES.** Sections to audit:
  - §6-5-6-1 — the load-bearing rule, error-message cite verbatim.
  - §3-7-4 + §10-1-1-1 — layered with §6-5-6-1; rules-compliance-agent should confirm the rule-layer order matches the engine's gate order ([6-5-6-1 → 3-7-4 → 10-1-1-1]).
  - §6-3-1 — confirm consistency with the existing first-player-no-draw asymmetry (sanity check that the same "first turn" concept is used uniformly across the engine).

## Risks and tradeoffs

- **Flag drift.** `hasTakenFirstTurn` is duplicate state — derivable from `game.turn` and `game.firstPlayer` under the current alternating-turns architecture. The risk is that some future code path mutates one without the other. **Mitigation:** the flag is written in exactly one place (`doEnd`) and read in exactly one place (`isAttackerOnTheirFirstTurn`). A unit test (`has_taken_first_turn_flag.test.js`) locks the invariant. The architect explicitly rejects deriving from `game.turn <= 2` because the duplicate-state risk is lower than the future-coupling risk.
- **Existing ATTACK / DECLARE_ATTACK tests.** Any test that previously called `DECLARE_ATTACK` on turn 2 as the second player expecting success has been masking the bug. Audit needed; expect a small number of test updates where the harness sets `hasTakenFirstTurn = true` for the attacker before declaring (matching pre-fix behaviour intent if the test was about something else, e.g. counter mechanics).
- **Error message wording.** "(§6-5-6-1)" in user-facing toast text is unusual and slightly leaky. The architect accepts this — the persona prefers explicit rule citations for traceability — but a follow-up could move the citation to a server-side log and surface a friendlier toast. Out of scope here.
- **Legacy `ATTACK` path.** Fixing it is technically dead-code maintenance under normal flow (suppressed by `battleState` at server.js:1555), but defence-in-depth is cheap and means there is no second-codepath bug-revival risk. Architect approves the dual fix.
- **What we're choosing not to optimize:** the broader question of whether the engine should fold "first-turn restrictions" into a more general "per-player turn-restriction registry" (alongside the asymmetric DRAW_DON amount at server.js:1267 and the no-draw rule at §6-3-1). That would be a larger refactor and is not justified by this single bug. Logged as future work; not blocking.

## Handoff

Coding-agent: implement per the data model and engine changes above. Specifically:

1. Add `hasTakenFirstTurn: false` to each player's state in `createPlayerState` (or wherever `game.players[pid]` is built in `createGame` near server.js:631).
2. In `doEnd` (server.js:1006), immediately before the `activePlayer` flip at line 1026, set `game.players[endingPlayerId].hasTakenFirstTurn = true;`.
3. Add the `isAttackerOnTheirFirstTurn(game, playerId)` helper next to `hasRush` near server.js:3431. Export it from the module's `exports`/destructure list at the bottom of `server.js` so tests can import it directly.
4. Replace the broken check at **server.js:1513** (legacy `ATTACK`) and **server.js:1583** (new `DECLARE_ATTACK`) with a call to the helper. Error message: `'Cannot attack on your first turn (§6-5-6-1).'`
5. Do NOT touch the `[Rush]` / `playedThisTurn` checks at server.js:1518/1586. They stay; the new first-turn check runs **before** them.
6. Add a TODO comment on `isAttackerOnTheirFirstTurn` noting that any future auto-attack mechanism must call it.
7. Tests as listed under Test Strategy.
8. Pre-deploy gate: unit tests + e2e green; rules-compliance-agent green on §6-5-6-1 / §3-7-4 / §10-1-1-1 / §6-3-1. Then push and deploy per CLAUDE.md.
9. Do not deviate without updating this doc.
