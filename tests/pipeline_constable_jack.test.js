// Phase-4 Batch 3 — Constable Jack leader [Activate: Main] migrated.
//   [Activate: Main] [Once Per Turn] DON!! -7: Trash up to 1 of your
//   opponent's Life cards.
//
// Exercises the DON cost → trashOpponentLife chain in activateMain,
// plus bypass-trigger semantics (life card goes straight to trash, not
// hand, and does NOT activate Trigger).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Constable Jack (leader) CARD_DB carries useNewPipeline:true', () => {
  const j = srv.CARD_DB.find(c => c.id === 'ST04-001');
  assert.equal(j.useNewPipeline, true);
});

test('activateMain with insufficient DON → cost unaffordable, no life trashed', () => {
  const { p2, game } = twoPlayerGame();
  // p2 is Constable Jack. DON is 0/0 initially.
  game.players[p2].donActive = 3;  // short of required 7
  game.players[p2].donRested = 0;
  const oppLifeBefore = game.players[Object.keys(game.players).find(id => id !== p2)].life.length;
  const res = srv.runPipeline('activateMain', game, p2, game.players[p2].leader);
  assert.equal(res.status, 'unaffordable');
  assert.ok(!game.donReturnWindow);
  const p1 = Object.keys(game.players).find(id => id !== p2);
  assert.equal(game.players[p1].life.length, oppLifeBefore, 'no life removed');
});

test('activateMain with 7 active DON → DON return window opens with pipelineResume', () => {
  const { p2, game } = twoPlayerGame();
  game.players[p2].donActive = 7;
  srv.runPipeline('activateMain', game, p2, game.players[p2].leader);
  assert.ok(game.donReturnWindow, 'DON return window opened');
  assert.equal(game.donReturnWindow.required, 7);
  assert.ok(game.donReturnWindow.pipelineResume, 'resume stashed for chain');
  assert.equal(game.donReturnWindow.pipelineResume.costsPaid, true);
});

test('paying 7 DON resumes to trashOpponentLife — top life card → opponent trash, hand unchanged', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p2].donActive = 7;
  const p1LifeBefore     = game.players[p1].life.length;
  const p1HandBefore     = game.players[p1].hand.length;
  const p1TrashBefore    = game.players[p1].trash.length;
  const topLifeUid       = game.players[p1].life[game.players[p1].life.length - 1].uid;

  srv.runPipeline('activateMain', game, p2, game.players[p2].leader);
  assert.ok(game.donReturnWindow);
  srv.handleAction(roomId, p2, {
    type: 'RETURN_DON',
    selections: { fromActive: 7, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);
  // Life card moved directly to trash (not hand), bypassing Trigger.
  assert.equal(game.players[p1].life.length,  p1LifeBefore  - 1, 'one life card removed');
  assert.equal(game.players[p1].hand.length,  p1HandBefore,      'life card did NOT go to hand');
  assert.equal(game.players[p1].trash.length, p1TrashBefore + 1, 'life card landed in trash');
  assert.ok(game.players[p1].trash.some(c => c.uid === topLifeUid), 'trashed card is the one that was on top of life');
  // Trigger window must not have opened — bypass-trigger semantics.
  assert.ok(!game.triggerWindow, 'no trigger window fired');
});
