import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ReportScheduleListComponent } from './report-schedule-list.component';
import { ReportScheduleDetailComponent } from './report-schedule-detail.component';
import { CreateScheduleDialogComponent } from './create-schedule-dialog.component';

const routes: Routes = [
  { path: '', component: ReportScheduleListComponent },
  { path: ':scheduleId', component: ReportScheduleDetailComponent },
];

@NgModule({
  declarations: [
    ReportScheduleListComponent,
    ReportScheduleDetailComponent,
    CreateScheduleDialogComponent,
  ],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ReportSchedulesModule {}
