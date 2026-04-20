// Phase 6 Batch 2 — six more flag-flip migrations covering additional
// shapes: trashFromHand cost variants, event counter + trigger, stage
// activateMain scry-with-reveal, and whenAttacking scry-with-reveal.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── ST04-008 Noble Gee — trashFromHand cost → addDon active ───────────

test('Noble Gee ST04-008 flag + trashFromHand cost opens before addDon', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'ST04-008');
  assert.equal(c.useNewPipeline, true);
  // Put a card in hand to trash.
  game.players[p1].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ng-handcard' });
  const ng = { ...c, uid: 'ng-1' };
  game.players[p1].field.push(ng);
  srv.runPipeline('onPlay', game, p1, ng);
  assert.ok(game.trashFromHandWindow, 'cost window opened first');
  assert.equal(game.trashFromHandWindow.playerId, p1);
  assert.equal(game.trashFromHandWindow.count, 1);
});

// ─── PRB02-003 Lucky Roux — filtered trash cost → drawCards ────────────

test('Lucky Roux PRB02-003 flag + trashFromHand filter (Character, ≥6000 power)', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'PRB02-003');
  assert.equal(c.useNewPipeline, true);
  // Put a 7000-power Character in hand so the cost has a candidate.
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'lr-big' };  // Benn Beckman, 7000 power
  game.players[p1].hand.push(big);
  const lr = { ...c, uid: 'lr-1' };
  game.players[p1].field.push(lr);
  srv.runPipeline('onPlay', game, p1, lr);
  assert.ok(game.trashFromHandWindow);
  assert.equal(game.trashFromHandWindow.filterType, 'CHARACTER');
  assert.equal(game.trashFromHandWindow.filterPowerMin, 6000);
});

// ─── OP01-026 Gum-Gum Red Hawk — counter powerBuff → koTarget chain ───

test('Gum-Gum Red Hawk OP01-026 flag + counter opens powerBuffTargetWindow', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-026');
  assert.equal(c.useNewPipeline, true);
  const hawk = { ...c, uid: 'ggrh-1' };
  game.players[p1].trash.push(hawk);  // counter step plays event to trash
  srv.runPipeline('counter', game, p1, hawk);
  assert.ok(game.powerBuffTargetWindow, 'counter opened +4000 window');
  assert.equal(game.powerBuffTargetWindow.amount, 4000);
  assert.equal(game.powerBuffTargetWindow.side, 'self');
});

test('Gum-Gum Red Hawk OP01-026 trigger powerDebuff -10000', () => {
  const { p1, p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ggrh-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  const hawk = { ...srv.CARD_DB.find(c => c.id === 'OP01-026'), uid: 'ggrh-t' };
  game.players[p1].trash.push(hawk);
  srv.runPipeline('trigger', game, p1, hawk);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, -10000);
  assert.equal(game.powerBuffTargetWindow.side, 'opponent');
});

// ─── ST04-016 Off to the Market — counter DON -1 cost → +4000 ──────────

test('Off to the Market ST04-016 flag + DON!! -1 cost → powerBuff', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'ST04-016');
  assert.equal(c.useNewPipeline, true);
  game.players[p1].donActive = 3;
  const market = { ...c, uid: 'otm-1' };
  game.players[p1].trash.push(market);
  srv.runPipeline('counter', game, p1, market);
  assert.ok(game.donReturnWindow);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, 4000);
});

// ─── OP01-090 Schola Montis Belli — scry 5 with reveal ─────────────────

test('Schola Montis Belli OP01-090 flag + opens scry with reveal filter', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-090');
  assert.equal(c.useNewPipeline, true);
  // Stage on field; activateMain triggers the scry.
  const stage = { ...c, uid: 'smb-1' };
  game.players[p1].stage = stage;
  srv.runPipeline('activateMain', game, p1, stage);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.cards.length, 5);
  assert.equal(game.scryWindow.keepCount, 1);
  assert.equal(game.scryWindow.keepFilter, 'Duchess of Brittany');
  assert.equal(game.scryWindow.placement, 'bottom');
});

// ─── OP01-084 Queen Victoria — whenAttacking [DON!! x1] scry ───────────

test('Queen Victoria OP01-084 flag + whenAttacking with DON!! x1 → scry+reveal', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-084');
  assert.equal(c.useNewPipeline, true);
  // Victoria with 1 attached DON — condition met.
  const vic = { ...c, uid: 'qv-1', attachedDon: 1, rested: false };
  game.players[p1].field.push(vic);
  srv.runPipeline('whenAttacking', game, p1, vic);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.cards.length, 5);
  assert.equal(game.scryWindow.keepFilter, 'Duchess of Brittany');
  assert.equal(game.scryWindow.keepCardType, 'EVENT');
});

test('Queen Victoria OP01-084 whenAttacking with 0 DON — condition fails → no scry', () => {
  const { p1, game } = twoPlayerGame();
  const vic = { ...srv.CARD_DB.find(c => c.id === 'OP01-084'),
    uid: 'qv-nodon', attachedDon: 0, rested: false };
  game.players[p1].field.push(vic);
  srv.runPipeline('whenAttacking', game, p1, vic);
  assert.ok(!game.scryWindow, 'DON!! x1 condition failed — no window');
});
