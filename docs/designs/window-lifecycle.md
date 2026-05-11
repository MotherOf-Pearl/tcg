# Design: Uniform Interactive-Window Lifecycle

**Author:** solution-architect-agent
**Status:** Approved — ready for implementation by coding-agent
**Rules basis:** `docs/rules/rule_comprehensive.pdf` v1.2.0

## Problem

The engine has multiple interactive windows (`restTargetWindow`, `koTargetWindow`, the implicit attack-target window, the implicit Activate-Main flow) but no uniform contract for their lifecycle. Three observed bugs are symptoms of the same gap:

1. Attack flow has no cancel — a misclick during target selection soft-locks the player.
2. Activate Main has no confirmation/cancel — accidentally clicking `[Activate: Main]` commits the once-per-turn use with no escape.
3. `END_TURN` is legal while a window is open — turn advances for the opponent while the previous player still has unresolved interactive state.

Each is a missing invariant on the same lifecycle. Fix the lifecycle once → all three are fixed, and every future ability that opens a window is correct by default.

## Scope

**In scope:**
- Define a uniform `WindowContract` shape for every interactive window in `server.js`.
- Add two new actions: `WINDOW_CANCEL` (uniform across window types) and a precondition check on phase transitions.
- Migrate existing windows (`restTargetWindow`, `koTargetWindow`, attack-target, Activate-Main entry) to the contract.
- Insert an `activateMainConfirm` window as the entry point to every Activate-Main pipeline.
- Update the UI in `game.html` to render a uniform cancel button per the contract.

**Out of scope:**
- UI restyling beyond the cancel-button placement (placement spec: same spot as ability description on hover, bottom-right of screen).
- Replacement-effect lifecycle (separate concern).
- Counter Step interactions — already a distinct rules-defined phase, not a free-form window.
- The `rule_manual.pdf` audit (defer to rules-compliance-agent before merge).

**Cards/keywords/phases affected:** all current cards with interactive abilities (Anna of Brittany leader, KO-target effects, attack flows). Schema is forward-compatible — no card-specific code.

## Design

### Data model

Every interactive window in `game.<windowField>` conforms to:

```js
{
  type: string,                  // 'attackingWindow' | 'restTargetWindow' | 'koTargetWindow' | 'activateMainConfirm' | ...
  playerId: string,              // who owns the choice
  candidateUids: string[],       // selectable targets (empty for confirmation-only windows)
  pipelineResume: ResumeSpec,    // existing — chain to fire after resolve
  cancellable: boolean,          // is WINDOW_CANCEL legal?
  onCancel: (game) => void,      // refund/restore logic; called by WINDOW_CANCEL
  blocksPhaseExit: boolean,      // is END_TURN/END_PHASE illegal while this is open?
  meta: object,                  // window-specific data (e.g. cost preview for activateMainConfirm)
}
```

Invariants:
- `cancellable === true` ⟹ `onCancel` is non-null and idempotent.
- `blocksPhaseExit === true` ⟹ `END_TURN` rejects with a UX error message.
- `cancellable === true && blocksPhaseExit === false` is the canonical "pre-commit" state — `END_TURN` auto-fires `WINDOW_CANCEL` then transitions.
- `cancellable === false && blocksPhaseExit === true` is the canonical "post-commit, mid-resolution" state.

The `meta` field is intentionally an open object so future window types can carry shape-specific data (e.g. cost preview, choice prompts) without engine changes.

### Engine changes

**New action handlers** in `handleAction`:

```js
// Uniform across all window types.
case 'WINDOW_CANCEL': {
  const w = game.activeWindow;  // see below
  if (!w || w.playerId !== playerId) return reject('no window');
  if (!w.cancellable) return reject('window not cancellable');
  w.onCancel(game);
  clearWindow(game);
  return ok();
}
```

**New helper:** `game.activeWindow` — a getter that returns the currently open window regardless of which field it lives in (`restTargetWindow`, `koTargetWindow`, etc.). Implementation: scan known window fields; assert at most one is non-null. Long-term migration target: collapse to a single `game.activeWindow` field and drop the per-type fields.

