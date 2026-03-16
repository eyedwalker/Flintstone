/**
 * Report Schedules CRUD routes
 *
 * All endpoints require JWT auth and admin role.
 * Multi-tenant: all operations scoped to ctx.organizationId.
 */

import { ok, notFound, badRequest, serverError, forbidden } from '../response';
import { IRequestContext, requireRole } from '../auth';
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  getSchedule,
  listSchedules,
  listRuns,
  triggerRun,
} from '../services/report-scheduler';

export async function handleReportSchedules(
  method: string,
  rawPath: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
) {
  if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

  // POST /report-schedules — create schedule
  if (rawPath === '/report-schedules' && method === 'POST') {
    return handleCreate(body, ctx);
  }

  // GET /report-schedules — list schedules
  if (rawPath === '/report-schedules' && method === 'GET') {
    return handleList(ctx);
  }

  // Routes with schedule ID
  const idMatch = rawPath.match(/^\/report-schedules\/([^/]+)/);
  const scheduleId = idMatch?.[1] || params['id'];
  if (!scheduleId) return badRequest('Schedule ID required');

  // POST /report-schedules/:id/run — trigger immediate run
  if (rawPath.endsWith('/run') && method === 'POST') {
    return handleTriggerRun(scheduleId, ctx);
  }

  // POST /report-schedules/:id/pause
  if (rawPath.endsWith('/pause') && method === 'POST') {
    return handlePause(scheduleId, ctx);
  }

  // POST /report-schedules/:id/resume
  if (rawPath.endsWith('/resume') && method === 'POST') {
    return handleResume(scheduleId, ctx);
  }

  // GET /report-schedules/:id/runs — execution history
  if (rawPath.endsWith('/runs') && method === 'GET') {
    return handleListRuns(scheduleId, ctx);
  }

  // GET /report-schedules/:id — get single schedule
  if (method === 'GET') {
    return handleGet(scheduleId, ctx);
  }

  // PUT /report-schedules/:id — update schedule
  if (method === 'PUT') {
    return handleUpdate(scheduleId, body, ctx);
  }

  // DELETE /report-schedules/:id — delete schedule
  if (method === 'DELETE') {
    return handleDelete(scheduleId, ctx);
  }

  return notFound('Route not found');
}

async function handleCreate(body: Record<string, unknown>, ctx: IRequestContext) {
  try {
    const { name, reportType, reportConfig, scheduleExpression, timezone, delivery, description } = body as any;

    if (!name || !reportType || !reportConfig || !scheduleExpression) {
      return badRequest('name, reportType, reportConfig, and scheduleExpression are required');
    }
    if (!delivery?.email?.recipients?.length && !delivery?.sms?.recipients?.length) {
      return badRequest('At least one delivery method (email or SMS) with recipients is required');
    }
    if (!reportConfig.title) {
      return badRequest('reportConfig.title is required');
    }
    if (reportType === 'single' || reportType === 'chart') {
      if (!reportConfig.sql) return badRequest('reportConfig.sql is required for single/chart reports');
    }
    if (reportType === 'multi') {
      if (!reportConfig.queries?.length) return badRequest('reportConfig.queries is required for multi reports');
    }

    const schedule = await createSchedule(ctx.organizationId, ctx.userId, {
      name,
      description,
      reportType,
      reportConfig: {
        ...reportConfig,
        containsPhi: reportConfig.containsPhi ?? false,
        format: reportConfig.format || 'excel',
      },
      scheduleExpression,
      timezone: timezone || 'America/Los_Angeles',
      status: 'active',
      delivery,
    });

    return ok(schedule);
  } catch (e) {
    console.error('Create schedule error:', e);
    return badRequest(String(e));
  }
}

async function handleList(ctx: IRequestContext) {
  try {
    const schedules = await listSchedules(ctx.organizationId);
    return ok(schedules);
  } catch (e) {
    console.error('List schedules error:', e);
    return serverError(String(e));
  }
}

async function handleGet(scheduleId: string, ctx: IRequestContext) {
  try {
    const schedule = await getSchedule(scheduleId);
    if (!schedule || schedule.tenantId !== ctx.organizationId) return notFound('Schedule not found');
    return ok(schedule);
  } catch (e) {
    return serverError(String(e));
  }
}

async function handleUpdate(scheduleId: string, body: Record<string, unknown>, ctx: IRequestContext) {
  try {
    const { name, description, reportConfig, scheduleExpression, timezone, delivery } = body as any;
    await updateSchedule(scheduleId, ctx.organizationId, {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(reportConfig && { reportConfig }),
      ...(scheduleExpression && { scheduleExpression }),
      ...(timezone && { timezone }),
      ...(delivery && { delivery }),
    });
    const updated = await getSchedule(scheduleId);
    return ok(updated);
  } catch (e) {
    console.error('Update schedule error:', e);
    return badRequest(String(e));
  }
}

async function handleDelete(scheduleId: string, ctx: IRequestContext) {
  try {
    await deleteSchedule(scheduleId, ctx.organizationId);
    return ok({ deleted: true });
  } catch (e) {
    console.error('Delete schedule error:', e);
    return badRequest(String(e));
  }
}

async function handlePause(scheduleId: string, ctx: IRequestContext) {
  try {
    await pauseSchedule(scheduleId, ctx.organizationId);
    return ok({ status: 'paused' });
  } catch (e) {
    return badRequest(String(e));
  }
}

async function handleResume(scheduleId: string, ctx: IRequestContext) {
  try {
    await resumeSchedule(scheduleId, ctx.organizationId);
    return ok({ status: 'active' });
  } catch (e) {
    return badRequest(String(e));
  }
}

async function handleTriggerRun(scheduleId: string, ctx: IRequestContext) {
  try {
    const runId = await triggerRun(scheduleId, ctx.organizationId);
    return ok({ runId, status: 'triggered' });
  } catch (e) {
    return badRequest(String(e));
  }
}

async function handleListRuns(scheduleId: string, ctx: IRequestContext) {
  try {
    const schedule = await getSchedule(scheduleId);
    if (!schedule || schedule.tenantId !== ctx.organizationId) return notFound('Schedule not found');
    const runs = await listRuns(scheduleId);
    return ok(runs);
  } catch (e) {
    return serverError(String(e));
  }
}
