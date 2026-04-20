// Phase 5 Priority 1 — Bad Manners Kick Course (OP04-016) migrated.
//   [Counter] You may trash 1 card from your hand: Give up to 1 of your
//   leaders or characters +3000 Power this battle.
//
// Exercises: trashFromHand cost → powerBuff target picker. Skip path
// on the trash cost aborts the block.
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

test('Bad Manners Kick Course CARD_DB carries useNewPipeline:true', () => {
  const card = srv.CARD_DB.find(c => c.id === 'OP04-016');
  assert.equal(card.useNewPipeline, true);
});

test('USE_COUNTER → pipeline counter timing → opens trashFromHand cost window', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP04-016'), uid: 'bmkc-1' };
  game.players[p2].hand = [
    card,
    { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fodder-1' },
  ];
  game.players[p2].donActive = 2;  // event cost 1 + to pay for the counter step

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'bmkc-1' });

  assert.ok(game.trashFromHandWindow, 'trash-from-hand cost window opened');
  assert.equal(game.trashFromHandWindow.count, 1);
  assert.ok(game.trashFromHandWindow.pipelineResume);
});

test('paying the trash cost resumes to powerBuff target picker', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP04-016'), uid: 'bmkc-2' };
  const fodder = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fodder-2' };
  game.players[p2].hand = [card, fodder];
  game.players[p2].donActive = 2;

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'bmkc-2' });
  srv.handleAction(roomId, p2, { type: 'TRASH_FROM_HAND_RESOLVE',
    cardUids: ['fodder-2'] });

  assert.equal(game.trashFromHandWindow, null);
  assert.ok(game.powerBuffTargetWindow, 'powerBuff window opened after cost paid');
  assert.equal(game.powerBuffTargetWindow.amount, 3000);
  assert.equal(game.powerBuffTargetWindow.duration, 'thisBattle');
  assert.equal(game.powerBuffTargetWindow.targetKind, 'leaderOrCharacter');
});

test('skipping the trash cost aborts the block — no powerBuff fires', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP04-016'), uid: 'bmkc-3' };
  game.players[p2].hand = [card,
    { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fodder-3' }];
  game.players[p2].donActive = 2;

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'bmkc-3' });
  assert.ok(game.trashFromHandWindow);
  srv.handleAction(roomId, p2, { type: 'TRASH_FROM_HAND_RESOLVE', skip: true });
  assert.equal(game.trashFromHandWindow, null);
  assert.ok(!game.powerBuffTargetWindow, 'no buff window when cost skipped');
  assert.equal((game.tempPowerEffects || []).length, 0);
});
