import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { OrgContextService } from '../services/org-context.service';
import { TeamRole, ROLE_LEVEL } from '../../../lib/models/tenant.model';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private orgCtx: OrgContextService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const minRole = route.data['minRole'] as TeamRole | undefined;
    if (!minRole) return true;

    const currentRole = this.orgCtx.currentRole;
    if (!currentRole) return this.router.parseUrl('/dashboard');

    return ROLE_LEVEL[currentRole] >= ROLE_LEVEL[minRole]
      ? true
      : this.router.parseUrl('/dashboard');
  }
}
