const socket = io();
let state = null;
let myPlayerId = null;
let currentGameId = null;
let lastLogCount = 0;

const $ = (id) => document.getElementById(id);

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

const DIFFICULTY_LABELS = {
  facile: 'Facile',
  moyen: 'Moyen',
  difficile: 'Difficile',
  extreme: 'Extrême',
};

const DIFFICULTY_COLORS = {
  facile: '#28a745',
  moyen: '#ffc107',
  difficile: '#dc3545',
  extreme: '#6f42c1',
};

const AVATARS = ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦄', '🐲', '🐶'];

function getAvatar(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return AVATARS[Math.abs(hash) % AVATARS.length];
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tab + '-tab').classList.add('active');
  });
});

$('btn-create-game').addEventListener('click', async () => {
  const playerName = $('host-name').value.trim();
  if (!playerName) { showError('Entrez un pseudo'); return; }

  const variantRules = [];
  if ($('variant-double').checked) variantRules.push('double');

  try {
    const res = await emitWithCallback('createGame', { playerName, variantRules });
    currentGameId = res.gameId;
    myPlayerId = res.playerId;
    sessionStorage.setItem('shepa_playerName', playerName);
    sessionStorage.setItem('shepa_gameId', res.gameId);
    showLobby();
  } catch (err) {
    showError(err.message);
  }
});

