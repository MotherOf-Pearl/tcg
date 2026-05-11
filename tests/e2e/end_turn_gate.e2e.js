// Window-lifecycle v2 scenario #3 — END_TURN window-aware gate.
//
// Three sub-cases:
//
// (A) autoCancel branch — P1 opens activateMainConfirmWindow (cancellable,
//     endTurnPolicy: 'autoCancel'). Sends END_TURN. Asserts:
//        - WINDOW_CANCELLED broadcast (reason 'endTurn')
//        - activateMainConfirmWindow null on both clients
//        - turn flipped, activePlayer is the other player
//        - leader of the original active player NOT rested, NOT used
//          (because the cancel happened pre-commit)
//
// (B) forcedPickHelper branch — P1 declares an attack (mandatory
//     attackDeclarationWindow, candidateUids undefined → no legal pick).
//     Sends END_TURN. Asserts:
//        - WINDOW_AUTO_RESOLVED broadcast for attackDeclarationWindow
//        - attackDeclarationWindow null
//        - turn flipped
//     NOTE: with the current engine, attackDeclarationWindow lacks
//     candidateUids — forcedPickHelper closes it without picking a
//     target. The auto-resolved broadcast still fires. This documents
//     current behavior.
//
// (C) END_TURN_REJECTED for a blocking window — task asked us to surface
//     this. We do not have a clean organic way to open a blocking window
//     (`triggerWindow`/`attackRedirectWindow`/`opponentChoosesWindow`) via
//     just the protocol without specific card setup. Skipping with a
//     BLOCKER report; see e2e-test-agent final report.
//
// The "Anna mandatory restTargetWindow" path from the task description
// no longer matches current code (Anna's [Activate: Main] is now a
// bounceTarget with optional:true, per parser output). The forcedPickHelper
// path is verified through attackDeclarationWindow instead — the design's
// END_TURN walk treats all mandatory pickers identically.
const { startServer, lobby, advanceToMain, activeClient, inactiveClient, runSuite } = require('./harness');

async function subA_autoCancelConfirmWindow(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  const active = activeClient(clients);
  const inactive = inactiveClient(clients);
  const leaderUid = active.lastState.players[active.playerId].leader.uid;

  // Open confirm window.
  active.action({ type: 'ACTIVATE_MAIN', cardUid: leaderUid });
  await p1.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm open' });
  await p2.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm open (other)' });
  const turnBefore = active.lastState.turn;
  const activeBefore = active.lastState.activePlayer;

  // END_TURN — should auto-cancel the confirm + flip turn.
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

async function subB_forcedPickAttackDeclaration(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  // Advance past turn 1 so an attack is legal.
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

  // Declare attack; do NOT select target.
  active.action({ type: 'DECLARE_ATTACK', attackerUid });
  await p1.waitForState(g => !!g.attackDeclarationWindow && g.phase === 'ATTACKING', { label: 'attack declared (p1)' });
  await p2.waitForState(g => !!g.attackDeclarationWindow && g.phase === 'ATTACKING', { label: 'attack declared (p2)' });

  // END_TURN — should route through forcedPickHelper (mandatory picker).
  active.action({ type: 'END_TURN' });
  // The window has no candidateUids set — forcedPickHelper closes cleanly
  // and still broadcasts WINDOW_AUTO_RESOLVED with resolution=null.
  // BUT the implementation only broadcasts WINDOW_AUTO_RESOLVED when
  // forcedPickHelper returns; let me verify it does even with null candidates.
  // (Reading END_TURN: it always broadcasts WINDOW_AUTO_RESOLVED if isPicker
  //  && mandatory, regardless of forcedPickHelper outcome — so yes.)
  const awr = await p1.waitFor(m => m.type === 'WINDOW_AUTO_RESOLVED' && m.windowField === 'attackDeclarationWindow', { label: 'WINDOW_AUTO_RESOLVED (p1)', timeoutMs: 5000 });
  if (awr.reason !== 'endTurnMandatory') throw new Error(`reason expected endTurnMandatory, got ${awr.reason}`);
  await p2.waitFor(m => m.type === 'WINDOW_AUTO_RESOLVED' && m.windowField === 'attackDeclarationWindow', { label: 'WINDOW_AUTO_RESOLVED (p2)' });
  await p1.waitForState(g => g.attackDeclarationWindow == null && g.turn > turnBefore, { label: 'window closed + turn flipped (p1)' });
  await p2.waitForState(g => g.attackDeclarationWindow == null && g.turn > turnBefore, { label: 'window closed + turn flipped (p2)' });

  p1.close(); p2.close();
}

(async () => {
  let server;
  let passed = false;
  try {
    server = await startServer();
    const r = await runSuite('end_turn_gate.e2e', [
      { name: '(A) END_TURN auto-cancels activateMainConfirmWindow; turn flips; leader un-mutated', fn: () => subA_autoCancelConfirmWindow(server.port) },
      { name: '(B) END_TURN auto-resolves mandatory attackDeclarationWindow via forcedPickHelper', fn: () => subB_forcedPickAttackDeclaration(server.port) },
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
