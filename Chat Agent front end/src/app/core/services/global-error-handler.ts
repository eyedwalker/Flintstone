import { ErrorHandler, Injectable, NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(
    private snackBar: MatSnackBar,
    private zone: NgZone,
  ) {}

  handleError(error: unknown): void {
    // Log full error details to console for debugging
    console.error('[GlobalErrorHandler]', error);

    // Show a user-friendly notification (run inside zone to ensure change detection)
    this.zone.run(() => {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      // Truncate long messages
      const display = message.length > 120 ? message.slice(0, 120) + '...' : message;
      this.snackBar.open(display, 'Dismiss', { duration: 6000, panelClass: 'error-snackbar' });
    });
  }
}
