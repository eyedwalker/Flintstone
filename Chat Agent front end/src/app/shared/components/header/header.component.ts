import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { OrgContextService } from '../../../core/services/org-context.service';
import { IOrganizationMembership } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
  constructor(
    public auth: AuthService,
    public orgCtx: OrgContextService,
    private router: Router,
  ) {}

  switchOrg(org: IOrganizationMembership): void {
    this.orgCtx.setActiveOrg(org);
    // Reload current route to refresh data for the new org
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/dashboard']);
    });
  }

  async signOut(): Promise<void> {
    this.orgCtx.clear();
    await this.auth.signOut();
  }
}
