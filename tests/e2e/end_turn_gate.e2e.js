// Window-lifecycle v2 scenario #3 — END_TURN window-aware gate.
//
// Three sub-cases:
//
// (A) autoCancel branch (pre-commit) — P1 opens activateMainConfirmWindow
//     (cancellable, endTurnPolicy: 'autoCancel'). Sends END_TURN. Asserts:
//        - WINDOW_CANCELLED broadcast (reason 'endTurn')
//        - activateMainConfirmWindow null on both clients
//        - turn flipped, activePlayer is the other player
//        - leader of the original active player NOT rested, NOT used
//          (because the cancel happened pre-commit)
//
// (B) autoCancel branch (attack declaration) — P1 declares an attack
//     (attackDeclarationWindow, classified as pickRequirement: 'optional'
//     per the fix applied 2026-05-11: an unresolved attack is an abandoned
//     UX action, not a §8-4-4-1 mandatory pick). END_TURN routes through
//     autoCancel → cancelWindow → field-specific rollback (unrest attacker,
//     clear battleState, restore MAIN). Asserts:
//        - WINDOW_CANCELLED broadcast for attackDeclarationWindow
//        - attackDeclarationWindow null, battleState null, attacker un-rested
//        - turn flipped
//
// (C) END_TURN_REJECTED for a blocking window — uses the test-mode hatch
//     (BOOHAW_TEST_HATCH=1 env var) to deterministically open a blocking
//     triggerWindow via DEBUG_SET_WINDOW. END_TURN must reject and leave
//     state unchanged.
const { startServer, lobby, advanceToMain, activeClient, inactiveClient, runSuite } = require('./harness');

