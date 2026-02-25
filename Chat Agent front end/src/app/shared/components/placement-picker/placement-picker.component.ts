import { Component, Input, Output, EventEmitter } from '@angular/core';
import { WidgetPosition } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-placement-picker',
  templateUrl: './placement-picker.component.html',
  styleUrls: ['./placement-picker.component.scss'],
})
export class PlacementPickerComponent {
  @Input() value: WidgetPosition = 'bottom-right';
  @Output() valueChange = new EventEmitter<WidgetPosition>();

  positions: { value: WidgetPosition; label: string; row: number; col: number }[] = [
    { value: 'top-left', label: 'Top Left', row: 1, col: 1 },
    { value: 'top-right', label: 'Top Right', row: 1, col: 2 },
    { value: 'bottom-left', label: 'Bottom Left', row: 2, col: 1 },
    { value: 'bottom-right', label: 'Bottom Right', row: 2, col: 2 },
  ];

  select(position: WidgetPosition): void {
    this.value = position;
    this.valueChange.emit(position);
  }
}
