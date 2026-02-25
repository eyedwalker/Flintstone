import { Component } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

interface INavItem {
  label: string;
  icon: string;
  route: string;
  exact?: boolean;
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
    { label: 'Hierarchy', icon: 'account_tree', route: '/hierarchy' },
    { label: 'Billing', icon: 'credit_card', route: '/billing' },
  ];

  currentUrl = '';

  constructor(private router: Router) {
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
}