async function subA_autoCancelConfirmWindow(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  const active = activeClient(clients);
  const leaderUid = active.lastState.players[active.playerId].leader.uid;

  active.action({ type: 'ACTIVATE_MAIN', cardUid: leaderUid });
  await p1.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm open' });
  await p2.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm open (other)' });
  const turnBefore = active.lastState.turn;
  const activeBefore = active.lastState.activePlayer;

  active.action({ type: 'END_TURN' });
  await p1.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'activateMainConfirmWindow' && m.reason === 'endTurn', { label: 'WINDOW_CANCELLED endTurn (p1)' });
  await p2.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'activateMainConfirmWindow' && m.reason === 'endTurn', { label: 'WINDOW_CANCELLED endTurn (p2)' });
  await p1.waitForState(g => g.turn > turnBefore && g.activeWindow == null && g.activateMainConfirmWindow == null, { label: 'turn flipped + window cleared (p1)' });
  await p2.waitForState(g => g.turn > turnBefore && g.activeWindow == null && g.activateMainConfirmWindow == null, { label: 'turn flipped + window cleared (p2)' });
  for (const c of [p1, p2]) {
    if (c.lastState.activePlayer === activeBefore) throw new Error(`${c.label}: activePlayer did not flip (still ${activeBefore})`);
    const ld = c.lastState.players[active.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: leader rested after end-turn autoCancel — should be reverted (cancel happened pre-commit)`);
    if (ld.usedThisTurn) throw new Error(`${c.label}: leader.usedThisTurn after end-turn autoCancel — should be reverted`);
  }

  p1.close(); p2.close();
}

async function subB_autoCancelAttackDeclaration(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  let active = activeClient(clients);
  active.action({ type: 'END_TURN' });
  await p1.waitForState(g => g.turn >= 2, { label: 'turn 2' });
  await p2.waitForState(g => g.turn >= 2, { label: 'turn 2 (p2)' });
  active = activeClient(clients);
  active.action({ type: 'DRAW_CARD' });
  active.action({ type: 'DRAW_DON' });
  await p1.waitForState(g => g.phase === 'MAIN', { label: 'turn 2 MAIN (p1)' });
  await p2.waitForState(g => g.phase === 'MAIN', { label: 'turn 2 MAIN (p2)' });
  active = activeClient(clients);
  const attackerUid = active.lastState.players[active.playerId].leader.uid;
  const turnBefore = active.lastState.turn;
  const activePlayerBefore = active.playerId;

  active.action({ type: 'DECLARE_ATTACK', attackerUid });
  await p1.waitForState(g => !!g.attackDeclarationWindow && g.phase === 'ATTACKING', { label: 'attack declared (p1)' });
  await p2.waitForState(g => !!g.attackDeclarationWindow && g.phase === 'ATTACKING', { label: 'attack declared (p2)' });

  active.action({ type: 'END_TURN' });
  // With fix-A: attackDeclarationWindow is `optional`, so END_TURN routes
  // through autoCancel (NOT forcedPickHelper). The field-specific rollback
  // in cancelWindow unrests the attacker, clears battleState, and restores
  // MAIN phase BEFORE the turn flips. Broadcast is WINDOW_CANCELLED.
  await p1.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'attackDeclarationWindow' && m.reason === 'endTurn', { label: 'WINDOW_CANCELLED attack endTurn (p1)' });
  await p2.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'attackDeclarationWindow' && m.reason === 'endTurn', { label: 'WINDOW_CANCELLED attack endTurn (p2)' });
  await p1.waitForState(g => g.attackDeclarationWindow == null && g.battleState == null && g.turn > turnBefore, { label: 'attack cleared + turn flipped (p1)' });
  await p2.waitForState(g => g.attackDeclarationWindow == null && g.battleState == null && g.turn > turnBefore, { label: 'attack cleared + turn flipped (p2)' });
  for (const c of [p1, p2]) {
    const attacker = c.lastState.players[activePlayerBefore].leader;
    if (attacker.rested) throw new Error(`${c.label}: attacker still rested after END_TURN autoCancel — rollback did not fire`);
  }

  p1.close(); p2.close();
}

async function subC_rejectBlockingWindow(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  const active = activeClient(clients);
  const turnBefore = active.lastState.turn;
  const activeBefore = active.lastState.activePlayer;

  // Use the test-mode hatch to deterministically open a blocking
  // triggerWindow. This is gated by BOOHAW_TEST_HATCH=1 — the env var is
  // set by this spec's wrapper before startServer().
  active.action({
    type: 'DEBUG_SET_WINDOW',
    field: 'triggerWindow',
    payload: { playerId: active.playerId, sourceCardUid: null, cardUid: 'dummy-trigger-uid' },
  });
  await p1.waitForState(g => g.triggerWindow != null, { label: 'triggerWindow set (p1)' });
  await p2.waitForState(g => g.triggerWindow != null, { label: 'triggerWindow set (p2)' });

  active.action({ type: 'END_TURN' });
  const rej = await active.waitFor(m => m.type === 'END_TURN_REJECTED', { label: 'END_TURN_REJECTED', timeoutMs: 3000 });
  if (!rej.reason) throw new Error('END_TURN_REJECTED missing reason');
  if (rej.blockingWindow !== 'triggerWindow') throw new Error(`blockingWindow expected triggerWindow, got ${rej.blockingWindow}`);

  // Confirm state unchanged: still same active player, same turn, window still open.
  await p1.waitForState(g => g.triggerWindow != null && g.turn === turnBefore && g.activePlayer === activeBefore, { label: 'state unchanged (p1)' });
  await p2.waitForState(g => g.triggerWindow != null && g.turn === turnBefore && g.activePlayer === activeBefore, { label: 'state unchanged (p2)' });

  p1.close(); p2.close();
}

(async () => {
  // Enable the test-mode hatch for sub-case (C). Inherited by the spawned
  // server.js via harness.startServer's env passthrough.
  process.env.BOOHAW_TEST_HATCH = '1';

  let server;
  let passed = false;
  try {
    server = await startServer();
    const r = await runSuite('end_turn_gate.e2e', [
      { name: '(A) END_TURN auto-cancels activateMainConfirmWindow; turn flips; leader un-mutated', fn: () => subA_autoCancelConfirmWindow(server.port) },
      { name: '(B) END_TURN auto-cancels attackDeclarationWindow; attacker un-rested; battleState cleared; turn flips', fn: () => subB_autoCancelAttackDeclaration(server.port) },
      { name: '(C) END_TURN rejects when blocking triggerWindow open (via DEBUG_SET_WINDOW hatch)', fn: () => subC_rejectBlockingWindow(server.port) },
    ]);
    passed = r.failed === 0;
  } catch (e) {
    console.error('SUITE FAILURE:', e.stack || e.message);
    if (server) console.error('--- server stderr (tail) ---\n' + server.getStderr().slice(-3000));
  } finally {
    if (server) { try { server.proc.kill('SIGKILL'); } catch (_) {} }
    process.exit(passed ? 0 : 1);
  }
})();
