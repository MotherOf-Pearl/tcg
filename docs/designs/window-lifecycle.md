# Window Lifecycle v2 — Cancel, Confirm, and Turn-Boundary Safety

Status: DESIGN (solution-architect pass). Do not implement until reviewed against v1 (`window-lifecycle.md`) and audited by rules-compliance-agent.

## Problem

Three orthogonal bugs all stem from the same missing abstraction: BoohawTCG has no first-class concept of an **uncommitted interactive window**. The engine treats every action as immediately committed, so the user has no way out of a misclick, and the END_TURN handler has no way to tell whether the current player has rules-visible state that must resolve before the turn flips.

1. **Attack flow has no visible cancel.** A `CANCEL_ATTACK` action exists server-side (server.js:1396) and a client `cancelAttack()` button exists (game.html:1269), but the button only renders inside `#attackingBtns`, which is part of the per-card control rail. After a misclick the rail's binding to the attacker can be lost and the user is stranded in `phase === 'ATTACKING'` with no UI affordance.
2. **Activate Main has no cancel.** Today ACTIVATE_MAIN immediately rests the card, sets `usedThisTurn = true`, logs the activation, and calls `runPipeline('activateMain', …)` (server.js:1187-1190). The once-per-turn slot is burned the moment the player clicks the card — there is no confirm step, no rollback path.
3. **END_TURN during an open window is legal.** END_TURN (server.js:1791) only auto-resolves the legacy `counterWindow`; every other window kind (~25 of them — restTargetWindow, koTargetWindow, bounceTargetWindow, trashFromHandWindow, chooseOneWindow, scryWindow, donReturnWindow, suppressionTargetWindow, powerBuffTargetWindow, placeAtBottomWindow, addFromTrashWindow, addLifeCardToHandWindow, lookAtLifeCardWindow, opponentChoosesWindow, grantKeywordToNamedWindow, attackRedirectWindow, selfSaveWindow, playFromHandWindow, playFromTrashWindow, giveDonTargetWindow, triggerWindow, etc.) survives the turn flip with the wrong `playerId` attached. State leaks across turn boundaries.

The unifying defect is that the engine never categorises a window as *cancellable* or *blocking*, never models a *commit point* between "the player picked a card" and "rules-visible state has mutated", and never enforces "before the turn ends, every open window must be resolved or auto-cancelled".

## Scope

- **In scope:**
  - A single lifecycle abstraction (`WindowDescriptor`) that classifies every interactive window with: `commitPoint`, `cancelKind`, `endTurnPolicy`, `confirmRequired`.
  - A unified `CANCEL_WINDOW` action handler that knows how to roll back any cancellable window.
  - An `ACTIVATE_MAIN_CONFIRM` two-phase flow that opens a confirmation window before any state mutation.
  - END_TURN logic that walks the window descriptor table, auto-cancels cancellable windows, refuses (with reason) when a blocking window is open, and broadcasts a clear log line either way.
  - A bottom-right UI region (the existing "ability description on hover" slot) that surfaces both confirm and cancel CTAs for any open window owned by the current viewer.
- **Out of scope:**
  - Refactoring `parseAndApply` legacy path or migrating non-pipeline cards. Both abstractions coexist; only the new pipeline gets the full descriptor table. Legacy `counterWindow` continues to use its existing auto-resolve.
  - Touching the rules-resolution engine itself. Battle phase order (Attack/Block/Counter/Damage) is unchanged.
  - Multi-window queue support. `effectQueue` is already reserved in game state (server.js:672) and we do not extend it here.
  - Spectator UX, replay, or undo beyond the in-flight uncommitted window.

- **Cards/keywords/phases affected:**
  - Phases: MAIN (Activate Main confirm; attack cancel), ATTACKING (attack cancel — already present, surfaced properly), END (END_TURN gate). Battle subphases BLOCK_STEP / COUNTER_STEP unchanged — those are blocking by design (rules 7-1-2 / 7-1-3).
  - Every card with `useNewPipeline: true` that opens any of the ~25 window kinds. Cancel rollback is handled centrally; no per-card change.
  - Every card that exposes [Activate: Main] (rules 10-2-2): confirmation step inserted.

## Design

### Data model

#### `WINDOW_DESCRIPTORS` — single source of truth (engine constant)

A const map keyed by window field name (the existing `*Window` slots on `game`). One descriptor per window kind. Adding a new window kind requires adding one row here; the engine refuses to open windows whose kind isn't registered.

**Picker variant.** Every `targetPicker` / `modePicker` / `multiSelect` row sets `pickRequirement` at *payload time*, not in the static descriptor — because the same window field (e.g. `restTargetWindow`) can be opened in a mandatory variant by one card and an optional variant by another. The two variants are:

