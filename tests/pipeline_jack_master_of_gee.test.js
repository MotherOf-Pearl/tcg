// Phase-4 Batch 2 — Jack, Master of Gee (OP01-094) migrated. Flow:
//   [On Play] DON!! -6 cost → leader {Holy Roman Empire} condition →
//   aoeKO excludeSelf effect.
// Tests cover the leader-gate condition, the returnDon cost window,
// and the aoeKO resolution that follows when the DON is paid.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function placeJack(game, ownerId) {
  const jack = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'jack-1', rested: false, attachedDon: 0 };
  game.players[ownerId].field.push(jack);
  return jack;
}

test('Jack, Master of Gee CARD_DB carries useNewPipeline:true', () => {
  const j = srv.CARD_DB.find(c => c.id === 'OP01-094');
  assert.equal(j.useNewPipeline, true);
});

test('onPlay with wrong leader affiliation → condition fails, no DON window', () => {
  // twoPlayerGame defaults p1 to Anna of Brittany (Duchess of Brittany) —
  // so Jack on p1's side fails the {Holy Roman Empire} gate.
  const { p1, game } = twoPlayerGame();
  const jack = placeJack(game, p1);
  game.players[p1].donActive = 6;  // enough to pay IF we got there
  srv.runPipeline('onPlay', game, p1, jack);
  assert.ok(!game.donReturnWindow, 'condition failed before cost');
});

test('onPlay with right leader but insufficient DON → unaffordable', () => {
  // Put Jack on p2's side (Constable Jack leader = Holy Roman Empire).
  const { p2, game } = twoPlayerGame();
  const jack = placeJack(game, p2);
  game.players[p2].donActive = 0;
  game.players[p2].donRested = 0;
  // (attached DON to leader/characters also counts, but we set all to 0)
  const res = srv.runPipeline('onPlay', game, p2, jack);
  assert.equal(res.status, 'unaffordable');
  assert.ok(!game.donReturnWindow);
});

test('onPlay with right leader + 6 active DON → opens DON return window', () => {
  const { p2, game } = twoPlayerGame();
  const jack = placeJack(game, p2);
  game.players[p2].donActive = 6;
  srv.runPipeline('onPlay', game, p2, jack);
  assert.ok(game.donReturnWindow, 'DON return window opened by cost agent');
  assert.equal(game.donReturnWindow.required, 6);
  assert.ok(game.donReturnWindow.pipelineResume, 'resume stashed');
  assert.equal(game.donReturnWindow.pipelineResume.costsPaid, true);
});

test('paying the DON cost fires aoeKO — opponent characters trashed, Jack remains', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const jack = placeJack(game, p2);
  game.players[p2].donActive = 6;
  // Two opponent characters on p1's field.
  const v1 = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'v1', rested: false, attachedDon: 0 };
  const v2 = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'v2', rested: false, attachedDon: 0 };
  game.players[p1].field.push(v1, v2);

  srv.runPipeline('onPlay', game, p2, jack);
  assert.ok(game.donReturnWindow);

  // Pay 6 active DON.
  srv.handleAction(roomId, p2, {
    type: 'RETURN_DON',
    selections: { fromActive: 6, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);
  // AOE fired — both victims in p1's trash, Jack still on p2's field.
  assert.equal(game.players[p1].field.length, 0, 'opponent field wiped');
  assert.ok(game.players[p1].trash.some(c => c.uid === 'v1'));
  assert.ok(game.players[p1].trash.some(c => c.uid === 'v2'));
  assert.ok(game.players[p2].field.some(c => c.uid === jack.uid), 'Jack survives AOE');
});
