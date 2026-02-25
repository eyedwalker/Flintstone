import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'bcc-verify',
  templateUrl: './verify.component.html',
  styleUrls: ['./verify.component.scss'],
})
export class VerifyComponent implements OnInit {
  form: FormGroup;
  loading = false;
  resending = false;
  email = '';

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
  ) {
    this.form = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
  }

  ngOnInit(): void {
    this.email = this.route.snapshot.queryParamMap.get('email') ?? '';
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    const result = await this.auth.confirmSignUp(this.email, this.form.value.code);
    this.loading = false;
    if (result.success) {
      this.snackBar.open('Email verified! Please sign in.', '', { duration: 3000 });
      this.router.navigate(['/auth/onboarding'], { queryParams: { email: this.email } });
    } else {
      this.snackBar.open(result.error ?? 'Verification failed', 'OK', { duration: 4000 });
    }
  }

  async resend(): Promise<void> {
    this.resending = true;
    await this.auth.resendCode(this.email);
    this.resending = false;
    this.snackBar.open('Code resent — check your email', '', { duration: 3000 });
  }
}
