import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ShellComponent } from './shell.component';
import { RoleGuard } from '../../core/guards/role.guard';

const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'dashboard', loadChildren: () => import('../dashboard/dashboard.module').then((m) => m.DashboardModule) },
      { path: 'assistants', loadChildren: () => import('../assistants/assistants.module').then((m) => m.AssistantsModule) },
      { path: 'knowledge-bases', loadChildren: () => import('../knowledge-bases/knowledge-bases.module').then((m) => m.KnowledgeBasesModule) },
      { path: 'hierarchy', loadChildren: () => import('../hierarchy/hierarchy.module').then((m) => m.HierarchyModule) },
      {
        path: 'team',
        loadChildren: () => import('../team/team.module').then((m) => m.TeamModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      {
        path: 'escalation',
        loadChildren: () => import('../escalation/escalation.module').then((m) => m.EscalationModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      {
        path: 'billing',
        loadChildren: () => import('../billing/billing.module').then((m) => m.BillingModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      { path: 'api-docs', loadChildren: () => import('../api-docs/api-docs.module').then((m) => m.ApiDocsModule) },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
];

@NgModule({
  declarations: [ShellComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ShellModule {}
