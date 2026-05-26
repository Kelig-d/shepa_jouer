const socket = io();
let state = null;
let myPlayerId = null;
let currentGameId = null;

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
  if ($('variant-pilepoil').checked) variantRules.push('pilepoil');

  try {
    const res = await emitWithCallback('createGame', { playerName, variantRules });
    currentGameId = res.gameId;
    myPlayerId = res.playerId;
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
    showLobby();
  } catch (err) {
    showError(err.message);
  }
});

$('btn-leave-lobby').addEventListener('click', async () => {
  try {
    await emitWithCallback('leaveGame', { gameId: currentGameId });
  } catch (e) {}
  currentGameId = null;
  myPlayerId = null;
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

$('btn-pile-poil').addEventListener('click', async () => {
  try {
    await emitWithCallback('pilePoil', { gameId: currentGameId });
  } catch (err) {
    showError(err.message);
  }
});

$('btn-leave-game').addEventListener('click', async () => {
  try {
    await emitWithCallback('leaveGame', { gameId: currentGameId });
  } catch (e) {}
  currentGameId = null;
  myPlayerId = null;
  showScreen('lobby-screen');
});

$('btn-replay').addEventListener('click', () => {
  currentGameId = null;
  myPlayerId = null;
  showScreen('lobby-screen');
});

$('btn-back-lobby').addEventListener('click', () => {
  currentGameId = null;
  myPlayerId = null;
  showScreen('lobby-screen');
});

function showLobby() {
  showScreen('lobby-game-screen');
}

document.addEventListener('click', (e) => {
  const codeEl = e.target.closest('#lobby-game-code');
  if (codeEl) {
    navigator.clipboard.writeText(codeEl.textContent).catch(() => {});
  }
});

function renderLobby(state) {
  $('lobby-game-code').textContent = state.id;
  $('lobby-host').textContent = state.players.find((p) => p.id === state.hostId)?.name || 'Inconnu';
  $('lobby-player-count').textContent = state.players.length;

  const variants = [];
  if (state.variantRules.includes('double')) variants.push('C\'est toi qui abuses');
  if (state.variantRules.includes('pilepoil')) variants.push('Pile-poil');
  $('lobby-variants').textContent = variants.length ? variants.join(', ') : 'Aucune';

  $('lobby-players').innerHTML = state.players.map((p) => `
    <li>
      <span>${escapeHtml(p.name)}</span>
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

  $('threshold-display').textContent = `0/${state.penaltyThreshold}`;

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

  const lastGuessInfo = $('last-guess-info');
  if (state.lastGuessValue !== null && state.lastGuesserId) {
    const guesser = state.players.find((p) => p.id === state.lastGuesserId);
    lastGuessInfo.classList.remove('hidden');
    $('last-guess-value').textContent = state.lastGuessValue;
    $('last-guess-player').textContent = guesser ? guesser.name : 'Inconnu';
  } else {
    lastGuessInfo.classList.add('hidden');
  }

  const currentPlayerId = state.turnOrder[state.currentTurnIndex];
  const isMyTurn = currentPlayerId === myPlayerId;

  const guessControls = $('guess-controls');
  const guessBtn = $('btn-submit-guess');
  const challengeBtn = $('btn-challenge');
  const doubleDownBtn = $('btn-double-down');
  const pilePoilBtn = $('btn-pile-poil');

  // Current player can EITHER guess higher OR challenge
  if (state.status === 'playing' && isMyTurn) {
    if (state.lastGuesserId !== myPlayerId) {
      // Can guess - only if I didn't make the last guess
      guessControls.classList.remove('hidden');
      guessBtn.disabled = false;
    } else {
      guessControls.classList.add('hidden');
      guessBtn.disabled = true;
    }

    // Can challenge if there's a last guess by someone else
    if (state.lastGuessValue !== null && state.lastGuesserId !== myPlayerId) {
      challengeBtn.classList.remove('hidden');
      challengeBtn.disabled = false;
    } else {
      challengeBtn.classList.add('hidden');
      challengeBtn.disabled = true;
    }

    // Double down: if I made the last guess and variant is active, I can respond to a challenge
    if (state.lastGuesserId === myPlayerId && state.variantRules.includes('double')) {
      doubleDownBtn.classList.remove('hidden');
      doubleDownBtn.disabled = false;
    } else {
      doubleDownBtn.classList.add('hidden');
      doubleDownBtn.disabled = true;
    }
  } else {
    guessControls.classList.add('hidden');
    guessBtn.disabled = true;
    challengeBtn.classList.add('hidden');
    challengeBtn.disabled = true;
    doubleDownBtn.classList.add('hidden');
    doubleDownBtn.disabled = true;
  }

  // Pile-poil can be said by ANY player (not the last guesser)
  if (state.status === 'playing' && state.lastGuessValue !== null && myPlayerId !== state.lastGuesserId && state.variantRules.includes('pilepoil')) {
    pilePoilBtn.classList.remove('hidden');
    pilePoilBtn.disabled = false;
  } else {
    pilePoilBtn.classList.add('hidden');
    pilePoilBtn.disabled = true;
  }

  // Player grid
  const myPts = state.players.find((p) => p.id === myPlayerId)?.penaltyPoints || 0;
  const maxPts = state.penaltyThreshold;

  $('threshold-display').textContent = `${myPts}/${maxPts}`;

  $('game-players').innerHTML = state.players.map((p) => {
    const isCurrent = state.turnOrder[state.currentTurnIndex] === p.id;
    const eliminated = p.penaltyPoints >= maxPts || state.status === 'ended';
    const pct = Math.min(100, (p.penaltyPoints / maxPts) * 100);
    return `
      <div class="player-card ${isCurrent && state.status === 'playing' ? 'current-turn' : ''} ${eliminated ? 'eliminated' : ''}">
        <div class="player-name">${escapeHtml(p.name)} ${p.id === myPlayerId ? '(Vous)' : ''}</div>
        <div class="player-points">⚠️ ${p.penaltyPoints}/${maxPts} pts</div>
        <div class="penalty-bar">
          <div class="penalty-bar-fill" style="width: ${pct}%"></div>
        </div>
        ${isCurrent && state.status === 'playing' ? '<div class="turn-indicator">▶ À vous de jouer</div>' : ''}
      </div>
    `;
  }).join('');

  // Logs
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
        text = `🔢 ${p(log.playerId)} a deviné ${log.guessValue}`;
        break;
      case 'challenge':
        text = `🚨 ${p(log.challengerId)} dit "Là t'abuses!" → ${p(log.loserId)} perd +${log.pts} pts (${log.guessValue} vs ${log.answer})`;
        break;
      case 'doubleDown':
        text = `🔥 ${p(log.playerId)} dit "C'est toi qui abuses!" → +${log.pts} pts`;
        break;
      case 'pilePoil':
        text = `🎯 ${p(log.playerId)} dit "Pile-poil!" (${log.result === 'success' ? '✅ Réussi, personne ne prend de points' : '❌ Échec'})`;
        break;
      case 'gameEnded':
        text = `🏁 Partie terminée : ${log.reason}`;
        break;
      default:
        text = JSON.stringify(log);
    }
    return `<div class="log-entry">${text}</div>`;
  }).join('');

  const logsContainer = $('game-logs');
  logsContainer.scrollTop = logsContainer.scrollHeight;
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
      <div class="player-name">${escapeHtml(p.name)} ${p.id === loser.id ? '😵' : '🎉'}</div>
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
