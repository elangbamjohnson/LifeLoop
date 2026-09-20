import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { db } from '../src/db';
import { itemsRouter } from '../src/server/api/v1/items';
import { familiesRouter } from '../src/server/api/v1/families';
import { relationsRouter } from '../src/server/api/v1/relations';
import { capturesRouter } from '../src/server/api/v1/captures';
import { remindersRouter } from '../src/server/api/v1/reminders';
import { authRouter } from '../src/server/api/v1/auth';
import { askRouter } from '../src/server/api/v1/ask';
import { healthRouter } from '../src/server/api/health';
import { errorHandler } from '../src/server/middlewares/errorHandler';
import { UUID_PARAM_REGEX } from '../src/server/middlewares/validation';

describe('Route Inventory & Input Validation Coverage', () => {
  const routers = [
    { name: 'itemsRouter', prefix: '/api/v1/items', router: itemsRouter },
    { name: 'familiesRouter', prefix: '/api/v1/families', router: familiesRouter },
    { name: 'relationsRouter', prefix: '/api/v1/relations', router: relationsRouter },
    { name: 'capturesRouter', prefix: '/api/v1/captures', router: capturesRouter },
    { name: 'remindersRouter', prefix: '/api/v1/reminders', router: remindersRouter },
    { name: 'authRouter', prefix: '/api/v1/auth', router: authRouter },
    { name: 'askRouter', prefix: '/api/v1/ask', router: askRouter },
    { name: 'healthRouter', prefix: '/api/v1/health', router: healthRouter },
  ];

  const validToken = jwt.sign(
    { userId: '00000000-0000-0000-0000-000000000001' },
    process.env.JWT_SECRET || 'local_dev_secret_key'
  );

  it('should inventory every route and ensure all id parameters matching /^id$|Id$/ are covered by UUID validation', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Inject mock user id into requests
    app.use((req, _res, next) => {
      (req as any).userId = '00000000-0000-0000-0000-000000000001';
      next();
    });

    for (const { prefix, router } of routers) {
      app.use(prefix, router);
    }
    app.use(errorHandler);

    const routesWithIdParams: { routerName: string; method: string; path: string; fullPath: string; idParams: string[] }[] = [];

    for (const { name, prefix, router } of routers) {
      const stack = router.stack || [];
      for (const layer of stack) {
        if (layer.route && typeof layer.route.path === 'string') {
          const routePath = layer.route.path;
          const methods = Object.keys(layer.route.methods);
          const paramMatches = routePath.match(/:([a-zA-Z0-9_]+)/g) || [];
          const idParams = paramMatches
            .map((p: string) => p.substring(1))
            .filter((p: string) => UUID_PARAM_REGEX.test(p));

          if (idParams.length > 0) {
            for (const method of methods) {
              routesWithIdParams.push({
                routerName: name,
                method: method.toUpperCase(),
                path: routePath,
                fullPath: `${prefix}${routePath}`,
                idParams,
              });
            }
          }
        }
      }
    }

    // Must have found parameterised routes
    expect(routesWithIdParams.length).toBeGreaterThan(0);

    // Verify every single route with an id param returns 400 when given 'not-a-uuid'
    for (const route of routesWithIdParams) {
      let targetUrl = route.fullPath;
      for (const p of route.idParams) {
        targetUrl = targetUrl.replace(`:${p}`, 'not-a-uuid');
      }
      targetUrl = targetUrl.replace(/:[a-zA-Z0-9_]+/g, 'dummy_token');

      let reqCall: any;
      if (route.method === 'GET') reqCall = request(app).get(targetUrl);
      else if (route.method === 'POST') reqCall = request(app).post(targetUrl).send({});
      else if (route.method === 'PATCH') reqCall = request(app).patch(targetUrl).send({});
      else if (route.method === 'DELETE') reqCall = request(app).delete(targetUrl);
      else continue;

      const res = await reqCall.set('Cookie', `session=${validToken}`);
      expect(res.status).toBe(400);
      if (typeof res.body?.error !== 'string') {
        console.log('NO STRING ERROR ON ROUTE:', route.method, route.fullPath, 'body:', res.body);
      }
      expect(String(res.body?.error || '')).toContain('Invalid identifier format');
    }
  });

  it('should validate req.query.*Id and return 400 for non-uuid query parameters', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/items', itemsRouter);
    app.use(errorHandler);

    const res = await request(app)
      .get('/api/v1/items?familyId=not-a-valid-uuid')
      .set('Cookie', `session=${validToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid identifier format for query parameter 'familyId'");
  });

  it('should stop missing required fields in validation before the database query is executed', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/relations', relationsRouter);
    app.use(errorHandler);

    // Spy on db.insert to ensure it is NEVER called when validation fails
    const insertSpy = vi.spyOn(db, 'insert');

    const res = await request(app)
      .post('/api/v1/relations')
      .set('Cookie', `session=${validToken}`)
      .send({
        sourceItemId: '00000000-0000-0000-0000-000000000001',
        // targetItemId missing!
        relationshipType: 'belongs_to',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing or invalid identifier format for 'targetItemId'");
    // Crucial: proves validation stopped the request BEFORE reaching db.insert
    expect(insertSpy).not.toHaveBeenCalled();

    insertSpy.mockRestore();
  });

  it('should map Postgres driver UNDEFINED_VALUE to a logged 500 without query params or SQL in response', async () => {
    const app = express();
    app.use(express.json());

    // Route that simulates an unhandled Postgres UNDEFINED_VALUE driver error
    app.get('/api/v1/test-undefined-value', (_req, _res, next) => {
      const driverError: any = new Error('Undefined values are not allowed');
      driverError.code = 'UNDEFINED_VALUE';
      const drizzleError = new Error('Failed query: select * from users where id = $1');
      (drizzleError as any).cause = driverError;
      next(drizzleError);
    });
    app.use(errorHandler);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/v1/test-undefined-value?secret=123&token=abc');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Internal Server Error',
      message: 'Internal Server Error',
    });
    // Response body must NEVER contain SQL
    expect(JSON.stringify(res.body)).not.toContain('select');
    expect(JSON.stringify(res.body)).not.toContain('users');

    // Error log must log route name without query params and no SQL
    expect(errorSpy).toHaveBeenCalled();
    const logCall = errorSpy.mock.calls[0][0];
    expect(logCall).toContain('/api/v1/test-undefined-value');
    expect(logCall).not.toContain('secret=123');
    expect(logCall).not.toContain('token=abc');
    expect(logCall).not.toContain('select *');

    errorSpy.mockRestore();
  });
});
