import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { CognitoAccessor, ICognitoTokens, ICognitoUser, ISignInResult } from '../../../lib/accessors/cognito.accessor';

const MOCK_TOKENS: ICognitoTokens = {
  accessToken: 'access-token',
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  expiresIn: 3600,
};

const MOCK_SIGN_IN_RESULT: ISignInResult = { type: 'tokens', tokens: MOCK_TOKENS };

const MOCK_USER: ICognitoUser = {
  username: 'test@example.com',
  email: 'test@example.com',
  sub: 'user-sub-1',
  attributes: { name: 'Test User' },
};

describe('AuthService', () => {
  let service: AuthService;
  let cognitoSpy: jasmine.SpyObj<CognitoAccessor>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    cognitoSpy = jasmine.createSpyObj('CognitoAccessor', [
      'signIn', 'signUp', 'confirmSignUp', 'resendCode',
      'forgotPassword', 'confirmForgotPassword', 'signOut', 'getUser',
    ]);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: CognitoAccessor, useValue: cognitoSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  afterEach(() => sessionStorage.clear());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should not be authenticated initially', () => {
    expect(service.isAuthenticated).toBeFalse();
    expect(service.currentUser).toBeNull();
    expect(service.idToken).toBeNull();
    expect(service.accessToken).toBeNull();
  });

  // ── signIn ───────────────────────────────────────────────────────────────

  describe('signIn()', () => {
    it('sets authenticated state on success', async () => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: true, data: MOCK_SIGN_IN_RESULT }));
      cognitoSpy.getUser.and.returnValue(Promise.resolve({ success: true, data: MOCK_USER }));

      const result = await service.signIn('test@example.com', 'P@ssword1');

      expect(result.status).toBe('success');
      expect(service.isAuthenticated).toBeTrue();
      expect(service.idToken).toBe('id-token');
      expect(service.accessToken).toBe('access-token');
      expect(service.currentUser?.email).toBe('test@example.com');
    });

    it('returns error on invalid credentials', async () => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: false, error: 'Incorrect username or password' }));

      const result = await service.signIn('test@example.com', 'wrong');

      expect(result.status).toBe('error');
      expect((result as { status: 'error'; error: string }).error).toBe('Incorrect username or password');
      expect(service.isAuthenticated).toBeFalse();
    });

    it('returns error when getUser fails after token exchange', async () => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: true, data: MOCK_SIGN_IN_RESULT }));
      cognitoSpy.getUser.and.returnValue(Promise.resolve({ success: false, error: 'User not found' }));

      const result = await service.signIn('test@example.com', 'P@ssword1');

      expect(result.status).toBe('error');
      expect(service.isAuthenticated).toBeFalse();
    });

    it('persists tokens and user in sessionStorage', async () => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: true, data: MOCK_SIGN_IN_RESULT }));
      cognitoSpy.getUser.and.returnValue(Promise.resolve({ success: true, data: MOCK_USER }));

      await service.signIn('test@example.com', 'P@ssword1');

      expect(sessionStorage.getItem('bcc_tokens')).not.toBeNull();
      expect(sessionStorage.getItem('bcc_user')).not.toBeNull();
    });
  });

  // ── signOut ──────────────────────────────────────────────────────────────

  describe('signOut()', () => {
    beforeEach(async () => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: true, data: MOCK_SIGN_IN_RESULT }));
      cognitoSpy.getUser.and.returnValue(Promise.resolve({ success: true, data: MOCK_USER }));
      cognitoSpy.signOut.and.returnValue(Promise.resolve({ success: true }));
      await service.signIn('test@example.com', 'P@ssword1');
    });

    it('clears authenticated state', async () => {
      await service.signOut();

      expect(service.isAuthenticated).toBeFalse();
      expect(service.currentUser).toBeNull();
      expect(service.idToken).toBeNull();
    });

    it('clears sessionStorage', async () => {
      await service.signOut();

      expect(sessionStorage.getItem('bcc_tokens')).toBeNull();
      expect(sessionStorage.getItem('bcc_user')).toBeNull();
    });

    it('navigates to /auth/login', async () => {
      await service.signOut();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('calls CognitoAccessor.signOut with the access token', async () => {
      await service.signOut();

      expect(cognitoSpy.signOut).toHaveBeenCalledWith('access-token');
    });
  });

  // ── signUp ───────────────────────────────────────────────────────────────

  describe('signUp()', () => {
    it('delegates to CognitoAccessor with email, password, name', async () => {
      cognitoSpy.signUp.and.returnValue(Promise.resolve({ success: true, data: 'user-sub-1' }));

      const result = await service.signUp('new@example.com', 'P@ssword1', 'New User');

      expect(result.success).toBeTrue();
      expect(cognitoSpy.signUp).toHaveBeenCalledWith('new@example.com', 'P@ssword1', 'New User');
    });
  });

  // ── confirmSignUp ────────────────────────────────────────────────────────

  describe('confirmSignUp()', () => {
    it('delegates to CognitoAccessor', async () => {
      cognitoSpy.confirmSignUp.and.returnValue(Promise.resolve({ success: true }));

      const result = await service.confirmSignUp('test@example.com', '123456');

      expect(result.success).toBeTrue();
      expect(cognitoSpy.confirmSignUp).toHaveBeenCalledWith('test@example.com', '123456');
    });
  });

  // ── forgotPassword ───────────────────────────────────────────────────────

  describe('forgotPassword()', () => {
    it('delegates to CognitoAccessor', async () => {
      cognitoSpy.forgotPassword.and.returnValue(Promise.resolve({ success: true }));

      const result = await service.forgotPassword('test@example.com');

      expect(result.success).toBeTrue();
      expect(cognitoSpy.forgotPassword).toHaveBeenCalledWith('test@example.com');
    });
  });

  // ── token persistence across page reloads ────────────────────────────────

  describe('state restoration from sessionStorage', () => {
    it('restores authenticated state from stored tokens', () => {
      sessionStorage.setItem('bcc_tokens', JSON.stringify(MOCK_TOKENS));
      sessionStorage.setItem('bcc_user', JSON.stringify(MOCK_USER));

      // Re-create service (simulates page reload within same session)
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          { provide: CognitoAccessor, useValue: cognitoSpy },
          { provide: Router, useValue: routerSpy },
        ],
      });
      const restored = TestBed.inject(AuthService);

      expect(restored.isAuthenticated).toBeTrue();
      expect(restored.idToken).toBe('id-token');
      expect(restored.currentUser?.email).toBe('test@example.com');
    });
  });

  // ── authState$ observable ────────────────────────────────────────────────

  describe('authState$', () => {
    it('emits new state after signIn', (done) => {
      cognitoSpy.signIn.and.returnValue(Promise.resolve({ success: true, data: MOCK_SIGN_IN_RESULT }));
      cognitoSpy.getUser.and.returnValue(Promise.resolve({ success: true, data: MOCK_USER }));

      const states: boolean[] = [];
      const sub = service.authState$.subscribe((s) => states.push(s.isAuthenticated));

      service.signIn('test@example.com', 'P@ssword1').then(() => {
        sub.unsubscribe();
        expect(states).toContain(true);
        done();
      });
    });
  });
});
