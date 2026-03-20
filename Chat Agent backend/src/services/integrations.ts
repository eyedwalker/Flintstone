/**
 * External integration wrappers for the Front Office agent.
 *
 * Eyefinity EPM v2 API + Schedule Manager API.
 * OAuth credentials stored in tenant DynamoDB record.
 * OAuth flow: CC token (full scopes) → Token Exchange (no scope param) → EPM Bearer token.
 *
 * Reference: https://alsandapi1.eyefinity.com/al-pe/swagger/ui/index.html
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import * as ddb from './dynamo';

const REGION = process.env['REGION'] ?? 'us-west-2';
const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? '';
const ses = new SESClient({ region: REGION });
const ssm = new SSMClient({ region: REGION });

// ── Eyefinity OAuth Constants ─────────────────────────────────────────────────

/** Full scopes for CC token — grants access to all EPM resources */
const EPM_SCOPES = [
  'auth_epm',
  'ef.pm_pe_patient_rx', 'ef.pm_pe_resource', 'ef.pm_pe_insurance',
  'ef.pm_pe_appointment', 'ef.pm_pe_office_recallreport', 'ef.pm_pe_staff',
  'ef.pm_pe_office', 'ef.pm_pe_company', 'ef.pm_pe_order',
  'ef.pm_pe_provider', 'ef.pm_pe_patient', 'read:ef.pm_schedule',
].join(' ');

// ── Token Cache (in-memory, per tenant) ───────────────────────────────────────

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// ── Tenant Config Cache ───────────────────────────────────────────────────────

interface IEyefinityConfig {
  clientId: string;
  clientSecret: string;
  tenantUid: string;
  oauthHost: string;
  apiBaseUrl: string;
  apiPath: string;
  scheduleManagerPath: string;
}

const configCache = new Map<string, { config: IEyefinityConfig; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function getEyefinityConfig(tenantId: string): Promise<IEyefinityConfig> {
  const cached = configCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.config;

  const tenant = await ddb.getItem<{
    eyefinityApiKey?: string;
    eyefinityApiSecret?: string;
    eyefinityTenantUid?: string;
    eyefinityOauthHost?: string;
    eyefinityApiBaseUrl?: string;
    eyefinityApiPath?: string;
  }>(TENANTS_TABLE, { id: tenantId });

  const oauthHost = tenant?.eyefinityOauthHost ?? 'api-sandbox.eyefinity.com';
  const apiBaseUrl = tenant?.eyefinityApiBaseUrl ?? `https://${oauthHost}`;

  const config: IEyefinityConfig = {
    clientId: tenant?.eyefinityApiKey ?? '',
    clientSecret: tenant?.eyefinityApiSecret ?? '',
    tenantUid: tenant?.eyefinityTenantUid ?? '',
    oauthHost,
    apiBaseUrl,
    apiPath: tenant?.eyefinityApiPath ?? 'al-pe',
    scheduleManagerPath: 'al.sbox-hosting-schedulemanager',
  };

  configCache.set(tenantId, { config, expiresAt: Date.now() + CACHE_TTL });
  return config;
}

// ── Eyefinity OAuth Token Exchange ────────────────────────────────────────────

async function getClientCredentialsToken(config: IEyefinityConfig): Promise<string> {
  const { clientId, clientSecret, oauthHost } = config;
  if (!clientId || !clientSecret) throw new Error('Eyefinity OAuth credentials not configured');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = `grant_type=client_credentials&scope=${encodeURIComponent(EPM_SCOPES)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://${oauthHost}/as/token.oauth2`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`CC token failed: ${res.status} - ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    return data['access_token'] ?? data['accesstoken'] ?? '';
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Eyefinity OAuth timeout');
    throw e;
  }
}

async function exchangeToken(ccToken: string, config: IEyefinityConfig): Promise<{ token: string; expiresIn: number }> {
  const { clientId, clientSecret, tenantUid, oauthHost } = config;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  // Do NOT pass scope in exchange — causes "Policy Denied" on sandbox.
  // The CC token already carries the full scopes.
  const body = new URLSearchParams({
    'grant_type': 'urn:ietf:params:oauth:grant-type:token-exchange',
    'subject_token': ccToken,
    'subject_token_type': 'urn:ietf:params:oauth:token-type:access_token',
    'resource': 'https://VspEpmToken',
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://${oauthHost}/as/token.oauth2`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'tenantuid': tenantUid || '',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} - ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      token: (data['access_token'] ?? data['accesstoken'] ?? '') as string,
      expiresIn: (data['expires_in'] ?? 1799) as number,
    };
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Token exchange timeout');
    throw e;
  }
}

