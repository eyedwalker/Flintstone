import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import {
  ITestResult,
  IUserReview,
  ITrainerAnnotation,
  ITrainerCorrection,
  TrainingStatus,
  REVIEW_TAGS,
  ReviewTag,
} from '../../../lib/models/test-suite.model';

export interface IResultDetailData {
  result: ITestResult;
  runId: string;
}

@Component({
  selector: 'bcc-test-result-detail-dialog',
  template: `
    <h2 mat-dialog-title class="detail-title">
      <mat-icon [class]="statusClass">{{ statusIcon }}</mat-icon>
      <span>Test Result</span>
      <span class="score-badge" [style.color]="scoreColor(result.aiEvaluation.overallScore)">
        {{ result.aiEvaluation.overallScore }}/100
      </span>
    </h2>

    <mat-dialog-content class="detail-content">
      <div class="split-view">

        <!-- Left: Conversation -->
        <div class="conversation-panel">
          <h3>Conversation</h3>
          <div class="turn-list">
            <div class="turn" *ngFor="let turn of result.turns; let i = index">
              <div class="turn-header">Turn {{ i + 1 }}</div>

              <div class="message user-message">
                <div class="message-label">User</div>
                <div class="message-text">{{ turn.userMessage }}</div>
              </div>

              <div class="message expected-message">
                <div class="message-label">Expected</div>
                <div class="message-text">{{ turn.expectedBehavior }}</div>
              </div>

              <div class="message actual-message">
                <div class="message-label">Response</div>
                <div class="message-text">{{ turn.actualResponse }}</div>
              </div>

              <div class="turn-meta">
                <span class="turn-score" [style.color]="scoreColor(turn.turnScore)">
                  Score: {{ turn.turnScore }}
                </span>
                <span class="turn-latency">{{ turn.latencyMs }}ms</span>
              </div>

              <div class="assertion-results" *ngIf="turn.assertionResults?.length">
                <div class="assertion" *ngFor="let a of turn.assertionResults"
                     [class.pass]="a.passed" [class.fail]="!a.passed">
                  <mat-icon>{{ a.passed ? 'check' : 'close' }}</mat-icon>
                  <span class="assertion-type">{{ a.type }}</span>
                  <span class="assertion-detail">{{ a.detail }}</span>
                </div>
              </div>

              <!-- Trainer Correction -->
              <div class="trainer-correction">
                <div class="message-label correction-label">
                  <mat-icon class="small-icon">school</mat-icon> Ideal Response (Training)
                </div>
                <textarea class="correction-textarea"
                          rows="4"
                          [value]="getCorrection(i)?.idealResponse ?? turn.actualResponse"
                          (input)="updateCorrection(i, $event)"
                          placeholder="Edit to provide the ideal response for training..."></textarea>
                <mat-form-field appearance="outline" class="correction-notes">
                  <mat-label>Correction Notes</mat-label>
                  <input matInput [value]="getCorrection(i)?.correctionNotes ?? ''"
                         (input)="updateCorrectionNotes(i, $event)"
                         placeholder="Why was this corrected?">
                </mat-form-field>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Evaluation + Review -->
        <div class="eval-panel">
          <h3>AI Evaluation</h3>

          <div class="metrics-grid">
            <div class="metric" *ngFor="let m of metricEntries">
              <div class="metric-bar-wrap">
                <div class="metric-label">{{ m.label }}</div>
                <div class="metric-bar-bg">
                  <div class="metric-bar-fill" [style.width.%]="m.value"
                       [style.background]="scoreColor(m.value)"></div>
                </div>
                <div class="metric-value">{{ m.value }}</div>
              </div>
            </div>
          </div>

          <div class="ai-reasoning" *ngIf="result.aiEvaluation.reasoning">
            <h4>Reasoning</h4>
            <p>{{ result.aiEvaluation.reasoning }}</p>
          </div>

          <div class="ai-issues" *ngIf="result.aiEvaluation.issues?.length">
            <h4>Issues</h4>
            <ul>
              <li *ngFor="let issue of result.aiEvaluation.issues">{{ issue }}</li>
            </ul>
          </div>

          <mat-divider></mat-divider>

          <h3>Your Review</h3>

          <div class="star-rating">
            <button mat-icon-button *ngFor="let s of [1,2,3,4,5]"
                    (click)="review.rating = s">
              <mat-icon>{{ s <= review.rating ? 'star' : 'star_border' }}</mat-icon>
            </button>
          </div>

          <div class="review-tags">
            <mat-chip-listbox multiple>
              <mat-chip-option *ngFor="let tag of reviewTags"
                               [selected]="selectedTags.has(tag)"
                               (selectionChange)="toggleTag(tag, $event.selected)">
                {{ tag }}
              </mat-chip-option>
            </mat-chip-listbox>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Feedback</mat-label>
            <textarea matInput rows="3" [(ngModel)]="review.feedback"
                      placeholder="Optional feedback..."></textarea>
          </mat-form-field>

          <button mat-flat-button color="primary" (click)="submitReview()"
                  [disabled]="saving || review.rating === 0">
            <mat-spinner *ngIf="saving" diameter="18"></mat-spinner>
            {{ result.userReview ? 'Update Review' : 'Submit Review' }}
          </button>

          <mat-divider></mat-divider>

          <h3>Training Status</h3>
          <div class="training-status-controls">
            <mat-button-toggle-group [(value)]="trainingStatus">
              <mat-button-toggle value="approved">Approved</mat-button-toggle>
              <mat-button-toggle value="corrected">Corrected</mat-button-toggle>
              <mat-button-toggle value="excluded">Excluded</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          <button mat-flat-button color="accent" (click)="saveAnnotation()"
                  [disabled]="savingAnnotation" class="save-annotation-btn">
            <mat-spinner *ngIf="savingAnnotation" diameter="18"></mat-spinner>
            Save Training Data
          </button>
        </div>

      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close(updated ? result : null)">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .detail-title {
      display: flex; align-items: center; gap: 8px;
      .score-badge { margin-left: auto; font-size: 1.1rem; font-weight: 700; }
    }
    .detail-content { max-height: 70vh; overflow-y: auto; }
    .split-view { display: flex; gap: 24px; min-width: 860px; }
    .conversation-panel { flex: 1; min-width: 0; }
    .eval-panel { width: 320px; flex-shrink: 0; }

    h3 { margin: 0 0 12px; font-size: 1rem; font-weight: 600; }
    h4 { margin: 12px 0 4px; font-size: 0.85rem; font-weight: 600; }

    .turn-list { display: flex; flex-direction: column; gap: 16px; }
    .turn { border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; padding: 12px; }
    .turn-header { font-size: 0.75rem; font-weight: 600; color: rgba(0,0,0,0.45); margin-bottom: 8px; text-transform: uppercase; }

    .message { margin-bottom: 8px; }
    .message-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; color: rgba(0,0,0,0.45); margin-bottom: 2px; }
    .message-text { font-size: 0.85rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }

    .user-message .message-text { background: #e3f2fd; padding: 8px 12px; border-radius: 8px; }
    .expected-message .message-text { background: #f5f5f5; padding: 8px 12px; border-radius: 8px; font-style: italic; }
    .actual-message .message-text { background: #fff; border: 1px solid rgba(0,0,0,0.1); padding: 8px 12px; border-radius: 8px; }

    .turn-meta { display: flex; gap: 12px; font-size: 0.75rem; margin-top: 4px; }
    .turn-latency { color: rgba(0,0,0,0.4); }

    .assertion-results { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
    .assertion { display: flex; align-items: center; gap: 4px; font-size: 0.75rem;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &.pass { color: #2e7d32; }
      &.fail { color: #c62828; }
    }
    .assertion-type { font-weight: 600; }

    .metrics-grid { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .metric-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .metric-label { font-size: 0.75rem; width: 100px; text-transform: capitalize; }
    .metric-bar-bg { flex: 1; height: 8px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; }
    .metric-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .metric-value { font-size: 0.75rem; font-weight: 600; min-width: 24px; text-align: right; }

    .ai-reasoning p { font-size: 0.83rem; color: rgba(0,0,0,0.7); line-height: 1.5; }
    .ai-issues ul { padding-left: 16px; font-size: 0.83rem; color: rgba(0,0,0,0.7); }
    .ai-issues li { margin-bottom: 4px; }

    mat-divider { margin: 16px 0; }

    .star-rating {
      display: flex; margin-bottom: 8px;
      button { color: #ffc107; }
    }

    .review-tags { margin-bottom: 12px; }
    .full-width { width: 100%; }

    .status-passed { color: #2e7d32; }
    .status-failed { color: #c62828; }
    .status-error { color: #e65100; }

    .trainer-correction {
      margin-top: 8px; padding: 8px; border: 1px dashed #1565c0; border-radius: 8px; background: #f3f8ff;
    }
    .correction-label {
      display: flex; align-items: center; gap: 4px; color: #1565c0;
      .small-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .correction-textarea {
      width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6px; font-family: inherit; font-size: 0.85rem; resize: vertical;
      margin-top: 4px;
    }
    .correction-notes { width: 100%; margin-top: 4px; }

    .training-status-controls { margin-bottom: 12px; }
    .save-annotation-btn { width: 100%; }
  `],
})
export class TestResultDetailDialogComponent {
  result: ITestResult;
  runId: string;
  review: { rating: number; feedback: string } = { rating: 0, feedback: '' };
  selectedTags = new Set<ReviewTag>();
  reviewTags = REVIEW_TAGS;
  saving = false;
  savingAnnotation = false;
  updated = false;

