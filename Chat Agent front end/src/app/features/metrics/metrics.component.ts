import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

interface IKpiCard { label: string; value: string; icon: string; color: string; sublabel?: string; }
interface IConversationRow {
  id: string; query: string; ts: string; satisfied: boolean | null;
  source: string; responseLength: number; videoCited: boolean; routedAgent: string | null;
}
interface IDailyTrend { date: string; count: number; }
interface IMetricsSummary {
  total: number; satisfied: number; dissatisfied: number; unrated: number;
  guardrailHit: number; videoCited: number; escalated: number;
  adminSource: number; widgetSource: number;
  uniqueSessions: number; avgResponseLength: number;
  medianLatencyMs: number; p90LatencyMs: number; avgLatencyMs: number;
  hasLatencyData: boolean;
  period: string; days: number;
}

interface IScorecardRow {
  kpi: string;
  value: string;
  rawValue: number;
  status: 'green' | 'yellow' | 'red';
  greenRange: string;
  yellowRange: string;
  redRange: string;
}

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
  channelKpis: IKpiCard[] = [];
  recentConversations: IConversationRow[] = [];
  dailyTrend: IDailyTrend[] = [];
  summary: IMetricsSummary | null = null;
  scorecard: IScorecardRow[] = [];
  intentMetrics: Array<{ intent: string; count: number; pct: number; medianLatencyMs: number; needMetRate: number | null }> = [];
  Math = Math;

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
    const result = await this.api.get<any>(
      '/metrics', { assistantId: this.assistantId, period: this.period }
    );

    const data = result.data;

    // Handle both old format (array) and new format (object with summary)
    if (Array.isArray(data)) {
      // Legacy format — compute client-side
      this.buildLegacyMetrics(data);
      return;
    }

    const s: IMetricsSummary = data.summary;
    this.summary = s;
    this.dailyTrend = data.dailyTrend ?? [];

    const satRate = s.total > 0 ? Math.round((s.satisfied / s.total) * 100) : 0;
    const grRate = s.total > 0 ? Math.round((s.guardrailHit / s.total) * 100) : 0;
    const ratedCount = s.satisfied + s.dissatisfied;
    const ratedSatRate = ratedCount > 0 ? Math.round((s.satisfied / ratedCount) * 100) : 0;

    this.kpis = [
      { label: 'Total Conversations', value: s.total.toLocaleString(), icon: 'chat', color: '#006FB4',
        sublabel: `${s.uniqueSessions} unique sessions` },
      { label: 'Satisfaction Rate', value: `${ratedSatRate}%`, icon: 'thumb_up', color: '#2e7d32',
        sublabel: `${s.satisfied} positive, ${s.dissatisfied} negative, ${s.unrated} unrated` },
      { label: 'Guardrail Trigger Rate', value: `${grRate}%`, icon: 'shield', color: '#f57c00',
        sublabel: `${s.guardrailHit} triggered` },
      { label: 'Video Citations', value: s.videoCited.toLocaleString(), icon: 'smart_display', color: '#9c27b0',
        sublabel: `${s.total > 0 ? Math.round((s.videoCited / s.total) * 100) : 0}% of conversations` },
    ];

    this.channelKpis = [
      { label: 'Admin Chat', value: s.adminSource.toLocaleString(), icon: 'admin_panel_settings', color: '#1565c0',
        sublabel: `${s.total > 0 ? Math.round((s.adminSource / s.total) * 100) : 0}%` },
      { label: 'Widget Chat', value: s.widgetSource.toLocaleString(), icon: 'widgets', color: '#00838f',
        sublabel: `${s.total > 0 ? Math.round((s.widgetSource / s.total) * 100) : 0}%` },
      { label: 'Avg Response Length', value: s.avgResponseLength.toLocaleString(), icon: 'short_text', color: '#5d4037',
        sublabel: 'characters' },
      { label: 'Conversations/Day', value: this.dailyTrend.length > 0
          ? (s.total / Math.max(this.dailyTrend.length, 1)).toFixed(1) : '0', icon: 'trending_up', color: '#2e7d32',
        sublabel: `over ${s.days} days` },
    ];

    // Intent metrics
    this.intentMetrics = data.intentMetrics ?? [];

    // Build RYG Scorecard (with intent-specific rows)
    this.buildScorecard(s, this.intentMetrics);

    this.recentConversations = (data.recent ?? []).map((r: any) => ({
      id: r.id ?? '',
      query: r.query ?? '—',
      ts: r.createdAt ?? '',
      satisfied: r.satisfied,
      source: r.source ?? 'admin',
      responseLength: r.responseLength ?? 0,
      videoCited: r.videoCited ?? false,
      routedAgent: r.routedAgent ?? null,
    }));
  }

  private buildLegacyMetrics(rows: Record<string, unknown>[]): void {
    const total = rows.length;
    const satisfied = rows.filter(r => r['satisfied'] === true).length;
    const guardrailHit = rows.filter(r => r['guardrailTriggered']).length;
    const videoCited = rows.filter(r => r['videoCited']).length;
    const satRate = total > 0 ? Math.round((satisfied / total) * 100) : 0;
    const grRate = total > 0 ? Math.round((guardrailHit / total) * 100) : 0;

    this.kpis = [
      { label: 'Total Conversations', value: total.toLocaleString(), icon: 'chat', color: '#006FB4' },
      { label: 'Satisfaction Rate', value: `${satRate}%`, icon: 'thumb_up', color: '#2e7d32' },
      { label: 'Guardrail Trigger Rate', value: `${grRate}%`, icon: 'shield', color: '#f57c00' },
      { label: 'Video Citations', value: videoCited.toLocaleString(), icon: 'smart_display', color: '#9c27b0' },
    ];
    this.channelKpis = [];

    this.recentConversations = rows.slice(-10).reverse().map(r => ({
      id: String(r['id'] ?? ''),
      query: String(r['query'] ?? '—'),
      ts: String(r['createdAt'] ?? ''),
      satisfied: r['satisfied'] as boolean | null,
      source: String(r['source'] ?? 'admin'),
      responseLength: Number(r['responseLength'] ?? 0),
      videoCited: Boolean(r['videoCited']),
      routedAgent: (r['routedAgent'] as string) ?? null,
    }));
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  getSatisfiedIcon(val: boolean | null): string {
    if (val === true) return 'thumb_up';
    if (val === false) return 'thumb_down';
    return 'remove';
  }

  private buildScorecard(s: IMetricsSummary, intents: typeof this.intentMetrics): void {
    // Escalation Rate (% of conversations that escalated)
    const escalationRate = s.total > 0 ? (s.escalated / s.total) * 100 : 0;
    const escalationStatus: 'green' | 'yellow' | 'red' =
      escalationRate <= 1.2 ? 'green' : escalationRate <= 1.5 ? 'yellow' : 'red';

    // Median Response Time
    const medianSec = s.medianLatencyMs / 1000;
    const speedStatus: 'green' | 'yellow' | 'red' =
      !s.hasLatencyData ? 'yellow' :
      medianSec <= 2.0 ? 'green' : medianSec <= 4.9 ? 'yellow' : 'red';

    // Need Met Rate (satisfied / (satisfied + dissatisfied))
    const ratedCount = s.satisfied + s.dissatisfied;
    const needMetRate = ratedCount > 0 ? (s.satisfied / ratedCount) * 100 : 0;
    const needMetStatus: 'green' | 'yellow' | 'red' =
      ratedCount === 0 ? 'yellow' :
      needMetRate >= 75 ? 'green' : needMetRate >= 60 ? 'yellow' : 'red';

    // Need Not Met Rate
    const needNotMetRate = ratedCount > 0 ? (s.dissatisfied / ratedCount) * 100 : 0;
    const needNotMetStatus: 'green' | 'yellow' | 'red' =
      ratedCount === 0 ? 'yellow' :
      needNotMetRate <= 10 ? 'green' : needNotMetRate <= 20 ? 'yellow' : 'red';

    // Adoption: Chat/Case Ratio (conversations per day as proxy)
    const convsPerDay = s.days > 0 ? s.total / s.days : 0;
    const adoptionStatus: 'green' | 'yellow' | 'red' =
      convsPerDay >= 10 ? 'green' : convsPerDay >= 5 ? 'yellow' : 'red';

    this.scorecard = [
      {
        kpi: 'Escalation Rate', value: `${escalationRate.toFixed(1)}%`, rawValue: escalationRate,
        status: escalationStatus, greenRange: '≤ 1.2%', yellowRange: '1.3–1.5%', redRange: '> 1.5%',
      },
      {
        kpi: 'Speed: Median Response Time', value: s.hasLatencyData ? `${medianSec.toFixed(1)}s` : 'No data',
        rawValue: medianSec, status: speedStatus,
        greenRange: '≤ 2.0s', yellowRange: '2.1–4.9s', redRange: '> 5.0s',
      },
      {
        kpi: 'Quality: Need Met Rate', value: ratedCount > 0 ? `${needMetRate.toFixed(0)}%` : 'No ratings',
        rawValue: needMetRate, status: needMetStatus,
        greenRange: '≥ 75%', yellowRange: '60–74%', redRange: '< 60%',
      },
      {
        kpi: 'Quality: Need Not Met', value: ratedCount > 0 ? `${needNotMetRate.toFixed(0)}%` : 'No ratings',
        rawValue: needNotMetRate, status: needNotMetStatus,
        greenRange: '≤ 10%', yellowRange: '11–20%', redRange: '> 20%',
      },
      {
        kpi: 'Adoption: Conversations/Day', value: convsPerDay.toFixed(1),
        rawValue: convsPerDay, status: adoptionStatus,
        greenRange: '≥ 10/day', yellowRange: '5–9/day', redRange: '< 5/day',
      },
    ];

    // Add intent-specific speed rows
    const reporting = intents.find(i => i.intent === 'reporting');
    const help = intents.find(i => i.intent === 'help');
    const frontOffice = intents.find(i => i.intent === 'front-office');

    if (reporting && reporting.medianLatencyMs > 0) {
      const sec = reporting.medianLatencyMs / 1000;
      // Reporting gets a higher threshold (complex queries)
      const st: 'green' | 'yellow' | 'red' = sec <= 5.0 ? 'green' : sec <= 10.0 ? 'yellow' : 'red';
      this.scorecard.push({
        kpi: `Speed: Reporting (${reporting.count} queries)`, value: `${sec.toFixed(1)}s`,
        rawValue: sec, status: st, greenRange: '≤ 5.0s', yellowRange: '5.1–10s', redRange: '> 10s',
      });
    }

    if (help && help.medianLatencyMs > 0) {
      const sec = help.medianLatencyMs / 1000;
      const st: 'green' | 'yellow' | 'red' = sec <= 2.0 ? 'green' : sec <= 4.9 ? 'yellow' : 'red';
      this.scorecard.push({
        kpi: `Speed: Help/KB (${help.count} queries)`, value: `${sec.toFixed(1)}s`,
        rawValue: sec, status: st, greenRange: '≤ 2.0s', yellowRange: '2.1–4.9s', redRange: '> 5.0s',
      });
    }

    if (frontOffice && frontOffice.medianLatencyMs > 0) {
      const sec = frontOffice.medianLatencyMs / 1000;
      const st: 'green' | 'yellow' | 'red' = sec <= 3.0 ? 'green' : sec <= 6.0 ? 'yellow' : 'red';
      this.scorecard.push({
        kpi: `Speed: Front Office (${frontOffice.count} queries)`, value: `${sec.toFixed(1)}s`,
        rawValue: sec, status: st, greenRange: '≤ 3.0s', yellowRange: '3.1–6.0s', redRange: '> 6.0s',
      });
    }

    // Add intent-specific quality rows
    if (reporting?.needMetRate !== null && reporting?.needMetRate !== undefined) {
      const rate = reporting.needMetRate;
      const st: 'green' | 'yellow' | 'red' = rate >= 75 ? 'green' : rate >= 60 ? 'yellow' : 'red';
      this.scorecard.push({
        kpi: 'Quality: Reporting Accuracy', value: `${rate}%`,
        rawValue: rate, status: st, greenRange: '≥ 75%', yellowRange: '60–74%', redRange: '< 60%',
      });
    }

    if (help?.needMetRate !== null && help?.needMetRate !== undefined) {
      const rate = help.needMetRate;
      const st: 'green' | 'yellow' | 'red' = rate >= 75 ? 'green' : rate >= 60 ? 'yellow' : 'red';
      this.scorecard.push({
        kpi: 'Quality: Help/KB Accuracy', value: `${rate}%`,
        rawValue: rate, status: st, greenRange: '≥ 75%', yellowRange: '60–74%', redRange: '< 60%',
      });
    }
  }

  getIntentIcon(intent: string): string {
    switch (intent) {
      case 'reporting': return 'bar_chart';
      case 'help': return 'help_outline';
      case 'front-office': return 'event';
      case 'mixed': return 'shuffle';
      default: return 'chat';
    }
  }

  getIntentLabel(intent: string): string {
    switch (intent) {
      case 'reporting': return 'Reporting & Analytics';
      case 'help': return 'Help & Knowledge Base';
      case 'front-office': return 'Front Office';
      case 'mixed': return 'Mixed';
      default: return intent;
    }
  }

  get maxDailyCount(): number {
    return Math.max(1, ...this.dailyTrend.map(d => d.count));
  }

  getSatisfiedColor(val: boolean | null): string {
    if (val === true) return '#2e7d32';
    if (val === false) return '#c62828';
    return 'rgba(0,0,0,0.3)';
  }
}
