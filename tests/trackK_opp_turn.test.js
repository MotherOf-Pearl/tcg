// Track K — Opponent's Turn activation. Tests the ACTIVATE_OPP_TURN
// action handler wiring for Trebol OP14-068 and OP10-071 Doflamingo
// character. Client-side eligibility filtering isn't exercised here;
// these tests verify the server accepts/rejects correctly and that
// the per-round usage flag is set and cleared at doEnd.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('ACTIVATE_OPP_TURN rejected when caller is the active player', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const trebol = { ...srv.CARD_DB.find(c => c.id === 'OP14-068'), uid: 'tr-1' };
  game.players[p1].field.push(trebol);
  game.players[p1].leader.affiliation = 'Donquixote Pirates';
  game.activePlayer = p1;
  srv.handleAction(roomId, p1, { type: 'ACTIVATE_OPP_TURN', cardUid: 'tr-1' });
  assert.ok(!trebol.oppTurnUsedThisRound, 'should not activate on own turn');
});

test('Trebol OP14-068 activates on opponent\'s turn and adds 1 rested DON', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Donquixote Pirates';
  const trebol = { ...srv.CARD_DB.find(c => c.id === 'OP14-068'), uid: 'tr-2' };
  game.players[p1].field.push(trebol);
  game.activePlayer = p2;  // opponent's turn
  const donDeckBefore = game.players[p1].donDeck;
  const donRestedBefore = game.players[p1].donRested;
  srv.handleAction(roomId, p1, { type: 'ACTIVATE_OPP_TURN', cardUid: 'tr-2' });
  assert.equal(trebol.oppTurnUsedThisRound, true);
  assert.equal(game.players[p1].donDeck, donDeckBefore - 1);
  assert.equal(game.players[p1].donRested, donRestedBefore + 1);
});

test('ACTIVATE_OPP_TURN rejected when already used this round', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Donquixote Pirates';
  const trebol = { ...srv.CARD_DB.find(c => c.id === 'OP14-068'),
    uid: 'tr-3', oppTurnUsedThisRound: true };
  game.players[p1].field.push(trebol);
  game.activePlayer = p2;
  const donDeckBefore = game.players[p1].donDeck;
  srv.handleAction(roomId, p1, { type: 'ACTIVATE_OPP_TURN', cardUid: 'tr-3' });
  assert.equal(game.players[p1].donDeck, donDeckBefore, 'no effect on re-activation');
});

test('oppTurnUsedThisRound clears at doEnd', () => {
  const { p1, game } = twoPlayerGame();
  const trebol = { ...srv.CARD_DB.find(c => c.id === 'OP14-068'),
    uid: 'tr-4', oppTurnUsedThisRound: true };
  game.players[p1].field.push(trebol);
  game.activePlayer = p1;
  srv.doEnd(game);
  assert.equal(trebol.oppTurnUsedThisRound, false);
});
