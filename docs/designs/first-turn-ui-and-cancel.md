# First-Turn UI Mirror + Always-Reachable Cancel

Status: DESIGN (solution-architect pass). UX consistency fix layered atop the already-shipped server-side §6-5-6-1 enforcement (commit `207e5a9`, design `docs/designs/first-turn-no-battle.md`). Not rules-sensitive in the strict sense (no rule-semantics change), but rooted in **§1-3-2** ("If a player is required to perform an impossible action for any reason, that action is not carried out") — the corollary being that the client should not present impossible actions as clickable affordances.

## Problem

Two related UX defects observed in live prod testing:

- **Bug 1 — Attack button visible on P2's first turn.** Server-side §6-5-6-1 enforcement is correct (`isAttackerOnTheirFirstTurn` at `server.js:3445`, called from `DECLARE_ATTACK` at `server.js:1590`). The client at `game.html:3963` only checks `game.turn === 1`, which corresponds to *game-turn 1 only* — P1's first turn. When P2 selects their leader on game-turn 2 (P2's first turn), the client computes `cannotAttackTurn1 = false`, sets `canAttack = true`, and renders `#btnAttack`. Clicking it sends `DECLARE_ATTACK` → server rejects with §6-5-6-1 error → toast appears but the action *looks* like it should have worked. Classic "client surfaces an action the server will reject" pattern.
- **Bug 2 — No cancel option when no actions are available.** `selectCard` (`game.html:3855`) selects the card and reveals `#battleBtns` (the wrapping div at `game.html:1260`) **only if** at least one of `canAttack || canActivate` is true (`game.html:3968`). If neither is true (rested character, leader on first turn after Bug 1 is fixed, etc.), `selectCard` early-returns at line 3975 — the card is still marked `.selected` via `cancelSel()` having run + the new `sel = { uid, source }` assignment, but no button group is shown, so the user has no Cancel affordance. The selection sticks until they click another card or click off-board (and the off-board path is gated by `committedToServerWindow` at `game.html:4860`, which is fine for attack mode but still leaves a dead-end "I selected a rested character, what now?" state for non-committed selections).

Root causes:

1. **Bug 1 root.** Client first-turn predicate is stale — it predates `players[pid].hasTakenFirstTurn` (added in `207e5a9`). The server already broadcasts the flag in `GAME_STATE`; the client just isn't reading it.
2. **Bug 2 root.** Cancel-as-CTA lives *inside* `#battleBtns` (`game.html:1264`), so when `#battleBtns` is hidden, Cancel is unreachable. The cancel surface is coupled to having at least one positive action available.

## Scope

- **In scope:**
  - Make `#btnAttack` visibility on a field-card/leader selection depend on `players[myId].hasTakenFirstTurn` in addition to the existing `game.turn === 1` check, so the client mirrors the server gate exactly.
  - Provide a guaranteed-reachable Cancel affordance whenever any local selection state is active (`sel`, `attackMode`, `donAttachMode`, `blockerMode`, `counterMode`).
  - A one-time audit of *all* client-side action-button render conditions to confirm none of them surface a server-rejected action as clickable. This generalises Bug 1.
- **Out of scope:**
  - Any server-side rule change. `isAttackerOnTheirFirstTurn` and `hasTakenFirstTurn` are correct as shipped.
  - Refactoring the wider `selectCard` / button-group taxonomy. Touching `hideAllBtnGroups` (`game.html:3848`) and the ~30 button-group ids it manages is out of scope.
  - The `#globalWindowControls` cancel path — it already works for server-owned interactive windows and is not the gap.
  - Defender-side cancel during BLOCK_STEP / COUNTER_STEP. Those phases have their own button groups with explicit choices and are not "selection sticking" cases.
- **Cards/keywords/phases affected:**
  - Phase: MAIN (selection of own field cards / leader).
  - Keywords: none directly. The generalisation audit covers `[Activate: Main]`, `[Once Per Turn]`, `[Rush]`, DON cost — all already gated client-side, listed below for completeness.
  - Cards: every card; the change is purely structural.

## Design

### Rules basis (citations)

- **§1-3-2** — "If a player is required to perform an impossible action for any reason, that action is not carried out." The principled hook: the engine must not *force* an impossible action, and as a UX corollary the client should not *offer* one. This is the umbrella rationale for the Bug 1 fix and the generalisation audit.
- **§6-5-6-1** — "Neither player can battle on their first turn." Already enforced server-side. The client must mirror it.
- **§7-1-1-1, §8-4-1** — referenced indirectly by `#globalWindowControls` (existing pattern, `game.html:1271`). Confirms the project precedent for "derived UI state driven from server state."

### Data model

No schema or wire-protocol changes. All needed state already flows through `GAME_STATE`:

- `game.players[<pid>].hasTakenFirstTurn: boolean` — already broadcast (`server.js:630` init, `server.js:1030` set on END_TURN, included in the standard `players[*]` serialisation per the prior design doc).
- `game.activeWindow`, `game.activateMainConfirmWindow` — already used by `renderGlobalWindowControls` (`game.html:4891`).
- Client-only state: `sel`, `attackMode`, `donAttachMode`, `blockerMode`, `counterMode` (`game.html:1634`). These are the existing selection flags. No new flags introduced — only a derived predicate (see below).

A single derived predicate is introduced on the client (not in game-state):

```js
// Returns true iff anything is selected — a hand card, a field card, a
// leader, a DON-attach in progress, an attack target picker open, a
// blocker pick in progress, or a counter pick in progress.
function anySelectionActive() {
  return !!(sel || attackMode || donAttachMode || blockerMode || counterMode);
}
```

And a client-side mirror of the server predicate:

```js
// Mirrors server-side isAttackerOnTheirFirstTurn (server.js:3445).
// Reads the authoritative flag broadcast by the server.
function clientIsAttackerOnTheirFirstTurn() {
  const me = game?.players?.[myId];
  return !me || !me.hasTakenFirstTurn;
}
```

### Engine changes

Pure client changes — no server changes.

#### Change 1 — Mirror the §6-5-6-1 gate at the Attack-button visibility site

File: `game.html:3963` (the field/leader branch inside `selectCard`).

Today:
```js
const cannotAttackTurn1 = game.turn === 1;
```

Change to:
```js
// Mirror server-side §6-5-6-1 (isAttackerOnTheirFirstTurn, server.js:3445).
// game.turn === 1 only catches the first player; this also catches P2's
// first turn (game-turn 2 with hasTakenFirstTurn still false).
const cannotAttackFirstTurn = clientIsAttackerOnTheirFirstTurn();
const canAttack = !card.rested && !cannotAttackFirstTurn && !cannotAttackJustPlayed;
```

The hint message at `game.html:3970` updates correspondingly: `'Cannot attack on turn 1.'` becomes `'Cannot attack on your first turn.'`

That's it for Bug 1. One predicate, one site. The server toast (which includes the rule cite) stays as the authoritative error when something else slips through.

#### Change 2 — Always-reachable Cancel (Option B, recommended)

Three options were considered.

##### (a) Put a Cancel button inside *every* button group

Touch every group enumerated in `hideAllBtnGroups` (`game.html:3849`) and add a Cancel CTA. Most invasive. Some groups already have Cancel (`#handSelBtns` at line 1256, `#battleBtns` at line 1264); others don't (`#counterStepDefBtns` at line 1288, `#blockBtns` at line 1282 — both intentionally so for rules reasons). Adding Cancel to groups that omit it on purpose would *re-create* the §8-4-1 violation that `#globalWindowControls`' `PRE_COST_CANCELLABLE` set (`game.html:4915`) was introduced to prevent. Rejected.

##### (b) A single Cancel button outside every group, shown whenever `anySelectionActive()` is true (recommended)

Add one button to the right-column DOM, e.g. between `#battleBtns` and `#globalWindowControls`:

```html
<!-- Client-side fallback Cancel. Shown whenever any local selection
     state is active. Independent of #globalWindowControls, which is
     for server-owned interactive windows. Bridges the gap when
     selectCard() shows no button group (e.g. rested character). -->
<div id="selectionFallbackControls" style="display:none;flex-direction:column;gap:4px;">
  <button class="gb-pbtn gb-pbtn-sm" onclick="cancelSel()">Cancel</button>
</div>
```

A single renderer is hooked into the existing `renderGame` tail (same pattern as `renderGlobalWindowControls`, `game.html:4930-4939`):

```js
function renderSelectionFallbackControls() {
  const root = document.getElementById('selectionFallbackControls');
  if (!root) return;
  // Suppress when #globalWindowControls or any contextual button group
  // already provides a Cancel. Read those directly from the DOM so we
  // never double-render.
  const gwcVisible = document.getElementById('globalWindowControls').style.display !== 'none';
  const battleBtnsVisible = document.getElementById('battleBtns').style.display !== 'none';
  const handSelBtnsVisible = document.getElementById('handSelBtns').style.display !== 'none';
  const provided = gwcVisible || battleBtnsVisible || handSelBtnsVisible;
  root.style.display = (anySelectionActive() && !provided) ? 'flex' : 'none';
}
```

Wire into the existing `renderGame` monkey-patch tail at `game.html:4930-4939`. The pattern is already established for `renderGlobalWindowControls`; adding one more line is a strict extension.

**Why this is the recommended option.** Scalability: one source of truth, decoupled from individual button-group state. Adding a new selection mode (e.g. a future "pick a card to sacrifice" mode) automatically gets a Cancel if it sets `sel` or its own flag (with one addition to `anySelectionActive`). No need to remember to add Cancel to N future button groups. The `!provided` guard prevents UX duplication when an action group already shows Cancel.

The implementation cost is one DOM element + one render function + one line in the existing render-loop monkey-patch. Trivially auditable.

##### (c) Extend `#globalWindowControls` to also cover client-side selection states

Reuse the existing GWC and add a "selectionState" branch inside `renderGlobalWindowControls` (`game.html:4891`). The objection: GWC's contract today is **"server-owned interactive windows"** — its title text, confirm button, and cancel kind all map to `game.activeWindow.descriptor`. Adding a parallel "client selection" branch couples two semantically different states into one renderer. The `PRE_COST_CANCELLABLE` set (`game.html:4915`) becomes harder to reason about because not every state that *appears* there is a server window any more. Rejected on cohesion grounds.

#### Change 3 — Generalisation audit (one-time, design-only deliverable)

Per the architect's hard constraint, Bug 1 is a symptom of a broader pattern: **the client must not surface an action that the server will reject.** The audit enumerates every client-side action-button render path and verifies it gates on the same conditions the server does.

Audit table (to be confirmed by coding-agent during implementation):

| Client button | Render site | Server gate | Client mirrors? |
| --- | --- | --- | --- |
| `#btnAttack` | `game.html:3963-3983` | `server.js:1590` (`isAttackerOnTheirFirstTurn`), `playedThisTurn`, `card.rested` | **Bug 1 — partial. Fix in Change 1.** |
| `#btnActivateMain` | `game.html:3982` | server-side `[Activate: Main]` handler (own turn, MAIN phase, `usedThisTurn`, DON cost) | Yes — own-turn + MAIN gate at `game.html:3981`, OPT via `usedThisTurn`, DON via `canAffordActivate`. Confirm during audit. |
| `#btnAttachDon` | `game.html:3984` | server-side ATTACH_DON handler (own turn, MAIN, `donActive >= 1`, attach target not over-attached cap) | **Partial.** Today: `!card.rested ? 'block' : 'none'`. Does not check `me.donActive >= 1` or per-card attach cap (§9 cap is typically 10 DON on Leader). Audit item: tighten to `(!card.rested && me.donActive >= 1 && card.attachedDon < ATTACH_DON_CAP) ? 'block' : 'none'`. |
| `#btnDeploy` / `#btnPlayEvent` | `game.html:3918-3923` | server-side hand-play (`donActive >= effCost`, type matches, etc.) | Yes — checks `me.donActive >= effCost` and counter-only-event branch. Confirm during audit. |
| Hand-card click → `selectCard` source='hand' | `game.html:3887` | server-side hand-play gates | Selection always opens `#handSelBtns`; gates apply at the `btnDeploy`/`btnPlayEvent` level above. Acceptable. |

Output: a single follow-up issue, or a section in `docs/designs/client-server-gate-parity.md`, listing the gaps. The `#btnAttachDon` `donActive >= 1` check is the only confirmed parity gap besides Bug 1; coding-agent should fix it in the same PR or open a tracked follow-up. Each gap is small but the *audit itself* is the deliverable — not the individual fixes.

### Generalization check

- **Card universe.** Neither change references any card id, name, or keyword. The first-turn predicate is a pure read of a per-player flag; the cancel fallback is purely a selection-state derivation. Both are card-agnostic.
- **Future-proofing.**
  - If a future card grants an extra turn, `hasTakenFirstTurn` is already correct per the prior design (`docs/designs/first-turn-no-battle.md` §Generalization check). Client predicate inherits that correctness for free — it just reads the server-broadcast flag.
  - If a future selection mode is introduced (e.g. "pick a hand card to trash"), the implementer adds its flag to `anySelectionActive()` (one line) and the fallback Cancel covers it. No per-mode Cancel button needed.
  - If a future card lets the *defender* select something during the opponent's turn (e.g. a defensive `[Activate: Main]`-style ability outside MAIN), the same `anySelectionActive` derivation works — the predicate is phase-agnostic.
- **Edge cases enumerated:**
  - **P2 leader click on turn 2 with no other actions.** Bug 1 hides `#btnAttack`; `canActivate` is false (leader has no `[Activate: Main]`); `canAttack && !canActivate` short-circuits at `game.html:3968` with the "Cannot attack on your first turn" hint. `sel` is set; `#battleBtns` is hidden; **Change 2's fallback Cancel appears**. User can unstick.
  - **Rested character click on own turn.** `canAttack = false` and `canActivate = false`; hint "is rested"; `sel` set; fallback Cancel appears.
  - **Card click during attackMode.** `attackMode` true → falls through to `selectTarget` (`game.html:3872`), no selection state change. The fallback Cancel is suppressed because `#globalWindowControls` is showing (the attackDeclarationWindow's Cancel CTA, `game.html:4915-4921`). No duplication.
  - **Hand click on own turn.** `#handSelBtns` is shown; that group already has a Cancel (`game.html:1256`); fallback is suppressed via the `handSelBtnsVisible` guard.
  - **Off-board click.** Existing `committedToServerWindow` guard (`game.html:4860-4866`) unchanged. Fallback Cancel coexists — it's an additional reach for the user, not a replacement of the off-board cancel.
  - **Server desync: `hasTakenFirstTurn` missing from `GAME_STATE`** (e.g. old server, replay state). `clientIsAttackerOnTheirFirstTurn` returns `true` (fail-closed via `!me || !me.hasTakenFirstTurn`) — Attack hidden, server still authoritative. Acceptable.
  - **Reconnect mid-first-turn.** The flag is replayed from server state; behaviour is correct on resume.

### Performance

- **Hot paths.** `renderGame` is called once per `GAME_STATE` broadcast (a few per turn, plus animation ticks). Adding `renderSelectionFallbackControls` (three `getElementById` reads, three style reads, one boolean expression, one style write) is microseconds — strictly dominated by the existing `renderGlobalWindowControls` in the same tail. No new allocations, no new listeners.
- **`clientIsAttackerOnTheirFirstTurn`** runs at most once per `selectCard` call (on field/leader source). One property read. O(1).
- **Memory.** No new client state. The fallback DOM element is one `<div>` + one `<button>`.
- **State broadcasts.** Unchanged. The server already includes `hasTakenFirstTurn` in `players[*]`.

### Test strategy

Mostly UI-shaped, where the existing harness is weak. The architect proposes three layers, lightest first.

- **Unit tests (server-side, regression guards — already exist):**
  - `tests/first_turn_battle_p2.test.js` already asserts `DECLARE_ATTACK` from P2 on game-turn 2 returns ERROR with §6-5-6-1 cite. **No new server unit tests needed for these bugs** — the server is correct.
  - Optional: add a small unit-testable client function that the audit produces. Specifically, factor out the Attack-button visibility predicate into a pure function in a script tag (or extract into a tiny client-helper file under `public/` so `tests/` can `require` it):
    ```js
    function shouldShowBtnAttack({card, source, me, gameTurn /* …unused */}) {
      const ab = card.ability || '';
      const cannotAttackFirstTurn = !me || !me.hasTakenFirstTurn;
      const cannotAttackJustPlayed = source === 'field' && card.playedThisTurn && !ab.includes('[Rush]');
      return !card.rested && !cannotAttackFirstTurn && !cannotAttackJustPlayed;
    }
    ```
    Then `tests/should_show_btn_attack.test.js` covers the table: P1-turn-1, P2-turn-2, P1-turn-3, [Rush] card, rested card, played-this-turn-no-Rush, played-this-turn-with-Rush. This is the **lightweight client-logic test** the bug report asks for, and it stays inside `node --test` — no Playwright dependency. **Recommended.**
- **E2E scenarios (WS-only harness, already partially covers):**
  - Existing: `tests/e2e_first_turn_battle_p2.test.js` (per prior design) asserts the server rejects P2's DECLARE_ATTACK on turn 2. **Already green; keep as regression.**
  - New: an e2e scenario that opens GAME_STATE, asserts `state.players[p2].hasTakenFirstTurn === false` after P1's first END_TURN, transitions to `true` after P2's first END_TURN. Locks the wire-state contract that the client predicate depends on.
- **UI tests (Playwright — heavy, optional):**
  - The bug report acknowledges the existing harness is WS-only. A Playwright test that loads `game.html`, simulates a two-client game, selects the P2 leader on turn 2, and asserts `#btnAttack` has `display: none` would be ideal — but is heavy and currently has no harness in the repo.
  - **Recommendation:** prefer the unit-testable client-function approach above for now. Defer Playwright until there's a broader UI-test investment (already gestured at by the `ui-test-agent` placeholder in `CLAUDE.md`). If a Playwright suite is built later, **add three scenarios:**
    1. P2 selects leader on turn 2 → assert `#btnAttack` hidden, `#selectionFallbackControls` visible.
    2. Own rested character clicked → assert `#battleBtns` hidden, `#selectionFallbackControls` visible, clicking it clears `.selected`.
    3. attackDeclarationWindow open → assert `#selectionFallbackControls` hidden (because `#globalWindowControls` provides Cancel).
- **Manual test plan (interim, until Playwright):**
  - Two browser windows, real game.
  - P1 ends turn 1 → P2 clicks own leader → expect: no Attack button, "Cannot attack on your first turn" hint, fallback Cancel button visible, clicking Cancel deselects.
  - P2 plays a character → P2 clicks that character → expect: no Attack button (just-played + first-turn), Activate Main only if applicable, Attach DON only if rested-check passes, fallback Cancel always available.
  - P2 ends turn 2 → P1 clicks own rested character on turn 3 → expect: no buttons, "is rested" hint, fallback Cancel visible.
  - P1 declares attack → expect: `#globalWindowControls` Cancel visible, `#selectionFallbackControls` NOT visible (suppressed).
- **Rules-compliance audit needed: NO** (this is a UX consistency fix; the rule semantics are already audited and shipped). The `§1-3-2` cite is a principled hook, not a new mechanic.

## Risks and tradeoffs

- **Two cancel surfaces.** The design introduces `#selectionFallbackControls` alongside the existing `#globalWindowControls`. The `!provided` guard prevents simultaneous render, but a future maintainer touching one might not notice the other. **Mitigation:** the inline comment on the new div explicitly references GWC and the suppression rule. The unit test on `anySelectionActive()` plus a UI-test (if/when Playwright lands) locks the "never both visible" invariant.
- **Stale-state risk on `hasTakenFirstTurn`.** Client reads a server-broadcast flag. If a state-broadcast is dropped or arrives reordered, the client briefly disagrees with the server. Worst case: Attack button visible for one frame on P2-turn-2 and the server rejects the click. **Mitigation:** the server toast is already the safety net (§6-5-6-1 ERROR). The UX regresses to today's behaviour, no new failure mode introduced.
- **Audit fatigue.** The generalisation audit (Change 3) is a one-time exercise; future card additions could re-introduce gaps. **Mitigation:** the unit-testable `shouldShowBtnAttack`-style helpers force the gate logic into testable functions; new gates should follow the same pattern. Architect to recommend that future contributions matching the "render a contextual action button" shape add a parallel pure-function gate + unit test.
- **What we're choosing not to optimize:** the wider question of whether `#battleBtns` and its siblings should be replaced by a single declarative menu driven from a card-action descriptor list (similar to how `#globalWindowControls` is driven from `activeWindow.descriptor`). That refactor is the *right* long-term answer to "client never surfaces server-rejected actions" — but it's a 200-line touch and is out of scope here. Logged as future work; not blocking.
- **Per-card attach-DON cap.** The audit identifies `#btnAttachDon` as a parity gap (no `donActive >= 1` check). Fixing it is in scope of Change 3, but the architect notes the right value of the cap (10? per-card? per-leader?) needs confirmation from `server.js`. If the right cap isn't a single constant, coding-agent should leave a TODO and fix only the `donActive >= 1` half.

## Handoff

Coding-agent: implement per the data model and engine changes above. Specifically:

1. **Change 1.** Replace `const cannotAttackTurn1 = game.turn === 1;` at `game.html:3963` with `const cannotAttackFirstTurn = clientIsAttackerOnTheirFirstTurn();` (and update the variable name through line 3970's hint). Add the `clientIsAttackerOnTheirFirstTurn()` helper near `myPlayer()` / `isMyTurn()`. Comment cites `server.js:3445` and §6-5-6-1.
2. **Change 2.** Add `#selectionFallbackControls` to the right column DOM, between `#battleBtns` (`game.html:1265`) and `#globalWindowControls` (`game.html:1271`). Add `anySelectionActive()` and `renderSelectionFallbackControls()` adjacent to `renderGlobalWindowControls()` (`game.html:4891`). Hook into the `renderGame` monkey-patch tail (`game.html:4930-4939`) — extend the existing closure, do not add a second one.
3. **Change 3.** Execute the audit table above. For confirmed gaps (today: `#btnAttachDon` `donActive >= 1`), fix in the same PR if trivial, or open a tracked issue. Add a comment block above the field/leader branch in `selectCard` (`game.html:3927`) titled "Client–server gate parity" that lists each contextual button and the server gate it must mirror, so future contributions know the contract.
4. **Tests.** Extract `shouldShowBtnAttack` as a pure function and unit-test it per the table in §Test strategy. Add the e2e wire-state-contract test for `hasTakenFirstTurn` transitions. Include the manual test plan in the PR description.
5. **Pre-deploy gate.** `npm test` green; e2e green. No rules-compliance pass required (audited via `docs/designs/first-turn-no-battle.md` already). Push and deploy per CLAUDE.md.
6. **Do not deviate without updating this doc.**