  // Trainer correction state
  corrections: Map<number, ITrainerCorrection> = new Map();
  trainingStatus: TrainingStatus = 'unreviewed';

  constructor(
    public dialogRef: MatDialogRef<TestResultDetailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: IResultDetailData,
    private tsManager: TestSuiteManager,
    private snackBar: MatSnackBar,
  ) {
    this.result = data.result;
    this.runId = data.runId;

    // Pre-fill if already reviewed
    if (this.result.userReview) {
      this.review.rating = this.result.userReview.rating;
      this.review.feedback = this.result.userReview.feedback;
      this.result.userReview.tags.forEach(t => this.selectedTags.add(t as ReviewTag));
    }

    // Pre-fill trainer corrections if they exist
    if (this.result.trainerAnnotation) {
      this.trainingStatus = this.result.trainerAnnotation.trainingStatus;
      this.result.trainerAnnotation.corrections.forEach(c =>
        this.corrections.set(c.turnIndex, c),
      );
    }
  }

  get metricEntries() {
    const m = this.result.aiEvaluation.metrics;
    return [
      { label: 'Relevance', value: m.relevance },
      { label: 'Accuracy', value: m.accuracy },
      { label: 'Completeness', value: m.completeness },
      { label: 'Tone', value: m.tone },
      { label: 'Guardrails', value: m.guardrailCompliance },
    ];
  }

