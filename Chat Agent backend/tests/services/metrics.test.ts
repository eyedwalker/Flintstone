import { emit, timer } from '../../src/services/metrics';

describe('metrics EMF emitter', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function lastEmitted(): Record<string, unknown> {
    expect(logSpy).toHaveBeenCalled();
    return JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
  }

  it('emits a single JSON line with _aws envelope', () => {
    emit({
      namespace: 'VoiceBackend',
      dimensions: { TenantId: 't1' },
      values: { CallAnalyzed: 1 },
    });
    const payload = lastEmitted();
    expect(payload['_aws']).toBeDefined();
    const aws = payload['_aws'] as Record<string, unknown>;
    expect(typeof aws['Timestamp']).toBe('number');
    const cw = (aws['CloudWatchMetrics'] as unknown[])[0] as Record<string, unknown>;
    expect(cw['Namespace']).toBe('VoiceBackend');
  });

  it('exposes each dimension at top level alongside metric values', () => {
    emit({
      namespace: 'VoiceBackend',
      dimensions: { TenantId: 't1', Direction: 'inbound' },
      values: { CallAnalyzed: 1, AnalyzeLatencyMs: 1234 },
      units: { AnalyzeLatencyMs: 'Milliseconds' },
    });
    const payload = lastEmitted();
    expect(payload['TenantId']).toBe('t1');
    expect(payload['Direction']).toBe('inbound');
    expect(payload['CallAnalyzed']).toBe(1);
    expect(payload['AnalyzeLatencyMs']).toBe(1234);
  });

  it('declares a dimension set per key plus a namespace-wide aggregate plus the combined set', () => {
    emit({
      namespace: 'VoiceBackend',
      dimensions: { TenantId: 't1', Direction: 'inbound' },
      values: { CallAnalyzed: 1 },
    });
    const aws = lastEmitted()['_aws'] as Record<string, unknown>;
    const cw = (aws['CloudWatchMetrics'] as Array<{ Dimensions: string[][] }>)[0]!;
    // Expect at least: [], [TenantId], [Direction], [TenantId, Direction]
    expect(cw.Dimensions).toContainEqual([]);
    expect(cw.Dimensions).toContainEqual(['TenantId']);
    expect(cw.Dimensions).toContainEqual(['Direction']);
    expect(cw.Dimensions).toContainEqual(['TenantId', 'Direction']);
  });

  it('applies per-metric units; defaults to "Count" otherwise', () => {
    emit({
      namespace: 'V',
      values: { A: 1, B: 50 },
      units: { B: 'Milliseconds' },
    });
    const cw = (lastEmitted()['_aws'] as Record<string, unknown>)['CloudWatchMetrics'] as Array<{ Metrics: Array<{ Name: string; Unit: string }> }>;
    const metrics = cw[0]!.Metrics;
    expect(metrics.find((m) => m.Name === 'A')?.Unit).toBe('Count');
    expect(metrics.find((m) => m.Name === 'B')?.Unit).toBe('Milliseconds');
  });

  it('drops non-finite values silently', () => {
    emit({ namespace: 'V', values: { A: NaN, B: Infinity, C: 3 } });
    const payload = lastEmitted();
    expect(payload['A']).toBeUndefined();
    expect(payload['B']).toBeUndefined();
    expect(payload['C']).toBe(3);
  });

  it('skips emission entirely when no finite values remain', () => {
    emit({ namespace: 'V', values: { A: NaN } });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('skips emission when namespace is empty', () => {
    emit({ namespace: '', values: { A: 1 } });
    expect(logSpy).not.toHaveBeenCalled();
  });

  describe('timer', () => {
    it('emits a *LatencyMs metric with elapsed time when invoked', async () => {
      const done = timer({ namespace: 'V', metricName: 'OpLatencyMs', dimensions: { Op: 'x' } });
      await new Promise((res) => setTimeout(res, 15));
      done();
      const payload = lastEmitted();
      const latency = payload['OpLatencyMs'] as number;
      expect(latency).toBeGreaterThanOrEqual(10);
      expect(payload['Op']).toBe('x');
    });

    it('merges extraValues into the emission', () => {
      const done = timer({ namespace: 'V', metricName: 'OpLatencyMs', extraValues: { OpCount: 1 } });
      done();
      const payload = lastEmitted();
      expect(payload['OpCount']).toBe(1);
      expect(typeof payload['OpLatencyMs']).toBe('number');
    });
  });
});
