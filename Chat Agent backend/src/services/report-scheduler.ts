/**
 * Report Scheduler Service
 *
 * Manages scheduled report definitions in DynamoDB and EventBridge Scheduler.
 * Executes reports by invoking the Snowflake Lambda and recording run history.
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
} from '@aws-sdk/client-scheduler';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as ddb from './dynamo';
import { deliverReport } from './report-delivery';

const REGION = process.env['REGION'] ?? 'us-west-2';
const SCHEDULES_TABLE = process.env['REPORT_SCHEDULES_TABLE'] ?? '';
const RUNS_TABLE = process.env['REPORT_RUNS_TABLE'] ?? '';
const SNOWFLAKE_LAMBDA = process.env['SNOWFLAKE_LAMBDA_ARN'] ?? '';
const PROVISION_LAMBDA = process.env['PROVISION_FUNCTION_NAME'] ?? '';
const SCHEDULER_ROLE = process.env['SCHEDULER_ROLE_ARN'] ?? '';

const scheduler = new SchedulerClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

// ── SQL validation (mirrors Snowflake Lambda's forbidden regex) ─────────────

const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|MERGE|GRANT|REVOKE|CALL)\b/i;

function validateSql(sql: string): void {
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('Only SELECT queries are allowed in scheduled reports');
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

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
  ttl: number;
}

// ── Schedule CRUD ───────────────────────────────────────────────────────────

export async function createSchedule(
  tenantId: string,
  createdBy: string,
  config: Omit<IReportSchedule, 'id' | 'tenantId' | 'createdBy' | 'eventBridgeScheduleName' | 'consecutiveFailures' | 'totalRuns' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunError'>
): Promise<IReportSchedule> {
  const { v4: uuidv4 } = await import('uuid');

  // Validate SQL
  if (config.reportConfig.sql) validateSql(config.reportConfig.sql);
  if (config.reportConfig.queries) {
    config.reportConfig.queries.forEach(q => validateSql(q.sql));
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const scheduleName = `report-${id}`;

  const schedule: IReportSchedule = {
    id,
    tenantId,
    createdBy,
    name: config.name,
    description: config.description,
    reportType: config.reportType,
    reportConfig: config.reportConfig,
    scheduleExpression: config.scheduleExpression,
    timezone: config.timezone || 'America/Los_Angeles',
    status: config.status || 'active',
    delivery: config.delivery,
    eventBridgeScheduleName: scheduleName,
    consecutiveFailures: 0,
    totalRuns: 0,
    createdAt: now,
    updatedAt: now,
  };

  // Create EventBridge Schedule
  if (schedule.status === 'active') {
    await createEventBridgeSchedule(scheduleName, schedule);
  }

  await ddb.putItem(SCHEDULES_TABLE, schedule as unknown as Record<string, unknown>);
  return schedule;
}

export async function updateSchedule(
  scheduleId: string,
  tenantId: string,
  updates: Partial<Pick<IReportSchedule, 'name' | 'description' | 'reportConfig' | 'scheduleExpression' | 'timezone' | 'delivery'>>
): Promise<void> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule || schedule.tenantId !== tenantId) throw new Error('Schedule not found');

  // Validate SQL if updating reportConfig
  if (updates.reportConfig?.sql) validateSql(updates.reportConfig.sql);
  if (updates.reportConfig?.queries) {
    updates.reportConfig.queries.forEach(q => validateSql(q.sql));
  }

  const merged = { ...schedule, ...updates, updatedAt: new Date().toISOString() };
  await ddb.updateItem(SCHEDULES_TABLE, { id: scheduleId }, {
    ...updates,
    updatedAt: merged.updatedAt,
  });

  // Update EventBridge Schedule if active
  if (schedule.status === 'active' && schedule.eventBridgeScheduleName) {
    await createEventBridgeSchedule(schedule.eventBridgeScheduleName, merged as IReportSchedule);
  }
}

export async function deleteSchedule(scheduleId: string, tenantId: string): Promise<void> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule || schedule.tenantId !== tenantId) throw new Error('Schedule not found');

  // Delete EventBridge Schedule
  if (schedule.eventBridgeScheduleName) {
    await scheduler.send(new DeleteScheduleCommand({
      Name: schedule.eventBridgeScheduleName,
    })).catch(() => { /* may not exist */ });
  }

  await ddb.deleteItem(SCHEDULES_TABLE, { id: scheduleId });
}

export async function pauseSchedule(scheduleId: string, tenantId: string): Promise<void> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule || schedule.tenantId !== tenantId) throw new Error('Schedule not found');

  if (schedule.eventBridgeScheduleName) {
    await scheduler.send(new DeleteScheduleCommand({
      Name: schedule.eventBridgeScheduleName,
    })).catch(() => {});
  }

  await ddb.updateItem(SCHEDULES_TABLE, { id: scheduleId }, {
    status: 'paused',
    updatedAt: new Date().toISOString(),
  });
}

