/**
 * CloudWatch Embedded Metric Format (EMF) emitter.
 *
 * EMF is a structured JSON log format that CloudWatch parses into metrics
 * automatically — no PutMetricData API call, no extra latency, no IAM
 * permission beyond what Lambda already has for log writes.
 *
 * See: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
 *
 * Use it like:
 *
 *   metrics.emit({
 *     namespace: 'VoiceBackend',
 *     dimensions: { TenantId: 'tenant-1', Direction: 'inbound' },
 *     values: { CallAnalyzed: 1, AnalyzeLatencyMs: 1840 },
 *     units: { AnalyzeLatencyMs: 'Milliseconds' },
 *   });
 *
 * Each dimension key shows up as a separate dimension set so CloudWatch can
 * roll up metrics by individual dimensions and combinations.
 */

export type Unit =
  | 'Count' | 'Milliseconds' | 'Seconds' | 'Bytes' | 'None' | 'Percent';

export interface IEmitOptions {
  namespace: string;
  dimensions?: Record<string, string>;
  values: Record<string, number>;
  /** Per-metric units. Defaults to "Count" for any metric not listed. */
  units?: Partial<Record<string, Unit>>;
  /** Optional millisecond timestamp; defaults to now. */
  timestamp?: number;
}

/**
 * Emit an EMF metric. Writes a single JSON line to stdout via console.log.
 * Safe under high frequency — never throws on bad inputs (clamps + skips).
 */
export function emit(opts: IEmitOptions): void {
  const { namespace, dimensions = {}, values, units = {}, timestamp } = opts;

  if (!namespace) return;
  const metricEntries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  if (metricEntries.length === 0) return;

  const dimensionKeys = Object.keys(dimensions);
  // Emit every combination of one dimension at a time so CloudWatch builds
  // an aggregate per dimension. Empty array is also emitted for the
  // namespace-wide aggregate.
  const dimensionSets: string[][] = [[], ...dimensionKeys.map((k) => [k])];
  if (dimensionKeys.length > 1) dimensionSets.push(dimensionKeys);

  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: timestamp ?? Date.now(),
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: dimensionSets,
        Metrics: metricEntries.map(([name]) => ({
          Name: name,
          Unit: units[name] ?? 'Count',
        })),
      }],
    },
    ...dimensions,
    ...Object.fromEntries(metricEntries),
  };

  console.log(JSON.stringify(payload));
}

/**
 * Helper for the common "start a timer, emit when done" pattern.
 * Returns a function that, when called, emits a *LatencyMs metric with the
 * elapsed time since the start call.
 *
 *   const done = metrics.timer({ namespace: 'VoiceBackend', dimensions, metricName: 'AnalyzeLatencyMs' });
 *   await doStuff();
 *   done(); // emits the latency
 */
export function timer(opts: {
  namespace: string;
  dimensions?: Record<string, string>;
  metricName: string;
  /** Extra metrics to include in the same emission. */
  extraValues?: Record<string, number>;
}): () => void {
  const start = Date.now();
  return () => {
    emit({
      namespace: opts.namespace,
      dimensions: opts.dimensions,
      values: { [opts.metricName]: Date.now() - start, ...(opts.extraValues ?? {}) },
      units: { [opts.metricName]: 'Milliseconds' },
    });
  };
}
