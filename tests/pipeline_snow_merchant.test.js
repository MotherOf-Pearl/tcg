// Phase 5 Priority 2 — Snow Merchant (OP01-087) migrated to the
// pipeline for its [Counter] playFromHand effect. The [Trigger]
// "Activate this card's [Counter] effect" meta-reference is a known
// parser gap (Priority 5); the counter block is independent and
// parses cleanly.
//
// Verifies: USE_COUNTER routes the card through runPipeline('counter'),
// which resolves to a playFromHand window filtered by the parsed
// {Duchess of Brittany} type / CHARACTER / cost ≤ 3 criteria.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function armCounterStep(game, p1, p2) {
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1, attackerName: 'X', attackerPower: 5000,
    targetUid: game.players[p2].leader.uid,
    targetName: 'Y', targetPower: 5000,
    targetIsLeader: true, counterBonus: 0,
    blockerUsed: false,
  };
}

test('Snow Merchant CARD_DB carries useNewPipeline:true', () => {
  const card = srv.CARD_DB.find(c => c.id === 'OP01-087');
  assert.equal(card.useNewPipeline, true);
});

test('USE_COUNTER routes Snow Merchant → playFromHand window with Duchess / cost ≤ 3 filter', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const snow = { ...srv.CARD_DB.find(c => c.id === 'OP01-087'), uid: 'snow-1' };
  // Eligible in-hand candidate — a Duchess of Brittany character at cost ≤ 3.
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fifi-h' }; // cost 2, affiliation Duchess of Brittany
  // Ineligible — Constable Anna (Duchess of Brittany but cost 7).
  const anna = { ...srv.CARD_DB.find(c => c.id === 'OP01-067'), uid: 'anna-h' };
  game.players[p2].hand = [snow, fifi, anna];
  game.players[p2].donActive = 3;  // covers the event cost 2

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'snow-1' });

  assert.ok(game.playFromHandWindow, 'playFromHand window opened by pipeline counter branch');
  assert.equal(game.playFromHandWindow.playerId, p2);
  assert.deepEqual(game.playFromHandWindow.candidateUids, ['fifi-h'],
    'only Duchess of Brittany CHARACTER with cost ≤ 3 qualifies');
  assert.equal(game.playFromHandWindow.costThreshold, 3);
  assert.equal(game.playFromHandWindow.typeName, 'Duchess of Brittany');
});

test('picking the eligible character plays it from hand onto defender field for free', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const snow = { ...srv.CARD_DB.find(c => c.id === 'OP01-087'), uid: 'snow-2' };
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fifi-pick' };
  game.players[p2].hand = [snow, fifi];
  game.players[p2].donActive = 3;

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'snow-2' });
  // After playing the event: cost 2 deducted. donActive now 1.
  const donActiveAfterCost = game.players[p2].donActive;
  assert.ok(game.playFromHandWindow);
  srv.handleAction(roomId, p2, { type: 'PLAY_FROM_HAND_RESOLVE', cardUid: 'fifi-pick' });

  assert.equal(game.playFromHandWindow, null, 'window cleared');
  assert.ok(game.players[p2].field.some(c => c.uid === 'fifi-pick'), 'FiFi Cat landed on field');
  assert.equal(game.players[p2].hand.some(c => c.uid === 'fifi-pick'), false, 'removed from hand');
  // free:true — the played character does NOT cost DON on top of the
  // event's own cost, which was already deducted.
  assert.equal(game.players[p2].donActive, donActiveAfterCost,
    'free play does not charge DON for the played character');
});

test('no eligible cards → no window opens, pipeline returns no-targets', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const snow = { ...srv.CARD_DB.find(c => c.id === 'OP01-087'), uid: 'snow-3' };
  // Hand has only Snow Merchant (the source) and a high-cost card.
  const anna = { ...srv.CARD_DB.find(c => c.id === 'OP01-067'), uid: 'anna-none' }; // cost 7
  game.players[p2].hand = [snow, anna];
  game.players[p2].donActive = 3;
  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'snow-3' });
  assert.ok(!game.playFromHandWindow, 'no eligible candidates → no window');
});
