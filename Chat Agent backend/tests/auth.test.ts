import { requireRole, parseBody, assertOwnership, IRequestContext, NODE_ROLE_LEVEL, resolveNodeRole } from '../src/auth';

describe('auth', () => {
  describe('requireRole', () => {
    const makeCtx = (role: string): IRequestContext => ({
      userId: 'user-1',
      organizationId: 'org-1',
      role: role as IRequestContext['role'],
      email: 'test@example.com',
    });

    it('owner can access admin routes', () => {
      expect(requireRole(makeCtx('owner'), 'admin')).toBe(true);
    });

    it('admin can access admin routes', () => {
      expect(requireRole(makeCtx('admin'), 'admin')).toBe(true);
    });

    it('editor cannot access admin routes', () => {
      expect(requireRole(makeCtx('editor'), 'admin')).toBe(false);
    });

    it('viewer cannot access admin routes', () => {
      expect(requireRole(makeCtx('viewer'), 'admin')).toBe(false);
    });

    it('editor can access editor routes', () => {
      expect(requireRole(makeCtx('editor'), 'editor')).toBe(true);
    });

    it('viewer can access viewer routes', () => {
      expect(requireRole(makeCtx('viewer'), 'viewer')).toBe(true);
    });

    it('admin can access viewer routes', () => {
      expect(requireRole(makeCtx('admin'), 'viewer')).toBe(true);
    });
  });

  describe('parseBody', () => {
    it('parses valid JSON', () => {
      const result = parseBody<{ name: string }>('{"name":"test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('returns null for undefined', () => {
      expect(parseBody(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseBody('')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseBody('not json')).toBeNull();
    });

    it('parses nested objects', () => {
      const result = parseBody<{ a: { b: number } }>('{"a":{"b":42}}');
      expect(result?.a.b).toBe(42);
    });
  });

  describe('assertOwnership', () => {
    it('returns true when tenant IDs match', () => {
      expect(assertOwnership('org-1', 'org-1')).toBe(true);
    });

    it('returns false when tenant IDs differ', () => {
      expect(assertOwnership('org-1', 'org-2')).toBe(false);
    });
  });

  describe('NODE_ROLE_LEVEL', () => {
    it('maps public to 0', () => {
      expect(NODE_ROLE_LEVEL['public']).toBe(0);
    });

    it('maps authenticated to 1', () => {
      expect(NODE_ROLE_LEVEL['authenticated']).toBe(1);
    });

    it('maps staff to 2', () => {
      expect(NODE_ROLE_LEVEL['staff']).toBe(2);
    });

    it('maps doctor to 3', () => {
      expect(NODE_ROLE_LEVEL['doctor']).toBe(3);
    });

    it('maps admin to 4', () => {
      expect(NODE_ROLE_LEVEL['admin']).toBe(4);
    });

    it('maps super_admin to 99', () => {
      expect(NODE_ROLE_LEVEL['super_admin']).toBe(99);
    });
  });

  describe('resolveNodeRole', () => {
    it('returns 4 for admin', () => {
      expect(resolveNodeRole('admin')).toBe(4);
    });

    it('returns 0 for unknown role', () => {
      expect(resolveNodeRole('unknown')).toBe(0);
    });

    it('returns 0 for public', () => {
      expect(resolveNodeRole('public')).toBe(0);
    });

    it('returns 99 for super_admin', () => {
      expect(resolveNodeRole('super_admin')).toBe(99);
    });

    it('returns 1 for authenticated', () => {
      expect(resolveNodeRole('authenticated')).toBe(1);
    });

    it('returns 0 for empty string', () => {
      expect(resolveNodeRole('')).toBe(0);
    });
  });
});