- `'optional'` — the card text says "up to N" or "may choose"; rule §4-8 / §8-4-4-1 / §8-4-4-2 permit choosing 0. On END_TURN the engine cancels the window (per `endTurnPolicy: 'autoCancel'`).
- `'mandatory'` — the card text says "choose 1" or similar; rule §8-4-4-1 requires picking as many as legally possible. On END_TURN the engine does **not** silently drop the resolution — instead it routes through `forcedPickHelper(field, payload)`, which selects the first legal candidate deterministically (or closes the window cleanly if no legal candidate exists). Coding-agent owns one helper per picker field; helpers live next to their openers.

Coding-agent must audit each opener call site and pass `pickRequirement` based on the card's ability text. The default (if the opener forgets) is `'mandatory'` — strictest rules-alignment, fails loudly via the descriptor-coverage test.

```
const WINDOW_DESCRIPTORS = {
  // ───── Cancellable group — pipeline can be aborted on END_TURN, ─────
  // but for windows opened *post-confirm* the cost has already been paid
  // per §8-4-1-3 and §8-4-1-4. autoCancel discards the in-flight pipeline
  // and pipelineResume chain; it does NOT refund `usedThisTurn`, paid
  // DON, or rested attackers. See Note E.
  // The pre-cost cancellable case is activateMainConfirmWindow below.
  restTargetWindow:        { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  koTargetWindow:          { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  bounceTargetWindow:      { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  powerBuffTargetWindow:   { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  suppressionTargetWindow: { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  giveDonTargetWindow:     { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  attackRedirectWindow:    { kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'blocking',    endTurnPolicy: 'reject',     confirmRequired: false }, // see Note A
  chooseOneWindow:         { kind: 'modePicker',      commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  opponentChoosesWindow:   { kind: 'modePicker',      commitPoint: 'onSelect',  cancelKind: 'blocking',    endTurnPolicy: 'reject',     confirmRequired: false }, // see Note B
  grantKeywordToNamedWindow:{kind: 'targetPicker',    commitPoint: 'onSelect',  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  placeAtBottomWindow:     { kind: 'orderPicker',     commitPoint: 'onConfirm', cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false },
  addFromTrashWindow:      { kind: 'multiSelect',     commitPoint: 'onConfirm', cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false }, // pickRequirement set at payload time
  scryWindow:              { kind: 'orderPicker',     commitPoint: 'onConfirm', cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false },
  lookAtLifeCardWindow:    { kind: 'reveal',          commitPoint: 'onConfirm', cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: false },

  // ───── Already half-committed: card moved or cost paid ─────
  // These cannot be safely cancelled because rules-visible state has
  // already mutated (cost paid, card moved). They are AUTO-RESOLVED
  // on END_TURN by feeding the resolver the player's default choice.
  playFromHandWindow:      { kind: 'targetPicker',    commitPoint: 'onOpen',    cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false },
  playFromTrashWindow:     { kind: 'targetPicker',    commitPoint: 'onOpen',    cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false },
  trashFromHandWindow:     { kind: 'multiSelect',     commitPoint: 'onConfirm', cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false }, // cost-leg; see Note C
  donReturnWindow:         { kind: 'multiSelect',     commitPoint: 'onConfirm', cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false },
  addLifeCardToHandWindow: { kind: 'orderPicker',     commitPoint: 'onConfirm', cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false },
  selfSaveWindow:          { kind: 'binary',          commitPoint: 'onSelect',  cancelKind: 'committed',   endTurnPolicy: 'autoSkip',   confirmRequired: false }, // see Note D

  // ───── Rules-required: blocking ─────
  counterWindow:           { kind: 'reactive',        commitPoint: 'na',        cancelKind: 'blocking',    endTurnPolicy: 'reject',     confirmRequired: false },
  triggerWindow:           { kind: 'reactive',        commitPoint: 'onSelect',  cancelKind: 'blocking',    endTurnPolicy: 'reject',     confirmRequired: false },

  // ───── New: confirmation gate ─────
  activateMainConfirmWindow: { kind: 'confirm',       commitPoint: 'onConfirm', cancelKind: 'cancellable', endTurnPolicy: 'autoCancel', confirmRequired: true },
};
```

