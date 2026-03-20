/**
 * Security Agent — pre-routing middleware for HIPAA compliance and input safety.
 *
 * Runs BEFORE any specialist agent sees the message:
 *  1. Fast regex scan for PII patterns (SSN, credit card, etc.)
 *  2. Prompt injection detection
 *  3. Input sanitization
 *  4. Audit logging of flagged messages
 *
 * Does NOT block legitimate healthcare queries — "patient DOB" in context is fine,
 * raw SSN in free text gets redacted from logs.
 */

import * as audit from './audit';

// ── PII Regex Patterns ────────────────────────────────────────────────────────

const PII_PATTERNS: { name: string; regex: RegExp; redactWith: string }[] = [
  {
    name: 'ssn',
    regex: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    redactWith: '[SSN-REDACTED]',
  },
  {
    name: 'credit_card',
    regex: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    redactWith: '[CC-REDACTED]',
  },
  {
    name: 'email_address',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    redactWith: '[EMAIL-REDACTED]',
  },
  {
    name: 'phone_us',
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    redactWith: '[PHONE-REDACTED]',
  },
];

// ── Prompt Injection Patterns ─────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /\bDAN\b.*\bmode\b/i,
  /do\s+anything\s+now/i,
  /jailbreak/i,
  /bypass\s+(safety|filter|guardrail|restriction)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /act\s+as\s+if\s+(you\s+have\s+)?no\s+(rules|restrictions|guidelines)/i,
];

// ── Scan Result Types ─────────────────────────────────────────────────────────

export interface IScanResult {
  /** Whether the message is allowed to proceed */
  allowed: boolean;
  /** The message with PII redacted (for logging only — original goes to agent) */
  sanitizedForLog: string;
  /** The original message (passes through to agent unchanged) */
  message: string;
  /** Flags raised during scan */
  flags: IScanFlag[];
  /** Human-readable reason if blocked */
  reason?: string;
}

export interface IScanFlag {
  type: 'pii' | 'injection' | 'suspicious';
  pattern: string;
  action: 'redacted_from_log' | 'blocked' | 'warned';
}

// ── Main Scan Function ────────────────────────────────────────────────────────

/**
 * Scan an inbound message for security concerns.
 *
 * - PII is NOT stripped from the message sent to the agent (healthcare context needs it)
 * - PII IS redacted from the version stored in logs/metrics (HIPAA compliance)
 * - Prompt injection attempts are blocked entirely
 */
export function scan(message: string): IScanResult {
  const flags: IScanFlag[] = [];
  let sanitizedForLog = message;

  // ── 1. Check for prompt injection ──────────────────────────────────────────
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      flags.push({
        type: 'injection',
        pattern: pattern.source,
        action: 'blocked',
      });
    }
  }

  if (flags.some((f) => f.type === 'injection')) {
    return {
      allowed: false,
      sanitizedForLog: '[BLOCKED — injection attempt]',
      message,
      flags,
      reason: 'Your message was flagged as potentially unsafe. Please rephrase your question.',
    };
  }

  // ── 2. Detect and redact PII from log version ──────────────────────────────
  for (const { name, regex, redactWith } of PII_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    if (regex.test(message)) {
      flags.push({
        type: 'pii',
        pattern: name,
        action: 'redacted_from_log',
      });
      regex.lastIndex = 0;
      sanitizedForLog = sanitizedForLog.replace(regex, redactWith);
    }
  }

  return {
    allowed: true,
    sanitizedForLog,
    message, // original — agent sees the real message
    flags,
  };
}

/**
 * Scan an outbound agent response before returning to the user.
 * Redacts any PII the agent might have echoed back.
 */
export function scanResponse(response: string): { sanitized: string; flags: IScanFlag[] } {
  const flags: IScanFlag[] = [];
  let sanitized = response;

  for (const { name, regex, redactWith } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(response)) {
      flags.push({
        type: 'pii',
        pattern: name,
        action: 'redacted_from_log',
      });
      regex.lastIndex = 0;
      sanitized = sanitized.replace(regex, redactWith);
    }
  }

  return { sanitized, flags };
}

/**
 * Log a security event to the audit trail.
 */
export async function logSecurityEvent(
  organizationId: string,
  userId: string,
  flags: IScanFlag[],
  messageSummary: string,
): Promise<void> {
  if (flags.length === 0) return;
  try {
    await audit.logAudit(organizationId, userId, 'security_scan', {
      flags: flags.map((f) => ({ type: f.type, pattern: f.pattern, action: f.action })),
      messagePreview: messageSummary.substring(0, 100),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('security audit log error (non-critical)', e);
  }
}
