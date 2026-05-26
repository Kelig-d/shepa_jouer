const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { getRedis } = require('./src/redis');
const { LaTabusesGame } = require('./src/games/la-t-abuses');
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
const gameEngine = new LaTabusesGame(redis);

let pendingQuestions = {};

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
  gameEngine.getGame(gameId).then((state) => {
    if (!state) return;
    const safeState = {
      id: state.id,
      status: state.status,
      players: state.players,
      turnOrder: state.turnOrder,
      currentTurnIndex: state.currentTurnIndex,
      currentQuestion: state.currentQuestion
        ? { id: state.currentQuestion.id, text: state.currentQuestion.text, category: state.currentQuestion.category, difficulty: state.currentQuestion.difficulty }
        : null,
      currentGuess: state.currentGuess,
      lastGuessValue: state.lastGuessValue,
      lastGuesserId: state.lastGuesserId,
      variantRules: state.variantRules,
      penaltyThreshold: state.penaltyThreshold,
      hostId: state.hostId,
      logs: state.logs.slice(-50),
    };
    io.to(gameId).emit('gameUpdate', safeState);
  });
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('createGame', async ({ playerName, variantRules }, callback) => {
    try {
      const playerId = socket.id;
      const state = await gameEngine.createGame(playerId, playerName, variantRules || []);
      socket.join(state.id);
      socket.emit('gameCreated', { gameId: state.id, playerId });
      emitGameUpdate(io, state.id);
      if (callback) callback({ success: true, gameId: state.id, playerId });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('joinGame', async ({ gameId, playerName }, callback) => {
    try {
      const playerId = socket.id;
      const state = await gameEngine.joinGame(gameId, playerId, playerName);
      socket.join(gameId);
      emitGameUpdate(io, gameId);
      if (callback) callback({ success: true, gameId, playerId });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('startGame', async ({ gameId }, callback) => {
    try {
      const question = getRandomQuestion(gameId);
      const state = await gameEngine.startGame(gameId, question);
      emitGameUpdate(io, gameId);
      if (callback) callback({ success: true, question: question.text });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('submitGuess', async ({ gameId, guessValue }, callback) => {
    try {
      const result = await gameEngine.submitGuess(gameId, socket.id, guessValue);
      emitGameUpdate(io, gameId);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await gameEngine.setQuestion(gameId, question);
        emitGameUpdate(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('challenge', async ({ gameId }, callback) => {
    try {
      const result = await gameEngine.challengeGuess(gameId, socket.id);
      emitGameUpdate(io, gameId);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await gameEngine.setQuestion(gameId, question);
        emitGameUpdate(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('doubleDown', async ({ gameId }, callback) => {
    try {
      const result = await gameEngine.doubleDown(gameId, socket.id);
      emitGameUpdate(io, gameId);
      if (result.state.status === 'ended') {
        io.to(gameId).emit('gameEnded', { reason: result.state.logs[result.state.logs.length - 1] });
      } else if (result.state.status === 'playing' && !result.state.currentQuestion) {
        const question = getRandomQuestion(gameId);
        await gameEngine.setQuestion(gameId, question);
        emitGameUpdate(io, gameId);
      }
      if (callback) callback({ success: true, ...result });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('leaveGame', async ({ gameId }, callback) => {
    try {
      const state = await gameEngine.leaveGame(gameId, socket.id);
      socket.leave(gameId);
      if (state) {
        emitGameUpdate(io, gameId);
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('reconnectGame', async ({ gameId, playerName }, callback) => {
    try {
      const state = await gameEngine.getGame(gameId);
      if (!state) throw new Error('Partie introuvable');
      const player = state.players.find((p) => p.name === playerName);
      if (!player) throw new Error('Joueur introuvable');
      if (state.hostId === player.id) state.hostId = socket.id;
      player.id = socket.id;
      socket.join(gameId);
      await gameEngine.saveGame(state);
      emitGameUpdate(io, gameId);
      if (callback) callback({ success: true, gameId, playerId: socket.id });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('getGameState', async ({ gameId }, callback) => {
    try {
      const state = await gameEngine.getGame(gameId);
      if (callback) callback({ success: true, state });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Player can reconnect via reconnectGame — don't remove them
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
