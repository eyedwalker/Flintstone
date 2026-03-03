import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IOrganizationMembership, TeamRole, ROLE_LEVEL } from '../../../lib/models/tenant.model';

const ORG_KEY = 'bcc_active_org';

@Injectable({ providedIn: 'root' })
export class OrgContextService {
  private activeOrgSubject = new BehaviorSubject<IOrganizationMembership | null>(this.loadStored());
  readonly activeOrg$: Observable<IOrganizationMembership | null> = this.activeOrgSubject.asObservable();

  private orgsSubject = new BehaviorSubject<IOrganizationMembership[]>([]);
  readonly orgs$: Observable<IOrganizationMembership[]> = this.orgsSubject.asObservable();

  get activeOrgId(): string | null {
    return this.activeOrgSubject.value?.organizationId ?? null;
  }

  get currentRole(): TeamRole | null {
    return this.activeOrgSubject.value?.role ?? null;
  }

  get activeOrg(): IOrganizationMembership | null {
    return this.activeOrgSubject.value;
  }

  get orgs(): IOrganizationMembership[] {
    return this.orgsSubject.value;
  }

  /** Check if user has at least the given role */
  hasRole(minRole: TeamRole): boolean {
    const role = this.currentRole;
    if (!role) return false;
    return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
  }

  /** Set the available organizations (called after login / org load) */
  setOrganizations(orgs: IOrganizationMembership[]): void {
    this.orgsSubject.next(orgs);

    // Auto-select if none active, or refresh role for current org
    const current = this.activeOrgSubject.value;
    if (current) {
      const updated = orgs.find(o => o.organizationId === current.organizationId);
      if (updated) {
        this.setActiveOrg(updated);
        return;
      }
    }
    if (orgs.length > 0) {
      this.setActiveOrg(orgs[0]);
    }
  }

  /** Switch the active organization */
  setActiveOrg(org: IOrganizationMembership): void {
    sessionStorage.setItem(ORG_KEY, JSON.stringify(org));
    this.activeOrgSubject.next(org);
  }

  /** Clear on sign out */
  clear(): void {
    sessionStorage.removeItem(ORG_KEY);
    this.activeOrgSubject.next(null);
    this.orgsSubject.next([]);
  }

  private loadStored(): IOrganizationMembership | null {
    try {
      const raw = sessionStorage.getItem(ORG_KEY);
      return raw ? JSON.parse(raw) as IOrganizationMembership : null;
    } catch {
      return null;
    }
  }
}
