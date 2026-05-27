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

function getEngine(gameId, gameType) {
  if (gameType === 'le-toz') return leTozEngine;
  return laTabusesEngine;
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

function emitGameUpdate(io, gameId) {
  laTabusesEngine.getGame(gameId).then((state) => {
    if (state) return emitState(io, gameId, state);
    return leTozEngine.getGame(gameId);
  }).then((state) => {
    if (state) emitState(io, gameId, state);
  });
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

  socket.on('createGame', async ({ playerName, playerAvatar, gameType, variantRules, nsfwLevel, isSolo }, callback) => {
    try {
      const playerId = socket.id;
      const engine = gameType === 'le-toz' ? leTozEngine : laTabusesEngine;
      const state = await engine.createGame(playerId, playerName, playerAvatar, variantRules || [], nsfwLevel, isSolo);
      socket.join(state.id);
      emitState(io, state.id, state);
      if (callback) callback({ success: true, gameId: state.id, playerId });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('joinGame', async ({ gameId, playerName, playerAvatar }, callback) => {
    try {
      const playerId = socket.id;
      let state = await laTabusesEngine.getGame(gameId);
      if (state) {
        state = await laTabusesEngine.joinGame(gameId, playerId, playerName, playerAvatar);
      } else {
        state = await leTozEngine.getGame(gameId);
        if (state) {
          state = await leTozEngine.joinGame(gameId, playerId, playerName, playerAvatar);
        } else {
          throw new Error('Partie introuvable');
        }
      }
      socket.join(gameId);
      emitState(io, gameId, state);
      if (callback) callback({ success: true, gameId, playerId });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('updateAvatar', async ({ gameId, avatar }, callback) => {
    try {
      let state = await laTabusesEngine.getGame(gameId);
      const engine = state ? laTabusesEngine : leTozEngine;
      if (!state) state = await leTozEngine.getGame(gameId);
      if (!state) throw new Error('Partie introuvable');
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
      let state = await laTabusesEngine.getGame(gameId);
      if (state) {
        const question = getRandomQuestion(gameId);
        state = await laTabusesEngine.startGame(gameId, question);
        emitState(io, gameId, state);
        if (callback) callback({ success: true, question: question.text });
      } else {
        state = await leTozEngine.getGame(gameId);
        if (state) {
          state = await leTozEngine.startGame(gameId);
          emitState(io, gameId, state);
          if (callback) callback({ success: true });
        } else {
          throw new Error('Partie introuvable');
        }
      }
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
      let state = await laTabusesEngine.getGame(gameId);
      let engine = laTabusesEngine;
      if (!state) { state = await leTozEngine.getGame(gameId); engine = leTozEngine; }
      if (state) {
        state = await engine.leaveGame(gameId, socket.id);
        socket.leave(gameId);
        if (state) emitState(io, gameId, state);
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('reconnectGame', async ({ gameId, playerName }, callback) => {
    try {
      let state = await laTabusesEngine.getGame(gameId);
      let engine = laTabusesEngine;
      if (!state) { state = await leTozEngine.getGame(gameId); engine = leTozEngine; }
      if (!state) throw new Error('Partie introuvable');
      const player = state.players.find((p) => p.name === playerName);
      if (!player) throw new Error('Joueur introuvable');
      const oldId = player.id;
      if (state.hostId === oldId) state.hostId = socket.id;
      const idx = state.turnOrder.indexOf(oldId);
      if (idx !== -1) state.turnOrder[idx] = socket.id;
      player.id = socket.id;
      socket.join(gameId);
      await engine.saveGame(state);
      emitState(io, gameId, state);
      if (callback) callback({ success: true, gameId, playerId: socket.id });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('resetGame', async ({ gameId }, callback) => {
    try {
      let state = await laTabusesEngine.getGame(gameId);
      let engine = laTabusesEngine;
      if (!state) { state = await leTozEngine.getGame(gameId); engine = leTozEngine; }
      if (state) {
        state = await engine.resetGame(gameId);
        emitState(io, gameId, state);
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('getGameState', async ({ gameId }, callback) => {
    try {
      let state = await laTabusesEngine.getGame(gameId);
      if (!state) state = await leTozEngine.getGame(gameId);
      if (callback) callback({ success: true, state });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
