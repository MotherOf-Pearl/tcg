// Track P Phase 3 — hasBlocker reads conditionalKeyword passives
// (PRB02-015 Shiryu leader-type; Vivi ownTrashCountMin).
// Track P Phase 4 — PLAY_CARD deducts handPlayCostFor which subtracts
// any handCostDiscount passives (Uta ST23-001; Shanks ST23-002).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── P-3: conditional [Blocker] grants ─────────────────────────────────

test('hasBlocker: Vivi OP05-086 gains [Blocker] when trash ≥10 cards', () => {
  const { p1, game } = twoPlayerGame();
  const vivi = { ...srv.CARD_DB.find(c => c.id === 'OP05-086'),
    uid: 'vi-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(vivi);

  // Trash below 10: no blocker.
  while (game.players[p1].trash.length < 9) {
    game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
      uid: 'tr-' + game.players[p1].trash.length });
  }
  assert.equal(srv.hasBlocker(vivi, game), false);

  // Add 1 more → 10 cards → blocker granted.
  game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'tr-10th' });
  assert.equal(srv.hasBlocker(vivi, game), true);
});

test('hasBlocker: Shiryu PRB02-015 gains [Blocker] with Blackbeard leader', () => {
  const { p1, game } = twoPlayerGame();
  const shiryu = { ...srv.CARD_DB.find(c => c.id === 'PRB02-015'),
    uid: 'sh-1', rested: false, attachedDon: 0 };
  game.players[p1].field.push(shiryu);

  // Non-matching leader → no blocker.
  assert.equal(srv.hasBlocker(shiryu, game), false);

  // Matching leader → blocker granted.
  game.players[p1].leader.affiliation = 'Blackbeard Pirates';
  assert.equal(srv.hasBlocker(shiryu, game), true);
});

// ─── P-4: hand-cost discounts ──────────────────────────────────────────

test('handPlayCostFor: Uta ST23-001 pays -4 cost when own char ≥10k power exists', () => {
  const { p1, game } = twoPlayerGame();
  const uta = srv.CARD_DB.find(c => c.id === 'ST23-001');
  const base = uta.cost;

  // No 10k+ character on field → full cost.
  assert.equal(srv.handPlayCostFor(game.players[p1], uta, game), base);

  // Add a 10k+ power character.
  const strong = { ...srv.CARD_DB.find(c => c.id === 'OP06-007'),
    uid: 'u-strong', attachedDon: 0, power: 12000 };
  game.players[p1].field.push(strong);
  assert.equal(srv.handPlayCostFor(game.players[p1], uta, game),
    Math.max(0, base - 4));
});

test('handPlayCostFor: Shanks ST23-002 pays -3 cost when opp char ≥8k base power exists', () => {
  const { p1, p2, game } = twoPlayerGame();
  const sh = srv.CARD_DB.find(c => c.id === 'ST23-002');
  const base = sh.cost;

  // No opponent 8k+ base power → full cost.
  assert.equal(srv.handPlayCostFor(game.players[p1], sh, game), base);

  // Add opponent character with 9000 base power.
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'sh-opp', attachedDon: 0, power: 9000 };
  game.players[p2].field.push(big);
  assert.equal(srv.handPlayCostFor(game.players[p1], sh, game),
    Math.max(0, base - 3));
});

// ─── PLAY_CARD honours the discount ────────────────────────────────────

test('PLAY_CARD with Uta discount: DON deduction uses effective cost', () => {
  const { roomId, p1, game } = twoPlayerGame();
  // Put a 10k+ own character so discount applies.
  const strong = { ...srv.CARD_DB.find(c => c.id === 'OP06-007'),
    uid: 'pc-strong', attachedDon: 0, power: 12000 };
  game.players[p1].field.push(strong);
  // Put Uta in hand.
  const utaCard = { ...srv.CARD_DB.find(c => c.id === 'ST23-001'),
    uid: 'pc-uta' };
  game.players[p1].hand.push(utaCard);
  // Set donActive to effective cost exactly (base - 4) so any bug shows.
  const eff = srv.handPlayCostFor(game.players[p1], utaCard, game);
  game.players[p1].donActive = eff;
  game.players[p1].donRested = 0;
  game.phase = 'MAIN';
  game.activePlayer = p1;

  srv.handleAction(roomId, p1, { type: 'PLAY_CARD', cardUid: 'pc-uta' });
  // Uta should now be on field (played successfully).
  assert.ok(game.players[p1].field.find(c => c.uid === 'pc-uta'));
  assert.equal(game.players[p1].donActive, 0);
  assert.equal(game.players[p1].donRested, eff);
});
