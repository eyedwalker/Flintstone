import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ApiDocsComponent } from './api-docs.component';

const routes: Routes = [{ path: '', component: ApiDocsComponent }];

@NgModule({
  declarations: [ApiDocsComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ApiDocsModule {}