  get statusIcon(): string {
    switch (this.result.status) {
      case 'passed': return 'check_circle';
      case 'failed': return 'cancel';
      case 'error': return 'error';
      default: return 'help';
    }
  }

  get statusClass(): string {
    return `status-${this.result.status}`;
  }

  scoreColor(score: number): string {
    if (score >= 80) return '#2e7d32';
    if (score >= 60) return '#e65100';
    return '#c62828';
  }

  toggleTag(tag: ReviewTag, selected: boolean): void {
    if (selected) this.selectedTags.add(tag);
    else this.selectedTags.delete(tag);
  }

  async submitReview(): Promise<void> {
    this.saving = true;
    const review: IUserReview = {
      rating: this.review.rating,
      feedback: this.review.feedback,
      tags: [...this.selectedTags],
      reviewedAt: new Date().toISOString(),
    };

    const res = await this.tsManager.submitReview(this.runId, this.result.id, review);
    this.saving = false;

    if (res.success) {
      this.result.userReview = review;
      this.updated = true;
      this.snackBar.open('Review saved', '', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to save review', 'Dismiss', { duration: 5000 });
    }
  }

  // ── Trainer Correction Methods ──────────────────────────────────────────

  getCorrection(turnIndex: number): ITrainerCorrection | undefined {
    return this.corrections.get(turnIndex);
  }

  updateCorrection(turnIndex: number, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    const existing = this.corrections.get(turnIndex);
    this.corrections.set(turnIndex, {
      ...(existing ?? { turnIndex }),
      turnIndex,
      idealResponse: value,
    });
  }

  updateCorrectionNotes(turnIndex: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const existing = this.corrections.get(turnIndex);
    if (existing) {
      existing.correctionNotes = value;
    } else {
      this.corrections.set(turnIndex, {
        turnIndex,
        idealResponse: this.result.turns[turnIndex]?.actualResponse ?? '',
        correctionNotes: value,
      });
    }
  }

  async saveAnnotation(): Promise<void> {
    this.savingAnnotation = true;
    const annotation: ITrainerAnnotation = {
      corrections: [...this.corrections.values()],
      trainingStatus: this.trainingStatus,
      annotatedBy: '',
      annotatedAt: new Date().toISOString(),
    };

    const res = await this.tsManager.saveAnnotation(this.runId, this.result.id, annotation);
    this.savingAnnotation = false;

    if (res.success) {
      this.result.trainerAnnotation = annotation;
      this.updated = true;
      this.snackBar.open('Training data saved', '', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to save training data', 'Dismiss', { duration: 5000 });
    }
  }
}
