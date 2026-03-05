import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import * as crypto from 'crypto';

const ssmClient = new SSMClient({ region: process.env['REGION'] ?? 'us-west-2' });

export interface ISalesforceConfig {
  instanceUrl: string;
  consumerKey: string;
  username: string;
  ssmPrivateKeyParam: string;
}

export interface ISalesforcePasswordConfig {
  loginUrl: string;
  clientId: string;
  ssmCredentialsParam: string; // SSM param storing JSON { clientSecret, password, securityToken }
}

export interface ISalesforceCase {
  Subject: string;
  Description: string;
  Priority?: string;
  Origin?: string;
  Status?: string;
  RecordTypeId?: string;
  [key: string]: unknown;
}

/**
 * Store a Salesforce private key in SSM Parameter Store as SecureString.
 */
export async function storePrivateKey(paramName: string, privateKey: string): Promise<void> {
  await ssmClient.send(new PutParameterCommand({
    Name: paramName,
    Value: privateKey,
    Type: 'SecureString',
    Overwrite: true,
  }));
}

/**
 * Delete a Salesforce private key from SSM.
 */
export async function deletePrivateKey(paramName: string): Promise<void> {
  try {
    await ssmClient.send(new DeleteParameterCommand({ Name: paramName }));
  } catch { /* ignore if not found */ }
}

/**
 * Get a Salesforce access token using the JWT Bearer flow.
 * - Build JWT: iss=consumerKey, sub=username, aud=login.salesforce.com
 * - Sign with RS256 using private key from SSM
 * - Exchange for access_token via token endpoint
 */
export async function getAccessToken(config: ISalesforceConfig): Promise<{ accessToken: string; instanceUrl: string }> {
  // Retrieve private key from SSM
  const paramRes = await ssmClient.send(new GetParameterCommand({
    Name: config.ssmPrivateKeyParam,
    WithDecryption: true,
  }));
  const privateKey = paramRes.Parameter?.Value ?? '';
  if (!privateKey) throw new Error('Private key not found in SSM');

  // Build JWT header + payload
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: config.consumerKey,
    sub: config.username,
    aud: 'https://login.salesforce.com',
    exp: now + 300, // 5-minute expiry
  })).toString('base64url');

  const sigInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(sigInput), privateKey)
    .toString('base64url');

  const assertion = `${sigInput}.${signature}`;

  // Exchange JWT for access token
  const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Salesforce token exchange failed: ${res.status} ${errorText}`);
  }

  const data = await res.json() as { access_token: string; instance_url: string };
  return {
    accessToken: data.access_token,
    instanceUrl: data.instance_url || config.instanceUrl,
  };
}

/**
 * Store Salesforce password credentials in SSM as a JSON SecureString.
 */
export async function storePasswordCredentials(
  paramName: string,
  creds: { clientSecret: string; password: string; securityToken: string },
): Promise<void> {
  await ssmClient.send(new PutParameterCommand({
    Name: paramName,
    Value: JSON.stringify(creds),
    Type: 'SecureString',
    Overwrite: true,
  }));
}

/**
 * Get a Salesforce access token using the Username-Password OAuth flow.
 * - POST grant_type=password with client_id, client_secret, username, password+securityToken
 */
export async function getAccessTokenPasswordFlow(
  config: ISalesforcePasswordConfig,
  username: string,
): Promise<{ accessToken: string; instanceUrl: string }> {
  // Retrieve credentials from SSM
  const paramRes = await ssmClient.send(new GetParameterCommand({
    Name: config.ssmCredentialsParam,
    WithDecryption: true,
  }));
  const raw = paramRes.Parameter?.Value ?? '';
  if (!raw) throw new Error('Salesforce credentials not found in SSM');

  const creds = JSON.parse(raw) as { clientSecret: string; password: string; securityToken: string };

  const tokenUrl = `${config.loginUrl}/services/oauth2/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: config.clientId,
      client_secret: creds.clientSecret,
      username,
      password: creds.password + (creds.securityToken || ''),
    }).toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Salesforce password auth failed: ${res.status} ${errorText}`);
  }

  const data = await res.json() as { access_token: string; instance_url: string };
  return {
    accessToken: data.access_token,
    instanceUrl: data.instance_url,
  };
}

/**
 * Query available custom fields on the Case object.
 */
export async function getCaseFieldMetadata(
  accessToken: string,
  instanceUrl: string,
): Promise<string[]> {
  const url = `${instanceUrl}/services/data/v60.0/sobjects/Case/describe`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to describe Case object: ${res.status}`);
  const data = await res.json() as { fields: Array<{ name: string; custom: boolean }> };
  return data.fields.filter(f => f.custom).map(f => f.name);
}

/**
 * Create a Case in Salesforce using the REST API.
 */
export async function createCase(
  accessToken: string,
  instanceUrl: string,
  caseData: ISalesforceCase
): Promise<{ id: string; caseNumber?: string }> {
  const url = `${instanceUrl}/services/data/v60.0/sobjects/Case`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(caseData),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Salesforce case creation failed: ${res.status} ${errorText}`);
  }

  const result = await res.json() as { id: string; success: boolean };
  if (!result.success) throw new Error('Salesforce case creation returned success=false');

  // Fetch the case number
  let caseNumber: string | undefined;
  try {
    const caseRes = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/Case/${result.id}?fields=CaseNumber`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (caseRes.ok) {
      const caseDetail = await caseRes.json() as { CaseNumber?: string };
      caseNumber = caseDetail.CaseNumber;
    }
  } catch { /* non-critical */ }

  return { id: result.id, caseNumber };
}

/**
 * Add an attachment (file) directly to a Salesforce Case.
 * Body must be base64-encoded.
 */
export async function addAttachment(
  accessToken: string,
  instanceUrl: string,
  attachment: { Name: string; Body: string; ContentType: string; ParentId: string },
): Promise<string> {
  const url = `${instanceUrl}/services/data/v60.0/sobjects/Attachment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attachment),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Salesforce attachment failed: ${res.status} ${errorText}`);
  }

  const result = await res.json() as { id: string; success: boolean };
  if (!result.success) throw new Error('Salesforce attachment returned success=false');
  return result.id;
}
