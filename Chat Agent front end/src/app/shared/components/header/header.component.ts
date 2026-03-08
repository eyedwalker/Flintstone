import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { OrgContextService } from '../../../core/services/org-context.service';
import { DemoWidgetService } from '../../../core/services/demo-widget.service';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { ApiService } from '../../../core/services/api.service';
import { IOrganizationMembership, IAssistant, ITenant } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent implements OnInit {
  assistants: IAssistant[] = [];
  demoAssistantId: string | null = null;
  ameliaEnabled = false;
  ameliaScriptUrl = '';

  constructor(
    public auth: AuthService,
    public orgCtx: OrgContextService,
    public demoWidget: DemoWidgetService,
    private assistantManager: AssistantManager,
    private api: ApiService,
    private router: Router,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.auth.isAuthenticated) return;
    const [listRes, tenantRes] = await Promise.all([
      this.assistantManager.listAssistants(),
      this.api.get<ITenant>('/tenants/me'),
    ]);
    this.assistants = (listRes.data ?? []).filter((a) => a.status === 'ready');
    this.demoAssistantId = tenantRes.data?.demoAssistantId || null;
    this.ameliaEnabled = !!tenantRes.data?.demoAmeliaEnabled;
    this.ameliaScriptUrl = tenantRes.data?.demoAmeliaScriptUrl || '';
  }

  async setDemoAssistant(assistantId: string | null): Promise<void> {
    const ok = await this.demoWidget.setDemoAssistant(assistantId);
    if (ok) {
      this.demoAssistantId = assistantId;
      this.snackBar.open(
        assistantId ? 'Demo widget activated' : 'Demo widget disabled',
        '', { duration: 2000 },
      );
    }
  }

  async toggleAmelia(): Promise<void> {
    const enable = !this.ameliaEnabled;
    const ok = await this.demoWidget.setAmelia(enable);
    if (ok) {
      this.ameliaEnabled = enable;
      this.snackBar.open(
        enable ? 'Competitor widget activated' : 'Competitor widget disabled',
        '', { duration: 2000 },
      );
    }
  }

  async editAmeliaScript(): Promise<void> {
    const current = this.ameliaScriptUrl || '';
    const url = prompt('Enter the competitor chat widget script URL:', current);
    if (url === null) return; // cancelled
    const trimmed = url.trim();
    if (!trimmed) {
      this.snackBar.open('URL cannot be empty', '', { duration: 2000 });
      return;
    }
    const ok = await this.demoWidget.setAmeliaScriptUrl(trimmed);
    if (ok) {
      this.ameliaScriptUrl = trimmed;
      this.snackBar.open('Competitor script URL updated', '', { duration: 2000 });
    }
  }

  switchOrg(org: IOrganizationMembership): void {
    this.demoWidget.teardownAll();
    this.orgCtx.setActiveOrg(org);
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/dashboard']);
    });
    this.demoWidget.bootstrap();
    this.ngOnInit();
  }

  async signOut(): Promise<void> {
    this.demoWidget.teardownAll();
    this.orgCtx.clear();
    await this.auth.signOut();
  }
}