Notes:
- **Note A — attackRedirectWindow** is blocking because it fires in the middle of `onYourOpponentsAttack` while a battleState is mid-resolution (rules 7-1-1-3). Cancelling would orphan the battle. END_TURN cannot occur during battle anyway, so `endTurnPolicy:'reject'` is precautionary.
- **Note B — opponentChoosesWindow** is owned by the non-active player; we cannot let the active player end-turn around it. Reject with "opponent must choose first".
- **Note C — trashFromHandWindow** is the cost leg of an effect (rule 8-4-1-3). It is `'committed'` once opened because the effect-activation procedure (8-4-1) has reached the cost-payment step; aborting now without paying would re-open the question of whether 8-3-1-3 applies. We rely on the existing "skip" path inside the resolver.
- **Note D — selfSaveWindow** is owned by the defender mid-KO. The KO has already been declared. Opting in/out has no "uncommitted" sense.
- **Note E — post-cost cancellable windows.** All `cancellable` rows above (every entry from `restTargetWindow` through `lookAtLifeCardWindow`) open *after* `ACTIVATE_MAIN_CONFIRM` has paid the cost per §8-4-1-3 (or after equivalent on-play cost for [On Play] effects). `autoCancel` here means "abort the in-flight pipeline / discard `pipelineResume`" — it does **not** refund `usedThisTurn`, paid DON, or any cost that was paid to reach the picker. The user-facing cancel copy must reflect this: "Cancelling now will end the ability; the once-per-turn use is already consumed." Rules basis: §8-4-1 treats activation as a five-step procedure where cost (§8-4-1-3) precedes resolution (§8-4-1-5); cancelling mid-resolution is the engine's affordance for §8-4-4-2 ("a player can decide not to choose"), not a §8-4-1-3 refund.
- **Note F — picker `pickRequirement`.** Every `targetPicker` / `modePicker` / `multiSelect` row carries a `pickRequirement: 'optional' | 'mandatory'` field in its *payload* (not in the static descriptor). The opener call site sets this based on the card's ability text. `'optional'` = autoCancel on END_TURN. `'mandatory'` = autoSkip on END_TURN via `forcedPickHelper(field, payload)`, which picks the first legal candidate deterministically or closes the window if none. Default if omitted: `'mandatory'` (rules-stricter; failure surfaces in tests).

#### `game` shape additions

```
// New: which window the descriptor table considers currently open, for
// O(1) cancel/end-turn checks. NEVER trusted as primary state — always
// reconstructed from the *Window slots by openWindow()/closeWindow().
game.activeWindow = null;
// Shape: { field: 'restTargetWindow', playerId, sourceCardUid, openedAtTurn,
//          descriptor: <ref into WINDOW_DESCRIPTORS> }

// New: activateMainConfirmWindow — a small descriptor before any state
// mutation. Pre-mutation snapshot is implicit (no mutation has happened
// yet); cancel = clear window, no rollback needed.
game.activateMainConfirmWindow = null;
// Shape: { playerId, cardUid, cardName, abilitySummary, isOnceUsed: boolean,
//          donCost: number, openedAtTurn }
```

#### WS message protocol additions

Client → server:
- `CANCEL_WINDOW` — `{ type: 'CANCEL_WINDOW' }` (no payload; server resolves which window is open via `game.activeWindow`). Replaces the existing one-off `CANCEL_ATTACK` going forward, though CANCEL_ATTACK is kept as a deprecated alias for one release to avoid client/server skew during deploy.
- `ACTIVATE_MAIN_CONFIRM` — `{ type: 'ACTIVATE_MAIN_CONFIRM', cardUid }`. Sent when the user clicks Confirm in the activate-main confirm overlay. Server runs the real activation logic (rest card, runPipeline). Without a matching open `activateMainConfirmWindow` for the same `cardUid`, the action is ignored.

Server → client:
- `GAME_STATE` already broadcasts `game.activateMainConfirmWindow` and `game.activeWindow` via the existing JSON serialisation — no schema change beyond the new fields.
- `WINDOW_CANCELLED` — `{ type: 'WINDOW_CANCELLED', windowField, reason }`. Sent to both players when a window is auto-cancelled by END_TURN. Lets the client surface a toast like "Once Per Turn slot refunded".
- `END_TURN_REJECTED` — `{ type: 'END_TURN_REJECTED', reason, blockingWindow }`. Sent only to the requester. Client surfaces the reason in the existing error toast slot.

### Engine changes

#### 1. Window-open and window-close get a single bottleneck

Today every opener (`openRestTargetWindow`, `openBounceTarget`, …) writes directly to its named slot. We add two thin helpers and rewrite each opener to go through them:

```
function openWindow(game, field, payload) {
  const desc = WINDOW_DESCRIPTORS[field];
  if (!desc) throw new Error(`Unknown window kind: ${field}`);
  if (game[field]) {
    // Defensive — should never happen; engine is single-window today.
    console.warn(`[WINDOW] Overwriting existing ${field}`);
  }
  game[field] = payload;
  game.activeWindow = {
    field, playerId: payload.playerId,
    sourceCardUid: payload.sourceCardUid || payload._sourceCardUid || null,
    openedAtTurn: game.turn,
    descriptor: desc,
  };
}

function closeWindow(game, field) {
  game[field] = null;
  if (game.activeWindow && game.activeWindow.field === field) {
    game.activeWindow = null;
  }
}
```

