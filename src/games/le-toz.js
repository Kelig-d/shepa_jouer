const tozCards = require('../../questions/toz.js');
const GAME_TTL = 86400;

const GAME_STATUS = { WAITING: 'waiting', PLAYING: 'playing', ENDED: 'ended' };

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

const VERITE_CARDS = tozCards.verites;
const ACTION_CARDS = tozCards.actions;


class LeTozGame {
  constructor(redis) {
    this.redis = redis;
  }

  async createGame(hostId, hostName, hostAvatar, variantRules, nsfwLevel = 0, isSolo = false, soloPlayerNames = []) {
    let state, key;
    for (let attempt = 0; attempt < 10; attempt++) {
      state = {
        id: generateCode(),
        gameType: 'le-toz',
        status: GAME_STATUS.WAITING,
        nsfwLevel,
        isSolo,
        players: [{ id: hostId, name: hostName, avatar: hostAvatar || '🃏', penaltyPoints: 0 }],
        turnOrder: [hostId],
        currentTurnIndex: 0,
        currentCard: null,
        currentPlayerId: null,
        hostId,
        logs: [],
        createdAt: Date.now(),
      };
      key = redisKey(ROOM_PREFIX, state.id);
      const exists = await this.redis.exists(key);
      if (!exists) break;
    }
    if (isSolo && soloPlayerNames.length > 0) {
      for (const name of soloPlayerNames) {
        const id = 'solo-' + generateCode();
        state.players.push({ id, name: name.trim(), avatar: '🃏', penaltyPoints: 0 });
        state.turnOrder.push(id);
      }
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

  async joinGame(gameId, playerId, playerName, playerAvatar) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.WAITING) throw new Error('Partie déjà commencée');
    if (state.players.find((p) => p.id === playerId)) return state;
    if (state.players.length >= 12) throw new Error('Partie complète (max 12 joueurs)');
    state.players.push({ id: playerId, name: playerName, avatar: playerAvatar || '🃏', penaltyPoints: 0 });
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
    if (state.hostId === playerId) state.hostId = state.players[0]?.id || null;
    await this.saveGame(state);
    return state;
  }

  async startGame(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.players.length < 2 && !state.isSolo) throw new Error('Minimum 2 joueurs requis');
    state.status = GAME_STATUS.PLAYING;
    state.currentCard = null;
    state.currentPlayerId = null;
    state.currentTurnIndex = 0;
    state.logs.push({ type: 'gameStarted' });
    await this.saveGame(state);
    return state;
  }

  async drawCard(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    if (state.status !== GAME_STATUS.PLAYING) throw new Error('Partie pas en cours');

    const activePlayers = state.players.filter((p) => state.turnOrder.includes(p.id));
    if (activePlayers.length === 0) throw new Error('Aucun joueur actif');

    const isVerite = Math.random() < 0.5;
    const deck = isVerite ? VERITE_CARDS : ACTION_CARDS;

    const nsfwLevel = state.nsfwLevel || 0;
    const pool = deck.filter((c) => c.tier <= nsfwLevel);
    const card = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : deck[Math.floor(Math.random() * deck.length)];
    let text = card.text;
    const toz = card.toz || 0;

    state.currentPlayerId = state.turnOrder[state.currentTurnIndex];

    if (text.includes('{Joueur}')) {
      const others = activePlayers.filter((p) => p.id !== state.currentPlayerId);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        text = text.replace(/\{Joueur\}/g, target.name);
      } else {
        text = text.replace(/\{Joueur\}/g, 'toi-même');
      }
    }

    state.currentCard = { type: isVerite ? 'verite' : 'action', text, toz, tier: card.tier };
    state.logs.push({ type: 'cardDrawn', playerId: state.currentPlayerId, cardType: state.currentCard.type, toz });

    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
    await this.saveGame(state);
    return state;
  }

  async resetGame(gameId) {
    const state = await this.getGame(gameId);
    if (!state) throw new Error('Partie introuvable');
    state.status = GAME_STATUS.WAITING;
    state.currentCard = null;
    state.currentPlayerId = null;
    state.currentTurnIndex = 0;
    state.logs = [];
    state.players.forEach((p) => { p.penaltyPoints = 0; });
    await this.saveGame(state);
    return state;
  }
}

module.exports = { LeTozGame, GAME_STATUS, ROOM_PREFIX };
