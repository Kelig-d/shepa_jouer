const socket = io();
let state = null;
let myPlayerId = null;
let currentGameId = null;
let lastLogCount = 0;
let myAvatar = null;
let localWordAnswers = {};
let mcTimerInterval = null;

const $ = (id) => document.getElementById(id);

const AVATAR_LIST = ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦄', '🐲', '🐶', '🐺', '🐱', '🐰', '🦝', '🐙', '🦋', '🐢', '🐊', '🦅', '🐧'];

const DIFFICULTY_LABELS = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', extreme: 'Extrême' };
const DIFFICULTY_COLORS = { facile: '#28a745', moyen: '#ffc107', difficile: '#dc3545', extreme: '#6f42c1' };
const DIFFICULTY_POINTS = { facile: 1, moyen: 2, difficile: 3, extreme: 5 };

const RULES = {
  double: `
    <h3>🔥 C'est toi qui abuses !</h3>
    <p>Après avoir fait une supposition, tu peux <strong>doubler la mise</strong> en activant cette variante.</p>
    <ul>
      <li>Si ta supposition est <strong>trop haute</strong> (≥ la réponse), tu prends <strong>2× les points</strong> de pénalité</li>
      <li>Si ta supposition est <strong>bonne</strong> (&lt; la réponse), tu prends <strong>1× les points</strong> (comme d'habitude)</li>
      <li>Tu ne peux activer cette option qu'immédiatement après avoir fait ta supposition</li>
    </ul>
    <p>Stratégie : utile quand tu es sûr de toi et que tu veux en finir vite !</p>
  `
};

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  const screen = $(screenId);
  if (screen) screen.classList.remove('hidden');
}

function showError(msg) {
  const el = $('error-message');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function emitWithCallback(event, data) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response) => {
      if (response.success) resolve(response);
      else reject(new Error(response.error));
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function flashEffect(type) {
  const overlay = $('flash-overlay');
  overlay.className = 'flash-overlay';
  void overlay.offsetHeight;
  overlay.classList.add('flash-' + type);
}

// --- MODE TOGGLE ---
document.querySelectorAll('.mode-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    $('mode-input').value = opt.dataset.mode;
    const soloGroup = $('solo-players-group');
    if (soloGroup) {
      soloGroup.classList.toggle('hidden', opt.dataset.mode !== 'solo');
    }
  });
});

// --- GAME TYPE SELECTION ---
document.querySelectorAll('.game-type-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.game-type-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    const game = card.dataset.game;
    $('game-type-input').value = game;
    document.querySelectorAll('.game-options').forEach((o) => o.classList.add('hidden'));
    const opts = $(game + '-options');
    if (opts) opts.classList.remove('hidden');
    if (game === 'le-toz' || game === 'mot-croise') {
      $('mode-options').classList.remove('hidden');
    }
  });
});

// --- NSFW SLIDER ---
const nsfwLabels = ['🟢 Familial', '🟡 Amis', '🟠 Croustillant', '🔴 Hot', '🟣 Extrême'];
const nsfwDescs = ['Cartes drôles et légères uniquement', 'Ajoute des potins et questions entre amis', 'Ajoute des sujets perso et coquins', 'Ajoute des cartes osées et sensuelles', 'Toutes les cartes, y compris explicites'];
$('nsfw-slider').addEventListener('input', function () {
  const level = parseInt(this.value);
  $('nsfw-level-input').value = level;
  $('nsfw-badge').textContent = nsfwLabels[level] || '🟢 Familial';
  $('nsfw-slider-desc').textContent = nsfwDescs[level] || '';
  document.querySelectorAll('.nsfw-slider-label').forEach((l) => l.classList.toggle('active', parseInt(l.dataset.level) === level));
});

// --- AVATAR PICKER ---
function initAvatarPicker(containerId, onSelect) {
  const container = $(containerId);
  container.innerHTML = AVATAR_LIST.map((a) =>
    `<div class="avatar-option" data-avatar="${a}">${a}</div>`
  ).join('');
  let selected = null;

  container.querySelectorAll('.avatar-option').forEach((el) => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.avatar-option').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
      selected = el.dataset.avatar;
      if (onSelect) onSelect(selected);
    });
  });

  return {
    getValue: () => selected,
    setValue: (avatar) => {
      container.querySelectorAll('.avatar-option').forEach((o) => o.classList.remove('selected'));
      const el = container.querySelector(`[data-avatar="${avatar}"]`);
      if (el) el.classList.add('selected');
      selected = avatar;
    },
  };
}

