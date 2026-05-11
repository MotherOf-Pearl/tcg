// Window-lifecycle v2 scenario #1 — Attack misclick cancel.
//
// P1 declares an attack with their leader against P2's leader, then sends
// CANCEL_WINDOW before SELECT_TARGET. Asserts via both clients' GAME_STATE
// that:
//   - attacker (leader) is un-rested
//   - attackDeclarationWindow is null
//   - battleState is null
//   - phase is back to MAIN
//   - no [When Attacking] effects fired (Anna leader has none anyway, so we
//     simply check no extra log entries or windows opened)
//
// Then we repeat with the CANCEL_ATTACK alias to confirm the deprecated
// action still works.
const { startServer, lobby, advanceToMain, activeClient, inactiveClient, runSuite } = require('./harness');

async function endTurn(client) {
  client.action({ type: 'END_TURN' });
}

async function advancePastTurn1(clients) {
  // Turn 1 first player can't attack. End turn 1 (first player presses
  // END_TURN immediately after entering MAIN). The new active player can
  // attack on turn 2 with their leader (leaders are not playedThisTurn).
  const active = activeClient(clients);
  endTurn(active);
  await clients.p1.waitForState(g => g.turn >= 2, { label: 'turn 2 reached' });
  await clients.p2.waitForState(g => g.turn >= 2, { label: 'turn 2 reached' });
  // New active player must DRAW_DON before MAIN.
  const newActive = activeClient(clients);
  // The phase flow turn 2: DRAW (with refresh) → DON → MAIN. The active
  // player needs to draw a card too. Let me check what doRefresh+doDraw
  // does — doEnd flips active, sets phase='DRAW' (which doRefresh ran).
  // Actually nextPhase: DRAW → DON triggers doDraw. We're at DRAW. The
  // active player sends NEXT_PHASE? No — see doRefresh in mulligan: it's
  // called inline. Easier: NEXT_PHASE while at DRAW would advance to DON,
  // which triggers doDraw side-effect. Then NEXT_PHASE again from DON
  // triggers addDon. Let's drive via NEXT_PHASE / explicit actions.
  // Look at handleAction NEXT_PHASE: if MAIN -> doEnd, if DON -> addDon,
  // else nextPhase. Simplest: send DRAW_CARD then DRAW_DON.
  newActive.action({ type: 'DRAW_CARD' });
  newActive.action({ type: 'DRAW_DON' });
  await clients.p1.waitForState(g => g.phase === 'MAIN', { label: 'turn 2 MAIN' });
  await clients.p2.waitForState(g => g.phase === 'MAIN', { label: 'turn 2 MAIN' });
}

async function scenario(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  await advancePastTurn1(clients);
  const attacker = activeClient(clients);
  const defender = inactiveClient(clients);
  const attackerState = attacker.lastState.players[attacker.playerId];
  const defenderState = attacker.lastState.players[defender.playerId];
  const attackerLeaderUid = attackerState.leader.uid;
  const defenderLeaderUid = defenderState.leader.uid;

  if (attackerState.leader.rested) throw new Error('precondition: attacker leader should not be rested before declare');

  // === CANCEL_WINDOW path ===
  attacker.action({ type: 'DECLARE_ATTACK', attackerUid: attackerLeaderUid });
  await p1.waitForState(g => g.phase === 'ATTACKING' && !!g.battleState && !!g.attackDeclarationWindow, { label: 'attack declared' });
  await p2.waitForState(g => g.phase === 'ATTACKING' && !!g.battleState && !!g.attackDeclarationWindow, { label: 'attack declared (p2)' });

  // Verify both clients see the same state.
  for (const c of [p1, p2]) {
    if (c.lastState.phase !== 'ATTACKING') throw new Error(`${c.label}: phase != ATTACKING (${c.lastState.phase})`);
    if (!c.lastState.battleState) throw new Error(`${c.label}: battleState missing`);
    if (!c.lastState.attackDeclarationWindow) throw new Error(`${c.label}: attackDeclarationWindow missing`);
    if (c.lastState.activeWindow == null || c.lastState.activeWindow.field !== 'attackDeclarationWindow') {
      throw new Error(`${c.label}: activeWindow != attackDeclarationWindow (got ${JSON.stringify(c.lastState.activeWindow)})`);
    }
    const ld = c.lastState.players[attacker.playerId].leader;
    if (!ld.rested) throw new Error(`${c.label}: attacker leader should be rested during ATTACKING phase`);
  }

  // Cancel.
  attacker.action({ type: 'CANCEL_WINDOW' });
  await p1.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'attackDeclarationWindow', { label: 'WINDOW_CANCELLED' });
  await p2.waitFor(m => m.type === 'WINDOW_CANCELLED' && m.windowField === 'attackDeclarationWindow', { label: 'WINDOW_CANCELLED (p2)' });

  // After cancel both clients should see: phase MAIN, battleState null,
  // attackDeclarationWindow null, attacker un-rested, activeWindow null.
  // waitForNewState skips history — the pre-attack state had MAIN/null/null
  // too, so a history-scanning waitForState would match it spuriously.
  await p1.waitForNewState(g => g.phase === 'MAIN' && g.battleState == null && g.attackDeclarationWindow == null && !g.players[attacker.playerId].leader.rested, { label: 'post-cancel MAIN (p1)' });
  await p2.waitForNewState(g => g.phase === 'MAIN' && g.battleState == null && g.attackDeclarationWindow == null && !g.players[attacker.playerId].leader.rested, { label: 'post-cancel MAIN (p2)' });
  for (const c of [p1, p2]) {
    const ld = c.lastState.players[attacker.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: attacker leader still rested after cancel`);
    if (c.lastState.activeWindow != null) throw new Error(`${c.label}: activeWindow not cleared after cancel`);
  }

  // === CANCEL_ATTACK alias ===
  attacker.action({ type: 'DECLARE_ATTACK', attackerUid: attackerLeaderUid });
  await p1.waitForState(g => g.phase === 'ATTACKING' && !!g.attackDeclarationWindow, { label: 're-declare' });
  attacker.action({ type: 'CANCEL_ATTACK' });
  await p1.waitForNewState(g => g.phase === 'MAIN' && g.attackDeclarationWindow == null && !g.players[attacker.playerId].leader.rested, { label: 'CANCEL_ATTACK alias resolves (p1)' });
  await p2.waitForNewState(g => g.phase === 'MAIN' && g.attackDeclarationWindow == null && !g.players[attacker.playerId].leader.rested, { label: 'CANCEL_ATTACK alias resolves (p2)' });
  for (const c of [p1, p2]) {
    const ld = c.lastState.players[attacker.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: attacker still rested after CANCEL_ATTACK alias`);
  }

  p1.close(); p2.close();
}

(async () => {
  let server;
  let passed = false;
  try {
    server = await startServer();
    await runSuite('attack_cancel.e2e', [
      { name: 'P1 declares attack then CANCEL_WINDOW restores MAIN phase + un-rests attacker', fn: () => scenario(server.port) },
    ]).then(r => { passed = r.failed === 0; });
  } catch (e) {
    console.error('SUITE FAILURE:', e.stack || e.message);
    if (server) console.error('--- server stderr (tail) ---\n' + server.getStderr().slice(-2000));
  } finally {
    if (server) { try { server.proc.kill('SIGKILL'); } catch (_) {} }
    process.exit(passed ? 0 : 1);
  }
})();
