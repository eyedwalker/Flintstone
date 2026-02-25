import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IAssistant } from '../../../../lib/models/tenant.model';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'bcc-assistant-list',
  templateUrl: './assistant-list.component.html',
  styleUrls: ['./assistant-list.component.scss'],
})
export class AssistantListComponent implements OnInit {
  assistants: IAssistant[] = [];
  loading = true;

  constructor(
    private assistantManager: AssistantManager,
    private auth: AuthService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const tenantId = this.auth.currentUser?.sub ?? '';
    const result = await this.assistantManager.listAssistants(tenantId);
    if (result.success && result.data) this.assistants = result.data;
    this.loading = false;
  }

  createAssistant(): void {
    this.router.navigate(['/assistants/new']);
  }

  openAssistant(id: string): void {
    this.router.navigate(['/assistants', id]);
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      ready: 'success', draft: 'default', provisioning: 'accent',
      error: 'warn', paused: 'default',
    };
    return colors[status] ?? 'default';
  }
}
