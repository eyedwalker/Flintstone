import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { OrgContextService } from '../../core/services/org-context.service';
import { DemoWidgetService } from '../../core/services/demo-widget.service';

@Component({
  selector: 'bcc-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  isTester = false;
  hasDemoWidget = false;
  private sub?: Subscription;

  constructor(
    private orgCtx: OrgContextService,
    private demoWidget: DemoWidgetService,
  ) {}

  ngOnInit(): void {
    this.isTester = this.orgCtx.currentRole === 'tester';
    this.sub = this.demoWidget.isDemoActive$.subscribe(
      (active) => (this.hasDemoWidget = active),
    );
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
