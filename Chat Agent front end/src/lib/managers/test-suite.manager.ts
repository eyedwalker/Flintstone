import { Injectable } from '@angular/core';
import {
  ITestSuite,
  ITestCase,
  ITestRun,
  ITestResult,
  IImprovement,
  IGenerateOptions,
  IUserReview,
  ITrainerAnnotation,
  IExternalBotConfig,
  IExternalBotQuickResult,
} from '../models/test-suite.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';

@Injectable({ providedIn: 'root' })
export class TestSuiteManager {
  constructor(private api: ApiService) {}

  // ── Suites ──────────────────────────────────────────────────────────────────

  async listSuites(assistantId: string): Promise<IAccessorResult<ITestSuite[]>> {
    return this.api.get<ITestSuite[]>('/test-suites', { assistantId });
  }

  async createSuite(data: Partial<ITestSuite>): Promise<IAccessorResult<ITestSuite>> {
    return this.api.post<ITestSuite>('/test-suites', data);
  }

  async getSuite(id: string): Promise<IAccessorResult<ITestSuite>> {
    return this.api.get<ITestSuite>(`/test-suites/${id}`);
  }

  async updateSuite(id: string, data: Partial<ITestSuite>): Promise<IAccessorResult<ITestSuite>> {
    return this.api.put<ITestSuite>(`/test-suites/${id}`, data);
  }

  async deleteSuite(id: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/test-suites/${id}`);
  }

  // ── Cases ───────────────────────────────────────────────────────────────────

  async listCases(suiteId: string): Promise<IAccessorResult<ITestCase[]>> {
    return this.api.get<ITestCase[]>(`/test-suites/${suiteId}/cases`);
  }

  async createCase(suiteId: string, data: Partial<ITestCase>): Promise<IAccessorResult<ITestCase>> {
    return this.api.post<ITestCase>(`/test-suites/${suiteId}/cases`, data);
  }

  async updateCase(suiteId: string, caseId: string, data: Partial<ITestCase>): Promise<IAccessorResult<ITestCase>> {
    return this.api.put<ITestCase>(`/test-suites/${suiteId}/cases/${caseId}`, data);
  }

  async deleteCase(suiteId: string, caseId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/test-suites/${suiteId}/cases/${caseId}`);
  }

  async generateCases(suiteId: string, options?: IGenerateOptions): Promise<IAccessorResult<{ count: number }>> {
    return this.api.post<{ count: number }>(`/test-suites/${suiteId}/generate`, options ?? {});
  }

  async importCases(suiteId: string, cases: Partial<ITestCase>[]): Promise<IAccessorResult<{ imported: number }>> {
    return this.api.post<{ imported: number }>(`/test-suites/${suiteId}/import`, { cases });
  }

  // ── Runs ────────────────────────────────────────────────────────────────────

  async startRun(suiteId: string): Promise<IAccessorResult<{ runId: string }>> {
    return this.api.post<{ runId: string }>(`/test-suites/${suiteId}/run`);
  }

  async getLatestRun(suiteId: string): Promise<IAccessorResult<ITestRun>> {
    return this.api.get<ITestRun>(`/test-suites/${suiteId}/latest-run`);
  }

  async getRun(runId: string): Promise<IAccessorResult<ITestRun>> {
    return this.api.get<ITestRun>(`/test-runs/${runId}`);
  }

  async listRuns(suiteId: string): Promise<IAccessorResult<ITestRun[]>> {
    return this.api.get<ITestRun[]>(`/test-suites/${suiteId}/runs`);
  }

  async getRunResults(runId: string): Promise<IAccessorResult<ITestResult[]>> {
    return this.api.get<ITestResult[]>(`/test-runs/${runId}/results`);
  }

  async submitReview(runId: string, resultId: string, review: IUserReview): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/test-runs/${runId}/results/${resultId}/review`, review);
  }

  async cancelRun(runId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/test-runs/${runId}`);
  }

  // ── Improvements ────────────────────────────────────────────────────────────

  async analyzeRun(runId: string): Promise<IAccessorResult<IImprovement[]>> {
    return this.api.post<IImprovement[]>(`/test-runs/${runId}/analyze`);
  }

  async applyImprovement(runId: string, improvementId: string): Promise<IAccessorResult<void>> {
    return this.api.post<void>(`/test-runs/${runId}/improvements/${improvementId}/apply`);
  }

  // ── RAFT Training Annotations ───────────────────────────────────────────────

  async saveAnnotation(runId: string, resultId: string, annotation: ITrainerAnnotation): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/test-runs/${runId}/results/${resultId}/annotation`, annotation);
  }

  async bulkApprove(runId: string, threshold: number = 80): Promise<IAccessorResult<{ approved: number; total: number }>> {
    return this.api.post<{ approved: number; total: number }>(`/test-runs/${runId}/bulk-approve`, { threshold });
  }

  // ── External Bot Testing ────────────────────────────────────────────────────

  async getExternalBotConfig(): Promise<IAccessorResult<IExternalBotConfig>> {
    return this.api.get<IExternalBotConfig>('/external-bot/config');
  }

  async saveExternalBotConfig(config: IExternalBotConfig): Promise<IAccessorResult<void>> {
    return this.api.put<void>('/external-bot/config', config);
  }

  async quickTestExternalBot(questions: string[], config?: Partial<IExternalBotConfig>): Promise<IAccessorResult<{
    jobId: string;
    status: string;
    totalQuestions: number;
  }>> {
    return this.api.post('/external-bot/test', { questions, ...config });
  }

  async pollQuickTest(jobId: string): Promise<IAccessorResult<Record<string, unknown>>> {
    return this.api.get<Record<string, unknown>>(`/external-bot/test/${jobId}`);
  }

  async startExternalBotRun(suiteId: string): Promise<IAccessorResult<{ runId: string; totalCases: number; externalBot: string }>> {
    return this.api.post(`/external-bot/run/${suiteId}`);
  }
}
