import { TestBed } from '@angular/core/testing';
import { EscalationManager } from './escalation.manager';
import { ApiService } from '../../app/core/services/api.service';

describe('EscalationManager', () => {
  let manager: EscalationManager;
  let mockApi: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    mockApi = jasmine.createSpyObj('ApiService', ['get', 'put', 'post', 'delete']);

    TestBed.configureTestingModule({
      providers: [
        EscalationManager,
        { provide: ApiService, useValue: mockApi },
      ],
    });
    manager = TestBed.inject(EscalationManager);
  });

  it('should be created', () => {
    expect(manager).toBeTruthy();
  });

  describe('getConfig', () => {
    it('calls GET /escalation/config/:assistantId', async () => {
      const mockConfig = { assistantId: 'ast-1', enabled: true };
      mockApi.get.and.returnValue(Promise.resolve({ success: true, data: mockConfig }));

      const result = await manager.getConfig('ast-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockConfig as any);
      expect(mockApi.get).toHaveBeenCalledWith('/escalation/config/ast-1');
    });
  });

  describe('saveConfig', () => {
    it('calls PUT /escalation/config/:assistantId', async () => {
      const configPayload = {
        enabled: true,
        salesforceInstanceUrl: 'https://test.sf.com',
        salesforceConsumerKey: 'key',
        salesforceUsername: 'user@test.com',
        triggerMode: 'both',
        autoTriggers: { keywords: ['help'] },
        caseDefaults: { priority: 'High', origin: 'Chat', status: 'New' },
      };
      mockApi.put.and.returnValue(Promise.resolve({ success: true, data: configPayload }));

      const result = await manager.saveConfig('ast-1', configPayload);
      expect(result.success).toBe(true);
      expect(mockApi.put).toHaveBeenCalledWith('/escalation/config/ast-1', configPayload);
    });
  });

  describe('deleteConfig', () => {
    it('calls DELETE /escalation/config/:assistantId', async () => {
      mockApi.delete.and.returnValue(Promise.resolve({ success: true }));

      const result = await manager.deleteConfig('ast-1');
      expect(result.success).toBe(true);
      expect(mockApi.delete).toHaveBeenCalledWith('/escalation/config/ast-1');
    });
  });

  describe('testConnection', () => {
    it('calls POST /escalation/test-connection/:assistantId', async () => {
      mockApi.post.and.returnValue(Promise.resolve({ success: true, data: { success: true, instanceUrl: 'https://test.sf.com' } }));

      const result = await manager.testConnection('ast-1');
      expect(result.success).toBe(true);
      expect(mockApi.post).toHaveBeenCalledWith('/escalation/test-connection/ast-1');
    });
  });
});
