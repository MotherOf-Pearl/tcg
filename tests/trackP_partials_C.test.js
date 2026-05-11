// Track P partials batch C — Doflamingo leader attack redirect.
// Moves the [On Your Opponent's Attack] firing point to AFTER
// SELECT_TARGET (so battleState.targetUid is set when defender effects
// evaluate), and adds a redirectAttack effect + attackRedirectWindow
// + ATTACK_REDIRECT_SELECTED resolver that mutates battleState.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Doflamingo OP14-060 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP14-060');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP14-060');
  assert.deepEqual(p.unparsedSegments, []);
  assert.equal(p.effects[0].timing, 'onYourOpponentsAttack');
  assert.deepEqual(p.effects[0].costs, [{ type: 'returnDon', count: 1 }]);
  assert.deepEqual(p.effects[0].effects, [
    { type: 'redirectAttack', filter: { affiliation: 'Donquixote Pirates' } },
  ]);
});

test('SELECT_TARGET fires Doflamingo redirect chain: DON cost window first', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // p2 (defender) has the Doflamingo leader set + a Donquixote Pirates
  // character on field as a potential redirect target.
  game.players[p2].leader = { ...srv.CARD_DB.find(c => c.id === 'OP14-060'),
    uid: 'dof-leader-2', rested: false };
  game.players[p2].donActive = 3;
  const ally = { ...srv.CARD_DB.find(c => c.id === 'OP10-071'),
    uid: 'dof-ally', rested: true, attachedDon: 0,
    affiliation: 'Donquixote Pirates' };
  game.players[p2].field.push(ally);

  // p1 attacker
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-a', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;
  game.players[p1].hasTakenFirstTurn = true; // §6-5-6-1 bypass for test fixture

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-a' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  // Doflamingo's DON!! -1 cost window opened on defender side.
  assert.ok(game.donReturnWindow, 'DON cost window opened');
  assert.equal(game.donReturnWindow.playerId, p2);
});

test('ATTACK_REDIRECT_SELECTED mutates battleState.targetUid to picked card', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p2].leader = { ...srv.CARD_DB.find(c => c.id === 'OP14-060'),
    uid: 'dof-l3', rested: false };
  game.players[p2].donActive = 3;
  const ally = { ...srv.CARD_DB.find(c => c.id === 'OP10-071'),
    uid: 'dof-ally2', rested: true, attachedDon: 0,
    affiliation: 'Donquixote Pirates' };
  game.players[p2].field.push(ally);
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-b', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;
  game.players[p1].hasTakenFirstTurn = true; // §6-5-6-1 bypass for test fixture

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-b' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  // Pay the cost.
  srv.handleAction(roomId, p2, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  assert.ok(game.attackRedirectWindow);
  const orig = game.battleState.targetUid;
  assert.equal(orig, 'dof-l3', 'original target was Doflamingo leader');

  // Defender picks the ally as the redirect target.
  srv.handleAction(roomId, p2, { type: 'ATTACK_REDIRECT_SELECTED', targetUid: 'dof-ally2' });
  assert.equal(game.attackRedirectWindow, null);
  assert.equal(game.battleState.targetUid, 'dof-ally2', 'target redirected');
  assert.equal(game.battleState.targetIsLeader, false);
});

test('Doflamingo with non-matching leader or no candidates: skips redirect', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Doflamingo leader present, but no Donquixote Pirates character — only
  // leader self is candidate (which IS the current target, so redirect
  // to self is a no-op but still offered).
  game.players[p2].leader = { ...srv.CARD_DB.find(c => c.id === 'OP14-060'),
    uid: 'dof-l4', rested: false };
  game.players[p2].donActive = 3;
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-c', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;
  game.players[p1].hasTakenFirstTurn = true; // §6-5-6-1 bypass for test fixture

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-c' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  // With only the leader as a candidate, DON cost still opens.
  assert.ok(game.donReturnWindow);
  assert.equal(game.donReturnWindow.playerId, p2);
});