const hostAvatarPicker = initAvatarPicker('host-avatar-picker');
const joinAvatarPicker = initAvatarPicker('join-avatar-picker');

hostAvatarPicker.setValue('🦊');
joinAvatarPicker.setValue('🐼');

// --- VARIANT CARDS ---
document.querySelectorAll('.variant-card').forEach((card) => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.variant-info-btn')) return;
    card.classList.toggle('active');
    const variant = card.dataset.variant;
    const checkbox = $('variant-' + variant);
    if (checkbox) checkbox.checked = card.classList.contains('active');
  });
});

// --- RULES MODAL ---
document.querySelectorAll('.variant-info-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rulesKey = btn.dataset.rules;
    const content = RULES[rulesKey] || '<p>Règles non disponibles</p>';
    $('rules-modal-content').innerHTML = content;
    $('rules-modal').classList.remove('hidden');
  });
});
$('rules-modal-close').addEventListener('click', () => {
  $('rules-modal').classList.add('hidden');
});
$('rules-modal').addEventListener('click', (e) => {
  if (e.target === $('rules-modal')) $('rules-modal').classList.add('hidden');
});

// --- TABS ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tab + '-tab').classList.add('active');
  });
});

// --- CREATE GAME ---
$('btn-create-game').addEventListener('click', async () => {
  const playerName = $('host-name').value.trim();
  if (!playerName) { showError('Entrez un pseudo'); return; }

  const playerAvatar = hostAvatarPicker.getValue() || '🦊';
  const gameType = $('game-type-input').value || 'la-t-abuses';
  const variantRules = [];
  if ($('variant-double') && $('variant-double').checked) variantRules.push('double');
  const nsfwLevel = parseInt($('nsfw-level-input')?.value || '0');
  const isSolo = $('mode-input')?.value === 'solo';
  let soloPlayerNames = [];
  if (isSolo) {
    const raw = ($('solo-players')?.value || '').trim();
    soloPlayerNames = raw.split(/[\n,]+/).map(n => n.trim()).filter(n => n.length > 0);
  }

  myAvatar = playerAvatar;

  try {
    const res = await emitWithCallback('createGame', { playerName, playerAvatar, gameType, variantRules, nsfwLevel, isSolo, soloPlayerNames });
    currentGameId = res.gameId;
    myPlayerId = res.playerId;
    sessionStorage.setItem('shepa_playerName', playerName);
    sessionStorage.setItem('shepa_gameId', res.gameId);
    updateSessionBar();
    showLobby();
    if (state) renderLobby(state);
  } catch (err) {
    showError(err.message);
  }
});

// --- JOIN GAME ---
$('btn-join-game').addEventListener('click', async () => {
  const playerName = $('join-name').value.trim();
  const gameId = $('game-code').value.trim();
  if (!playerName) { showError('Entrez un pseudo'); return; }
  if (!gameId) { showError('Entrez le code de la partie'); return; }

  const playerAvatar = joinAvatarPicker.getValue() || '🐼';
  myAvatar = playerAvatar;

  try {
    const res = await emitWithCallback('joinGame', { gameId, playerName, playerAvatar });
    currentGameId = gameId;
    myPlayerId = res.playerId;
    sessionStorage.setItem('shepa_playerName', playerName);
    sessionStorage.setItem('shepa_gameId', gameId);
    updateSessionBar();
    showLobby();
    if (state) renderLobby(state);
  } catch (err) {
    showError(err.message);
  }
});

$('btn-leave-lobby').addEventListener('click', async () => {
  try {
    await emitWithCallback('leaveGame', { gameId: currentGameId });
  } catch (e) {}
  clearSession();
  showScreen('lobby-screen');
});

