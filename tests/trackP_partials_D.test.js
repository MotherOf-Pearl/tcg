// Track P partials batch D — Marshall D. Teach global [On Play]
// suppression. Two clauses:
//   Passive: "Your [On Play] abilities don't activate" — stored in
//     PASSIVE_EFFECTS, read by isOnPlaySuppressed(game, playerId).
//   Active:  "[Activate: Main] You may trash 1 card: Until the end of
//     your opponent's next turn, your opponent's [On Play] abilities
//     don't activate" — emits a suppressOnPlay effect that pushes a
//     timed entry onto game._onPlaySuppressions.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Teach OP09-081 flag + fully parsed + passive recorded', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP09-081');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP09-081');
  assert.deepEqual(p.unparsedSegments, []);
  // Active: activateMain with trashFromHand cost + suppressOnPlay effect.
  assert.equal(p.effects[0].timing, 'activateMain');
  assert.deepEqual(p.effects[0].effects, [
    { type: 'suppressOnPlay', side: 'opponent', duration: 'opponentNextTurn' },
  ]);
  // Passive: self-side [On Play] suppression.
  const passive = srv.PASSIVE_EFFECTS.get('OP09-081');
  assert.ok(passive.find(e => e.type === 'onPlaySuppression' && e.side === 'self'));
});

test('isOnPlaySuppressed returns true for Teach owner via passive', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Set Teach as p1's leader.
  game.players[p1].leader = { ...srv.CARD_DB.find(c => c.id === 'OP09-081'),
    uid: 'teach-l1' };
  assert.equal(srv.isOnPlaySuppressed(game, p1), true,
    'Teach owner has own onPlay suppressed');
  assert.equal(srv.isOnPlaySuppressed(game, p2), false,
    'opponent onPlay NOT suppressed by passive alone');
});

test('Teach activateMain: hand-trash cost window opens, then suppress opponent', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader = { ...srv.CARD_DB.find(c => c.id === 'OP09-081'),
    uid: 'teach-l2', rested: true };
  game.players[p1].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'teach-handcost' });

  srv.runPipeline('activateMain', game, p1, game.players[p1].leader);
  assert.ok(game.trashFromHandWindow);
  srv.handleAction(roomId, p1, {
    type: 'TRASH_FROM_HAND_RESOLVE', cardUids: ['teach-handcost'],
  });
  // Suppression entry pushed for p2.
  assert.ok(Array.isArray(game._onPlaySuppressions));
  assert.equal(game._onPlaySuppressions.length, 1);
  assert.equal(game._onPlaySuppressions[0].targetPlayerId, p2);
  // And isOnPlaySuppressed reflects it.
  assert.equal(srv.isOnPlaySuppressed(game, p2), true);
});

test('Expired _onPlaySuppressions pruned at doEnd', () => {
  const { p1, p2, game } = twoPlayerGame();
  game._onPlaySuppressions = [{ targetPlayerId: p2, expiresAtTurn: game.turn }];
  game.activePlayer = p1;
  game.turn += 1;
  srv.doEnd(game);
  // After doEnd the turn has advanced one more; entries with expiresAtTurn
  // < current turn are dropped.
  assert.equal(srv.isOnPlaySuppressed(game, p2), false);
});
