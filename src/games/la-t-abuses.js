const PENALTY_THRESHOLD = 10;
const GAME_TTL = 86400;

const DIFFICULTY_POINTS = {
  facile: 1,
  moyen: 2,
  difficile: 3,
  extreme: 5,
};

const GAME_STATUS = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  ENDED: 'ended',
};

const ROOM_PREFIX = 'game';

function redisKey(...parts) {
  return parts.join(':');
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function getInitialState(hostId, hostName, variantRules = []) {
  return {
    id: generateCode(),
    status: GAME_STATUS.WAITING,
    players: [{ id: hostId, name: hostName, penaltyPoints: 0 }],
    turnOrder: [hostId],
    currentTurnIndex: 0,
    currentQuestion: null,
    currentGuess: null,
    lastGuessValue: null,
    lastGuesserId: null,
    variantRules,
    penaltyThreshold: PENALTY_THRESHOLD,
    hostId,
    createdAt: Date.now(),
    logs: [],
  };
}

class LaTabusesGame {
  constructor(redis) {
    this.redis = redis;
  }

  async createGame(hostId, hostName, variantRules) {
    let state, key;
    for (let attempt = 0; attempt < 10; attempt++) {
      state = getInitialState(hostId, hostName, variantRules);
      key = redisKey(ROOM_PREFIX, state.id);
      const exists = await this.redis.exists(key);
      if (!exists) break;
    }
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

  async joinGame(gameId, playerId, playerName) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.WAITING) throw new Error('Partie déjà commencée');
    if (state.players.find((p) => p.id === playerId)) return state;
    if (state.players.length >= 10) throw new Error('Partie complète (max 10 joueurs)');

    state.players.push({ id: playerId, name: playerName, penaltyPoints: 0 });
    state.turnOrder.push(playerId);
    await this.saveGame(state);
    return state;
  }

  async leaveGame(gameId, playerId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');

    state.players = state.players.filter((p) => p.id !== playerId);
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);

    if (state.players.length === 0) {
      await this.redis.del(redisKey(ROOM_PREFIX, gameId));
      return null;
    }

    if (state.hostId === playerId) {
      state.hostId = state.players[0]?.id || null;
    }

    if (state.status === GAME_STATUS.PLAYING) {
      if (state.turnOrder.length < 2) {
        state.status = GAME_STATUS.ENDED;
        state.logs.push({ type: 'gameEnded', reason: 'Pas assez de joueurs' });
      } else {
        state.currentTurnIndex = state.currentTurnIndex % state.turnOrder.length;
      }
    }

    await this.saveGame(state);
    return state;
  }

  async startGame(gameId, question) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.players.length < 2) throw new Error('Minimum 2 joueurs requis');

    state.status = GAME_STATUS.PLAYING;
    state.currentQuestion = question;
    state.currentGuess = null;
    state.lastGuessValue = null;
    state.lastGuesserId = null;
    state.currentTurnIndex = 0;
    state.logs.push({ type: 'gameStarted', question: question.text, difficulty: question.difficulty });

    await this.saveGame(state);
    return state;
  }

  getPenaltyValue(difficulty) {
    return DIFFICULTY_POINTS[difficulty] || 1;
  }

  async submitGuess(gameId, playerId, guessValue) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.PLAYING) throw new Error('Partie pas en cours');

    const player = state.players.find((p) => p.id === playerId);
    if (player.penaltyPoints >= state.penaltyThreshold) {
      throw new Error('Vous avez déjà perdu');
    }

    const currentPlayerId = state.turnOrder[state.currentTurnIndex];
    if (playerId !== currentPlayerId) throw new Error("Pas votre tour");

    guessValue = parseInt(guessValue);
    if (isNaN(guessValue) || guessValue < 0) throw new Error('Valeur invalide');

    if (state.lastGuessValue !== null && guessValue <= state.lastGuessValue) {
      throw new Error(`La valeur doit être supérieure à ${state.lastGuessValue}`);
    }

    state.lastGuessValue = guessValue;
    state.lastGuesserId = playerId;
    state.logs.push({ type: 'guess', playerId, guessValue });

    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
    await this.saveGame(state);
    return { state, penalty: false };
  }

  async challengeGuess(gameId, playerId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.PLAYING) throw new Error('Partie pas en cours');
    if (state.lastGuessValue === null) throw new Error('Aucune supposition à challenger');
    if (playerId === state.lastGuesserId) throw new Error('Vous ne pouvez pas vous challenger vous-même');

    const currentPlayerId = state.turnOrder[state.currentTurnIndex];
    if (playerId !== currentPlayerId) throw new Error("Seul le joueur actuel peut challenger");

    const guess = state.lastGuessValue;
    const answer = state.currentQuestion.answer;
    const pts = this.getPenaltyValue(state.currentQuestion.difficulty);
    const guesser = state.players.find((p) => p.id === state.lastGuesserId);
    const challenger = state.players.find((p) => p.id === playerId);

    let loser;
    if (guess >= answer) {
      loser = guesser;
    } else {
      loser = challenger;
    }

    loser.penaltyPoints += pts;
    state.logs.push({
      type: 'challenge',
      challengerId: playerId,
      guessedId: state.lastGuesserId,
      guessValue: guess,
      answer,
      pts,
      loserId: loser.id,
      total: loser.penaltyPoints,
      difficulty: state.currentQuestion.difficulty,
    });

    let ended = false;
    if (loser.penaltyPoints >= state.penaltyThreshold) {
      state.status = GAME_STATUS.ENDED;
      state.logs.push({ type: 'gameEnded', reason: `${loser.name} a perdu avec ${loser.penaltyPoints} pts` });
      ended = true;
    }

    if (!ended) {
      await this.nextQuestion(state);
    }

    await this.saveGame(state);
    return { state, guess, answer, pts, loserId: loser.id, ended };
  }

  async doubleDown(gameId, playerId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (!this.hasVariant(state, 'double')) throw new Error('Variante non activée');
    if (state.lastGuesserId !== playerId) throw new Error('Seul le dernier joueur peut doubler');

    const guess = state.lastGuessValue;
    const answer = state.currentQuestion.answer;
    const pts = this.getPenaltyValue(state.currentQuestion.difficulty);
    const guesser = state.players.find((p) => p.id === playerId);

    if (guess >= answer) {
      guesser.penaltyPoints += pts * 2;
      state.logs.push({
        type: 'doubleDown',
        playerId,
        result: 'guesserLost',
        pts: pts * 2,
        total: guesser.penaltyPoints,
      });
    } else {
      guesser.penaltyPoints += pts;
      state.logs.push({
        type: 'doubleDown',
        playerId,
        result: 'guesserWon',
        pts,
        total: guesser.penaltyPoints,
      });
    }

    if (guesser.penaltyPoints >= state.penaltyThreshold) {
      state.status = GAME_STATUS.ENDED;
      state.logs.push({ type: 'gameEnded', reason: `${guesser.name} a perdu` });
    } else {
      await this.nextQuestion(state);
    }

    await this.saveGame(state);
    return { state, answer, pts };
  }

  async pilePoil(gameId, playerId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (!this.hasVariant(state, 'pilepoil')) throw new Error('Variante non activée');
    if (state.lastGuessValue === null) throw new Error('Aucune supposition');
    if (playerId === state.lastGuesserId) throw new Error('Vous ne pouvez pas sur votre propre tour');

    const answer = state.currentQuestion.answer;

    if (state.lastGuessValue === answer) {
      state.logs.push({
        type: 'pilePoil',
        playerId,
        result: 'success',
        answer,
      });
    } else {
      const player = state.players.find((p) => p.id === playerId);
      player.penaltyPoints = state.penaltyThreshold;
      state.status = GAME_STATUS.ENDED;
      state.logs.push({
        type: 'pilePoil',
        playerId,
        result: 'fail',
        answer,
      });
      state.logs.push({ type: 'gameEnded', reason: `${player.name} a perdu (Pile-Poil!)` });
    }

    if (state.status !== GAME_STATUS.ENDED) {
      await this.nextQuestion(state);
    }

    await this.saveGame(state);
    return { state, answer };
  }

  async nextQuestion(state) {
    state.currentQuestion = null;
    state.currentGuess = null;
    state.lastGuessValue = null;
    state.lastGuesserId = null;
  }

  async setQuestion(gameId, question) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    state.currentQuestion = question;
    state.lastGuessValue = null;
    state.lastGuesserId = null;
    state.currentTurnIndex = 0;
    state.logs.push({ type: 'newQuestion', question: question.text, difficulty: question.difficulty });
    await this.saveGame(state);
    return state;
  }

  hasVariant(state, variant) {
    return state.variantRules && state.variantRules.includes(variant);
  }
}

module.exports = { LaTabusesGame, GAME_STATUS, PENALTY_THRESHOLD, ROOM_PREFIX, DIFFICULTY_POINTS };