async function getEpmToken(tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const config = await getEyefinityConfig(tenantId);
  console.log(`[Eyefinity] Fetching new OAuth token for tenant ${tenantId}...`);

  const ccToken = await getClientCredentialsToken(config);
  const { token, expiresIn } = await exchangeToken(ccToken, config);

  tokenCache.set(tenantId, {
    token,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
  });
  console.log(`[Eyefinity] Token obtained (expires in ${expiresIn}s)`);
  return token;
}

// ── Authenticated Eyefinity Fetch ─────────────────────────────────────────────
// Routes through prc.wubba.ai proxy which handles OAuth token exchange.
// The proxy's EC2 IP is whitelisted by the Eyefinity sandbox.

const EYEFINITY_PROXY_URL = process.env['EYEFINITY_PROXY_URL'] ?? 'https://prc.wubba.ai/api/eyefinity';

async function eyefinityFetch(
  tenantId: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = `${EYEFINITY_PROXY_URL}/${path.replace(/^\//, '')}`;

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
}

/** Fetch from the Schedule Manager API (new appointment slot finder) */
async function scheduleManagerFetch(
  tenantId: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  // Schedule Manager goes through a separate proxy path or direct
  const config = await getEyefinityConfig(tenantId);
  const url = `${EYEFINITY_PROXY_URL}/../schedule-manager/${path.replace(/^\//, '')}`;

  // Try proxy first, fall back to direct if proxy doesn't support schedule-manager
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (res.ok || res.status !== 404) return res;
  } catch { /* fall through to direct */ }

  // Fallback: direct call with our own token
  const token = await getEpmToken(tenantId);
  const directUrl = `${config.apiBaseUrl}/${config.scheduleManagerPath}/${path.replace(/^\//, '')}`;
  return fetch(directUrl, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
}

// ── SSM Parameter Cache (for Twilio) ──────────────────────────────────────────

const paramCache = new Map<string, { value: string; expiresAt: number }>();

