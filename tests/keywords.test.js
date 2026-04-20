// Keyword detector tests. hasBlocker / hasRush / hasDoubleAttack /
// hasBanish are one-line .includes() checks in server.js; these tests
// lock them in so a future refactor can't quietly drop a keyword.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasBlocker, hasRush, hasDoubleAttack, hasBanish } = require('../server');

const blk = '[Blocker]';
const rus = '[Rush]';
const dbl = '[Double Attack]';
const ban = '[Banish]';

// Helpers return truthy (`true`) or falsy ('' / undefined), not strict
// booleans. Tests use ok()/!ok() to stay compatible with that contract.
test('hasBlocker — truthy when [Blocker] present, falsy otherwise', () => {
  assert.ok(hasBlocker({ ability: blk }));
  assert.ok(hasBlocker({ ability: '[On Play] ' + blk + ' Draw 1 card.' }));
  assert.ok(!hasBlocker({ ability: '' }));
  assert.ok(!hasBlocker({ ability: '[Rush]' }));
  assert.ok(!hasBlocker({ ability: undefined }));
});

test('hasRush — truthy only when [Rush] present', () => {
  assert.ok(hasRush({ ability: rus }));
  assert.ok(hasRush({ ability: blk + ' ' + rus }));
  assert.ok(!hasRush({ ability: blk }));
  assert.ok(!hasRush({ ability: '' }));
});

test('hasDoubleAttack — truthy only when [Double Attack] present', () => {
  assert.ok(hasDoubleAttack({ ability: dbl }));
  assert.ok(!hasDoubleAttack({ ability: blk }));
  assert.ok(!hasDoubleAttack({ ability: 'Deal double damage' }));
});

test('hasBanish — truthy only when [Banish] present', () => {
  assert.ok(hasBanish({ ability: ban }));
  assert.ok(!hasBanish({ ability: blk + ' ' + dbl }));
});
