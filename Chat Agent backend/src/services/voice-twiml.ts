/**
 * TwiML Builder — generates Twilio Markup Language XML responses.
 *
 * Voice-quality choices baked into the defaults:
 *   • <Say> is placed INSIDE <Gather> so the caller can interrupt (barge-in).
 *   • `enhanced="true"` selects Twilio's higher-accuracy recognition engine.
 *   • `profanityFilter="false"` avoids masking medically relevant words.
 *   • Optional `hints` boosts recognition for patient names and domain terms.
 *
 * All builders return well-formed XML; user-supplied strings are XML-escaped.
 */

export interface IVoiceConfig {
  voiceName: string;       // Polly voice: 'Polly.Joanna-Neural', 'Polly.Matthew-Neural', etc.
  speechRate: string;      // Prosody rate: '100%', '110%', '115%'
  gatherTimeout: number;   // Seconds to wait for speech (default 5)
  speechTimeout: string;   // 'auto' or seconds
  language: string;        // 'en-US'
  hints?: string;          // Optional comma-separated recognition hints (boosts accuracy)
}

const DEFAULT_CONFIG: IVoiceConfig = {
  voiceName: 'Polly.Joanna-Neural',
  speechRate: '110%',
  gatherTimeout: 5,
  speechTimeout: 'auto',
  language: 'en-US',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSayTag(message: string, config: IVoiceConfig): string {
  const escaped = escapeXml(message);
  return `<Say voice="${config.voiceName}"><prosody rate="${config.speechRate}">${escaped}</prosody></Say>`;
}

function buildGatherOpenTag(
  callbackUrl: string,
  config: IVoiceConfig,
  input: 'speech' | 'speech dtmf',
  timeoutSeconds: number,
): string {
  const attrs = [
    `input="${input}"`,
    `timeout="${timeoutSeconds}"`,
    `action="${escapeXml(callbackUrl)}"`,
    `method="POST"`,
    `speechTimeout="${config.speechTimeout}"`,
    `language="${config.language}"`,
    `enhanced="true"`,
    `profanityFilter="false"`,
  ];
  if (config.hints) {
    attrs.push(`hints="${escapeXml(config.hints)}"`);
  }
  return `<Gather ${attrs.join(' ')}>`;
}

/**
 * Build the initial greeting TwiML for an inbound call.
 * The <Say> lives inside <Gather> so the caller can interrupt.
 */
export function buildGreetingTwiml(
  greeting: string,
  callbackUrl: string,
  config: Partial<IVoiceConfig> = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildGatherOpenTag(callbackUrl, cfg, 'speech', cfg.gatherTimeout),
    buildSayTag(greeting, cfg),
    '</Gather>',
    buildSayTag('I didn\'t hear anything. If you need help, please call back anytime. Goodbye!', cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML for a conversation turn — speak the response inside Gather so
 * the caller can interrupt. Falls back to a second prompt then hangup on silence.
 */
export function buildGatherTwiml(
  message: string,
  callbackUrl: string,
  config: Partial<IVoiceConfig> = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // Conversation turns get a slightly longer timeout than the initial greeting
  // since callers often pause mid-thought.
  const turnTimeout = cfg.gatherTimeout + 2;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildGatherOpenTag(callbackUrl, cfg, 'speech dtmf', turnTimeout),
    buildSayTag(message, cfg),
    '</Gather>',
    buildGatherOpenTag(callbackUrl, cfg, 'speech', 5),
    buildSayTag('Are you still there? I\'ll wait a moment.', cfg),
    '</Gather>',
    buildSayTag('It seems like you may have gone. Feel free to call back anytime. Goodbye!', cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML to transfer the call to a human, with voicemail fallback.
 * Pass `voicemailCallbackUrl` (typically `${baseUrl}/voice/recording-status?type=voicemail`)
 * to wire the recorded voicemail through our recording pipeline — the
 * `type=voicemail` marker lets the handler send a staff notification.
 */
export interface ITransferTwimlOptions extends Partial<IVoiceConfig> {
  voicemailCallbackUrl?: string;
}

export function buildTransferTwiml(
  message: string,
  officePhone: string,
  options: ITransferTwimlOptions = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...options };
  const recordAttrs = [
    'maxLength="120"',
    'playBeep="true"',
  ];
  if (options.voicemailCallbackUrl) {
    recordAttrs.push(`recordingStatusCallback="${escapeXml(options.voicemailCallbackUrl)}"`);
    recordAttrs.push('recordingStatusCallbackEvent="completed"');
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildSayTag(message, cfg),
    `<Dial timeout="30">`,
    `<Number>${escapeXml(officePhone)}</Number>`,
    '</Dial>',
    buildSayTag('I\'m sorry, no one is available right now. Please leave a message after the beep and we\'ll call you back.', cfg),
    `<Record ${recordAttrs.join(' ')}/>`,
    buildSayTag('Thank you for your message. We\'ll get back to you as soon as possible. Goodbye!', cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML for ending the call gracefully.
 */
export function buildHangupTwiml(
  message: string,
  config: Partial<IVoiceConfig> = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildSayTag(message, cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML that connects the call to the Nova Sonic streaming bridge.
 * Used for numbers that have been migrated off the Say/Gather flow.
 *
 *   streamUrl   wss://nova-sonic.example.com/stream (no query string — added below)
 *   tenantId    passed as ?tenantId=... so the bridge knows tool scope
 *   fromPhone   passed as a <Parameter> so the bridge can resolve patient
 *
 * For outbound calls, set `opts.direction = 'outbound'` and provide a `goal`
 * — the bridge injects the goal into the model's system prompt so it knows
 * the purpose of the call.
 */
export interface IStreamTwimlOptions {
  direction?: 'inbound' | 'outbound';
  goal?: string;
}

export function buildStreamTwiml(
  streamUrl: string,
  tenantId: string,
  fromPhone: string,
  opts: IStreamTwimlOptions = {},
): string {
  const direction = opts.direction ?? 'inbound';
  const url = `${streamUrl}?tenantId=${encodeURIComponent(tenantId)}&direction=${encodeURIComponent(direction)}`;
  const params: string[] = [
    `<Parameter name="fromPhone" value="${escapeXml(fromPhone)}"/>`,
  ];
  if (opts.goal) {
    params.push(`<Parameter name="goal" value="${escapeXml(opts.goal)}"/>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '<Connect>',
    `<Stream url="${escapeXml(url)}">`,
    ...params,
    '</Stream>',
    '</Connect>',
    '</Response>',
  ].join('\n');
}

/**
 * Build a time-appropriate greeting.
 */
export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
