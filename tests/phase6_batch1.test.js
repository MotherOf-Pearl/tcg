// Phase 6 Batch 1 — flag-flip migrations for six cleanly-parsed cards
// whose effects already map to agents built in Phases 1-5. Each test
// verifies the useNewPipeline flag and that the first window of the
// card's onPlay/eventMain pipeline opens with the expected shape.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── OP01-006 Otama — powerDebuff onPlay ────────────────────────────────

test('Otama OP01-006 flag + opens powerBuffTarget window with -2000 debuff', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-006');
  assert.equal(c.useNewPipeline, true);
  // Opponent character to debuff.
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'otama-vic', rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  const otama = { ...c, uid: 'otama-1' };
  game.players[p1].field.push(otama);
  srv.runPipeline('onPlay', game, p1, otama);
  assert.ok(game.powerBuffTargetWindow, 'window opened');
  assert.equal(game.powerBuffTargetWindow.amount, -2000);
  assert.equal(game.powerBuffTargetWindow.side, 'opponent');
  assert.deepEqual(game.powerBuffTargetWindow.candidateUids, ['otama-vic']);
});

// ─── OP09-009 Benn Beckman — koTarget onPlay (≤6000 power) ─────────────

test('Benn Beckman OP09-009 flag + opens koTargetWindow filtered by ≤6000 power', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-009');
  assert.equal(c.useNewPipeline, true);
  const low  = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bb-low', rested: false, attachedDon: 0, power: 3000 };
  const high = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'bb-high', rested: false, attachedDon: 0, power: 12000 };
  game.players[p2].field.push(low, high);
  const bb = { ...c, uid: 'bb-1' };
  game.players[p1].field.push(bb);
  srv.runPipeline('onPlay', game, p1, bb);
  assert.ok(game.koTargetWindow);
  assert.deepEqual(game.koTargetWindow.candidateUids, ['bb-low'],
    '12k-power character excluded by ≤6000 filter');
});

// ─── OP06-007 Shanks — koTarget onPlay (≤10000 power) ──────────────────

test('Shanks OP06-007 flag + opens koTargetWindow filtered by ≤10000 power', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP06-007');
  assert.equal(c.useNewPipeline, true);
  const mid  = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-mid', rested: false, attachedDon: 0, power: 8000 };
  const huge = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'sh-huge', rested: false, attachedDon: 0, power: 12000 };
  game.players[p2].field.push(mid, huge);
  const sh = { ...c, uid: 'sh-1' };
  game.players[p1].field.push(sh);
  srv.runPipeline('onPlay', game, p1, sh);
  assert.ok(game.koTargetWindow);
  assert.deepEqual(game.koTargetWindow.candidateUids, ['sh-mid']);
});

// ─── ST04-004 Chris — DON!! -1 cost → koTarget ≤4 cost ─────────────────

test('Chris ST04-004 flag + opens donReturnWindow first, then koTargetWindow', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'ST04-004');
  assert.equal(c.useNewPipeline, true);
  game.players[p1].donActive = 3;  // plenty for -1.
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ch-small', rested: false, attachedDon: 0 };  // cost 3
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'ch-big', rested: false, attachedDon: 0 };  // cost 10
  game.players[p2].field.push(small, big);
  const chris = { ...c, uid: 'ch-1' };
  game.players[p1].field.push(chris);
  srv.runPipeline('onPlay', game, p1, chris);
  assert.ok(game.donReturnWindow, 'DON cost window opened first');
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);
  assert.ok(game.koTargetWindow, 'koTarget window opened after cost paid');
  assert.deepEqual(game.koTargetWindow.candidateUids, ['ch-small']);
});

// ─── OP01-070 Anna, Master of FiFi — placeAtBottom ≤7 cost ─────────────

test('Anna Master of FiFi OP01-070 flag + opens placeAtBottomWindow ≤7 cost', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-070');
  assert.equal(c.useNewPipeline, true);
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'pab-s', rested: false, attachedDon: 0 };
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'pab-b', rested: false, attachedDon: 0 };
  game.players[p2].field.push(small, big);
  const anna = { ...c, uid: 'pab-1' };
  game.players[p1].field.push(anna);
  srv.runPipeline('onPlay', game, p1, anna);
  assert.ok(game.placeAtBottomWindow);
  assert.ok(game.placeAtBottomWindow.candidateUids.includes('pab-s'));
  assert.ok(!game.placeAtBottomWindow.candidateUids.includes('pab-b'),
    'cost-10 excluded by ≤7 filter');
});

// ─── OP01-117 Guard Off Duty — EVENT eventMain, DON!! -1 → restTarget ≤6

test('Guard Off Duty OP01-117 flag + DON cost → restTarget ≤6 cost', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP01-117');
  assert.equal(c.useNewPipeline, true);
  game.players[p1].donActive = 3;
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'gf-s', rested: false, attachedDon: 0 };  // cost 3
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'gf-b', rested: false, attachedDon: 0 };  // cost 10
  game.players[p2].field.push(small, big);

  // EVENT cards run eventMain directly — the event sits in trash after
  // play, but for this unit test we just invoke runPipeline.
  const guard = { ...c, uid: 'gf-1' };
  game.players[p1].trash.push(guard);
  srv.runPipeline('eventMain', game, p1, guard);
  assert.ok(game.donReturnWindow);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);
  assert.ok(game.restTargetWindow);
  assert.deepEqual(game.restTargetWindow.candidateUids, ['gf-s']);
});
