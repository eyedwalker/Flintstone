import { Injectable } from '@angular/core';
import { ApiService } from '../../app/core/services/api.service';
import { IAccessorResult } from '../models/tenant.model';

export interface IReportSchedule {
  id: string;
  tenantId: string;
  createdBy: string;
  name: string;
  description?: string;
  reportType: 'single' | 'multi' | 'chart';
  reportConfig: {
    sql?: string;
    queries?: Array<{ name: string; sql: string; chart_type?: string }>;
    title: string;
    format: 'excel' | 'csv';
    chartType?: string;
    chartXColumn?: string;
    chartYColumn?: string;
    containsPhi: boolean;
  };
  scheduleExpression: string;
  timezone: string;
  status: 'active' | 'paused' | 'disabled' | 'error';
  delivery: {
    email?: { recipients: string[]; subject?: string };
    sms?: { recipients: string[] };
  };
  eventBridgeScheduleName?: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failed' | 'running';
  lastRunError?: string;
  consecutiveFailures: number;
  totalRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface IReportRun {
  id: string;
  scheduleId: string;
  tenantId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt?: string;
  reportUrl?: string;
  deliveryResults?: {
    email?: Array<{ to: string; success: boolean; messageId?: string; error?: string }>;
    sms?: Array<{ to: string; success: boolean; messageId?: string; error?: string }>;
  };
  error?: string;
  durationMs?: number;
}

@Injectable({ providedIn: 'root' })
export class ReportScheduleManager {
  constructor(private api: ApiService) {}

  async list(): Promise<IAccessorResult<IReportSchedule[]>> {
    return this.api.get<IReportSchedule[]>('/report-schedules');
  }

  async get(id: string): Promise<IAccessorResult<IReportSchedule>> {
    return this.api.get<IReportSchedule>(`/report-schedules/${id}`);
  }

  async create(data: Partial<IReportSchedule>): Promise<IAccessorResult<IReportSchedule>> {
    return this.api.post<IReportSchedule>('/report-schedules', data);
  }

  async update(id: string, data: Partial<IReportSchedule>): Promise<IAccessorResult<IReportSchedule>> {
    return this.api.put<IReportSchedule>(`/report-schedules/${id}`, data);
  }

  async delete(id: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/report-schedules/${id}`);
  }

  async pause(id: string): Promise<IAccessorResult<{ status: string }>> {
    return this.api.post<{ status: string }>(`/report-schedules/${id}/pause`);
  }

  async resume(id: string): Promise<IAccessorResult<{ status: string }>> {
    return this.api.post<{ status: string }>(`/report-schedules/${id}/resume`);
  }

  async triggerRun(id: string): Promise<IAccessorResult<{ runId: string; status: string }>> {
    return this.api.post<{ runId: string; status: string }>(`/report-schedules/${id}/run`);
  }

  async listRuns(id: string): Promise<IAccessorResult<IReportRun[]>> {
    return this.api.get<IReportRun[]>(`/report-schedules/${id}/runs`);
  }
}
