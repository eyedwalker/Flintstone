import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EscalationConfigComponent } from './escalation-config.component';
import { EscalationManager } from '../../../../lib/managers/escalation.manager';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { SharedModule } from '../../../shared/shared.module';
import { MatSnackBar } from '@angular/material/snack-bar';

describe('EscalationConfigComponent', () => {
  let component: EscalationConfigComponent;
  let fixture: ComponentFixture<EscalationConfigComponent>;
  let mockEscalationManager: jasmine.SpyObj<EscalationManager>;
  let mockAssistantManager: jasmine.SpyObj<AssistantManager>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    mockEscalationManager = jasmine.createSpyObj('EscalationManager', [
      'getConfig', 'saveConfig', 'deleteConfig', 'testConnection',
    ]);
    mockAssistantManager = jasmine.createSpyObj('AssistantManager', ['listAssistants']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    // Default mock returns
    mockAssistantManager.listAssistants.and.returnValue(
      Promise.resolve({ success: true, data: [] }),
    );

    await TestBed.configureTestingModule({
      imports: [SharedModule, NoopAnimationsModule],
      declarations: [EscalationConfigComponent],
      providers: [
        { provide: EscalationManager, useValue: mockEscalationManager },
        { provide: AssistantManager, useValue: mockAssistantManager },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EscalationConfigComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load assistants on init', async () => {
    const mockAssistants = [
      { id: 'ast-1', name: 'Test Bot', status: 'ready', tenantId: 't1', apiKey: 'k1' },
    ];
    mockAssistantManager.listAssistants.and.returnValue(
      Promise.resolve({ success: true, data: mockAssistants as any }),
    );
    mockEscalationManager.getConfig.and.returnValue(
      Promise.resolve({ success: true, data: null }),
    );

    await component.ngOnInit();

    expect(component.assistants.length).toBe(1);
    expect(component.loading).toBe(false);
  });

  it('should auto-select when only one assistant exists', async () => {
    const mockAssistants = [
      { id: 'ast-1', name: 'Test Bot', status: 'ready', tenantId: 't1', apiKey: 'k1' },
    ];
    mockAssistantManager.listAssistants.and.returnValue(
      Promise.resolve({ success: true, data: mockAssistants as any }),
    );
    mockEscalationManager.getConfig.and.returnValue(
      Promise.resolve({ success: true, data: null }),
    );

    await component.ngOnInit();

    expect(component.selectedAssistantId).toBe('ast-1');
  });

  it('should reset form when no config exists', async () => {
    component.selectedAssistantId = 'ast-1';
    mockEscalationManager.getConfig.and.returnValue(
      Promise.resolve({ success: true, data: null }),
    );

    await component.loadConfig();

    expect(component.enabled).toBe(false);
    expect(component.salesforceInstanceUrl).toBe('');
    expect(component.triggerMode).toBe('both');
  });

  it('should populate form from existing config', async () => {
    component.selectedAssistantId = 'ast-1';
    mockEscalationManager.getConfig.and.returnValue(
      Promise.resolve({
        success: true,
        data: {
          assistantId: 'ast-1',
          tenantId: 't1',
          enabled: true,
          salesforceInstanceUrl: 'https://test.sf.com',
          salesforceConsumerKey: 'key-123',
          salesforceUsername: 'admin@test.com',
          hasPrivateKey: true,
          triggerMode: 'auto',
          autoTriggers: { keywords: ['help', 'frustrated'], maxTurns: 10 },
          caseDefaults: { priority: 'High', origin: 'Chat', status: 'New' },
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        } as any,
      }),
    );

    await component.loadConfig();

    expect(component.enabled).toBe(true);
    expect(component.salesforceInstanceUrl).toBe('https://test.sf.com');
    expect(component.triggerMode).toBe('auto');
    expect(component.keywords).toEqual(['help', 'frustrated']);
    expect(component.maxTurns).toBe(10);
  });

  it('should add and remove keywords', () => {
    component.addKeyword({
      value: 'help me',
      chipInput: { clear: jasmine.createSpy() },
    } as any);
    expect(component.keywords).toContain('help me');

    component.removeKeyword('help me');
    expect(component.keywords).not.toContain('help me');
  });
});
