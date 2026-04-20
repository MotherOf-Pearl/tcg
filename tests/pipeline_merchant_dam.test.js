// Phase-4 Batch 1 — Merchant Dam onKO migrated to the new pipeline.
// Non-interactive: [On K.O.] → addDon rested. No condition, no cost.
// The flow verifier exercises triggerOnKO so the routing layer is tested
// too (pipeline takes over when useNewPipeline is true).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Merchant Dam CARD_DB carries useNewPipeline:true', () => {
  const dam = srv.CARD_DB.find(c => c.id === 'OP01-100');
  assert.equal(dam.useNewPipeline, true);
});

test('triggerOnKO routes Merchant Dam through runPipeline → donDeck -1, donRested +1', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Put Merchant Dam in p2's trash (where KO'd cards live). triggerOnKO
  // doesn't care where the card sits — it only reads ability and owner.
  const dam = { ...srv.CARD_DB.find(c => c.id === 'OP01-100'), uid: 'dam-1' };
  game.players[p2].trash.push(dam);
  const donDeckBefore   = game.players[p2].donDeck;
  const donRestedBefore = game.players[p2].donRested;
  const donActiveBefore = game.players[p2].donActive;
  srv.triggerOnKO(game, p2, dam, p1);
  assert.equal(game.players[p2].donDeck, donDeckBefore - 1, 'donDeck decremented');
  assert.equal(game.players[p2].donRested, donRestedBefore + 1, 'donRested incremented');
  assert.equal(game.players[p2].donActive, donActiveBefore, 'donActive untouched (rested, not active)');
});

test('Merchant Dam onKO no-op when donDeck is empty', () => {
  const { p1, p2, game } = twoPlayerGame();
  const dam = { ...srv.CARD_DB.find(c => c.id === 'OP01-100'), uid: 'dam-empty' };
  game.players[p2].trash.push(dam);
  game.players[p2].donDeck = 0;  // nothing to add
  const restedBefore = game.players[p2].donRested;
  srv.triggerOnKO(game, p2, dam, p1);
  assert.equal(game.players[p2].donDeck, 0);
  assert.equal(game.players[p2].donRested, restedBefore, 'addDonFromDeck short-circuits on empty deck');
});
