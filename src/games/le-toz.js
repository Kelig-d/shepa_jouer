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

const VERITE_CARDS = [
  'Quelle est la chose la plus embarrassante qui vous soit arrivée en public ?',
  'Quel est le pire mensonge que vous ayez raconté à vos parents ?',
  'Qui dans cette pièce aimeriez-vous embrasser ?',
  'Quelle est la pire chose que vous ayez faite en cachette ?',
  'Avez-vous déjà espionné quelqu\'un ? Racontez.',
  'Quel est votre plus grand regret ?',
  'Quelle est la chose la plus stupide que vous ayez achetée ?',
  'Avez-vous déjà volé quelque chose ? Quoi ?',
  'Qui est votre crush secret dans cette pièce ?',
  'Quel est le pire rendez-vous de votre vie ?',
  'Avez-vous déjà fait semblant d\'aimer un cadeau ? Lequel ?',
  'Quelle est votre plus grande peur ?',
  'Quel est le pire secret que vous cachiez à vos parents ?',
  'Avez-vous déjà triché à un examen ? Comment ?',
  'Qui est la personne la plus célèbre que vous aimeriez rencontrer ?',
  'Quelle est la pire insulte que vous ayez reçue ?',
  'Avez-vous déjà pleuré devant un film ? Lequel ?',
  'Quel est votre pire défaut selon vos amis ?',
  'Avez-vous déjà envoyé un message au mauvais destinataire ? Racontez.',
  'Quelle est la chose la plus bizarre que vous mangiez ?',
];

const ACTION_CARDS = [
  'Faites 10 pompes devant tout le monde.',
  'Imitez un animal pendant 30 secondes.',
  'Chantez le refrain de votre chanson préférée à tue-tête.',
  'Appelez un contact au hasard et dites-lui "Je t\'aime".',
  'Faites le tour de la pièce en marchant comme un crabe.',
  'Mimez un film et les autres doivent deviner.',
  'Faites un compliment sincère à chaque personne de la pièce.',
  'Dansez pendant 20 secondes sur une musique imaginaire.',
  'Parlez avec un accent différent pendant 3 tours de jeu.',
  'Fermez les yeux et laissez les autres vous guider pour faire 5 pas.',
  'Faites une déclaration d\'amour dramatique à un objet de la pièce.',
  'Racontez une blague. Si personne ne rit, faites 5 squats.',
  'Prenez une photo de vous avec la plus drôle des expressions.',
  'Échangez une chaussure avec la personne à votre gauche pour le prochain tour.',
  'Faites le bruit d\'un moteur de voiture pendant 10 secondes.',
  'Dessinez quelque chose les yeux fermés, les autres devinent.',
  'Faites un discours de 15 secondes sur un sujet improbable (ex: les chaussettes).',
  'Imitez un membre du groupe, les autres devinent qui c\'est.',
  'Tenez une pose de super-héros pendant 15 secondes sans bouger.',
  'Racontez le film le plus récent que vous ayez vu en 10 secondes chrono.',
];

class LeTozGame {
  constructor(redis) {
    this.redis = redis;
  }

  async createGame(hostId, hostName, hostAvatar, variantRules) {
    let state, key;
    for (let attempt = 0; attempt < 10; attempt++) {
      state = {
        id: generateCode(),
        gameType: 'le-toz',
        status: GAME_STATUS.WAITING,
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
    if (state.players.length < 2) throw new Error('Minimum 2 joueurs requis');
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

    const randomIndex = Math.floor(Math.random() * activePlayers.length);
    const player = activePlayers[randomIndex];

    const isVerite = Math.random() < 0.5;
    const deck = isVerite ? VERITE_CARDS : ACTION_CARDS;
    const text = deck[Math.floor(Math.random() * deck.length)];

    state.currentPlayerId = player.id;
    state.currentCard = { type: isVerite ? 'verite' : 'action', text };
    state.logs.push({ type: 'cardDrawn', playerId: player.id, cardType: state.currentCard.type });

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
