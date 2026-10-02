/** Respuestas del backend de pagos (contrato en bloomx-backend), tal como las reenvia /api/admin/billing/**. Importes en centavos enteros. */

export interface PaymentsStatus {
    configured: boolean;
    env: 'sandbox' | 'live' | null;
    currency: string;
    developerShareBps: number;
    platformShareBps: number;
    minPriceCents: number;
    maxPriceCents: number;
    holdDays: number;
    payoutMinCents: number;
    trialMaxDays: number;
    tablesReady: boolean;
    termsVersion?: string;
}

export interface BillingSummary {
    range: { from: string; to: string };
    currency: string;
    income: { grossCents: number; platformFeeCents: number; netCents: number; refundsCents: number; salesCount: number };
    expenses: { purchasesCents: number; purchasesCount: number; refundedCents?: number };
    balance: { availableCents: number; heldCents: number; paidCents: number; pendingPayoutCents: number };
    mrr: { cents: number; activeSubscribers: number; churnedInRange: number; trialing: number };
    byExtension: { extensionId: string; salesCount: number; grossCents: number; netCents: number; refundsCents: number; activeSubscribers: number }[];
}

export interface PurchaseItem {
    orderId: string; extensionId: string; kind: 'order' | 'subscription' | string; amountCents: number; currency: string;
    status: string; createdAt: string | null; capturedAt: string | null; installStatus: string | null;
}
export interface SaleItem {
    orderId: string; extensionId: string; buyerDomain: string; kind: string; amountCents: number; platformShareCents: number; developerShareCents: number; status: string; capturedAt: string | null;
}
export interface PayoutItem {
    id: string; amountCents: number; status: 'HELD' | 'READY' | 'SENT' | 'FAILED' | 'CANCELLED' | string; holdUntil: string | null; createdAt: string | null; sentAt: string | null; error: string | null;
}
export interface LedgerItem {
    id: string; kind: string; amountCents: number; orderId: string | null; payoutId: string | null; availableAt: string | null; createdAt: string | null;
}
export interface Paged<T> { items: T[]; nextCursor?: string | null }

export interface SubscriptionCharge { orderId: string; amountCents: number; status: string; capturedAt: string | null }
export interface SubscriptionItem {
    id: string; extensionId: string; interval: 'month' | 'year'; priceCents: number; currency: string;
    status: 'PENDING' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
    currentPeriodEnd: string | null; nextRenewalAt: string | null; cancelAtPeriodEnd: boolean; trialEndsAt: string | null; graceUntil: string | null; accessUntil: string | null;
    pendingPrice: { cents: number; approveUrl?: string } | null;
    charges: SubscriptionCharge[];
}

export interface PayPalAccount {
    linked: boolean;
    status: 'linked' | 'pending_switch' | 'disabled' | 'none';
    emailMasked: string | null; payoutsEnabled: boolean; linkedAt: string | null; pendingSince: string | null; switchEffectiveAt: string | null; previousEmailMasked: string | null;
}

export interface InstallResult { status: 'installed' | 'pending_approval' | 'failed' | 'skipped'; code?: string }
export interface CaptureResponse {
    status: 'CAPTURED' | 'PENDING' | 'FAILED' | 'CREATED' | 'REFUNDED' | 'DISPUTED';
    order: { id: string; extensionId: string; amountCents: number; currency: string };
    install: InstallResult;
}
export interface ConfirmResponse {
    status: string;
    subscription?: { id?: string; extensionId?: string; status?: string; [k: string]: unknown };
    install?: InstallResult;
}
export interface OrderInfo { id: string; status: string; extensionId: string; amountCents: number; currency: string; installStatus: string | null; createdAt: string | null; capturedAt: string | null }
export interface Receipt {
    number: string; orderId: string; issuedAt: string; buyerDomain: string; extensionId: string; extensionName: string; amountCents: number; currency: string; status: string; providerRef: string;
}