export async function resumeSchedule(scheduleId: string, tenantId: string): Promise<void> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule || schedule.tenantId !== tenantId) throw new Error('Schedule not found');

  const scheduleName = schedule.eventBridgeScheduleName || `report-${scheduleId}`;
  await createEventBridgeSchedule(scheduleName, { ...schedule, status: 'active' });

  await ddb.updateItem(SCHEDULES_TABLE, { id: scheduleId }, {
    status: 'active',
    eventBridgeScheduleName: scheduleName,
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
  });
}

export async function getSchedule(scheduleId: string): Promise<IReportSchedule | null> {
  return ddb.getItem<IReportSchedule>(SCHEDULES_TABLE, { id: scheduleId });
}

export async function listSchedules(tenantId: string): Promise<IReportSchedule[]> {
  return ddb.queryItems<IReportSchedule>(
    SCHEDULES_TABLE,
    'tenantId = :t',
    { ':t': tenantId },
    undefined,
    'tenantId-index'
  );
}

export async function listRuns(scheduleId: string, limit = 20): Promise<IReportRun[]> {
  return ddb.queryItems<IReportRun>(
    RUNS_TABLE,
    'scheduleId = :s',
    { ':s': scheduleId },
    undefined,
    'scheduleId-index'
  );
}

// ── Trigger immediate run ───────────────────────────────────────────────────

export async function triggerRun(scheduleId: string, tenantId: string): Promise<string> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule || schedule.tenantId !== tenantId) throw new Error('Schedule not found');

  const { v4: uuidv4 } = await import('uuid');
  const runId = uuidv4();

  // Fire async via provision Lambda
  await lambdaClient.send(new InvokeCommand({
    FunctionName: PROVISION_LAMBDA,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      _reportJob: { scheduleId, tenantId, runId },
    })),
  }));

  return runId;
}

// ── Report Execution (called by provision Lambda) ───────────────────────────

export async function executeScheduledReport(job: {
  scheduleId: string;
  tenantId: string;
  runId?: string;
}): Promise<void> {
  const { v4: uuidv4 } = await import('uuid');
  const schedule = await getSchedule(job.scheduleId);
  if (!schedule) {
    console.error(`Schedule ${job.scheduleId} not found`);
    return;
  }

  const runId = job.runId || uuidv4();
  const startedAt = new Date().toISOString();
  const TTL_90_DAYS = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

  // Create run record
  const run: IReportRun = {
    id: runId,
    scheduleId: job.scheduleId,
    tenantId: job.tenantId,
    status: 'running',
    startedAt,
    ttl: TTL_90_DAYS,
  };
  await ddb.putItem(RUNS_TABLE, run as unknown as Record<string, unknown>);

  // Update schedule status
  await ddb.updateItem(SCHEDULES_TABLE, { id: job.scheduleId }, {
    lastRunAt: startedAt,
    lastRunStatus: 'running',
    updatedAt: startedAt,
  });

  try {
    // Invoke Snowflake Lambda
    const reportResult = await invokeSnowflakeLambda(schedule);
    const reportUrl = reportResult.download_url || reportResult.chart_url || '';

    // Deliver via email/SMS
    const deliveryResults = await deliverReport(schedule, reportUrl);

    // Update run record
    const completedAt = new Date().toISOString();
    await ddb.updateItem(RUNS_TABLE, { id: runId }, {
      status: 'success',
      completedAt,
      reportUrl,
      deliveryResults,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });

    // Update schedule
    await ddb.updateItem(SCHEDULES_TABLE, { id: job.scheduleId }, {
      lastRunStatus: 'success',
      lastRunError: '',
      consecutiveFailures: 0,
      totalRuns: (schedule.totalRuns || 0) + 1,
      updatedAt: completedAt,
    });

    console.log(`Report run ${runId} completed successfully for schedule ${job.scheduleId}`);
  } catch (e) {
    const errorMsg = String(e);
    const completedAt = new Date().toISOString();
    const newFailCount = (schedule.consecutiveFailures || 0) + 1;

    await ddb.updateItem(RUNS_TABLE, { id: runId }, {
      status: 'failed',
      completedAt,
      error: errorMsg,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });

    const statusUpdate: Record<string, unknown> = {
      lastRunStatus: 'failed',
      lastRunError: errorMsg,
      consecutiveFailures: newFailCount,
      totalRuns: (schedule.totalRuns || 0) + 1,
      updatedAt: completedAt,
    };

    // Auto-disable after 3 consecutive failures
    if (newFailCount >= 3) {
      statusUpdate['status'] = 'disabled';
      if (schedule.eventBridgeScheduleName) {
        await scheduler.send(new DeleteScheduleCommand({
          Name: schedule.eventBridgeScheduleName,
        })).catch(() => {});
      }
      console.warn(`Schedule ${job.scheduleId} auto-disabled after ${newFailCount} consecutive failures`);
    }

    await ddb.updateItem(SCHEDULES_TABLE, { id: job.scheduleId }, statusUpdate);

    // Notify creator of failure
    try {
      const { sendEmail } = await import('./integrations');
      await sendEmail(
        schedule.tenantId,
        schedule.createdBy,
        `Scheduled Report Failed: ${schedule.name}`,
        `Your scheduled report "${schedule.name}" failed to generate.\n\nError: ${errorMsg}\n\nConsecutive failures: ${newFailCount}${newFailCount >= 3 ? '\n\nThis schedule has been automatically disabled.' : ''}`,
      );
    } catch {
      console.warn('Failed to send failure notification email');
    }

    console.error(`Report run ${runId} failed for schedule ${job.scheduleId}:`, e);
  }
}

