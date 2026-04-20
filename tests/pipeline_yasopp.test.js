// Phase 5 Priority 1 — Yasopp (OP09-013) migrated.
//   [On Play] Up to one of your leaders gains +1000 power until the
//   end of your opponent's next turn.
//   [DON!! x1] [When Attacking] Up to one of your opponent's characters
//   gets -1000 power for this turn.
//
// Pipeline exercises: onPlay target=leader buff (auto-apply, no picker
// needed since leader is uniquely targeted) + whenAttacking donAttached
// condition + opponent character picker.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function placeYasopp(game, ownerId, attachedDon) {
  const card = { ...srv.CARD_DB.find(c => c.id === 'OP09-013'),
    uid: 'yasopp-1', rested: false, attachedDon };
  game.players[ownerId].field.push(card);
  return card;
}

test('Yasopp CARD_DB carries useNewPipeline:true', () => {
  const card = srv.CARD_DB.find(c => c.id === 'OP09-013');
  assert.equal(card.useNewPipeline, true);
});

test('[On Play] opens power-buff target picker for own leader', () => {
  const { p1, game } = twoPlayerGame();
  const yasopp = placeYasopp(game, p1, 0);
  srv.runPipeline('onPlay', game, p1, yasopp);
  // target: 'leader' → picker opens with just the leader as candidate.
  assert.ok(game.powerBuffTargetWindow, 'power-buff target window opened');
  assert.equal(game.powerBuffTargetWindow.playerId, p1);
  assert.equal(game.powerBuffTargetWindow.side, 'self');
  assert.equal(game.powerBuffTargetWindow.targetKind, 'leader');
  assert.equal(game.powerBuffTargetWindow.amount, 1000);
  assert.equal(game.powerBuffTargetWindow.duration, 'opponentNextTurn');
  assert.deepEqual(game.powerBuffTargetWindow.candidateUids, [game.players[p1].leader.uid]);
});

test('Selecting the leader applies a +1000 temp buff lasting opponentNextTurn', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const yasopp = placeYasopp(game, p1, 0);
  srv.runPipeline('onPlay', game, p1, yasopp);
  srv.handleAction(roomId, p1, { type: 'POWER_BUFF_TARGET_SELECTED', targetUid: game.players[p1].leader.uid });
  assert.equal(game.powerBuffTargetWindow, null);
  const tp = (game.tempPowerEffects || []).find(e => e.targetUid === game.players[p1].leader.uid);
  assert.ok(tp, 'temp buff stored');
  assert.equal(tp.amount, 1000);
});

test('[When Attacking] without 1 attached DON → condition fails, no window', () => {
  const { p1, game } = twoPlayerGame();
  const yasopp = placeYasopp(game, p1, 0);  // no DON attached
  srv.runPipeline('whenAttacking', game, p1, yasopp);
  assert.ok(!game.powerBuffTargetWindow, 'condition gate closes the pipeline');
});

test('[When Attacking] with 1 attached DON → opens opponent-character debuff picker', () => {
  const { p1, p2, game } = twoPlayerGame();
  const yasopp = placeYasopp(game, p1, 1);
  // Put a character on opponent field so the picker has a candidate.
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-t', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  srv.runPipeline('whenAttacking', game, p1, yasopp);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.side, 'opponent');
  assert.equal(game.powerBuffTargetWindow.targetKind, 'character');
  assert.equal(game.powerBuffTargetWindow.amount, -1000);
  assert.deepEqual(game.powerBuffTargetWindow.candidateUids, ['opp-t']);
});