$('btn-start-game').addEventListener('click', async () => {
  try {
    await emitWithCallback('startGame', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

$('btn-submit-guess').addEventListener('click', async () => {
  const guessValue = parseInt($('guess-input').value);
  if (isNaN(guessValue) || guessValue < 0) { showError('Entrez un nombre valide'); return; }
  if (state && state.lastGuessValue !== null && guessValue <= state.lastGuessValue) {
    showError(`La valeur doit être supérieure à ${state.lastGuessValue}`);
    return;
  }
  try {
    await emitWithCallback('submitGuess', { gameId: currentGameId, guessValue });
    $('guess-input').value = '';
  } catch (err) {
    showError(err.message);
  }
});

$('btn-challenge').addEventListener('click', async () => {
  try {
    await emitWithCallback('challenge', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

$('btn-double-down').addEventListener('click', async () => {
  try {
    await emitWithCallback('doubleDown', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

// --- LE TOZ ---
$('btn-toz-draw').addEventListener('click', async () => {
  try {
    await emitWithCallback('drawCard', { gameId: currentGameId });
    $('btn-toz-draw').classList.add('hidden');
    $('btn-toz-next').classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  }
});

$('btn-toz-next').addEventListener('click', async () => {
  try {
    await emitWithCallback('drawCard', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

// --- MOT CROISE ---
$('btn-guess-secret').addEventListener('click', async () => {
  const guess = $('mc-secret-input').value.trim();
  if (!guess) { showError('Entrez un mot'); return; }
  try {
    const res = await emitWithCallback('guessSecretWord', { gameId: currentGameId, guess });
    if (res.correct) {
      showError('🎉 Mot secret trouvé ! +500 pts');
      $('mc-secret-input').value = '';
    } else {
      showError('Mot secret incorrect');
      $('mc-secret-input').value = '';
    }
  } catch (err) {
    showError(err.message);
  }
});

$('btn-finish-game').addEventListener('click', async () => {
  try {
    await emitWithCallback('finishGame', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

$('btn-leave-game').addEventListener('click', async () => {
  try {
    await emitWithCallback('leaveGame', { gameId: currentGameId });
  } catch (e) {}
  clearSession();
  showScreen('lobby-screen');
});

$('btn-replay').addEventListener('click', async () => {
  try {
    await emitWithCallback('resetGame', { gameId: currentGameId });
  } catch (e) {}
});

$('btn-back-lobby').addEventListener('click', () => {
  clearSession();
  showScreen('lobby-screen');
});

// --- LOG FAB ---
$('log-fab-header').addEventListener('click', () => {
  $('log-fab').classList.toggle('collapsed');
});

// --- SESSION ---
function updateSessionBar() {
  const bar = $('session-bar');
  const playerName = sessionStorage.getItem('shepa_playerName');
  if (playerName) {
    $('session-player').innerHTML = `Connecté en tant que <strong>${escapeHtml(playerName)}</strong>`;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function clearSession() {
  currentGameId = null;
  myPlayerId = null;
  sessionStorage.removeItem('shepa_playerName');
  sessionStorage.removeItem('shepa_gameId');
  updateSessionBar();
}

function showLobby() {
  showScreen('lobby-game-screen');
}

document.addEventListener('click', (e) => {
  const codeEl = e.target.closest('#lobby-game-code');
  if (codeEl) {
    navigator.clipboard.writeText(codeEl.textContent).catch(() => {});
  }
});

async function tryReconnect() {
  const playerName = sessionStorage.getItem('shepa_playerName');
  const gameId = sessionStorage.getItem('shepa_gameId');
  if (!playerName || !gameId) return;
  try {
    const res = await emitWithCallback('reconnectGame', { gameId, playerName });
    currentGameId = res.gameId;
    myPlayerId = res.playerId;
  } catch (e) {
    clearSession();
  }
}

const GAME_NAMES = {
  'la-t-abuses': '🎲 Là t\'abuses !',
  'le-toz': '🃏 Le Toz',
  'mot-croise': '🧩 Mot Croisé Gaming',
};

// --- RENDER LOBBY ---
function renderLobby(state) {
  $('lobby-game-code').textContent = state.id;

  const host = state.players.find((p) => p.id === state.hostId);
  $('lobby-host').textContent = host ? (host.avatar || '') + ' ' + host.name : 'Inconnu';
  $('lobby-player-count').textContent = state.players.length;

  const variants = [];
  if (state.variantRules && state.variantRules.includes('double')) variants.push('C\'est toi qui abuses');
  const nsfwLabels = ['Familial', 'Amis', 'Croustillant', 'Hot', 'Extrême'];
  if (state.gameType === 'le-toz' && state.nsfwLevel !== undefined) {
    variants.push('NSFW: ' + (nsfwLabels[state.nsfwLevel] || state.nsfwLevel));
  }
  $('lobby-variants').textContent = variants.length ? variants.join(', ') : 'Aucune';
  $('lobby-mode').textContent = state.isSolo ? '🎮 Solo' : '👥 Multijoueur';
  $('lobby-game-type').textContent = GAME_NAMES[state.gameType] || state.gameType || 'Là t\'abuses !';

  $('lobby-players').innerHTML = state.players.map((p) => `
    <li>
      <span>${p.avatar || '🦊'} ${escapeHtml(p.name)}</span>
      ${p.id === state.hostId ? '<span class="host-badge">Hôte</span>' : ''}
    </li>
  `).join('');

  const isHost = myPlayerId === state.hostId;
  const startBtn = $('btn-start-game');
  const minPlayers = state.isSolo ? 1 : 2;
  if (isHost && state.players.length >= minPlayers) {
    startBtn.classList.remove('hidden');
  } else {
    startBtn.classList.add('hidden');
  }
}

// --- RENDER GAME ---
function renderGame(state) {
  showScreen('game-screen');

  $('game-title').textContent = GAME_NAMES[state.gameType] || 'Là t\'abuses !';

  const isMc = state.gameType === 'mot-croise';

  if (state.gameType === 'le-toz') {
    renderLeToz(state);
    $('la-tabuses-content').classList.add('hidden');
    $('le-toz-content').classList.remove('hidden');
    $('mot-croise-content').classList.add('hidden');
  } else if (isMc) {
    renderMotCroise(state);
    $('la-tabuses-content').classList.add('hidden');
    $('le-toz-content').classList.add('hidden');
    $('mot-croise-content').classList.remove('hidden');
  } else {
    renderLaTabuses(state);
    $('le-toz-content').classList.add('hidden');
    $('mot-croise-content').classList.add('hidden');
    $('la-tabuses-content').classList.remove('hidden');
  }

  const pokerTable = document.querySelector('.poker-table');
  if (pokerTable) pokerTable.classList.toggle('hidden', isMc);

  $('threshold-display').textContent = state.penaltyThreshold ? `Limite ${state.penaltyThreshold} pts` : '·';

  if (!isMc) renderTable(state, state.turnOrder[state.currentTurnIndex]);

  $('btn-leave-game').classList.remove('hidden');

  renderLogs(state);

  if (state.gameType !== 'le-toz') {
    checkChallengePopup(state);
  }
}

function renderLaTabuses(state) {
  if (state.currentQuestion) {
    const q = state.currentQuestion;
    const diff = q.difficulty || 'facile';
    const pts = DIFFICULTY_POINTS[diff] || 1;

    const oldText = $('question-text').textContent;
    const isNew = oldText !== q.text;

    $('question-text').textContent = q.text;

    const badge = $('difficulty-badge');
    badge.textContent = DIFFICULTY_LABELS[diff] || diff;
    badge.style.background = DIFFICULTY_COLORS[diff] || '#666';
    badge.style.color = '#fff';

    $('penalty-info').textContent = `⚡ ${pts} pt${pts > 1 ? 's' : ''}`;
    $('card-category').textContent = q.category || '';
    const qNum = state.logs.filter((l) => l.type === 'newQuestion').length;
    $('card-number').textContent = `Q${qNum || 1}`;

    if (isNew) {
      const inner = document.querySelector('.quiz-card-inner');
      if (inner) {
        inner.style.animation = 'none';
        void inner.offsetHeight;
        inner.style.animation = 'cardDraw 0.5s ease-out';
      }
    }
  } else {
    $('question-text').textContent = 'Nouvelle question arrive...';
    $('difficulty-badge').textContent = '';
    $('penalty-info').textContent = '';
    $('card-category').textContent = '';
    $('card-number').textContent = '';
  }

  const currentPlayerId = state.turnOrder[state.currentTurnIndex];
  const isMyTurn = currentPlayerId === myPlayerId;

  const guessControls = $('guess-controls');
  const challengeBtn = $('btn-challenge');
  const doubleDownBtn = $('btn-double-down');

  if (state.status === 'playing' && isMyTurn) {
    if (state.lastGuesserId !== myPlayerId) {
      guessControls.classList.remove('hidden');
    } else {
      guessControls.classList.add('hidden');
    }

    if (state.lastGuessValue !== null && state.lastGuesserId !== myPlayerId) {
      challengeBtn.classList.remove('hidden');
      challengeBtn.disabled = false;
    } else {
      challengeBtn.classList.add('hidden');
      challengeBtn.disabled = true;
    }

    if (state.lastGuesserId === myPlayerId && state.variantRules && state.variantRules.includes('double')) {
      doubleDownBtn.classList.remove('hidden');
      doubleDownBtn.disabled = false;
    } else {
      doubleDownBtn.classList.add('hidden');
      doubleDownBtn.disabled = true;
    }
  } else {
    guessControls.classList.add('hidden');
    challengeBtn.classList.add('hidden');
    challengeBtn.disabled = true;
    doubleDownBtn.classList.add('hidden');
    doubleDownBtn.disabled = true;
  }

  const lastGuess = $('last-guess-info');
  if (state.lastGuessValue !== null && state.lastGuesserId) {
    const guesser = state.players.find((p) => p.id === state.lastGuesserId);
    lastGuess.classList.remove('hidden');
    $('last-guess-value').textContent = state.lastGuessValue;
    $('last-guess-player').textContent = guesser ? guesser.name : 'Inconnu';
  } else {
    lastGuess.classList.add('hidden');
  }
}

const TIER_LABELS = ['Familial', 'Amis', 'Croustillant', 'Hot', 'Extrême'];
const TIER_EMOJIS = ['🟢', '🟡', '🟠', '🔴', '🟣'];

function renderLeToz(state) {
  const card = state.currentCard;
  const isHost = myPlayerId === state.hostId;

  if (card) {
    const player = state.players.find((p) => p.id === state.currentPlayerId);

    $('toz-type').textContent = card.type === 'verite' ? 'Vérité' : 'Action';
    $('toz-type').className = 'toz-type ' + card.type;

    $('toz-text').textContent = card.text;

    if (player) {
      $('toz-player').textContent = (player.avatar || '🃏') + ' ' + player.name;
      $('toz-player').classList.remove('hidden');
    } else {
      $('toz-player').classList.add('hidden');
    }

    if (card.tier !== undefined) {
      const tier = card.tier;
      $('toz-tier-badge').textContent = TIER_EMOJIS[tier] + ' ' + TIER_LABELS[tier];
      $('toz-tier-badge').className = 'toz-tier-badge toz-tier-' + tier;
      $('toz-tier-badge').classList.remove('hidden');
    } else {
      $('toz-tier-badge').classList.add('hidden');
    }

    $('btn-toz-draw').classList.add('hidden');
    if (state.isSolo) {
      $('btn-toz-next').classList.toggle('hidden', !isHost);
    } else {
      $('btn-toz-next').classList.remove('hidden');
    }

    if (card.toz) {
      $('toz-sips').textContent = '🍺 ' + card.toz + ' gorgée' + (card.toz > 1 ? 's' : '') + ' si tu passes';
      $('toz-sips').classList.remove('hidden');
    } else {
      $('toz-sips').classList.add('hidden');
    }
  } else {
    $('toz-type').textContent = '';
    $('toz-type').className = 'toz-type';
    $('toz-player').classList.add('hidden');
    $('toz-player').textContent = '';
    $('toz-tier-badge').classList.add('hidden');
    $('toz-text').textContent = 'Prêt à piocher ?';
    $('toz-sips').classList.add('hidden');

    if (state.isSolo) {
      $('btn-toz-draw').classList.toggle('hidden', !isHost);
    } else {
      $('btn-toz-draw').classList.remove('hidden');
    }
    $('btn-toz-next').classList.add('hidden');
  }
}

// --- RENDER MOT CROISE ---
function renderMotCroise(state) {
  if (mcTimerInterval) { clearInterval(mcTimerInterval); mcTimerInterval = null; }

  const player = state.players.find(p => p.id === myPlayerId);
  if (!player || !player.grid) return;

  const grid = player.grid;
  const completed = player.completedWords || [];

  renderMotCroiseGrid(grid, completed);
  renderMotCroiseDefinitions(grid, completed);

  $('mc-score').textContent = '🏆 ' + player.score + ' pts';
  $('mc-progress-text').textContent = completed.length + ' / ' + grid.totalWords + ' mots trouvés';

  const secretArea = $('mc-secret-area');
  const revealCount = (grid.secretCells || []).filter(c => c.revealed).length;
  const totalSecret = (grid.secretCells || []).length;

  if (player.secretGuessed) {
    secretArea.classList.remove('hidden');
    $('mc-secret-letters').innerHTML = '<div class="mc-secret-found">✅ Mot secret trouvé ! +500 pts</div>';
    $('mc-secret-input').disabled = true;
    $('btn-guess-secret').disabled = true;
  } else if (revealCount > 0) {
    secretArea.classList.remove('hidden');
    const letters = grid.secretCells.map((c, i) =>
      `<span class="mc-secret-letter ${c.revealed ? 'revealed' : 'hidden-letter'}">${c.revealed ? escapeHtml(c.letter) : '?'}</span>`
    ).join('');
    $('mc-secret-letters').innerHTML = 'Lettres révélées : ' + letters + ' (' + revealCount + '/' + totalSecret + ')';
    $('mc-secret-input').disabled = false;
    $('btn-guess-secret').disabled = false;
  } else {
    secretArea.classList.add('hidden');
  }

  updateMcTimer(state);
  mcTimerInterval = setInterval(() => updateMcTimer(state), 1000);
}

function renderMotCroiseGrid(grid, completed) {
  const table = $('mc-grid');
  const cellWords = {};

  grid.words.forEach(w => {
    for (let i = 0; i < w.answerLength; i++) {
      const r = w.isAcross ? w.row : w.row + i;
      const c = w.isAcross ? w.col + i : w.col;
      cellWords[r + ',' + c] = { wordIndex: w.wordIndex, offset: i };
    }
  });

  const completedSet = new Set(completed);
  let html = '';
  for (let r = 0; r < grid.grid.length; r++) {
    html += '<tr>';
    for (let c = 0; c < grid.grid[r].length; c++) {
      const cell = grid.grid[r][c];
      if (cell.isBlocked) {
        html += '<td class="mc-cell blocked"></td>';
      } else {
        const cw = cellWords[r + ',' + c];
        let letter = '';
        let isCompleted = false;
        if (cw && completedSet.has(cw.wordIndex)) {
          isCompleted = true;
          const word = grid.words.find(w => w.wordIndex === cw.wordIndex);
          if (word) {
            const ans = localWordAnswers[cw.wordIndex];
            if (ans) letter = ans[cw.offset] || '';
          }
        }
        const num = cell.number ? `<span class="mc-cell-num">${cell.number}</span>` : '';
        html += `<td class="mc-cell ${isCompleted ? 'completed' : ''}">${num}<span class="mc-cell-letter">${letter ? escapeHtml(letter) : ''}</span></td>`;
      }
    }
    html += '</tr>';
  }
  table.innerHTML = html;
}

function renderMotCroiseDefinitions(grid, completed) {
  const container = $('mc-definitions');
  const completedSet = new Set(completed);

  container.innerHTML = grid.words.map(w => {
    const done = completedSet.has(w.wordIndex);
    return `
      <div class="mc-def ${done ? 'completed' : ''}" data-word-index="${w.wordIndex}">
        <span class="mc-def-num">${w.number}</span>
        <div class="mc-def-body">
          <div class="mc-def-clue">${escapeHtml(w.clue)} <span class="mc-def-length">(${w.answerLength})</span></div>
          <div class="mc-def-input-row ${done ? 'hidden' : ''}">
            <input type="text" class="mc-def-input" maxlength="${w.answerLength}" placeholder="Réponse...">
            <button class="btn btn-success btn-small btn-submit-word">✓</button>
          </div>
          ${done ? '<div class="mc-def-done">✅ Trouvé</div>' : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-submit-word').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const def = e.target.closest('.mc-def');
      const input = def.querySelector('.mc-def-input');
      const wordIndex = parseInt(def.dataset.wordIndex);
      const answer = input.value.trim();
      if (!answer) return;
      try {
        const res = await emitWithCallback('submitWord', { gameId: currentGameId, wordIndex, answer });
        if (res.correct) {
          localWordAnswers[wordIndex] = answer.toUpperCase().trim();
          input.value = '';
        } else {
          showError('Mot incorrect, réessayez');
          input.value = '';
          input.focus();
        }
      } catch (err) {
        showError(err.message);
      }
    });
  });
}

function updateMcTimer(state) {
  if (!state.startTime) return;
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const remaining = Math.max(0, state.timeLimit - elapsed);
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const timerEl = $('mc-timer');
  timerEl.textContent = '⏱ ' + min + ':' + String(sec).padStart(2, '0');
  timerEl.style.color = remaining < 60 ? '#ff1744' : remaining < 120 ? '#ff9100' : '#00e676';
}

// --- RENDER TABLE (CIRCULAR) ---
function renderTable(state, currentPlayerId) {
  const maxPts = state.penaltyThreshold || 999;
  const ended = state.status === 'ended';
  const active = state.players.filter((p) => p.penaltyPoints < maxPts && !ended);
  const eliminated = state.players.filter((p) => p.penaltyPoints >= maxPts || ended);
  const ordered = [...active, ...eliminated];

  const ring = $('game-players');
  ring.innerHTML = ordered.map((p, i) => {
    const isCurrent = currentPlayerId === p.id;
    const isEliminated = p.penaltyPoints >= maxPts || ended;
    const pct = maxPts < 999 ? Math.min(100, (p.penaltyPoints / maxPts) * 100) : 0;
    return `
      <div class="game-seat ${isCurrent && !ended ? 'active-turn' : ''} ${isEliminated ? 'eliminated' : ''}" style="animation-delay: ${i * 0.08}s">
        <div class="seat-avatar">${p.avatar || '🦊'}</div>
        <div class="seat-name">${escapeHtml(p.name)} ${p.id === myPlayerId ? '<span class="seat-you">(Vous)</span>' : ''}</div>
        <div class="seat-points">${maxPts < 999 ? '⚠ ' + p.penaltyPoints : ''}
          ${maxPts < 999 ? '<span class="seat-penalty-fill"><span class="seat-penalty-fill-inner" style="width: ' + pct + '%"></span></span>' : ''}
        </div>
        ${isCurrent && !ended ? '<div class="seat-indicator">▶ TOUR</div>' : ''}
        ${isEliminated ? '<div class="seat-indicator lost">💀</div>' : ''}
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => positionSeats());
}

function positionSeats() {
  const ring = $('game-players');
  const seats = ring.querySelectorAll('.game-seat');
  const count = seats.length;
  if (count === 0) return;

  const table = ring.closest('.poker-table');
  const radius = table.offsetWidth * 0.42;

  seats.forEach((seat, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    seat.style.setProperty('--tx', x + 'px');
    seat.style.setProperty('--ty', y + 'px');
  });
}

// --- RENDER LOGS ---
function renderLogs(state) {
  $('game-logs').innerHTML = state.logs.slice(-20).map((log) => {
    let text = '';
    const p = (id) => state.players.find((pl) => pl.id === id)?.name || 'Inconnu';
    switch (log.type) {
      case 'gameStarted': text = '🎬 Partie commencée !'; break;
      case 'newQuestion': text = `📝 ${escapeHtml(log.question)} (${DIFFICULTY_LABELS[log.difficulty] || log.difficulty})`; break;
      case 'guess': text = `🔢 ${p(log.playerId)} → ${log.guessValue}`; break;
      case 'challenge': text = `🚨 ${p(log.challengerId)} : Là t'abuses ! → ${p(log.loserId)} +${log.pts} pts`; break;
      case 'doubleDown': text = `🔥 ${p(log.playerId)} : C'est toi qui abuses ! → +${log.pts} pts`; break;
      case 'gameEnded': text = `🏁 ${log.reason}`; break;
      case 'cardDrawn': text = `🃏 ${p(log.playerId)} pioche une carte ${log.cardType === 'verite' ? 'Vérité' : 'Action'}`; if (log.toz) text += ` (🍺 ${log.toz})`; break;
      default: text = JSON.stringify(log);
    }
    return `<div class="log-entry">${text}</div>`;
  }).join('');
  $('game-logs').scrollTop = $('game-logs').scrollHeight;
}

// --- CHALLENGE POPUP ---
function checkChallengePopup(state) {
  const lastLog = state.logs[state.logs.length - 1];
  if (!lastLog || lastLog.type !== 'challenge') { lastLogCount = state.logs.length; return; }
  if (state.logs.length === lastLogCount) return;
  lastLogCount = state.logs.length;

  const p = (id) => state.players.find((pl) => pl.id === id)?.name || 'Inconnu';
  const challenger = p(lastLog.challengerId);
  const guessed = p(lastLog.guessedId);
  const loser = p(lastLog.loserId);
  const challengerLost = lastLog.loserId === lastLog.challengerId;

  flashEffect(challengerLost ? 'red' : 'green');

  const popup = $('challenge-popup');
  const body = $('challenge-popup-body');
  body.innerHTML = `
    <div class="popup-icon">${challengerLost ? '❌' : '✅'}</div>
    <div class="popup-text">
      <strong>Là t'abuses !</strong><br>
      ${challenger} → ${guessed}<br>
      <span class="popup-detail">Supposition : ${lastLog.guessValue}</span><br>
      <div class="popup-answer">${lastLog.answer}</div>
      <span class="popup-result ${challengerLost ? 'text-red' : 'text-green'}">
        ${challengerLost ? `${challenger} perd +${lastLog.pts} pts` : `${guessed} perd +${lastLog.pts} pts`}
      </span>
    </div>
  `;
  popup.classList.remove('hidden');
  void popup.offsetHeight;
  popup.classList.remove('popup-hide');
  popup.classList.add('popup-show');

  setTimeout(() => {
    popup.classList.remove('popup-show');
    popup.classList.add('popup-hide');
    setTimeout(() => popup.classList.add('hidden'), 500);
  }, 4000);
}

// --- RENDER END ---
function renderEnd(state) {
  showScreen('end-screen');
  if (mcTimerInterval) { clearInterval(mcTimerInterval); mcTimerInterval = null; }

  const isScoreBased = state.gameType === 'mot-croise';

  if (isScoreBased) {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const others = sorted.slice(1);

    const lastLog = [...state.logs].reverse().find(l => l.type === 'secretFound' || l.type === 'gameEnded');

    $('end-result').innerHTML = `
      <h2>🏆 ${escapeHtml(winner.name)} a gagné !</h2>
      <p>Avec ${winner.score} points</p>
      ${lastLog && lastLog.type === 'secretFound' ? '<p>🔍 Mot secret trouvé !</p>' : ''}
      <p>🎉 Félicitations à tous les joueurs !</p>
    `;

    $('end-scores').innerHTML = sorted.map((p, i) => `
      <div class="player-card ${i === 0 ? 'winner' : ''}">
        <span class="player-name">${p.avatar || '🧩'} ${escapeHtml(p.name)} ${i === 0 ? '🏆' : ''}</span>
        <span class="player-points" style="color: #00e676">⭐ ${p.score} pts</span>
      </div>
    `).join('');
  } else {
    const loser = state.players.reduce((a, b) => a.penaltyPoints > b.penaltyPoints ? a : b);
    const winners = state.players.filter((p) => p.id !== loser.id);

    const lastChallengeLog = [...state.logs].reverse().find((l) => l.type === 'challenge' || l.type === 'doubleDown');
    const lastAnswer = lastChallengeLog ? lastChallengeLog.answer : (state.currentQuestion ? state.currentQuestion.answer : null);

    let answerHtml = '';
    if (lastAnswer !== null) {
      answerHtml = `<div class="end-answer">La réponse était : <strong>${escapeHtml(String(lastAnswer))}</strong></div>`;
    }

    $('end-result').innerHTML = `
      <h2>😵 ${escapeHtml(loser.name)} a perdu !</h2>
      <p>Avec ${loser.penaltyPoints} points de pénalité</p>
      ${answerHtml}
      <p>🎉 Félicitations aux gagnants : ${winners.map((w) => escapeHtml(w.name)).join(', ')}</p>
    `;

    $('end-scores').innerHTML = state.players.map((p) => `
      <div class="player-card">
        <span class="player-name">${p.avatar || '🦊'} ${escapeHtml(p.name)} ${p.id === loser.id ? '😵' : ''}</span>
        <span class="player-points">⚠ ${p.penaltyPoints} pts</span>
      </div>
    `).join('');
  }
}

// --- SOCKET ---
socket.on('gameUpdate', (gameState) => {
  state = gameState;

  if (gameState.status === 'waiting') {
    if (mcTimerInterval) { clearInterval(mcTimerInterval); mcTimerInterval = null; }
    showScreen('lobby-game-screen');
    renderLobby(gameState);
  } else if (gameState.status === 'playing') {
    renderGame(gameState);
    requestAnimationFrame(() => positionSeats());
  } else if (gameState.status === 'ended') {
    renderEnd(gameState);
  }
});

window.addEventListener('resize', () => {
  if (state && (state.status === 'playing' || state.status === 'ended')) {
    requestAnimationFrame(() => positionSeats());
  }
});

$('btn-disconnect').addEventListener('click', () => {
  clearSession();
  showScreen('lobby-screen');
});

tryReconnect().finally(() => updateSessionBar());

$('host-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create-game').click();
});
$('join-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join-game').click();
});
$('game-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join-game').click();
});
$('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-submit-guess').click();
});
