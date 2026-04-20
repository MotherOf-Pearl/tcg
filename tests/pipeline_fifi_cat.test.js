// Phase-4 Batch 3 — FiFi Cat [On Play] migrated.
//   [On Play] Look at 5 cards from the top of your deck and return them
//   to the top or bottom of the deck in any order.
//
// FiFi's parsed scry has placement:'either', no reveal clause. The
// sequencer opens a scryWindow directly (matching the shape the
// existing client UI reads) with pipelineResume stashed for any future
// card that chains after scry.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('FiFi Cat CARD_DB carries useNewPipeline:true', () => {
  const f = srv.CARD_DB.find(c => c.id === 'OP01-077');
  assert.equal(f.useNewPipeline, true);
});

test('onPlay opens scryWindow with 5 cards, placement=either, keepCount=0', () => {
  const { p1, game } = twoPlayerGame();
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'fifi-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(fifi);
  const deckLenBefore = game.players[p1].deck.length;

  srv.runPipeline('onPlay', game, p1, fifi);
  assert.ok(game.scryWindow, 'scryWindow opened by pipeline');
  assert.equal(game.scryWindow.playerId, p1);
  assert.equal(game.scryWindow.cards.length, 5);
  assert.equal(game.scryWindow.keepCount, 0);
  assert.equal(game.scryWindow.placement, 'either');
  assert.equal(game.players[p1].deck.length, deckLenBefore - 5,
    'deck shortened by 5 — top cards pulled into the scry stash');
});

test('scry window with short deck takes what is available without throwing', () => {
  const { p1, game } = twoPlayerGame();
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'fifi-short', rested: false, attachedDon: 0 };
  game.players[p1].field.push(fifi);
  // Shrink the deck to 2 — scry must clamp to what's available.
  game.players[p1].deck = game.players[p1].deck.slice(0, 2);
  srv.runPipeline('onPlay', game, p1, fifi);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.cards.length, 2, 'clamped to remaining deck size');
  assert.equal(game.players[p1].deck.length, 0);
});

test('SCRY_RESOLVE split-mode: top pile unshifted, bottom pile pushed, window cleared', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'fifi-r', rested: false, attachedDon: 0 };
  game.players[p1].field.push(fifi);
  srv.runPipeline('onPlay', game, p1, fifi);
  assert.ok(game.scryWindow);
  const scryed = game.scryWindow.cards.slice();  // snapshot: 5 cards pulled from deck top
  const remainingDeck = game.players[p1].deck.slice();  // everything still in deck

  // Keep nothing; cards[0, 1] → top (in that order); cards[2, 3, 4] → bottom (in that order).
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE',
    keptIndices: [],
    topOrder: [0, 1],
    bottomOrder: [2, 3, 4],
  });
  assert.equal(game.scryWindow, null);
  // Top of deck = topOrder[0], then topOrder[1], then everything that was there already.
  const deck = game.players[p1].deck;
  assert.equal(deck[0].uid, scryed[0].uid, 'first top card → very top of deck');
  assert.equal(deck[1].uid, scryed[1].uid);
  // Bottom of deck = everything that was remaining + bottom pile in order.
  assert.equal(deck[deck.length - 3].uid, scryed[2].uid);
  assert.equal(deck[deck.length - 2].uid, scryed[3].uid);
  assert.equal(deck[deck.length - 1].uid, scryed[4].uid);
  assert.equal(deck.length, remainingDeck.length + 5, 'all 5 cards returned to deck');
});
