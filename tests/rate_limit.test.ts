import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import request from 'supertest';

describe('Auth Rate Limiter - Dedicated App Instance', () => {
  it('should enforce 429 Too Many Requests when rate limit threshold is exceeded', async () => {
    const app = express();
    app.use(express.json());

    // Dedicated rate limiter instance for this test
    const strictLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 3, // Allow max 3 attempts
      message: { error: 'Too many login attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.post('/api/v1/auth/login', strictLimiter, (_req, res) => {
      res.status(401).json({ error: 'Invalid email or password' });
    });

    const server = http.createServer(app);
    const poolId = parseInt(process.env.VITEST_POOL_ID || '1', 10);
    await new Promise<void>((resolve) => {
      server.listen(35000 + (poolId * 100) + 99, '127.0.0.1', () => resolve());
    });
    try {

    // 1st request -> allowed (401)
    const res1 = await request(server).post('/api/v1/auth/login').send({ email: 'test@example.com', password: 'wrong' });
    expect(res1.status).toBe(401);

    // 2nd request -> allowed (401)
    const res2 = await request(server).post('/api/v1/auth/login').send({ email: 'test@example.com', password: 'wrong' });
    expect(res2.status).toBe(401);

    // 3rd request -> allowed (401)
    const res3 = await request(server).post('/api/v1/auth/login').send({ email: 'test@example.com', password: 'wrong' });
    expect(res3.status).toBe(401);

    // 4th request -> blocked by limiter (429)
    const res4 = await request(server).post('/api/v1/auth/login').send({ email: 'test@example.com', password: 'wrong' });
    expect(res4.status).toBe(429);
    expect(res4.body.error).toBe('Too many login attempts, please try again later');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
