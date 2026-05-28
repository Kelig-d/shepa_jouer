const { words: wordPool } = require('../../questions/vg-crossword.js');
const GAME_TTL = 86400;
const GAME_STATUS = { WAITING: 'waiting', PLAYING: 'playing', ENDED: 'ended' };
const ROOM_PREFIX = 'game';
const GRID_SIZE = 12;
const WORDS_PER_GRID = 7;
const TIME_LIMIT = 300;
const SECRET_WORDS = ['CROSSPLAY', 'GAMING', 'ESPORTS', 'STREAM', 'PIXEL', 'BOSS', 'QUEST', 'MAP', 'LOOT', 'SKILL', 'RANKED', 'REVIVE'];

function redisKey(...parts) { return parts.join(':'); }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function generateGrid(playerSeed) {
  const rng = mulberry32(playerSeed);
  const selected = shuffle(wordPool).slice(0, WORDS_PER_GRID + 3);

  let attempts = 0;
  while (attempts < 20) {
    const result = tryPlaceWords(selected.slice(0, WORDS_PER_GRID), rng);
    if (result) return result;
    attempts++;
  }
  return tryPlaceWords(selected.slice(0, Math.min(5, selected.length)), rng) || fallbackGrid();
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function tryPlaceWords(words, rng) {
  const grid = Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => null));
  const placed = [];

  const first = words[0];
  const col = Math.floor(rng() * (GRID_SIZE - first.answer.length - 2)) + 1;
  const row = Math.floor(rng() * (GRID_SIZE - 3)) + 1;
  for (let i = 0; i < first.answer.length; i++) {
    grid[row][col + i] = { letter: first.answer[i], wordIndex: 0, isAcross: true };
  }
  placed.push({ word: first, row, col, isAcross: true, index: 0 });

  const isAcross = [false, true, false, true, false, true, false];
  for (let wi = 1; wi < words.length; wi++) {
    const word = words[wi];
    const across = isAcross[wi] !== undefined ? isAcross[wi] : wi % 2 === 0;
    const candidates = [];

    for (let li = 0; li < word.answer.length; li++) {
      const letter = word.answer[li];
      for (let pi = 0; pi < placed.length; pi++) {
        const p = placed[pi];
        for (let ci = 0; ci < p.word.answer.length; ci++) {
          if (p.word.answer[ci] !== letter) continue;

          let r, c;
          if (across) {
            r = p.row - li;
            c = p.col + ci - (p.isAcross ? 0 : li);
            if (p.isAcross) r = p.row - li;
            else r = p.row + ci - li;
            if (p.isAcross) c = p.col + ci;
            else c = p.col - li;
          } else {
            r = p.row + ci - (p.isAcross ? li : 0);
            c = p.col - li;
            if (p.isAcross) r = p.row - li;
            else r = p.row + ci;
            if (p.isAcross) c = p.col + ci - li;
            else c = p.col - li;
          }

          if (r < 1 || r + (across ? 0 : word.answer.length - 1) >= GRID_SIZE - 1) continue;
          if (c < 1 || c + (across ? word.answer.length - 1 : 0) >= GRID_SIZE - 1) continue;

          let valid = true;
          for (let i = 0; i < word.answer.length; i++) {
            const cr = across ? r : r + i;
            const cc = across ? c + i : c;
            const existing = grid[cr][cc];
            if (existing && existing.letter !== word.answer[i]) { valid = false; break; }
            if (existing && existing.wordIndex === wi) { valid = false; break; }
          }
          if (!valid) continue;

          candidates.push({ row: r, col: c, across });
        }
      }
    }

    if (candidates.length === 0) continue;

    const chosen = candidates[Math.floor(rng() * candidates.length)];
    for (let i = 0; i < word.answer.length; i++) {
      const r = chosen.across ? chosen.row : chosen.row + i;
      const c = chosen.across ? chosen.col + i : chosen.col;
      if (!grid[r][c]) {
        grid[r][c] = { letter: word.answer[i], wordIndex: wi, isAcross: chosen.across };
      }
    }
    placed.push({ word, row: chosen.row, col: chosen.col, isAcross: chosen.across, index: wi });
  }

  if (placed.length < 4) return null;

  const secretWord = SECRET_WORDS[Math.floor(rng() * SECRET_WORDS.length)];
  const secretCells = [];
  const swChars = secretWord.split('');
  let swIdx = 0;
  for (let r = 1; r < GRID_SIZE - 1 && swIdx < swChars.length; r++) {
    for (let c = 1; c < GRID_SIZE - 1 && swIdx < swChars.length; c++) {
      if (grid[r][c] && !secretCells.some(s => s.row === r && s.col === c)) {
        grid[r][c].isSecret = true;
        grid[r][c].secretLetter = swChars[swIdx];
        secretCells.push({ row: r, col: c, letter: swChars[swIdx], index: swIdx });
        swIdx++;
      }
    }
  }

  const numbered = [];
  placed.forEach((p) => {
    const num = numbered.length + 1;
    numbered.push({ number: num, row: p.row, col: p.col, isAcross: p.isAcross, answer: p.word.answer, clue: p.word.clue, wordIndex: p.index });
    if (!grid[p.row][p.col].number) grid[p.row][p.col].number = num;
  });

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c]) grid[r][c] = { letter: null, isBlocked: true, number: null };
      else grid[r][c].isBlocked = false;
    }
  }

  return { grid: grid.map(row => row.map(c => ({ ...c }))), words: numbered, secretWord, secretCells };
}