async function getParam(path: string): Promise<string> {
  const cached = paramCache.get(path);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const res = await ssm.send(new GetParameterCommand({ Name: path, WithDecryption: true }));
  const value = res.Parameter?.Value ?? '';
  paramCache.set(path, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
}

// ══════════════════════════════════════════════════════════════════════════════
// EYEFINITY EPM v2 API WRAPPERS
// ══════════════════════════════════════════════════════════════════════════════

// ── Offices ───────────────────────────────────────────────────────────────────

export interface IOffice {
  id: string;
  name: string;
  address?: string;
  phone?: string;
}

export async function getOffices(tenantId: string): Promise<IOffice[]> {
  try {
    const res = await eyefinityFetch(tenantId, 'v2offices');
    if (res.ok) {
      const data = await res.json() as { items?: Record<string, any>[] };
      return (data.items ?? []).map((o) => ({
        id: o['OfficeId'] ?? o['officeId'] ?? o['Id'] ?? '',
        name: o['OfficeName'] ?? o['officeName'] ?? o['Name'] ?? '',
        address: o['Address'] ?? o['StreetAddress1'] ?? o['address'] ?? '',
        phone: o['Phone'] ?? o['phone'] ?? '',
      }));
    }
    console.warn(`[Eyefinity] v2offices returned ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error('[Eyefinity] Office fetch failed:', err);
  }
  return [];
}

export async function getOfficeDetails(tenantId: string, officeId: string): Promise<Record<string, any> | null> {
  try {
    const res = await eyefinityFetch(tenantId, `v2offices/${officeId}`);
    if (res.ok) return await res.json() as Record<string, any>;
  } catch (err) {
    console.error('[Eyefinity] Office detail fetch failed:', err);
  }
  return null;
}

export async function getOfficeAppointmentTypes(tenantId: string, officeId: string): Promise<any[]> {
  try {
    const res = await eyefinityFetch(tenantId, `v2offices/${officeId}/appointmentTypes`);
    if (res.ok) {
      const data = await res.json() as { items?: any[] };
      return data.items ?? [];
    }
  } catch (err) {
    console.error('[Eyefinity] Appointment types fetch failed:', err);
  }
  return [];
}

// ── Providers ─────────────────────────────────────────────────────────────────

export interface IProvider {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  specialty?: string;
}

export async function getProviders(tenantId: string, officeId?: string): Promise<IProvider[]> {
  try {
    const path = officeId ? `v2offices/${officeId}/providers` : 'v2providers';
    const res = await eyefinityFetch(tenantId, path);
    if (res.ok) {
      const data = await res.json() as { items?: Record<string, any>[] };
      return (data.items ?? []).map((p) => ({
        id: p['Guid'] ?? p['guid'] ?? p['ProviderId'] ?? p['StaffId'] ?? p['staffId'] ?? '',
        name: p['FullName'] ?? p['fullName'] ?? `${p['FirstName'] ?? ''} ${p['LastName'] ?? ''}`.trim(),
        firstName: p['FirstName'] ?? p['firstName'],
        lastName: p['LastName'] ?? p['lastName'],
        specialty: p['Specialty'] ?? p['specialty'] ?? 'Optometrist',
      }));
    }
  } catch (err) {
    console.error('[Eyefinity] Provider fetch failed:', err);
  }
  return [];
}

// ── Staff ─────────────────────────────────────────────────────────────────────

export async function getStaff(tenantId: string, officeId?: string): Promise<IProvider[]> {
  try {
    const path = officeId ? `v2offices/${officeId}/staff` : 'v2staff';
    const res = await eyefinityFetch(tenantId, path);
    if (res.ok) {
      const data = await res.json() as { items?: Record<string, any>[] };
      return (data.items ?? []).map((s) => ({
        id: s['Guid'] ?? s['guid'] ?? s['StaffId'] ?? s['staffId'] ?? '',
        name: s['FullName'] ?? s['fullName'] ?? `${s['FirstName'] ?? ''} ${s['LastName'] ?? ''}`.trim(),
        firstName: s['FirstName'] ?? s['firstName'],
        lastName: s['LastName'] ?? s['lastName'],
        specialty: s['Specialty'] ?? s['specialty'] ?? '',
      }));
    }
  } catch (err) {
    console.error('[Eyefinity] Staff fetch failed:', err);
  }
  return [];
}

// ── Patients ──────────────────────────────────────────────────────────────────

export interface IPatientResult {
  id: string;
  firstName: string;
  lastName: string;
  dob?: string;
  phone?: string;
  email?: string;
}

export async function searchPatients(
  tenantId: string,
  phone?: string,
  name?: string,
  dob?: string,
  email?: string,
): Promise<IPatientResult[]> {
  try {
    // Use POST /v2patients/search for flexible searching
    const searchBody: Record<string, string> = {};
    if (phone) searchBody['Phone'] = phone.replace(/\D/g, '').slice(-10);
    if (dob) searchBody['DateOfBirth'] = dob;
    if (email) searchBody['Email'] = email;
    if (name) {
      const names = name.trim().split(' ');
      if (names.length >= 2) {
        searchBody['FirstName'] = names[0];
        searchBody['LastName'] = names[names.length - 1];
      } else {
        searchBody['LastName'] = names[0];
      }
    }

    const res = await eyefinityFetch(tenantId, 'v2patients/search', {
      method: 'POST',
      body: JSON.stringify(searchBody),
    });

    if (res.ok) {
      const data = await res.json() as { items?: Record<string, any>[] };
      return (data.items ?? []).map((p) => ({
        id: p['PatientId'] ?? p['patientId'] ?? p['Id'] ?? '',
        firstName: p['FirstName'] ?? p['firstName'] ?? '',
        lastName: p['LastName'] ?? p['lastName'] ?? '',
        dob: p['DateOfBirth'] ?? p['dob'],
        phone: p['Phone'] ?? p['phone'],
        email: p['Email'] ?? p['email'],
      }));
    }
    console.warn(`[Eyefinity] Patient search returned ${res.status}`);
  } catch (err) {
    console.error('[Eyefinity] Patient search failed:', err);
  }
  return [];
}

export async function createPatient(
  tenantId: string,
  patient: { firstName: string; lastName: string; dob?: string; phone?: string; email?: string },
): Promise<Record<string, any> | null> {
  try {
    const res = await eyefinityFetch(tenantId, 'v2patients', {
      method: 'POST',
      body: JSON.stringify({
        FirstName: patient.firstName,
        LastName: patient.lastName,
        DateOfBirth: patient.dob,
        Phone: patient.phone,
        Email: patient.email,
      }),
    });
    if (res.ok) return await res.json() as Record<string, any>;
    console.warn(`[Eyefinity] Create patient returned ${res.status}`);
  } catch (err) {
    console.error('[Eyefinity] Create patient failed:', err);
  }
  return null;
}

export async function getPatientAppointments(tenantId: string, patientId: string): Promise<any[]> {
  try {
    const res = await eyefinityFetch(tenantId, `v2patients/${patientId}/appointments`);
    if (res.ok) {
      const data = await res.json() as { items?: any[] };
      return data.items ?? [];
    }
  } catch (err) {
    console.error('[Eyefinity] Patient appointments failed:', err);
  }
  return [];
}

export async function getPatientOrders(tenantId: string, patientId: string): Promise<any[]> {
  try {
    const res = await eyefinityFetch(tenantId, `v2patients/${patientId}/orders`);
    if (res.ok) {
      const data = await res.json() as { items?: any[] };
      return data.items ?? [];
    }
  } catch (err) {
    console.error('[Eyefinity] Patient orders failed:', err);
  }
  return [];
}

// ── Appointments ──────────────────────────────────────────────────────────────

export interface ISlot {
  date: string;
  time: string;
  providerId: string;
  providerName?: string;
  officeId?: string;
  officeName?: string;
  duration?: number;
}

/**
 * Find available appointment slots using the NEW Schedule Manager API.
 * Falls back to legacy v2 provider appointmentSlots if Schedule Manager fails.
 */
export async function getAvailableSlots(
  tenantId: string,
  officeId: string,
  providerId?: string,
  date?: string,
  endDate?: string,
  preferredTime?: string,
  duration?: number,
): Promise<ISlot[]> {
  const startDate = date ?? new Date().toISOString().split('T')[0];
  const end = endDate ?? (() => { const d = new Date(startDate); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();

  // Try Schedule Manager API first (new, preferred)
  try {
    const body: Record<string, any> = {
      StartDate: startDate,
      EndDate: end,
      AppointmentDuration: duration ?? 30,
    };
    if (providerId) body['ResourceIds'] = [providerId];

    const res = await scheduleManagerFetch(tenantId, `offices/${officeId}/appointmentSlots?Offset=0&Limit=20`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { openAppointmentSlots?: Record<string, any>[] };
      let slots = (data.openAppointmentSlots ?? []).map((s) => ({
        date: s['AppointmentDate'] ?? startDate,
        time: s['StartTime'] ?? s['AppointmentStartTime'] ?? '09:00',
        providerId: s['ResourceId'] ?? providerId ?? '',
        providerName: `${s['ResourceFirstName'] ?? ''} ${s['ResourceLastName'] ?? ''}`.trim() || undefined,
        officeId: s['OfficeId'] ?? officeId,
        officeName: s['OfficeName'],
        duration: s['AppointmentDuration'] ?? duration ?? 30,
      }));

      if (preferredTime) {
        const isMorning = /morning|am/i.test(preferredTime);
        slots = slots.filter((s) => {
          const hour = parseInt(s.time.split(':')[0]);
          return isMorning ? hour < 12 : hour >= 12;
        });
      }
      return slots;
    }
    console.warn(`[ScheduleManager] returned ${res.status}, falling back to legacy`);
  } catch (err) {
    console.warn('[ScheduleManager] Failed, falling back to legacy:', err);
  }

  // Fallback: legacy v2 provider appointmentSlots
  if (providerId) {
    try {
      const params = new URLSearchParams({
        officeId,
        fromDate: startDate,
        toDate: end,
        itemDuration: String(duration ?? 30),
        pageSize: '20',
      });
      const res = await eyefinityFetch(tenantId, `v2staff/${providerId}/appointments?${params}`);
      if (res.ok) {
        const data = await res.json() as { items?: Record<string, any>[] };
        return (data.items ?? []).map((s) => ({
          date: s['date'] ?? s['AppointmentDate'] ?? startDate,
          time: s['startTime'] ?? s['AppointmentStartTime'] ?? s['time'] ?? '09:00',
          providerId,
          providerName: s['providerName'] ?? s['ProviderName'],
        }));
      }
    } catch (err) {
      console.error('[Eyefinity] Legacy slot fetch failed:', err);
    }
  }

  return [];
}

export interface IBookingResult {
  appointmentId: string;
  date: string;
  time: string;
  providerName: string;
  officeName: string;
  status: string;
}

export async function bookAppointment(
  tenantId: string,
  params: {
    patientId?: string;
    officeId: string;
    providerId: string;
    date: string;
    time: string;
    type?: string;
    notes?: string;
    duration?: number;
  },
): Promise<IBookingResult> {
  const startTime = params.time.includes(':') ? params.time : `${params.time}:00`;
  const dur = params.duration ?? 30;
  const endDate = new Date(`2000-01-01T${startTime}`);
  endDate.setMinutes(endDate.getMinutes() + dur);
  const endTime = endDate.toTimeString().slice(0, 5);

  try {
    const payload = {
      PatientId: params.patientId,
      OfficeId: params.officeId,
      StaffId: params.providerId,
      AppointmentDate: params.date,
      AppointmentStartTime: startTime,
      AppointmentEndTime: endTime,
      AppointmentReason: params.type ?? 'Eye Exam',
      Notes: params.notes ?? 'Booked via Encompass Assist',
      CancelIndicator: false,
    };

    // Use PUT /v2providers/{providerId}/appointments to create
    const res = await eyefinityFetch(
      tenantId,
      `v2providers/${params.providerId}/appointments`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );

    if (res.ok) {
      const data = await res.json() as Record<string, any>;
      return {
        appointmentId: data['AppointmentId'] ?? data['appointmentId'] ?? `APT-${Date.now()}`,
        date: params.date,
        time: params.time,
        providerName: data['ProviderName'] ?? 'Provider',
        officeName: data['OfficeName'] ?? 'Office',
        status: 'confirmed',
      };
    }
    console.warn(`[Eyefinity] Booking returned ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error('[Eyefinity] Booking failed:', err);
  }

  return {
    appointmentId: `APT-${Date.now()}`,
    date: params.date,
    time: params.time,
    providerName: 'Provider',
    officeName: 'Office',
    status: 'pending_confirmation',
  };
}

export async function getProviderAppointments(
  tenantId: string,
  providerId: string,
): Promise<any[]> {
  try {
    const res = await eyefinityFetch(tenantId, `v2providers/${providerId}/appointments`);
    if (res.ok) {
      const data = await res.json() as { items?: any[] };
      return data.items ?? [];
    }
  } catch (err) {
    console.error('[Eyefinity] Provider appointments failed:', err);
  }
  return [];
}

export async function confirmAppointment(
  tenantId: string,
  providerId: string,
  appointmentId: string,
  confirmed: boolean,
): Promise<boolean> {
  try {
    const res = await eyefinityFetch(
      tenantId,
      `v2providers/${providerId}/appointments/${appointmentId}/appointmentConfirmations`,
      { method: 'PUT', body: JSON.stringify({ Confirmed: confirmed }) },
    );
    return res.ok;
  } catch (err) {
    console.error('[Eyefinity] Confirm appointment failed:', err);
    return false;
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function getOrders(tenantId: string, fromDate?: string, toDate?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    const res = await eyefinityFetch(tenantId, `v2orders?${params}`);
    if (res.ok) {
      const data = await res.json() as { items?: any[] };
      return data.items ?? [];
    }
  } catch (err) {
    console.error('[Eyefinity] Orders fetch failed:', err);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// TWILIO SMS
// ══════════════════════════════════════════════════════════════════════════════

export interface ISmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendSms(
  tenantId: string,
  to: string,
  message: string,
): Promise<ISmsResult> {
  let accountSid: string, authToken: string, fromNumber: string;
  try {
    const prefix = `/chat-agent/${tenantId}/twilio`;
    [accountSid, authToken, fromNumber] = await Promise.all([
      getParam(`${prefix}/account-sid`),
      getParam(`${prefix}/auth-token`),
      getParam(`${prefix}/from-number`),
    ]);
  } catch {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  if (!accountSid || !authToken) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({ To: to, From: fromNumber, Body: message });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    if (res.ok) {
      const data = await res.json() as { sid: string };
      return { success: true, messageId: data.sid };
    }
    const errData = await res.json() as { message?: string };
    return { success: false, error: errData.message ?? `Twilio error: ${res.status}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SES EMAIL
// ══════════════════════════════════════════════════════════════════════════════

export interface IEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(
  tenantId: string,
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string,
): Promise<IEmailResult> {
  const fromEmail = await getParam(`/chat-agent/${tenantId}/email/from-address`)
    .catch(() => 'noreply@encompassassist.com');

  try {
    const res = await ses.send(new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: bodyText },
          ...(bodyHtml && { Html: { Data: bodyHtml } }),
        },
      },
    }));
    return { success: true, messageId: res.MessageId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TWILIO VOICE CALLS
// ══════════════════════════════════════════════════════════════════════════════

export interface ICallResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

/**
 * Initiate an outbound voice call via Twilio.
 * Uses TwiML to speak a message to the recipient.
 */
export async function makeCall(
  tenantId: string,
  to: string,
  message: string,
  voiceName?: string,
): Promise<ICallResult> {
  let accountSid: string, authToken: string, fromNumber: string;
  try {
    const prefix = `/chat-agent/${tenantId}/twilio`;
    [accountSid, authToken, fromNumber] = await Promise.all([
      getParam(`${prefix}/account-sid`),
      getParam(`${prefix}/auth-token`),
      getParam(`${prefix}/from-number`),
    ]);
  } catch {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  if (!accountSid || !authToken) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  const voice = voiceName ?? 'Polly.Joanna';
  const twiml = `<Response><Say voice="${voice}">${escapeXml(message)}</Say></Response>`;

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({
      To: to,
      From: fromNumber,
      Twiml: twiml,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (res.ok) {
      const data = await res.json() as { sid: string };
      return { success: true, callSid: data.sid };
    }
    const errData = await res.json() as { message?: string };
    return { success: false, error: errData.message ?? `Twilio error: ${res.status}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
