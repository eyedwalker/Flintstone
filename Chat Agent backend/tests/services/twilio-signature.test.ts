import { createHmac } from 'crypto';
import {
  validateTwilioSignature,
  reconstructWebhookUrl,
  getSignatureHeader,
  isValidationDisabled,
} from '../../src/services/twilio-signature';

/**
 * Build a valid signature the same way Twilio does, for use in tests.
 */
function signTwilio(url: string, body: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(body).sort();
  const data = url + sortedKeys.map((k) => k + body[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

describe('twilio-signature', () => {
  const ORIGINAL_DISABLED = process.env['TWILIO_SIGNATURE_VALIDATION'];
  const ORIGINAL_BASE = process.env['TWILIO_WEBHOOK_BASE_URL'];

  beforeEach(() => {
    delete process.env['TWILIO_SIGNATURE_VALIDATION'];
    delete process.env['TWILIO_WEBHOOK_BASE_URL'];
  });

  afterAll(() => {
    if (ORIGINAL_DISABLED === undefined) delete process.env['TWILIO_SIGNATURE_VALIDATION'];
    else process.env['TWILIO_SIGNATURE_VALIDATION'] = ORIGINAL_DISABLED;
    if (ORIGINAL_BASE === undefined) delete process.env['TWILIO_WEBHOOK_BASE_URL'];
    else process.env['TWILIO_WEBHOOK_BASE_URL'] = ORIGINAL_BASE;
  });

  describe('validateTwilioSignature', () => {
    const url = 'https://example.com/voice/inbound';
    const body = { From: '+15551234567', To: '+15806336937', CallSid: 'CA1' };
    const authToken = 'super-secret-token';

    it('returns true for a correctly signed request', () => {
      const signature = signTwilio(url, body, authToken);
      expect(validateTwilioSignature({ signatureHeader: signature, url, body, authToken })).toBe(true);
    });

    it('returns false for an altered body', () => {
      const signature = signTwilio(url, body, authToken);
      const tampered = { ...body, From: '+15559999999' };
      expect(validateTwilioSignature({ signatureHeader: signature, url, body: tampered, authToken })).toBe(false);
    });

    it('returns false for an altered URL', () => {
      const signature = signTwilio(url, body, authToken);
      expect(validateTwilioSignature({
        signatureHeader: signature, url: 'https://example.com/different', body, authToken,
      })).toBe(false);
    });

    it('returns false for the wrong auth token', () => {
      const signature = signTwilio(url, body, authToken);
      expect(validateTwilioSignature({ signatureHeader: signature, url, body, authToken: 'wrong' })).toBe(false);
    });

    it('returns false when signature header is missing', () => {
      expect(validateTwilioSignature({ signatureHeader: undefined, url, body, authToken })).toBe(false);
    });

    it('returns false when auth token is empty', () => {
      const signature = signTwilio(url, body, authToken);
      expect(validateTwilioSignature({ signatureHeader: signature, url, body, authToken: '' })).toBe(false);
    });

    it('bypasses validation entirely when TWILIO_SIGNATURE_VALIDATION=disabled', () => {
      process.env['TWILIO_SIGNATURE_VALIDATION'] = 'disabled';
      expect(validateTwilioSignature({ signatureHeader: 'anything', url, body, authToken: 'wrong' })).toBe(true);
    });

    it('handles GET requests with empty body', () => {
      const getUrl = 'https://example.com/voice/outbound-twiml?message=hi';
      const signature = signTwilio(getUrl, {}, authToken);
      expect(validateTwilioSignature({ signatureHeader: signature, url: getUrl, body: {}, authToken })).toBe(true);
    });

    it('sorts body keys before signing (independent of insertion order)', () => {
      const a = { Z: '1', A: '2', M: '3' };
      const b = { A: '2', M: '3', Z: '1' };
      const sigA = signTwilio(url, a, authToken);
      const sigB = signTwilio(url, b, authToken);
      expect(sigA).toBe(sigB);
      expect(validateTwilioSignature({ signatureHeader: sigA, url, body: b, authToken })).toBe(true);
    });
  });

  describe('reconstructWebhookUrl', () => {
    it('uses TWILIO_WEBHOOK_BASE_URL when set', () => {
      process.env['TWILIO_WEBHOOK_BASE_URL'] = 'https://api.example.com/prod';
      const url = reconstructWebhookUrl({ host: 'ignored', rawPath: '/voice/inbound' });
      expect(url).toBe('https://api.example.com/prod/voice/inbound');
    });

    it('trims a trailing slash from the env base', () => {
      process.env['TWILIO_WEBHOOK_BASE_URL'] = 'https://api.example.com/prod/';
      const url = reconstructWebhookUrl({ host: 'ignored', rawPath: '/voice/inbound' });
      expect(url).toBe('https://api.example.com/prod/voice/inbound');
    });

    it('falls back to host + stage + rawPath when env not set', () => {
      const url = reconstructWebhookUrl({ host: 'abc.amazonaws.com', stage: '/prod', rawPath: '/voice/inbound' });
      expect(url).toBe('https://abc.amazonaws.com/prod/voice/inbound');
    });

    it('appends query string when present', () => {
      const url = reconstructWebhookUrl({ host: 'h', rawPath: '/voice/outbound-twiml', rawQueryString: 'message=hi' });
      expect(url).toBe('https://h/voice/outbound-twiml?message=hi');
    });
  });

  describe('getSignatureHeader', () => {
    it('reads the lowercased header', () => {
      expect(getSignatureHeader({ 'x-twilio-signature': 'sig1' })).toBe('sig1');
    });

    it('reads the title-cased header', () => {
      expect(getSignatureHeader({ 'X-Twilio-Signature': 'sig2' } as Record<string, string | undefined>)).toBe('sig2');
    });

    it('returns undefined when header missing', () => {
      expect(getSignatureHeader({})).toBeUndefined();
    });
  });

  describe('isValidationDisabled', () => {
    it('returns true when env=disabled', () => {
      process.env['TWILIO_SIGNATURE_VALIDATION'] = 'disabled';
      expect(isValidationDisabled()).toBe(true);
    });

    it('returns false otherwise', () => {
      expect(isValidationDisabled()).toBe(false);
      process.env['TWILIO_SIGNATURE_VALIDATION'] = 'enabled';
      expect(isValidationDisabled()).toBe(false);
    });
  });
});
