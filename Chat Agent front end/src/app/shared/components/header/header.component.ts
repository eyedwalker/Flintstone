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

  switchOrg(org: IOrganizationMembership): void {
    this.demoWidget.teardown();
    this.orgCtx.setActiveOrg(org);
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/dashboard']);
    });
    this.demoWidget.bootstrap();
    this.ngOnInit();
  }

  async signOut(): Promise<void> {
    this.demoWidget.teardown();
    this.orgCtx.clear();
    await this.auth.signOut();
  }
}
