import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { SharedModule } from '../../shared/shared.module';
import { ScreenMappingsComponent } from './screen-mappings.component';
import { ScreenDetailDialogComponent } from './screen-detail-dialog.component';

const routes: Routes = [
  { path: '', component: ScreenMappingsComponent },
];

@NgModule({
  declarations: [ScreenMappingsComponent, ScreenDetailDialogComponent],
  imports: [SharedModule, DragDropModule, RouterModule.forChild(routes)],
})
export class ScreenMappingsModule {}
