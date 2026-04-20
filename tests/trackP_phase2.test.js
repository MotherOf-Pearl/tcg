// Track P Phase 2 — wire passive power modifiers into effectivePowerOf.
// Replaces the Jesse-specific regex hack with a typed walk of
// PASSIVE_EFFECTS; adds Chopper's scopedPowerBuff and OP09-004 Shanks'
// globalPowerModifier. Burgess' scaledPowerBuff trash-count variant
// also participates.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Jesse the Jester — scaledPowerBuff by events in trash ─────────────

test('Jesse: +1000 per 2 events in own trash on your turn, DON attached, matching leader', () => {
  const { p1, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Duchess of Brittany';
  const jesse = { ...srv.CARD_DB.find(c => c.id === 'OP01-083'),
    uid: 'je-1', rested: false, attachedDon: 1 };
  game.players[p1].field.push(jesse);
  // Populate trash with 4 events → +2000.
  for (let i = 0; i < 4; i++) {
    game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
      uid: 'trash-e' + i });
  }
  game.activePlayer = p1;
  assert.equal(srv.effectivePowerOf(jesse, game), 3000 /* base */ + 1000 /* attachedDon */ + 2000);
});

test('Jesse: no buff if DON not attached', () => {
  const { p1, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Duchess of Brittany';
  const jesse = { ...srv.CARD_DB.find(c => c.id === 'OP01-083'),
    uid: 'je-2', attachedDon: 0 };
  game.players[p1].field.push(jesse);
  game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
    uid: 'tr-a' });
  game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
    uid: 'tr-b' });
  game.activePlayer = p1;
  assert.equal(srv.effectivePowerOf(jesse, game), 3000);
});

test('Jesse: no buff on opponent\'s turn (scope: yourTurn)', () => {
  const { p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Duchess of Brittany';
  const jesse = { ...srv.CARD_DB.find(c => c.id === 'OP01-083'),
    uid: 'je-3', attachedDon: 1 };
  game.players[p1].field.push(jesse);
  for (let i = 0; i < 4; i++) {
    game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-026'),
      uid: 'trs' + i });
  }
  game.activePlayer = p2;
  assert.equal(srv.effectivePowerOf(jesse, game), 3000 + 1000 /* don */);
});

// ─── Burgess — scaled by total trash cards ─────────────────────────────

test('Burgess: +1000 per 4 cards in trash with Blackbeard leader', () => {
  const { p1, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Blackbeard Pirates';
  const burgess = { ...srv.CARD_DB.find(c => c.id === 'OP09-086'),
    uid: 'bg-1', attachedDon: 0 };
  game.players[p1].field.push(burgess);
  // 9 cards in trash → floor(9/4)=2 * 1000 = 2000.
  for (let i = 0; i < 9; i++) {
    game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
      uid: 'bg-t' + i });
  }
  game.activePlayer = p1;
  const c = srv.CARD_DB.find(c => c.id === 'OP09-086');
  assert.equal(srv.effectivePowerOf(burgess, game), c.power + 2000);
});

// ─── Chopper — scopedPowerBuff opponent's turn ─────────────────────────

test('Chopper: +2000 power only on opponent\'s turn', () => {
  const { p1, p2, game } = twoPlayerGame();
  const chopper = { ...srv.CARD_DB.find(c => c.id === 'OP10-011'),
    uid: 'ch-1', attachedDon: 0 };
  game.players[p1].field.push(chopper);
  const basePower = srv.CARD_DB.find(c => c.id === 'OP10-011').power;

  game.activePlayer = p1;  // our turn
  assert.equal(srv.effectivePowerOf(chopper, game), basePower);

  game.activePlayer = p2;  // opponent's turn
  assert.equal(srv.effectivePowerOf(chopper, game), basePower + 2000);
});

// ─── OP09-004 Shanks — globalPowerModifier -1000 to opp characters ─────

test('OP09-004 Shanks: opponent\'s characters get -1000 power while Shanks on field', () => {
  const { p1, p2, game } = twoPlayerGame();
  const shanks = { ...srv.CARD_DB.find(c => c.id === 'OP09-004'),
    uid: 'sh-1', attachedDon: 0 };
  game.players[p1].field.push(shanks);
  // Opponent character.
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-v', attachedDon: 0 };
  game.players[p2].field.push(victim);
  const baseVic = srv.CARD_DB.find(c => c.id === 'OP01-101').power;
  assert.equal(srv.effectivePowerOf(victim, game), baseVic - 1000);
});

test('OP09-004 Shanks: effect dies when Shanks leaves the field', () => {
  const { p1, p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-v2', attachedDon: 0 };
  game.players[p2].field.push(victim);
  const base = srv.CARD_DB.find(c => c.id === 'OP01-101').power;
  // No Shanks on p1 field.
  assert.equal(srv.effectivePowerOf(victim, game), base);
});
