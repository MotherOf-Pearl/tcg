// Track P partials batch A — scry-to-trash placement ("This is MY
// AGE!!!!") and Marco-style self-revive (period-separated optional
// cost + play-from-trash compound).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── OP09-096 This is MY AGE!!!! — scry with placement='trash' ─────────

test('parser: "put the rest of the cards into your trash" → placement trash', () => {
  const out = srv.parseAbility(
    '[Main] Look at the top 3 cards of your deck and reveal up to one {Blackbeard Pirates} type card other than [This is MY AGE!!!!] and put it into your hand. Then put the rest of the cards into your trash.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  const scry = out.effects[0].effects[0];
  assert.equal(scry.type, 'scry');
  assert.equal(scry.placement, 'trash');
  assert.equal(scry.count, 3);
  assert.equal(scry.reveal.filter.affiliation, 'Blackbeard Pirates');
  assert.equal(scry.reveal.filter.excludeName, 'This is MY AGE!!!!');
});

test('This is MY AGE OP09-096 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP09-096');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP09-096');
  assert.deepEqual(p.unparsedSegments, []);
});

test('This is MY AGE eventMain opens scry; unkept cards go to trash', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const evt = { ...srv.CARD_DB.find(c => c.id === 'OP09-096'), uid: 'age-1' };
  game.players[p1].trash.push(evt);
  const trashBefore = game.players[p1].trash.length;
  const deckBefore = game.players[p1].deck.length;
  srv.runPipeline('eventMain', game, p1, evt);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.placement, 'trash');
  assert.equal(game.scryWindow.cards.length, 3);

  // Resolve with no keeps — all 3 revealed cards go to trash.
  srv.handleAction(roomId, p1, { type: 'SCRY_RESOLVE', keptIndices: [] });
  assert.equal(game.players[p1].trash.length, trashBefore + 3,
    '3 cards added to trash from scry');
  assert.equal(game.players[p1].deck.length, deckBefore - 3,
    '3 cards removed from deck');
});

// ─── OP03-013 Marco — self-revive ──────────────────────────────────────

test('parser: Marco onKO compound → selfRevive effect', () => {
  const out = srv.parseAbility(
    '[On K.O.] You may trash 1 Event card from your hand. Play this character from the trash as rested.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'selfRevive', costCount: 1, costType: 'EVENT', reviveState: 'rested' },
  ]);
});

test('Marco OP03-013 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP03-013');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP03-013');
  assert.deepEqual(p.unparsedSegments, []);
});

test('Marco onKO: paying Event trash cost revives him from trash (rested)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const marco = { ...srv.CARD_DB.find(c => c.id === 'OP03-013'),
    uid: 'mc-1', rested: false, attachedDon: 0 };
  game.players[p1].trash.push(marco);
  // Event in hand for the cost.
  const evCost = { ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
    uid: 'mc-ev' };
  game.players[p1].hand.push(evCost);

  srv.triggerOnKO(game, p1, marco, p2);
  assert.ok(game.trashFromHandWindow, 'revive cost window opened');
  assert.equal(game.trashFromHandWindow.filterType, 'EVENT');
  // Pay the cost.
  srv.handleAction(roomId, p1, {
    type: 'TRASH_FROM_HAND_RESOLVE', cardUids: ['mc-ev'],
  });
  assert.equal(game.trashFromHandWindow, null);
  // Marco is now on field, rested.
  const onField = game.players[p1].field.find(c => c.uid === 'mc-1');
  assert.ok(onField, 'Marco revived onto field');
  assert.equal(onField.rested, true, 'played as rested');
  // Event card moved to trash (cost paid).
  assert.ok(game.players[p1].trash.find(c => c.uid === 'mc-ev'));
});

test('Marco onKO: skipping cost leaves him in trash', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const marco = { ...srv.CARD_DB.find(c => c.id === 'OP03-013'),
    uid: 'mc-2' };
  game.players[p1].trash.push(marco);
  game.players[p1].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
    uid: 'mc-ev2' });
  srv.triggerOnKO(game, p1, marco, p2);
  assert.ok(game.trashFromHandWindow);
  srv.handleAction(roomId, p1, { type: 'TRASH_FROM_HAND_RESOLVE', skip: true });
  assert.equal(game.trashFromHandWindow, null);
  assert.ok(game.players[p1].trash.find(c => c.uid === 'mc-2'),
    'Marco stays in trash on skip');
  assert.equal(game.players[p1].field.find(c => c.uid === 'mc-2'), undefined);
});
