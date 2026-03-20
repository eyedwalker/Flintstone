/**
 * Front Office Action Group Handler
 *
 * Called by the Bedrock Agent Runtime when the Front Office agent decides
 * to use a tool (search patients, book appointment, send SMS, etc.).
 *
 * Bedrock OpenAPI-based action groups send events with:
 *   { actionGroup, apiPath, httpMethod, parameters[], sessionAttributes }
 * The apiPath maps to the operationId in the OpenAPI spec (e.g., "/getOffices").
 */

import * as integrations from './integrations';

// ── Bedrock Action Group Event Types ──────────────────────────────────────────

interface IActionGroupEvent {
  messageVersion?: string;
  actionGroup: string;
  // OpenAPI-based action group fields
  apiPath?: string;
  httpMethod?: string;
  // Function-based action group fields
  function?: string;
  // Parameters from either format
  parameters?: { name: string; value: string; type?: string }[];
  requestBody?: { content: { 'application/json': { properties: { name: string; value: string; type?: string }[] } } };
  sessionAttributes?: Record<string, string>;
  promptSessionAttributes?: Record<string, string>;
}

interface IActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath?: string;
    httpMethod?: string;
    function?: string;
    httpStatusCode: number;
    responseBody: {
      'application/json': { body: string };
    };
  };
}

// ── Main Handler ──────────────────────────────────────────────────────────────

/**
 * Process a Bedrock action group invocation.
 * The tenantId is passed via sessionAttributes so we know which tenant's
 * credentials to use for external API calls.
 */
