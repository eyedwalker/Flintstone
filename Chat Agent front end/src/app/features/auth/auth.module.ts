import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { LoginComponent } from './login/login.component';
import { SignupComponent } from './signup/signup.component';
import { VerifyComponent } from './verify/verify.component';
import { OnboardingComponent } from './onboarding/onboarding.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'signup', component: SignupComponent },
  { path: 'verify', component: VerifyComponent },
  { path: 'onboarding', component: OnboardingComponent },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
];

@NgModule({
  declarations: [LoginComponent, SignupComponent, VerifyComponent, OnboardingComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AuthModule {}
