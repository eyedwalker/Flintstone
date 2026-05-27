/**
 * Voice Tool Registry — the single source of truth for what tools are safe
 * to expose over a voice channel (Nova Sonic, future voice bridges, etc.).
 *
 * Why a separate registry from conversation-engine.ts?
 *   The conversation engine drives Claude end-to-end (LLM + tool routing).
 *   A streaming voice bridge (Bedrock Nova Sonic) drives the LLM itself and
 *   only needs (a) schemas to advertise to the model and (b) an executor to
 *   invoke when the model emits a tool_use event. This module exposes that
 *   minimal surface so the bridge can call it via HTTP without dragging in
 *   the full Bedrock-Claude orchestration.
 *
 * Voice-safety policy:
 *   Tools listed here are explicitly approved for voice. Tools that mutate
 *   sensitive state (patient creation, Rx writes) are intentionally absent;
 *   they require visual confirmation paths.
 */

import * as integrations from './integrations';

export interface IToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface IToolContext {
  tenantId: string;
  /** Caller's phone number (E.164). Used for scope enforcement. */
  callerPhone?: string;
  /** Patient ID resolved from caller lookup. Tools that read patient data must match this. */
  callerPatientId?: string;
  /** Twilio CallSid — required for tools that act on the live call (transferToHuman). */
  callSid?: string;
}

export interface IToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  errorCode?: 'TOOL_NOT_ALLOWED' | 'CALLER_SCOPE_VIOLATION' | 'TOOL_FAILED' | 'INVALID_INPUT' | 'MISSING_CALL_SID';
}

const SCHEMAS: IToolSchema[] = [
  {
    name: 'searchPatients',
    description: 'Search for a patient by phone number, name, or date of birth.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Patient phone number' },
        name: { type: 'string', description: 'Patient full name' },
        dob: { type: 'string', description: 'Date of birth YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getOffices',
    description: 'List available office locations.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getProviders',
    description: 'List providers/doctors at an office.',
    input_schema: {
      type: 'object',
      properties: {
        officeId: { type: 'string', description: 'Office ID' },
      },
    },
  },
  {
    name: 'getAvailableSlots',
    description: 'Find open appointment slots at an office.',
    input_schema: {
      type: 'object',
      properties: {
        officeId: { type: 'string', description: 'Office ID' },
        providerId: { type: 'string', description: 'Provider ID (optional)' },
        date: { type: 'string', description: 'Date YYYY-MM-DD (defaults to today)' },
        preferredTime: { type: 'string', description: 'morning or afternoon' },
      },
      required: ['officeId'],
    },
  },
  {
    name: 'bookAppointment',
    description: 'Book an appointment. Always confirm details with the patient first.',
    input_schema: {
      type: 'object',
      properties: {
        officeId: { type: 'string' },
        providerId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM or h:mm AM/PM' },
        patientId: { type: 'string', description: 'Patient ID' },
        type: { type: 'string', description: 'e.g., Eye Exam' },
      },
      required: ['officeId', 'providerId', 'date', 'time'],
    },
  },
  {
    name: 'getPatientAppointments',
    description: 'Get a patient\'s upcoming appointments.',
    input_schema: {
      type: 'object',
      properties: {
        patientId: { type: 'string' },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'sendSms',
    description: 'Send a text message to a phone number.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number' },
        message: { type: 'string', description: 'Message text' },
      },
      required: ['to', 'message'],
    },
  },
  {
    name: 'transferToHuman',
    description:
      'Transfer the live call to a human at the office. Use when the caller asks for a human, ' +
      'the request is outside your capabilities, or the situation is sensitive (complaint, urgent ' +
      'medical question). After calling this, briefly tell the caller you are connecting them.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Short reason for the transfer (logged, may be spoken to the caller)',
        },
      },
    },
  },
];

/** Tools that act on the live PSTN call and require a valid Twilio CallSid in context. */
const CALL_SCOPED_TOOLS = new Set(['transferToHuman']);

