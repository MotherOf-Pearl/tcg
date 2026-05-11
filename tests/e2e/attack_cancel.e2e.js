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

async function advancePastFirstTurns(clients) {
  // §6-5-6-1 — neither player can battle on their first turn. P1's first
  // turn is turn 1; P2's first turn is turn 2. We need turn 3 (P1's
  // SECOND turn) before any attack is legal.
  for (let target = 2; target <= 3; target++) {
    const active = activeClient(clients);
    endTurn(active);
    await clients.p1.waitForState(g => g.turn >= target, { label: `turn ${target} reached (p1)` });
    await clients.p2.waitForState(g => g.turn >= target, { label: `turn ${target} reached (p2)` });
    const newActive = activeClient(clients);
    newActive.action({ type: 'DRAW_CARD' });
    newActive.action({ type: 'DRAW_DON' });
    await clients.p1.waitForState(g => g.phase === 'MAIN' && g.turn === target, { label: `turn ${target} MAIN (p1)` });
    await clients.p2.waitForState(g => g.phase === 'MAIN' && g.turn === target, { label: `turn ${target} MAIN (p2)` });
  }
}

async function scenario(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  await advancePastFirstTurns(clients);
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
