// window-lifecycle v2 — mandatory picker on END_TURN routes through
// forcedPickHelper. Anna of Brittany's restTarget is the canonical
// case: "Rest 1 of your opponent's Characters" — mandatory.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('END_TURN with mandatory bounceTarget + exactly one candidate force-picks it', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 2; // bypass turn-1-no-attack restriction in END_TURN
  // Drive Ball the Berserk's onPlay → mandatory bounceTargetWindow.
  const ball = { ...srv.CARD_DB.find(c => c.id === 'ST03-014'),
    uid: 'ball-mand', rested: false, attachedDon: 0 };
  game.players[p1].field.push(ball);
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-mand', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow, 'window open');
  assert.equal(game.bounceTargetWindow.pickRequirement, 'mandatory',
    'Ball the Berserk "Return 1" is mandatory');

  const oppHandBefore = game.players[p2].hand.length;
  const oppFieldBefore = game.players[p2].field.length;
  srv.handleAction(roomId, p1, { type: 'END_TURN' });
  assert.equal(game.bounceTargetWindow, null, 'window resolved');
  assert.equal(game.players[p2].field.length, oppFieldBefore - 1,
    'forced pick bounced the candidate');
  assert.equal(game.players[p2].hand.length, oppHandBefore + 1,
    'bounced card returned to opponent hand');
});

test('END_TURN with mandatory bounceTarget but zero candidates closes cleanly (§1-3-2)', () => {
  // Manually construct a mandatory window with no candidates. END_TURN
  // sweep should close the window without crashing and without firing
  // any resume.
  const { roomId, p1, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 2;
  game.bounceTargetWindow = {
    playerId: p1, candidateUids: [], optional: false,
    filterKind: 'cost', filterValue: 99,
    sourceCardName: 'test', resumeTiming: null, resumeCardUid: null,
    pipelineResume: null, pickRequirement: 'mandatory',
  };
  game.activeWindow = { field: 'bounceTargetWindow', playerId: p1,
    sourceCardUid: null, openedAtTurn: game.turn, descriptor: null };
  assert.doesNotThrow(() => {
    srv.handleAction(roomId, p1, { type: 'END_TURN' });
  });
  assert.equal(game.bounceTargetWindow, null, 'window closed cleanly');
});
