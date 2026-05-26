const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = parseInt(process.env.REDIS_PORT);
const REDIS_TLS = process.env.REDIS_TLS === 'true';
const REDIS_PASS = process.env.REDIS_PASS;
let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      tls: REDIS_TLS ? {} : undefined,
      password: REDIS_PASS,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('Connected to Redis');
    });
  }
  return redis;
}

async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

module.exports = { getRedis, closeRedis };