Existing window resolvers (e.g. `KO_TARGET_SELECTED` at server.js:1808) replace the line `game.koTargetWindow = null;` with `closeWindow(game, 'koTargetWindow');`. Existing openers (e.g. `openRestTargetWindow` at server.js:3118) replace `game.restTargetWindow = { … }` with `openWindow(game, 'restTargetWindow', { … })`. Mechanical refactor, no behaviour change for happy-path cards.

#### 2. `CANCEL_WINDOW` handler — central rollback

```
case 'CANCEL_WINDOW': {
  const aw = game.activeWindow;
  if (!aw) { send(playerId, { type:'ERROR', msg:'No window to cancel.' }); return; }
  if (aw.playerId !== playerId) {
    send(playerId, { type:'ERROR', msg:'That window is not yours to cancel.' });
    return;
  }
  if (aw.descriptor.cancelKind === 'blocking') {
    send(playerId, { type:'ERROR', msg:'This step cannot be cancelled — resolve it first.' });
    return;
  }
  if (aw.descriptor.cancelKind === 'committed') {
    send(playerId, { type:'ERROR', msg:'Cost has been paid — cannot cancel.' });
    return;
  }
  cancelWindow(game, aw, /*reason*/ 'user');
  log(game, `${aw.descriptor.kind} cancelled.`);
  broadcastAll(game, room);
  break;
}
```

`cancelWindow(game, aw, reason)` does:
1. Discard the window's `pipelineResume` (the chain dies, no resume is fired).
2. Call descriptor-specific rollback hook, if any. For most pickers there's nothing to undo. Two specific rollbacks:
   - **activateMainConfirmWindow:** nothing to undo (we deliberately have not yet rested, marked used, or called runPipeline).
   - **suppressionTargetWindow** and other windows opened post-cost: we explicitly do not allow cancel here — those windows belong to `committed` cards in the table above. The descriptor table is the gate.
3. `closeWindow(game, aw.field)`.

The key invariant — and the reason this is safe — is that **`cancelKind: 'cancellable'` is only assigned to windows where the only state mutation between "user clicked the source card" and "window opened" is creating the window object itself**. No costs paid, no cards moved, no `usedThisTurn` flips. This is what rule 8-4-1 calls the post-8-4-1-2 / pre-8-4-1-3 boundary — the effect has been *specified* but the *cost has not yet been paid*. The original ACTIVATE_MAIN handler violates this by setting `card.usedThisTurn = true; card.rested = true;` *before* runPipeline (server.js:1187). The two-phase confirm flow below fixes that.

#### 3. Two-phase ACTIVATE_MAIN

Existing `ACTIVATE_MAIN` (server.js:1140) splits in two:

```
case 'ACTIVATE_MAIN': {
  // (all existing eligibility checks unchanged — owner, isActive, phase,
  //  card resolution, [Activate: Main] keyword check, rested check,
  //  [Once Per Turn] check, isEffectsSuppressed, ST07-017 hand check)
  // (NO MUTATION — do not rest, do not mark used, do not log "activated")
  openWindow(game, 'activateMainConfirmWindow', {
    playerId,
    cardUid: card.uid,
    cardName: card.name,
    sourceCardUid: card.uid,
    abilitySummary: card.ability,
    donCost: activateMainDonCost(card),
    openedAtTurn: game.turn,
  });
  log(game, `${card.name}: confirm [Activate: Main]?`);
  break;
}

case 'ACTIVATE_MAIN_CONFIRM': {
  const w = game.activateMainConfirmWindow;
  if (!w || w.playerId !== playerId || w.cardUid !== action.cardUid) {
    send(playerId, {type:'ERROR', msg:'No matching activation to confirm.'});
    return;
  }
  // Re-resolve the card (it might have moved between open and confirm —
  // unlikely in single-player flow, but defensive).
  let card = null;
  if (p.leader && p.leader.uid === w.cardUid) card = p.leader;
  else card = (p.field || []).find(c => c.uid === w.cardUid);
  if (!card) {
    closeWindow(game, 'activateMainConfirmWindow');
    send(playerId, {type:'ERROR', msg:'Card no longer eligible.'});
    return;
  }
  // Re-run the eligibility gates — state may have changed.
  if (card.rested || (card.ability.includes('[Once Per Turn]') && card.usedThisTurn)
      || isEffectsSuppressed(card)) {
    closeWindow(game, 'activateMainConfirmWindow');
    send(playerId, {type:'ERROR', msg:'Card no longer eligible.'});
    return;
  }
  // NOW commit: this is the rules-visible state mutation.
  card.usedThisTurn = true;
  card.rested = true;
  closeWindow(game, 'activateMainConfirmWindow');
  log(game, `${card.name}: [Activate: Main] activated.`);
  runPipeline('activateMain', game, playerId, card);
  break;
}
```

