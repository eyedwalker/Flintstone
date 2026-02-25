import { Component, Output, EventEmitter, Input } from '@angular/core';
import { ContentType } from '../../../../lib/models/knowledge-base.model';

export interface IFileDropEvent {
  files: File[];
}

@Component({
  selector: 'bcc-file-uploader',
  templateUrl: './file-uploader.component.html',
  styleUrls: ['./file-uploader.component.scss'],
})
export class FileUploaderComponent {
  @Input() accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png';
  @Input() multiple = true;
  @Input() disabled = false;
  @Output() filesDropped = new EventEmitter<IFileDropEvent>();

  isDragOver = false;

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) this.filesDropped.emit({ files });
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) this.filesDropped.emit({ files });
    input.value = '';
  }
}
