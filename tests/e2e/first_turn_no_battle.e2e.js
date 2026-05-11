// §6-5-6-1 first-turn-no-battle prohibition — e2e coverage.
//
// Two scenarios in one suite (shared lobby/harness pattern):
//
// (1) P2-attack-on-turn-2 rejection. Advance turn 1 → turn 2 (P1 plays
//     MAIN then END_TURN; P2 receives turn-2 MAIN). P2 sends DECLARE_ATTACK
//     with their leader. Server must reject:
//       - ERROR message carries '6-5-6-1'
//       - game.phase stays MAIN (not 'ATTACKING')
//       - attackDeclarationWindow stays null
//       - game.battleState stays null
//       - P2's leader stays un-rested
//       - It's still P2's turn (turn did not flip)
//
// (2) Turn-3-attack-proceeds. Advance past both first turns: turn 1 P1
//     END_TURN → turn 2 P2 END_TURN → turn 3 P1 MAIN. P1 sends
//     DECLARE_ATTACK. Server must accept:
//       - game.phase becomes 'ATTACKING'
//       - attackDeclarationWindow opens
//       - game.battleState is populated
//       - P1's leader is rested
//
// Regression guard for the prod bug fixed in commit 207e5a9 (server fix)
// and bea58ce (unit tests). Architect design at
// docs/designs/first-turn-no-battle.md.
const { startServer, lobby, advanceToMain, activeClient, inactiveClient, runSuite } = require('./harness');

// Drive the active player through DRAW → DON → MAIN at the start of a new
// turn. The lobby + advanceToMain helper handles turn 1; this helper is
// for turn 2+, where the just-flipped active player must explicitly
// DRAW_CARD then DRAW_DON.
async function pumpToMain(clients, targetTurn) {
  const { p1, p2 } = clients;
  const next = activeClient(clients);
  next.action({ type: 'DRAW_CARD' });
  next.action({ type: 'DRAW_DON' });
  await p1.waitForState(g => g.phase === 'MAIN' && g.turn === targetTurn, { label: `turn ${targetTurn} MAIN (p1)` });
  await p2.waitForState(g => g.phase === 'MAIN' && g.turn === targetTurn, { label: `turn ${targetTurn} MAIN (p2)` });
}

// Flip from the current MAIN turn to the next, leaving the new active
// player at MAIN of game-turn `targetTurn`.
async function endThenMain(clients, targetTurn) {
  const { p1, p2 } = clients;
  const cur = activeClient(clients);
  cur.action({ type: 'END_TURN' });
  await p1.waitForState(g => g.turn >= targetTurn, { label: `turn ${targetTurn} reached (p1)` });
  await p2.waitForState(g => g.turn >= targetTurn, { label: `turn ${targetTurn} reached (p2)` });
  await pumpToMain(clients, targetTurn);
}

// (1) The second player tries to attack on turn 2 (their first turn). Must
// be rejected with §6-5-6-1; no state mutation. Note: server.js does a coin
// flip for firstPlayer, so "P2" in the scenario label is the *second*
// player (whoever is active on turn 2), not necessarily the harness p2.
async function scenarioP2RejectedOnTurn2(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  // Turn 1 is the first player's first turn — end it; the second player
  // lands at turn 2 MAIN, which is the second player's own first turn.
  await endThenMain(clients, 2);

  const attacker = activeClient(clients);
  const defender = inactiveClient(clients);
  if (attacker.lastState.turn !== 2) throw new Error(`precondition: turn != 2 (got ${attacker.lastState.turn})`);
  if (attacker.lastState.phase !== 'MAIN') throw new Error(`precondition: phase != MAIN (got ${attacker.lastState.phase})`);
  if (attacker.playerId === attacker.lastState.firstPlayer) {
    throw new Error('precondition: active player on turn 2 should be the SECOND player (firstPlayer mismatch)');
  }

  const attackerState = attacker.lastState.players[attacker.playerId];
  const attackerLeaderUid = attackerState.leader.uid;
  if (attackerState.leader.rested) throw new Error('precondition: second-player leader should not be rested at start of own MAIN');

  // Snapshot the state we expect to be invariant.
  const turnBefore = attacker.lastState.turn;
  const activeBefore = attacker.lastState.activePlayer;

  // Drain stale inbox so our ERROR-wait sees only post-action messages.
  const errIdxBefore = attacker.inbox.length;

  attacker.action({ type: 'DECLARE_ATTACK', attackerUid: attackerLeaderUid });

  // Server should respond with ERROR containing the rule citation. The
  // server.js source emits 'Cannot attack on your first turn (§6-5-6-1).'
  // We predicate-match on /6-5-6-1/ per the agent brief.
  const err = await attacker.waitFor(
    (m, _c) => m.type === 'ERROR' && typeof m.msg === 'string' && /6-5-6-1/.test(m.msg),
    { label: 'ERROR with 6-5-6-1 rule cite', timeoutMs: 3000 }
  );
  if (!err) throw new Error('No ERROR received for first-turn attack');

  // Let any (errant) follow-up broadcasts land before asserting invariance.
  await attacker.flush(80);
  await defender.flush(80);

  // Assert state invariants on BOTH clients — server should not have
  // mutated phase/window/battleState/leader.rested/activePlayer/turn.
  for (const c of [p1, p2]) {
    const g = c.lastState;
    if (!g) throw new Error(`${c.label}: no lastState`);
    if (g.phase !== 'MAIN') throw new Error(`${c.label}: phase mutated to ${g.phase} (expected MAIN)`);
    if (g.phase === 'ATTACKING') throw new Error(`${c.label}: phase became ATTACKING — rejection failed to short-circuit`);
    if (g.attackDeclarationWindow != null) throw new Error(`${c.label}: attackDeclarationWindow opened (expected null)`);
    if (g.battleState != null) throw new Error(`${c.label}: battleState populated (expected null)`);
    if (g.turn !== turnBefore) throw new Error(`${c.label}: turn flipped ${turnBefore} → ${g.turn}`);
    if (g.activePlayer !== activeBefore) throw new Error(`${c.label}: activePlayer flipped (still expecting ${activeBefore.slice(0,6)}, got ${(g.activePlayer || '').slice(0,6)})`);
    const ld = g.players[attacker.playerId].leader;
    if (ld.rested) throw new Error(`${c.label}: second-player leader is rested — server set rested=true before rejection`);
  }

  p1.close(); p2.close();
}

