const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { getRedis } = require('./src/redis');
const { LaTabusesGame } = require('./src/games/la-t-abuses');
const { LeTozGame } = require('./src/games/le-toz');
const questions = require('./questions/la-t-abuses.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const redis = getRedis();
const laTabusesEngine = new LaTabusesGame(redis);
const leTozEngine = new LeTozGame(redis);

let pendingQuestions = {};

function getEngine(gameType) {
  if (gameType === 'le-toz') return leTozEngine;
  return laTabusesEngine;
}

async function getEngineByGameId(gameId) {
  let state = await laTabusesEngine.getGame(gameId);
  if (!state) throw new Error('Partie introuvable');
  const engine = state.gameType === 'le-toz' ? leTozEngine : laTabusesEngine;
  return { engine, state };
}

function getRandomQuestion(gameId) {
  const used = pendingQuestions[gameId] || [];
  const available = questions.filter((q) => !used.includes(q.id));
  if (available.length === 0) {
    pendingQuestions[gameId] = [];
    return questions[Math.floor(Math.random() * questions.length)];
  }
  const q = available[Math.floor(Math.random() * available.length)];
  used.push(q.id);
  pendingQuestions[gameId] = used;
  return q;
}

const disconnectTimers = {};

function scheduleLobbyCleanup(gameId) {
  if (disconnectTimers[gameId]) clearTimeout(disconnectTimers[gameId]);
  disconnectTimers[gameId] = setTimeout(async () => {
    try {
      const room = io.sockets.adapter.rooms.get(gameId);
      if (room && room.size > 0) { delete disconnectTimers[gameId]; return; }
      const state = await laTabusesEngine.getGame(gameId);
      if (state && state.status === 'waiting') {
        await redis.del('game:' + gameId);
        console.log(`Lobby ${gameId} supprimé (inactivité 30s)`);
      }
    } catch (e) { /* déjà supprimé */ }
    delete disconnectTimers[gameId];
  }, 30000);
}

function emitState(io, gameId, state) {
  const safeState = {
    id: state.id,
    status: state.status,
    gameType: state.gameType || 'la-t-abuses',
    players: state.players,
    turnOrder: state.turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    currentQuestion: state.currentQuestion
      ? { id: state.currentQuestion.id, text: state.currentQuestion.text, category: state.currentQuestion.category, difficulty: state.currentQuestion.difficulty, answer: state.currentQuestion.answer }
      : null,
    nsfwLevel: state.nsfwLevel || 0,
    isSolo: state.isSolo || false,
    currentCard: state.currentCard || null,
    currentPlayerId: state.currentPlayerId || null,
    currentGuess: state.currentGuess,
    lastGuessValue: state.lastGuessValue,
    lastGuesserId: state.lastGuesserId,
    variantRules: state.variantRules || [],
    penaltyThreshold: state.penaltyThreshold,
    hostId: state.hostId,
    logs: state.logs.slice(-50),
  };
  io.to(gameId).emit('gameUpdate', safeState);
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('createGame', async ({ playerName, playerAvatar, gameType, variantRules, nsfwLevel, isSolo, soloPlayerNames }, callback) => {
    try {
      const playerId = socket.id;
      const engine = gameType === 'le-toz' ? leTozEngine : laTabusesEngine;
      const state = await engine.createGame(playerId, playerName, playerAvatar, variantRules || [], nsfwLevel, isSolo, soloPlayerNames || []);
      socket.join(state.id);
      socket.gameId = state.id;
      clearTimeout(disconnectTimers[state.id]);
      emitState(io, state.id, state);
      if (callback) callback({ success: true, gameId: state.id, playerId });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('joinGame', async ({ gameId, playerName, playerAvatar }, callback) => {
    try {
      const { engine, state } = await getEngineByGameId(gameId);
      const newState = await engine.joinGame(gameId, socket.id, playerName, playerAvatar);
      socket.join(gameId);
      socket.gameId = gameId;
      clearTimeout(disconnectTimers[gameId]);
      emitState(io, gameId, newState);
      if (callback) callback({ success: true, gameId, playerId: socket.id });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('updateAvatar', async ({ gameId, avatar }, callback) => {
    try {
      const { engine, state } = await getEngineByGameId(gameId);
      const player = state.players.find((p) => p.id === socket.id);
      if (!player) throw new Error('Joueur introuvable');
      player.avatar = avatar;
      await engine.saveGame(state);
      emitState(io, gameId, state);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('startGame', async ({ gameId }, callback) => {
    try {
      const { engine, state } = await getEngineByGameId(gameId);
      if (state.gameType === 'le-toz') {
        const newState = await leTozEngine.startGame(gameId);
        emitState(io, gameId, newState);
      } else {
        const question = getRandomQuestion(gameId);
        const newState = await laTabusesEngine.startGame(gameId, question);
        emitState(io, gameId, newState);
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('submitGuess', async ({ gameId, guessValue }, callback) => {
    try {
      const result = await laTabusesEngine.submitGuess(gameId, socket.id, guessValue);
      emitState(io, gameId, result.state);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await laTabusesEngine.setQuestion(gameId, question);
        emitState(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('challenge', async ({ gameId }, callback) => {
    try {
      const result = await laTabusesEngine.challengeGuess(gameId, socket.id);
      emitState(io, gameId, result.state);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await laTabusesEngine.setQuestion(gameId, question);
        emitState(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('doubleDown', async ({ gameId }, callback) => {
    try {
      const result = await laTabusesEngine.doubleDown(gameId, socket.id);
      emitState(io, gameId, result.state);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await laTabusesEngine.setQuestion(gameId, question);
        emitState(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('drawCard', async ({ gameId }, callback) => {
    try {
      const state = await leTozEngine.drawCard(gameId);
      emitState(io, gameId, state);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('leaveGame', async ({ gameId }, callback) => {
    try {
      const { engine } = await getEngineByGameId(gameId);
      const state = await engine.leaveGame(gameId, socket.id);
      socket.leave(gameId);
      if (state) emitState(io, gameId, state);
      else scheduleLobbyCleanup(gameId);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('reconnectGame', async ({ gameId, playerName }, callback) => {
    try {
      const { engine, state } = await getEngineByGameId(gameId);
      const player = state.players.find((p) => p.name === playerName);
      if (!player) throw new Error('Joueur introuvable');
      const oldId = player.id;
      if (state.hostId === oldId) state.hostId = socket.id;
      const idx = state.turnOrder.indexOf(oldId);
      if (idx !== -1) state.turnOrder[idx] = socket.id;
      player.id = socket.id;
      socket.join(gameId);
      socket.gameId = gameId;
      clearTimeout(disconnectTimers[gameId]);
      await engine.saveGame(state);
      emitState(io, gameId, state);
      if (callback) callback({ success: true, gameId, playerId: socket.id });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('resetGame', async ({ gameId }, callback) => {
    try {
      const { engine } = await getEngineByGameId(gameId);
      const state = await engine.resetGame(gameId);
      emitState(io, gameId, state);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('getGameState', async ({ gameId }, callback) => {
    try {
      const state = await laTabusesEngine.getGame(gameId);
      if (callback) callback({ success: true, state });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (socket.gameId) {
      scheduleLobbyCleanup(socket.gameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
