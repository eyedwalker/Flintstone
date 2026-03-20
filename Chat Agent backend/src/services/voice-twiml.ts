/**
 * TwiML Builder — generates Twilio Markup Language XML responses.
 *
 * All voice interactions return TwiML that tells Twilio what to do:
 *   <Say> — speak text using Polly Neural voices
 *   <Play> — play audio from a URL (for ElevenLabs TTS)
 *   <Gather> — capture speech/DTMF input, POST to callback URL
 *   <Dial> — transfer to another number
 *   <Hangup> — end the call
 */

export interface IVoiceConfig {
  voiceName: string;       // Polly voice: 'Polly.Joanna-Neural', 'Polly.Matthew-Neural', etc.
  speechRate: string;      // Prosody rate: '100%', '110%', '115%'
  gatherTimeout: number;   // Seconds to wait for speech (default 5)
  speechTimeout: string;   // 'auto' or seconds
  language: string;        // 'en-US'
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

function buildSayTag(message: string, config: IVoiceConfig = DEFAULT_CONFIG): string {
  const escaped = escapeXml(message);
  return `<Say voice="${config.voiceName}"><prosody rate="${config.speechRate}">${escaped}</prosody></Say>`;
}

/**
 * Build the initial greeting TwiML for an inbound call.
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
    buildSayTag(greeting, cfg),
    `<Gather input="speech" timeout="${cfg.gatherTimeout}" action="${escapeXml(callbackUrl)}" method="POST" speechTimeout="${cfg.speechTimeout}" language="${cfg.language}">`,
    '</Gather>',
    buildSayTag('I didn\'t hear anything. If you need help, please call back anytime. Goodbye!', cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML for a conversation turn — speak the response, then gather next input.
 */
export function buildGatherTwiml(
  message: string,
  callbackUrl: string,
  config: Partial<IVoiceConfig> = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildSayTag(message, cfg),
    `<Gather input="speech dtmf" timeout="${cfg.gatherTimeout + 2}" action="${escapeXml(callbackUrl)}" method="POST" speechTimeout="${cfg.speechTimeout}" language="${cfg.language}">`,
    '</Gather>',
    buildSayTag('Are you still there? I\'ll wait a moment.', cfg),
    `<Gather input="speech" timeout="5" action="${escapeXml(callbackUrl)}" method="POST" speechTimeout="${cfg.speechTimeout}" language="${cfg.language}">`,
    '</Gather>',
    buildSayTag('It seems like you may have gone. Feel free to call back anytime. Goodbye!', cfg),
    '<Hangup/>',
    '</Response>',
  ].join('\n');
}

/**
 * Build TwiML to transfer the call to a human.
 */
export function buildTransferTwiml(
  message: string,
  officePhone: string,
  config: Partial<IVoiceConfig> = {},
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    buildSayTag(message, cfg),
    `<Dial timeout="30">`,
    `<Number>${escapeXml(officePhone)}</Number>`,
    '</Dial>',
    buildSayTag('I\'m sorry, no one is available right now. Please leave a message after the beep and we\'ll call you back.', cfg),
    '<Record maxLength="120" transcribe="true" playBeep="true"/>',
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
 * Build a time-appropriate greeting.
 */
export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
