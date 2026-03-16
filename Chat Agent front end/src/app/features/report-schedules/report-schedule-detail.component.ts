import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReportScheduleManager, IReportSchedule, IReportRun } from '../../../lib/managers/report-schedule.manager';

@Component({
  selector: 'bcc-report-schedule-detail',
  templateUrl: './report-schedule-detail.component.html',
  styleUrls: ['./report-schedule-detail.component.scss'],
})
export class ReportScheduleDetailComponent implements OnInit {
  schedule: IReportSchedule | null = null;
  runs: IReportRun[] = [];
  loading = false;
  scheduleId = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private manager: ReportScheduleManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.scheduleId = this.route.snapshot.paramMap.get('scheduleId') ?? '';
    if (!this.scheduleId) return;
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    const [schedRes, runsRes] = await Promise.all([
      this.manager.get(this.scheduleId),
      this.manager.listRuns(this.scheduleId),
    ]);
    this.schedule = schedRes.data ?? null;
    this.runs = (runsRes.data ?? []).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    this.loading = false;
  }

  async togglePause(): Promise<void> {
    if (!this.schedule) return;
    if (this.schedule.status === 'active') {
      const res = await this.manager.pause(this.scheduleId);
      if (res.success) {
        this.schedule.status = 'paused';
        this.snackBar.open('Schedule paused', '', { duration: 2000 });
      }
    } else {
      const res = await this.manager.resume(this.scheduleId);
      if (res.success) {
        this.schedule.status = 'active';
        this.snackBar.open('Schedule resumed', '', { duration: 2000 });
      }
    }
  }

  async triggerRun(): Promise<void> {
    const res = await this.manager.triggerRun(this.scheduleId);
    if (res.success) {
      this.snackBar.open('Report triggered', '', { duration: 2000 });
      setTimeout(() => this.load(), 3000);
    }
  }

  async deleteSchedule(): Promise<void> {
    if (!confirm(`Delete "${this.schedule?.name}"? This cannot be undone.`)) return;
    const res = await this.manager.delete(this.scheduleId);
    if (res.success) {
      this.snackBar.open('Deleted', '', { duration: 2000 });
      this.router.navigate(['/report-schedules']);
    }
  }

  goBack(): void {
    this.router.navigate(['/report-schedules']);
  }

  formatDate(iso: string): string {
    if (!iso) return '--';
    return new Date(iso).toLocaleString();
  }

  formatDuration(ms: number): string {
    if (!ms) return '--';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  getRunStatusIcon(status: string): string {
    switch (status) {
      case 'success': return 'check_circle';
      case 'failed': return 'error';
      case 'running': return 'hourglass_top';
      default: return 'help';
    }
  }

  getRunStatusColor(status: string): string {
    switch (status) {
      case 'success': return '#4caf50';
      case 'failed': return '#f44336';
      case 'running': return '#2196f3';
      default: return '#9e9e9e';
    }
  }
}
