import {
  buildGreetingTwiml,
  buildGatherTwiml,
  buildTransferTwiml,
  buildHangupTwiml,
  buildStreamTwiml,
  getTimeGreeting,
} from '../../src/services/voice-twiml';

const CALLBACK = 'https://example.com/voice/respond';

describe('voice-twiml builders', () => {
  describe('buildGreetingTwiml', () => {
    const twiml = buildGreetingTwiml('Hello', CALLBACK);

    it('starts with XML declaration and Response root', () => {
      expect(twiml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<Response>/);
    });

    it('places <Say> inside <Gather> for barge-in', () => {
      // The greeting Say must appear between <Gather ...> and </Gather>
      const gatherBlock = twiml.match(/<Gather[^>]*>([\s\S]*?)<\/Gather>/);
      expect(gatherBlock).not.toBeNull();
      expect(gatherBlock![1]).toContain('<Say');
      expect(gatherBlock![1]).toContain('Hello');
    });

    it('uses Polly.Joanna-Neural by default', () => {
      expect(twiml).toContain('voice="Polly.Joanna-Neural"');
    });

    it('applies prosody rate from config', () => {
      expect(twiml).toContain('<prosody rate="110%">');
    });

    it('enables enhanced recognition', () => {
      expect(twiml).toContain('enhanced="true"');
    });

    it('disables profanityFilter so medical terms come through', () => {
      expect(twiml).toContain('profanityFilter="false"');
    });

    it('XML-escapes the callback URL', () => {
      const t = buildGreetingTwiml('Hi', 'https://example.com/cb?x=1&y=2');
      expect(t).toContain('https://example.com/cb?x=1&amp;y=2');
      expect(t).not.toContain('x=1&y=2');
    });

    it('XML-escapes message content', () => {
      const t = buildGreetingTwiml('Tom & Jerry "fun" <here>', CALLBACK);
      expect(t).toContain('Tom &amp; Jerry &quot;fun&quot; &lt;here&gt;');
      expect(t).not.toContain('Tom & Jerry');
    });

    it('falls back to hangup if Gather times out (no input)', () => {
      // After the Gather block there must be a Say and Hangup as the silence fallback.
      // Apostrophe in "didn't" gets XML-escaped to &apos;.
      expect(twiml).toMatch(/<\/Gather>[\s\S]*<Say[\s\S]*didn&apos;t hear[\s\S]*<Hangup\/>/);
    });

    it('passes optional hints to the Gather', () => {
      const t = buildGreetingTwiml('Hi', CALLBACK, { hints: 'appointment, prescription, refill' });
      expect(t).toContain('hints="appointment, prescription, refill"');
    });

    it('omits hints attribute when not configured', () => {
      expect(twiml).not.toContain('hints=');
    });

    it('XML-escapes hints content', () => {
      const t = buildGreetingTwiml('Hi', CALLBACK, { hints: 'Tom & Jerry' });
      expect(t).toContain('hints="Tom &amp; Jerry"');
    });

    it('accepts a custom voice', () => {
      const t = buildGreetingTwiml('Hi', CALLBACK, { voiceName: 'Polly.Matthew-Neural' });
      expect(t).toContain('voice="Polly.Matthew-Neural"');
      expect(t).not.toContain('Polly.Joanna-Neural');
    });
  });

  describe('buildGatherTwiml', () => {
    const twiml = buildGatherTwiml('Sure, let me check that', CALLBACK);

    it('accepts both speech and DTMF in the primary Gather', () => {
      expect(twiml).toMatch(/<Gather input="speech dtmf"/);
    });

    it('uses a longer timeout for conversation turns than greeting', () => {
      // Default is 5 + 2 = 7 seconds on the primary gather
      expect(twiml).toMatch(/<Gather input="speech dtmf" timeout="7"/);
    });

    it('places the response message inside the first Gather (barge-in)', () => {
      const firstGather = twiml.match(/<Gather input="speech dtmf"[^>]*>([\s\S]*?)<\/Gather>/);
      expect(firstGather).not.toBeNull();
      expect(firstGather![1]).toContain('Sure, let me check that');
    });

    it('falls through to a second prompt then hangup', () => {
      const gathers = twiml.match(/<\/Gather>/g);
      expect(gathers?.length).toBe(2);
      expect(twiml).toContain('Are you still there');
      expect(twiml).toMatch(/<Hangup\/>/);
    });

    it('XML-escapes message content', () => {
      const t = buildGatherTwiml('Patient \'Smith\' said "hi"', CALLBACK);
      expect(t).toContain('Patient &apos;Smith&apos; said &quot;hi&quot;');
    });
  });

  describe('buildTransferTwiml', () => {
    const twiml = buildTransferTwiml('Connecting now', '+15551234567');

    it('uses Dial with the office number', () => {
      expect(twiml).toContain('<Dial timeout="30">');
      expect(twiml).toContain('<Number>+15551234567</Number>');
    });

    it('records voicemail when transfer fails', () => {
      // <Record> shape changed when we wired voicemail callbacks: no more
      // deprecated transcribe="true"; recordingStatusCallback is added when
      // an opts.voicemailCallbackUrl is passed.
      expect(twiml).toMatch(/<Record [^>]*maxLength="120"[^>]*playBeep="true"[^>]*\/>/);
      expect(twiml).not.toContain('transcribe="true"');
    });

    it('adds recordingStatusCallback when voicemailCallbackUrl is provided', () => {
      const t = buildTransferTwiml('Connecting', '+15551234567', {
        voicemailCallbackUrl: 'https://example.com/voice/recording-status?type=voicemail',
      });
      expect(t).toContain('recordingStatusCallback="https://example.com/voice/recording-status?type=voicemail"');
      expect(t).toContain('recordingStatusCallbackEvent="completed"');
    });

    it('omits recordingStatusCallback when no voicemail URL is configured', () => {
      const t = buildTransferTwiml('Connecting', '+15551234567');
      expect(t).not.toContain('recordingStatusCallback');
    });

    it('plays the transfer intro message before dialing', () => {
      expect(twiml).toMatch(/<Say[\s\S]*Connecting now[\s\S]*<\/Say>[\s\S]*<Dial/);
    });

    it('XML-escapes the office phone (defensive against weird formats)', () => {
      const t = buildTransferTwiml('Hi', '+1 (555) 123<>4567');
      expect(t).toContain('+1 (555) 123&lt;&gt;4567');
    });

    it('hangs up after the voicemail thank-you', () => {
      expect(twiml).toMatch(/Thank you for your message[\s\S]*<Hangup\/>/);
    });
  });

  describe('buildHangupTwiml', () => {
    const twiml = buildHangupTwiml('Goodbye!');

    it('says the message then hangs up immediately', () => {
      expect(twiml).toMatch(/<Say[\s\S]*Goodbye![\s\S]*<\/Say>\s*<Hangup\/>/);
    });

    it('has no Gather or Dial', () => {
      expect(twiml).not.toContain('<Gather');
      expect(twiml).not.toContain('<Dial');
    });

    it('XML-escapes the message', () => {
      const t = buildHangupTwiml('Bye & farewell');
      expect(t).toContain('Bye &amp; farewell');
    });
  });

  describe('buildStreamTwiml', () => {
    const twiml = buildStreamTwiml('wss://nova-sonic.example.com/stream', 'tenant-1', '+15551234567');

    it('uses Connect+Stream (not Say/Gather)', () => {
      expect(twiml).toContain('<Connect>');
      expect(twiml).toContain('<Stream');
      expect(twiml).not.toContain('<Say');
      expect(twiml).not.toContain('<Gather');
    });

    it('appends tenantId as a query parameter', () => {
      // tenantId is always present; direction may also be appended.
      expect(twiml).toMatch(/url="wss:\/\/nova-sonic\.example\.com\/stream\?tenantId=tenant-1(?:&[^"]*)?"/);
    });

    it('passes fromPhone as a Parameter element', () => {
      expect(twiml).toContain('<Parameter name="fromPhone" value="+15551234567"/>');
    });

    it('URL-encodes tenantId values with special chars', () => {
      const t = buildStreamTwiml('wss://example/stream', 'tenant with spaces', '+15551234567');
      expect(t).toContain('tenantId=tenant%20with%20spaces');
    });

    it('XML-escapes the fromPhone in case of unexpected characters', () => {
      const t = buildStreamTwiml('wss://example/stream', 'tenant-1', '+15551234<>567');
      expect(t).toContain('+15551234&lt;&gt;567');
    });

    it('defaults direction to inbound when no opts are passed', () => {
      const t = buildStreamTwiml('wss://x/stream', 't', '+15551234567');
      expect(t).toContain('direction=inbound');
    });

    it('includes direction=outbound and a goal parameter when set', () => {
      const t = buildStreamTwiml('wss://x/stream', 't', '+15551234567', {
        direction: 'outbound',
        goal: 'Confirm Tuesday 2pm appointment',
      });
      expect(t).toContain('direction=outbound');
      expect(t).toContain('<Parameter name="goal" value="Confirm Tuesday 2pm appointment"/>');
    });

    it('omits the goal parameter when undefined', () => {
      const t = buildStreamTwiml('wss://x/stream', 't', '+1', { direction: 'outbound' });
      expect(t).not.toContain('name="goal"');
    });

    it('XML-escapes goal text', () => {
      const t = buildStreamTwiml('wss://x/stream', 't', '+1', { goal: 'A & B "complete"' });
      expect(t).toContain('A &amp; B &quot;complete&quot;');
    });
  });

  describe('getTimeGreeting', () => {
    let dateSpy: jest.SpyInstance;
    afterEach(() => dateSpy?.mockRestore());

    function freezeHour(hour: number) {
      const fixed = new Date(2026, 0, 1, hour, 0, 0);
      dateSpy = jest.spyOn(global, 'Date').mockImplementation(() => fixed as unknown as Date);
    }

    it('returns morning before noon', () => {
      freezeHour(8);
      expect(getTimeGreeting()).toBe('Good morning');
    });

    it('returns afternoon at noon through 4:59pm', () => {
      freezeHour(12);
      expect(getTimeGreeting()).toBe('Good afternoon');
      dateSpy.mockRestore();
      freezeHour(16);
      expect(getTimeGreeting()).toBe('Good afternoon');
    });

    it('returns evening from 5pm onward', () => {
      freezeHour(17);
      expect(getTimeGreeting()).toBe('Good evening');
      dateSpy.mockRestore();
      freezeHour(23);
      expect(getTimeGreeting()).toBe('Good evening');
    });
  });
});
