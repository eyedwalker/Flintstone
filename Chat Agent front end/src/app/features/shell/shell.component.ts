import { Component, OnInit, OnDestroy } from '@angular/core';
import { DemoWidgetService } from '../../core/services/demo-widget.service';

@Component({
  selector: 'bcc-shell',
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent implements OnInit, OnDestroy {
  constructor(private demoWidget: DemoWidgetService) {}

  ngOnInit(): void {
    this.demoWidget.bootstrap();
  }

  ngOnDestroy(): void {
    this.demoWidget.teardownAll();
  }
}
