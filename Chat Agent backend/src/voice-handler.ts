/**
 * Voice Lambda Handler — separate from the main API Lambda.
 *
 * Handles Twilio voice/SMS webhooks which:
 *  - Have NO JWT auth (use Twilio signature validation)
 *  - Return TwiML (XML), not JSON
 *  - Must respond within 15 seconds (Twilio timeout)
 *
 * Kept lean: no Bedrock Agent SDK imports, no provision logic.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { parseBody } from './auth';
import {
  handleInboundCall,
  handleVoiceRespond,
  handleOutboundTwiml,
  handleOutboundCall,
  handleSmsInbound,
  handleCallStatus,
} from './routes/voice';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const rawPath = event.rawPath.replace(/^\/dev|^\/prod/, '');

  // Parse body — Twilio sends application/x-www-form-urlencoded for webhooks
  let body: Record<string, string> = {};
  if (event.body) {
    const contentType = event.headers['content-type'] ?? '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Parse URL-encoded form data from Twilio
      const params = new URLSearchParams(event.body);
      body = Object.fromEntries(params.entries());
    } else {
      body = parseBody<Record<string, string>>(event.body) ?? {};
    }
  }

  // Determine the base URL for callback URLs in TwiML
  const host = event.headers['host'] ?? '';
  const stage = event.rawPath.startsWith('/dev') ? '/dev' : event.rawPath.startsWith('/prod') ? '/prod' : '';
  const baseUrl = `https://${host}${stage}`;

  const query = (event.queryStringParameters ?? {}) as Record<string, string>;

  console.log(`[Voice Handler] ${method} ${rawPath}`);

  try {
    // Route to handlers
    if (rawPath === '/voice/inbound' && method === 'POST') {
      return handleInboundCall(body, baseUrl);
    }

    if (rawPath === '/voice/respond' && method === 'POST') {
      return handleVoiceRespond(body, baseUrl);
    }

    if (rawPath === '/voice/outbound-twiml' && method === 'GET') {
      return handleOutboundTwiml(query, baseUrl);
    }

    if (rawPath === '/voice/outbound' && method === 'POST') {
      return handleOutboundCall(body as unknown as Record<string, unknown>);
    }

    if (rawPath === '/voice/sms-inbound' && method === 'POST') {
      return handleSmsInbound(body);
    }

    if (rawPath === '/voice/status' && method === 'POST') {
      return handleCallStatus(body);
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Route not found.</Say><Hangup/></Response>',
    };
  } catch (err) {
    console.error('[Voice Handler] Error:', err);
    return {
      statusCode: 200, // Return 200 with TwiML even on error — Twilio expects it
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I\'m sorry, I\'m having technical difficulties. Please call back shortly.</Say><Hangup/></Response>',
    };
  }
};
