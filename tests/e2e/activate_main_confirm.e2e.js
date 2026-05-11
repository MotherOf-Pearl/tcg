// Window-lifecycle v2 scenario #2 — Activate Main confirm + cancel.
//
// Anna of Brittany leader (ST03-001) has [Activate: Main] [Once Per Turn]
// DON!! -4: Return up to 1 Character with a cost of 5 or less. The
// CURRENT parsed ability is a bounceTarget (formerly restTarget — the unit
// test was written against the old text, which is why 3 pre-existing tests
// fail). The window-lifecycle v2 contract is independent of what the
// downstream pipeline opens: the test below verifies the CONFIRM stage,
// which is what the design hinges on.
//
// Steps:
//   1. P1 sends ACTIVATE_MAIN for leader. Server opens
//      activateMainConfirmWindow. Both clients see it. Leader is NOT
//      rested, leader.usedThisTurn is falsy, no downstream window.
//   2. P1 sends CANCEL_WINDOW. Confirm window closes. Leader still NOT
//      rested, NOT used.
//   3. P1 sends ACTIVATE_MAIN again, then ACTIVATE_MAIN_CONFIRM. Leader
//      IS now rested, IS used; activateMainConfirmWindow is null. The
//      next downstream pipeline window (donReturnWindow on Anna with
//      cost-4) may or may not open depending on DON availability — the
//      test does not assume which (the design's commit point is at
//      CONFIRM, and rest+used must be set there regardless of pipeline
//      outcome per design Notes E/F).
const { startServer, lobby, advanceToMain, runSuite } = require('./harness');

// Drive lobby + reach a turn where p1 is the active player. createGame
// randomly picks firstPlayer, so we may need to advance one turn.
async function lobbyP1Active(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  if (clients.p1.lastState.activePlayer !== p1.playerId) {
    // p2 is first player. Ask p2 to end turn 1; then p1 reaches MAIN turn 2.
    p2.action({ type: 'END_TURN' });
    await p1.waitForState(g => g.activePlayer === p1.playerId && g.phase === 'DRAW' || g.phase === 'DON' || g.phase === 'MAIN', { label: 'turn flip to p1' });
    // p1 now needs to draw a card and DRAW_DON to reach MAIN.
    // After doEnd: phase='DRAW'. NEXT_PHASE: ? actually doEnd already
    // ran doRefresh internally? No — see nextPhase: at DRAW, calls
    // doRefresh; at DON, calls doDraw — wait that's backwards. Re-read.
    // From server.js nextPhase: order DRAW->DON triggers doDraw before
    // setting phase. Hmm. Easier: send DRAW_CARD then DRAW_DON.
    p1.action({ type: 'DRAW_CARD' });
    p1.action({ type: 'DRAW_DON' });
    await p1.waitForState(g => g.activePlayer === p1.playerId && g.phase === 'MAIN', { label: 'p1 MAIN' });
    await p2.waitForState(g => g.activePlayer === p1.playerId && g.phase === 'MAIN', { label: 'p1 MAIN (p2 view)' });
  }
  return clients;
}

