import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

function passwordMatch(control: AbstractControl): ValidationErrors | null {
  const pass = control.get('password');
  const confirm = control.get('confirmPassword');
  return pass && confirm && pass.value !== confirm.value ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'bcc-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss'],
})
export class SignupComponent {
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
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      passwords: this.fb.group({
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', Validators.required],
      }, { validators: passwordMatch }),
      terms: [false, Validators.requiredTrue],
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    const { name, email, passwords } = this.form.value;
    const result = await this.auth.signUp(email, passwords.password, name);
    this.loading = false;
    if (result.success) {
      this.router.navigate(['/auth/verify'], { queryParams: { email } });
    } else {
      this.snackBar.open(result.error ?? 'Sign up failed', 'OK', { duration: 4000 });
    }
  }
}
