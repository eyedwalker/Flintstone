import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { TeamComponent } from './team.component';
import { MfaSetupComponent } from './mfa-setup/mfa-setup.component';

const routes: Routes = [
  { path: '', component: TeamComponent },
  { path: 'mfa', component: MfaSetupComponent },
];

@NgModule({
  declarations: [TeamComponent, MfaSetupComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class TeamModule {}
