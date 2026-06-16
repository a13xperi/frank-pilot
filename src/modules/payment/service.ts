import type Stripe from "stripe";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { getStripe } from "../../lib/stripe";

// The placeholder set the shared boot-guard treats as "no real key wired". Kept
// in sync with src/lib/stripe.ts so this service's dark-by-default behaviour
// matches the rest of the payment module.
const PLACEHOLDER_SECRET_KEYS = new Set(["", "sk_test_changeme", "sk_live_changeme"]);

/**
 * Payment Processing Module.
 *
 * Accepted methods: ACH (primary), credit/debit card, bank transfer.
 * Auto-pay incentive: $25/month rent reduction.
 * PCI-compliant: tokenized via Stripe, no physical card capture.
 */
export class PaymentService {
  /**
   * Resolve the shared, memoised Stripe client — or `null` when no real key is
   * wired (the dark-by-default stub path). We fold onto `getStripe()` rather
   * than constructing our own `new Stripe(...)` so the API version is pinned in
   * one place and the client is shared across the module. `getStripe()` throws
   * on a missing/placeholder key (defense-in-depth), so we gate on the same
   * placeholder check first and stay dark instead of throwing.
   */
  private getStripeOrNull(): Stripe | null {
    const key = process.env.STRIPE_SECRET_KEY ?? "";
    if (PLACEHOLDER_SECRET_KEYS.has(key)) return null;
    return getStripe();
  }

  /**
   * Create a Stripe customer for the tenant.
   */
  async createCustomer(input: {
    applicationId: string;
    email: string;
    firstName: string;
    lastName: string;
    actorId: string;
    actorRole: string;
  }): Promise<{ customerId: string }> {
    const stripe = this.getStripeOrNull();
    if (!stripe) {
      logger.warn("Stripe not configured — using stub customer ID");
      const stubId = `cus_stub_${Date.now()}`;
      await query(
        "UPDATE applications SET stripe_customer_id = $2 WHERE id = $1",
        [input.applicationId, stubId]
      );
      return { customerId: stubId };
    }

    const customer = await stripe.customers.create({
      email: input.email,
      name: `${input.firstName} ${input.lastName}`,
      metadata: { applicationId: input.applicationId },
    });

    await query(
      "UPDATE applications SET stripe_customer_id = $2 WHERE id = $1",
      [input.applicationId, customer.id]
    );

    await writeAuditLog({
      action: "payment_setup",
      actorId: input.actorId,
      actorRole: input.actorRole,
      applicationId: input.applicationId,
      details: { step: "customer_created" },
    });

    return { customerId: customer.id };
  }

  /**
   * Set up a payment method (tokenized — no raw card data touches our servers).
   */
  async setupPaymentMethod(input: {
    applicationId: string;
    paymentMethodId: string; // Stripe PaymentMethod ID from client-side
    paymentType: "ach" | "credit_card" | "debit_card" | "bank_transfer";
    actorId: string;
    actorRole: string;
  }): Promise<any> {
    const app = await this.getApplication(input.applicationId);

    if (!app.stripe_customer_id) {
      throw new Error("Customer must be created before setting up payment method");
    }

    const stripe = this.getStripeOrNull();
    if (stripe) {
      // Attach payment method to customer
      await stripe.paymentMethods.attach(input.paymentMethodId, {
        customer: app.stripe_customer_id,
      });

      // Set as default
      await stripe.customers.update(app.stripe_customer_id, {
        invoice_settings: { default_payment_method: input.paymentMethodId },
      });
    }

    await query(
      `UPDATE applications SET
        payment_method = $2,
        stripe_payment_method_id = $3
       WHERE id = $1`,
      [input.applicationId, input.paymentType, input.paymentMethodId]
    );

    await writeAuditLog({
      action: "payment_setup",
      actorId: input.actorId,
      actorRole: input.actorRole,
      applicationId: input.applicationId,
      details: {
        step: "payment_method_attached",
        paymentType: input.paymentType,
      },
    });

    return { success: true, paymentType: input.paymentType };
  }

  /**
   * Enroll in auto-pay ($25/month rent reduction incentive).
   */
  async enrollAutoPay(input: {
    applicationId: string;
    actorId: string;
    actorRole: string;
  }): Promise<{ enrolled: boolean; monthlyDiscount: number }> {
    const app = await this.getApplication(input.applicationId);

    if (!app.stripe_payment_method_id) {
      throw new Error("Payment method must be set up before enrolling in auto-pay");
    }

    await query(
      "UPDATE applications SET auto_pay_enrolled = true WHERE id = $1",
      [input.applicationId]
    );

    if (this.getStripeOrNull() && app.stripe_customer_id) {
      // Create recurring subscription in Stripe
      // In production, this would create a Stripe Subscription or Schedule
      logger.info("Auto-pay subscription would be created in Stripe", {
        customerId: app.stripe_customer_id,
        applicationId: input.applicationId,
      });
    }

    await writeAuditLog({
      action: "auto_pay_enrolled",
      actorId: input.actorId,
      actorRole: input.actorRole,
      applicationId: input.applicationId,
      details: { monthlyDiscount: 25 },
    });

    logger.info("Auto-pay enrolled", {
      applicationId: input.applicationId,
      monthlyDiscount: 25,
    });

    return { enrolled: true, monthlyDiscount: 25 };
  }

  /**
   * Get payment status for an application.
   */
  async getPaymentStatus(applicationId: string): Promise<any> {
    const result = await query(
      `SELECT payment_method, auto_pay_enrolled, stripe_customer_id,
              stripe_payment_method_id, requested_rent_amount
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;

    const app = result.rows[0];
    const rentAmount = parseFloat(app.requested_rent_amount || "0");
    const effectiveRent = app.auto_pay_enrolled ? rentAmount - 25 : rentAmount;

    return {
      applicationId,
      paymentMethod: app.payment_method,
      autoPayEnrolled: app.auto_pay_enrolled,
      hasPaymentMethod: !!app.stripe_payment_method_id,
      hasCustomer: !!app.stripe_customer_id,
      requestedRent: rentAmount,
      effectiveRent: Math.max(0, effectiveRent),
      autoPayDiscount: app.auto_pay_enrolled ? 25 : 0,
    };
  }

  private async getApplication(applicationId: string): Promise<any> {
    const result = await query("SELECT * FROM applications WHERE id = $1", [applicationId]);
    if (result.rows.length === 0) throw new Error("Application not found");
    return result.rows[0];
  }
}
