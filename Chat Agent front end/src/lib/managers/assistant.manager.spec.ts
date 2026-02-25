import { TestBed } from '@angular/core/testing';
import { AssistantManager } from './assistant.manager';
import { ApiService } from '../../app/core/services/api.service';
import { IAssistant } from '../models/tenant.model';

const MOCK_ASSISTANT: IAssistant = {
  id: 'assist-1',
  tenantId: 'tenant-1',
  name: 'Test Assistant',
  description: 'A test assistant',
  status: 'draft',
  modelConfig: {
    provider: 'bedrock',
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    systemPrompt: 'You are helpful.',
    temperature: 0.7,
    topP: 0.9,
    topK: 250,
    maxTokens: 2048,
    stopSequences: [],
  },
  widgetConfig: {
    position: 'bottom-right',
    primaryColor: '#006FB4',
    title: 'Test Assistant',
    welcomeMessage: 'Hello!',
    placeholder: 'Ask a question...',
  },
  apiKey: 'bca_abc123',
  allowedDomains: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as IAssistant;

describe('AssistantManager', () => {
  let manager: AssistantManager;
  let apiSpy: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    apiSpy = jasmine.createSpyObj('ApiService', ['get', 'post', 'put', 'delete']);

    TestBed.configureTestingModule({
      providers: [
        AssistantManager,
        { provide: ApiService, useValue: apiSpy },
      ],
    });

    manager = TestBed.inject(AssistantManager);
  });

  it('should be created', () => {
    expect(manager).toBeTruthy();
  });

  // ── createAssistant ──────────────────────────────────────────────────────

  describe('createAssistant()', () => {
    it('calls POST /assistants with name and description', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: true, data: MOCK_ASSISTANT }));

      const result = await manager.createAssistant({
        tenantId: 'tenant-1',
        name: 'Test Assistant',
        description: 'A test assistant',
      });

      expect(result.success).toBeTrue();
      expect(result.data).toEqual(MOCK_ASSISTANT);
      expect(apiSpy.post).toHaveBeenCalledWith('/assistants', {
        name: 'Test Assistant',
        description: 'A test assistant',
      });
    });

    it('propagates API errors', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: false, error: 'Bad request' }));

      const result = await manager.createAssistant({ tenantId: 't1', name: '' });

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Bad request');
    });
  });

  // ── getAssistant ─────────────────────────────────────────────────────────

  describe('getAssistant()', () => {
    it('calls GET /assistants/:id', async () => {
      apiSpy.get.and.returnValue(Promise.resolve({ success: true, data: MOCK_ASSISTANT }));

      const result = await manager.getAssistant('assist-1');

      expect(result.success).toBeTrue();
      expect(result.data).toEqual(MOCK_ASSISTANT);
      expect(apiSpy.get).toHaveBeenCalledWith('/assistants/assist-1');
    });

    it('returns null data when not found', async () => {
      apiSpy.get.and.returnValue(Promise.resolve({ success: false, error: 'Not found' }));

      const result = await manager.getAssistant('missing-id');

      expect(result.success).toBeFalse();
    });
  });

  // ── listAssistants ───────────────────────────────────────────────────────

  describe('listAssistants()', () => {
    it('calls GET /assistants', async () => {
      apiSpy.get.and.returnValue(Promise.resolve({ success: true, data: [MOCK_ASSISTANT] }));

      const result = await manager.listAssistants('tenant-1');

      expect(result.success).toBeTrue();
      expect(result.data?.length).toBe(1);
      expect(apiSpy.get).toHaveBeenCalledWith('/assistants');
    });

    it('returns empty array when no assistants', async () => {
      apiSpy.get.and.returnValue(Promise.resolve({ success: true, data: [] }));

      const result = await manager.listAssistants('tenant-1');

      expect(result.data).toEqual([]);
    });
  });

  // ── updateAssistant ──────────────────────────────────────────────────────

  describe('updateAssistant()', () => {
    it('calls PUT /assistants/:id with the updates', async () => {
      apiSpy.put.and.returnValue(Promise.resolve({ success: true, data: undefined }));

      await manager.updateAssistant('assist-1', { name: 'Updated Name' });

      expect(apiSpy.put).toHaveBeenCalledWith('/assistants/assist-1', { name: 'Updated Name' });
    });
  });

  // ── setStatus ────────────────────────────────────────────────────────────

  describe('setStatus()', () => {
    it('calls PUT /assistants/:id with status field', async () => {
      apiSpy.put.and.returnValue(Promise.resolve({ success: true, data: undefined }));

      await manager.setStatus('assist-1', 'ready');

      expect(apiSpy.put).toHaveBeenCalledWith('/assistants/assist-1', { status: 'ready' });
    });
  });

  // ── deleteAssistant ──────────────────────────────────────────────────────

  describe('deleteAssistant()', () => {
    it('calls DELETE /assistants/:id', async () => {
      apiSpy.delete.and.returnValue(Promise.resolve({ success: true, data: undefined }));

      await manager.deleteAssistant(MOCK_ASSISTANT);

      expect(apiSpy.delete).toHaveBeenCalledWith('/assistants/assist-1');
    });
  });

  // ── provisionBedrockResources ────────────────────────────────────────────

  describe('provisionBedrockResources()', () => {
    it('calls POST /assistants/:id/provision', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: true, data: MOCK_ASSISTANT }));

      await manager.provisionBedrockResources(MOCK_ASSISTANT);

      expect(apiSpy.post).toHaveBeenCalledWith('/assistants/assist-1/provision');
    });
  });

  // ── regenerateApiKey ─────────────────────────────────────────────────────

  describe('regenerateApiKey()', () => {
    it('returns the new API key on success', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: true, data: { apiKey: 'bca_newkey456' } }));

      const result = await manager.regenerateApiKey('assist-1');

      expect(result.success).toBeTrue();
      expect(result.data).toBe('bca_newkey456');
      expect(apiSpy.post).toHaveBeenCalledWith('/assistants/assist-1/regenerate-key');
    });

    it('returns error when API call fails', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: false, error: 'Unauthorized' }));

      const result = await manager.regenerateApiKey('assist-1');

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Unauthorized');
    });

    it('returns error when data is missing from response', async () => {
      apiSpy.post.and.returnValue(Promise.resolve({ success: true, data: null }));

      const result = await manager.regenerateApiKey('assist-1');

      expect(result.success).toBeFalse();
    });
  });
});
