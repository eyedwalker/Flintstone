import { decodeEventBody } from '../src/auth';

describe('decodeEventBody', () => {
  it('returns the raw body when not base64-encoded', () => {
    expect(decodeEventBody({ body: 'From=%2B15551234567&To=%2B15806336937' }))
      .toBe('From=%2B15551234567&To=%2B15806336937');
  });

  it('base64-decodes when isBase64Encoded is true', () => {
    const raw = 'From=%2B15551234567&To=%2B15806336937&CallSid=CAabc';
    const encoded = Buffer.from(raw, 'utf-8').toString('base64');
    expect(decodeEventBody({ body: encoded, isBase64Encoded: true })).toBe(raw);
  });

  it('returns empty string when body is missing', () => {
    expect(decodeEventBody({})).toBe('');
    expect(decodeEventBody({ body: null as unknown as string })).toBe('');
    expect(decodeEventBody({ body: undefined })).toBe('');
  });

  it('falls back to raw body if base64 decoding throws', () => {
    // Not actually possible with Node's Buffer.from but the catch-block exists for safety
    const result = decodeEventBody({ body: 'not-valid-base64!!!', isBase64Encoded: true });
    // Buffer.from is lenient — it returns SOMETHING even for invalid base64. Just confirm no throw.
    expect(typeof result).toBe('string');
  });

  it('round-trips a Twilio-shaped webhook body', () => {
    // Shape mirrors a real Twilio webhook (AccountSid is a placeholder; the
    // real value should never live in source code — GitHub push protection
    // catches it).
    const realBody = 'AccountSid=AC00000000000000000000000000000000&ApiVersion=2010-04-01&CallSid=CA1234567890abcdef&CallStatus=ringing&Called=%2B15806336937&CalledCity=&CalledCountry=US&CalledState=OK&CalledZip=&Caller=%2B15551234567&CallerCity=AUSTIN&CallerCountry=US&CallerState=TX&CallerZip=&Direction=inbound&From=%2B15551234567&FromCity=AUSTIN&FromCountry=US&FromState=TX&FromZip=&To=%2B15806336937&ToCity=&ToCountry=US&ToState=OK&ToZip=';
    const encoded = Buffer.from(realBody, 'utf-8').toString('base64');
    const decoded = decodeEventBody({ body: encoded, isBase64Encoded: true });
    const params = new URLSearchParams(decoded);
    expect(params.get('From')).toBe('+15551234567');
    expect(params.get('To')).toBe('+15806336937');
    expect(params.get('CallSid')).toBe('CA1234567890abcdef');
    expect(params.get('CallStatus')).toBe('ringing');
  });
});
