import {
  validate,
  WidgetChatSchema,
  CreateAssistantSchema,
  TeamInviteSchema,
  ChatSchema,
  UploadUrlSchema,
} from '../src/validation';

describe('validation', () => {
  // -----------------------------------------------------------------------
  // validate() generic behaviour
  // -----------------------------------------------------------------------
  describe('validate()', () => {
    it('returns success:true with valid WidgetChatSchema data', () => {
      const result = validate(WidgetChatSchema, { message: 'hello' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('hello');
      }
    });

    it('returns success:true with valid CreateAssistantSchema data', () => {
      const result = validate(CreateAssistantSchema, { name: 'My Bot' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('My Bot');
      }
    });

    it('returns success:true with valid TeamInviteSchema data', () => {
      const result = validate(TeamInviteSchema, {
        email: 'alice@example.com',
        role: 'editor',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('alice@example.com');
        expect(result.data.role).toBe('editor');
      }
    });

    it('returns success:false with descriptive error for invalid data', () => {
      // WidgetChatSchema requires message: string().min(1)
      const result = validate(WidgetChatSchema, { message: 123 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
        expect(typeof result.error).toBe('string');
        // The error should reference the field name
        expect(result.error.toLowerCase()).toContain('message');
      }
    });

    it('returns success:false when required fields are missing', () => {
      const result = validate(CreateAssistantSchema, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('rejects empty required strings', () => {
      // message must be min(1) in WidgetChatSchema
      const result = validate(WidgetChatSchema, { message: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('rejects empty name in CreateAssistantSchema', () => {
      const result = validate(CreateAssistantSchema, { name: '' });
      expect(result.success).toBe(false);
    });

    it('accepts optional fields when omitted', () => {
      // WidgetChatSchema: sessionId, userId, nodeId, image, context are optional
      const result = validate(WidgetChatSchema, { message: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionId).toBeUndefined();
        expect(result.data.userId).toBeUndefined();
        expect(result.data.nodeId).toBeUndefined();
        expect(result.data.image).toBeUndefined();
        expect(result.data.context).toBeUndefined();
      }
    });

    it('accepts optional name in TeamInviteSchema when omitted', () => {
      const result = validate(TeamInviteSchema, {
        email: 'bob@example.com',
        role: 'viewer',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBeUndefined();
      }
    });

    it('accepts optional description in CreateAssistantSchema', () => {
      const result = validate(CreateAssistantSchema, {
        name: 'Bot',
        description: 'A helpful bot',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('A helpful bot');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Schema-specific validation
  // -----------------------------------------------------------------------
  describe('WidgetChatSchema', () => {
    it('accepts a full payload with all optional fields', () => {
      const result = validate(WidgetChatSchema, {
        message: 'hi',
        sessionId: 'sess-1',
        userId: 'u-1',
        nodeId: 'n-1',
        image: 'base64data',
        context: { page: '/home' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid context type', () => {
      const result = validate(WidgetChatSchema, {
        message: 'hi',
        context: 'not-an-object',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TeamInviteSchema', () => {
    it('rejects invalid email', () => {
      const result = validate(TeamInviteSchema, {
        email: 'not-an-email',
        role: 'editor',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
      const result = validate(TeamInviteSchema, {
        email: 'valid@example.com',
        role: 'superuser',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid roles', () => {
      for (const role of ['admin', 'editor', 'viewer']) {
        const result = validate(TeamInviteSchema, {
          email: 'test@example.com',
          role,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ChatSchema', () => {
    it('accepts valid chat body', () => {
      const result = validate(ChatSchema, { message: 'hello' });
      expect(result.success).toBe(true);
    });

    it('accepts optional testRoleLevel', () => {
      const result = validate(ChatSchema, { message: 'hello', testRoleLevel: 3 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.testRoleLevel).toBe(3);
      }
    });

    it('rejects non-integer testRoleLevel', () => {
      const result = validate(ChatSchema, { message: 'hello', testRoleLevel: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('UploadUrlSchema', () => {
    const validPayload = {
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      assistantId: 'ast-1',
      knowledgeBaseId: 'kb-1',
      scope: 'general',
    };

    it('accepts valid upload payload', () => {
      const result = validate(UploadUrlSchema, validPayload);
      expect(result.success).toBe(true);
    });

    it('rejects when a required field is empty', () => {
      const result = validate(UploadUrlSchema, { ...validPayload, fileName: '' });
      expect(result.success).toBe(false);
    });

    it('accepts optional minRoleLevel', () => {
      const result = validate(UploadUrlSchema, { ...validPayload, minRoleLevel: 2 });
      expect(result.success).toBe(true);
    });
  });
});
