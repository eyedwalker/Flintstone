import { Injectable } from '@angular/core';
import {
  ITrainingDataset,
  IFineTuningJob,
  IRaftIteration,
  IModelComparison,
  ITrainerAnnotation,
} from '../models/test-suite.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';

@Injectable({ providedIn: 'root' })
export class RaftManager {
  constructor(private api: ApiService) {}

  // ── Annotations ───────────────────────────────────────────────────────────

  async saveAnnotation(runId: string, resultId: string, annotation: ITrainerAnnotation): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/test-runs/${runId}/results/${resultId}/annotation`, annotation);
  }

  async bulkApprove(runId: string, threshold: number = 80): Promise<IAccessorResult<{ approved: number; total: number }>> {
    return this.api.post<{ approved: number; total: number }>(`/test-runs/${runId}/bulk-approve`, { threshold });
  }

  // ── Datasets ──────────────────────────────────────────────────────────────

  async generateDataset(data: {
    name: string;
    assistantId: string;
    sourceRunIds: string[];
    format?: string;
    splitConfig?: { trainPct: number; validationPct: number };
  }): Promise<IAccessorResult<ITrainingDataset>> {
    return this.api.post<ITrainingDataset>('/raft/datasets', data);
  }

  async listDatasets(assistantId: string): Promise<IAccessorResult<ITrainingDataset[]>> {
    return this.api.get<ITrainingDataset[]>('/raft/datasets', { assistantId });
  }

  async previewDataset(assistantId: string, runIds: string[]): Promise<IAccessorResult<{
    totalApproved: number;
    sampleExamples: unknown[];
    estimatedTokens: number;
  }>> {
    return this.api.get<any>('/raft/datasets/preview/info', { assistantId, runIds: runIds.join(',') });
  }

  async deleteDataset(datasetId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/raft/datasets/${datasetId}`);
  }

  // ── Fine-Tuning Jobs ──────────────────────────────────────────────────────

  async startFineTuning(data: {
    assistantId: string;
    datasetId: string;
    baseModelId: string;
    hyperparameters: any;
    iteration?: number;
  }): Promise<IAccessorResult<IFineTuningJob>> {
    return this.api.post<IFineTuningJob>('/raft/jobs', data);
  }

  async listJobs(assistantId: string): Promise<IAccessorResult<IFineTuningJob[]>> {
    return this.api.get<IFineTuningJob[]>('/raft/jobs', { assistantId });
  }

  async getJobStatus(jobId: string): Promise<IAccessorResult<IFineTuningJob>> {
    return this.api.get<IFineTuningJob>(`/raft/jobs/${jobId}`);
  }

  async cancelJob(jobId: string): Promise<IAccessorResult<void>> {
    return this.api.post<void>(`/raft/jobs/${jobId}/cancel`);
  }

  async deployModel(jobId: string, modelUnits?: number): Promise<IAccessorResult<{ provisionedModelArn: string }>> {
    return this.api.post<{ provisionedModelArn: string }>(`/raft/jobs/${jobId}/deploy`, { modelUnits });
  }

  async getFineTunableModels(): Promise<IAccessorResult<Array<{
    modelId: string;
    modelName: string;
    loraSupport: boolean;
    estimatedCostPerHour: string;
  }>>> {
    return this.api.get<any>('/raft/models');
  }

  // ── Iterations ────────────────────────────────────────────────────────────

  async startIteration(data: {
    assistantId: string;
    testRunId: string;
    track?: string;
    reformulationPct?: number;
  }): Promise<IAccessorResult<IRaftIteration>> {
    return this.api.post<IRaftIteration>('/raft/iterations', data);
  }

  async listIterations(assistantId: string): Promise<IAccessorResult<IRaftIteration[]>> {
    return this.api.get<IRaftIteration[]>('/raft/iterations', { assistantId });
  }

  async getIteration(id: string): Promise<IAccessorResult<IRaftIteration>> {
    return this.api.get<IRaftIteration>(`/raft/iterations/${id}`);
  }

  async advanceIteration(id: string, updates?: Partial<IRaftIteration>): Promise<IAccessorResult<IRaftIteration>> {
    return this.api.post<IRaftIteration>(`/raft/iterations/${id}/advance`, updates ?? {});
  }

  // ── Reformulation ─────────────────────────────────────────────────────────

  async reformulatePrompts(data: {
    suiteId: string;
    previousRunId: string;
    reformulationPct?: number;
  }): Promise<IAccessorResult<{ reformulated: number; newCases: number; total: number }>> {
    return this.api.post<any>('/raft/reformulate', data);
  }

  // ── Comparisons ───────────────────────────────────────────────────────────

  async compareRuns(baseRunId: string, challengerRunId: string): Promise<IAccessorResult<IModelComparison>> {
    return this.api.post<IModelComparison>('/raft/comparisons', { baseRunId, challengerRunId });
  }

  async getComparison(id: string): Promise<IAccessorResult<IModelComparison>> {
    return this.api.get<IModelComparison>(`/raft/comparisons/${id}`);
  }
}
