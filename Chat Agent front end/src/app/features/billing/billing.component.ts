import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { IStripePlan } from '../../../lib/models/billing.model';
import { ITenant } from '../../../lib/models/tenant.model';
import { environment } from '../../../environments/environment';

/** Billing page — current plan, usage meters, plan comparison, customer portal */
@Component({
  selector: 'bcc-billing',
  templateUrl: './billing.component.html',
  styleUrls: ['./billing.component.scss'],
})
export class BillingComponent implements OnInit {
  tenant: ITenant | null = null;
  loading = true;
  billingInterval: 'month' | 'year' = 'month';

  readonly plans: IStripePlan[] = [
    {
      tier: 'free', name: 'Free', description: 'For individuals getting started', price: 0,
      interval: 'month', stripePriceId: '', highlighted: false,
      features: ['1 assistant', '500 messages/mo', '100 MB storage', 'Claude 3 Haiku only'],
      limits: { assistants: 1, messagesPerMonth: 500, storageGB: 0.1, models: 'Claude 3 Haiku', selfHosted: false },
    },
    {
      tier: 'starter', name: 'Starter', description: 'For small teams', price: 49,
      interval: 'month', stripePriceId: environment.stripe.starterMonthlyPriceId, highlighted: false,
      features: ['5 assistants', '10K messages/mo', '5 GB storage', 'Claude + Nova + Llama', 'Analytics'],
      limits: { assistants: 5, messagesPerMonth: 10000, storageGB: 5, models: 'Claude, Nova, Llama', selfHosted: false },
    },
    {
      tier: 'pro', name: 'Pro', description: 'For growing businesses', price: 199,
      interval: 'month', stripePriceId: environment.stripe.proMonthlyPriceId, highlighted: true,
      features: ['25 assistants', '100K messages/mo', '50 GB storage', 'All models incl. Opus', 'Priority support', 'Custom hierarchy'],
      limits: { assistants: 25, messagesPerMonth: 100000, storageGB: 50, models: 'All models', selfHosted: false },
    },
    {
      tier: 'enterprise', name: 'Enterprise', description: 'Unlimited, self-hosted', price: 0,
      interval: 'month', stripePriceId: '', highlighted: false,
      features: ['Unlimited assistants', 'Unlimited messages', 'Self-hosted GPU models', 'SLA + dedicated support', 'Custom contracts'],
      limits: { assistants: 'unlimited', messagesPerMonth: 'unlimited', storageGB: 'unlimited', models: 'All + self-hosted', selfHosted: true },
    },
  ];

  constructor(
    private api: ApiService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const result = await this.api.get<ITenant>('/tenants/me');
    this.tenant = result.data ?? null;
    this.loading = false;
  }

  get currentPlan(): IStripePlan | undefined {
    return this.plans.find((p) => p.tier === this.tenant?.plan);
  }

  get usagePct(): number {
    const used = this.tenant?.usageCurrentMonth.messages ?? 0;
    const limit = this.tenant?.limits.maxMessagesPerMonth ?? 1;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  get storagePct(): number {
    const used = this.tenant?.usageCurrentMonth.storageBytes ?? 0;
    const limit = this.tenant?.limits.maxStorageBytes ?? 1;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  formatBytes(bytes: number): string {
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  getPrice(plan: IStripePlan): number {
    return this.billingInterval === 'year' ? Math.round(plan.price * 12 * 0.8) : plan.price;
  }

  upgrade(plan: IStripePlan): void {
    if (plan.tier === 'enterprise') {
      window.open('mailto:sales@yourdomain.com?subject=Enterprise Inquiry', '_blank');
      return;
    }
    this.router.navigate(['/billing/upgrade'], { queryParams: { plan: plan.tier } });
  }

  async openPortal(): Promise<void> {
    const result = await this.api.get<{ url: string }>('/billing/portal-url');
    if (result.success && result.data?.url) {
      window.open(result.data.url, '_blank');
    }
  }
}
