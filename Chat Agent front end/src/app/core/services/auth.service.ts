import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, timer } from 'rxjs';
import { CognitoAccessor, ICognitoTokens, ICognitoUser, ICognitoChallenge } from '../../../lib/accessors/cognito.accessor';
import { IAccessorResult } from '../../../lib/models/tenant.model';

const TOKEN_KEY = 'bcc_tokens';
const USER_KEY = 'bcc_user';

/** Buffer before expiry to proactively refresh (5 minutes in ms) */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface IAuthState {
  isAuthenticated: boolean;
  user: ICognitoUser | null;
  tokens: ICognitoTokens | null;
}

/** Sign-in result: success, challenge needed, or error */
export type ISignInOutcome =
  | { status: 'success' }
  | { status: 'mfa_required'; challenge: ICognitoChallenge }
  | { status: 'new_password_required'; challenge: ICognitoChallenge }
  | { status: 'error'; error: string };

/**
 * Angular service wrapping Cognito authentication.
 * Manages token persistence, refresh, and reactive auth state.
 */
@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private stateSubject = new BehaviorSubject<IAuthState>(this.loadStoredState());
  readonly authState$: Observable<IAuthState> = this.stateSubject.asObservable();

  private refreshTimerSub: Subscription | null = null;

  constructor(
    private cognito: CognitoAccessor,
    private router: Router,
  ) {
    // If we loaded stored tokens on startup, schedule proactive refresh
    const initial = this.stateSubject.value;
    if (initial.isAuthenticated && initial.tokens) {
      this.scheduleProactiveRefresh(initial.tokens);
    }
  }

  ngOnDestroy(): void {
    this.cancelRefreshTimer();
  }

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

  /** Sign in — may return success, MFA challenge, or new-password challenge */
  async signIn(email: string, password: string): Promise<ISignInOutcome> {
    const result = await this.cognito.signIn(email, password);
    if (!result.success || !result.data) {
      return { status: 'error', error: result.error ?? 'Sign in failed' };
    }

    const data = result.data;

    if (data.type === 'challenge') {
      if (data.challenge.challengeName === 'SOFTWARE_TOKEN_MFA') {
        return { status: 'mfa_required', challenge: data.challenge };
      }
      return { status: 'new_password_required', challenge: data.challenge };
    }

    return this.completeLogin(data.tokens);
  }

  /** Complete MFA challenge with TOTP code */
  async respondToMfaChallenge(
    session: string, username: string, totpCode: string
  ): Promise<ISignInOutcome> {
    const result = await this.cognito.respondToMfaChallenge(session, username, totpCode);
    if (!result.success || !result.data) {
      return { status: 'error', error: result.error ?? 'MFA verification failed' };
    }
    return this.completeLogin(result.data);
  }

  /** Complete new-password challenge (admin-created user first login) */
  async respondToNewPasswordChallenge(
    session: string, username: string, newPassword: string
  ): Promise<ISignInOutcome> {
    const result = await this.cognito.respondToNewPasswordChallenge(session, username, newPassword);
    if (!result.success || !result.data) {
      return { status: 'error', error: result.error ?? 'Password change failed' };
    }

    const data = result.data;
    if (data.type === 'challenge') {
      return { status: 'mfa_required', challenge: data.challenge };
    }
    return this.completeLogin(data.tokens);
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

  /**
   * Refresh the current token set using the stored refresh token.
   * Returns true if refresh succeeded, false otherwise.
   * Called by the AuthInterceptor on 401 responses.
   */
  async refreshToken(): Promise<boolean> {
    const currentTokens = this.stateSubject.value.tokens;
    if (!currentTokens?.refreshToken) return false;

    const result = await this.cognito.refreshTokens(currentTokens.refreshToken);
    if (!result.success || !result.data) return false;

    const newTokens = result.data;
    const currentUser = this.stateSubject.value.user;
    if (currentUser) {
      this.persistState(newTokens, currentUser);
      this.scheduleProactiveRefresh(newTokens);
    }
    return true;
  }

  /**
   * Check if the current ID token is expired.
   * Decodes the JWT exp claim without verifying the signature.
   */
  isTokenExpired(): boolean {
    const token = this.idToken;
    if (!token) return true;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expMs = (payload.exp as number) * 1000;
      return Date.now() >= expMs;
    } catch {
      return true;
    }
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

  /** Internal: fetch user profile and persist state after successful auth */
  private async completeLogin(tokens: ICognitoTokens): Promise<ISignInOutcome> {
    const userResult = await this.cognito.getUser(tokens.accessToken);
    if (!userResult.success || !userResult.data) {
      return { status: 'error', error: 'Failed to load user profile' };
    }
    this.persistState(tokens, userResult.data);
    this.scheduleProactiveRefresh(tokens);
    return { status: 'success' };
  }

  private persistState(tokens: ICognitoTokens, user: ICognitoUser): void {
    const state: IAuthState = { isAuthenticated: true, user, tokens };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    this.stateSubject.next(state);
  }

  private clearState(): void {
    this.cancelRefreshTimer();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.stateSubject.next({ isAuthenticated: false, user: null, tokens: null });
  }

  /**
   * Schedule a proactive token refresh 5 minutes before the token expires.
   * Uses the expiresIn value from Cognito (in seconds).
   */
  private scheduleProactiveRefresh(tokens: ICognitoTokens): void {
    this.cancelRefreshTimer();

    // Calculate delay: token lifetime in ms minus 5-minute buffer
    let delayMs: number;
    try {
      const payload = JSON.parse(atob(tokens.idToken.split('.')[1]));
      const expMs = (payload.exp as number) * 1000;
      delayMs = expMs - Date.now() - REFRESH_BUFFER_MS;
    } catch {
      // Fallback to expiresIn from Cognito response
      delayMs = (tokens.expiresIn * 1000) - REFRESH_BUFFER_MS;
    }

    // If already past the refresh window, refresh immediately
    if (delayMs <= 0) delayMs = 0;

    this.refreshTimerSub = timer(delayMs).subscribe(() => {
      this.refreshToken();
    });
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimerSub) {
      this.refreshTimerSub.unsubscribe();
      this.refreshTimerSub = null;
    }
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
