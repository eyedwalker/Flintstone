/**
 * SMS Emergency Escalation — what happens when the intent classifier flags
 * an inbound SMS as emergency-grade urgency.
 *
 * Two actions in parallel:
 *   1. SMS reply to the patient — direct them to 911 / the office line. We
 *      do NOT try to be reassuring or solve the problem via chatbot. The
 *      message text is fixed (no LLM call) so it can't be subverted by
 *      prompt injection.
 *   2. SMS the office phone — staff need to know there's an emergency
 *      message in the queue right now. Includes the patient's number,
 *      a snippet of the message, and the classifier's reasoning.
 *
 * We deliberately do NOT auto-call 911 — that's an action only the patient
 * (or staff with full context) should take. Our role is to make the path
 * to a human as short as possible.
 */

import * as integrations from './integrations';
import type { ISmsIntentResult } from './sms-intent';

export interface IEscalationContext {
  tenantId: string;
  patientPhone: string;
  messageBody: string;
  intent: ISmsIntentResult;
}

export interface IEscalationResult {
  patientNotified: boolean;
  staffNotified: boolean;
  errors: string[];
}

export const EMERGENCY_REPLY =
  'If this is a medical emergency, please call 911 immediately. ' +
  'For urgent eye care, call our office directly. Our team will follow up with you as soon as possible.';

/**
 * Fire both notifications in parallel. Returns a result object describing
 * which channels succeeded — caller can decide whether to log a soft warning
 * or take further action. Never throws.
 */
export async function escalate(ctx: IEscalationContext): Promise<IEscalationResult> {
  const result: IEscalationResult = { patientNotified: false, staffNotified: false, errors: [] };

  // 1. Reply to the patient with a fixed safe-harbor message.
  // Send even if they're on the SMS opt-out list — TCPA carve-out for
  // medical emergencies. (integrations.sendSms enforces opt-out today,
  // so for now we trust the classifier's high-urgency signal. A follow-up
  // could add an `overrideOptOut: true` flag.)
  try {
    const reply = await integrations.sendSms(ctx.tenantId, ctx.patientPhone, EMERGENCY_REPLY);
    result.patientNotified = reply.success;
    if (!reply.success && reply.error) result.errors.push(`patient: ${reply.error}`);
  } catch (err) {
    result.errors.push(`patient: ${String(err)}`);
  }

  // 2. SMS the office phone with the alert.
  try {
    const officePhone = await integrations.getOfficePhone(ctx.tenantId);
    if (!officePhone) {
      result.errors.push('staff: no office phone configured');
    } else {
      const snippet = ctx.messageBody.length > 100
        ? ctx.messageBody.slice(0, 97) + '...'
        : ctx.messageBody;
      const reasoning = ctx.intent.reasoning ? ` (${ctx.intent.reasoning})` : '';
      const staffMessage =
        `URGENT: emergency SMS from ${ctx.patientPhone}${reasoning}. ` +
        `Message: "${snippet}". Reply via dashboard immediately.`;
      const sent = await integrations.sendSms(ctx.tenantId, officePhone, staffMessage);
      result.staffNotified = sent.success;
      if (!sent.success && sent.error) result.errors.push(`staff: ${sent.error}`);
    }
  } catch (err) {
    result.errors.push(`staff: ${String(err)}`);
  }

  return result;
}
