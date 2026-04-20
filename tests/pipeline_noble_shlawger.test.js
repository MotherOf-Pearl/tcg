// Phase 3 pipeline — Noble Shlawger [On Block] end-to-end. This is the
// first card routed through the multi-agent pipeline via
// useNewPipeline:true on the CARD_DB entry. Covers:
//   (1) catalog flag is set
//   (2) full happy path — DON attached, valid target → window opens,
//       selection moves the picked char to its owner's deck bottom
//   (3) condition gate — no attached DON → no window opens
//   (4) no valid targets → no window opens
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function placeNoble(game, defenderId, donCount) {
  const src = srv.CARD_DB.find(c => c.id === 'ST03-003');
  const noble = { ...src, uid: 'noble-1', rested: false, attachedDon: donCount };
  game.players[defenderId].field.push(noble);
  return noble;
}

function armBlockStep(game, attackerId) {
  const defenderId = Object.keys(game.players).find(id => id !== attackerId);
  game.phase = 'BLOCK_STEP';
  game.battleState = {
    attackerUid: game.players[attackerId].leader.uid,
    attackerId,
    attackerName: 'Atk',
    attackerPower: 5000,
    targetUid: game.players[defenderId].leader.uid,
    targetName: 'Def Leader',
    targetPower: 5000,
    targetIsLeader: true,
    counterBonus: 0,
    blockerUsed: false,
  };
}

test('(1) Noble Shlawger CARD_DB carries useNewPipeline:true', () => {
  const noble = srv.CARD_DB.find(c => c.id === 'ST03-003');
  assert.equal(noble.useNewPipeline, true);
});

test('(2) full pipeline: DON attached + valid target → window opens → selection places target on owner deck bottom', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const noble = placeNoble(game, p2, 1);
  // Put a cost-2 character on p1 (attacker) field to be a valid target.
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'p1-fifi', cost: 2, rested: false, attachedDon: 0 };
  game.players[p1].field.push(fifi);
  const p1DeckLenBefore = game.players[p1].deck.length;
  armBlockStep(game, p1);

  // Defender clicks Noble Shlawger as blocker.
  srv.handleAction(roomId, p2, { type: 'USE_BLOCKER', blockerUid: noble.uid });

  // Battle side-effects still applied.
  assert.equal(game.phase, 'COUNTER_STEP');
  assert.equal(game.battleState.blockerUsed, true);

  // Pipeline opened the place-at-bottom window for the defender.
  assert.ok(game.placeAtBottomWindow, 'placeAtBottomWindow opened');
  assert.equal(game.placeAtBottomWindow.playerId, p2);
  assert.deepEqual(game.placeAtBottomWindow.candidateUids, ['p1-fifi'],
    'only cost ≤ 2 chars on either field qualify; p2 has just Noble (cost 5) which is filtered out');
  assert.equal(game.placeAtBottomWindow.optional, true);
  assert.equal(game.placeAtBottomWindow.sourceCardName, 'Noble Shlawger');

  // Defender selects the target. Card moves to owner's (p1's) deck bottom.
  srv.handleAction(roomId, p2, { type: 'PLACE_AT_BOTTOM_SELECTED', targetUid: 'p1-fifi' });
  assert.equal(game.placeAtBottomWindow, null, 'window cleared after selection');
  const p1Deck = game.players[p1].deck;
  assert.equal(p1Deck.length, p1DeckLenBefore + 1, 'deck grew by exactly 1 card');
  assert.equal(p1Deck[p1Deck.length - 1].uid, 'p1-fifi', 'target landed at deck bottom');
  assert.equal(game.players[p1].field.some(c => c.uid === 'p1-fifi'), false, 'target removed from field');
});

test('(3) condition gate: no DON attached → pipeline declines to open window', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const noble = placeNoble(game, p2, 0);  // 0 attached DON
  game.players[p1].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'p1-x', cost: 2, rested: false, attachedDon: 0 });
  armBlockStep(game, p1);

  srv.handleAction(roomId, p2, { type: 'USE_BLOCKER', blockerUid: noble.uid });

  assert.ok(!game.placeAtBottomWindow, 'condition failed → no window (null or undefined)');
  assert.equal(game.phase, 'COUNTER_STEP', 'block itself still succeeded');
});

test('(4) no valid targets on either field → window does not open', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const noble = placeNoble(game, p2, 1);
  // Only a cost-7 character on either field — none match maxCost:2.
  game.players[p1].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'p1-big', cost: 7, rested: false, attachedDon: 0 });
  armBlockStep(game, p1);

  srv.handleAction(roomId, p2, { type: 'USE_BLOCKER', blockerUid: noble.uid });

  assert.ok(!game.placeAtBottomWindow, 'no targets → window not opened');
});

test('(5) pipeline skip: defender sends skip → window clears, no movement', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const noble = placeNoble(game, p2, 1);
  game.players[p1].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'p1-opt', cost: 2, rested: false, attachedDon: 0 });
  const p1DeckLenBefore = game.players[p1].deck.length;
  armBlockStep(game, p1);

  srv.handleAction(roomId, p2, { type: 'USE_BLOCKER', blockerUid: noble.uid });
  assert.ok(game.placeAtBottomWindow, 'window opened');
  srv.handleAction(roomId, p2, { type: 'PLACE_AT_BOTTOM_SELECTED', skip: true });
  assert.equal(game.placeAtBottomWindow, null);
  assert.equal(game.players[p1].deck.length, p1DeckLenBefore, 'no card moved on skip');
  assert.ok(game.players[p1].field.some(c => c.uid === 'p1-opt'), 'target still on field');
});