Rules citations on the commit point:
- **Rule 8-4-1** is the canonical activation procedure: 8-4-1-2 *specify* the effect, 8-4-1-3 *pay activation costs*. The current code commits before 8-4-1-2 finishes. The two-phase split puts the commit precisely between 8-4-1-2 and 8-4-1-3.
- **Rule 10-2-13-3** (`[Once Per Turn]`) — the slot is consumed only after the effect has *been activated and resolved*. Pre-confirm, no activation has occurred under the rules' meaning of the word; the `usedThisTurn` flag is purely an engine bookkeeping flag that must NOT be set until 8-4-1-4 begins.

#### 4. Attack cancel — surface the existing handler

Server-side `CANCEL_ATTACK` (server.js:1396) is retained as an alias for `CANCEL_WINDOW` during the deploy migration. But the attack flow needs a descriptor so END_TURN can see it:

```
// During DECLARE_ATTACK, set phase = ATTACKING (existing line 1320) and
// also open a synthetic window descriptor so the unified table covers it:
openWindow(game, 'attackDeclarationWindow', {
  playerId,
  sourceCardUid: attacker.uid,
  attackerName: attacker.name,
});
// game.attackDeclarationWindow is purely a descriptor for the cancel /
// end-turn machinery — battleState remains the source of truth for the
// attack itself.
WINDOW_DESCRIPTORS.attackDeclarationWindow = {
  kind: 'targetPicker', commitPoint: 'onSelect',
  cancelKind: 'cancellable', endTurnPolicy: 'autoCancel',
  confirmRequired: false,
};
// SELECT_TARGET closes it (cancellable up through target selection per
// rule 7-1-1-3 — the [When Attacking] fire is the first rules-visible
// mutation outside attacker.rested, and attacker.rested is reversible).
```

Why this is safe per the rules:
- **Rule 7-1-1-1** declares attack by resting the attacker. Engine inverts: `attacker.rested = true` *is* reversible — `CANCEL_ATTACK` already unrests (server.js:1402).
- **Rule 7-1-1-3** fires `[When Attacking]` effects. The current code fires these in `DECLARE_ATTACK` (server.js:1330) *before* `SELECT_TARGET`, which is technically order-correct for 7-1-1 but means any [When Attacking] effect that opened its own window has already mutated rules-visible state by the time the player wants to cancel. **We tighten cancel scope:** `attackDeclarationWindow.cancelKind` flips to `'committed'` the moment any [When Attacking] effect opens a sub-window, OR completes a synchronous mutation. A flag `game.battleState.whenAttackingFired = true` (set right after the runPipeline call at server.js:1330) drives this. Cancel is permitted between 7-1-1-1 and 7-1-1-3 because no rules-visible state mutation has occurred yet beyond resting the attacker; once 7-1-1-3 has fired, cancellation would require unwinding visible effects.

Net rule: **cancel is permitted from DECLARE_ATTACK until either (a) [When Attacking] has fired a state mutation or (b) SELECT_TARGET has chosen.**

#### 5. END_TURN window-aware gate

```
case 'END_TURN': {
  if (!isActive) return;
  // Legacy counterWindow path (unchanged) — auto-resolve.
  if (game.counterWindow) { /* existing logic */ }
  // New: walk every window descriptor and apply its endTurnPolicy.
  const openWindows = Object.entries(WINDOW_DESCRIPTORS)
    .filter(([field]) => game[field] != null);
  for (const [field, desc] of openWindows) {
    if (desc.endTurnPolicy === 'reject') {
      send(playerId, { type: 'END_TURN_REJECTED',
        reason: `${desc.kind} must resolve first.`,
        blockingWindow: field });
      return;
    }
  }
  for (const [field, desc] of openWindows) {
    if (desc.endTurnPolicy === 'autoCancel') {
      // Picker rows respect the payload-time pickRequirement (Note F).
      // Mandatory pickers don't silently drop a §8-4-4-1 resolution —
      // they route through forcedPickHelper instead of cancel.
      const payload = game[field];
      const isPicker = ['targetPicker','modePicker','multiSelect'].includes(desc.kind);
      if (isPicker && payload && payload.pickRequirement === 'mandatory') {
        const picked = forcedPickHelper(game, field, payload);
        broadcast(roomId, { type:'WINDOW_AUTO_RESOLVED', windowField: field,
                            reason:'endTurnMandatory', resolution: picked });
      } else {
        cancelWindow(game, { field, descriptor: desc, playerId: payload.playerId }, 'endTurn');
        broadcast(roomId, { type:'WINDOW_CANCELLED', windowField: field, reason:'endTurn' });
      }
    } else if (desc.endTurnPolicy === 'autoSkip') {
      // committed window: feed it a no-op resolver (e.g. select 0 cards,
      // skip the optional pick). Each window kind owns one autoSkip
      // helper, registered alongside its opener.
      autoSkipWindow(game, field);
    }
  }
  doEnd(game);
  break;
}
```

