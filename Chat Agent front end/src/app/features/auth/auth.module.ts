import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { LoginComponent } from './login/login.component';
import { SignupComponent } from './signup/signup.component';
import { VerifyComponent } from './verify/verify.component';
import { OnboardingComponent } from './onboarding/onboarding.component';
import { GuestGuard } from '../../core/guards/guest.guard';
import { AuthGuard } from '../../core/guards/auth.guard';

const routes: Routes = [
  { path: 'login', canActivate: [GuestGuard], component: LoginComponent },
  { path: 'signup', canActivate: [GuestGuard], component: SignupComponent },
  { path: 'verify', canActivate: [GuestGuard], component: VerifyComponent },
  { path: 'onboarding', canActivate: [AuthGuard], component: OnboardingComponent },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
];

@NgModule({
  declarations: [LoginComponent, SignupComponent, VerifyComponent, OnboardingComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AuthModule {}
