import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users, items, itemRelations, captures } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { itemsRouter } from '../src/server/api/v1/items';
import { relationsRouter } from '../src/server/api/v1/relations';
import { capturesRouter } from '../src/server/api/v1/captures';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/items', itemsRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 6: Life Graph, Entities & Relationships (P0/P1)', () => {
  const userAId = uuidv4();
  const userBId = uuidv4();
  let authCookieA: string;
  let authCookieB: string;

  let vehicleEntityId: string;
  let receiptDocId: string;
  let createdRelationId: string;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userAId, email: `graph_a_${userAId}@example.com`, passwordHash: 'hashA' },
      { id: userBId, email: `graph_b_${userBId}@example.com`, passwordHash: 'hashB' },
    ]);
    authCookieA = `session=${jwt.sign({ userId: userAId }, JWT_SECRET)}`;
    authCookieB = `session=${jwt.sign({ userId: userBId }, JWT_SECRET)}`;
  });

  afterAll(async () => {
    await db.delete(itemRelations).where(inArray(itemRelations.userId, [userAId, userBId]));
    await db.delete(items).where(inArray(items.userId, [userAId, userBId]));
    await db.delete(captures).where(inArray(captures.userId, [userAId, userBId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  });

  // 1. Entity CRUD via API
  it('should create an Entity (Vehicle) through the API via POST /api/v1/items', async () => {
    const res = await request(app)
      .post('/api/v1/items')
      .set('Cookie', authCookieA)
      .send({
        title: 'Honda City 2023',
        itemType: 'vehicle',
        status: 'active',
        metadata: {
          make: 'Honda',
          model: 'City',
          year: 2023,
          licensePlate: 'KA-01-AB-1234',
          keywords: ['honda', 'city', 'car', 'vehicle'],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.item).toBeDefined();
    expect(res.body.item.title).toBe('Honda City 2023');
    expect(res.body.item.itemType).toBe('vehicle');
    vehicleEntityId = res.body.item.id;
  });

  it('should retrieve the Entity via GET /api/v1/items/:id', async () => {
    const res = await request(app)
      .get(`/api/v1/items/${vehicleEntityId}`)
      .set('Cookie', authCookieA);

    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe(vehicleEntityId);
    expect(res.body.item.metadata.make).toBe('Honda');
  });

  it('should update Entity details via PATCH /api/v1/items/:id', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${vehicleEntityId}`)
      .set('Cookie', authCookieA)
      .send({
        title: 'Honda City ZX (Updated)',
        metadata: {
          make: 'Honda',
          model: 'City ZX',
          year: 2023,
          licensePlate: 'KA-01-AB-1234',
          keywords: ['honda', 'city', 'car', 'vehicle'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.item.title).toBe('Honda City ZX (Updated)');
  });

  // 2. Relationship Creation & Retrieval
  it('should create an associated Document/Receipt item and link relationship to the Vehicle entity', async () => {
    // Create Document
    const docRes = await request(app)
      .post('/api/v1/items')
      .set('Cookie', authCookieA)
      .send({
        title: 'Oil Change & Brake Service Invoice',
        itemType: 'document',
        status: 'active',
        metadata: { cost: 4200, serviceType: 'Maintenance' },
      });
    expect(docRes.status).toBe(201);
    receiptDocId = docRes.body.item.id;

    // Create Relation: Invoice -> belongs_to -> Honda City
    const relRes = await request(app)
      .post('/api/v1/relations')
      .set('Cookie', authCookieA)
      .send({
        sourceItemId: receiptDocId,
        targetItemId: vehicleEntityId,
        relationshipType: 'belongs_to',
        metadata: { notes: '10,000km scheduled maintenance' },
      });

    expect(relRes.status).toBe(200);
    expect(relRes.body.sourceItemId).toBe(receiptDocId);
    expect(relRes.body.targetItemId).toBe(vehicleEntityId);
    expect(relRes.body.relationshipType).toBe('belongs_to');
    createdRelationId = relRes.body.id;
  });

  it('should retrieve relationships for an entity via GET /api/v1/relations/:itemId', async () => {
    const res = await request(app)
      .get(`/api/v1/relations/${vehicleEntityId}`)
      .set('Cookie', authCookieA);

    expect(res.status).toBe(200);
    expect(res.body.relations).toBeInstanceOf(Array);
    expect(res.body.relations.length).toBeGreaterThan(0);
    expect(res.body.relations[0].sourceItemId).toBe(receiptDocId);
  });

  // 3. Relationship Update & Deletion
  it('should update a relationship type via PATCH /api/v1/relations/:id', async () => {
    const res = await request(app)
      .patch(`/api/v1/relations/${createdRelationId}`)
      .set('Cookie', authCookieA)
      .send({
        relationshipType: 'service_record',
        status: 'verified',
      });

    expect(res.status).toBe(200);
    expect(res.body.relationshipType).toBe('service_record');
  });

  it('should delete a relationship via DELETE /api/v1/relations/:id', async () => {
    const res = await request(app)
      .delete(`/api/v1/relations/${createdRelationId}`)
      .set('Cookie', authCookieA);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify relation is deleted
    const check = await db.select().from(itemRelations).where(eq(itemRelations.id, createdRelationId));
    expect(check.length).toBe(0);
  });

  // 4. AI Relationship Suggestion
  it('should suggest relationship when new capture references an existing entity', async () => {
    const res = await request(app)
      .post('/api/v1/captures')
      .set('Cookie', authCookieA)
      .send({
        type: 'text',
        rawPayload: 'Car insurance for Honda City renewal next year',
      });
    expect(res.status).toBe(201);
    const captureId = res.body.capture.id;

    await new Promise(resolve => setTimeout(resolve, 1500)); // AI mock processing delay

    const createdItems = await db.select().from(items).where(eq(items.captureId, captureId));
    expect(createdItems.length).toBeGreaterThan(0);

    const extracted = createdItems[0];
    const meta = extracted.metadata as any;
    expect(meta.suggestedRelationTargetId).toBe(vehicleEntityId);
    expect(meta.relationPrompt).toContain('Honda City');

    // Confirm suggestion by creating relation
    const confirmRel = await request(app)
      .post('/api/v1/relations')
      .set('Cookie', authCookieA)
      .send({
        sourceItemId: extracted.id,
        targetItemId: meta.suggestedRelationTargetId,
        relationshipType: 'belongs_to',
      });
    expect(confirmRel.status).toBe(200);
  });

  // 5. Referential Integrity & Cascade Deletion on Endpoint Deletion
  it('should cascade delete relationships when the endpoint entity is deleted', async () => {
    // Create temporary entity and item
    const [tempEntity] = await db.insert(items).values({
      userId: userAId,
      title: 'Temp Laptop Entity',
      itemType: 'home',
      status: 'active',
    }).returning();

    const [tempDoc] = await db.insert(items).values({
      userId: userAId,
      title: 'Laptop Warranty Document',
      itemType: 'document',
      status: 'active',
    }).returning();

    const [rel] = await db.insert(itemRelations).values({
      userId: userAId,
      sourceItemId: tempDoc.id,
      targetItemId: tempEntity.id,
      relationshipType: 'warranty_for',
    }).returning();

    // Verify relation exists
    const beforeRel = await db.select().from(itemRelations).where(eq(itemRelations.id, rel.id));
    expect(beforeRel.length).toBe(1);

    // Delete the target entity via API
    const delRes = await request(app)
      .delete(`/api/v1/items/${tempEntity.id}`)
      .set('Cookie', authCookieA);
    expect(delRes.status).toBe(200);

    // Verify relationship was cascade-deleted by foreign key constraint
    const afterRel = await db.select().from(itemRelations).where(eq(itemRelations.id, rel.id));
    expect(afterRel.length).toBe(0);

    await db.delete(items).where(eq(items.id, tempDoc.id));
  });

  // 6. Cross-User Graph Isolation
  it('should strictly isolate life graph entities and relations between users', async () => {
    // User B attempts to access User A's vehicle entity
    const getRes = await request(app)
      .get(`/api/v1/items/${vehicleEntityId}`)
      .set('Cookie', authCookieB);
    expect(getRes.status).toBe(403);

    // User B attempts to view relations for User A's entity
    const relRes = await request(app)
      .get(`/api/v1/relations/${vehicleEntityId}`)
      .set('Cookie', authCookieB);
    expect(relRes.status).toBe(200);
    // User B receives empty relations list because user_id query filter isolates it
    expect(relRes.body.relations).toEqual([]);
  });
});