// ── Snowflake Lambda invocation ─────────────────────────────────────────────

async function invokeSnowflakeLambda(schedule: IReportSchedule): Promise<Record<string, string>> {
  const { reportType, reportConfig } = schedule;

  let apiPath: string;
  let properties: Array<{ name: string; value: string }>;

  switch (reportType) {
    case 'single':
      apiPath = '/generate_report';
      properties = [
        { name: 'sql', value: reportConfig.sql || '' },
        { name: 'title', value: reportConfig.title },
        { name: 'format', value: reportConfig.format || 'excel' },
      ];
      if (reportConfig.chartType) {
        properties.push({ name: 'chart_type', value: reportConfig.chartType });
        properties.push({ name: 'include_chart', value: 'true' });
      }
      if (reportConfig.chartXColumn) properties.push({ name: 'chart_x_column', value: reportConfig.chartXColumn });
      if (reportConfig.chartYColumn) properties.push({ name: 'chart_y_column', value: reportConfig.chartYColumn });
      break;

    case 'multi':
      apiPath = '/multi_report';
      properties = [
        { name: 'title', value: reportConfig.title },
        { name: 'queries', value: JSON.stringify(reportConfig.queries || []) },
      ];
      break;

    case 'chart':
      apiPath = '/generate_chart';
      properties = [
        { name: 'sql', value: reportConfig.sql || '' },
        { name: 'title', value: reportConfig.title },
        { name: 'chart_type', value: reportConfig.chartType || 'bar' },
      ];
      if (reportConfig.chartXColumn) properties.push({ name: 'x_column', value: reportConfig.chartXColumn });
      if (reportConfig.chartYColumn) properties.push({ name: 'y_column', value: reportConfig.chartYColumn });
      break;

    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  const payload = {
    actionGroup: 'snowflake-analytics',
    apiPath,
    httpMethod: 'POST',
    requestBody: {
      content: {
        'application/json': { properties },
      },
    },
  };

  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: SNOWFLAKE_LAMBDA,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));

  if (response.FunctionError) {
    throw new Error(`Snowflake Lambda error: ${response.FunctionError}`);
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));

  // Parse the Bedrock action group response format:
  // { messageVersion, response: { actionGroup, apiPath, responseBody: { "application/json": { body: "{...}" } } } }
  let body: Record<string, string>;
  const responseBody = result?.response?.responseBody?.['application/json']?.body;
  if (responseBody) {
    body = JSON.parse(responseBody);
  } else {
    body = JSON.parse(result?.body || '{}');
  }

  console.log('Snowflake Lambda parsed result:', JSON.stringify(body).slice(0, 500));

  if (body.error) throw new Error(body.error);
  return body;
}

// ── EventBridge Schedule management ─────────────────────────────────────────

async function createEventBridgeSchedule(
  scheduleName: string,
  schedule: IReportSchedule
): Promise<void> {
  await scheduler.send(new CreateScheduleCommand({
    Name: scheduleName,
    ScheduleExpression: schedule.scheduleExpression,
    ScheduleExpressionTimezone: schedule.timezone,
    FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
    Target: {
      Arn: `arn:aws:lambda:${REGION}:${process.env['AWS_ACCOUNT_ID'] || '780457123717'}:function:${PROVISION_LAMBDA}`,
      RoleArn: SCHEDULER_ROLE,
      Input: JSON.stringify({
        _reportJob: {
          scheduleId: schedule.id,
          tenantId: schedule.tenantId,
        },
      }),
      RetryPolicy: {
        MaximumRetryAttempts: 2,
        MaximumEventAgeInSeconds: 3600,
      },
    },
    State: 'ENABLED',
  })).catch(async (err) => {
    // If schedule already exists, update it instead
    if (err.name === 'ConflictException') {
      await scheduler.send(new UpdateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: schedule.scheduleExpression,
        ScheduleExpressionTimezone: schedule.timezone,
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        Target: {
          Arn: `arn:aws:lambda:${REGION}:${process.env['AWS_ACCOUNT_ID'] || '780457123717'}:function:${PROVISION_LAMBDA}`,
          RoleArn: SCHEDULER_ROLE,
          Input: JSON.stringify({
            _reportJob: {
              scheduleId: schedule.id,
              tenantId: schedule.tenantId,
            },
          }),
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 3600,
          },
        },
        State: 'ENABLED',
      }));
    } else {
      throw err;
    }
  });
}
