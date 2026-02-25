import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

/** Stripe Checkout redirect — handles plan upgrade flow */
@Component({
  selector: 'bcc-upgrade',
  templateUrl: './upgrade.component.html',
  styleUrls: ['./upgrade.component.scss'],
})
export class UpgradeComponent implements OnInit {
  plan = '';
  loading = true;
  error = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.plan = this.route.snapshot.queryParamMap.get('plan') ?? '';

    if (!this.plan) {
      this.error = 'Invalid upgrade request.';
      this.loading = false;
      return;
    }

    await this.startCheckout();
  }

  private async startCheckout(): Promise<void> {
    const result = await this.api.post<{ url: string }>('/billing/checkout', {
      planTier: this.plan,
      interval: 'month',
      successUrl: `${window.location.origin}/dashboard?upgraded=true`,
      cancelUrl: `${window.location.origin}/billing`,
    });

    if (result.success && result.data?.url) {
      window.location.href = result.data.url;
    } else {
      this.error = result.error ?? 'Checkout session creation failed.';
      this.loading = false;
    }
  }

  goBack(): void { this.router.navigate(['/billing']); }
}
