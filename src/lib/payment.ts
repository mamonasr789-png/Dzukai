/**
 * Payment service — single abstraction layer for all payment providers.
 *
 * MVP uses a fake provider (1 s delay, always succeeds).
 * The UI never imports a specific provider — only processPayment().
 *
 * ── STRIPE INTEGRATION POINT ──────────────────────────────────────────────────
 * 1. Add  case "stripe"  below.
 * 2. Create a server route  POST /api/payment/intent  that creates a
 *    Stripe PaymentIntent and returns { clientSecret }.
 * 3. On the client: call loadStripe() + stripe.confirmCardPayment(clientSecret).
 * 4. Return { success: true, transactionId: paymentIntent.id } on success.
 * 5. Change the default provider arg from "fake" to "stripe" and add
 *    NEXT_PUBLIC_STRIPE_KEY to .env.local.
 * Nothing in the UI (order/page.tsx) needs to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type PaymentProvider = "fake" | "stripe";

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export async function processPayment(
  _amountEur: number,
  provider: PaymentProvider = "fake"
): Promise<PaymentResult> {
  if (provider === "fake") {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    return {
      success: true,
      transactionId: `FAKE-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  return { success: false, error: `Provider "${provider}" not yet implemented` };
}
