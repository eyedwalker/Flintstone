import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ROLE_ACCESS_LEVELS } from '../../../../lib/models/knowledge-base.model';

export interface IEditContentData {
  title: string;
  scope: string;
  minRoleLevel: number;
  tags: string[];
}

export interface IEditContentResult {
  title?: string;
  scope?: string;
  minRoleLevel?: number;
  tags?: string[];
}

@Component({
  selector: 'bcc-edit-content-dialog',
  template: `
    <h2 mat-dialog-title>Edit Content</h2>
    <mat-dialog-content class="edit-content-form">
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Title</mat-label>
        <input matInput [(ngModel)]="data.title">
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Scope</mat-label>
        <mat-select [(value)]="data.scope">
          <mat-option value="tenant">Tenant only</mat-option>
          <mat-option value="global">Global (all)</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Access level</mat-label>
        <mat-select [(value)]="data.minRoleLevel">
          <mat-option *ngFor="let r of roleAccessLevels" [value]="r.value">{{ r.label }}</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Tags (comma-separated)</mat-label>
        <input matInput [(ngModel)]="tagsInput">
        <mat-hint>e.g. onboarding, faq, policy</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close(null)">Cancel</button>
      <button mat-flat-button color="primary" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .edit-content-form { display: flex; flex-direction: column; gap: 4px; min-width: 400px; }
    .full-width { width: 100%; }
  `],
})
export class EditContentDialogComponent {
  tagsInput: string;
  readonly roleAccessLevels = ROLE_ACCESS_LEVELS;

  constructor(
    public dialogRef: MatDialogRef<EditContentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: IEditContentData,
  ) {
    this.tagsInput = (data.tags ?? []).join(', ');
  }

  save(): void {
    const tags = this.tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    this.dialogRef.close({
      title: this.data.title,
      scope: this.data.scope,
      minRoleLevel: this.data.minRoleLevel,
      tags,
    } as IEditContentResult);
  }
}
