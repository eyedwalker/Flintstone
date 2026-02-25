import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'bcc-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  form: FormGroup;
  loading = false;
  hidePassword = true;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    const { email, password } = this.form.value;
    const result = await this.auth.signIn(email, password);
    this.loading = false;
    if (result.success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.snackBar.open(result.error ?? 'Sign in failed', 'OK', { duration: 4000 });
    }
  }
}
