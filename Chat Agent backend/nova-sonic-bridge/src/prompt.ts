/**
 * System prompt builder.
 *
 * The system prompt is set once when the Bedrock session opens and can't be
 * changed mid-call. We compute it at session start with whatever context we
 * already have (patient lookup from caller phone, time of day, agent name).
 *
 * Keep prompts short — voice is latency-sensitive and over-instruction makes
 * the model verbose. Spoken responses should feel like a person, not a wiki.
 */

export interface IResolvedPatient {
  id: string;
  firstName?: string;
  lastName?: string;
}

const BASE_INSTRUCTIONS = [
  'You are Emily, a friendly receptionist at an eye care office.',
  'You are speaking with a caller on the phone. Keep replies brief, warm, and natural — not formal.',
  'Use the provided tools to look up real information; never invent appointment times or patient details.',
  'When the caller wants a human, call transferToHuman and briefly say you are connecting them.',
  'When transferring, do not also use the office phone number — the transfer tool handles dialing.',
  'If you cannot resolve something with a tool, say so plainly and offer to transfer.',
].join(' ');

export interface IBuildPromptOptions {
  direction?: 'inbound' | 'outbound';
  /** For outbound calls: what the call is about (e.g. "Confirm Tuesday 2pm appointment"). */
  goal?: string;
}

export function buildSystemPrompt(
  patient: IResolvedPatient | undefined,
  callerPhone: string | undefined,
  opts: IBuildPromptOptions = {},
): string {
  const lines = [BASE_INSTRUCTIONS];

  if (opts.direction === 'outbound') {
    lines.push(
      'This is an OUTBOUND call: we placed the call to the patient. Open with a brief greeting, ' +
      'identify the office, and state why you are calling. Respect that the patient did not initiate ' +
      'this conversation — be efficient and offer to call back if it is a bad time.',
    );
    if (opts.goal) {
      lines.push(`Purpose of this call: ${opts.goal}`);
    }
  }

  if (patient?.firstName || patient?.lastName) {
    const name = [patient.firstName, patient.lastName].filter(Boolean).join(' ');
    const greetVerb = opts.direction === 'outbound' ? 'Address them' : 'Greet them';
    lines.push(
      `The ${opts.direction === 'outbound' ? 'patient' : 'caller'} has been identified as ${name} (patient id ${patient.id}). ` +
      `${greetVerb} by their first name. Tool calls that operate on patient data must use this patient id.`,
    );
  } else if (callerPhone) {
    lines.push(
      `The other party's phone number is ${callerPhone}. Patient lookup did not return a unique match — ` +
      `do not assume an identity; verify name and date of birth before sharing patient information.`,
    );
  }

  lines.push(timeContextLine());

  return lines.join('\n');
}

function timeContextLine(): string {
  const d = new Date();
  const hour = d.getHours();
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  // Day-of-week helps when callers ask about same-day vs next-day availability.
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  return `It is currently ${period} on ${day}. Use this when discussing scheduling.`;
}
