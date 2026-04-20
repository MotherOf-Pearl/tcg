// Shared helpers for the node --test harness. All tests go through a mock
// client wiring: tests put a fake WebSocket-like object into the server's
// `clients` Map, then call handleAction() and inspect what would have been
// sent. No real WebSocket, no port binding — PHASE 2 is unit/integration,
// not E2E.
const srv = require('../server');

function resetWorld() {
  srv.rooms.clear();
  srv.clients.clear();
}

// Creates a fake client with a `sent` inbox. Test code calls drain(client)
// to pop messages it's expecting to have received.
function mockClient(id) {
  const sent = [];
  const ws = {
    readyState: 1,
    send: (s) => sent.push(JSON.parse(s)),
    _sent: sent,
  };
  srv.clients.set(id, ws);
  return ws;
}

// Builds a 2-player game with deterministic decks + mock clients and puts
// it in the rooms map. Returns { roomId, p1, p2, game, clients }. Fixes
// activePlayer to p1 so the random coin-flip in createGame doesn't make
// tests non-deterministic.
function twoPlayerGame({ p1deck, p2deck } = {}) {
  const p1 = 'p1-uuid';
  const p2 = 'p2-uuid';
  const p1ws = mockClient(p1);
  const p2ws = mockClient(p2);
  const game = srv.createGame(p1, p2,
    p1deck || srv.PRESET_DECKS['Anna of Brittany'],
    p2deck || srv.PRESET_DECKS['Constable Jack']);
  // Pin firstPlayer/activePlayer to p1 so DON/turn tests are deterministic.
  game.firstPlayer  = p1;
  game.activePlayer = p1;
  const roomId = 'TESTROOM';
  srv.rooms.set(roomId, { id: roomId, players: [p1, p2], decks: {}, game });
  return { roomId, p1, p2, p1ws, p2ws, game };
}

// Pulls messages of a given type from a mock client's inbox.
function messagesOfType(ws, type) {
  return ws._sent.filter(m => m && m.type === type);
}

module.exports = { srv, resetWorld, mockClient, twoPlayerGame, messagesOfType };
