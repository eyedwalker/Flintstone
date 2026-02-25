import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ShellComponent } from './shell.component';

const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'dashboard', loadChildren: () => import('../dashboard/dashboard.module').then((m) => m.DashboardModule) },
      { path: 'assistants', loadChildren: () => import('../assistants/assistants.module').then((m) => m.AssistantsModule) },
      { path: 'hierarchy', loadChildren: () => import('../hierarchy/hierarchy.module').then((m) => m.HierarchyModule) },
      { path: 'billing', loadChildren: () => import('../billing/billing.module').then((m) => m.BillingModule) },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
];

@NgModule({
  declarations: [ShellComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ShellModule {}