`autoSkipWindow` is a small dispatch by `field` — for `playFromHandWindow` it's "skip = decline play"; for `donReturnWindow` it's "return required count from whichever pool has enough"; etc. Each is a few lines and lives next to its opener.

`forcedPickHelper(game, field, payload)` is the parallel mechanism for **mandatory pickers** that get hit by END_TURN. It must:
1. Compute the picker's legal candidates from `payload` (each picker already enumerates these — reuse the existing function).
2. If `legal.length === 0`, close the window cleanly (the §1-3-2 "impossible action is not carried out" rule applies — no resolution needed).
3. Otherwise, deterministically select `legal[0]` (or `legal.slice(0, requiredCount)` for multi-select) and call the picker's normal `SELECT_TARGET` resolver as if the player had clicked. This routes through the same pipelineResume path as a user pick — no special-case state.

The deterministic first-legal pick matches §1-3-4 (turn player chooses first when forced) and §8-4-4-1 (pick as many as legally possible). The user is not stranded; the rules are not violated.

#### Reference existing patterns

- `pipelineResume` chain (server.js:1815, 2078, 2103, …): unchanged. Cancel discards the resume; END_TURN's autoCancel also discards.
- The `*Window` interactive shape (server.js:649-672): augmented with `activeWindow` + `activateMainConfirmWindow`. No existing window struct fields are renamed.
- `broadcastAll(game, room)` (server.js:736): used after every cancel and after END_TURN to keep both clients in sync.

### Generalization check