$('btn-join-game').addEventListener('click', async () => {
  const playerName = $('join-name').value.trim();
  const gameId = $('game-code').value.trim();
  if (!playerName) { showError('Entrez un pseudo'); return; }
  if (!gameId) { showError('Entrez le code de la partie'); return; }

  try {
    const res = await emitWithCallback('joinGame', { gameId, playerName });
    currentGameId = gameId;
    myPlayerId = res.playerId;
    sessionStorage.setItem('shepa_playerName', playerName);
    sessionStorage.setItem('shepa_gameId', gameId);
    showLobby();
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

$('btn-leave-game').addEventListener('click', async () => {
  try {
    await emitWithCallback('leaveGame', { gameId: currentGameId });
  } catch (e) {}
  clearSession();
  showScreen('lobby-screen');
});

$('btn-replay').addEventListener('click', () => {
  clearSession();
  showScreen('lobby-screen');
});

$('btn-back-lobby').addEventListener('click', () => {
  clearSession();
  showScreen('lobby-screen');
});

$('log-fab-toggle').addEventListener('click', () => {
  const fab = $('log-fab');
  fab.classList.toggle('collapsed');
});

function clearSession() {
  currentGameId = null;
  myPlayerId = null;
  sessionStorage.removeItem('shepa_playerName');
  sessionStorage.removeItem('shepa_gameId');
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

function renderLobby(state) {
  $('lobby-game-code').textContent = state.id;
  $('lobby-host').textContent = state.players.find((p) => p.id === state.hostId)?.name || 'Inconnu';
  $('lobby-player-count').textContent = state.players.length;

  const variants = [];
  if (state.variantRules.includes('double')) variants.push('C\'est toi qui abuses');
  $('lobby-variants').textContent = variants.length ? variants.join(', ') : 'Aucune';

  $('lobby-players').innerHTML = state.players.map((p) => `
    <li>
      <span>${getAvatar(p.name)} ${escapeHtml(p.name)}</span>
      ${p.id === state.hostId ? '<span class="host-badge">Hôte</span>' : ''}
    </li>
  `).join('');

  const isHost = myPlayerId === state.hostId;
  const startBtn = $('btn-start-game');
  if (isHost && state.players.length >= 2) {
    startBtn.classList.remove('hidden');
  } else {
    startBtn.classList.add('hidden');
  }
}

function renderGame(state) {
  showScreen('game-screen');

  if (state.currentQuestion) {
    const q = state.currentQuestion;
    const diff = q.difficulty || 'facile';
    const pts = { facile: 1, moyen: 2, difficile: 3, extreme: 5 }[diff] || 1;

    const oldText = $('question-text').textContent;
    const isNew = oldText !== q.text;

    $('question-text').textContent = q.text;

    const badge = $('difficulty-badge');
    badge.textContent = DIFFICULTY_LABELS[diff] || diff;
    badge.style.background = DIFFICULTY_COLORS[diff] || '#666';
    badge.style.color = '#fff';
    badge.style.padding = '2px 10px';
    badge.style.borderRadius = '12px';
    badge.style.fontSize = '0.8em';

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

    if (state.lastGuesserId === myPlayerId && state.variantRules.includes('double')) {
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

  renderTable(state, currentPlayerId);

  renderLogs(state);

  checkChallengePopup(state);
}

function renderTable(state, currentPlayerId) {
  const maxPts = state.penaltyThreshold;
  const active = state.players.filter((p) => p.penaltyPoints < maxPts && state.status !== 'ended');
  const eliminated = state.players.filter((p) => p.penaltyPoints >= maxPts || state.status === 'ended');
  const ordered = [...active, ...eliminated];

  $('game-players').innerHTML = ordered.map((p) => {
    const isCurrent = currentPlayerId === p.id;
    const isEliminated = p.penaltyPoints >= maxPts || state.status === 'ended';
    const pct = Math.min(100, (p.penaltyPoints / maxPts) * 100);
    return `
      <div class="table-seat ${isCurrent && state.status === 'playing' ? 'active-turn' : ''} ${isEliminated ? 'eliminated' : ''}">
        <div class="seat-avatar">${getAvatar(p.name)}</div>
        <div class="seat-name">${escapeHtml(p.name)} ${p.id === myPlayerId ? '<span class="seat-you">Vous</span>' : ''}</div>
        <div class="seat-points">⚠️ ${p.penaltyPoints}/${maxPts}</div>
        <div class="penalty-bar"><div class="penalty-bar-fill" style="width: ${pct}%"></div></div>
        ${isCurrent && state.status === 'playing' ? '<div class="seat-indicator">▶ TOUR</div>' : ''}
        ${isEliminated ? '<div class="seat-indicator lost">💀</div>' : ''}
      </div>
    `;
  }).join('');
}

function renderLogs(state) {
  $('game-logs').innerHTML = state.logs.slice(-20).map((log) => {
    let text = '';
    const p = (id) => state.players.find((pl) => pl.id === id)?.name || 'Inconnu';
    switch (log.type) {
      case 'gameStarted':
        text = '🎬 Partie commencée !';
        break;
      case 'newQuestion':
        text = `📝 ${escapeHtml(log.question)} (${DIFFICULTY_LABELS[log.difficulty] || log.difficulty})`;
        break;
      case 'guess':
        text = `🔢 ${p(log.playerId)} → ${log.guessValue}`;
        break;
      case 'challenge':
        text = `🚨 ${p(log.challengerId)} : Là t'abuses ! → ${p(log.loserId)} +${log.pts} pts`;
        break;
      case 'doubleDown':
        text = `🔥 ${p(log.playerId)} : C'est toi qui abuses ! → +${log.pts} pts`;
        break;
      case 'gameEnded':
        text = `🏁 ${log.reason}`;
        break;
      default:
        text = JSON.stringify(log);
    }
    return `<div class="log-entry">${text}</div>`;
  }).join('');
  $('game-logs').scrollTop = $('game-logs').scrollHeight;
}

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

  const popup = $('challenge-popup');
  const body = $('challenge-popup-body');
  body.innerHTML = `
    <div class="popup-icon">${challengerLost ? '❌' : '✅'}</div>
    <div class="popup-text">
      <strong>Là t'abuses !</strong><br>
      ${challenger} challenge ${guested}<br>
      <span class="popup-detail">Supposition: ${lastLog.guessValue} · Réponse: ${lastLog.answer}</span><br>
      <span class="popup-result ${challengerLost ? 'text-red' : 'text-green'}">
        ${challengerLost ? `${challenger} se trompe ! +${lastLog.pts} pts` : `${guessed} s'est trompé ! +${lastLog.pts} pts`}
      </span>
    </div>
  `;
  popup.classList.remove('hidden');
  popup.classList.remove('popup-hide');
  popup.classList.add('popup-show');

  setTimeout(() => {
    popup.classList.remove('popup-show');
    popup.classList.add('popup-hide');
    setTimeout(() => popup.classList.add('hidden'), 500);
  }, 4000);
}

function renderEnd(state) {
  showScreen('end-screen');

  const loser = state.players.reduce((a, b) => a.penaltyPoints > b.penaltyPoints ? a : b);
  const winners = state.players.filter((p) => p.id !== loser.id);

  $('end-result').innerHTML = `
    <h2>😵 ${escapeHtml(loser.name)} a perdu !</h2>
    <p>Avec ${loser.penaltyPoints} points de pénalité</p>
    <p>🎉 Félicitations aux gagnants : ${winners.map((w) => escapeHtml(w.name)).join(', ')}</p>
  `;

  $('end-scores').innerHTML = state.players.map((p) => `
    <div class="player-card ${p.id === loser.id ? 'eliminated' : ''}">
      <div class="player-name">${getAvatar(p.name)} ${escapeHtml(p.name)} ${p.id === loser.id ? '😵' : '🎉'}</div>
      <div class="player-points">⚠️ ${p.penaltyPoints} pts</div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

socket.on('gameUpdate', (gameState) => {
  state = gameState;

  if (gameState.status === 'waiting') {
    showScreen('lobby-game-screen');
    renderLobby(gameState);
  } else if (gameState.status === 'playing') {
    renderGame(gameState);
  } else if (gameState.status === 'ended') {
    renderEnd(gameState);
  }
});

tryReconnect();

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
