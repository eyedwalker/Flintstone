import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RaftManager } from '../../../lib/managers/raft.manager';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { IAssistant } from '../../../lib/models/tenant.model';
import {
  IRaftIteration,
  ITrainingDataset,
  IFineTuningJob,
  ITestSuite,
  ITestRun,
} from '../../../lib/models/test-suite.model';

@Component({
  selector: 'bcc-raft-dashboard',
  template: `
    <div class="raft-page">
      <div class="page-header">
        <div>
          <h1>RAFT Training Pipeline</h1>
          <p class="subtitle">Retrieval-Augmented Fine-Tuning — improve agent quality through systematic test-correct-train cycles</p>
        </div>
        <button mat-flat-button color="primary" (click)="startNewCycle()"
                [disabled]="!selectedAssistantId || loading">
          <mat-icon>play_arrow</mat-icon> Start New Cycle
        </button>
      </div>

      <!-- Assistant Selector -->
      <mat-form-field appearance="outline" class="assistant-selector">
        <mat-label>Assistant</mat-label>
        <mat-select [(value)]="selectedAssistantId" (selectionChange)="onAssistantChange()">
          <mat-option *ngFor="let a of assistants" [value]="a.id">{{ a.name }}</mat-option>
        </mat-select>
      </mat-form-field>

      <div class="dashboard-grid" *ngIf="selectedAssistantId">

        <!-- Score Progression -->
        <mat-card class="score-card">
          <mat-card-header>
            <mat-card-title>Score Progression</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="score-chart" *ngIf="iterations.length > 0">
              <div class="chart-bars">
                <div class="chart-bar-group" *ngFor="let iter of iterations">
                  <div class="chart-bar baseline" [style.height.%]="iter.baselineScore">
                    <span class="bar-label">{{ iter.baselineScore | number:'1.0-0' }}</span>
                  </div>
                  <div class="chart-bar improved" *ngIf="iter.improvedScore"
                       [style.height.%]="iter.improvedScore">
                    <span class="bar-label">{{ iter.improvedScore | number:'1.0-0' }}</span>
                  </div>
                  <div class="chart-x-label">#{{ iter.iterationNumber }}</div>
                </div>
              </div>
            </div>
            <div class="empty-state" *ngIf="iterations.length === 0">
              <mat-icon>trending_up</mat-icon>
              <p>No iterations yet. Start a RAFT cycle to begin tracking improvement.</p>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Current/Latest Iteration -->
        <mat-card class="iteration-card">
          <mat-card-header>
            <mat-card-title>{{ currentIteration ? 'Current Iteration #' + currentIteration.iterationNumber : 'Latest Iteration' }}</mat-card-title>
          </mat-card-header>
          <mat-card-content *ngIf="currentIteration">
            <div class="status-stepper">
              <div class="step" *ngFor="let step of raftSteps"
                   [class.active]="step === currentIteration.status"
                   [class.completed]="isStepCompleted(step)">
                <mat-icon>{{ getStepIcon(step) }}</mat-icon>
                <span>{{ step | titlecase }}</span>
              </div>
            </div>

            <div class="iteration-stats">
              <div class="stat">
                <span class="stat-value">{{ currentIteration.baselineScore | number:'1.0-0' }}</span>
                <span class="stat-label">Baseline</span>
              </div>
              <div class="stat" *ngIf="currentIteration.improvedScore">
                <span class="stat-value improved">{{ currentIteration.improvedScore | number:'1.0-0' }}</span>
                <span class="stat-label">Improved</span>
              </div>
              <div class="stat" *ngIf="currentIteration.improvedScore">
                <span class="stat-value" [class.positive]="(currentIteration.improvedScore - currentIteration.baselineScore) > 0">
                  {{ currentIteration.improvedScore - currentIteration.baselineScore > 0 ? '+' : '' }}{{ currentIteration.improvedScore - currentIteration.baselineScore | number:'1.1-1' }}
                </span>
                <span class="stat-label">Delta</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ (currentIteration.reformulatedPromptPct * 100) | number:'1.0-0' }}%</span>
                <span class="stat-label">Reformulated</span>
              </div>
            </div>

            <!-- Phase-specific guidance -->
            <div class="phase-guidance" *ngIf="currentIteration.status !== 'completed'">
              <mat-icon class="guide-icon">info</mat-icon>
              <span>{{ getPhaseGuidance(currentIteration.status) }}</span>
            </div>

            <div class="iteration-actions">
              <button mat-stroked-button (click)="advanceIteration()"
                      *ngIf="currentIteration.status !== 'completed'"
                      [disabled]="advancing">
                <mat-spinner *ngIf="advancing" diameter="18"></mat-spinner>
                <mat-icon *ngIf="!advancing">skip_next</mat-icon>
                Advance to {{ getNextPhase(currentIteration.status) | titlecase }}
              </button>
              <button mat-stroked-button color="accent" (click)="bulkApproveResults()"
                      *ngIf="currentIteration.status === 'reviewing'">
                <mat-icon>done_all</mat-icon> Bulk Approve (Score >= 80)
              </button>
              <button mat-stroked-button color="primary" (click)="generateDataset()"
                      *ngIf="currentIteration.status === 'training' && datasets.length === 0">
                <mat-icon>dataset</mat-icon> Generate Dataset
              </button>
            </div>

            <div class="prereq-error" *ngIf="prereqError">
              <mat-icon>warning</mat-icon>
              <span>{{ prereqError }}</span>
            </div>
          </mat-card-content>
          <mat-card-content *ngIf="!currentIteration">
            <div class="empty-state">
              <mat-icon>loop</mat-icon>
              <p>No active iteration. Click "Start New Cycle" to begin.</p>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Datasets -->
        <mat-card class="datasets-card">
          <mat-card-header>
            <mat-card-title>Training Datasets</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="dataset-list" *ngIf="datasets.length > 0">
              <div class="dataset-item" *ngFor="let ds of datasets">
                <div class="dataset-info">
                  <strong>{{ ds.name }}</strong>
                  <span class="dataset-meta">{{ ds.totalExamples }} examples &middot; {{ ds.format }} &middot; {{ ds.createdAt | date:'short' }}</span>
                </div>
                <div class="dataset-actions">
                  <button mat-icon-button color="warn" (click)="deleteDataset(ds.id)" matTooltip="Delete">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>
            </div>
            <div class="empty-state small" *ngIf="datasets.length === 0">
              <p>No datasets yet. Approve test results and generate a dataset.</p>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Fine-Tuning Jobs -->
        <mat-card class="jobs-card">
          <mat-card-header>
            <mat-card-title>Fine-Tuning Jobs</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="job-list" *ngIf="jobs.length > 0">
              <div class="job-item" *ngFor="let job of jobs">
                <div class="job-info">
                  <strong>{{ job.customModelName }}</strong>
                  <span class="job-meta">
                    {{ job.baseModelId | slice:0:30 }} &middot;
                    Iter #{{ job.iteration }} &middot;
                    <span class="status-chip" [class]="'status-' + job.status">{{ job.status }}</span>
                  </span>
                </div>
                <div class="job-actions">
                  <button mat-stroked-button *ngIf="job.status === 'completed' && !job.provisionedModelArn"
                          (click)="deployJob(job.id)" color="primary">
                    <mat-icon>rocket_launch</mat-icon> Deploy
                  </button>
                  <button mat-icon-button *ngIf="job.status === 'training'" (click)="cancelJob(job.id)" color="warn" matTooltip="Cancel">
                    <mat-icon>stop</mat-icon>
                  </button>
                  <mat-icon *ngIf="job.provisionedModelArn" class="deployed-icon" matTooltip="Deployed">check_circle</mat-icon>
                </div>
              </div>
            </div>
            <div class="empty-state small" *ngIf="jobs.length === 0">
              <p>No fine-tuning jobs yet. Generate a dataset first, then start training.</p>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Iteration History -->
        <mat-card class="history-card">
          <mat-card-header>
            <mat-card-title>Iteration History</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table class="history-table" *ngIf="iterations.length > 0">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Baseline</th>
                  <th>Improved</th>
                  <th>Delta</th>
                  <th>Track</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let iter of iterations" (click)="selectIteration(iter)"
                    [class.active]="currentIteration?.id === iter.id">
                  <td>{{ iter.iterationNumber }}</td>
                  <td><span class="status-chip" [class]="'status-' + iter.status">{{ iter.status }}</span></td>
                  <td>{{ iter.baselineScore | number:'1.0-0' }}</td>
                  <td>{{ iter.improvedScore ? (iter.improvedScore | number:'1.0-0') : '—' }}</td>
                  <td [class.positive]="(iter.improvedScore ?? 0) > iter.baselineScore">
                    {{ iter.improvedScore ? ((iter.improvedScore - iter.baselineScore > 0 ? '+' : '') + (iter.improvedScore - iter.baselineScore | number:'1.1-1')) : '—' }}
                  </td>
                  <td>{{ iter.track ?? 'hybrid' }}</td>
                  <td>{{ iter.createdAt | date:'short' }}</td>
                </tr>
              </tbody>
            </table>
          </mat-card-content>
        </mat-card>

      </div>
    </div>
  `,
  styles: [`
    .raft-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;
      h1 { margin: 0; font-size: 1.5rem; }
      .subtitle { margin: 4px 0 0; color: rgba(0,0,0,0.5); font-size: 0.85rem; }
    }
    .assistant-selector { width: 300px; margin-bottom: 16px; }

    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .score-card, .history-card { grid-column: 1 / -1; }

    mat-card { border-radius: 12px; }
    mat-card-header { margin-bottom: 12px; }

    .empty-state {
      text-align: center; padding: 32px; color: rgba(0,0,0,0.4);
      mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 8px; }
      p { margin: 0; }
      &.small { padding: 16px; mat-icon { font-size: 24px; width: 24px; height: 24px; } }
    }

    /* Score Chart */
    .score-chart { height: 180px; display: flex; align-items: flex-end; }
    .chart-bars { display: flex; align-items: flex-end; gap: 24px; width: 100%; height: 100%; padding: 0 16px; }
    .chart-bar-group { display: flex; gap: 4px; align-items: flex-end; flex: 1; max-width: 80px; position: relative; }
    .chart-bar {
      flex: 1; border-radius: 4px 4px 0 0; min-height: 4px; position: relative; transition: height 0.3s;
      &.baseline { background: #90caf9; }
      &.improved { background: #2e7d32; }
    }
    .bar-label { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 0.7rem; font-weight: 600; }
    .chart-x-label { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-size: 0.7rem; color: rgba(0,0,0,0.5); }

    /* Status Stepper */
    .status-stepper {
      display: flex; gap: 4px; margin-bottom: 16px;
      .step {
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 8px 4px; border-radius: 8px; font-size: 0.7rem; color: rgba(0,0,0,0.3);
        mat-icon { font-size: 20px; width: 20px; height: 20px; }
        &.active { background: #e3f2fd; color: #1565c0; font-weight: 600; }
        &.completed { color: #2e7d32; }
      }
    }

    /* Iteration Stats */
    .iteration-stats {
      display: flex; gap: 24px; margin-bottom: 16px;
      .stat { text-align: center; }
      .stat-value { display: block; font-size: 1.5rem; font-weight: 700; }
      .stat-label { font-size: 0.75rem; color: rgba(0,0,0,0.5); }
      .improved { color: #2e7d32; }
      .positive { color: #2e7d32; }
    }
    .iteration-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    .phase-guidance {
      display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px;
      background: #fff8e1; border-radius: 8px; margin-bottom: 12px; font-size: 0.83rem; color: #5d4037;
      .guide-icon { color: #f9a825; font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    }

    .prereq-error {
      display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px;
      background: #fce4ec; border-radius: 8px; margin-top: 12px; font-size: 0.83rem; color: #c62828;
      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    }

    /* Dataset & Job Lists */
    .dataset-list, .job-list { display: flex; flex-direction: column; gap: 8px; }
    .dataset-item, .job-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
    }
    .dataset-info, .job-info { display: flex; flex-direction: column; gap: 2px; }
    .dataset-meta, .job-meta { font-size: 0.75rem; color: rgba(0,0,0,0.5); }
    .dataset-actions, .job-actions { display: flex; align-items: center; gap: 4px; }
    .deployed-icon { color: #2e7d32; }

    /* Status Chips */
    .status-chip {
      display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 600;
      &.status-testing, &.status-training, &.status-validating { background: #fff3e0; color: #e65100; }
      &.status-reviewing, &.status-deploying, &.status-retesting { background: #e3f2fd; color: #1565c0; }
      &.status-completed { background: #e8f5e9; color: #2e7d32; }
      &.status-failed, &.status-cancelled { background: #fce4ec; color: #c62828; }
      &.status-pending { background: #f5f5f5; color: rgba(0,0,0,0.5); }
    }

    /* History Table */
    .history-table {
      width: 100%; border-collapse: collapse;
      th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.06); }
      th { font-size: 0.75rem; font-weight: 600; color: rgba(0,0,0,0.5); text-transform: uppercase; }
      td { font-size: 0.85rem; }
      tbody tr { cursor: pointer; &:hover { background: rgba(0,0,0,0.02); } &.active { background: #e3f2fd; } }
      .positive { color: #2e7d32; font-weight: 600; }
    }
  `],
})
export class RaftDashboardComponent implements OnInit, OnDestroy {
  assistants: IAssistant[] = [];
  selectedAssistantId = '';
  iterations: IRaftIteration[] = [];
  currentIteration: IRaftIteration | null = null;
  datasets: ITrainingDataset[] = [];
  jobs: IFineTuningJob[] = [];
  loading = false;
  advancing = false;
  prereqError = '';