// (2) Past both first turns, the first player attacks on turn 3 (their
// second turn) — must proceed normally.
async function scenarioTurn3AttackProceeds(serverPort) {
  const clients = await lobby(serverPort);
  const { p1, p2 } = clients;
  await advanceToMain(clients);
  // Turn 1: first player's first turn → end. Turn 2: second player's first
  // turn → end. Turn 3: first player's second turn, where attacks are legal.
  await endThenMain(clients, 2);
  await endThenMain(clients, 3);

  const attacker = activeClient(clients);
  if (attacker.lastState.turn !== 3) throw new Error(`precondition: turn != 3 (got ${attacker.lastState.turn})`);
  if (attacker.lastState.phase !== 'MAIN') throw new Error(`precondition: phase != MAIN (got ${attacker.lastState.phase})`);
  if (attacker.playerId !== attacker.lastState.firstPlayer) {
    throw new Error('precondition: active player on turn 3 should be the FIRST player (firstPlayer mismatch)');
  }

  const attackerState = attacker.lastState.players[attacker.playerId];
  const attackerLeaderUid = attackerState.leader.uid;
  if (attackerState.leader.rested) throw new Error('precondition: first-player leader should not be rested at start of own MAIN on turn 3');

  attacker.action({ type: 'DECLARE_ATTACK', attackerUid: attackerLeaderUid });

  await p1.waitForState(
    g => g.phase === 'ATTACKING' && !!g.battleState && !!g.attackDeclarationWindow,
    { label: 'turn-3 attack proceeds (p1)' }
  );
  await p2.waitForState(
    g => g.phase === 'ATTACKING' && !!g.battleState && !!g.attackDeclarationWindow,
    { label: 'turn-3 attack proceeds (p2)' }
  );

  for (const c of [p1, p2]) {
    const g = c.lastState;
    if (g.phase !== 'ATTACKING') throw new Error(`${c.label}: phase != ATTACKING (got ${g.phase})`);
    if (!g.battleState) throw new Error(`${c.label}: battleState not populated`);
    if (!g.attackDeclarationWindow) throw new Error(`${c.label}: attackDeclarationWindow not opened`);
    const ld = g.players[attacker.playerId].leader;
    if (!ld.rested) throw new Error(`${c.label}: first-player leader not rested after legal attack`);
  }

  p1.close(); p2.close();
}

(async () => {
  let server;
  let passed = false;
  try {
    server = await startServer();
    const r = await runSuite('first_turn_no_battle.e2e', [
      { name: '(1) P2 DECLARE_ATTACK on turn 2 (P2 first turn) — server rejects with §6-5-6-1; no state mutation', fn: () => scenarioP2RejectedOnTurn2(server.port) },
      { name: '(2) P1 DECLARE_ATTACK on turn 3 (past both first turns) — proceeds; battleState + attackDeclarationWindow populated', fn: () => scenarioTurn3AttackProceeds(server.port) },
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
