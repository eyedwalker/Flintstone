import { Component, Input } from '@angular/core';

@Component({
  selector: 'bcc-metric-card',
  templateUrl: './metric-card.component.html',
  styleUrls: ['./metric-card.component.scss'],
})
export class MetricCardComponent {
  @Input() label = '';
  @Input() value: string | number = 0;
  @Input() icon = 'analytics';
  @Input() trend?: number;
  @Input() unit?: string;
  @Input() color: 'primary' | 'accent' | 'warn' | 'success' = 'primary';
}
