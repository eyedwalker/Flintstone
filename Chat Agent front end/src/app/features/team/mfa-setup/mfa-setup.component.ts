import { Component } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

type MfaStep = 'intro' | 'qr' | 'verify' | 'done';

@Component({
  selector: 'bcc-mfa-setup',
  templateUrl: './mfa-setup.component.html',
  styleUrls: ['./mfa-setup.component.scss'],
})
export class MfaSetupComponent {
  step: MfaStep = 'intro';
  secretCode = '';
  totpUri = '';
  verifyCode = '';
  loading = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
  ) {}

  async beginSetup(): Promise<void> {
    this.loading = true;
    const accessToken = this.auth.accessToken;
    if (!accessToken) {
      this.snackBar.open('You must be signed in', 'OK', { duration: 3000 });
      this.loading = false;
      return;
    }

    const res = await this.api.post<{ data: { secretCode: string } }>('/team/mfa/setup', {
      accessToken,
    });
    this.loading = false;

    if (res.success && res.data?.data?.secretCode) {
      this.secretCode = res.data.data.secretCode;
      const email = this.auth.currentUser?.email ?? 'user';
      this.totpUri = `otpauth://totp/BedrockChat:${email}?secret=${this.secretCode}&issuer=BedrockChat`;
      this.step = 'qr';
    } else {
      this.snackBar.open(res.error ?? 'Failed to start MFA setup', 'OK', { duration: 4000 });
    }
  }

  async verifyMfa(): Promise<void> {
    if (!this.verifyCode || this.verifyCode.length !== 6) return;
    this.loading = true;

    const accessToken = this.auth.accessToken;
    const res = await this.api.post<{ data: { verified: boolean } }>('/team/mfa/verify', {
      accessToken,
      totpCode: this.verifyCode,
    });
    this.loading = false;

    if (res.success && res.data?.data?.verified) {
      this.step = 'done';
      this.snackBar.open('MFA enabled successfully!', 'OK', { duration: 4000 });
    } else {
      this.snackBar.open('Invalid code. Please try again.', 'OK', { duration: 3000 });
    }
  }

  goBack(): void {
    this.router.navigate(['/team']);
  }
}
