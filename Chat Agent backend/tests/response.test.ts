/**
 * Tests for src/response.ts — error sanitisation and CORS header logic.
 *
 * Because ALLOWED_ORIGINS is captured at module-load time from process.env,
 * we use jest.isolateModules() to re-import the module under different env
 * configurations.
 */

// We need the type but actual imports happen inside isolateModules
type ResponseModule = typeof import('../src/response');

describe('response', () => {
  const originalEnv = process.env['ALLOWED_ORIGINS'];

  afterEach(() => {
    // Restore env after each test
    if (originalEnv === undefined) {
      delete process.env['ALLOWED_ORIGINS'];
    } else {
      process.env['ALLOWED_ORIGINS'] = originalEnv;
    }
  });

  // -----------------------------------------------------------------------
  // serverError
  // -----------------------------------------------------------------------
  describe('serverError', () => {
    it('never exposes the internal message in the response body', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const { serverError } = require('../src/response') as ResponseModule;
        const result = serverError('DB connection refused on port 5432');
        const body = JSON.parse((result as { body: string }).body);
        expect(body.error).toBe('Internal server error');
        expect(body).not.toHaveProperty('detail');
        expect(JSON.stringify(body)).not.toContain('DB connection refused');
        expect(JSON.stringify(body)).not.toContain('5432');
      });
    });

    it('includes a correlationId in the response body', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const { serverError } = require('../src/response') as ResponseModule;
        const result = serverError('something broke');
        const body = JSON.parse((result as { body: string }).body);
        expect(body.correlationId).toBeDefined();
        expect(typeof body.correlationId).toBe('string');
        // UUID v4 format
        expect(body.correlationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      });
    });

    it('logs the internal detail to console.error', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { serverError } = require('../src/response') as ResponseModule;
        serverError('secret db password leaked');
        expect(spy).toHaveBeenCalledTimes(1);
        const loggedMsg = spy.mock.calls[0].join(' ');
        expect(loggedMsg).toContain('secret db password leaked');
        spy.mockRestore();
      });
    });

    it('does not log when no internalDetail is provided', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { serverError } = require('../src/response') as ResponseModule;
        serverError();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      });
    });

    it('returns status code 500', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const { serverError } = require('../src/response') as ResponseModule;
        const result = serverError('oops');
        expect((result as { statusCode: number }).statusCode).toBe(500);
      });
    });
  });

  // -----------------------------------------------------------------------
  // corsHeaders
  // -----------------------------------------------------------------------
  describe('corsHeaders', () => {
    it('returns "*" when ALLOWED_ORIGINS is empty', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders();
        expect(h['Access-Control-Allow-Origin']).toBe('*');
      });
    });

    it('returns "*" when ALLOWED_ORIGINS is not set', () => {
      jest.isolateModules(() => {
        process.env['ALLOWED_ORIGINS'] = '';
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders();
        expect(h['Access-Control-Allow-Origin']).toBe('*');
      });
    });

    it('returns matching origin when ALLOWED_ORIGINS matches', () => {
      jest.isolateModules(() => {
        process.env['ALLOWED_ORIGINS'] = 'https://app.example.com,https://admin.example.com';
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders('https://admin.example.com');
        expect(h['Access-Control-Allow-Origin']).toBe('https://admin.example.com');
      });
    });

    it('returns first allowed origin when request origin does not match', () => {
      jest.isolateModules(() => {
        process.env['ALLOWED_ORIGINS'] = 'https://app.example.com,https://admin.example.com';
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders('https://evil.com');
        expect(h['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      });
    });

    it('returns first allowed origin when no request origin is provided', () => {
      jest.isolateModules(() => {
        process.env['ALLOWED_ORIGINS'] = 'https://app.example.com,https://admin.example.com';
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders();
        expect(h['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      });
    });

    it('includes Vary header when ALLOWED_ORIGINS is set', () => {
      jest.isolateModules(() => {
        process.env['ALLOWED_ORIGINS'] = 'https://app.example.com';
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders();
        expect(h['Vary']).toBe('Origin');
      });
    });

    it('does not include Vary header when ALLOWED_ORIGINS is empty', () => {
      jest.isolateModules(() => {
        delete process.env['ALLOWED_ORIGINS'];
        const { corsHeaders } = require('../src/response') as ResponseModule;
        const h = corsHeaders();
        expect(h['Vary']).toBeUndefined();
      });
    });
  });
});
