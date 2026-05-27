/**
 * CloudWatch EMF emitter for the bridge.
 *
 * Same format as the backend's emitter (intentional duplicate so neither
 * project depends on the other). EMF is a structured JSON log line that
 * CloudWatch parses into metrics automatically.
 *
 * See: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
 */

export type Unit = 'Count' | 'Milliseconds' | 'Seconds' | 'Bytes' | 'None' | 'Percent';

export interface IEmitOptions {
  namespace: string;
  dimensions?: Record<string, string>;
  values: Record<string, number>;
  units?: Partial<Record<string, Unit>>;
  timestamp?: number;
}

export function emit(opts: IEmitOptions): void {
  const { namespace, dimensions = {}, values, units = {}, timestamp } = opts;
  if (!namespace) return;
  const metricEntries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  if (metricEntries.length === 0) return;

  const dimensionKeys = Object.keys(dimensions);
  const dimensionSets: string[][] = [[], ...dimensionKeys.map((k) => [k])];
  if (dimensionKeys.length > 1) dimensionSets.push(dimensionKeys);

  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: timestamp ?? Date.now(),
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: dimensionSets,
        Metrics: metricEntries.map(([name]) => ({ Name: name, Unit: units[name] ?? 'Count' })),
      }],
    },
    ...dimensions,
    ...Object.fromEntries(metricEntries),
  };

  console.log(JSON.stringify(payload));
}
