import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

interface IKpiCard { label: string; value: string; icon: string; color: string; trend?: string; }
interface IConversationRow { id: string; query: string; ts: string; satisfied: boolean; }

/** Metrics dashboard — KPI cards, recent conversations, video citations */
@Component({
  selector: 'bcc-metrics',
  templateUrl: './metrics.component.html',
  styleUrls: ['./metrics.component.scss'],
})
export class MetricsComponent implements OnInit {
  assistantId = '';
  loading = true;
  period: '7d' | '30d' | '90d' = '30d';
  kpis: IKpiCard[] = [];
  recentConversations: IConversationRow[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.loadMetrics();
    this.loading = false;
  }

  async changePeriod(p: '7d' | '30d' | '90d'): Promise<void> {
    this.period = p;
    this.loading = true;
    await this.loadMetrics();
    this.loading = false;
  }

  private async loadMetrics(): Promise<void> {
    const result = await this.api.get<Record<string, unknown>[]>(
      '/metrics', { assistantId: this.assistantId, period: this.period }
    );

    const rows = result.data ?? [];
    const total = rows.length;
    const satisfied = rows.filter((r) => r['satisfied']).length;
    const guardrailHit = rows.filter((r) => r['guardrailTriggered']).length;
    const videoCited = rows.filter((r) => r['videoCited']).length;

    const satRate = total > 0 ? Math.round((satisfied / total) * 100) : 0;
    const grRate = total > 0 ? Math.round((guardrailHit / total) * 100) : 0;

    this.kpis = [
      { label: 'Total Conversations', value: total.toLocaleString(), icon: 'chat', color: '#006FB4' },
      { label: 'Satisfaction Rate', value: `${satRate}%`, icon: 'thumb_up', color: '#2e7d32', trend: '+2%' },
      { label: 'Guardrail Trigger Rate', value: `${grRate}%`, icon: 'shield', color: '#f57c00' },
      { label: 'Video Citations', value: videoCited.toLocaleString(), icon: 'smart_display', color: '#9c27b0' },
    ];

    this.recentConversations = rows.slice(-10).reverse().map((r) => ({
      id: String(r['id'] ?? ''),
      query: String(r['query'] ?? '—'),
      ts: String(r['createdAt'] ?? ''),
      satisfied: Boolean(r['satisfied']),
    }));
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
