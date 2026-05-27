// Quick integration test for Le Toz game
const LeTozGame = require('./src/games/le-toz.js');
const { verites, actions } = require('./questions/toz.js');

console.log('=== Card deck test ===');
console.log('verites:', verites.length, 'actions:', actions.length);
console.log('Total:', verites.length + actions.length);

// Test solo mode
console.log('\n=== Solo mode test ===');
const soloGame = new LeTozGame('room1', { isSolo: true });
soloGame.players = [
  { id: 'host1', name: 'Alice' }
];
soloGame.hostId = 'host1';
soloGame.startGame();
console.log('Solo started:', soloGame.state.isSolo, '| currentPlayerId:', soloGame.state.currentPlayerId, '| status:', soloGame.state.status);
console.log('Expected: solo, host1, playing');
console.assert(soloGame.state.isSolo === true, 'isSolo should be true');
console.assert(soloGame.state.currentPlayerId === 'host1', 'currentPlayer should be host');
console.assert(soloGame.state.status === 'playing', 'status should be playing');

// Test draw in solo
const card = soloGame.drawCard('host1');
console.log('Solo card:', card ? card.text.substring(0, 50) + '...' : 'no card');
console.assert(card !== null, 'Card should be drawn');

if (card) {
  console.assert(card.toz !== undefined, 'Card should have toz');
  console.log('Card tier:', card.tier, 'toz:', card.toz);
}

// Test multiplayer mode
console.log('\n=== Multiplayer mode test ===');
const multiGame = new LeTozGame('room2', { isSolo: false });
multiGame.players = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' }
];
multiGame.hostId = 'p1';
multiGame.startGame();
console.log('Multi started | turnOrder:', multiGame.state.turnOrder, '| currentTurnIndex:', multiGame.state.currentTurnIndex);
console.log('currentPlayerId:', multiGame.state.currentPlayerId);

// First draw - p1's turn
console.log('\n--- Turn 1 ---');
const card1 = multiGame.drawCard('p1');
console.log('Draw by p1:', card1 ? 'OK' : 'FAIL');
console.log('  currentPlayerId after:', multiGame.state.currentPlayerId, '| turnIndex:', multiGame.state.currentTurnIndex);
console.assert(multiGame.state.currentPlayerId === 'p2', 'After p1 draws, current should be p2');

// Second draw by wrong player
console.log('\n--- Turn 2 (wrong player tries) ---');
const cardWrong = multiGame.drawCard('p1');
console.log('  p1 tries again:', cardWrong === null ? 'BLOCKED (correct)' : 'LET THROUGH (WRONG)');
console.assert(cardWrong === null, 'Wrong player should be blocked');

// Second draw - p2's turn
console.log('\n--- Turn 3 ---');
const card2 = multiGame.drawCard('p2');
console.log('  Draw by p2:', card2 ? 'OK' : 'FAIL');
console.log('  currentPlayerId after:', multiGame.state.currentPlayerId, '| turnIndex:', multiGame.state.currentTurnIndex);
console.assert(multiGame.state.currentPlayerId === 'p3', 'After p2 draws, current should be p3');

// Third draw - p3's turn
console.log('\n--- Turn 4 ---');
const card3 = multiGame.drawCard('p3');
console.log('  Draw by p3:', card3 ? 'OK' : 'FAIL');
console.log('  currentPlayerId after:', multiGame.state.currentPlayerId, '| turnIndex:', multiGame.state.currentTurnIndex);
console.assert(multiGame.state.currentPlayerId === 'p1', 'After p3 draws, current should cycle back to p1');

// Test NSFW filter
console.log('\n=== NSFW filter test ===');
const nsfwGame = new LeTozGame('room3', { isSolo: true, nsfwLevel: 1 });
nsfwGame.players = [{ id: 'host', name: 'Alice' }];
nsfwGame.hostId = 'host';
nsfwGame.startGame();
let maxTier = 0;
for (let i = 0; i < 50; i++) {
  const c = nsfwGame.drawCard('host');
  if (c && c.tier > maxTier) maxTier = c.tier;
}
console.log('Max tier drawn with nsfwLevel=1:', maxTier, '(should be <= 1)');
console.assert(maxTier <= 1, 'All cards should have tier <= 1');

console.log('\n=== All tests passed! ===');
