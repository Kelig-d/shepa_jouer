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
  // Drôles / Ambiance
  'Raconte ta dernière recherche Google un peu honteuse.',
  'Quel est le pire cadeau que tu aies jamais reçu ?',
  'Ton talent caché le plus inutile ? On veut une démo !',
  'Quelle est la fake news la plus improbable à laquelle tu as presque cru ?',
  'Quel est le truc le plus bizarre que tu aies dans ton sac en ce moment ?',
  'Décris ton plat préféré comme si c\'était une œuvre d\'art.',
  'Quelle est la pire tendance mode que tu aies suivie ?',
  'Quel bruit te fait instantanément sourire ?',

  // Entre amis
  'Quelle est la première impression, honnête, que tu as eue de {Joueur} ?',
  'Si notre groupe était une sitcom, quel serait ton rôle ?',
  'Qui dans la table est le plus susceptible de devenir célèbre ? Pourquoi ?',
  'Quelle est la chose la plus embarrassante que {Joueur} t\'ait vu faire ?',
  'Quel est le pire conseil que tu aies donné à quelqu\'un ici ?',
  'Si tu devais noter l\'hygiène de {Joueur} sur 10, quelle note ?',
  'Quel secret de {Joueur} connais-tu que les autres ignorent ?',

  // Croustillants / Perso
  'Quelle est la chose la plus folle que tu aies faite sur un coup de tête ?',
  'Le plus gros mensonge que tu aies raconté à tes parents ?',
  'Raconte ton rendez-vous le plus gênant — et ce qui a mal tourné.',
  'As-tu déjà eu un crush sur quelqu\'un dans cette pièce ?',
  'Quel est ton « guilty pleasure » ultime (musique, série, bouffe) ?',
  'Si tu devais décrire ta vie sentimentale avec un titre de film, lequel ?',
  'Quel est le pire date de ta vie ?',
  'As-tu déjà regretté d\'avoir couché avec quelqu\'un ?',
  'Quelle est la chose la plus embarrassante qu\'on t\'ait vue faire ?',
  'Quel est le plus gros risque que tu aies pris pour l\'amour ?',

  // Hot / Limite
  'Quelle est la partie du corps que tu regardes en premier chez {Joueur} ?',
  'Qu\'est-ce qui te fait craquer chez une personne ? (3 choses)',
  'Quel est le compliment le plus marquant qu\'on t\'ait jamais fait ?',
  'Décris ton look le plus séduisant que tu aies jamais porté.',
  'Quelle est la chose la plus osée que tu aies faite pour séduire ?',
  'Quel défaut physique trouves-tu bizarrement attirant chez quelqu\'un ?',
  'Si tu devais passer une soirée en tête-à-tête avec {Joueur}, où irais-tu ?',
];

const ACTION_CARDS = [
  // Drôles / Ambiance
  'Fais la chenille tout seul autour du groupe.',
  'Parle comme Yoda jusqu\'à ton prochain tour.',
  'Imite le démarrage d\'un vieux modem 56k.',
  'Fais une battle de regards avec {Joueur}. Le premier qui rit a perdu.',
  'Récite l\'alphabet à l\'envers le plus vite possible.',
  'Fais le moonwalk sur 3 mètres — ou une tentative honorable.',
  'Mange un biscuit sans utiliser tes mains.',
  'Fais le bruitage d\'un personnage de jeu vidéo connu.',
  'Fais un câlin de 10 secondes à {Joueur} sans dire un mot.',
  'Laisse {Joueur} te coiffer de manière ridicule. Photo obligatoire.',

  // Entre amis
  'Donne ton téléphone à {Joueur} qui peut envoyer un émoji au premier contact de ta liste.',
  'Raconte une histoire en utilisant uniquement des titres de chansons.',
  'Imite un membre du groupe, les autres devinent qui c\'est.',
  'Fais un compliment très spécifique à chaque personne de la table.',
  'Laisse {Joueur} fouiller ton historique YouTube ou TikTok pendant 30 secondes.',
  'Échange un vêtement ou accessoire avec {Joueur} jusqu\'à la prochaine carte.',
  'Mime un film et les autres doivent deviner.',
  'Fais un discours d\'une minute sur un sujet improbable (le chat, les chaussettes...).',

  // Croustillants
  'Susurre un mot doux à l\'oreille de {Joueur}.',
  'Regarde {Joueur} dans les yeux pendant 10 secondes sans sourire.',
  'Chuchote ton plus gros secret à l\'oreille de {Joueur}.',
  'Fais une déclaration d\'amour passionnée à {Joueur} comme dans un film.',
  'Masse les épaules de {Joueur} pendant 15 secondes.',
  'Fais deviner un mot coquin à {Joueur} en le mimant seulement.',
  'Fais un slow avec {Joueur} sur une musique imaginaire pendant 15 secondes.',
  'Prends la main de {Joueur} et fais-lui un compliment les yeux dans les yeux.',
  'Embrasse la joue de {Joueur} lentement.',
  'Raconte une anecdote croustillante avec des bruits suggestifs et des gestes.',

  // Hot / Osé
  'Mime une scène de séduction avec {Joueur} devant tout le monde.',
  'Regarde {Joueur} de bas en haut et dis-lui ce qui te plaît chez lui/elle.',
  'Danse langoureusement avec un objet imaginaire pendant 15 secondes.',
  'Fais ton plus beau regard séducteur à {Joueur} sans cligner des yeux.',
  'Fais une proposition indécente à {Joueur} sur un ton théâtral.',
  'Décoiffe-toi de façon sexy façon clip de musique.',
  'Fais un strip-tease inversé (remets un vêtement que tu enlèverais).',
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
