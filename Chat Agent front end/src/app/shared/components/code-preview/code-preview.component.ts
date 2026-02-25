import { Component, Input } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'bcc-code-preview',
  templateUrl: './code-preview.component.html',
  styleUrls: ['./code-preview.component.scss'],
})
export class CodePreviewComponent {
  @Input() code = '';
  @Input() language = 'html';
  @Input() label = 'Code';

  constructor(private snackBar: MatSnackBar) {}

  async copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code);
      this.snackBar.open('Copied to clipboard!', '', { duration: 2000 });
    } catch {
      this.snackBar.open('Copy failed — please select and copy manually', 'OK', { duration: 3000 });
    }
  }

  downloadCode(): void {
    const blob = new Blob([this.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `widget-embed.${this.language === 'html' ? 'html' : 'js'}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
