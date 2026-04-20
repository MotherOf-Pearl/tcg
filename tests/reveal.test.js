// Reveal broadcast test — when SCRY_RESOLVE keeps a card, a REVEAL_CARD
// message is broadcast to both players in the room (BUG 1 from the
// previous multiplayer batch).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

test('SCRY_RESOLVE broadcasts REVEAL_CARD for each kept card', () => {
  const { roomId, p1, p2, p1ws, p2ws, game } = twoPlayerGame();
  // Build a scryWindow as if tryOpenScryFromEffect had fired. 3 cards on
  // offer, keep 1 (the first), rest placed on bottom.
  const c1 = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'scry-c1' }; // FiFi Cat
  const c2 = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'scry-c2' }; // George the Brave
  const c3 = { ...srv.CARD_DB.find(c => c.id === 'ST03-003'), uid: 'scry-c3' }; // Noble Shlawger
  game.scryWindow = {
    playerId: p1,
    cards: [c1, c2, c3],
    keepCount: 1,
    keepFilter: null,
    keepCardType: null,
    keepExcludeName: null,
    cardName: 'Test Scry Source',
    placement: 'bottom',
  };
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE',
    keptIndices: [0],
    order: [0, 1],  // remaining indices [c2, c3] in that order
    placement: 'bottom',
  });
  assert.equal(game.scryWindow, null, 'scryWindow cleared');
  // Kept card landed in hand.
  assert.ok(game.players[p1].hand.some(c => c.uid === 'scry-c1'), 'kept card in hand');
  // Remaining cards pushed to deck tail in order.
  const deck = game.players[p1].deck;
  assert.equal(deck[deck.length - 2].uid, 'scry-c2');
  assert.equal(deck[deck.length - 1].uid, 'scry-c3');
  // REVEAL_CARD broadcast: both players should have received one.
  const p1Reveals = messagesOfType(p1ws, 'REVEAL_CARD');
  const p2Reveals = messagesOfType(p2ws, 'REVEAL_CARD');
  assert.equal(p1Reveals.length, 1, 'actor received their own reveal');
  assert.equal(p2Reveals.length, 1, 'opponent received the reveal broadcast');
  assert.equal(p1Reveals[0].revealedBy, p1);
  assert.equal(p1Reveals[0].card.name, c1.name);
  assert.equal(p1Reveals[0].source, 'Test Scry Source');
});

test('SCRY_RESOLVE with no kept cards — no REVEAL_CARD broadcast', () => {
  const { roomId, p1, p1ws, p2ws, game } = twoPlayerGame();
  const c1 = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'sc-a' };
  const c2 = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'sc-b' };
  game.scryWindow = {
    playerId: p1, cards: [c1, c2], keepCount: 0,
    keepFilter: null, keepCardType: null, keepExcludeName: null,
    cardName: 'No-keep Scry', placement: 'bottom',
  };
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [], order: [0, 1], placement: 'bottom',
  });
  assert.equal(messagesOfType(p1ws, 'REVEAL_CARD').length, 0);
  assert.equal(messagesOfType(p2ws, 'REVEAL_CARD').length, 0);
});
