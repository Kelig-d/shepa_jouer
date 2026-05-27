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
  'Quelle est la partie du corps que tu regardes en premier chez {Joueur} ?',
  'Si {Joueur} te faisait une déclaration, accepterais-tu ?',
  'Quel joueur de la table a le plus de charme selon toi ?',
  'Raconte ton rendez-vous le plus gênant — et ce qui a mal tourné.',
  'Quel est le regard le plus séduisant de la table ?',
  'Si tu devais te déshabiller devant quelqu\'un ici, qui choisirais-tu ?',
  'Qu\'est-ce qui te fait craquer chez une personne ? (3 choses)',
  'Quel joueur ici a le plus de secrets selon toi ?',
  'Raconte un fantasme que tu n\'as jamais partagé à personne.',
  'Si tu devais échanger ton corps avec {Joueur} pour un jour, qu\'est-ce que tu ferais en premier ?',
  'Quelle est la chose la plus coquine que tu aies faite en public ?',
  'Qui ici pourrait te faire craquer facilement ? Pourquoi ?',
  'Quel est le compliment le plus séduisant qu\'on t\'ait jamais fait ?',
  'Si tu devais passer une soirée en tête-à-tête avec {Joueur}, où irais-tu ?',
  'Quel joueur a le plus de "swag" selon toi ?',
  'Décris ton look le plus "hot" que tu aies jamais porté.',
  'Quelle est la chose la plus osée que tu aies faite pour séduire ?',
  'Quel défaut physique trouves-tu bizarrement attirant chez quelqu\'un ?',
  'Si tu devais embrasser quelqu\'un ici le front, qui serait-ce ?',
  'Qui ici a le plus de potentiel pour être un bon "date" ?',
];

const ACTION_CARDS = [
  'Susurre un mot coquin à l\'oreille de {Joueur}.',
  'Regarde {Joueur} dans les yeux pendant 10 secondes sans sourire.',
  'Fais un compliment très sensuel à {Joueur} en le regardant droit dans les yeux.',
  'Danse langoureusement avec un balai ou un objet imaginaire pendant 15 secondes.',
  'Fais une déclaration d\'amour passionnée à {Joueur} comme dans un film.',
  'Masse les épaules de {Joueur} pendant 15 secondes.',
  'Chuchote à l\'oreille de {Joueur} ton plus gros secret inavouable.',
  'Fais 5 pas en défilant comme sur un podium — version sexy.',
  'Fais un câlin de 10 secondes à {Joueur} sans dire un mot.',
  'Prends la main de {Joueur} et fais-lui un compliment les yeux dans les yeux.',
  'Fais ton plus beau regard séducteur à {Joueur} sans cligner des yeux.',
  'Raconte une histoire croustillante avec des bruits suggestifs et des gestes.',
  'Décoiffe-toi de façon sexy façon clip de musique.',
  'Fais deviner un mot coquin à {Joueur} en le mimant seulement.',
  'Fais un slow avec {Joueur} sur une musique imaginaire pendant 15 secondes.',
  'Embrasse la joue de {Joueur} lentement.',
  'Fais une proposition indécente à {Joueur} sur un ton théâtral.',
  'Regarde {Joueur} de bas en haut et dis-lui ce qui te plaît chez lui/elle.',
  'Mime une scène de séduction avec {Joueur} devant tout le monde pendant 20 secondes.',
  'Fais deviner aux autres à quel endroit du corps tu aimerais être embrassé(e) en le mimant.',
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
    let text = deck[Math.floor(Math.random() * deck.length)];

    if (text.includes('{Joueur}')) {
      const others = activePlayers.filter((p) => p.id !== player.id);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        text = text.replace(/\{Joueur\}/g, target.name);
      } else {
        text = text.replace(/\{Joueur\}/g, 'toi-même');
      }
    }

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