function fallbackGrid() {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ letter: null, isBlocked: true, number: null })));
  const words = [
    { clue: "Jeu avec des cubes", answer: "MINECRAFT", row: 2, col: 1, isAcross: true, number: 1, wordIndex: 0 },
    { clue: "Hérisson bleu", answer: "SONIC", row: 1, col: 2, isAcross: false, number: 2, wordIndex: 1 },
    { clue: "Plombier moustachu", answer: "MARIO", row: 5, col: 2, isAcross: true, number: 3, wordIndex: 2 },
    { clue: "Console hybride", answer: "SWITCH", row: 2, col: 5, isAcross: false, number: 4, wordIndex: 3 },
  ];
  words.forEach(w => {
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.isAcross ? w.row : w.row + i;
      const c = w.isAcross ? w.col + i : w.col;
      grid[r][c] = { letter: w.answer[i], isBlocked: false, number: i === 0 ? w.number : null };
    }
  });
  return { grid, words, secretWord: 'GAMING', secretCells: [] };
}

class MotCroiseGame {
  constructor(redis) {
    this.redis = redis;
  }

  async createGame(hostId, hostName, hostAvatar, variantRules, nsfwLevel, isSolo = false, soloPlayerNames = []) {
    let state, key;
    const playerSeed = Date.now();
    for (let attempt = 0; attempt < 10; attempt++) {
      state = {
        id: generateCode(),
        gameType: 'mot-croise',
        status: GAME_STATUS.WAITING,
        isSolo,
        players: [{ id: hostId, name: hostName, avatar: hostAvatar || '🧩', score: 0, grid: null, completedWords: [], secretGuessed: false, finishTime: null }],
        turnOrder: [hostId],
        currentTurnIndex: 0,
        hostId,
        timeLimit: TIME_LIMIT,
        startTime: null,
        logs: [],
        createdAt: Date.now(),
      };
      key = redisKey(ROOM_PREFIX, state.id);
      const exists = await this.redis.exists(key);
      if (!exists) break;
    }

    if (isSolo && soloPlayerNames.length > 0) {
      soloPlayerNames.forEach((name, i) => {
        const id = 'solo-' + generateCode();
        const seed = playerSeed + i + 1;
        const gridData = generateGrid(seed);
        state.players.push({ id, name: name.trim(), avatar: '🧩', score: 0, grid: gridData, completedWords: [], secretGuessed: false, finishTime: null });
        state.turnOrder.push(id);
      });
    }

    const hostGrid = generateGrid(playerSeed);
    state.players[0].grid = hostGrid;

    await this.redis.set(key, JSON.stringify(state), 'EX', GAME_TTL);
    return state;
  }