  readonly raftSteps = ['testing', 'reviewing', 'training', 'deploying', 'retesting', 'completed'];
  private pollTimer: any;

  constructor(
    private raftManager: RaftManager,
    private assistantManager: AssistantManager,
    private tsManager: TestSuiteManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.assistantManager.listAssistants();
    this.assistants = (res.data ?? []).filter(a => a.status === 'ready');
    if (this.assistants.length) {
      this.selectedAssistantId = this.assistants[0].id;
      await this.loadAll();
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async onAssistantChange(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    if (!this.selectedAssistantId) return;
    this.loading = true;

    const [iterRes, dsRes, jobRes] = await Promise.all([
      this.raftManager.listIterations(this.selectedAssistantId),
      this.raftManager.listDatasets(this.selectedAssistantId),
      this.raftManager.listJobs(this.selectedAssistantId),
    ]);

    this.iterations = (iterRes.data ?? []).sort((a, b) => a.iterationNumber - b.iterationNumber);
    this.datasets = (dsRes.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.jobs = (jobRes.data ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Set current iteration to the latest non-completed one, or the last one
    this.currentIteration = this.iterations.find(i => i.status !== 'completed') ?? this.iterations[this.iterations.length - 1] ?? null;

    this.loading = false;

    // Poll for active jobs
    this.startPolling();
  }

  async startNewCycle(): Promise<void> {
    // For now, prompt user to select a test run
    // In a full implementation this would open a dialog
    const suiteRes = await this.tsManager.listSuites(this.selectedAssistantId);
    const suites = suiteRes.data ?? [];
    if (suites.length === 0) {
      this.snackBar.open('No test suites found. Create a test suite first.', 'OK', { duration: 5000 });
      return;
    }

    const suite = suites[0];
    if (!suite.lastRunId) {
      this.snackBar.open('No test runs found. Run a test suite first.', 'OK', { duration: 5000 });
      return;
    }

    const res = await this.raftManager.startIteration({
      assistantId: this.selectedAssistantId,
      testRunId: suite.lastRunId,
      track: 'hybrid',
      reformulationPct: 0.3,
    });

    if (res.success) {
      this.snackBar.open('RAFT cycle started!', '', { duration: 2000 });
      await this.loadAll();
    } else {
      this.snackBar.open('Failed to start cycle', 'Dismiss', { duration: 5000 });
    }
  }

  async advanceIteration(): Promise<void> {
    if (!this.currentIteration) return;
    this.advancing = true;
    this.prereqError = '';

    const res = await this.raftManager.advanceIteration(this.currentIteration.id);
    this.advancing = false;

    if (res.success && res.data) {
      if ((res.data as any).prerequisiteError) {
        // Shouldn't hit this with 422 handling, but just in case
        this.prereqError = (res.data as any).prerequisiteError;
        return;
      }
      this.currentIteration = res.data;
      this.snackBar.open(`Advanced to: ${res.data.status}`, '', { duration: 2000 });
      await this.loadAll();
    } else {
      // 422 comes back as error
      const errorMsg = (res as any).error?.error || (res as any).message || 'Cannot advance yet';
      this.prereqError = errorMsg;
      this.snackBar.open(errorMsg, 'OK', { duration: 8000 });
    }
  }

  async bulkApproveResults(): Promise<void> {
    if (!this.currentIteration) return;
    const res = await this.raftManager.bulkApprove(this.currentIteration.testRunId, 80);
    if (res.success && res.data) {
      this.snackBar.open(`Approved ${res.data.approved} of ${res.data.total} results`, '', { duration: 3000 });
      this.prereqError = '';
    }
  }

  async generateDataset(): Promise<void> {
    if (!this.currentIteration) return;
    const res = await this.raftManager.generateDataset({
      name: `RAFT Iteration #${this.currentIteration.iterationNumber}`,
      assistantId: this.selectedAssistantId,
      sourceRunIds: [this.currentIteration.testRunId],
    });
    if (res.success && res.data) {
      this.datasets = [res.data, ...this.datasets];
      // Link dataset to the iteration
      await this.raftManager.advanceIteration(this.currentIteration.id, { datasetId: res.data.id } as any);
      this.snackBar.open(`Dataset generated: ${res.data.totalExamples} examples`, '', { duration: 3000 });
      this.prereqError = '';
    } else {
      this.snackBar.open('Failed to generate dataset — approve some results first', 'OK', { duration: 5000 });
    }
  }

  getPhaseGuidance(status: string): string {
    switch (status) {
      case 'reviewing':
        return 'Go to Test Suites → open run results → write ideal responses → mark as Approved. Then click "Advance" when you have 5+ approved.';
      case 'training':
        return 'Generate a training dataset from approved results, then start a fine-tuning job or apply RAG improvements.';
      case 'deploying':
        return 'Deploy the fine-tuned model or verify RAG improvements are applied, then advance to retesting.';
      case 'retesting':
        return 'Run the test suite again with reformulated prompts. Update the improved score, then complete the cycle.';
      default:
        return '';
    }
  }

  getNextPhase(status: string): string {
    const transitions: Record<string, string> = {
      reviewing: 'training',
      training: 'deploying',
      deploying: 'retesting',
      retesting: 'completed',
    };
    return transitions[status] ?? status;
  }

  selectIteration(iter: IRaftIteration): void {
    this.currentIteration = iter;
  }

  async deleteDataset(id: string): Promise<void> {
    const res = await this.raftManager.deleteDataset(id);
    if (res.success) {
      this.datasets = this.datasets.filter(d => d.id !== id);
      this.snackBar.open('Dataset deleted', '', { duration: 2000 });
    }
  }

  async deployJob(jobId: string): Promise<void> {
    const res = await this.raftManager.deployModel(jobId);
    if (res.success) {
      this.snackBar.open('Model deployed!', '', { duration: 3000 });
      await this.loadAll();
    } else {
      this.snackBar.open('Deployment failed', 'Dismiss', { duration: 5000 });
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    const res = await this.raftManager.cancelJob(jobId);
    if (res.success) {
      this.snackBar.open('Job cancelled', '', { duration: 2000 });
      await this.loadAll();
    }
  }

  isStepCompleted(step: string): boolean {
    if (!this.currentIteration) return false;
    const idx = this.raftSteps.indexOf(step);
    const currentIdx = this.raftSteps.indexOf(this.currentIteration.status);
    return idx < currentIdx;
  }

  getStepIcon(step: string): string {
    if (!this.currentIteration) return 'radio_button_unchecked';
    const idx = this.raftSteps.indexOf(step);
    const currentIdx = this.raftSteps.indexOf(this.currentIteration.status);
    if (idx < currentIdx) return 'check_circle';
    if (idx === currentIdx) return 'play_circle';
    return 'radio_button_unchecked';
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const hasActiveJob = this.jobs.some(j => ['pending', 'validating', 'training'].includes(j.status));
    if (hasActiveJob) {
      this.pollTimer = setInterval(() => this.pollJobs(), 30000);
    }
  }

  private async pollJobs(): Promise<void> {
    const activeJobs = this.jobs.filter(j => ['pending', 'validating', 'training'].includes(j.status));
    for (const job of activeJobs) {
      const res = await this.raftManager.getJobStatus(job.id);
      if (res.data) {
        const idx = this.jobs.findIndex(j => j.id === job.id);
        if (idx >= 0) this.jobs[idx] = res.data;
        if (['completed', 'failed', 'cancelled'].includes(res.data.status)) {
          this.snackBar.open(`Fine-tuning job ${res.data.status}`, '', { duration: 3000 });
        }
      }
    }
  }
}
