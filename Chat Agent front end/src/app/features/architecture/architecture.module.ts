import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ArchitectureComponent } from './architecture.component';

const routes: Routes = [{ path: '', component: ArchitectureComponent }];

@NgModule({
  declarations: [ArchitectureComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ArchitectureModule {}
