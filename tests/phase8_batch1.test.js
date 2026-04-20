// Phase 8 Batch 1 — [End of Your Turn] timing wired into doEnd;
// setOwnDonActive (un-rest N rested DON!!) and setCharacterActive
// (un-rest N own Characters matching filter) effects. Migrates
// OP10-072 Rosinante and OP11-067 Katakuri.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits setOwnDonActive for "set up to N of them as active"', () => {
  const out = srv.parseAbility(
    '[End of Your Turn] If you have 7 or more DON!! cards, set up to 2 of them as active.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [{ type: 'setOwnDonActive', count: 2 }]);
});

test('parser emits setCharacterActive with {affiliation} and minCost filter', () => {
  const out = srv.parseAbility(
    '[End of Your Turn] Set up to 2 of your {Big Mom Pirates} type Characters with a cost of 3 or more as active.'
  );
  assert.deepEqual(out.effects[0].effects, [
    { type: 'setCharacterActive', max: 2,
      filter: { affiliation: 'Big Mom Pirates', minCost: 3 } },
  ]);
});

// ─── Cards ──────────────────────────────────────────────────────────────

test('Rosinante OP10-072 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP10-072');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP10-072');
  assert.deepEqual(p.unparsedSegments, []);
});

test('Katakuri OP11-067 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP11-067');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP11-067');
  assert.deepEqual(p.unparsedSegments, []);
});

// ─── doEnd fires endOfTurn abilities on ending player's cards ──────────

test('doEnd fires endOfTurn pipeline on the ending player, not opponent', () => {
  const { p1, p2, game } = twoPlayerGame();
  // p1 has Rosinante on field with enough DON to trigger the condition.
  const rosi = { ...srv.CARD_DB.find(c => c.id === 'OP10-072'),
    uid: 'rosi-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(rosi);
  game.players[p1].donActive = 3;
  game.players[p1].donRested = 4;  // total=7 meets donCountMin≥7
  // End p1's turn — Rosinante should un-rest up to 2 rested DON.
  game.activePlayer = p1;
  game.turn = 2;
  srv.doEnd(game);
  assert.equal(game.players[p1].donActive, 5, '2 rested DON un-rested → active');
  assert.equal(game.players[p1].donRested, 2);
});

test('Rosinante endOfTurn skipped when DON total < 7', () => {
  const { p1, game } = twoPlayerGame();
  const rosi = { ...srv.CARD_DB.find(c => c.id === 'OP10-072'),
    uid: 'rosi-2', rested: false, attachedDon: 0 };
  game.players[p1].field.push(rosi);
  game.players[p1].donActive = 2;
  game.players[p1].donRested = 2;
  game.players[p1].donDeck = 0;  // total=4 < 7
  game.activePlayer = p1;
  game.turn = 2;
  srv.doEnd(game);
  assert.equal(game.players[p1].donActive, 2, 'no un-rest');
  assert.equal(game.players[p1].donRested, 2);
});

test('Katakuri endOfTurn un-rests up to 2 Big Mom Pirates ≥3 cost + adds 1 rested DON', () => {
  const { p1, game } = twoPlayerGame();
  const kata = { ...srv.CARD_DB.find(c => c.id === 'OP11-067'),
    uid: 'kata-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(kata);
  // Eligible Big Mom Pirates cost-4 character, rested.
  const bm1 = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bm-1', affiliation: 'Big Mom Pirates', cost: 4, rested: true };
  // Ineligible: cost-2 (below minCost).
  const bm2 = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bm-2', affiliation: 'Big Mom Pirates', cost: 2, rested: true };
  // Ineligible: wrong affiliation.
  const bm3 = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bm-3', affiliation: 'Duchess of Brittany', cost: 5, rested: true };
  game.players[p1].field.push(bm1, bm2, bm3);

  const donDeckBefore = game.players[p1].donDeck;
  const donRestedBefore = game.players[p1].donRested;

  game.activePlayer = p1;
  game.turn = 2;
  srv.doEnd(game);

  assert.equal(bm1.rested, false, 'eligible char un-rested');
  assert.equal(bm2.rested, true, 'cost<3 stays rested');
  assert.equal(bm3.rested, true, 'wrong affiliation stays rested');
  assert.equal(game.players[p1].donDeck, donDeckBefore - 1, 'addDon from deck');
  assert.equal(game.players[p1].donRested, donRestedBefore + 1, 'added rested');
});
