import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

describe('ApiService', () => {
  let service: ApiService;
  let authSpy: jasmine.SpyObj<AuthService>;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    authSpy = jasmine.createSpyObj('AuthService', [], { idToken: 'mock-id-token' });

    TestBed.configureTestingModule({
      providers: [
        ApiService,
        { provide: AuthService, useValue: authSpy },
      ],
    });

    service = TestBed.inject(ApiService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── GET ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns success and parsed data on 200', async () => {
      const mockData = { id: '1', name: 'Test' };
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, json: () => Promise.resolve(mockData) } as Response));

      const result = await service.get<typeof mockData>('/test');

      expect(result.success).toBeTrue();
      expect(result.data).toEqual(mockData);
    });

    it('returns error on non-200', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: false, text: () => Promise.resolve('Not Found') } as Response));

      const result = await service.get('/test');

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Not Found');
    });

    it('attaches Authorization header', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));

      await service.get('/test');

      const [, options] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBe('mock-id-token');
    });

    it('appends query params to URL', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response));

      await service.get('/assistants', { assistantId: 'abc123' });

      const [url] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect(url).toContain('assistantId=abc123');
    });

    it('returns error on network failure', async () => {
      fetchSpy.and.returnValue(Promise.reject(new Error('Network error')));

      const result = await service.get('/test');

      expect(result.success).toBeFalse();
      expect(result.error).toContain('Network error');
    });
  });

  // ── POST ────────────────────────────────────────────────────────────────

  describe('post()', () => {
    it('sends POST with serialized body and returns data', async () => {
      const payload = { name: 'Assistant' };
      const response = { id: '1', name: 'Assistant' };
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(response)) } as Response));

      const result = await service.post<typeof response>('/assistants', payload);

      expect(result.success).toBeTrue();
      expect(result.data).toEqual(response);
      const [, options] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual(payload);
    });

    it('returns null data on empty response body', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, text: () => Promise.resolve('') } as Response));

      const result = await service.post('/endpoint');

      expect(result.success).toBeTrue();
      expect(result.data).toBeNull();
    });

    it('returns error on non-200', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: false, text: () => Promise.resolve('Forbidden') } as Response));

      const result = await service.post('/restricted');

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Forbidden');
    });
  });

  // ── PUT ─────────────────────────────────────────────────────────────────

  describe('put()', () => {
    it('sends PUT request with body', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ updated: true })) } as Response));

      const result = await service.put('/test/1', { name: 'Updated' });

      expect(result.success).toBeTrue();
      const [, options] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body as string)).toEqual({ name: 'Updated' });
    });

    it('returns error on non-200', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: false, text: () => Promise.resolve('Not Found') } as Response));

      const result = await service.put('/test/999', {});

      expect(result.success).toBeFalse();
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('sends DELETE request', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: true } as Response));

      const result = await service.delete('/test/1');

      expect(result.success).toBeTrue();
      const [, options] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect(options.method).toBe('DELETE');
    });

    it('returns error on non-200', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: false, text: () => Promise.resolve('Not Found') } as Response));

      const result = await service.delete('/test/999');

      expect(result.success).toBeFalse();
    });
  });

  // ── uploadToS3 ──────────────────────────────────────────────────────────

  describe('uploadToS3()', () => {
    let xhrMock: {
      open: jasmine.Spy;
      setRequestHeader: jasmine.Spy;
      send: jasmine.Spy;
      upload: { onprogress: ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null;
      onerror: (() => void) | null;
      status: number;
    };

    beforeEach(() => {
      xhrMock = {
        open: jasmine.createSpy('open'),
        setRequestHeader: jasmine.createSpy('setRequestHeader'),
        send: jasmine.createSpy('send'),
        upload: { onprogress: null },
        onload: null,
        onerror: null,
        status: 200,
      };
      spyOn(globalThis, 'XMLHttpRequest' as never).and.returnValue(xhrMock as never);
    });

    it('resolves after successful upload', async () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      const progressCalls: number[] = [];

      const uploadPromise = service.uploadToS3('https://s3-presigned-url', file, 'text/plain', (pct) => progressCalls.push(pct));

      // Simulate progress
      xhrMock.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
      // Simulate completion
      xhrMock.status = 200;
      xhrMock.onload?.();

      await uploadPromise;

      expect(xhrMock.open).toHaveBeenCalledWith('PUT', 'https://s3-presigned-url');
      expect(xhrMock.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(progressCalls).toContain(50);
    });

    it('rejects on upload error', async () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      const uploadPromise = service.uploadToS3('https://s3-presigned-url', file, 'text/plain', () => {});

      xhrMock.onerror?.();

      await expectAsync(uploadPromise).toBeRejectedWithError(/network error/i);
    });
  });
});
