import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { EscalationConfigComponent } from './escalation-config/escalation-config.component';

const routes: Routes = [
  { path: '', component: EscalationConfigComponent },
];

@NgModule({
  declarations: [EscalationConfigComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class EscalationModule {}
