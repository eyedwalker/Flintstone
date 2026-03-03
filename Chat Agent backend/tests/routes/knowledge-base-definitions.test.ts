import { mockDynamoDB, GetCommand, PutCommand, QueryCommand, ScanCommand, DeleteCommand } from '../helpers/mock-aws';
import { asResult } from '../helpers/test-utils';
import { handleKnowledgeBaseDefinitions } from '../../src/routes/knowledge-base-definitions';
import { IRequestContext } from '../../src/auth';

const ddbMock = mockDynamoDB();

const adminCtx: IRequestContext = {
  userId: 'user-1', organizationId: 'org-1', role: 'admin', email: 'admin@example.com',
};
const viewerCtx: IRequestContext = {
  userId: 'user-2', organizationId: 'org-1', role: 'viewer', email: 'viewer@example.com',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  ddbMock.on(DeleteCommand).resolves({});
});

describe('handleKnowledgeBaseDefinitions', () => {
  describe('GET /knowledge-bases', () => {
    it('returns KB definitions for the tenant', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { id: 'kb-1', tenantId: 'org-1', name: 'KB One', isDefault: true, status: 'ready' },
          { id: 'kb-2', tenantId: 'org-1', name: 'KB Two', isDefault: false, status: 'draft' },
        ],
      });

      const r = asResult(await handleKnowledgeBaseDefinitions(
        'GET', '/knowledge-bases', {}, {}, {}, viewerCtx,
      ));
      const body = JSON.parse(r.body as string);
      expect(r.statusCode).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
    });
  });

  describe('POST /knowledge-bases', () => {
    it('creates a new KB definition', async () => {
      const r = asResult(await handleKnowledgeBaseDefinitions(
        'POST', '/knowledge-bases', { name: 'Test KB', description: 'A test' }, {}, {}, adminCtx,
      ));
      const body = JSON.parse(r.body as string);
      expect(r.statusCode).toBe(201);
      expect(body.name).toBe('Test KB');
      expect(body.status).toBe('draft');
      expect(body.tenantId).toBe('org-1');
    });

    it('rejects without name', async () => {
      const r = asResult(await handleKnowledgeBaseDefinitions(
        'POST', '/knowledge-bases', { description: 'no name' }, {}, {}, adminCtx,
      ));
      expect(r.statusCode).toBe(400);
    });

    it('rejects viewer role', async () => {
      const r = asResult(await handleKnowledgeBaseDefinitions(
        'POST', '/knowledge-bases', { name: 'Test' }, {}, {}, viewerCtx,
      ));
      expect(r.statusCode).toBe(403);
    });
  });

  describe('DELETE /knowledge-bases/:id', () => {
    it('deletes a KB with no linked assistants', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { id: 'kb-1', tenantId: 'org-1', name: 'KB', status: 'draft', isDefault: false },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const r = asResult(await handleKnowledgeBaseDefinitions(
        'DELETE', '/knowledge-bases/kb-1', {}, { id: 'kb-1' }, {}, adminCtx,
      ));
      expect(r.statusCode).toBe(204);
    });

    it('rejects deletion with linked assistants', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { id: 'kb-1', tenantId: 'org-1', name: 'KB', status: 'ready', isDefault: false },
      });
      ddbMock.on(QueryCommand).resolves({
        Items: [{ assistantId: 'ast-1', knowledgeBaseId: 'kb-1' }],
      });

      const r = asResult(await handleKnowledgeBaseDefinitions(
        'DELETE', '/knowledge-bases/kb-1', {}, { id: 'kb-1' }, {}, adminCtx,
      ));
      expect(r.statusCode).toBe(400);
    });
  });
});
