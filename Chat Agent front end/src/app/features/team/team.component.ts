import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { OrgContextService } from '../../core/services/org-context.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ITeamMember, TeamRole } from '../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-team',
  templateUrl: './team.component.html',
  styleUrls: ['./team.component.scss'],
})
export class TeamComponent implements OnInit {
  members: ITeamMember[] = [];
  auditLog: Record<string, unknown>[] = [];
  loading = true;
  showAudit = false;

  // Invite form
  showInvite = false;
  inviteEmail = '';
  inviteName = '';
  inviteRole: TeamRole = 'editor';
  inviting = false;

  // Role change
  changingRole: string | null = null;

  readonly roles: TeamRole[] = ['viewer', 'editor', 'admin'];
  readonly displayedColumns = ['name', 'email', 'role', 'mfa', 'joined', 'actions'];

  constructor(
    private api: ApiService,
    public orgCtx: OrgContextService,
    private auth: AuthService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadMembers();
  }

  async loadMembers(): Promise<void> {
    this.loading = true;
    const res = await this.api.get<{ data: ITeamMember[] }>('/team/members');
    if (res.success && res.data?.data) {
      this.members = res.data.data;
    }
    this.loading = false;
  }

  async invite(): Promise<void> {
    if (!this.inviteEmail || !this.inviteName || this.inviting) return;
    this.inviting = true;
    const res = await this.api.post<{ success: boolean }>('/team/invite', {
      email: this.inviteEmail,
      name: this.inviteName,
      role: this.inviteRole,
    });
    this.inviting = false;

    if (res.success) {
      this.snackBar.open('Invitation sent! They will receive an email with a temporary password.', 'OK', { duration: 5000 });
      this.inviteEmail = '';
      this.inviteName = '';
      this.inviteRole = 'editor';
      this.showInvite = false;
      await this.loadMembers();
    } else {
      this.snackBar.open(res.error ?? 'Failed to invite', 'OK', { duration: 4000 });
    }
  }

  async changeRole(member: ITeamMember, newRole: TeamRole): Promise<void> {
    this.changingRole = member.userId;
    const res = await this.api.put(`/team/members/${member.userId}/role`, { role: newRole });
    this.changingRole = null;

    if (res.success) {
      this.snackBar.open(`Role updated to ${newRole}`, 'OK', { duration: 3000 });
      await this.loadMembers();
    } else {
      this.snackBar.open(res.error ?? 'Failed to change role', 'OK', { duration: 4000 });
    }
  }

  async removeMember(member: ITeamMember): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Team Member',
        message: `Are you sure you want to remove ${member.name} (${member.email}) from the team? They will lose access to this organization.`,
        confirmLabel: 'Remove',
        destructive: true,
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    const res = await this.api.delete(`/team/members/${member.userId}`);
    if (res.success) {
      this.snackBar.open('Member removed', 'OK', { duration: 3000 });
      await this.loadMembers();
    } else {
      this.snackBar.open(res.error ?? 'Failed to remove member', 'OK', { duration: 4000 });
    }
  }

  async loadAuditLog(): Promise<void> {
    this.showAudit = true;
    const res = await this.api.get<{ data: { items: Record<string, unknown>[] } }>('/team/audit-log');
    if (res.success && res.data?.data) {
      this.auditLog = res.data.data.items;
    }
  }

  isCurrentUser(member: ITeamMember): boolean {
    return member.userId === this.auth.currentUser?.sub;
  }

  canChangeRole(member: ITeamMember): boolean {
    if (this.isCurrentUser(member)) return false;
    if (member.role === 'owner') return this.orgCtx.hasRole('owner');
    return this.orgCtx.hasRole('admin');
  }

  canRemove(member: ITeamMember): boolean {
    if (this.isCurrentUser(member)) return false;
    if (member.role === 'owner') return false;
    return this.orgCtx.hasRole('admin');
  }

  roleLabel(role: TeamRole): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }
}
