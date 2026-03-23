import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { IExternalBotConfig } from '../../../lib/models/test-suite.model';

@Component({
  selector: 'bcc-external-bot-config-dialog',
  template: `
    <h2 mat-dialog-title>Amelia Connection Settings</h2>
    <mat-dialog-content>
      <p class="hint">Configure the connection to the Amelia chatbot for external bot testing.</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Base URL</mat-label>
        <input matInput [(ngModel)]="config.baseUrl" placeholder="https://eyefinity.partners.amelia.com/AmeliaRest">
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Domain Code</mat-label>
        <input matInput [(ngModel)]="config.domainCode" placeholder="eyefinitysandbox">
      </mat-form-field>

      <h4>Authentication</h4>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Username</mat-label>
        <input matInput [(ngModel)]="config.username" autocomplete="off">
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Password</mat-label>
        <input matInput [(ngModel)]="config.password" type="password" autocomplete="off">
      </mat-form-field>

      <mat-divider></mat-divider>
      <p class="hint" style="margin-top: 12px;">Or use OAuth client credentials:</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Client ID</mat-label>
        <input matInput [(ngModel)]="config.clientId" autocomplete="off">
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Client Secret</mat-label>
        <input matInput [(ngModel)]="config.clientSecret" type="password" autocomplete="off">
      </mat-form-field>

      <!-- Quick test section -->
      <h4>Quick Test</h4>
      <div class="quick-test">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Test question</mat-label>
          <input matInput [(ngModel)]="testQuestion" placeholder="How do I add a patient?">
        </mat-form-field>
        <button mat-stroked-button color="primary" (click)="runQuickTest()" [disabled]="testing || !testQuestion">
          {{ testing ? 'Waiting for Amelia...' : 'Send' }}
        </button>
      </div>
      <div class="quick-result" *ngIf="testResult">
        <div class="result-label">Amelia replied ({{ testResponseTime }}ms):</div>
        <div class="result-text">{{ testResult }}</div>
      </div>
      <div class="quick-error" *ngIf="testError">{{ testError }}</div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="saving">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .hint { color: rgba(0,0,0,0.5); font-size: 0.85rem; margin-bottom: 12px; }
    h4 { margin: 8px 0 4px; font-weight: 600; font-size: 0.9rem; }
    .quick-test { display: flex; align-items: flex-start; gap: 8px; }
    .quick-test mat-form-field { flex: 1; }
    .quick-result {
      background: #f5f5f5; border-radius: 8px; padding: 12px; margin-top: 8px;
      .result-label { font-size: 0.75rem; color: rgba(0,0,0,0.5); margin-bottom: 4px; }
      .result-text { font-size: 0.85rem; white-space: pre-wrap; }
    }
    .quick-error { color: #c62828; font-size: 0.8rem; margin-top: 8px; }
  `],
})
export class ExternalBotConfigDialogComponent implements OnInit {
  config: IExternalBotConfig = {
    baseUrl: 'https://eyefinity.partners.amelia.com/AmeliaRest',
    domainCode: 'eyefinitysandbox',
  };
  saving = false;
  testing = false;
  testQuestion = '';
  testResult = '';
  testResponseTime = 0;
  testError = '';

  constructor(
    private dialogRef: MatDialogRef<ExternalBotConfigDialogComponent>,
    private tsManager: TestSuiteManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.tsManager.getExternalBotConfig();
    if (res.success && res.data) {
      this.config = res.data;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    const res = await this.tsManager.saveExternalBotConfig(this.config);
    this.saving = false;
    if (res.success) {
      this.snackBar.open('Amelia config saved', '', { duration: 2000 });
      this.dialogRef.close(true);
    } else {
      this.snackBar.open(`Failed: ${res.error}`, 'Dismiss', { duration: 5000 });
    }
  }

  async runQuickTest(): Promise<void> {
    this.testing = true;
    this.testResult = '';
    this.testError = '';

    // Start async test
    const res = await this.tsManager.quickTestExternalBot([this.testQuestion], this.config);
    if (!res.success || !res.data?.jobId) {
      this.testing = false;
      this.testError = res.error ?? 'Failed to start test';
      return;
    }

    // Poll for result (Amelia can take up to 60s)
    const jobId = res.data.jobId;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await this.tsManager.pollQuickTest(jobId);
      if (poll.success && poll.data) {
        const job = poll.data as any;
        if (job.status === 'completed') {
          this.testing = false;
          const results = job.quickTestResults ?? [];
          if (results.length > 0) {
            const r = results[0];
            if (r.error) {
              this.testError = r.error;
            } else {
              this.testResult = r.response;
              this.testResponseTime = r.responseTimeMs;
            }
          } else {
            this.testError = 'No results returned';
          }
          return;
        }
        if (job.status === 'failed') {
          this.testing = false;
          this.testError = job.quickTestError ?? 'Test failed';
          return;
        }
      }
    }
    this.testing = false;
    this.testError = 'Test timed out (60s)';
  }
}
