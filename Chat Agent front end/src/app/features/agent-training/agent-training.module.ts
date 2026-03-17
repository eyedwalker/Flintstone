import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AgentTrainingComponent } from './agent-training.component';

const routes: Routes = [
  { path: '', component: AgentTrainingComponent },
];

@NgModule({
  declarations: [AgentTrainingComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AgentTrainingModule {}
