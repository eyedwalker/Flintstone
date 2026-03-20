import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { ITestSuite, ITestRun } from '../../../lib/models/test-suite.model';
import { IAssistant } from '../../../lib/models/tenant.model';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'bcc-test-suite-list',
  templateUrl: './test-suite-list.component.html',
  styleUrls: ['./test-suite-list.component.scss'],
})
export class TestSuiteListComponent implements OnInit, OnDestroy {
  assistants: IAssistant[] = [];
  selectedAssistantId = '';
  suites: ITestSuite[] = [];
  loading = false;

  // Active run tracking
  activeRun: ITestRun | null = null;
  activeRunSuiteId = '';
  private pollTimer: any;

  // Run history
  expandedSuiteId = '';
  suiteRuns: ITestRun[] = [];
  loadingHistory = false;

  constructor(
    private tsManager: TestSuiteManager,
    private assistantManager: AssistantManager,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.assistantManager.listAssistants();
    this.assistants = (res.data ?? []).filter(a => a.status === 'ready');
    if (this.assistants.length) {
      this.selectedAssistantId = this.assistants[0].id;
      await this.loadSuites();
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async onAssistantChange(): Promise<void> {
    await this.loadSuites();
  }

  async loadSuites(): Promise<void> {
    if (!this.selectedAssistantId) return;
    this.loading = true;
    const res = await this.tsManager.listSuites(this.selectedAssistantId);
    this.suites = (res.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.loading = false;
  }

  async createSuite(): Promise<void> {
    const name = prompt('Enter test suite name:', 'New Test Suite');
    if (!name) return;

    const res = await this.tsManager.createSuite({
      assistantId: this.selectedAssistantId,
      name,
      description: '',
    });
    if (res.success && res.data) {
      this.suites.unshift(res.data);
      this.snackBar.open('Suite created', '', { duration: 2000 });
    }
  }

  openSuite(suite: ITestSuite): void {
    this.router.navigate(['/test-suites', suite.id, 'cases']);
  }

  async startRun(suite: ITestSuite, event: Event): Promise<void> {
    event.stopPropagation();

    if (suite.testCaseCount === 0) {
      this.snackBar.open('Add test cases before running', '', { duration: 3000 });
      return;
    }

    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Start Test Run',
        message: `Run ${suite.testCaseCount} test cases for "${suite.name}"? This may take several minutes.`,
        confirmText: 'Start Run',
        confirmColor: 'primary',
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    const res = await this.tsManager.startRun(suite.id);
    if (res.success && res.data) {
      this.activeRunSuiteId = suite.id;
      this.snackBar.open('Test run started', '', { duration: 2000 });
      this.startPolling(res.data.runId);
    } else {
      this.snackBar.open(`Failed: ${res.error}`, 'Dismiss', { duration: 5000 });
    }
  }

  startPolling(runId: string): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      const res = await this.tsManager.getRun(runId);
      if (res.success && res.data) {
        this.activeRun = res.data;
        if (res.data.status === 'completed' || res.data.status === 'failed' || res.data.status === 'cancelled') {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
          this.snackBar.open(`Test run ${res.data.status}: ${res.data.passedCases} passed, ${res.data.failedCases} failed`, '', { duration: 5000 });
          await this.loadSuites();
        }
      }
    }, 3000);
  }

  async viewResults(suite: ITestSuite, event: Event): Promise<void> {
    event.stopPropagation();
    let runId = (this.activeRun && this.activeRunSuiteId === suite.id)
      ? this.activeRun.id
      : suite.lastRunId;

    if (!runId) {
      // Fallback: query latest run for this suite
      const res = await this.tsManager.getLatestRun(suite.id);
      if (res.success && res.data) runId = res.data.id;
    }

    if (runId) {
      this.router.navigate(['/test-suites', 'runs', runId]);
    } else {
      this.snackBar.open('No completed runs found', '', { duration: 3000 });
    }
  }

  async deleteSuite(suite: ITestSuite, event: Event): Promise<void> {
    event.stopPropagation();
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Test Suite',
        message: `Delete "${suite.name}" and all its test cases?`,
        confirmText: 'Delete',
        confirmColor: 'warn',
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    const res = await this.tsManager.deleteSuite(suite.id);
    if (res.success) {
      this.suites = this.suites.filter(s => s.id !== suite.id);
      this.snackBar.open('Suite deleted', '', { duration: 2000 });
    }
  }

  getProgressPercent(): number {
    if (!this.activeRun) return 0;
    return this.activeRun.totalCases > 0
      ? Math.round((this.activeRun.completedCases / this.activeRun.totalCases) * 100)
      : 0;
  }

  getScoreColor(score: number | undefined): string {
    if (!score) return '';
    if (score >= 80) return 'score-high';
    if (score >= 60) return 'score-medium';
    return 'score-low';
  }

  async toggleRunHistory(suite: ITestSuite, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.expandedSuiteId === suite.id) {
      this.expandedSuiteId = '';
      return;
    }
    this.expandedSuiteId = suite.id;
    this.loadingHistory = true;
    const res = await this.tsManager.listRuns(suite.id);
    this.suiteRuns = res.data ?? [];
    this.loadingHistory = false;
  }

  viewRunResults(runId: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/test-suites', 'runs', runId]);
  }
}
