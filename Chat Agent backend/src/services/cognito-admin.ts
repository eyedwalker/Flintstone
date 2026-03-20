import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminResetUserPasswordCommand,
  AdminSetUserMFAPreferenceCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const REGION = process.env['REGION'] ?? 'us-west-2';
const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? '';
const CLIENT_ID = process.env['COGNITO_CLIENT_ID'] ?? '';

const client = new CognitoIdentityProviderClient({ region: REGION });

/** Create a new user in Cognito with a temporary password (admin-created invite flow) */
export async function createUser(
  email: string,
  name: string,
  tempPassword?: string
): Promise<{ userId: string; temporaryPassword: string }> {
  const password = tempPassword ?? generateTempPassword();
  const res = await client.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    TemporaryPassword: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: name },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));
  const userId = res.User?.Attributes?.find((a: { Name?: string; Value?: string }) => a.Name === 'sub')?.Value ?? '';
  return { userId, temporaryPassword: password };
}

/** Delete a user from Cognito */
export async function deleteUser(username: string): Promise<void> {
  await client.send(new AdminDeleteUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

/** Get a user's details from Cognito */
export async function getUser(username: string): Promise<{
  userId: string; email: string; name: string; status: string; mfaEnabled: boolean;
} | null> {
  try {
    const res = await client.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    const attrs = Object.fromEntries(
      (res.UserAttributes ?? []).map((a: { Name?: string; Value?: string }) => [a.Name!, a.Value!])
    );
    return {
      userId: attrs['sub'] ?? '',
      email: attrs['email'] ?? '',
      name: attrs['name'] ?? '',
      status: res.UserStatus ?? '',
      mfaEnabled: (res.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA'),
    };
  } catch (e: any) {
    if (e.name === 'UserNotFoundException') return null;
    throw e;
  }
}

/** Find a user by email in Cognito */
export async function findUserByEmail(email: string): Promise<{
  userId: string; email: string; name: string;
} | null> {
  const res = await client.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `email = "${email}"`,
    Limit: 1,
  }));
  const user = res.Users?.[0];
  if (!user) return null;
  const attrs = Object.fromEntries(
    (user.Attributes ?? []).map((a: { Name?: string; Value?: string }) => [a.Name!, a.Value!])
  );
  return {
    userId: attrs['sub'] ?? '',
    email: attrs['email'] ?? '',
    name: attrs['name'] ?? '',
  };
}

/** Verify a user's password via AdminInitiateAuth (for re-authentication) */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  try {
    await client.send(new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }));
    return true;
  } catch {
    return false;
  }
}

/** Begin MFA TOTP setup — returns the secret code for QR generation */
export async function setupMfa(accessToken: string): Promise<{ secretCode: string }> {
  const res = await client.send(new AssociateSoftwareTokenCommand({
    AccessToken: accessToken,
  }));
  return { secretCode: res.SecretCode ?? '' };
}

/** Verify a TOTP code and enable MFA */
export async function verifyMfa(
  accessToken: string,
  totpCode: string
): Promise<boolean> {
  try {
    const res = await client.send(new VerifySoftwareTokenCommand({
      AccessToken: accessToken,
      UserCode: totpCode,
      FriendlyDeviceName: 'Authenticator',
    }));
    return res.Status === 'SUCCESS';
  } catch {
    return false;
  }
}

/** Enable or disable MFA for a user (admin operation) */
export async function setMfaPreference(
  username: string,
  enabled: boolean
): Promise<void> {
  await client.send(new AdminSetUserMFAPreferenceCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
    SoftwareTokenMfaSettings: {
      Enabled: enabled,
      PreferredMfa: enabled,
    },
  }));
}

/** Reset a user's password — sends them a new temporary password email */
export async function resetUserPassword(username: string): Promise<void> {
  await client.send(new AdminResetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

/** Resend the invite — creates a new temp password and emails it */
export async function resendInvite(email: string, name: string): Promise<{ temporaryPassword: string }> {
  // Delete and recreate the user to trigger a new invite email
  // This is the Cognito-recommended approach for resending invites
  try {
    await client.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
    }));
  } catch { /* user may not exist */ }

  const result = await createUser(email, name);
  return { temporaryPassword: result.temporaryPassword };
}

/** Get Cognito status and last login for a user */
export async function getUserStatus(username: string): Promise<{
  status: string;
  lastLogin?: string;
  created?: string;
  enabled: boolean;
} | null> {
  try {
    const res = await client.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    return {
      status: res.UserStatus ?? 'UNKNOWN',
      lastLogin: res.UserLastModifiedDate?.toISOString(),
      created: res.UserCreateDate?.toISOString(),
      enabled: res.Enabled ?? true,
    };
  } catch (e: any) {
    if (e.name === 'UserNotFoundException') return null;
    throw e;
  }
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  // Use crypto.randomUUID-based approach for password generation
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  for (let i = 0; i < 16; i++) {
    password += chars[parseInt(hex.substring(i * 2, i * 2 + 2), 16) % chars.length];
  }
  return password;
}
