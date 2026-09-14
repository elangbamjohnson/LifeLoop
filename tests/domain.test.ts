import { describe, it, expect } from 'vitest';
import { UserSchema, CaptureSchema } from '../src/shared/types/domain';

describe('Domain Models', () => {
  it('should validate a valid User object', () => {
    const user = {
      id: crypto.randomUUID(),
      email: 'test@lifeloop.com',
      createdAt: new Date(),
    };
    
    const result = UserSchema.safeParse(user);
    expect(result.success).toBe(true);
  });

  it('should reject an invalid User object (bad email)', () => {
    const user = {
      id: crypto.randomUUID(),
      email: 'not-an-email',
      createdAt: new Date(),
    };
    
    const result = UserSchema.safeParse(user);
    expect(result.success).toBe(false);
  });
});
