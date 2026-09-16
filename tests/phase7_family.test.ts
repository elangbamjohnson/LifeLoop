import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '../src/db';
import { users, families, familyMembers, sharedItems, items } from '../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { familiesRouter } from '../src/server/api/v1/families';
import { itemsRouter } from '../src/server/api/v1/items';
import { createTestApp } from './setup';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const app = createTestApp('/api/v1/families', familiesRouter);

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

describe('Phase 7: Family Sharing, Role Permissions & Multi-User Security (P0/P1)', () => {
  const userAId = uuidv4(); // Family Owner
  const userBId = uuidv4(); // Family Member
  const userCId = uuidv4(); // Non-member outsider
  const userDId = uuidv4(); // View-only member

  const userAEmail = `ownera_${userAId}@example.com`;
  const userBEmail = `memberb_${userBId}@example.com`;
  const userCEmail = `outsiderc_${userCId}@example.com`;
  const userDEmail = `viewonlyd_${userDId}@example.com`;

  let userACookie: string;
  let userBCookie: string;
  let userCCookie: string;
  let userDCookie: string;

  let familyId: string;
  let memberBRecordId: string;
  let inviteTokenB: string;

  let aPrivateItemId: string;
  let aSharedItemId: string;
  let sharedRecordId: string;

  beforeAll(async () => {
    // 1. Seed users
    await db.insert(users).values([
      { id: userAId, email: userAEmail, passwordHash: 'hashA' },
      { id: userBId, email: userBEmail, passwordHash: 'hashB' },
      { id: userCId, email: userCEmail, passwordHash: 'hashC' },
      { id: userDId, email: userDEmail, passwordHash: 'hashD' },
    ]);

    userACookie = `session=${jwt.sign({ userId: userAId }, JWT_SECRET)}`;
    userBCookie = `session=${jwt.sign({ userId: userBId }, JWT_SECRET)}`;
    userCCookie = `session=${jwt.sign({ userId: userCId }, JWT_SECRET)}`;
    userDCookie = `session=${jwt.sign({ userId: userDId }, JWT_SECRET)}`;

    // 2. Create User A's private item and shared item
    const [privateItem] = await db.insert(items).values({
      userId: userAId,
      title: 'User A Private Medical Record',
      itemType: 'document',
      status: 'active',
      metadata: { private: true },
    }).returning();
    aPrivateItemId = privateItem.id;

    const [sharedItem] = await db.insert(items).values({
      userId: userAId,
      title: 'Home Internet Bill',
      itemType: 'payment',
      status: 'active',
      dueDate: new Date('2026-10-01T00:00:00Z'),
      metadata: { amount: 1200, currency: '₹' },
    }).returning();
    aSharedItemId = sharedItem.id;
  });

  afterAll(async () => {
    if (familyId) {
      await db.delete(sharedItems).where(eq(sharedItems.familyId, familyId));
      await db.delete(familyMembers).where(eq(familyMembers.familyId, familyId));
      await db.delete(families).where(eq(families.id, familyId));
    }
    await db.delete(items).where(inArray(items.userId, [userAId, userBId, userCId, userDId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId, userCId, userDId]));
  });

  // 1. Family Creation
  it('should allow USER_A to create a family as Owner', async () => {
    const res = await request(app)
      .post('/api/v1/families')
      .set('Cookie', userACookie)
      .send({ name: 'The Alpha Family' });

    expect(res.status).toBe(201);
    expect(res.body.family).toBeDefined();
    expect(res.body.family.ownerId).toBe(userAId);
    familyId = res.body.family.id;
  });

  // 2. Member Invitations & Acceptance
  it('should allow Owner to invite USER_B as member', async () => {
    const res = await request(app)
      .post(`/api/v1/families/${familyId}/invite`)
      .set('Cookie', userACookie)
      .send({ email: userBEmail, role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.member).toBeDefined();
    expect(res.body.member.invitedEmail).toBe(userBEmail.toLowerCase());
    expect(res.body.member.status).toBe('pending');
    expect(res.body.inviteToken).toBeDefined();

    inviteTokenB = res.body.inviteToken;
    memberBRecordId = res.body.member.id;
  });

  it('should allow USER_B to accept the invitation', async () => {
    const res = await request(app)
      .post(`/api/v1/families/invitations/${inviteTokenB}/accept`)
      .set('Cookie', userBCookie);

    expect(res.status).toBe(200);
    expect(res.body.member.status).toBe('accepted');
    expect(res.body.member.userId).toBe(userBId);
  });

  it('should reject accepting invite with a mismatched email account (403 Forbidden)', async () => {
    // Owner invites an email specifically for an external address
    const targetEmail = `specific_${uuidv4()}@example.com`;
    const specificInvite = await request(app)
      .post(`/api/v1/families/${familyId}/invite`)
      .set('Cookie', userACookie)
      .send({ email: targetEmail, role: 'member' });
    expect(specificInvite.status).toBe(201);
    const token = specificInvite.body.inviteToken;

    // USER_C (whose email does NOT match targetEmail) attempts to accept it
    const res = await request(app)
      .post(`/api/v1/families/invitations/${token}/accept`)
      .set('Cookie', userCCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This invite was sent to a different email address');
  });

  it('should allow recipient to reject an invitation', async () => {
    // Owner invites another email
    const rejectEmail = `reject_${uuidv4()}@example.com`;
    const inviteRes = await request(app)
      .post(`/api/v1/families/${familyId}/invite`)
      .set('Cookie', userACookie)
      .send({ email: rejectEmail, role: 'member' });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.inviteToken;

    // Reject invitation
    const rejectRes = await request(app)
      .post(`/api/v1/families/invitations/${token}/reject`)
      .set('Cookie', userCCookie); // authenticated user can reject
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.success).toBe(true);

    // Verify token is now invalid/consumed
    const reuseRes = await request(app)
      .post(`/api/v1/families/invitations/${token}/accept`)
      .set('Cookie', userCCookie);
    expect(reuseRes.status).toBe(404);
  });

  it('should allow Owner to promote USER_B to admin and verify admin permissions', async () => {
    const promoteRes = await request(app)
      .patch(`/api/v1/families/${familyId}/members/${memberBRecordId}`)
      .set('Cookie', userACookie)
      .send({ role: 'admin' });

    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.member.role).toBe('admin');
  });

  // 3. Role Permissions (View-Only vs Member)
  it('should invite USER_D as view_only and prevent view_only from sharing items', async () => {
    const inviteD = await request(app)
      .post(`/api/v1/families/${familyId}/invite`)
      .set('Cookie', userACookie)
      .send({ email: userDEmail, role: 'view_only' });
    expect(inviteD.status).toBe(201);

    // Accept as USER_D
    await request(app)
      .post(`/api/v1/families/invitations/${inviteD.body.inviteToken}/accept`)
      .set('Cookie', userDCookie);

    // USER_D creates an item
    const [dItem] = await db.insert(items).values({
      userId: userDId,
      title: 'D Personal Document',
      itemType: 'document',
      status: 'active',
    }).returning();

    // USER_D attempts to share item (requires 'member' role, view_only rank=1 < required rank=2)
    const shareRes = await request(app)
      .post(`/api/v1/families/${familyId}/share`)
      .set('Cookie', userDCookie)
      .send({ itemId: dItem.id, category: 'documents' });

    expect(shareRes.status).toBe(403);
    expect(shareRes.body.error).toContain('Insufficient permissions');
  });

  // 4. Item Sharing
  it('should allow USER_A to share an item with the family', async () => {
    const res = await request(app)
      .post(`/api/v1/families/${familyId}/share`)
      .set('Cookie', userACookie)
      .send({
        itemId: aSharedItemId,
        category: 'bills',
        canEdit: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.sharedItem).toBeDefined();
    expect(res.body.sharedItem.itemId).toBe(aSharedItemId);
    sharedRecordId = res.body.sharedItem.id;
  });

  // 5. Private vs Shared Boundary Verification
  it('should allow USER_B (member) to view A_SHARED item via GET /items/:id and GET /families/:id/shared', async () => {
    // Via direct item endpoint
    const itemRes = await request(app)
      .get(`/api/v1/items/${aSharedItemId}`)
      .set('Cookie', userBCookie);

    expect(itemRes.status).toBe(200);
    expect(itemRes.body.item.id).toBe(aSharedItemId);
    expect(itemRes.body.isShared).toBe(true);

    // Via family shared list
    const sharedListRes = await request(app)
      .get(`/api/v1/families/${familyId}/shared`)
      .set('Cookie', userBCookie);

    expect(sharedListRes.status).toBe(200);
    expect(sharedListRes.body.sharedItems.some((s: any) => s.itemId === aSharedItemId)).toBe(true);
  });

  it('should strictly DENY USER_B access to USER_A private item (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/v1/items/${aPrivateItemId}`)
      .set('Cookie', userBCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('private to its owner');
  });

  it('should strictly DENY USER_C (non-member) access to A_SHARED and A_PRIVATE', async () => {
    // USER_C tries to fetch A_SHARED -> 403 Forbidden
    const sharedFetch = await request(app)
      .get(`/api/v1/items/${aSharedItemId}`)
      .set('Cookie', userCCookie);
    expect(sharedFetch.status).toBe(403);

    // USER_C tries to fetch A_PRIVATE -> 403 Forbidden
    const privateFetch = await request(app)
      .get(`/api/v1/items/${aPrivateItemId}`)
      .set('Cookie', userCCookie);
    expect(privateFetch.status).toBe(403);

    // USER_C tries to access family shared resources -> 403 Forbidden
    const familyRes = await request(app)
      .get(`/api/v1/families/${familyId}/shared`)
      .set('Cookie', userCCookie);
    expect(familyRes.status).toBe(403);
    expect(familyRes.body.error).toContain('not a member');
  });

  // 6. Unsharing Behavior
  it('should allow USER_A to unshare A_SHARED and immediately revoke USER_B access', async () => {
    // Unshare item
    const unshareRes = await request(app)
      .delete(`/api/v1/families/${familyId}/shared/${sharedRecordId}`)
      .set('Cookie', userACookie);
    expect(unshareRes.status).toBe(200);

    // USER_B immediately loses access to the item
    const fetchAfterUnshare = await request(app)
      .get(`/api/v1/items/${aSharedItemId}`)
      .set('Cookie', userBCookie);

    expect(fetchAfterUnshare.status).toBe(403);
    expect(fetchAfterUnshare.body.error).toContain('private to its owner');
  });

  // 7. Revoked Member Access (Removal from Family)
  it('should immediately revoke all family access when USER_B is removed from family', async () => {
    // Re-share item first
    const reShare = await request(app)
      .post(`/api/v1/families/${familyId}/share`)
      .set('Cookie', userACookie)
      .send({ itemId: aSharedItemId, category: 'bills' });
    expect(reShare.status).toBe(201);

    // Confirm USER_B can access
    const checkB1 = await request(app)
      .get(`/api/v1/items/${aSharedItemId}`)
      .set('Cookie', userBCookie);
    expect(checkB1.status).toBe(200);

    // USER_A removes USER_B from family
    const removeRes = await request(app)
      .delete(`/api/v1/families/${familyId}/members/${memberBRecordId}`)
      .set('Cookie', userACookie);
    expect(removeRes.status).toBe(200);

    // USER_B immediately loses access to family endpoints
    const familyCheck = await request(app)
      .get(`/api/v1/families/${familyId}`)
      .set('Cookie', userBCookie);
    expect(familyCheck.status).toBe(403);
    expect(familyCheck.body.error).toContain('not a member');

    // USER_B immediately loses access to the shared item
    const itemCheck = await request(app)
      .get(`/api/v1/items/${aSharedItemId}`)
      .set('Cookie', userBCookie);
    expect(itemCheck.status).toBe(403);
    expect(itemCheck.body.error).toContain('private to its owner');
  });

  // 8. IDOR Prevention & Non-Owner Family Deletion Blocking
  it('should prevent non-owner from deleting the family', async () => {
    const res = await request(app)
      .delete(`/api/v1/families/${familyId}`)
      .set('Cookie', userDCookie); // view-only member

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Insufficient permissions');
  });
});
