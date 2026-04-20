// DON draw-phase math + mulligan flow. Covers:
//   - P1 turn 1 DRAW_DON adds 1 DON  (OPTCG first-player rule)
//   - P2 turn 1 DRAW_DON adds 2 DON
//   - Any turn 2+ DRAW_DON adds 2 DON
//   - MULLIGAN true: hand → deck bottom, draw 5 new
//   - MULLIGAN false: hand kept
//   - Both players done → phase advances out of MULLIGAN (straight to DON per
//     current server rule: first player skips card-draw on turn 1)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('DRAW_DON: P1 turn 1 gets 1 DON', () => {
  const { roomId, p1, game } = twoPlayerGame();
  game.phase = 'DON';
  game.turn = 1;
  // Preconditions: fresh state, no DON yet.
  assert.equal(game.players[p1].donActive, 0);
  assert.equal(game.players[p1].donDeck, 10);
  srv.handleAction(roomId, p1, { type: 'DRAW_DON' });
  assert.equal(game.players[p1].donActive, 1);
  assert.equal(game.players[p1].donDeck, 9);
  assert.equal(game.phase, 'MAIN');
});

test('DRAW_DON: P2 turn 1 gets 2 DON (not the first player)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Flip to P2's turn-1 DRAW step (P1 ended, P2 now drawing DON).
  game.activePlayer = p2;
  game.turn = 1;
  game.phase = 'DON';
  srv.handleAction(roomId, p2, { type: 'DRAW_DON' });
  assert.equal(game.players[p2].donActive, 2);
  assert.equal(game.players[p2].donDeck, 8);
});

test('DRAW_DON: any turn ≥ 2 gets 2 DON regardless of first player', () => {
  const { roomId, p1, game } = twoPlayerGame();
  game.turn = 3;
  game.phase = 'DON';
  srv.handleAction(roomId, p1, { type: 'DRAW_DON' });
  assert.equal(game.players[p1].donActive, 2);
  assert.equal(game.players[p1].donDeck, 8);
});

test('DRAW_DON: rejected when not in DON phase', () => {
  const { roomId, p1, game } = twoPlayerGame();
  game.phase = 'MAIN';
  const before = game.players[p1].donActive;
  srv.handleAction(roomId, p1, { type: 'DRAW_DON' });
  assert.equal(game.players[p1].donActive, before);
});

test('MULLIGAN true: hand returns to deck bottom, 5 new drawn', () => {
  const { roomId, p1, game } = twoPlayerGame();
  assert.equal(game.phase, 'MULLIGAN');
  const originalHand = game.players[p1].hand.slice();
  const originalDeckSize = game.players[p1].deck.length;
  srv.handleAction(roomId, p1, { type: 'MULLIGAN', doMulligan: true });
  assert.equal(game.mulliganDone[p1], true);
  assert.equal(game.players[p1].hand.length, 5);
  assert.equal(game.players[p1].deck.length, originalDeckSize, 'deck size preserved — 5 returned, 5 drawn');
  // Old hand should now be at the deck's tail.
  const tail = game.players[p1].deck.slice(-originalHand.length);
  assert.deepEqual(tail.map(c => c.uid), originalHand.map(c => c.uid));
});

test('MULLIGAN false: hand kept, mulliganDone still flips true', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const before = game.players[p1].hand.slice();
  srv.handleAction(roomId, p1, { type: 'MULLIGAN', doMulligan: false });
  assert.equal(game.mulliganDone[p1], true);
  assert.deepEqual(game.players[p1].hand.map(c => c.uid), before.map(c => c.uid));
});

test('Both players complete MULLIGAN → phase advances to DON', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  srv.handleAction(roomId, p1, { type: 'MULLIGAN', doMulligan: false });
  srv.handleAction(roomId, p2, { type: 'MULLIGAN', doMulligan: false });
  assert.equal(game.phase, 'DON');
  // First player (p1 here, pinned in helpers) skips card draw on turn 1.
  // The hand should still be exactly 5 cards (no extra draw).
  assert.equal(game.players[p1].hand.length, 5);
});

test('MULLIGAN rejected for UUIDs not in the game', () => {
  const { roomId, game } = twoPlayerGame();
  const stray = 'not-in-game-uuid';
  srv.handleAction(roomId, stray, { type: 'MULLIGAN', doMulligan: true });
  // No phantom key should appear on mulliganDone.
  assert.equal(game.mulliganDone[stray], undefined);
});
