// Phase 8 Batch 4 — [On Your Opponent's Attack] timing wired into the
// DECLARE_ATTACK handler for defender-side pipelined cards. Migrates
// OP12-008 Shanks (trashFromHand cost → -2000 power debuff on opponent
// leader/character).
//
// Deferred: OP14-060 Doflamingo leader — attack redirect needs a
// dedicated window + target reassignment mid-attack; Phase 8+.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Shanks OP12-008 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP12-008');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP12-008');
  assert.deepEqual(p.unparsedSegments, []);
  assert.equal(p.effects[0].timing, 'onYourOpponentsAttack');
});

test('SELECT_TARGET fires defender [On Your Opponent\'s Attack] pipeline', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Defender (p2) has Shanks on field with 1 hand card for the cost.
  const shanks = { ...srv.CARD_DB.find(c => c.id === 'OP12-008'),
    uid: 'sh-def', rested: false, attachedDon: 0, power: 6000 };
  game.players[p2].field.push(shanks);
  game.players[p2].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-handcost' });
  // Attacker (p1) has an attacker.
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-1', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-1' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  // Shanks' effect opens trashFromHand cost window with defender playerId.
  assert.ok(game.trashFromHandWindow, 'defender cost window opened');
  assert.equal(game.trashFromHandWindow.playerId, p2);
});

test('Defender resolves onYourOpponentsAttack chain independent of attacker flow', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const shanks = { ...srv.CARD_DB.find(c => c.id === 'OP12-008'),
    uid: 'sh-def2', rested: false, attachedDon: 0, power: 6000 };
  game.players[p2].field.push(shanks);
  game.players[p2].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-handcost2' });
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-2', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-2' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  assert.ok(game.trashFromHandWindow);
  // Defender pays cost by trashing the hand card.
  srv.handleAction(roomId, p2, {
    type: 'TRASH_FROM_HAND_RESOLVE', cardUids: ['sh-handcost2'],
  });
  // powerBuffTargetWindow should open for defender to pick target.
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.playerId, p2);
  assert.equal(game.powerBuffTargetWindow.amount, -2000);
  assert.equal(game.powerBuffTargetWindow.side, 'opponent');
});

test('Defender with no eligible hand cards: no cost window opened', () => {
  // Shanks has filterType=null (no power filter), so any card ≥ the cost
  // count of 1 satisfies the cost. Absent hand cards = cost unaffordable.
  const { roomId, p1, p2, game } = twoPlayerGame();
  const shanks = { ...srv.CARD_DB.find(c => c.id === 'OP12-008'),
    uid: 'sh-nohand', rested: false, attachedDon: 0 };
  game.players[p2].field.push(shanks);
  game.players[p2].hand = [];  // empty
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'atk-3', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.phase = 'MAIN';
  game.turn = 2;
  game.activePlayer = p1;

  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'atk-3' });
  srv.handleAction(roomId, p1, {
    type: 'SELECT_TARGET', targetUid: game.players[p2].leader.uid,
  });
  assert.ok(!game.trashFromHandWindow,
    'no hand cards → openTrashFromHand returns false → no window');
});
