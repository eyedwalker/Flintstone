import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReportScheduleManager, IReportSchedule } from '../../../lib/managers/report-schedule.manager';
import { CreateScheduleDialogComponent } from './create-schedule-dialog.component';

@Component({
  selector: 'bcc-report-schedule-list',
  templateUrl: './report-schedule-list.component.html',
  styleUrls: ['./report-schedule-list.component.scss'],
})
export class ReportScheduleListComponent implements OnInit {
  schedules: IReportSchedule[] = [];
  loading = false;

  constructor(
    private manager: ReportScheduleManager,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    const res = await this.manager.list();
    this.schedules = (res.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.loading = false;
  }

  openCreate(): void {
    const ref = this.dialog.open(CreateScheduleDialogComponent, {
      width: '700px',
      maxHeight: '90vh',
    });
    ref.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.load();
        this.snackBar.open('Schedule created', '', { duration: 2000 });
      }
    });
  }

  openDetail(schedule: IReportSchedule): void {
    this.router.navigate(['/report-schedules', schedule.id]);
  }

  async togglePause(schedule: IReportSchedule, event: Event): Promise<void> {
    event.stopPropagation();
    if (schedule.status === 'active') {
      const res = await this.manager.pause(schedule.id);
      if (res.success) {
        schedule.status = 'paused';
        this.snackBar.open('Schedule paused', '', { duration: 2000 });
      }
    } else {
      const res = await this.manager.resume(schedule.id);
      if (res.success) {
        schedule.status = 'active';
        this.snackBar.open('Schedule resumed', '', { duration: 2000 });
      }
    }
  }

  async triggerRun(schedule: IReportSchedule, event: Event): Promise<void> {
    event.stopPropagation();
    const res = await this.manager.triggerRun(schedule.id);
    if (res.success) {
      this.snackBar.open('Report triggered - running now', '', { duration: 3000 });
    } else {
      this.snackBar.open('Failed to trigger: ' + (res.error ?? 'Unknown'), '', { duration: 4000 });
    }
  }

  async deleteSchedule(schedule: IReportSchedule, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete schedule "${schedule.name}"? This cannot be undone.`)) return;
    const res = await this.manager.delete(schedule.id);
    if (res.success) {
      this.schedules = this.schedules.filter(s => s.id !== schedule.id);
      this.snackBar.open('Schedule deleted', '', { duration: 2000 });
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'active': return '#4caf50';
      case 'paused': return '#ff9800';
      case 'disabled': return '#f44336';
      case 'error': return '#f44336';
      default: return '#9e9e9e';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'active': return 'check_circle';
      case 'paused': return 'pause_circle';
      case 'disabled': return 'cancel';
      case 'error': return 'error';
      default: return 'help';
    }
  }

  formatFrequency(expr: string): string {
    if (expr.includes('* * ? *')) return 'Daily';
    if (expr.includes('? *') && expr.includes('MON')) return 'Weekly (Mon)';
    if (expr.includes('? *') && expr.includes('TUE')) return 'Weekly (Tue)';
    if (expr.includes('? *') && expr.includes('WED')) return 'Weekly (Wed)';
    if (expr.includes('? *') && expr.includes('THU')) return 'Weekly (Thu)';
    if (expr.includes('? *') && expr.includes('FRI')) return 'Weekly (Fri)';
    if (expr.includes('? *') && /[A-Z]{3}/.test(expr)) return 'Weekly';
    if (expr.includes('* ? *')) return 'Monthly';
    return expr;
  }

  formatDate(iso: string): string {
    if (!iso) return '--';
    return new Date(iso).toLocaleString();
  }

  getRecipientCount(schedule: IReportSchedule): number {
    return (schedule.delivery.email?.recipients?.length ?? 0)
      + (schedule.delivery.sms?.recipients?.length ?? 0);
  }
}
