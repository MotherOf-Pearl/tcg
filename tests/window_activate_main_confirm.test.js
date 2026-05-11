// window-lifecycle v2 — two-phase ACTIVATE_MAIN.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('ACTIVATE_MAIN opens confirm window without mutating state', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-conf', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  const leader = game.players[p1].leader;
  const restedBefore = leader.rested;
  const usedBefore = !!leader.usedThisTurn;

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: leader.uid });
  assert.ok(game.activateMainConfirmWindow, 'confirm window opened');
  assert.equal(game.activateMainConfirmWindow.cardUid, leader.uid);
  assert.equal(game.activateMainConfirmWindow.playerId, p1);
  assert.equal(leader.rested, restedBefore, 'leader NOT rested before confirm');
  assert.equal(!!leader.usedThisTurn, usedBefore, 'usedThisTurn NOT set before confirm');
  assert.ok(!game.restTargetWindow, 'restTargetWindow not yet open');
});

test('ACTIVATE_MAIN_CONFIRM commits rest + usedThisTurn', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-confirm', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  const leader = game.players[p1].leader;

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: leader.uid });
  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN_CONFIRM', cardUid: leader.uid });

  assert.equal(game.activateMainConfirmWindow, null, 'confirm window cleared');
  assert.equal(leader.rested, true, 'leader rested after confirm');
  assert.equal(leader.usedThisTurn, true, 'usedThisTurn set after confirm');
  // Pipeline runs after confirm — for Anna's leader this may abort
  // (unaffordable DON!! cost) depending on payload, but the commit step
  // itself has fired. The mutation guarantee is what we test here.
});

test('CANCEL_WINDOW on activateMainConfirmWindow leaves no state change', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-canc', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  const leader = game.players[p1].leader;

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: leader.uid });
  assert.ok(game.activateMainConfirmWindow, 'confirm open');

  srv.handleAction(roomId, p1, { type: 'CANCEL_WINDOW' });
  assert.equal(game.activateMainConfirmWindow, null, 'confirm cleared');
  assert.equal(leader.rested, false, 'leader still active (cancel pre-cost)');
  assert.equal(!!leader.usedThisTurn, false, 'usedThisTurn unchanged');
});