**Phase-transition guard:** every phase-transition action (currently `END_TURN`, future `END_PHASE`) calls:

```js
function canEndPhase(game, playerId) {
  const w = game.activeWindow;
  if (!w) return { ok: true };
  if (w.playerId !== playerId) return { ok: true }; // opponent's window doesn't block you
  if (w.blocksPhaseExit) return { ok: false, reason: `resolve ${w.type} first or cancel it` };
  if (w.cancellable) { w.onCancel(game); clearWindow(game); return { ok: true }; }
  // cancellable === false && blocksPhaseExit === false is malformed — log and treat as blocking.
  return { ok: false, reason: 'inconsistent window state' };
}
```

**New window: `activateMainConfirm`**. Every `srv.runPipeline('activateMain', ...)` opens this window first, *before* any cost payment or state mutation. Shape:

```js
{
  type: 'activateMainConfirm',
  playerId,
  candidateUids: [],
  pipelineResume: { kind: 'beginActivateMain', cardUid, abilityIdx },
  cancellable: true,
  onCancel: () => {},  // no state change to revert — nothing has happened yet.
  blocksPhaseExit: false,
  meta: { cardUid, abilityDescription, costPreview },
}
```

Player action `ACTIVATE_MAIN_CONFIRM` advances to step 8-4-1-3 (cost payment) → 8-4-1-4 (activate) → 8-4-1-5 (resolve). Player action `WINDOW_CANCEL` discards the window with zero side effects.

**Migrate existing windows** to set the new flags:

| Window | `cancellable` | `blocksPhaseExit` | Notes |
|---|---|---|---|
| `attackingWindow` (between 7-1-1-1 and 7-1-1-2) | `true` | `false` | `onCancel` un-rests the attacker. Cancel is rules-safe because [When Attacking] hasn't fired. |
| `attackingWindow` (after target selected, 7-1-1-3+) | `false` | `true` | Should be a different window state entirely — `attackResolving`. Coding-agent: split this into two windows. |
| `restTargetWindow` (Anna of Brittany) | `false` | `true` | The Activate-Main use has been committed by this point per 8-4-1-3. No backing out. |
| `koTargetWindow` | `false` | `true` | Same reasoning — the parent effect has already been activated per 8-4-1-4. |
| `activateMainConfirm` (new) | `true` | `false` | Pre-commit by construction. |

### Generalization check

**Card universe:** the contract is data-only. Every existing card with an interactive window fits — `cancellable` / `blocksPhaseExit` are flags on the window definition, not card-specific branches. No engine code references card IDs.

**Future-proofing:** new ability types (e.g. "choose one of two", "scry-N then pick", "redirect attack") declare a new window `type` + the standard contract fields. The engine handles `WINDOW_CANCEL` and phase-exit guards uniformly. No engine changes per new ability.

**Edge cases enumerated:**