- **Card universe:** every existing pipeline window kind is classified in `WINDOW_DESCRIPTORS`. Adding a new card with a new window kind requires one row in the descriptor table — the engine refuses to open a window not registered there (defensive throw in `openWindow`). This forces every new card author to make a deliberate choice about cancellability and end-turn behaviour. Zero card-ID branching anywhere; classification is by window kind, not by card. ABU [Activate: Main]: ALL such cards route through `ACTIVATE_MAIN_CONFIRM`, no per-card opt-in.
- **Future-proofing:** if a card needs a variant (e.g. "an activate-main that has no confirm step because it has no rules effect — purely a phase advance"), the variant is expressed in `WINDOW_DESCRIPTORS` (`confirmRequired: false`) or by registering a new window kind. Card data never embeds a "skipConfirm" flag.
- **Edge cases enumerated:**
  - Player A activates main → confirm window open → opponent triggers [Opponent's Turn] effect from their own side → ACTIVATE_OPP_TURN runs on opponent's slot. Both windows reference different `playerId`s. `activeWindow` would be overwritten — bug. **Mitigation:** `game.activeWindow` becomes a small map keyed by playerId rather than a single field. Both descriptor table queries and the END_TURN sweep iterate over both entries.
  - Source card moves between window-open and window-resolve (counter K.O.s the activator mid-window). The confirm handler re-resolves card by uid; if gone, cancel quietly and ERROR.
  - User mashes Cancel twice. First call closes the window and clears `activeWindow`; second call hits "No window to cancel" and ERRORs. Idempotent.
  - Disconnect mid-window. Existing reconnect path replays `GAME_STATE`; client sees the open window and re-renders the cancel button. No engine change.
  - Auto-cancel during END_TURN of a window that was opened by the **non-active** player (opponentChoosesWindow). The descriptor pins this to `reject` — END_TURN bounces with `"opponent must choose first"`. Good.
  - Activate Main that was already used this turn ([Once Per Turn]) — eligibility check at ACTIVATE_MAIN open path rejects with the existing error message; no confirm window opens. The user is never able to enter a state where the slot is silently burned by misclicking.
  - Multiple ACTIVATE_MAIN attempts in succession before confirming the first: second open hits `openWindow`'s overwrite warning. **Mitigation:** in ACTIVATE_MAIN, if `game.activateMainConfirmWindow` already exists for the same player, replace it (the user is changing their mind about which card to activate). If for a different player, ERROR.
- **Performance:** see below — the descriptor table is at most ~25 entries; END_TURN's sweep is O(N) over that constant, not over card count.

### Performance

- **Hot paths:**
  - `openWindow` / `closeWindow` — called once per interactive effect, not per action. New work: a hashmap lookup in `WINDOW_DESCRIPTORS` + a small object construction for `activeWindow`. O(1).
  - `END_TURN` — `Object.entries(WINDOW_DESCRIPTORS).filter(…)` is O(W) where W ≈ 25 (the descriptor count, not the card count). One scan per END_TURN; END_TURN fires at most once per turn. Negligible.
  - `CANCEL_WINDOW` — single descriptor lookup. O(1).
  - `sendState` / `broadcastAll` — serialises the game state. New fields `activeWindow` and `activateMainConfirmWindow` add ~100 bytes per broadcast. No structural change.
- **Data structures:**
  - `WINDOW_DESCRIPTORS` is a frozen const Map (or plain object) — engine never mutates it. O(1) lookup by key.
  - `game.activeWindow` (or `game.activeWindows` if we adopt the per-player map for the edge case above) — single object or 2-entry object; constant time everywhere.
  - We do *not* introduce a linear scan of `*Window` slots into hot paths — only END_TURN, which is cold.

### Test strategy

- **Unit tests** (`tests/pipeline_*.test.js` and new files):
  - `tests/window_cancel.test.js` — open `restTargetWindow` via Anna of Brittany (existing canonical card), assert `CANCEL_WINDOW` clears it without firing the chained draw, asserts `usedThisTurn` is **false** on the leader (rollback), assert pipelineResume is discarded.
  - `tests/window_activate_main_confirm.test.js` — ACTIVATE_MAIN on Anna of Brittany opens `activateMainConfirmWindow`, leader is **not** rested, `usedThisTurn` is **false**, no `restTargetWindow` yet. Then ACTIVATE_MAIN_CONFIRM commits — rested + used + restTargetWindow opens. Plus a cancel branch.
  - `tests/window_end_turn_gate.test.js` — open a cancellable window (restTarget), END_TURN, assert window cancelled + turn flipped + WINDOW_CANCELLED message broadcast. Then open a blocking window (counterWindow surrogate or opponentChoosesWindow), END_TURN, assert END_TURN_REJECTED + state unchanged.
  - `tests/window_descriptor_coverage.test.js` — enumerate every `*Window` field that appears as a key on `game` at construction (`gameInit`) and assert it has an entry in `WINDOW_DESCRIPTORS`. Prevents future card authors from adding a window kind without classifying it. This is the scalability guard.
  - `tests/window_mandatory_pick.test.js` — open a mandatory `restTargetWindow` (Anna of Brittany, "Rest 1 of your opponent's Characters" — mandatory per §8-4-4-1) with exactly one legal candidate. END_TURN. Assert: window closed via `forcedPickHelper`, the candidate was rested, the draw chain fired, `WINDOW_AUTO_RESOLVED` broadcast. Parallel test with zero legal candidates: window closes cleanly per §1-3-2, no rest, no draw, no error.
  - `tests/window_optional_pick.test.js` — open an optional `addFromTrashWindow` ("up to 2 cards", `pickRequirement: 'optional'`). END_TURN. Assert: window auto-cancelled, no pick made, no card moved (§4-8 / §8-4-4-1 — optional zero is legal).
  - `tests/window_activate_main_reentry.test.js` — open confirm window for card A, then send ACTIVATE_MAIN for card B; assert the confirm window now references card B (re-targeted) and card A is untouched.
  - Touch up `pipeline_anna_of_brittany.test.js`: the test at line 30 (`srv.runPipeline('activateMain', …)`) bypasses the action handler so it's unaffected. But any test that goes through `handleAction({type:'ACTIVATE_MAIN'})` will need an `ACTIVATE_MAIN_CONFIRM` follow-up. Audit needed.
- **E2E scenarios** (`.claude/agents/e2e-test-agent.md`):
  - Two-WS-client flow: P1 clicks character, clicks Attack, clicks misclick zone, asserts attackDeclarationWindow open, clicks Cancel (in bottom-right slot), asserts phase back to MAIN, attacker un-rested.
  - P1 clicks [Activate: Main] card, sees confirm overlay, clicks Cancel, asserts no state change. Then clicks again, clicks Confirm, asserts normal activation.
  - P1 opens restTarget via Anna, doesn't pick, clicks End Turn, asserts auto-cancel toast + turn passes to P2 + Anna leader is NOT rested and NOT marked used (rollback complete because activation never committed past confirm — but wait, this scenario only triggers if v2 makes Anna's activation cancellable post-confirm too; see Risks).
