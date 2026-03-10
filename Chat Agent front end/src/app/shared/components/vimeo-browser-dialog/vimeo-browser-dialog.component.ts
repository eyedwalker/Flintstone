import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { KnowledgeBaseManager } from '../../../../lib/managers/knowledge-base.manager';
import { IVimeoVideoItem, IVimeoFolder } from '../../../../lib/models/knowledge-base.model';

export interface IVimeoBrowserData {
  assistantId: string;
  kbManager: KnowledgeBaseManager;
  kbDefId?: string;
  excludeKeywords?: string[];
}

@Component({
  selector: 'bcc-vimeo-browser-dialog',
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="vimeo-title-icon">video_library</mat-icon>
      Browse Vimeo Library
      <span class="vimeo-total" *ngIf="total > 0">{{ total }} videos</span>
    </h2>

    <mat-dialog-content>
      <!-- Folder bar -->
      <div class="folder-bar" *ngIf="folders.length > 0">
        <button class="folder-chip" [class.active]="!selectedFolderId"
                (click)="selectFolder(null)">
          All Videos
        </button>
        <button class="folder-chip" *ngFor="let folder of folders"
                [class.active]="selectedFolderId === folder.id"
                (click)="selectFolder(folder.id)">
          {{ folder.name }}
          <span class="folder-count">{{ folder.videoCount }}</span>
        </button>
      </div>
      <div class="folder-bar-loading" *ngIf="foldersLoading">
        <mat-spinner diameter="16"></mat-spinner>
        <span>Loading folders...</span>
      </div>

      <!-- Search -->
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Search videos</mat-label>
        <input matInput [(ngModel)]="searchQuery" (keyup.enter)="search()"
               placeholder="Filter by title...">
        <button mat-icon-button matSuffix *ngIf="searchQuery" (click)="searchQuery = ''; search()" type="button">
          <mat-icon>close</mat-icon>
        </button>
        <mat-icon matSuffix *ngIf="!searchQuery">search</mat-icon>
      </mat-form-field>

      <!-- Exclude keywords indicator -->
      <div class="exclude-indicator" *ngIf="data.excludeKeywords?.length">
        <mat-icon>filter_list</mat-icon>
        <span>Filtering out: {{ data.excludeKeywords!.join(', ') }}</span>
      </div>

      <!-- Loading -->
      <div class="loading-state" *ngIf="loading && videos.length === 0">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading videos from Vimeo...</p>
      </div>

      <!-- Error -->
      <div class="error-state" *ngIf="errorMessage">
        <mat-icon color="warn">error_outline</mat-icon>
        <span>{{ errorMessage }}</span>
      </div>

      <!-- Video grid -->
      <div class="video-grid" *ngIf="videos.length > 0">
        <div class="video-card" *ngFor="let video of videos"
             [class.selected]="selectedIds.has(video.videoId)"
             [class.imported]="video.alreadyImported"
             (click)="!video.alreadyImported && toggleSelect(video.videoId)">

          <div class="video-thumb-wrap">
            <img *ngIf="video.thumbnailUrl" [src]="video.thumbnailUrl"
                 class="video-thumb" alt="" loading="lazy">
            <div class="video-thumb-placeholder" *ngIf="!video.thumbnailUrl">
              <mat-icon>videocam</mat-icon>
            </div>
            <span class="video-duration">{{ formatDuration(video.duration) }}</span>
            <mat-checkbox class="video-check" *ngIf="!video.alreadyImported"
                          [checked]="selectedIds.has(video.videoId)"
                          (click)="$event.stopPropagation()"
                          (change)="toggleSelect(video.videoId)">
            </mat-checkbox>
            <span class="imported-badge" *ngIf="video.alreadyImported">Imported</span>
          </div>

          <div class="video-info">
            <span class="video-name">{{ video.name }}</span>
            <span class="video-date">{{ video.createdTime | date:'mediumDate' }}</span>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div class="empty-state" *ngIf="!loading && videos.length === 0 && !errorMessage">
        <mat-icon>video_library</mat-icon>
        <p>No videos found</p>
      </div>

      <!-- Load more -->
      <div class="load-more" *ngIf="hasMore && !loading">
        <button mat-stroked-button type="button" (click)="loadMore()">
          Load More
        </button>
      </div>
      <div class="load-more" *ngIf="loading && videos.length > 0">
        <mat-spinner diameter="24"></mat-spinner>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button class="select-all-btn" *ngIf="selectableCount > 0"
              (click)="allSelected ? deselectAll() : selectAll()">
        <mat-icon>{{ allSelected ? 'deselect' : 'select_all' }}</mat-icon>
        {{ allSelected ? 'Deselect All' : 'Select All' }} ({{ selectableCount }})
      </button>
      <span class="selection-count" *ngIf="selectedIds.size > 0">
        {{ selectedIds.size }} selected
      </span>
      <button mat-button (click)="dialogRef.close(null)">Cancel</button>
      <button mat-flat-button color="primary"
              [disabled]="selectedIds.size === 0"
              (click)="importSelected()">
        <mat-icon>download</mat-icon>
        Import {{ selectedIds.size || '' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }

    .vimeo-title-icon { vertical-align: middle; margin-right: 6px; color: #1ab7ea; }
    .vimeo-total { font-size: 0.78rem; font-weight: 400; color: rgba(0,0,0,0.45); margin-left: 8px; }

    .folder-bar {
      display: flex; gap: 6px; padding: 4px 0 12px;
      overflow-x: auto; white-space: nowrap;
      scrollbar-width: thin;
    }
    .folder-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 12px; border-radius: 16px;
      border: 1px solid rgba(0,0,0,0.15);
      background: #fff; color: #333;
      font-size: 0.8rem; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
      flex-shrink: 0;
      &:hover { background: #f5f5f5; border-color: rgba(0,0,0,0.25); }
      &.active { background: #006FB4; color: #fff; border-color: #006FB4; }
    }
    .folder-count {
      font-size: 0.7rem; font-weight: 700;
      background: rgba(0,0,0,0.08); border-radius: 8px;
      padding: 1px 6px; min-width: 18px; text-align: center;
    }
    .folder-chip.active .folder-count {
      background: rgba(255,255,255,0.25);
    }
    .folder-bar-loading {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 0 12px; font-size: 0.8rem; color: rgba(0,0,0,0.45);
    }

    .exclude-indicator {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; margin-bottom: 10px;
      background: #fff3e0; border-radius: 6px;
      font-size: 0.78rem; color: #e65100;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .search-field { width: 100%; margin-bottom: 8px; }

    .loading-state, .empty-state, .error-state {
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; padding: 32px 0; color: rgba(0,0,0,0.45);
    }
    .error-state { flex-direction: row; color: #c62828; gap: 8px; justify-content: center; }

    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .video-card {
      border-radius: 8px;
      border: 2px solid transparent;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
      &.selected { border-color: #006FB4; box-shadow: 0 0 0 1px #006FB4; }
      &.imported { opacity: 0.6; cursor: default; }
    }

    .video-thumb-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 16/9;
      background: #f0f0f0;
      overflow: hidden;
    }
    .video-thumb { width: 100%; height: 100%; object-fit: cover; }
    .video-thumb-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      mat-icon { font-size: 40px; width: 40px; height: 40px; color: rgba(0,0,0,0.2); }
    }

    .video-duration {
      position: absolute; bottom: 4px; right: 4px;
      background: rgba(0,0,0,0.75); color: #fff;
      font-size: 0.7rem; font-weight: 600;
      padding: 1px 5px; border-radius: 3px;
    }

    .video-check {
      position: absolute; top: 4px; left: 4px;
    }

    .imported-badge {
      position: absolute; top: 4px; left: 4px;
      background: rgba(76,175,80,0.9); color: #fff;
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      padding: 2px 6px; border-radius: 4px;
    }

    .video-info { padding: 8px 10px; }
    .video-name {
      display: block; font-size: 0.82rem; font-weight: 600; color: #1a2332;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .video-date { font-size: 0.72rem; color: rgba(0,0,0,0.4); }

    .load-more { display: flex; justify-content: center; padding: 16px 0; }

    .select-all-btn { font-size: 0.8rem; margin-right: auto; }
    .selection-count { font-size: 0.85rem; font-weight: 600; color: #006FB4; margin-right: 8px; }

    mat-dialog-content { max-height: 60vh; overflow-y: auto; min-height: 200px; }
    mat-dialog-actions { padding: 12px 0 0; }
  `],
})
export class VimeoBrowserDialogComponent implements OnInit {
  videos: IVimeoVideoItem[] = [];
  folders: IVimeoFolder[] = [];
  selectedFolderId: string | null = null;
  foldersLoading = false;
  selectedIds = new Set<string>();
  loading = false;
  errorMessage = '';
  searchQuery = '';
  total = 0;
  hasMore = false;
  private currentPage = 1;

  constructor(
    public dialogRef: MatDialogRef<VimeoBrowserDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: IVimeoBrowserData,
  ) {}

  ngOnInit(): void {
    this.loadFolders();
    this.loadVideos(1);
  }

  async loadFolders(): Promise<void> {
    this.foldersLoading = true;
    try {
      const result = await this.data.kbManager.listVimeoFolders(
        this.data.assistantId, this.data.kbDefId,
      );
      if (result.success && result.data) {
        this.folders = result.data.folders;
      }
    } catch { /* folders are optional */ }
    this.foldersLoading = false;
  }

  selectFolder(folderId: string | null): void {
    this.selectedFolderId = folderId;
    this.loadVideos(1);
  }

  async loadVideos(page: number): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const result = await this.data.kbManager.browseVimeo(
        this.data.assistantId, page, 25, this.searchQuery || undefined,
        this.data.kbDefId, this.selectedFolderId ?? undefined,
      );
      if (!result.success) {
        this.errorMessage = result.error ?? 'Failed to load videos';
        return;
      }
      let vids = result.data!.videos;

      // Client-side exclude filtering (defense-in-depth, backend also filters)
      if (this.data.excludeKeywords?.length) {
        const lowerKws = this.data.excludeKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
        vids = vids.filter(v => {
          const text = `${v.name} ${v.description}`.toLowerCase();
          return !lowerKws.some(kw => text.includes(kw));
        });
      }

      if (page === 1) {
        this.videos = vids;
      } else {
        this.videos = [...this.videos, ...vids];
      }
      this.total = result.data!.total;
      this.hasMore = result.data!.hasMore;
      this.currentPage = page;
    } catch (e: any) {
      this.errorMessage = e?.message ?? 'Failed to load videos';
    } finally {
      this.loading = false;
    }
  }

  search(): void {
    this.loadVideos(1);
  }

  loadMore(): void {
    this.loadVideos(this.currentPage + 1);
  }

  toggleSelect(videoId: string): void {
    if (this.selectedIds.has(videoId)) {
      this.selectedIds.delete(videoId);
    } else {
      this.selectedIds.add(videoId);
    }
  }

  get selectableVideos(): IVimeoVideoItem[] {
    return this.videos.filter(v => !v.alreadyImported);
  }

  get selectableCount(): number {
    return this.selectableVideos.length;
  }

  get allSelected(): boolean {
    return this.selectableCount > 0 && this.selectableVideos.every(v => this.selectedIds.has(v.videoId));
  }

  selectAll(): void {
    for (const v of this.selectableVideos) {
      this.selectedIds.add(v.videoId);
    }
  }

  deselectAll(): void {
    this.selectedIds.clear();
  }

  importSelected(): void {
    this.dialogRef.close(Array.from(this.selectedIds));
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