- *Both players have a window open simultaneously* — rules permit opponent windows (e.g. blocker decision during Block Step per 7-1-2). The contract's `playerId` field handles this; `canEndPhase` checks only the current player's windows.
- *Window references a card that gets removed mid-window* (e.g. attacker is KO'd by a [Trigger] before target selection) — `onCancel` and the resume chain must handle missing-card cases. Standard pattern: if `cardUid` no longer exists in any open area per 8-1-3-1-3, `onCancel(game)` is called and the window is force-cleared. The pipeline's resume gets a "no-op" signal.
- *Cost payment fails mid-way* (per 10-2-13-5) — this is *not* a cancel. Once-per-turn is still consumed. Surface as a separate `payment-failed` outcome, not via `WINDOW_CANCEL`.
- *Player disconnects with window open* — preserve the window in game state. On reconnect, the window is still there. (Existing behavior; this design doesn't change it.)
- *[Once Per Turn] interaction* — `activateMainConfirm` does NOT consume the once-per-turn use; only successful confirmation + cost payment does. This matches 10-2-13-3 (consumption happens at resolution, not at specification).

### Performance

**Hot paths:** `handleAction` is called once per player action. The added cost is:
- `O(1)` lookup of `game.activeWindow` (constant-time field scan).
- `O(1)` flag check on `cancellable` / `blocksPhaseExit`.

No new per-tick or per-frame cost. No new data-structure changes that scale with card count.

**Data structures:** window fields remain plain objects on `game`. No indexing required — there is at most one active window per game by construction (asserted in `activeWindow` getter).

### Test strategy

**Unit tests** (`tests/`):

- `pipeline_anna_of_brittany.test.js` — extend with:
  - `activateMainConfirm` window opens on activate-main trigger, `cancellable: true`, no state mutation yet.
  - `WINDOW_CANCEL` during `activateMainConfirm` → no once-per-turn consumed, no rest fired.
  - `ACTIVATE_MAIN_CONFIRM` after the window → existing rest-target-window flow runs (unchanged).
  - `END_TURN` during `activateMainConfirm` → window auto-cancels, turn advances.
  - `END_TURN` during `restTargetWindow` → rejected, turn does not advance.
- `tests/window_lifecycle.test.js` (new) — pure contract tests:
  - `WINDOW_CANCEL` invariants per window type.
  - `canEndPhase` matrix across `{cancellable, blocksPhaseExit}` combinations.
  - Opponent-window does not block current player's phase exit.
- `tests/attack_cancel.test.js` (new) — cancel between declaration and target selection un-rests the attacker; no [When Attacking] effects fired.

**E2E scenarios** (e2e-test-agent):

- Two clients: p1 starts attack → p1 cancels mid-target → both clients see attacker un-rest cleanly.
- Two clients: p1 starts Activate Main → p1 cancels at confirmation → both clients see no state change, p1 can re-activate.
- Two clients: p1 opens `restTargetWindow` → p1 tries `END_TURN` → both clients see the rejection message; p1 must resolve.

**Rules-compliance audit** (rules-compliance-agent):
- Verify the `attackingWindow` split (cancellable pre-target vs. blocking post-target) against 7-1-1-1 through 7-1-1-3.
- Verify `activateMainConfirm` is rules-compliant per 8-4-1 (it sits between 8-4-1-2 and 8-4-1-3, doesn't violate 10-2-13-3).
- Cross-check `rule_manual.pdf` for any player-facing rules that contradict.

## Risks and tradeoffs

- **One extra click on every Activate Main.** Conscious choice — eliminates the misclick footgun. Inconsistency-with-paper-game cost is low; misclicks don't exist on paper.
- **Migration of existing windows touches `server.js` in many places.** Coding-agent should grep for every `game.<x>Window` assignment site and ensure the new flags are set. Unit tests catch missed sites.
- **Splitting `attackingWindow` into pre/post-target windows is a larger refactor than a flag flip.** Acceptable — keeps the state machine honest. Coding-agent: confirm the test surface around attacks before splitting.
- **`onCancel` correctness is per-card-author burden.** Mitigation: the migration table above covers all current windows; future authors get unit-test patterns and a checklist in CLAUDE.md.
- **`game.activeWindow` as a getter scanning fields is a transitional hack.** Long-term, consolidate to a single field. Out of scope for this design — flagged for follow-up.

## Handoff

**Coding-agent:** implement per the data model and engine changes above. Order:

1. Add `WindowContract` flags to every existing window assignment site. Don't change behavior yet — just attach the metadata.
2. Add `WINDOW_CANCEL` action handler + `game.activeWindow` getter.
3. Add `canEndPhase` guard to `END_TURN`.
4. Add `activateMainConfirm` window as the entry point to `runPipeline('activateMain', ...)`. Existing flows now route through it.
5. Split `attackingWindow` into declaration vs. resolving phases (last because biggest blast radius).
6. UI: render the cancel button when `game.activeWindow?.cancellable && game.activeWindow.playerId === me`. Placement: bottom-right of screen, above the ability description on hover.

Do not deviate from this design without updating this doc.

**Unit-test-agent + e2e-test-agent:** add the tests listed under "Test strategy" before merge.

**Rules-compliance-agent:** run the audit listed above against both `rule_comprehensive.pdf` and `rule_manual.pdf` before merge.
