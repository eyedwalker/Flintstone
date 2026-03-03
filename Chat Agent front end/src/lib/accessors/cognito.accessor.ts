import { Injectable } from '@angular/core';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { IAccessorResult } from '../models/tenant.model';
import { BaseAccessor } from './base.accessor';
import { environment } from '../../environments/environment';

export interface ICognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ICognitoUser {
  username: string;
  email: string;
  sub: string;
  attributes: Record<string, string>;
}

/** Result from signIn when a challenge is required */
export interface ICognitoChallenge {
  challengeName: 'SOFTWARE_TOKEN_MFA' | 'NEW_PASSWORD_REQUIRED';
  session: string;
  username: string;
}

/** Union type for signIn result — either tokens or a challenge */
export type ISignInResult = { type: 'tokens'; tokens: ICognitoTokens } | { type: 'challenge'; challenge: ICognitoChallenge };

/**
 * Accessor for AWS Cognito User Pool operations.
 * Handles all authentication lifecycle calls.
 */
@Injectable({ providedIn: 'root' })
export class CognitoAccessor extends BaseAccessor {
  private readonly client = new CognitoIdentityProviderClient({
    region: environment.aws.region,
  });

  private readonly clientId = environment.aws.cognitoClientId;

  /** Sign up a new user with email and password */
  async signUp(email: string, password: string, name: string): Promise<IAccessorResult<string>> {
    return this.execute(async () => {
      const command = new SignUpCommand({
        ClientId: this.clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: name },
        ],
      });
      const response = await this.client.send(command);
      return response.UserSub ?? '';
    });
  }

  /** Confirm sign up with verification code */
  async confirmSignUp(email: string, code: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      const command = new ConfirmSignUpCommand({
        ClientId: this.clientId,
        Username: email,
        ConfirmationCode: code,
      });
      await this.client.send(command);
    });
  }

  /** Resend confirmation code */
  async resendCode(email: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new ResendConfirmationCodeCommand({
        ClientId: this.clientId,
        Username: email,
      }));
    });
  }

  /** Sign in with email and password — may return tokens or an MFA/new-password challenge */
  async signIn(email: string, password: string): Promise<IAccessorResult<ISignInResult>> {
    return this.execute(async () => {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      });
      const response = await this.client.send(command);

      // MFA or forced password change challenge
      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA' || response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return {
          type: 'challenge' as const,
          challenge: {
            challengeName: response.ChallengeName,
            session: response.Session ?? '',
            username: email,
          },
        };
      }

      const result = response.AuthenticationResult;
      if (!result) throw new Error('No authentication result returned');
      return {
        type: 'tokens' as const,
        tokens: {
          accessToken: result.AccessToken ?? '',
          idToken: result.IdToken ?? '',
          refreshToken: result.RefreshToken ?? '',
          expiresIn: result.ExpiresIn ?? 3600,
        },
      };
    });
  }

  /** Respond to SOFTWARE_TOKEN_MFA challenge with a TOTP code */
  async respondToMfaChallenge(session: string, username: string, totpCode: string): Promise<IAccessorResult<ICognitoTokens>> {
    return this.execute(async () => {
      const response = await this.client.send(new RespondToAuthChallengeCommand({
        ClientId: this.clientId,
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          SOFTWARE_TOKEN_MFA_CODE: totpCode,
        },
      }));
      const result = response.AuthenticationResult;
      if (!result) throw new Error('MFA verification failed');
      return {
        accessToken: result.AccessToken ?? '',
        idToken: result.IdToken ?? '',
        refreshToken: result.RefreshToken ?? '',
        expiresIn: result.ExpiresIn ?? 3600,
      };
    });
  }

  /** Respond to NEW_PASSWORD_REQUIRED challenge (admin-created user first login) */
  async respondToNewPasswordChallenge(
    session: string, username: string, newPassword: string
  ): Promise<IAccessorResult<ISignInResult>> {
    return this.execute(async () => {
      const response = await this.client.send(new RespondToAuthChallengeCommand({
        ClientId: this.clientId,
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
      }));

      // After setting new password, Cognito may issue an MFA challenge
      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        return {
          type: 'challenge' as const,
          challenge: {
            challengeName: response.ChallengeName,
            session: response.Session ?? '',
            username,
          },
        };
      }

      const result = response.AuthenticationResult;
      if (!result) throw new Error('Password change failed');
      return {
        type: 'tokens' as const,
        tokens: {
          accessToken: result.AccessToken ?? '',
          idToken: result.IdToken ?? '',
          refreshToken: result.RefreshToken ?? '',
          expiresIn: result.ExpiresIn ?? 3600,
        },
      };
    });
  }

  /** Refresh tokens using a refresh token — returns new access + id tokens */
  async refreshTokens(refreshToken: string): Promise<IAccessorResult<ICognitoTokens>> {
    return this.execute(async () => {
      const command = new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      });
      const response = await this.client.send(command);
      const result = response.AuthenticationResult;
      if (!result) throw new Error('Token refresh failed');
      return {
        accessToken: result.AccessToken ?? '',
        idToken: result.IdToken ?? '',
        // Cognito does not return a new refresh token on refresh; keep the existing one
        refreshToken: refreshToken,
        expiresIn: result.ExpiresIn ?? 3600,
      };
    });
  }

  /** Get current user profile from access token */
  async getUser(accessToken: string): Promise<IAccessorResult<ICognitoUser>> {
    return this.execute(async () => {
      const response = await this.client.send(
        new GetUserCommand({ AccessToken: accessToken })
      );
      const attrs = Object.fromEntries(
        (response.UserAttributes ?? []).map((a: { Name?: string; Value?: string }) => [a.Name!, a.Value!])
      );
      return {
        username: response.Username ?? '',
        email: attrs['email'] ?? '',
        sub: attrs['sub'] ?? '',
        attributes: attrs,
      };
    });
  }

  /** Sign out globally (invalidates all tokens) */
  async signOut(accessToken: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
    });
  }

  /** Initiate forgot password flow */
  async forgotPassword(email: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new ForgotPasswordCommand({
        ClientId: this.clientId,
        Username: email,
      }));
    });
  }

  /** Confirm new password with reset code */
  async confirmForgotPassword(
    email: string, code: string, newPassword: string
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new ConfirmForgotPasswordCommand({
        ClientId: this.clientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      }));
    });
  }
}