/** Tools that read or write patient-scoped data must match the caller's resolved patientId. */
const PATIENT_SCOPED_TOOLS = new Set(['getPatientAppointments', 'bookAppointment']);

/** Tools the bridge is explicitly forbidden from calling, even if Nova requests them. */
const DENYLIST = new Set<string>([
  // Reserved for future tools that should never be voice-callable.
  // e.g., 'createPatient', 'updateRx', 'writeChartNote'
]);

export function listSchemas(): IToolSchema[] {
  return SCHEMAS;
}

export function isAllowed(toolName: string): boolean {
  return !DENYLIST.has(toolName) && SCHEMAS.some((s) => s.name === toolName);
}

/**
 * Execute a single tool call. Enforces denylist + caller-scope before delegating
 * to the integrations layer. Never throws — errors come back as IToolResult.
 */
export async function execute(
  toolName: string,
  input: Record<string, unknown>,
  context: IToolContext,
): Promise<IToolResult> {
  if (DENYLIST.has(toolName)) {
    return { success: false, error: `Tool '${toolName}' is not allowed on voice`, errorCode: 'TOOL_NOT_ALLOWED' };
  }
  if (!SCHEMAS.some((s) => s.name === toolName)) {
    return { success: false, error: `Unknown tool: ${toolName}`, errorCode: 'TOOL_NOT_ALLOWED' };
  }

  // Caller-scope: tools that touch patient data must use the caller's resolved patientId.
  if (PATIENT_SCOPED_TOOLS.has(toolName) && context.callerPatientId) {
    const requestedPatientId = input['patientId'];
    if (typeof requestedPatientId === 'string' && requestedPatientId !== context.callerPatientId) {
      return {
        success: false,
        error: `Tool '${toolName}' may only operate on the caller's own patientId`,
        errorCode: 'CALLER_SCOPE_VIOLATION',
      };
    }
  }

  // Call-scope: tools that act on the live call need a valid CallSid.
  if (CALL_SCOPED_TOOLS.has(toolName) && !context.callSid) {
    return {
      success: false,
      error: `Tool '${toolName}' requires a callSid in context`,
      errorCode: 'MISSING_CALL_SID',
    };
  }

  try {
    const result = await dispatch(toolName, input, context);
    return { success: true, result };
  } catch (err) {
    console.error(`[VoiceToolRegistry] ${toolName} failed:`, err);
    return { success: false, error: String(err), errorCode: 'TOOL_FAILED' };
  }
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  context: IToolContext,
): Promise<unknown> {
  const { tenantId } = context;
  const arg = <T = unknown>(k: string): T | undefined => input[k] as T | undefined;

  switch (name) {
    case 'searchPatients':
      return integrations.searchPatients(tenantId, arg<string>('phone'), arg<string>('name'), arg<string>('dob'));
    case 'getOffices':
      return integrations.getOffices(tenantId);
    case 'getProviders':
      return integrations.getProviders(tenantId, arg<string>('officeId'));
    case 'getAvailableSlots':
      return integrations.getAvailableSlots(
        tenantId,
        arg<string>('officeId') ?? '',
        arg<string>('providerId'),
        arg<string>('date'),
        undefined,
        arg<string>('preferredTime'),
      );
    case 'bookAppointment':
      return integrations.bookAppointment(tenantId, input as Parameters<typeof integrations.bookAppointment>[1]);
    case 'getPatientAppointments':
      return integrations.getPatientAppointments(tenantId, arg<string>('patientId') ?? '');
    case 'sendSms':
      return integrations.sendSms(tenantId, arg<string>('to') ?? '', arg<string>('message') ?? '');
    case 'transferToHuman': {
      // callSid presence already verified by call-scope check above.
      const reason = arg<string>('reason');
      if (reason) console.log(`[VoiceToolRegistry] transferToHuman reason: ${reason}`);
      // Use the integration's default intro — the LLM already announced the transfer
      // to the caller, so a second spoken sentence would be awkward.
      return integrations.redirectCallToOffice(tenantId, context.callSid!);
    }
    default:
      throw new Error(`Unhandled tool dispatch: ${name}`);
  }
}
