// Phase 5 Priority 6 — life add. "Add [up to] N cards from the top of
// your deck to the top of your Life cards." Baby 5 (OP14-072) is the
// first (and so far only) card using this pattern.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('parser emits addLife for the phrase', () => {
  const out = srv.parseAbility(
    '[On K.O.] DON!! -1: Add up to 1 card from the top of your deck to the top of your Life cards.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  const onKO = out.effects.find(e => e.timing === 'onKO');
  assert.deepEqual(onKO.costs, [{ type: 'returnDon', count: 1 }]);
  assert.deepEqual(onKO.effects, [{ type: 'addLife', count: 1 }]);
});

test('Baby 5 (OP14-072) flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP14-072');
  assert.equal(c.useNewPipeline, true);
  const parsed = srv.PARSED_EFFECTS.get('OP14-072');
  assert.deepEqual(parsed.unparsedSegments, []);
});

test('Baby 5 onKO: payment of 1 DON adds top deck card to life', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const baby = { ...srv.CARD_DB.find(c => c.id === 'OP14-072'), uid: 'baby-koed' };
  game.players[p1].trash.push(baby);
  // Ensure the player has enough DON to pay.
  game.players[p1].donActive = 2;
  const lifeBefore = game.players[p1].life.length;
  const deckBefore = game.players[p1].deck.length;
  const expectedTopCard = game.players[p1].deck[0];

  srv.triggerOnKO(game, p1, baby, p2);
  assert.ok(game.donReturnWindow, 'DON cost window opened');
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });

  assert.equal(game.donReturnWindow, null);
  assert.equal(game.players[p1].life.length, lifeBefore + 1);
  assert.equal(game.players[p1].deck.length, deckBefore - 1);
  // Top of life (last in the array — push() adds to the end, RESOLVE_ATTACK pops()).
  const topOfLife = game.players[p1].life[game.players[p1].life.length - 1];
  assert.equal(topOfLife.uid, expectedTopCard.uid);
});

test('Baby 5 onKO with empty deck: effect short-circuits safely', () => {
  const { p1, p2, game } = twoPlayerGame();
  const baby = { ...srv.CARD_DB.find(c => c.id === 'OP14-072'), uid: 'baby-empty' };
  game.players[p1].trash.push(baby);
  game.players[p1].donActive = 2;
  game.players[p1].deck = [];
  const lifeBefore = game.players[p1].life.length;
  srv.triggerOnKO(game, p1, baby, p2);
  // DON cost opens even with empty deck (cost is independent); we
  // close it and confirm no life added.
  if (game.donReturnWindow) {
    srv.handleAction('TESTROOM', p1, {
      type: 'RETURN_DON',
      selections: { fromActive: 1, fromRested: 0, fromCards: [] },
    });
  }
  assert.equal(game.players[p1].life.length, lifeBefore);
});
