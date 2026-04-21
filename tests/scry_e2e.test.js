// End-to-end scry flow coverage. Exercises each of the three shapes
// a migrated card uses:
//   * placement='either'     (FiFi Cat, OP01-077)
//   * placement='bottom' + reveal-affiliation (Schola Montis Belli)
//   * placement='bottom' + reveal-type        (Queen Victoria)
// Verifies server state transitions and pipelineResume chain.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── FiFi Cat: placement='either' split ────────────────────────────────

test('FiFi Cat onPlay opens scry{count:5, placement:either}', () => {
  const { p1, game } = twoPlayerGame();
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fifi-e2e' };
  game.players[p1].field.push(fifi);
  srv.runPipeline('onPlay', game, p1, fifi);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.cards.length, 5);
  assert.equal(game.scryWindow.placement, 'either');
  assert.equal(game.scryWindow.keepCount, 0);
  assert.equal(game.scryWindow.playerId, p1);
});

test('SCRY_RESOLVE split: topOrder unshifts, bottomOrder pushes', () => {
  const { roomId, p1, game } = twoPlayerGame();
  // Pre-stage a known scry window so we know exactly what to expect.
  const makeCard = (uid, name) => ({
    id: 'OP01-077', name, uid, type: 'CHARACTER', power: 1000, cost: 2,
  });
  const c1 = makeCard('sc1', 'C1');
  const c2 = makeCard('sc2', 'C2');
  const c3 = makeCard('sc3', 'C3');
  game.scryWindow = {
    playerId: p1,
    cards: [c1, c2, c3],
    keepCount: 0,
    keepFilter: null, keepCardType: null, keepExcludeName: null,
    cardName: 'Test',
    placement: 'either',
    pipelineResume: null,
  };
  const deckBefore = game.players[p1].deck.slice();
  // Top pile: [c3, c1] (in that order) → deck[0]=c3, deck[1]=c1.
  // Bottom pile: [c2] → deck.tail = c2.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE',
    keptIndices: [],
    topOrder: [2, 0],
    bottomOrder: [1],
  });
  assert.equal(game.scryWindow, null);
  const deck = game.players[p1].deck;
  assert.equal(deck[0].uid, 'sc3', 'first topOrder lands at top');
  assert.equal(deck[1].uid, 'sc1', 'second topOrder right below');
  assert.equal(deck[deck.length - 1].uid, 'sc2', 'bottomOrder at tail');
  // Original deck is preserved in between.
  assert.equal(deck.length, deckBefore.length + 3);
});

// ─── Schola Montis Belli: reveal + excludeName ─────────────────────────

test('Schola scry: only affiliation-matching non-excluded cards can be kept', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const match = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'sc-match' };  // George the Brave, DoB
  const bad = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'sc-bad' };       // Shawn, DoB (wait)
  const schola = { ...srv.CARD_DB.find(c => c.id === 'OP01-090'), uid: 'sc-schola' };
  // Give Shawn a non-Duchess affiliation so only George qualifies.
  bad.affiliation = 'Holy Roman Empire';
  game.scryWindow = {
    playerId: p1,
    cards: [match, bad, schola],
    keepCount: 1,
    keepFilter: 'Duchess of Brittany',
    keepCardType: null,
    keepExcludeName: 'Schola Montis Belli',
    cardName: 'Schola Montis Belli',
    placement: 'bottom',
    pipelineResume: null,
  };
  // Attempt to keep Schola itself — server should reject.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [2], order: [0, 1], placement: 'bottom',
  });
  assert.ok(game.scryWindow, 'rejected; window still open');

  // Attempt to keep bad (wrong affiliation) — reject.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [1], order: [0, 2], placement: 'bottom',
  });
  assert.ok(game.scryWindow, 'rejected; window still open');

  // Keep match — accepted.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [0], order: [0, 1], placement: 'bottom',
  });
  assert.equal(game.scryWindow, null);
  assert.ok(game.players[p1].hand.some(c => c.uid === 'sc-match'));
});

// ─── Queen Victoria: reveal-type filter ────────────────────────────────

test('Queen Victoria scry: only Event-type cards qualify for keep', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const charCard = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'),
    uid: 'qv-char' };  // George, CHARACTER
  const eventCard = { ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
    uid: 'qv-event' };  // Gum-Gum Red Hawk, EVENT
  game.scryWindow = {
    playerId: p1,
    cards: [charCard, eventCard],
    keepCount: 1,
    keepFilter: null,
    keepCardType: 'EVENT',
    keepExcludeName: null,
    cardName: 'Queen Victoria',
    placement: 'bottom',
    pipelineResume: null,
  };
  // Keep the non-Event — rejected.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [0], order: [1], placement: 'bottom',
  });
  assert.ok(game.scryWindow, 'non-Event keep rejected');
  // Keep the Event — accepted.
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE', keptIndices: [1], order: [0], placement: 'bottom',
  });
  assert.equal(game.scryWindow, null);
  assert.ok(game.players[p1].hand.some(c => c.uid === 'qv-event'));
});

// ─── pipelineResume chain continues after scry resolves ───────────────

test('scry.pipelineResume fires next pipeline effect after SCRY_RESOLVE', () => {
  const { roomId, p1, game } = twoPlayerGame();
  // Use FiFi Cat's onPlay; it has only a scry effect so the resume
  // points past-the-end. We verify scryWindow clears and no residual
  // state blocks the game.
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fifi-chain' };
  game.players[p1].field.push(fifi);
  srv.runPipeline('onPlay', game, p1, fifi);
  assert.ok(game.scryWindow);
  assert.ok(game.scryWindow.pipelineResume,
    'resume continuation captured on the window');
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE',
    keptIndices: [],
    topOrder: [0, 1, 2, 3, 4],
    bottomOrder: [],
  });
  assert.equal(game.scryWindow, null);
});

// ─── Multi-card kept + rest to bottom (Schola full flow) ──────────────

test('Schola full flow: keep 1 matching, remaining go bottom in order', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const c1 = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'sh-c1' };
  const c2 = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'sh-c2',
    affiliation: 'Duchess of Brittany' };
  const c3 = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'sh-c3' };
  game.scryWindow = {
    playerId: p1,
    cards: [c1, c2, c3],
    keepCount: 1,
    keepFilter: 'Duchess of Brittany',
    keepCardType: null,
    keepExcludeName: null,
    cardName: 'Schola Montis Belli',
    placement: 'bottom',
    pipelineResume: null,
  };
  const deckLenBefore = game.players[p1].deck.length;
  const handLenBefore = game.players[p1].hand.length;
  srv.handleAction(roomId, p1, {
    type: 'SCRY_RESOLVE',
    keptIndices: [0],  // keep George (Duchess of Brittany)
    order: [0, 1],     // remaining [c2, c3] in that order
    placement: 'bottom',
  });
  assert.equal(game.scryWindow, null);
  assert.equal(game.players[p1].hand.length, handLenBefore + 1);
  assert.ok(game.players[p1].hand.some(c => c.uid === 'sh-c1'));
  // Deck bottom = [..., c2, c3].
  const deck = game.players[p1].deck;
  assert.equal(deck.length, deckLenBefore + 2);
  assert.equal(deck[deck.length - 2].uid, 'sh-c2');
  assert.equal(deck[deck.length - 1].uid, 'sh-c3');
});
