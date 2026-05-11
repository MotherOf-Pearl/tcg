// window-lifecycle v2 — optional picker on END_TURN auto-cancels with
// no resolution. Rules §4-8 / §8-4-4-1: "up to N" permits choosing 0.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('END_TURN with an open optional addFromTrashWindow auto-cancels — no pick', () => {
  const { roomId, p1, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  // Seed a trash card so the window has a candidate to *not* pick.
  const trashCard = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'trash-1' };
  game.players[p1].trash.push(trashCard);
  game.addFromTrashWindow = {
    playerId: p1, max: 2, optional: true,
    sourceCardName: 'test', filterType: null,
    candidateUids: ['trash-1'], pipelineResume: null,
    pickRequirement: 'optional',
  };
  game.activeWindow = { field: 'addFromTrashWindow', playerId: p1,
    sourceCardUid: null, openedAtTurn: game.turn, descriptor: null };
  const handBefore = game.players[p1].hand.length;
  const trashBefore = game.players[p1].trash.length;

  srv.handleAction(roomId, p1, { type: 'END_TURN' });
  assert.equal(game.addFromTrashWindow, null, 'window auto-cancelled');
  assert.equal(game.players[p1].hand.length, handBefore, 'no card moved to hand');
  assert.equal(game.players[p1].trash.length, trashBefore, 'trash untouched');
});
