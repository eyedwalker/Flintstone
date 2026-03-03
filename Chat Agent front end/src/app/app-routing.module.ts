import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';

const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },

  // Auth routes — guards applied per-route inside AuthModule
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.module').then((m) => m.AuthModule),
  },

  // Protected shell routes
  {
    path: '',
    canActivateChild: [AuthGuard],
    loadChildren: () => import('./features/shell/shell.module').then((m) => m.ShellModule),
  },

  { path: '**', redirectTo: '/dashboard' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled' })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
