import { PlanTier, SubscriptionStatus } from './tenant.model';

/** Stripe plan definition */
export interface IStripePlan {
  tier: PlanTier;
  name: string;
  description: string;
  price: number;
  interval: 'month' | 'year';
  stripePriceId: string;
  features: string[];
  limits: {
    assistants: number | 'unlimited';
    messagesPerMonth: number | 'unlimited';
    storageGB: number | 'unlimited';
    models: string;
    selfHosted: boolean;
  };
  highlighted: boolean;
}

/** Current subscription state */
export interface ISubscription {
  id: string;
  tenantId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  defaultPaymentMethod?: IPaymentMethod;
  upcomingInvoice?: IUpcomingInvoice;
}

/** Saved payment method */
export interface IPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Upcoming invoice preview */
export interface IUpcomingInvoice {
  amountDue: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  lineItems: IInvoiceLineItem[];
}

export interface IInvoiceLineItem {
  description: string;
  amount: number;
  quantity?: number;
}

/** Historical invoice */
export interface IInvoice {
  id: string;
  number: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  amountPaid: number;
  currency: string;
  created: string;
  pdfUrl: string;
  hostedUrl: string;
}

/** Stripe Checkout session creation request */
export interface ICreateCheckoutSessionRequest {
  tenantId: string;
  planTier: PlanTier;
  interval: 'month' | 'year';
  successUrl: string;
  cancelUrl: string;
}

/** Stripe Customer Portal session creation request */
export interface ICreatePortalSessionRequest {
  tenantId: string;
  returnUrl: string;
}
