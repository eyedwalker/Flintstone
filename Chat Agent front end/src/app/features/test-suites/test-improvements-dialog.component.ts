import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { IImprovement, ImprovementType } from '../../../lib/models/test-suite.model';

export interface IImprovementsData {
  improvements: IImprovement[];
  runId: string;
}

@Component({
  selector: 'bcc-test-improvements-dialog',
  template: `
    <h2 mat-dialog-title>
      <mat-icon>auto_fix_high</mat-icon>
      AI Improvement Suggestions
    </h2>

    <mat-dialog-content class="improvements-content">
      <p class="intro" *ngIf="improvements.length">
        Based on low-scoring and negatively reviewed results, AI identified
        {{ improvements.length }} improvement{{ improvements.length === 1 ? '' : 's' }}.
      </p>
      <p class="intro empty" *ngIf="!improvements.length">
        No improvement suggestions were generated. This may mean the run had good scores overall.
      </p>

      <div class="improvement-groups">
        <div class="group" *ngFor="let group of groupedImprovements">
          <h3>
            <mat-icon>{{ typeIcon(group.type) }}</mat-icon>
            {{ typeLabel(group.type) }}
          </h3>

          <div class="improvement-card" *ngFor="let item of group.items"
               [class.applied]="item.applied">

            <div class="card-header">
              <span class="priority-badge" [class]="item.priority">{{ item.priority }}</span>
              <span class="card-title">{{ item.title }}</span>
              <mat-icon class="applied-check" *ngIf="item.applied">check_circle</mat-icon>
            </div>

            <p class="card-desc">{{ item.description }}</p>

            <div class="proposed-content" *ngIf="item.proposedContent">
              <h4>Proposed Content</h4>
              <pre>{{ item.proposedContent }}</pre>
            </div>

            <div class="prompt-diff" *ngIf="item.promptDiff">
              <h4>Prompt Change</h4>
              <div class="diff-before">
                <span class="diff-label">Before:</span>
                <pre>{{ item.promptDiff.before }}</pre>
              </div>
              <div class="diff-after">
                <span class="diff-label">After:</span>
                <pre>{{ item.promptDiff.after }}</pre>
              </div>
            </div>

            <div class="card-actions" *ngIf="!item.applied">
              <button mat-flat-button color="primary" (click)="apply(item)"
                      [disabled]="applyingId === item.id">
                <mat-spinner *ngIf="applyingId === item.id" diameter="18"></mat-spinner>
                Apply
              </button>
              <button mat-button (click)="dismiss(item)">Dismiss</button>
            </div>

            <div class="applied-note" *ngIf="item.applied">
              Applied {{ item.appliedAt | date:'short' }}
            </div>
          </div>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 { display: flex; align-items: center; gap: 8px; }
    .improvements-content { max-height: 70vh; overflow-y: auto; min-width: 720px; }
    .intro { font-size: 0.9rem; color: rgba(0,0,0,0.6); margin-bottom: 16px; }
    .intro.empty { text-align: center; padding: 24px 0; }

    .group { margin-bottom: 20px; }
    .group h3 {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.95rem; font-weight: 600; margin: 0 0 8px;
      padding-bottom: 4px; border-bottom: 1px solid rgba(0,0,0,0.08);
    }

    .improvement-card {
      border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
      padding: 12px 16px; margin-bottom: 8px;
      &.applied { opacity: 0.6; }
    }

    .card-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
      .card-title { font-weight: 600; font-size: 0.9rem; }
      .applied-check { color: #2e7d32; margin-left: auto; }
    }

    .priority-badge {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      padding: 2px 8px; border-radius: 10px;
      &.high { background: #ffebee; color: #c62828; }
      &.medium { background: #fff3e0; color: #e65100; }
      &.low { background: #e8f5e9; color: #2e7d32; }
    }

    .card-desc { font-size: 0.83rem; color: rgba(0,0,0,0.65); line-height: 1.5; margin: 4px 0 8px; }

    h4 { font-size: 0.75rem; font-weight: 600; margin: 8px 0 4px; color: rgba(0,0,0,0.5); }
    pre {
      font-size: 0.78rem; background: #fafafa; padding: 8px 12px;
      border-radius: 6px; white-space: pre-wrap; word-break: break-word;
      max-height: 150px; overflow-y: auto; border: 1px solid rgba(0,0,0,0.06);
    }

    .diff-before pre { border-left: 3px solid #c62828; }
    .diff-after pre { border-left: 3px solid #2e7d32; }
    .diff-label { font-size: 0.7rem; font-weight: 600; color: rgba(0,0,0,0.4); }

    .card-actions { display: flex; gap: 8px; margin-top: 8px; }
    .applied-note { font-size: 0.75rem; color: rgba(0,0,0,0.4); margin-top: 4px; }
  `],
})
export class TestImprovementsDialogComponent {
  improvements: IImprovement[];
  runId: string;
  applyingId: string | null = null;

  constructor(
    public dialogRef: MatDialogRef<TestImprovementsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: IImprovementsData,
    private tsManager: TestSuiteManager,
    private snackBar: MatSnackBar,
  ) {
    this.improvements = [...data.improvements];
    this.runId = data.runId;
  }

  get groupedImprovements(): { type: ImprovementType; items: IImprovement[] }[] {
    const typeOrder: ImprovementType[] = [
      'KNOWLEDGE_GAP', 'PROMPT_IMPROVEMENT', 'GUARDRAIL_ADJUSTMENT', 'CONTENT_UPDATE',
    ];
    const groups: { type: ImprovementType; items: IImprovement[] }[] = [];
    for (const type of typeOrder) {
      const items = this.improvements.filter(i => i.type === type);
      if (items.length) groups.push({ type, items });
    }
    return groups;
  }

  typeIcon(type: ImprovementType): string {
    switch (type) {
      case 'KNOWLEDGE_GAP': return 'library_add';
      case 'PROMPT_IMPROVEMENT': return 'edit_note';
      case 'GUARDRAIL_ADJUSTMENT': return 'security';
      case 'CONTENT_UPDATE': return 'update';
      default: return 'lightbulb';
    }
  }

  typeLabel(type: ImprovementType): string {
    switch (type) {
      case 'KNOWLEDGE_GAP': return 'Knowledge Gaps';
      case 'PROMPT_IMPROVEMENT': return 'Prompt Improvements';
      case 'GUARDRAIL_ADJUSTMENT': return 'Guardrail Adjustments';
      case 'CONTENT_UPDATE': return 'Content Updates';
      default: return type;
    }
  }

  async apply(item: IImprovement): Promise<void> {
    this.applyingId = item.id;
    const res = await this.tsManager.applyImprovement(this.runId, item.id);
    this.applyingId = null;

    if (res.success) {
      item.applied = true;
      item.appliedAt = new Date().toISOString();
      this.snackBar.open(`Applied: ${item.title}`, '', { duration: 3000 });
    } else {
      this.snackBar.open('Failed to apply improvement', 'Dismiss', { duration: 5000 });
    }
  }

  dismiss(item: IImprovement): void {
    this.improvements = this.improvements.filter(i => i.id !== item.id);
  }
}
