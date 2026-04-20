// Phase 5 Priority 1 — NoroNoro Beam Sword (OP07-076) migrated.
//   [Counter] DON!! -1: Give up to 1 of your Leader or Character cards
//   +2000 power for this battle. Then, rest up to 1 of your opponent's
//   Characters.
//
// Flow: played as a counter from hand → USE_COUNTER handler → runs
// pipeline counter timing → returnDon cost → powerBuff target picker →
// restTarget picker.
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

test('NoroNoro Beam Sword CARD_DB carries useNewPipeline:true', () => {
  const card = srv.CARD_DB.find(c => c.id === 'OP07-076');
  assert.equal(card.useNewPipeline, true);
});

test('USE_COUNTER routes NoroNoro through runPipeline → opens DON return window', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  // Put NoroNoro in defender (p2) hand; they'll play it as a counter.
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP07-076'), uid: 'noro-1' };
  game.players[p2].hand = [card];
  game.players[p2].donActive = 3;  // enough to pay the event cost (2) + counter cost (1)

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'noro-1' });

  // Event cost (card.cost=2) deducted for playing it as counter.
  // Then pipeline's counter block requires 1 DON to return — so the DON
  // return window should be open.
  assert.ok(game.donReturnWindow, 'DON return window opened by pipeline cost agent');
  assert.equal(game.donReturnWindow.required, 1);
  assert.ok(game.donReturnWindow.pipelineResume);
});

test('paying 1 DON → opens power-buff target picker for leaderOrCharacter', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP07-076'), uid: 'noro-2' };
  game.players[p2].hand = [card];
  game.players[p2].donActive = 3;

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'noro-2' });
  assert.ok(game.donReturnWindow);
  srv.handleAction(roomId, p2, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });

  // Pipeline resumed → powerBuff opened. Candidates are p2's leader +
  // any characters on p2's field (none here, so just the leader).
  assert.equal(game.donReturnWindow, null);
  assert.ok(game.powerBuffTargetWindow, 'power-buff target window opened');
  assert.equal(game.powerBuffTargetWindow.side, 'self');
  assert.equal(game.powerBuffTargetWindow.targetKind, 'leaderOrCharacter');
  assert.equal(game.powerBuffTargetWindow.amount, 2000);
  assert.equal(game.powerBuffTargetWindow.duration, 'thisBattle');
});

test('selecting leader for +2000 then resolves restTarget (if opponent has active chars)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP07-076'), uid: 'noro-3' };
  game.players[p2].hand = [card];
  game.players[p2].donActive = 3;
  // Put an active opponent character so restTarget has a candidate.
  const oppChar = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-ac', rested: false, attachedDon: 0 };
  game.players[p1].field.push(oppChar);

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'noro-3' });
  srv.handleAction(roomId, p2, { type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] } });
  srv.handleAction(roomId, p2, { type: 'POWER_BUFF_TARGET_SELECTED',
    targetUid: game.players[p2].leader.uid });

  // Power buff applied, then pipeline advances to restTarget.
  const tp = (game.tempPowerEffects || []).find(e => e.targetUid === game.players[p2].leader.uid);
  assert.ok(tp, 'leader buff stored');
  assert.equal(tp.amount, 2000);
  assert.ok(game.restTargetWindow, 'restTarget window opened for the second effect');
});
