import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { RaftDashboardComponent } from './raft-dashboard.component';

const routes: Routes = [
  { path: '', component: RaftDashboardComponent },
];

@NgModule({
  declarations: [RaftDashboardComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class RaftModule {}
