import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import { ok, badRequest, unauthorized, serverError } from '../response';
import { IRequestContext } from '../auth';
import { findAssistantByApiKey } from './widget-chat';

const TABLE = process.env['METRICS_TABLE'] ?? '';

export async function handleMetrics(
  method: string,
  _path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  _ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  try {
    if (method === 'GET') {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId query param required');

      let items = await ddb.queryItems<Record<string, unknown>>(
        TABLE,
        '#a = :a',
        { ':a': assistantId },
        { '#a': 'assistantId' },
        'assistantId-index'
      );

      // Filter by time period
      const period = query['period'] ?? '30d';
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      items = items.filter(r => (r['createdAt'] as string) >= cutoff);

      // Filter by source if specified (e.g., exclude test data)
      const sourceFilter = query['source']; // 'admin', 'widget', 'test', or undefined (all)
      if (sourceFilter) {
        items = items.filter(r => r['source'] === sourceFilter);
      }

      // Separate test vs production metrics
      const testItems = items.filter(r => r['source'] === 'test');
      const prodItems = items.filter(r => r['source'] !== 'test');

      // Compute aggregated metrics
      const total = items.length;
      const satisfied = items.filter(r => r['satisfied'] === true).length;
      const dissatisfied = items.filter(r => r['satisfied'] === false).length;
      const guardrailHit = items.filter(r => r['guardrailTriggered']).length;
      const videoCited = items.filter(r => r['videoCited']).length;
      const adminSource = items.filter(r => r['source'] === 'admin').length;
      const widgetSource = items.filter(r => r['source'] === 'widget').length;

      // Avg response length
      const responseLengths = items.map(r => Number(r['responseLength'] ?? 0)).filter(n => n > 0);
      const avgResponseLength = responseLengths.length > 0
        ? Math.round(responseLengths.reduce((a, b) => a + b, 0) / responseLengths.length) : 0;

      // Latency stats (median, p90, avg)
      const latencies = items.map(r => Number(r['latencyMs'] ?? 0)).filter(n => n > 0).sort((a, b) => a - b);
      const medianLatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;
      const p90LatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.9)] : 0;
      const avgLatencyMs = latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

      // Escalation count
      const escalated = items.filter(r => r['escalated'] === true).length;

      // Intent breakdown
      const intentCounts: Record<string, number> = {};
      const intentLatencies: Record<string, number[]> = {};
      const intentSatisfied: Record<string, { sat: number; dissat: number }> = {};
      for (const r of items) {
        const intent = (r['intent'] as string) ?? 'help';
        intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
        const lat = Number(r['latencyMs'] ?? 0);
        if (lat > 0) {
          if (!intentLatencies[intent]) intentLatencies[intent] = [];
          intentLatencies[intent].push(lat);
        }
        if (!intentSatisfied[intent]) intentSatisfied[intent] = { sat: 0, dissat: 0 };
        if (r['satisfied'] === true) intentSatisfied[intent].sat++;
        if (r['satisfied'] === false) intentSatisfied[intent].dissat++;
      }

      const intentMetrics = Object.entries(intentCounts).map(([intent, count]) => {
        const lats = (intentLatencies[intent] ?? []).sort((a, b) => a - b);
        const medianMs = lats.length > 0 ? lats[Math.floor(lats.length / 2)] : 0;
        const { sat, dissat } = intentSatisfied[intent] ?? { sat: 0, dissat: 0 };
        const rated = sat + dissat;
        return {
          intent,
          count,
          pct: total > 0 ? Math.round((count / total) * 100) : 0,
          medianLatencyMs: medianMs,
          needMetRate: rated > 0 ? Math.round((sat / rated) * 100) : null,
        };
      }).sort((a, b) => b.count - a.count);

      // Unique sessions
      const sessions = new Set(items.map(r => r['sessionId']).filter(Boolean));

      // Daily trend
      const dailyCounts: Record<string, number> = {};
      for (const r of items) {
        const day = (r['createdAt'] as string)?.slice(0, 10);
        if (day) dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
      }
      const dailyTrend = Object.entries(dailyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      // Recent conversations (last 20)
      const sorted = [...items].sort((a, b) =>
        ((b['createdAt'] as string) ?? '').localeCompare((a['createdAt'] as string) ?? ''));
      const recent = sorted.slice(0, 20).map(r => ({
        id: r['id'],
        query: r['query'] ?? '',
        createdAt: r['createdAt'],
        satisfied: r['satisfied'],
        source: r['source'] ?? 'admin',
        responseLength: r['responseLength'] ?? 0,
        videoCited: r['videoCited'] ?? false,
        routedAgent: r['routedAgent'] ?? null,
      }));

      // Test performance stats (separate from production)
      const testLatencies = testItems.map(r => Number(r['latencyMs'] ?? 0)).filter(n => n > 0).sort((a, b) => a - b);
      const testMedianMs = testLatencies.length > 0 ? testLatencies[Math.floor(testLatencies.length / 2)] : 0;
      const testP90Ms = testLatencies.length > 0 ? testLatencies[Math.floor(testLatencies.length * 0.9)] : 0;
      const testAvgScore = testItems.reduce((sum, r) => sum + Number(r['aiScore'] ?? 0), 0) / (testItems.length || 1);

      const testSummary = testItems.length > 0 ? {
        total: testItems.length,
        medianLatencyMs: testMedianMs,
        p90LatencyMs: testP90Ms,
        avgAiScore: Math.round(testAvgScore),
      } : null;

      return ok({
        summary: {
          total, satisfied, dissatisfied,
          unrated: total - satisfied - dissatisfied,
          guardrailHit, videoCited, escalated,
          adminSource, widgetSource,
          uniqueSessions: sessions.size,
          avgResponseLength,
          medianLatencyMs, p90LatencyMs, avgLatencyMs,
          hasLatencyData: latencies.length > 0,
          period, days,
        },
        dailyTrend,
        intentMetrics,
        testSummary,
        recent,
      });
    }

    // PUT /metrics/:id — update satisfaction feedback
    if (method === 'PUT') {
      const metricId = params['id'];
      if (!metricId) return badRequest('metric id required');
      if (typeof body['satisfied'] !== 'boolean') return badRequest('satisfied (boolean) required');
      await ddb.updateItem(TABLE, { id: metricId }, { satisfied: body['satisfied'] });
      return ok({ success: true });
    }

    return ok([]);
  } catch (e) {
    console.error('metrics handler error', e);
    return serverError(String(e));
  }
}

/**
 * POST /widget/feedback — public endpoint for widget thumbs up/down.
 * Authenticates via x-api-key header.
 * Body: { metricId, satisfied }
 */
export async function handleWidgetFeedback(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');

    const metricId = body['metricId'] as string;
    if (!metricId) return badRequest('metricId required');
    if (typeof body['satisfied'] !== 'boolean') return badRequest('satisfied (boolean) required');

    await ddb.updateItem(TABLE, { id: metricId }, { satisfied: body['satisfied'] });
    return ok({ success: true });
  } catch (e) {
    console.error('widget feedback error', e);
    return serverError(String(e));
  }
}
