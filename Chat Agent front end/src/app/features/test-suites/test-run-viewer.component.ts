import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { ITestRun, ITestResult, IImprovement } from '../../../lib/models/test-suite.model';
import { TestResultDetailDialogComponent } from './test-result-detail-dialog.component';
import { TestImprovementsDialogComponent } from './test-improvements-dialog.component';

@Component({
  selector: 'bcc-test-run-viewer',
  templateUrl: './test-run-viewer.component.html',
  styleUrls: ['./test-run-viewer.component.scss'],
})
export class TestRunViewerComponent implements OnInit, OnDestroy {
  runId = '';
  run: ITestRun | null = null;
  results: ITestResult[] = [];
  filteredResults: ITestResult[] = [];
  loading = false;
  analyzing = false;
  statusFilter = '';
  private pollTimer: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tsManager: TestSuiteManager,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.runId = this.route.snapshot.paramMap.get('runId') ?? '';
    if (!this.runId) return;
    await this.load();

    // Start polling if still running
    if (this.run?.status === 'running' || this.run?.status === 'queued') {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async load(): Promise<void> {
    this.loading = true;
    const [runRes, resultsRes] = await Promise.all([
      this.tsManager.getRun(this.runId),
      this.tsManager.getRunResults(this.runId),
    ]);
    this.run = runRes.data ?? null;
    this.results = (resultsRes.data ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.applyFilter();
    this.loading = false;
  }

  startPolling(): void {
    this.pollTimer = setInterval(async () => {
      const runRes = await this.tsManager.getRun(this.runId);
      if (runRes.success && runRes.data) {
        this.run = runRes.data;
        // Reload results periodically
        const resultsRes = await this.tsManager.getRunResults(this.runId);
        this.results = (resultsRes.data ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        this.applyFilter();

        if (['completed', 'failed', 'cancelled'].includes(runRes.data.status)) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      }
    }, 5000);
  }

  applyFilter(): void {
    this.filteredResults = this.statusFilter
      ? this.results.filter(r => r.status === this.statusFilter)
      : [...this.results];
  }

  openResult(result: ITestResult): void {
    const ref = this.dialog.open(TestResultDetailDialogComponent, {
      width: '900px',
      maxHeight: '90vh',
      data: { result, runId: this.runId },
    });

    ref.afterClosed().subscribe(updated => {
      if (updated) {
        const idx = this.results.findIndex(r => r.id === updated.id);
        if (idx >= 0) this.results[idx] = updated;
        this.applyFilter();
      }
    });
  }

  async analyzeAndImprove(): Promise<void> {
    this.analyzing = true;
    const res = await this.tsManager.analyzeRun(this.runId);
    this.analyzing = false;

    if (res.success && res.data) {
      // Refresh run to get improvements
      const runRes = await this.tsManager.getRun(this.runId);
      if (runRes.data) this.run = runRes.data;

      this.dialog.open(TestImprovementsDialogComponent, {
        width: '800px',
        maxHeight: '90vh',
        data: { improvements: res.data, runId: this.runId },
      });
    } else {
      this.snackBar.open('Analysis failed', 'Dismiss', { duration: 5000 });
    }
  }

  getProgressPercent(): number {
    if (!this.run) return 0;
    return this.run.totalCases > 0
      ? Math.round((this.run.completedCases / this.run.totalCases) * 100)
      : 0;
  }

  scoreColor(score: number): string {
    if (score >= 80) return '#2e7d32';
    if (score >= 60) return '#e65100';
    return '#c62828';
  }

  statusIcon(status: string): string {
    switch (status) {
      case 'passed': return 'check_circle';
      case 'failed': return 'cancel';
      case 'error': return 'error';
      default: return 'help';
    }
  }

  statusClass(status: string): string {
    return `status-${status}`;
  }

  goBack(): void {
    this.router.navigate(['/test-suites']);
  }

  get reviewedCount(): number {
    return this.results.filter(r => r.userReview).length;
  }

  get isRunning(): boolean {
    return this.run?.status === 'running' || this.run?.status === 'queued';
  }
}
