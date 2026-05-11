// window-lifecycle v2 — ACTIVATE_MAIN re-entry. If a confirm window is
// already open for the same player, opening a second ACTIVATE_MAIN for
// a different card re-targets it. Opening for a different player ERRORs.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

test('second ACTIVATE_MAIN re-targets the confirm window to the new card', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  // p1.leader is Anna of Brittany (has [Activate: Main]).
  const leader = game.players[p1].leader;
  // Add a second activate-main card on the field — Schola Montis Belli
  // (ST07-016) carries [Activate: Main] in canonical card text. Fall
  // back to anything in CARD_DB that has the keyword if not present.
  let other = null;
  for (const c of srv.CARD_DB) {
    if (c.id === leader.id) continue;
    if (c.ability && c.ability.includes('[Activate: Main]')) { other = c; break; }
  }
  // Even if no other card has [Activate: Main] in CARD_DB, the test for
  // re-entry only needs *two distinct uids* with the keyword. Clone the
  // leader's ability onto a synthetic field stage as a fallback.
  const second = other
    ? { ...other, uid: 'second-am', rested: false, attachedDon: 0 }
    : { ...leader, uid: 'second-am', rested: false, attachedDon: 0,
        type: 'STAGE', ability: leader.ability };
  game.players[p1].field.push(second);
  // Ensure a candidate exists for any rest-target pipeline.
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-r', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: leader.uid });
  assert.ok(game.activateMainConfirmWindow, 'confirm window open for leader');
  assert.equal(game.activateMainConfirmWindow.cardUid, leader.uid);

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: second.uid });
  assert.ok(game.activateMainConfirmWindow, 'confirm window still open');
  assert.equal(game.activateMainConfirmWindow.cardUid, second.uid,
    're-targeted to second card');
  // Leader untouched.
  assert.equal(leader.rested, false, 'leader not rested');
  assert.equal(!!leader.usedThisTurn, false, 'leader usedThisTurn unchanged');
});