  async getGame(gameId) {
    const key = redisKey(ROOM_PREFIX, gameId);
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async saveGame(state) {
    const key = redisKey(ROOM_PREFIX, state.id);
    await this.redis.set(key, JSON.stringify(state), 'EX', GAME_TTL);
  }

  async joinGame(gameId, playerId, playerName, playerAvatar) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.WAITING) throw new Error('Partie déjà commencée');
    if (state.players.find(p => p.id === playerId)) return state;
    if (state.players.length >= 12) throw new Error('Partie complète (max 12 joueurs)');
    const seed = Date.now() + state.players.length;
    const gridData = generateGrid(seed);
    state.players.push({ id: playerId, name: playerName, avatar: playerAvatar || '🧩', score: 0, grid: gridData, completedWords: [], secretGuessed: false, finishTime: null });
    state.turnOrder.push(playerId);
    await this.saveGame(state);
    return state;
  }

  async leaveGame(gameId, playerId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    state.players = state.players.filter(p => p.id !== playerId);
    state.turnOrder = state.turnOrder.filter(id => id !== playerId);
    if (state.players.length === 0) {
      await this.redis.del(redisKey(ROOM_PREFIX, gameId));
      return null;
    }
    if (state.hostId === playerId) state.hostId = state.players[0]?.id || null;
    await this.saveGame(state);
    return state;
  }

  async startGame(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.players.length < 2 && !state.isSolo) throw new Error('Minimum 2 joueurs requis');
    state.status = GAME_STATUS.PLAYING;
    state.startTime = Date.now();
    state.logs.push({ type: 'gameStarted' });
    await this.saveGame(state);
    return state;
  }

  async submitWord(gameId, playerId, wordIndex, answer) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.PLAYING) throw new Error('Partie pas en cours');

    const player = state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Joueur introuvable');
    if (!player.grid) throw new Error('Grille non trouvée');
    if (player.completedWords.includes(wordIndex)) throw new Error('Mot déjà trouvé');

    const word = player.grid.words.find(w => w.wordIndex === wordIndex);
    if (!word) throw new Error('Mot invalide');

    const correct = answer.toUpperCase().trim() === word.answer.toUpperCase();
    if (correct) {
      player.completedWords.push(wordIndex);
      const timeBonus = Math.max(0, Math.floor((state.timeLimit - (Date.now() - state.startTime) / 1000) / 10));
      const points = 100 + timeBonus;
      player.score += points;

      for (const cell of (player.grid.secretCells || [])) {
        if (cell.wordIndex === wordIndex) {
          cell.revealed = true;
        }
      }

      const allDone = player.grid.words.every(w => player.completedWords.includes(w.wordIndex));
      if (allDone) {
        player.finishTime = Date.now();
      }

      state.logs.push({ type: 'wordSolved', playerId, wordIndex, points });
    }

    await this.saveGame(state);
    return { correct, state, player };
  }

  async guessSecretWord(gameId, playerId, guess) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    const player = state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Joueur introuvable');
    if (player.secretGuessed) throw new Error('Mot secret déjà trouvé');

    const sw = player.grid.secretWord || '';
    const correct = guess.toUpperCase().trim() === sw.toUpperCase();
    if (correct) {
      player.secretGuessed = true;
      player.score += 500;
      state.logs.push({ type: 'secretFound', playerId });
    }

    await this.saveGame(state);
    return { correct, secretWord: correct ? sw : null, state };
  }

  async finishGame(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    state.status = GAME_STATUS.ENDED;
    state.logs.push({ type: 'gameEnded' });

    for (const p of state.players) {
      const revealed = (p.grid.secretCells || []).filter(c => c.revealed).length;
      const total = (p.grid.secretCells || []).length;
      if (revealed < total && !p.secretGuessed) {
        p.score -= 50;
      }
    }
    await this.saveGame(state);
    return state;
  }

  async resetGame(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    state.status = GAME_STATUS.WAITING;
    state.startTime = null;
    state.logs = [];
    for (const p of state.players) {
      p.score = 0;
      p.completedWords = [];
      p.secretGuessed = false;
      p.finishTime = null;
      const seed = Date.now() + state.players.indexOf(p);
      p.grid = generateGrid(seed);
    }
    await this.saveGame(state);
    return state;
  }
}

module.exports = { MotCroiseGame, GAME_STATUS, ROOM_PREFIX };
