import {
  Component,
  Input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'bcc-snippet-display',
  templateUrl: './snippet-display.component.html',
  styleUrls: ['./snippet-display.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SnippetDisplayComponent {
  @Input() htmlSnippet = '';
  @Input() consoleSnippet = '';
  @Input() selfHostedSnippet = '';
  @Input() inlineSnippet = '';
  @Input() downloadUrl = '';

  activeTab: 'html' | 'console' | 'self-hosted' | 'inline' = 'html';

  constructor(private snackBar: MatSnackBar) {}

  get activeSnippet(): string {
    switch (this.activeTab) {
      case 'html': return this.htmlSnippet;
      case 'console': return this.consoleSnippet;
      case 'self-hosted': return this.selfHostedSnippet;
      case 'inline': return this.inlineSnippet;
    }
  }

  async copySnippet(): Promise<void> {
    await navigator.clipboard.writeText(this.activeSnippet);
    this.snackBar.open('Snippet copied to clipboard', '', { duration: 2000 });
  }

  downloadSnippet(): void {
    const ext = this.activeTab === 'html' ? 'html' : 'js';
    const blob = new Blob([this.activeSnippet], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assistant-embed.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadWidgetScript(): void {
    window.open(this.downloadUrl, '_blank');
  }
}
