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

  /** Sign in with email and password */
  async signIn(email: string, password: string): Promise<IAccessorResult<ICognitoTokens>> {
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
      const result = response.AuthenticationResult;
      if (!result) throw new Error('No authentication result returned');
      return {
        accessToken: result.AccessToken ?? '',
        idToken: result.IdToken ?? '',
        refreshToken: result.RefreshToken ?? '',
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
