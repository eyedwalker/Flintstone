import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ScreenMappingManager } from '../../../lib/managers/screen-mapping.manager';
import { IScreenMapping, IScreenVideo, IScreenHelpArticle } from '../../../lib/models/screen-mapping.model';

@Component({
  selector: 'bcc-screen-detail-dialog',
  templateUrl: './screen-detail-dialog.component.html',
  styleUrls: ['./screen-detail-dialog.component.scss'],
})
export class ScreenDetailDialogComponent {
  mapping: IScreenMapping;
  saving = false;
  newQuestion = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { mapping: IScreenMapping },
    private dialogRef: MatDialogRef<ScreenDetailDialogComponent>,
    private screenMappingManager: ScreenMappingManager,
    private snackBar: MatSnackBar,
  ) {
    this.mapping = data.mapping;
    // Normalize: ensure helpArticles exists
    if (!this.mapping.helpArticles) this.mapping.helpArticles = [];
    // Normalize: ensure trendingQuestions are strings (AI may return objects)
    this.mapping.trendingQuestions = (this.mapping.trendingQuestions || []).map((q: any) =>
      typeof q === 'string' ? q : q.question ?? q.text ?? String(q),
    );
  }

  dropVideo(event: CdkDragDrop<IScreenVideo[]>): void {
    moveItemInArray(this.mapping.videos, event.previousIndex, event.currentIndex);
  }

  dropQuestion(event: CdkDragDrop<string[]>): void {
    moveItemInArray(this.mapping.trendingQuestions, event.previousIndex, event.currentIndex);
  }

  togglePin(video: IScreenVideo): void {
    video.pinned = !video.pinned;
  }

  removeVideo(index: number): void {
    this.mapping.videos.splice(index, 1);
  }

  dropArticle(event: CdkDragDrop<IScreenHelpArticle[]>): void {
    moveItemInArray(this.mapping.helpArticles, event.previousIndex, event.currentIndex);
  }

  removeArticle(index: number): void {
    this.mapping.helpArticles.splice(index, 1);
  }

  addQuestion(): void {
    const q = this.newQuestion.trim();
    if (!q) return;
    this.mapping.trendingQuestions.push(q);
    this.newQuestion = '';
  }

  removeQuestion(index: number): void {
    this.mapping.trendingQuestions.splice(index, 1);
  }

  async save(): Promise<void> {
    this.saving = true;
    const res = await this.screenMappingManager.updateMapping(this.mapping.id, {
      videos: this.mapping.videos,
      helpArticles: this.mapping.helpArticles,
      trendingQuestions: this.mapping.trendingQuestions,
      status: 'reviewed',
    });
    this.saving = false;

    if (res.success) {
      this.snackBar.open('Mapping saved', '', { duration: 2000 });
      this.mapping.status = 'reviewed';
      this.dialogRef.close(this.mapping);
    } else {
      this.snackBar.open(`Save failed: ${res.error}`, 'Dismiss', { duration: 4000 });
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  openUrl(url: string): void {
    window.open(url, '_blank');
  }

  vimeoThumb(video: IScreenVideo): string {
    return video.vimeoId ? `https://vumbnail.com/${video.vimeoId}.jpg` : '';
  }
}
