// window-lifecycle v2 — END_TURN walks descriptor table.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

test('END_TURN with an open cancellable picker auto-cancels + flips turn', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  // Open an optional bounceTargetWindow on p1's side (mandatory would
  // route through forcedPickHelper — covered by window_mandatory_pick).
  const cand = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'cand-1', rested: false, attachedDon: 0 };
  game.players[p2].field.push(cand);
  // Directly construct the optional window so the test isolates END_TURN
  // behaviour. Use the helper-friendly shape: candidateUids + optional.
  game.bounceTargetWindow = {
    playerId: p1,
    candidateUids: ['cand-1'],
    filterKind: 'cost', filterValue: 99, optional: true,
    sourceCardName: 'test', pipelineResume: null,
    pickRequirement: 'optional',
  };
  // activeWindow must be set for the END_TURN sweep to find this.
  game.activeWindow = {
    field: 'bounceTargetWindow', playerId: p1,
    sourceCardUid: null, openedAtTurn: game.turn,
    // Use the same descriptor object the server uses; the END_TURN sweep
    // re-resolves via WINDOW_DESCRIPTORS so this field on activeWindow
    // isn't actually consulted.
    descriptor: null,
  };
  const turnBefore = game.activePlayer;

  srv.handleAction(roomId, p1, { type: 'END_TURN' });
  assert.equal(game.bounceTargetWindow, null, 'optional window auto-cancelled');
  assert.notEqual(game.activePlayer, turnBefore, 'turn flipped');
});

test('END_TURN with an open blocking opponentChoosesWindow is rejected', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  // Open opponentChoosesWindow owned by p2 (chooser).
  game.opponentChoosesWindow = {
    playerId: p2, activePlayerId: p1,
    sourceCardName: 'test', sourceCardUid: null, sourceCardId: null,
    branches: [{ index: 0, available: true, effects: [], text: 'A' }],
    availableOptions: [0], pipelineResume: null,
    pickRequirement: 'mandatory',
  };
  // The opponentChoosesWindow lockout at the top of handleAction would
  // block p1's END_TURN, since p1 != game.opponentChoosesWindow.playerId.
  // The lockout sends ERROR "Waiting for opponent to choose…" — that is
  // the rejection path we want to verify. END_TURN_REJECTED is sent only
  // if execution reaches the END_TURN handler; with the lockout active,
  // we instead see the lockout ERROR. Both are valid rejections.
  const p1Client = srv.clients.get(p1);
  p1Client._sent.length = 0;
  const turnBefore = game.activePlayer;

  srv.handleAction(roomId, p1, { type: 'END_TURN' });

  assert.equal(game.activePlayer, turnBefore, 'turn unchanged');
  // Either the lockout ERROR or END_TURN_REJECTED is acceptable; both
  // mean the engine refused to advance.
  const refused = p1Client._sent.some(m =>
    (m.type === 'END_TURN_REJECTED' && m.blockingWindow === 'opponentChoosesWindow')
    || (m.type === 'ERROR' && /opponent/i.test(m.msg || '')));
  assert.ok(refused, 'END_TURN refused while opponentChoosesWindow open');
});
