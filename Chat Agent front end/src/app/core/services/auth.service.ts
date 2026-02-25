import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { CognitoAccessor, ICognitoTokens, ICognitoUser } from '../../../lib/accessors/cognito.accessor';
import { IAccessorResult } from '../../../lib/models/tenant.model';

const TOKEN_KEY = 'bcc_tokens';
const USER_KEY = 'bcc_user';

export interface IAuthState {
  isAuthenticated: boolean;
  user: ICognitoUser | null;
  tokens: ICognitoTokens | null;
}

/**
 * Angular service wrapping Cognito authentication.
 * Manages token persistence, refresh, and reactive auth state.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private stateSubject = new BehaviorSubject<IAuthState>(this.loadStoredState());
  readonly authState$: Observable<IAuthState> = this.stateSubject.asObservable();

  constructor(
    private cognito: CognitoAccessor,
    private router: Router,
  ) {}

  get isAuthenticated(): boolean {
    return this.stateSubject.value.isAuthenticated;
  }

  get currentUser(): ICognitoUser | null {
    return this.stateSubject.value.user;
  }

  get accessToken(): string | null {
    return this.stateSubject.value.tokens?.accessToken ?? null;
  }

  /** Cognito ID token — used as the Authorization header for API Gateway JWT authorizer */
  get idToken(): string | null {
    return this.stateSubject.value.tokens?.idToken ?? null;
  }

  /** Sign in and persist tokens */
  async signIn(email: string, password: string): Promise<IAccessorResult<void>> {
    const result = await this.cognito.signIn(email, password);
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const tokens = result.data;
    const userResult = await this.cognito.getUser(tokens.accessToken);

    if (!userResult.success || !userResult.data) {
      return { success: false, error: 'Failed to load user profile' };
    }

    this.persistState(tokens, userResult.data);
    return { success: true };
  }

  /** Register a new user */
  async signUp(email: string, password: string, name: string): Promise<IAccessorResult<string>> {
    return this.cognito.signUp(email, password, name);
  }

  /** Confirm registration with verification code */
  async confirmSignUp(email: string, code: string): Promise<IAccessorResult<void>> {
    return this.cognito.confirmSignUp(email, code);
  }

  /** Resend verification code */
  async resendCode(email: string): Promise<IAccessorResult<void>> {
    return this.cognito.resendCode(email);
  }

  /** Initiate forgot password flow */
  async forgotPassword(email: string): Promise<IAccessorResult<void>> {
    return this.cognito.forgotPassword(email);
  }

  /** Confirm new password */
  async confirmForgotPassword(
    email: string, code: string, newPassword: string
  ): Promise<IAccessorResult<void>> {
    return this.cognito.confirmForgotPassword(email, code, newPassword);
  }

  /** Sign out and clear all state */
  async signOut(): Promise<void> {
    const token = this.accessToken;
    if (token) {
      await this.cognito.signOut(token);
    }
    this.clearState();
    this.router.navigate(['/auth/login']);
  }

  private persistState(tokens: ICognitoTokens, user: ICognitoUser): void {
    const state: IAuthState = { isAuthenticated: true, user, tokens };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    this.stateSubject.next(state);
  }

  private clearState(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.stateSubject.next({ isAuthenticated: false, user: null, tokens: null });
  }

  private loadStoredState(): IAuthState {
    try {
      const tokensRaw = sessionStorage.getItem(TOKEN_KEY);
      const userRaw = sessionStorage.getItem(USER_KEY);
      if (!tokensRaw || !userRaw) return { isAuthenticated: false, user: null, tokens: null };
      return {
        isAuthenticated: true,
        tokens: JSON.parse(tokensRaw) as ICognitoTokens,
        user: JSON.parse(userRaw) as ICognitoUser,
      };
    } catch {
      return { isAuthenticated: false, user: null, tokens: null };
    }
  }
}
