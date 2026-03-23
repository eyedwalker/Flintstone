import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { ITestSuite, ITestRun, ITestResult } from '../../../lib/models/test-suite.model';

interface ComparisonRow {
  question: string;
  bedrockResponse?: string;
  bedrockScore?: number;
  bedrockLatency?: number;
  ameliaResponse?: string;
  ameliaScore?: number;
  ameliaLatency?: number;
  testCaseId: string;
}

@Component({
  selector: 'bcc-bot-comparison-dialog',
  template: `
    <h2 mat-dialog-title>
      Bot Comparison — {{ data.suite.name }}
    </h2>
    <mat-dialog-content>
      <div class="loading-wrap" *ngIf="loading">
        <mat-spinner diameter="32"></mat-spinner>
        <span>Loading results...</span>
      </div>

      <div class="no-data" *ngIf="!loading && (!data.bedrockRun || !data.ameliaRun)">
        <mat-icon>info</mat-icon>
        <span *ngIf="!data.bedrockRun">No completed Bedrock run found. Run the suite against Bedrock first.</span>
        <span *ngIf="!data.ameliaRun">No completed Amelia run found. Run the suite against Amelia first.</span>
      </div>

      <!-- Summary comparison -->
      <div class="summary-compare" *ngIf="!loading && data.bedrockRun && data.ameliaRun">
        <div class="summary-col bedrock">
          <div class="col-header">
            <span class="bot-badge bedrock">Bedrock</span>
          </div>
          <div class="big-score" [style.color]="scoreColor(data.bedrockRun.avgScore)">
            {{ data.bedrockRun.avgScore }}
          </div>
          <div class="col-stats">
            <span class="stat-passed">{{ data.bedrockRun.passedCases }} passed</span>
            <span class="stat-failed">{{ data.bedrockRun.failedCases }} failed</span>
          </div>
        </div>
        <div class="vs">VS</div>
        <div class="summary-col amelia">
          <div class="col-header">
            <span class="bot-badge amelia">Amelia</span>
          </div>
          <div class="big-score" [style.color]="scoreColor(data.ameliaRun.avgScore)">
            {{ data.ameliaRun.avgScore }}
          </div>
          <div class="col-stats">
            <span class="stat-passed">{{ data.ameliaRun.passedCases }} passed</span>
            <span class="stat-failed">{{ data.ameliaRun.failedCases }} failed</span>
          </div>
        </div>
      </div>

      <!-- Per-question comparison table -->
      <table class="compare-table" *ngIf="!loading && rows.length">
        <thead>
          <tr>
            <th class="q-col">Question</th>
            <th class="score-col">Bedrock</th>
            <th class="score-col">Amelia</th>
            <th class="delta-col">Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let row of rows" (click)="expandedRow = expandedRow === row ? null : row"
              [class.expanded]="expandedRow === row">
            <td class="q-col">{{ row.question }}</td>
            <td class="score-col" [style.color]="scoreColor(row.bedrockScore)">
              {{ row.bedrockScore ?? '—' }}
              <span class="latency" *ngIf="row.bedrockLatency">({{ row.bedrockLatency }}ms)</span>
            </td>
            <td class="score-col" [style.color]="scoreColor(row.ameliaScore)">
              {{ row.ameliaScore ?? '—' }}
              <span class="latency" *ngIf="row.ameliaLatency">({{ row.ameliaLatency }}ms)</span>
            </td>
            <td class="delta-col" [class.positive]="getDelta(row) > 0" [class.negative]="getDelta(row) < 0">
              {{ getDelta(row) > 0 ? '+' : '' }}{{ getDelta(row) }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Expanded row detail -->
      <div class="expanded-detail" *ngIf="expandedRow">
        <div class="detail-col">
          <div class="detail-header bedrock">Bedrock Response</div>
          <div class="detail-text">{{ expandedRow.bedrockResponse || '(no response)' }}</div>
        </div>
        <div class="detail-col">
          <div class="detail-header amelia">Amelia Response</div>
          <div class="detail-text">{{ expandedRow.ameliaResponse || '(no response)' }}</div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .loading-wrap {
      display: flex; align-items: center; gap: 12px; padding: 24px;
      justify-content: center; color: rgba(0,0,0,0.5);
    }
    .no-data {
      display: flex; align-items: center; gap: 8px; padding: 24px;
      color: rgba(0,0,0,0.5); font-size: 0.9rem;
    }
    .summary-compare {
      display: flex; align-items: center; justify-content: center;
      gap: 24px; padding: 24px 0; margin-bottom: 16px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
    }
    .summary-col {
      text-align: center; min-width: 140px;
    }
    .col-header { margin-bottom: 8px; }
    .big-score { font-size: 2.5rem; font-weight: 800; }
    .col-stats { display: flex; gap: 12px; justify-content: center; font-size: 0.8rem; margin-top: 4px; }
    .stat-passed { color: #2e7d32; }
    .stat-failed { color: #c62828; }
    .vs {
      font-size: 1.2rem; font-weight: 800; color: rgba(0,0,0,0.2);
      padding: 0 12px;
    }
    .bot-badge {
      display: inline-block; padding: 3px 10px; border-radius: 12px;
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
      &.bedrock { background: #e3f2fd; color: #1565c0; }
      &.amelia { background: #f3e5f5; color: #7b1fa2; }
    }
    .compare-table {
      width: 100%; border-collapse: collapse;
      th {
        text-align: left; font-size: 0.7rem; font-weight: 700;
        color: rgba(0,0,0,0.4); text-transform: uppercase;
        padding: 6px 10px; border-bottom: 2px solid #eee;
      }
      td {
        padding: 8px 10px; font-size: 0.85rem;
        border-bottom: 1px solid #f5f5f5;
      }
      tr { cursor: pointer; transition: background 0.15s; }
      tr:hover { background: rgba(0,0,0,0.02); }
      tr.expanded { background: #f5f5f5; }
    }
    .q-col { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score-col { font-weight: 700; text-align: center; min-width: 80px; }
    .delta-col {
      font-weight: 700; text-align: center; min-width: 60px;
      &.positive { color: #2e7d32; }
      &.negative { color: #c62828; }
    }
    .latency { font-weight: 400; font-size: 0.7rem; color: rgba(0,0,0,0.4); }
    .expanded-detail {
      display: flex; gap: 16px; padding: 16px; background: #fafafa;
      border-radius: 8px; margin: 8px 0 16px;
    }
    .detail-col { flex: 1; min-width: 0; }
    .detail-header {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      margin-bottom: 8px; padding: 2px 8px; border-radius: 4px; display: inline-block;
      &.bedrock { background: #e3f2fd; color: #1565c0; }
      &.amelia { background: #f3e5f5; color: #7b1fa2; }
    }
    .detail-text {
      font-size: 0.85rem; white-space: pre-wrap; line-height: 1.5;
      max-height: 300px; overflow-y: auto;
    }
  `],
})
export class BotComparisonDialogComponent implements OnInit {
  loading = false;
  rows: ComparisonRow[] = [];
  expandedRow: ComparisonRow | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: {
      suite: ITestSuite;
      bedrockRun?: ITestRun;
      ameliaRun?: ITestRun;
    },
    private dialogRef: MatDialogRef<BotComparisonDialogComponent>,
    private tsManager: TestSuiteManager,
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.data.bedrockRun || !this.data.ameliaRun) return;

    this.loading = true;

    const [bedrockRes, ameliaRes] = await Promise.all([
      this.tsManager.getRunResults(this.data.bedrockRun.id),
      this.tsManager.getRunResults(this.data.ameliaRun.id),
    ]);

    const bedrockResults = bedrockRes.data ?? [];
    const ameliaResults = ameliaRes.data ?? [];

    // Build comparison rows keyed by testCaseId
    const rowMap = new Map<string, ComparisonRow>();

    for (const r of bedrockResults) {
      const question = r.turns?.[0]?.userMessage ?? '(unknown)';
      rowMap.set(r.testCaseId, {
        question,
        bedrockResponse: r.turns?.map(t => t.actualResponse).join('\n') ?? '',
        bedrockScore: r.aiEvaluation?.overallScore,
        bedrockLatency: r.durationMs,
        testCaseId: r.testCaseId,
      });
    }

    for (const r of ameliaResults) {
      const existing = rowMap.get(r.testCaseId);
      if (existing) {
        existing.ameliaResponse = r.turns?.map(t => t.actualResponse).join('\n') ?? '';
        existing.ameliaScore = r.aiEvaluation?.overallScore;
        existing.ameliaLatency = r.durationMs;
      } else {
        const question = r.turns?.[0]?.userMessage ?? '(unknown)';
        rowMap.set(r.testCaseId, {
          question,
          ameliaResponse: r.turns?.map(t => t.actualResponse).join('\n') ?? '',
          ameliaScore: r.aiEvaluation?.overallScore,
          ameliaLatency: r.durationMs,
          testCaseId: r.testCaseId,
        });
      }
    }

    this.rows = Array.from(rowMap.values()).sort((a, b) => {
      const deltaA = this.getDelta(a);
      const deltaB = this.getDelta(b);
      return deltaA - deltaB; // Show biggest Amelia wins first
    });

    this.loading = false;
  }

  getDelta(row: ComparisonRow): number {
    if (row.bedrockScore == null || row.ameliaScore == null) return 0;
    return row.bedrockScore - row.ameliaScore;
  }

  scoreColor(score: number | undefined): string {
    if (score == null) return '#999';
    if (score >= 80) return '#2e7d32';
    if (score >= 60) return '#e65100';
    return '#c62828';
  }
}
