import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReportScheduleManager } from '../../../lib/managers/report-schedule.manager';

@Component({
  selector: 'bcc-create-schedule-dialog',
  template: `
    <h2 mat-dialog-title>Create Scheduled Report</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Report Name</mat-label>
        <input matInput [(ngModel)]="name" placeholder="e.g. Weekly Revenue Summary">
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>SQL Query</mat-label>
        <textarea matInput [(ngModel)]="sql" rows="5" placeholder='SELECT "Month", SUM("Amount") FROM ...'></textarea>
        <mat-hint>SELECT queries only</mat-hint>
      </mat-form-field>

      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>Frequency</mat-label>
          <mat-select [(value)]="frequency">
            <mat-option value="daily">Daily</mat-option>
            <mat-option value="weekly">Weekly</mat-option>
            <mat-option value="monthly">Monthly</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" *ngIf="frequency === 'weekly'">
          <mat-label>Day of Week</mat-label>
          <mat-select [(value)]="dayOfWeek">
            <mat-option *ngFor="let d of days" [value]="d.value">{{ d.label }}</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" *ngIf="frequency === 'monthly'">
          <mat-label>Day of Month</mat-label>
          <mat-select [(value)]="dayOfMonth">
            <mat-option *ngFor="let d of monthDays" [value]="d">{{ d }}</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>Time (24h)</mat-label>
          <input matInput [(ngModel)]="time" placeholder="08:00">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Timezone</mat-label>
          <mat-select [(value)]="timezone">
            <mat-option value="America/New_York">Eastern</mat-option>
            <mat-option value="America/Chicago">Central</mat-option>
            <mat-option value="America/Denver">Mountain</mat-option>
            <mat-option value="America/Los_Angeles">Pacific</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Format</mat-label>
          <mat-select [(value)]="format">
            <mat-option value="excel">Excel</mat-option>
            <mat-option value="csv">CSV</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Email Recipients</mat-label>
        <input matInput [(ngModel)]="emailRecipients" placeholder="user@example.com, user2@example.com">
        <mat-hint>Comma-separated email addresses</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>SMS Recipients (optional)</mat-label>
        <input matInput [(ngModel)]="smsRecipients" placeholder="+15551234567">
        <mat-hint>Comma-separated phone numbers</mat-hint>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" (click)="create()" [disabled]="saving || !isValid()">
        <mat-spinner *ngIf="saving" diameter="18" class="inline-spinner"></mat-spinner>
        {{ saving ? 'Creating...' : 'Create Schedule' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 500px; }
    .full-width { width: 100%; }
    .row { display: flex; gap: 12px; }
    .row mat-form-field { flex: 1; }
    .inline-spinner { display: inline-block; margin-right: 8px; vertical-align: middle; }
  `],
})
export class CreateScheduleDialogComponent {
  name = '';
  sql = '';
  frequency = 'weekly';
  dayOfWeek = 'MON';
  dayOfMonth = 1;
  time = '08:00';
  timezone = 'America/Chicago';
  format: 'excel' | 'csv' = 'excel';
  emailRecipients = '';
  smsRecipients = '';
  saving = false;

  days = [
    { value: 'MON', label: 'Monday' },
    { value: 'TUE', label: 'Tuesday' },
    { value: 'WED', label: 'Wednesday' },
    { value: 'THU', label: 'Thursday' },
    { value: 'FRI', label: 'Friday' },
    { value: 'SAT', label: 'Saturday' },
    { value: 'SUN', label: 'Sunday' },
  ];

  monthDays = Array.from({ length: 28 }, (_, i) => i + 1);

  constructor(
    private dialogRef: MatDialogRef<CreateScheduleDialogComponent>,
    private manager: ReportScheduleManager,
    private snackBar: MatSnackBar,
  ) {}

  isValid(): boolean {
    return !!(this.name && this.sql && this.emailRecipients);
  }

  async create(): Promise<void> {
    this.saving = true;
    const [h, m] = this.time.split(':');

    let cronExpr: string;
    switch (this.frequency) {
      case 'daily':
        cronExpr = `cron(${m || '0'} ${h || '8'} * * ? *)`;
        break;
      case 'weekly':
        cronExpr = `cron(${m || '0'} ${h || '8'} ? * ${this.dayOfWeek} *)`;
        break;
      case 'monthly':
        cronExpr = `cron(${m || '0'} ${h || '8'} ${this.dayOfMonth} * ? *)`;
        break;
      default:
        cronExpr = `cron(${m || '0'} ${h || '8'} ? * MON *)`;
    }

    const emails = this.emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
    const phones = this.smsRecipients.split(',').map(s => s.trim()).filter(Boolean);

    const res = await this.manager.create({
      name: this.name,
      reportType: 'single',
      reportConfig: {
        sql: this.sql,
        title: this.name,
        format: this.format,
        containsPhi: false,
      },
      scheduleExpression: cronExpr,
      timezone: this.timezone,
      status: 'active',
      delivery: {
        ...(emails.length > 0 ? { email: { recipients: emails } } : {}),
        ...(phones.length > 0 ? { sms: { recipients: phones } } : {}),
      },
    } as any);

    this.saving = false;
    if (res.success) {
      this.dialogRef.close(res.data);
    } else {
      this.snackBar.open('Error: ' + (res.error ?? 'Failed'), '', { duration: 4000 });
    }
  }
}
