import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { KbListComponent } from './kb-list/kb-list.component';
import { KbDetailComponent } from './kb-detail/kb-detail.component';

const routes: Routes = [
  { path: '', component: KbListComponent },
  { path: ':id', component: KbDetailComponent },
];

@NgModule({
  declarations: [KbListComponent, KbDetailComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class KnowledgeBasesModule {}
