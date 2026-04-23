// Phase 5 Priority 3 — conditional power buffs / effects gated by
// "if your Leader has the {X} type". No parser change needed (the
// leaderType condition + powerBuff/koTarget/addDon effects were
// already supported by prior phases). This file locks down migration
// of three cards that sit cleanly on the existing infrastructure.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Baby 5 (OP10-076) — trashFromHand cost + leaderType gate + addDon ───

function anchorDonLeader(game, pid) {
  // CARD_DB entry for OP14-060 Doflamingo doesn't actually set an
  // affiliation field — we just overwrite it directly on the existing
  // leader object for test purposes. Same shortcut used in the Lucky
  // Roux test below.
  game.players[pid].leader.affiliation = 'Donquixote Pirates';
}

test('Baby 5 — useNewPipeline flag + full chain (trash cost → leader gate → addDon active)', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const src = srv.CARD_DB.find(c => c.id === 'OP10-076');
  assert.equal(src.useNewPipeline, true);

  anchorDonLeader(game, p1);
  const baby5 = { ...src, uid: 'baby5-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(baby5);
  // Give something to discard.
  const fodder = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fod-1' };
  game.players[p1].hand = [fodder];
  const donDeckBefore   = game.players[p1].donDeck;
  const donActiveBefore = game.players[p1].donActive;

  srv.runPipeline('onPlay', game, p1, baby5);
  assert.ok(game.trashFromHandWindow, 'cost window opens');

  srv.handleAction(roomId, p1, { type: 'TRASH_FROM_HAND_RESOLVE', cardUids: ['fod-1'] });
  assert.equal(game.trashFromHandWindow, null);
  assert.equal(game.players[p1].donDeck,   donDeckBefore   - 1, 'addDon fired after cost');
  assert.equal(game.players[p1].donActive, donActiveBefore + 1, 'DON goes to active (state:active)');
});

test('Baby 5 — wrong leader affiliation → condition fails, no DON added even after cost paid', () => {
  const { roomId, p1, game } = twoPlayerGame();
  // p1 default leader is Anna of Brittany (Duchess of Brittany) — wrong
  // type for Baby 5's Donquixote Pirates gate.
  assert.match(game.players[p1].leader.affiliation || '', /Duchess of Brittany/);
  const baby5 = { ...srv.CARD_DB.find(c => c.id === 'OP10-076'), uid: 'baby5-2', rested: false, attachedDon: 0 };
  game.players[p1].field.push(baby5);
  game.players[p1].hand = [{ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fod-2' }];
  const donDeckBefore = game.players[p1].donDeck;
  // Condition check happens BEFORE cost — so the cost window never opens.
  srv.runPipeline('onPlay', game, p1, baby5);
  assert.ok(!game.trashFromHandWindow, 'no cost window when condition fails');
  assert.equal(game.players[p1].donDeck, donDeckBefore);
});

// ─── Bullet String (OP14-078) — counter: returnDon + leader gate + powerBuff ───

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

test('Bullet String — useNewPipeline flag + USE_COUNTER → DON cost + auto-applies +4000 to defender', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const src = srv.CARD_DB.find(c => c.id === 'OP14-078');
  assert.equal(src.useNewPipeline, true);

  anchorDonLeader(game, p2);  // defender needs Donquixote leader
  armCounterStep(game, p1, p2);
  const bs = { ...src, uid: 'bs-1' };
  game.players[p2].hand = [bs];
  game.players[p2].donActive = 5;  // covers event cost 2 + returnDon 1

  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: 'bs-1' });
  assert.ok(game.donReturnWindow, 'DON return window opened for -1 cost');
  assert.equal(game.donReturnWindow.required, 1);

  srv.handleAction(roomId, p2, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  // After cost paid, powerBuff fires. COUNTER_STEP auto-apply lands
  // the +4000 on battleState.targetUid (defender leader) as a
  // tempPowerEffect with kind='battle'; picker is skipped.
  assert.equal(game.donReturnWindow, null);
  assert.ok(!game.powerBuffTargetWindow, 'picker skipped — auto-applied');
  const tp = (game.tempPowerEffects || []).find(
    e => e.targetUid === game.players[p2].leader.uid && e.amount === 4000
  );
  assert.ok(tp, '+4000 tempPowerEffect landed on defender leader');
  assert.equal(tp.kind, 'battle');
});

// ─── Lucky Roux (OP09-015) — onKO leader gate + koTarget by power ───

test('Lucky Roux — useNewPipeline + onKO with Red Hair leader opens koTarget picker', () => {
  const { p1, p2, game } = twoPlayerGame();
  const src = srv.CARD_DB.find(c => c.id === 'OP09-015');
  assert.equal(src.useNewPipeline, true);
  // Swap p2's leader to Red Hair Pirates so the gate passes.
  // Constable Jack leader has affiliation 'Holy Roman Empire' — doesn't match.
  // ST15-002 Edward Newgate is Red — but its affiliation isn't Red Hair.
  // Use a shortcut: directly set affiliation to "Red Hair Pirates".
  game.players[p2].leader.affiliation = 'Red Hair Pirates';
  const roux = { ...src, uid: 'roux-1' };
  game.players[p2].trash.push(roux);
  // Give p1 (opponent) two characters — one qualifying (power ≤ 6000),
  // one not.
  game.players[p1].field.push(
    { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'opp-lo', power: 4000, rested: false, attachedDon: 0 },
    { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'opp-hi', power: 9000, rested: false, attachedDon: 0 },
  );
  srv.triggerOnKO(game, p2, roux, p1);
  assert.ok(game.koTargetWindow, 'KO window opened');
  assert.deepEqual(game.koTargetWindow.candidateUids, ['opp-lo'],
    'only ≤6000-power candidate qualifies');
});

test('Lucky Roux — wrong leader affiliation → no KO window', () => {
  const { p1, p2, game } = twoPlayerGame();
  // p2's leader is Constable Jack (Holy Roman Empire) — not Red Hair.
  const roux = { ...srv.CARD_DB.find(c => c.id === 'OP09-015'), uid: 'roux-no' };
  game.players[p2].trash.push(roux);
  game.players[p1].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-x', power: 4000, rested: false, attachedDon: 0 });
  srv.triggerOnKO(game, p2, roux, p1);
  assert.ok(!game.koTargetWindow, 'no window when leader gate fails');
});
