// Unit tests for the pure client-side Attack-button visibility
// predicate (client_predicates.js → shouldShowBtnAttack). Mirrors the
// server-side §6-5-6-1 gate (isAttackerOnTheirFirstTurn, server.js:3445)
// and the played-this-turn / [Rush] gate.
//
// Pre-task bug: the old client check used `game.turn === 1` which only
// covered P1's first turn. The fix reads players[pid].hasTakenFirstTurn
// instead, so P2's first turn (game-turn 2) is also gated. These cases
// pin that contract so a future regression surfaces here, not via a
// "server rejected my click" toast in prod.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldShowBtnAttack, clientIsAttackerOnTheirFirstTurn } = require('../client_predicates');

function makeGame(turn, p1HasTakenFirstTurn, p2HasTakenFirstTurn) {
  return {
    turn,
    players: {
      p1: {
        hasTakenFirstTurn: p1HasTakenFirstTurn,
        leader: { uid: 'L1', name: 'Leader 1', rested: false, ability: '' },
        field: [
          { uid: 'C1', name: 'Char 1', rested: false, playedThisTurn: false, ability: '' },
        ],
      },
      p2: {
        hasTakenFirstTurn: p2HasTakenFirstTurn,
        leader: { uid: 'L2', name: 'Leader 2', rested: false, ability: '' },
        field: [
          { uid: 'C2', name: 'Char 2', rested: false, playedThisTurn: false, ability: '' },
        ],
      },
    },
  };
}

test('P1 leader on turn 1 (P1 first turn) → false', () => {
  const game = makeGame(1, false, false);
  assert.equal(shouldShowBtnAttack(game, 'p1', 'L1'), false);
});

test('P2 leader on turn 2 (P2 first turn) → false', () => {
  // This is the case the old `game.turn === 1` check missed and the
  // user-visible Bug 1 scenario. After the fix, hasTakenFirstTurn=false
  // gates the Attack button regardless of game-turn number.
  const game = makeGame(2, true, false);
  assert.equal(shouldShowBtnAttack(game, 'p2', 'L2'), false);
});

test('P1 leader on turn 3 (past first turn) → true', () => {
  const game = makeGame(3, true, true);
  assert.equal(shouldShowBtnAttack(game, 'p1', 'L1'), true);
});

test('P2 leader on turn 4 (past first turn) → true', () => {
  const game = makeGame(4, true, true);
  assert.equal(shouldShowBtnAttack(game, 'p2', 'L2'), true);
});

test('Missing hasTakenFirstTurn flag → fail-closed false', () => {
  const game = {
    turn: 5,
    players: {
      p1: {
        leader: { uid: 'L1', name: 'Leader 1', rested: false, ability: '' },
        field: [],
      },
    },
  };
  assert.equal(shouldShowBtnAttack(game, 'p1', 'L1'), false);
  assert.equal(clientIsAttackerOnTheirFirstTurn(game, 'p1'), true);
});

test('Missing player entirely → fail-closed false', () => {
  const game = { turn: 5, players: {} };
  assert.equal(shouldShowBtnAttack(game, 'p1', 'L1'), false);
  assert.equal(clientIsAttackerOnTheirFirstTurn(game, 'p1'), true);
});

test('Rested character → false even past first turn', () => {
  const game = makeGame(3, true, true);
  game.players.p1.field[0].rested = true;
  assert.equal(shouldShowBtnAttack(game, 'p1', 'C1'), false);
});

test('Just-played non-[Rush] character → false', () => {
  const game = makeGame(3, true, true);
  game.players.p1.field[0].playedThisTurn = true;
  game.players.p1.field[0].ability = '';
  assert.equal(shouldShowBtnAttack(game, 'p1', 'C1'), false);
});

test('Just-played [Rush] character → true', () => {
  const game = makeGame(3, true, true);
  game.players.p1.field[0].playedThisTurn = true;
  game.players.p1.field[0].ability = '[Rush]';
  assert.equal(shouldShowBtnAttack(game, 'p1', 'C1'), true);
});

test('Unknown cardUid → false (defensive)', () => {
  const game = makeGame(3, true, true);
  assert.equal(shouldShowBtnAttack(game, 'p1', 'NOPE'), false);
});

test('clientIsAttackerOnTheirFirstTurn: explicit false after end-turn', () => {
  const game = makeGame(2, true, false);
  assert.equal(clientIsAttackerOnTheirFirstTurn(game, 'p1'), false);
  assert.equal(clientIsAttackerOnTheirFirstTurn(game, 'p2'), true);
});