async function scenario(serverPort) {
  const { p1, p2 } = await lobbyP1Active(serverPort);
  const leaderUid = p1.lastState.players[p1.playerId].leader.uid;
  const initialLeader = p1.lastState.players[p1.playerId].leader;
  if (initialLeader.rested) throw new Error('precondition: leader should not be rested');
  if (initialLeader.usedThisTurn) throw new Error('precondition: leader should not be used yet');

  // === Phase A: open confirm ===
  p1.action({ type: 'ACTIVATE_MAIN', cardUid: leaderUid });
  await p1.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm window open (p1)' });
  await p2.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm window open (p2)' });

  for (const c of [p1, p2]) {
    const w = c.lastState.activateMainConfirmWindow;
    if (!w) throw new Error(`${c.label}: confirm window missing`);
    if (w.playerId !== p1.playerId) throw new Error(`${c.label}: confirm window wrong playerId`);
    if (w.cardUid !== leaderUid) throw new Error(`${c.label}: confirm window wrong cardUid`);
    const ld = c.lastState.players[p1.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: leader rested before confirm — DESIGN VIOLATION`);
    if (ld.usedThisTurn) throw new Error(`${c.label}: leader usedThisTurn before confirm — DESIGN VIOLATION`);
    // No downstream window has opened yet.
    if (c.lastState.bounceTargetWindow) throw new Error(`${c.label}: bounceTargetWindow opened before confirm`);
    if (c.lastState.donReturnWindow) throw new Error(`${c.label}: donReturnWindow opened before confirm`);
    if (c.lastState.restTargetWindow) throw new Error(`${c.label}: restTargetWindow opened before confirm`);
    // activeWindow should point at the confirm window.
    if (!c.lastState.activeWindow || c.lastState.activeWindow.field !== 'activateMainConfirmWindow') {
      throw new Error(`${c.label}: activeWindow != activateMainConfirmWindow (got ${JSON.stringify(c.lastState.activeWindow)})`);
    }
  }

  // === Phase B: cancel ===
  p1.action({ type: 'CANCEL_WINDOW' });
  await p1.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'activateMainConfirmWindow', { label: 'WINDOW_CANCELLED (p1)' });
  await p2.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'activateMainConfirmWindow', { label: 'WINDOW_CANCELLED (p2)' });
  // waitForNewState — skip history (pre-ACTIVATE_MAIN state also had a null
  // confirm window) to make sure we read the actual post-cancel snapshot.
  await p1.waitForNewState(g => g.activateMainConfirmWindow == null && g.activeWindow == null, { label: 'confirm closed (p1)' });
  await p2.waitForNewState(g => g.activateMainConfirmWindow == null && g.activeWindow == null, { label: 'confirm closed (p2)' });
  for (const c of [p1, p2]) {
    const ld = c.lastState.players[p1.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: leader rested after cancel — should be reverted`);
    if (ld.usedThisTurn) throw new Error(`${c.label}: leader usedThisTurn after cancel — should be reverted`);
    if (c.lastState.activeWindow) throw new Error(`${c.label}: activeWindow not cleared after cancel`);
  }

  // === Phase C: re-trigger and CONFIRM ===
  p1.action({ type: 'ACTIVATE_MAIN', cardUid: leaderUid });
  await p1.waitForState(g => !!g.activateMainConfirmWindow, { label: 'confirm re-opened' });
  // Leader still not mutated.
  for (const c of [p1, p2]) {
    const ld = c.lastState.players[p1.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: leader rested before re-confirm`);
  }
  p1.action({ type: 'ACTIVATE_MAIN_CONFIRM', cardUid: leaderUid });
  // After confirm: confirm window closed, leader rested + used.
  await p1.waitForState(g => g.activateMainConfirmWindow == null && g.players[p1.playerId].leader.rested === true, { label: 'post-confirm leader rested (p1)' });
  await p2.waitForState(g => g.activateMainConfirmWindow == null && g.players[p1.playerId].leader.rested === true, { label: 'post-confirm leader rested (p2)' });
  for (const c of [p1, p2]) {
    const ld = c.lastState.players[p1.playerId].leader;
    if (!ld.rested) throw new Error(`${c.label}: leader NOT rested post-confirm — commit didn't fire`);
    if (!ld.usedThisTurn) throw new Error(`${c.label}: leader.usedThisTurn NOT set post-confirm — Once Per Turn not consumed`);
  }
  console.log('  [info] post-confirm activeWindow on p1:', JSON.stringify(p1.lastState.activeWindow));

  p1.close(); p2.close();
}

(async () => {
  let server;
  let passed = false;
  try {
    server = await startServer();
    await runSuite('activate_main_confirm.e2e', [
      { name: 'ACTIVATE_MAIN opens confirm without mutating; CANCEL reverts; re-CONFIRM commits rest+used', fn: () => scenario(server.port) },
    ]).then(r => { passed = r.failed === 0; });
  } catch (e) {
    console.error('SUITE FAILURE:', e.stack || e.message);
    if (server) console.error('--- server stderr (tail) ---\n' + server.getStderr().slice(-2000));
  } finally {
    if (server) { try { server.proc.kill('SIGKILL'); } catch (_) {} }
    process.exit(passed ? 0 : 1);
  }
})();