- **Rules-compliance audit needed: YES.** Sections to audit:
  - 6 (Game Progression) — END_TURN policy.
  - 7-1-1 — attack cancel commit point.
  - 8-4-1 — Activate Main commit point.
  - 10-2-13 — [Once Per Turn] consumption point.
  - Recommended: also pass `docs/rules/rule_manual.pdf` to the rules-compliance-agent for player-expectation cross-check on the confirm dialog wording (the manual phrases activation in user-facing terms; the dialog copy should match).

## Risks and tradeoffs

- **The confirm-then-pipeline split moves Activate Main's `card.rested = true` and `card.usedThisTurn = true` to the confirm step.** This is the right semantic per rules 8-4-1 and 10-2-13, but it means: between confirm-window-open and confirm-window-close, an opponent's [Opponent's Turn] effect cannot legally observe the card as "used" yet. Confirm whether any current card depends on the *current* (incorrect) early-set timing. Faustian-Jack-style trigger windows and Schola Montis Belli (the card cited in the ACTIVATE_MAIN comment at server.js:1142) are the suspects. **Mitigation:** rules-compliance-agent must verify this is the intended timing before coding starts. If a card needs the legacy timing, that card is bugged at the rules level and the fix is correct.
- **After ACTIVATE_MAIN_CONFIRM, the rest of the pipeline (sub-windows like restTarget) is still cancellable.** The descriptor table says so — `restTargetWindow.cancelKind = 'cancellable'`. This means a player could cancel Anna's rest-target picker *after* paying the [Once Per Turn] slot, effectively burning the activation. **Tradeoff:** this matches rule 8-4-4 (the player has not yet "chosen" — rule 8-4-1-5 hasn't resolved). The user has decided per the spec that confirm appears on every activation; cancelling mid-resolution is an additional rules-compliant safety net but does consume the [Once Per Turn] slot. **Recommendation:** confirm-step cancel = full rollback (no cost paid yet). Mid-resolution cancel = window closes, pipeline aborts via 'abort-block', `usedThisTurn` remains true (slot consumed). Document this clearly in the UI cancel-confirmation copy: "Cancelling now will end the ability; the once-per-turn use is already consumed."
- **The `activeWindow` field is duplicate state** — it's derived from the `*Window` slots. If `openWindow`/`closeWindow` is bypassed somewhere, `activeWindow` and the slot drift apart. **Mitigation:** the descriptor-coverage test catches missing entries; we also add a state invariant check (`assertWindowsConsistent(game)`) in dev mode at the end of every `handleAction`. Production builds skip it.
- **Existing tests that call `handleAction({type:'ACTIVATE_MAIN'})` and then look at state will all break.** They need an `ACTIVATE_MAIN_CONFIRM` follow-up. This is a one-shot migration cost. Worth it.
- **CANCEL_ATTACK alias.** Keeping the old action name for one release is brittle — coding-agent should add a TODO to remove it next sprint.
- **What we're choosing not to optimize:** multi-window queues. `effectQueue` is reserved in game state (server.js:672) for the future; we don't fill it now. The current "one window at a time" invariant continues to hold under v2.

## Handoff

Coding-agent: implement per the data model and engine changes above. Specifically:
1. Add `WINDOW_DESCRIPTORS` const map at the top of the windows section of server.js (after the gameInit function so it's visible to openers).
2. Add `openWindow` / `closeWindow` / `cancelWindow` / `autoSkipWindow` / `forcedPickHelper` helpers. Refactor every existing `*Window` opener and resolver to route through them (mechanical change). Each picker opener call site must pass `pickRequirement: 'optional' | 'mandatory'` in the payload based on the card's ability text — `'mandatory'` is the default if omitted (Note F).
3. Split `ACTIVATE_MAIN` into ACTIVATE_MAIN (open confirm) + ACTIVATE_MAIN_CONFIRM (commit + pipeline).
4. Replace `CANCEL_ATTACK` body with a call to the unified `CANCEL_WINDOW` path; keep the action name as alias for one release.
5. Rewrite the `END_TURN` handler to walk the descriptor table.
6. Client (`game.html`): move the cancel button out of the per-card `#attackingBtns` panel and into a dedicated bottom-right region (`#globalWindowControls`) that surfaces (a) the cancel CTA for any `cancellable` window owned by viewer, (b) the confirm CTA for `activateMainConfirmWindow`. Place it where the ability-description-on-hover popup already lives (per user spec).
7. Tests as listed under Test Strategy.
8. Do not deviate without updating this doc.

Pre-deploy gate: unit tests, e2e, rules-compliance-agent run. All must be green.