export async function handleActionGroup(
  event: IActionGroupEvent,
): Promise<IActionGroupResponse> {
  const tenantId = event.sessionAttributes?.['tenantId'] ?? '';

  // Resolve function name from apiPath (OpenAPI) or function (function-based)
  const fnName = event.apiPath
    ? event.apiPath.replace(/^\//, '') // strip leading slash: "/getOffices" → "getOffices"
    : event.function ?? 'unknown';

  // Extract parameters from either format
  const rawParams = event.parameters ?? [];
  const bodyParams = event.requestBody?.content?.['application/json']?.properties ?? [];
  const allParams = [...rawParams, ...bodyParams];
  const params = Object.fromEntries(
    allParams.map((p) => [p.name, p.value]),
  );

  console.log(`[FrontOffice] ${event.actionGroup}/${fnName}`, JSON.stringify(params).slice(0, 200));

  let result: string;

  try {
    switch (fnName) {
      // ── Patient Management ──────────────────────────────────────────────
      case 'searchPatients':
        result = await handleSearchPatients(tenantId, params);
        break;

      // ── Office & Provider ───────────────────────────────────────────────
      case 'getOffices':
        result = await handleGetOffices(tenantId);
        break;

      case 'getProviders':
        result = await handleGetProviders(tenantId, params);
        break;

      case 'getStaff':
        result = await handleGetStaff(tenantId, params);
        break;

      case 'getAppointmentTypes':
        result = await handleGetAppointmentTypes(tenantId, params);
        break;

      // ── Appointment Scheduling ──────────────────────────────────────────
      case 'getAvailableSlots':
        result = await handleGetAvailableSlots(tenantId, params);
        break;

      case 'bookAppointment':
        result = await handleBookAppointment(tenantId, params);
        break;

      case 'getProviderAppointments':
        result = await handleGetProviderAppointments(tenantId, params);
        break;

      case 'getPatientAppointments':
        result = await handleGetPatientAppointments(tenantId, params);
        break;

      case 'confirmAppointment':
        result = await handleConfirmAppointment(tenantId, params);
        break;

      // ── Patient ─────────────────────────────────────────────────────────
      case 'createPatient':
        result = await handleCreatePatient(tenantId, params);
        break;

      case 'getPatientOrders':
        result = await handleGetPatientOrders(tenantId, params);
        break;

      // ── Orders ──────────────────────────────────────────────────────────
      case 'getOrders':
        result = await handleGetOrders(tenantId, params);
        break;

      // ── Communication ───────────────────────────────────────────────────
      case 'sendSms':
        result = await handleSendSms(tenantId, params);
        break;

      case 'sendEmail':
        result = await handleSendEmail(tenantId, params);
        break;

      case 'makeCall':
        result = await handleMakeCall(tenantId, params);
        break;

      // ── Report Scheduling ──────────────────────────────────────────────
      case 'scheduleReport':
        result = await handleScheduleReport(tenantId, params);
        break;

      default:
        result = JSON.stringify({ error: `Unknown function: ${fnName}` });
    }
  } catch (err) {
    console.error(`[FrontOffice] Error in ${fnName}:`, err);
    result = JSON.stringify({ error: `Action failed: ${String(err)}` });
  }

  return {
    messageVersion: event.messageVersion ?? '1.0',
    response: {
      actionGroup: event.actionGroup,
      ...(event.apiPath && { apiPath: event.apiPath, httpMethod: event.httpMethod }),
      ...(event.function && { function: event.function }),
      httpStatusCode: 200,
      responseBody: {
        'application/json': { body: result },
      },
    },
  };
}

// ── Action Implementations ────────────────────────────────────────────────────

async function handleSearchPatients(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const patients = await integrations.searchPatients(
    tenantId,
    params['phone'],
    params['name'],
    params['dob'],
    params['email'],
  );

  if (patients.length === 0) {
    return JSON.stringify({
      found: false,
      message: 'No patients found matching that information.',
      suggestNewPatient: true,
    });
  }

  return JSON.stringify({
    found: true,
    count: patients.length,
    patients: patients.slice(0, 5),
    message: patients.length === 1
      ? `Found patient: ${patients[0].firstName} ${patients[0].lastName}`
      : `Found ${patients.length} matching patients. Please ask which one.`,
  });
}

async function handleGetOffices(tenantId: string): Promise<string> {
  const offices = await integrations.getOffices(tenantId);
  return JSON.stringify({
    offices,
    count: offices.length,
    message: offices.length === 1
      ? `There is one office: ${offices[0].name}`
      : `There are ${offices.length} offices available.`,
  });
}

async function handleGetProviders(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const officeId = params['officeId'];
  if (!officeId) return JSON.stringify({ error: 'officeId is required' });

  const providers = await integrations.getProviders(tenantId, officeId);
  return JSON.stringify({
    providers,
    count: providers.length,
    message: providers.length === 0
      ? 'No providers found at this office.'
      : `Found ${providers.length} providers.`,
  });
}

async function handleGetAvailableSlots(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const { officeId, providerId, date, preferredTime } = params;
  if (!officeId || !providerId || !date) {
    return JSON.stringify({ error: 'officeId, providerId, and date are required' });
  }

  const slots = await integrations.getAvailableSlots(
    tenantId, officeId, providerId, date, preferredTime,
  );

  if (slots.length === 0) {
    return JSON.stringify({
      available: false,
      message: `No openings found on ${date}. Try a different date.`,
    });
  }

  return JSON.stringify({
    available: true,
    slots: slots.slice(0, 5),
    message: `Found ${slots.length} available slots.`,
  });
}

async function handleBookAppointment(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const { patientId, officeId, providerId, date, time, type, notes } = params;
  if (!officeId || !providerId || !date || !time) {
    return JSON.stringify({ error: 'officeId, providerId, date, and time are required' });
  }

  const result = await integrations.bookAppointment(tenantId, {
    patientId,
    officeId,
    providerId,
    date,
    time,
    type,
    notes,
  });

  return JSON.stringify({
    booked: result.status === 'confirmed',
    appointment: result,
    message: result.status === 'confirmed'
      ? `Appointment confirmed for ${result.date} at ${result.time} with ${result.providerName}.`
      : `Appointment request submitted — staff will confirm.`,
  });
}

async function handleGetStaff(tenantId: string, params: Record<string, string>): Promise<string> {
  const staff = await integrations.getStaff(tenantId, params['officeId']);
  return JSON.stringify({ staff, count: staff.length });
}

async function handleGetAppointmentTypes(tenantId: string, params: Record<string, string>): Promise<string> {
  const officeId = params['officeId'];
  if (!officeId) return JSON.stringify({ error: 'officeId is required' });
  const types = await integrations.getOfficeAppointmentTypes(tenantId, officeId);
  return JSON.stringify({ appointmentTypes: types, count: types.length });
}

async function handleGetProviderAppointments(tenantId: string, params: Record<string, string>): Promise<string> {
  const providerId = params['providerId'];
  if (!providerId) return JSON.stringify({ error: 'providerId is required' });
  const appointments = await integrations.getProviderAppointments(tenantId, providerId);
  return JSON.stringify({ appointments, count: appointments.length });
}

async function handleGetPatientAppointments(tenantId: string, params: Record<string, string>): Promise<string> {
  const patientId = params['patientId'];
  if (!patientId) return JSON.stringify({ error: 'patientId is required' });
  const appointments = await integrations.getPatientAppointments(tenantId, patientId);
  return JSON.stringify({ appointments, count: appointments.length });
}

async function handleConfirmAppointment(tenantId: string, params: Record<string, string>): Promise<string> {
  const { providerId, appointmentId } = params;
  if (!providerId || !appointmentId) return JSON.stringify({ error: 'providerId and appointmentId required' });
  const confirmed = params['confirmed'] !== 'false';
  const success = await integrations.confirmAppointment(tenantId, providerId, appointmentId, confirmed);
  return JSON.stringify({ success, message: success ? 'Appointment confirmed.' : 'Failed to confirm.' });
}

async function handleCreatePatient(tenantId: string, params: Record<string, string>): Promise<string> {
  const { firstName, lastName, dob, phone, email } = params;
  if (!firstName || !lastName) return JSON.stringify({ error: 'firstName and lastName are required' });
  const result = await integrations.createPatient(tenantId, { firstName, lastName, dob, phone, email });
  return JSON.stringify(result ? { success: true, patient: result } : { success: false, error: 'Failed to create patient' });
}

async function handleGetPatientOrders(tenantId: string, params: Record<string, string>): Promise<string> {
  const patientId = params['patientId'];
  if (!patientId) return JSON.stringify({ error: 'patientId is required' });
  const orders = await integrations.getPatientOrders(tenantId, patientId);
  return JSON.stringify({ orders, count: orders.length });
}

async function handleGetOrders(tenantId: string, params: Record<string, string>): Promise<string> {
  const orders = await integrations.getOrders(tenantId, params['fromDate'], params['toDate']);
  return JSON.stringify({ orders, count: orders.length });
}

async function handleMakeCall(tenantId: string, params: Record<string, string>): Promise<string> {
  const { to, message, voiceName } = params;
  if (!to || !message) return JSON.stringify({ error: 'to and message are required' });
  const result = await integrations.makeCall(tenantId, to, message, voiceName);
  return JSON.stringify(result);
}

async function handleSendSms(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const { to, message } = params;
  if (!to || !message) {
    return JSON.stringify({ error: 'to and message are required' });
  }

  const result = await integrations.sendSms(tenantId, to, message);
  return JSON.stringify(result);
}

async function handleSendEmail(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const { to, subject, body: bodyText } = params;
  if (!to || !subject || !bodyText) {
    return JSON.stringify({ error: 'to, subject, and body are required' });
  }

  const result = await integrations.sendEmail(tenantId, to, subject, bodyText);
  return JSON.stringify(result);
}

// ── Report Scheduling ──────────────────────────────────────────────────────

const FREQUENCY_TO_CRON: Record<string, (day?: string, dayNum?: number, time?: string) => string> = {
  daily: (_d, _n, time = '08:00') => {
    const [h, m] = time.split(':');
    return `cron(${m || '0'} ${h || '8'} * * ? *)`;
  },
  weekly: (day = 'monday', _n, time = '08:00') => {
    const [h, m] = time.split(':');
    const dayMap: Record<string, string> = {
      sunday: 'SUN', monday: 'MON', tuesday: 'TUE', wednesday: 'WED',
      thursday: 'THU', friday: 'FRI', saturday: 'SAT',
    };
    return `cron(${m || '0'} ${h || '8'} ? * ${dayMap[day.toLowerCase()] || 'MON'} *)`;
  },
  monthly: (_d, dayNum = 1, time = '08:00') => {
    const [h, m] = time.split(':');
    const d = Math.min(Math.max(dayNum, 1), 28);
    return `cron(${m || '0'} ${h || '8'} ${d} * ? *)`;
  },
};

async function handleScheduleReport(
  tenantId: string,
  params: Record<string, string>,
): Promise<string> {
  const { reportTitle, frequency, dayOfWeek, dayOfMonth, time, timezone, emailRecipients, smsRecipients, sql, format } = params;

  if (!reportTitle || !frequency || !sql) {
    return JSON.stringify({ error: 'reportTitle, frequency, and sql are required' });
  }

  const cronBuilder = FREQUENCY_TO_CRON[frequency.toLowerCase()];
  if (!cronBuilder) {
    return JSON.stringify({ error: `Invalid frequency: ${frequency}. Use daily, weekly, or monthly.` });
  }

  const scheduleExpression = cronBuilder(dayOfWeek, dayOfMonth ? parseInt(dayOfMonth) : undefined, time);

  const emailList = emailRecipients ? emailRecipients.split(',').map(e => e.trim()).filter(Boolean) : [];
  const smsList = smsRecipients ? smsRecipients.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (emailList.length === 0 && smsList.length === 0) {
    return JSON.stringify({ error: 'At least one email or SMS recipient is required' });
  }

  try {
    const { createSchedule } = await import('./report-scheduler');
    const schedule = await createSchedule(tenantId, 'agent', {
      name: reportTitle,
      reportType: 'single',
      reportConfig: {
        sql,
        title: reportTitle,
        format: (format as 'excel' | 'csv') || 'excel',
        containsPhi: false,
      },
      scheduleExpression,
      timezone: timezone || 'America/Los_Angeles',
      status: 'active',
      delivery: {
        ...(emailList.length > 0 && { email: { recipients: emailList } }),
        ...(smsList.length > 0 && { sms: { recipients: smsList } }),
      },
    });

    const frequencyText = frequency.toLowerCase() === 'daily' ? 'daily'
      : frequency.toLowerCase() === 'weekly' ? `every ${dayOfWeek || 'Monday'}`
      : `on the ${dayOfMonth || '1st'} of each month`;

    return JSON.stringify({
      success: true,
      scheduleId: schedule.id,
      name: schedule.name,
      frequency: frequencyText,
      time: time || '08:00 AM',
      timezone: schedule.timezone,
      recipients: {
        email: emailList,
        sms: smsList,
      },
      message: `Scheduled "${reportTitle}" to run ${frequencyText} at ${time || '8:00 AM'} ${schedule.timezone}. ${emailList.length > 0 ? `Email: ${emailList.join(', ')}` : ''}${smsList.length > 0 ? ` SMS: ${smsList.join(', ')}` : ''}`,
    });
  } catch (e) {
    console.error('[FrontOffice] scheduleReport error:', e);
    return JSON.stringify({ error: `Failed to create schedule: ${String(e)}` });
  }
}
