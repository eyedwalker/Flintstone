import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { OrgContextService } from '../../../core/services/org-context.service';
import { ApiService } from '../../../core/services/api.service';
import { ICognitoChallenge } from '../../../../lib/accessors/cognito.accessor';
import { IOrganizationMembership } from '../../../../lib/models/tenant.model';

type LoginStep = 'credentials' | 'mfa' | 'new_password';

@Component({
  selector: 'bcc-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  form: FormGroup;
  mfaForm: FormGroup;
  newPasswordForm: FormGroup;

  step: LoginStep = 'credentials';
  loading = false;
  hidePassword = true;
  hideNewPassword = true;

  private pendingChallenge: ICognitoChallenge | null = null;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private orgCtx: OrgContextService,
    private api: ApiService,
    private router: Router,
    private snackBar: MatSnackBar,
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
    this.mfaForm = this.fb.group({
      totpCode: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
    this.newPasswordForm = this.fb.group({
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    const { email, password } = this.form.value;
    const outcome = await this.auth.signIn(email, password);
    this.loading = false;

    switch (outcome.status) {
      case 'success':
        await this.loadOrgsAndNavigate();
        break;
      case 'mfa_required':
        this.pendingChallenge = outcome.challenge;
        this.step = 'mfa';
        break;
      case 'new_password_required':
        this.pendingChallenge = outcome.challenge;
        this.step = 'new_password';
        break;
      case 'error':
        this.snackBar.open(outcome.error, 'OK', { duration: 4000 });
        break;
    }
  }

  async submitMfa(): Promise<void> {
    if (this.mfaForm.invalid || this.loading || !this.pendingChallenge) return;
    this.loading = true;
    const { totpCode } = this.mfaForm.value;
    const outcome = await this.auth.respondToMfaChallenge(
      this.pendingChallenge.session, this.pendingChallenge.username, totpCode
    );
    this.loading = false;

    if (outcome.status === 'success') {
      await this.loadOrgsAndNavigate();
    } else if (outcome.status === 'error') {
      this.snackBar.open(outcome.error, 'OK', { duration: 4000 });
    }
  }

  async submitNewPassword(): Promise<void> {
    if (this.newPasswordForm.invalid || this.loading || !this.pendingChallenge) return;
    const { newPassword, confirmPassword } = this.newPasswordForm.value;
    if (newPassword !== confirmPassword) {
      this.snackBar.open('Passwords do not match', 'OK', { duration: 3000 });
      return;
    }

    this.loading = true;
    const outcome = await this.auth.respondToNewPasswordChallenge(
      this.pendingChallenge.session, this.pendingChallenge.username, newPassword
    );
    this.loading = false;

    switch (outcome.status) {
      case 'success':
        await this.loadOrgsAndNavigate();
        break;
      case 'mfa_required':
        this.pendingChallenge = outcome.challenge;
        this.step = 'mfa';
        break;
      case 'error':
        this.snackBar.open(outcome.error, 'OK', { duration: 4000 });
        break;
    }
  }

  private async loadOrgsAndNavigate(): Promise<void> {
    // Load user's organizations — API returns array directly
    const orgsResult = await this.api.get<IOrganizationMembership[]>('/team/my-orgs');
    if (orgsResult.success && Array.isArray(orgsResult.data)) {
      this.orgCtx.setOrganizations(orgsResult.data);
    }
    this.router.navigate(['/dashboard']);
  }
}
