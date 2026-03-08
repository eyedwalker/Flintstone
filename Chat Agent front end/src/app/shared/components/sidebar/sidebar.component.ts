import { Component } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { OrgContextService } from '../../../core/services/org-context.service';
import { TeamRole } from '../../../../lib/models/tenant.model';

interface INavItem {
  label: string;
  icon: string;
  route: string;
  exact?: boolean;
  minRole?: TeamRole;
}

@Component({
  selector: 'bcc-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  readonly navItems: INavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/dashboard', exact: true },
    { label: 'Assistants', icon: 'smart_toy', route: '/assistants' },
    { label: 'Knowledge Bases', icon: 'menu_book', route: '/knowledge-bases' },
    { label: 'Screen Mappings', icon: 'map', route: '/screen-mappings' },
    { label: 'Test Suites', icon: 'science', route: '/test-suites' },
    { label: 'Hierarchy', icon: 'account_tree', route: '/hierarchy' },
    { label: 'Escalation', icon: 'support_agent', route: '/escalation', minRole: 'admin' },
    { label: 'Team', icon: 'group', route: '/team', minRole: 'admin' },
    { label: 'Billing', icon: 'credit_card', route: '/billing', minRole: 'admin' },
    { label: 'API Docs', icon: 'api', route: '/api-docs' },
  ];

  currentUrl = '';

  constructor(private router: Router, public orgCtx: OrgContextService) {
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd)
    ).subscribe((e) => {
      this.currentUrl = (e as NavigationEnd).url;
    });
    this.currentUrl = this.router.url;
  }

  isActive(route: string, exact?: boolean): boolean {
    if (exact) return this.currentUrl === route;
    return this.currentUrl.startsWith(route);
  }

  isVisible(item: INavItem): boolean {
    if (!item.minRole) return true;
    return this.orgCtx.hasRole(item.minRole);
  }
}
