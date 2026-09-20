import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp } from './setup';
import { db } from '../src/db';
import { users, items, captures } from '../src/db/schema';
import { eventBus } from '../src/server/services/EventBus';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

describe('Live Sync SSE Route & EventBus - Integration Tests', () => {
  const app = createTestApp();
  const server = app as unknown as http.Server;
  let port: number;

  let userAId: string;
  let userBId: string;
  let authCookieA: string;
  let authCookieB: string;

  beforeAll(async () => {
    const address = server.address();
    if (typeof address === 'object' && address !== null) {
      port = address.port;
    }

    userAId = uuidv4();
    userBId = uuidv4();

    await db.insert(users).values([
      {
        id: userAId,
        email: `sync_user_a_${userAId}@test.com`,
        passwordHash: 'dummy',
      },
      {
        id: userBId,
        email: `sync_user_b_${userBId}@test.com`,
        passwordHash: 'dummy',
      },
    ]);

    authCookieA = `session=${jwt.sign({ userId: userAId }, JWT_SECRET)}`;
    authCookieB = `session=${jwt.sign({ userId: userBId }, JWT_SECRET)}`;
  });

  afterAll(async () => {
    // cleanup
  });

  // Helper to open an SSE connection
  function connectSSE(cookie: string, clientId?: string): Promise<{
    req: http.ClientRequest;
    res: http.IncomingMessage;
    messages: string[];
    waitForMessage: (predicate: (msg: string) => boolean, timeoutMs?: number) => Promise<string>;
    close: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const messages: string[] = [];
      const listeners: Array<(msg: string) => void> = [];

      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/v1/events${query}`,
          method: 'GET',
          headers: {
            Cookie: cookie,
            Accept: 'text/event-stream',
          },
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            messages.push(chunk);
            for (const listener of [...listeners]) {
              listener(chunk);
            }
          });

          const waitForMessage = (predicate: (msg: string) => boolean, timeoutMs = 4000) => {
            // Check if already received
            for (const msg of messages) {
              if (predicate(msg)) return Promise.resolve(msg);
            }
            return new Promise<string>((resResolve, resReject) => {
              const timer = setTimeout(() => {
                const idx = listeners.indexOf(onMsg);
                if (idx !== -1) listeners.splice(idx, 1);
                resReject(new Error(`Timed out waiting for SSE message. Received: ${JSON.stringify(messages)}`));
              }, timeoutMs);

              const onMsg = (msg: string) => {
                if (predicate(msg)) {
                  clearTimeout(timer);
                  const idx = listeners.indexOf(onMsg);
                  if (idx !== -1) listeners.splice(idx, 1);
                  resResolve(msg);
                }
              };
              listeners.push(onMsg);
            });
          };

          const close = () => {
            req.destroy();
          };

          resolve({ req, res, messages, waitForMessage, close });
        }
      );

      req.on('error', reject);
      req.end();
    });
  }

  it('1. returns 401 without session cookie', async () => {
    const res = await request(app).get('/api/v1/events');
    expect(res.status).toBe(401);
  });

  it('2. sets correct SSE response headers and sends connected comment', async () => {
    const { res, close, waitForMessage } = await connectSSE(authCookieA);
    try {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['connection']).toBe('keep-alive');
      expect(res.headers['x-accel-buffering']).toBe('no');
      expect(res.headers['content-encoding']).toBe('identity');

      const msg = await waitForMessage((m) => m.includes(': connected'));
      expect(msg).toContain(': connected');
    } finally {
      close();
    }
  });

  it('3. publishes event after item create / update / delete / snooze / complete', async () => {
    const { waitForMessage, close } = await connectSSE(authCookieA, 'tab-test-listener');

    try {
      // 3a. Create item
      const createPromise = waitForMessage((m) => m.includes('"entity":"item"'));
      const createRes = await request(app)
        .post('/api/v1/items')
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-other-device')
        .send({
          title: 'Live Sync Test Task',
          itemType: 'task',
          status: 'active',
        });
      expect(createRes.status).toBe(201);
      const itemId = createRes.body.item.id;

      const createMsg = await createPromise;
      expect(createMsg).toContain('data:');
      const createData = JSON.parse(createMsg.replace(/^data:\s*/, '').trim());
      expect(createData.type).toBe('changed');
      expect(createData.entity).toBe('item');
      expect(createData.id).toBe(itemId);
      expect(createData.origin).toBe('tab-other-device');

      // 3b. Update item
      const updatePromise = waitForMessage((m) => m.includes('"entity":"item"') && m.includes(itemId));
      const updateRes = await request(app)
        .patch(`/api/v1/items/${itemId}`)
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-other-device')
        .send({ title: 'Updated Live Sync Title' });
      expect(updateRes.status).toBe(200);
      const updateMsg = await updatePromise;
      expect(updateMsg).toContain(itemId);

      // 3c. Snooze item
      const snoozePromise = waitForMessage((m) => m.includes('"entity":"item"') && m.includes(itemId));
      const snoozeRes = await request(app)
        .post(`/api/v1/items/${itemId}/snooze`)
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-other-device')
        .send({ snoozeDays: 2 });
      expect(snoozeRes.status).toBe(200);
      await snoozePromise;

      // 3d. Complete item
      const completePromise = waitForMessage((m) => m.includes('"entity":"item"') && m.includes(itemId));
      const completeRes = await request(app)
        .post(`/api/v1/items/${itemId}/complete`)
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-other-device')
        .send({ completed: true });
      expect(completeRes.status).toBe(200);
      await completePromise;

      // 3e. Delete item
      const deletePromise = waitForMessage((m) => m.includes('"entity":"item"') && m.includes(itemId));
      const deleteRes = await request(app)
        .delete(`/api/v1/items/${itemId}`)
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-other-device');
      expect(deleteRes.status).toBe(200);
      await deletePromise;
    } finally {
      close();
    }
  });

  it('4. publishes event after capture creation and AI completion', async () => {
    const { waitForMessage, close } = await connectSSE(authCookieA);

    try {
      const capturePromise = waitForMessage((m) => m.includes('"entity":"capture"'));
      const capRes = await request(app)
        .post('/api/v1/captures')
        .set('Cookie', authCookieA)
        .set('X-Client-Id', 'tab-creator')
        .send({
          type: 'text',
          rawPayload: 'Doctor appointment next Friday at 3pm',
        });
      expect(capRes.status).toBe(201);
      const captureId = capRes.body.capture.id;

      const msg = await capturePromise;
      expect(msg).toContain('capture');
      expect(msg).toContain(captureId);

      // Wait for AI async processing to complete (which emits capture + item)
      const aiCompletedMsg = await waitForMessage(
        (m) => m.includes('"entity":"capture"') || m.includes('"entity":"item"')
      );
      expect(aiCompletedMsg).toBeTruthy();
    } finally {
      close();
    }
  });

  it('5. User B never receives User A events', async () => {
    const clientA = await connectSSE(authCookieA);
    const clientB = await connectSSE(authCookieB);

    try {
      // Clear initial connected messages
      await clientA.waitForMessage((m) => m.includes(': connected'));
      await clientB.waitForMessage((m) => m.includes(': connected'));

      // User A creates an item
      const itemPromiseA = clientA.waitForMessage((m) => m.includes('"entity":"item"'));
      await request(app)
        .post('/api/v1/items')
        .set('Cookie', authCookieA)
        .send({ title: 'Secret Item for User A', itemType: 'task' });

      await itemPromiseA;

      // Wait 300ms and check that clientB received NO data events
      await new Promise((r) => setTimeout(r, 300));
      const clientBDataEvents = clientB.messages.filter((m) => m.startsWith('data:'));
      expect(clientBDataEvents).toHaveLength(0);
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('6. Payload contains no content fields (only type, entity, id, at, origin)', async () => {
    const { waitForMessage, close } = await connectSSE(authCookieA);

    try {
      const msgPromise = waitForMessage((m) => m.includes('"entity":"item"'));
      await request(app)
        .post('/api/v1/items')
        .set('Cookie', authCookieA)
        .send({
          title: 'Top Secret Content That Should Never Be In SSE Payload',
          itemType: 'task',
        });

      const msg = await msgPromise;
      const jsonStr = msg.replace(/^data:\s*/, '').trim();
      const payload = JSON.parse(jsonStr);

      // Verify required fields
      expect(payload.type).toBe('changed');
      expect(payload.entity).toBe('item');
      expect(payload.at).toBeTruthy();

      // Verify no sensitive / content fields are leaked
      expect(payload.title).toBeUndefined();
      expect(payload.rawPayload).toBeUndefined();
      expect(payload.description).toBeUndefined();
      expect(payload.metadata).toBeUndefined();
    } finally {
      close();
    }
  });

  it('7. Connection count drops after client disconnect', async () => {
    // Wait for any trailing connections from prior tests to close
    const start = Date.now();
    while (eventBus.getConnectionCount(userAId) > 0 && Date.now() - start < 1000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const client = await connectSSE(authCookieA);
    await client.waitForMessage((m) => m.includes(': connected'));

    expect(eventBus.getConnectionCount(userAId)).toBe(1);

    client.close();

    // Wait for close event to propagate on server
    const closeStart = Date.now();
    while (eventBus.getConnectionCount(userAId) > 0 && Date.now() - closeStart < 1000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(eventBus.getConnectionCount(userAId)).toBe(0);
  });

  it('8. Caps at 5 SSE streams per user; 6th open closes the 1st', async () => {
    const connections: Array<Awaited<ReturnType<typeof connectSSE>>> = [];

    try {
      for (let i = 0; i < 5; i++) {
        const conn = await connectSSE(authCookieA);
        await conn.waitForMessage((m) => m.includes(': connected'));
        connections.push(conn);
      }

      expect(eventBus.getConnectionCount(userAId)).toBe(5);

      // Track if 1st connection ends or receives replacement comment
      let firstConnEnded = false;
      connections[0].res.on('end', () => {
        firstConnEnded = true;
      });

      // Open 6th connection
      const sixthConn = await connectSSE(authCookieA);
      await sixthConn.waitForMessage((m) => m.includes(': connected'));
      connections.push(sixthConn);

      // Allow event loop to process
      await new Promise((r) => setTimeout(r, 150));

      expect(firstConnEnded).toBe(true);
      expect(eventBus.getConnectionCount(userAId)).toBeLessThanOrEqual(5);
    } finally {
      for (const conn of connections) {
        conn.close();
      }
    }
  });
});
