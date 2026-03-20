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
      {
        path: 'assistants',
        loadChildren: () => import('../assistants/assistants.module').then((m) => m.AssistantsModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      {
        path: 'knowledge-bases',
        loadChildren: () => import('../knowledge-bases/knowledge-bases.module').then((m) => m.KnowledgeBasesModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      {
        path: 'hierarchy',
        loadChildren: () => import('../hierarchy/hierarchy.module').then((m) => m.HierarchyModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
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
      {
        path: 'screen-mappings',
        loadChildren: () => import('../screen-mappings/screen-mappings.module').then((m) => m.ScreenMappingsModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      {
        path: 'test-suites',
        loadChildren: () => import('../test-suites/test-suites.module').then((m) => m.TestSuitesModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      {
        path: 'architecture',
        loadChildren: () => import('../architecture/architecture.module').then((m) => m.ArchitectureModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      {
        path: 'agent-training',
        loadChildren: () => import('../agent-training/agent-training.module').then((m) => m.AgentTrainingModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      {
        path: 'raft',
        loadChildren: () => import('../raft/raft.module').then((m) => m.RaftModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      {
        path: 'report-schedules',
        loadChildren: () => import('../report-schedules/report-schedules.module').then((m) => m.ReportSchedulesModule),
        canActivate: [RoleGuard],
        data: { minRole: 'admin' },
      },
      {
        path: 'api-docs',
        loadChildren: () => import('../api-docs/api-docs.module').then((m) => m.ApiDocsModule),
        canActivate: [RoleGuard],
        data: { minRole: 'viewer' },
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
];

@NgModule({
  declarations: [ShellComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ShellModule {}
