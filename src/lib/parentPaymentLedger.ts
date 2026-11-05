import type { MonthlySubscription, Payment } from '@/lib/types';

export type ParentFinanceStatus = 'exempt' | 'missing' | 'unpaid' | 'partial' | 'paid';

export interface PaymentLedgerEntry {
  payment: Payment;
  amount: number;
  runningPaid: number;
  remainingAfter: number | null;
}

export interface ParentFinance {
  status: ParentFinanceStatus;
  feesDue: number;
  feesPaid: number;
  feesRemaining: number;
  hasFees: boolean;
  ledger: PaymentLedgerEntry[];
}

function toAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function transactionTime(p: Payment): number {
  const recorded = Date.parse(p.recorded_at ?? '');
  if (!Number.isNaN(recorded)) return recorded;
  const paidOn = Date.parse(`${p.payment_date}T00:00:00`);
  return Number.isNaN(paidOn) ? 0 : paidOn;
}

export function computeParentFinance(
  subscription: MonthlySubscription | undefined,
  payments: Payment[],
  configuredFee: number | null,
): ParentFinance {
  const feesDue = subscription ? toAmount(subscription.amount_due) : toAmount(configuredFee);
  const hasFees = feesDue > 0;
  const chronological = [...payments].sort((a, b) => transactionTime(a) - transactionTime(b) || a.id.localeCompare(b.id));

  let runningPaid = 0;
  const ledger: PaymentLedgerEntry[] = chronological.map((payment) => {
    const amount = toAmount(payment.amount);
    runningPaid += amount;
    return {
      payment,
      amount,
      runningPaid,
      remainingAfter: hasFees ? Math.max(0, feesDue - runningPaid) : null,
    };
  });

  const feesPaid = runningPaid;
  const feesRemaining = hasFees ? Math.max(0, feesDue - feesPaid) : 0;
  const isExempt = subscription?.is_exempt ?? false;
  const status: ParentFinanceStatus = isExempt
    ? 'exempt'
    : !hasFees
      ? 'missing'
      : feesPaid <= 0
        ? 'unpaid'
        : feesRemaining > 0
          ? 'partial'
          : 'paid';

  return { status, feesDue, feesPaid, feesRemaining, hasFees, ledger };
}
