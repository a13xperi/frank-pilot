/**
 * Outbound transactional-alert SMS (C7).
 *
 * A thin, auditable path for the system-generated resident SMS that aren't part
 * of the application lifecycle the {@link TwilioService} notify* helpers already
 * cover: rent due, payment confirmed, and maintenance/work-order status.
 *
 * It reuses {@link TwilioService.sendSMS} (so all Twilio config + the "not
 * configured → no-op" safety live in one place) and writes one row per attempt
 * — sent, failed, or skipped — to `sms_outbound_log`, so a delivery failure is
 * recorded rather than silently swallowed by the fire-and-forget pattern.
 *
 * Both collaborators are injectable so the service is unit-testable without a
 * live Twilio client or database (see __tests__/outbound-alerts.test.ts).
 */
import { query as dbQuery } from '../../config/database';
import { logger } from '../../utils/logger';
import { TwilioService } from './twilio';

/** The transactional alert kinds this service can send. Mirrors the
 *  `sms_outbound_log.alert_kind` CHECK constraint. */
export type AlertKind = 'rent_due' | 'payment_confirmed' | 'maintenance_status';

/** Minimal Twilio surface this service needs — lets a test inject a mock. */
export interface SmsSender {
  sendSMS(to: string, message: string): Promise<{ sent: boolean; messageId?: string }>;
}

/** The `query` function shape (config/database). Injectable for tests. */
export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export interface RentDueAlert {
  kind: 'rent_due';
  phone: string;
  tenantName: string;
  amountDue: number;
  /** Human-friendly due date, e.g. "July 1". */
  dueDate: string;
}

export interface PaymentConfirmedAlert {
  kind: 'payment_confirmed';
  phone: string;
  tenantName: string;
  amountPaid: number;
  /** Optional confirmation/receipt number. */
  confirmation?: string;
}

export interface MaintenanceStatusAlert {
  kind: 'maintenance_status';
  phone: string;
  tenantName: string;
  /** Short work-order reference, e.g. "WO-1042". */
  workOrderRef: string;
  /** New status, e.g. "scheduled", "in progress", "completed". */
  status: string;
  /** Optional scheduled window / extra note. */
  detail?: string;
}

export type TransactionalAlert =
  | RentDueAlert
  | PaymentConfirmedAlert
  | MaintenanceStatusAlert;

/** Soft links recorded on the log row (no FK so a bad id can never 500 a send). */
export interface AlertContext {
  applicationId?: string | null;
  propertyId?: string | null;
}

export interface AlertResult {
  sent: boolean;
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  /** The rendered body (useful in tests / for display). */
  body: string;
}

const ORG = 'CDPC Nevada';

function money(n: number): string {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function last4(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.slice(-4);
}

/**
 * Render the SMS body for an alert. Pure — no I/O — so it's trivially testable
 * and the exact copy is asserted in tests.
 */
export function renderAlert(a: TransactionalAlert): string {
  switch (a.kind) {
    case 'rent_due':
      return `Hello ${a.tenantName}, this is a reminder that your rent of ${money(a.amountDue)} is due ${a.dueDate}. Please pay through your resident portal to avoid late fees. — ${ORG}`;
    case 'payment_confirmed':
      return `Hello ${a.tenantName}, we've received your payment of ${money(a.amountPaid)}. Thank you!${a.confirmation ? ` Confirmation: ${a.confirmation}.` : ''} — ${ORG}`;
    case 'maintenance_status': {
      const detail = a.detail ? ` ${a.detail}` : '';
      return `Hello ${a.tenantName}, an update on your maintenance request ${a.workOrderRef}: ${a.status}.${detail} — ${ORG}`;
    }
  }
}

export class OutboundAlertService {
  private twilio: SmsSender;
  private query: QueryFn;

  constructor(opts: { twilio?: SmsSender; query?: QueryFn } = {}) {
    this.twilio = opts.twilio ?? new TwilioService();
    this.query = opts.query ?? (dbQuery as unknown as QueryFn);
  }

  /**
   * Send one transactional alert and log the attempt.
   *
   * Never throws on a Twilio or logging failure — a transactional alert must not
   * break the calling business flow (payment posting, work-order update, …).
   * The boolean/status in the result tells the caller what happened.
   */
  async send(alert: TransactionalAlert, ctx: AlertContext = {}): Promise<AlertResult> {
    const body = renderAlert(alert);

    // Guard: no phone → record a 'skipped' row, don't call Twilio.
    if (!alert.phone) {
      await this.log(alert, ctx, body, 'skipped', undefined, 'no phone on record');
      return { sent: false, status: 'skipped', body };
    }

    let sent = false;
    let messageId: string | undefined;
    let error: string | undefined;
    try {
      const res = await this.twilio.sendSMS(alert.phone, body);
      sent = res.sent;
      messageId = res.messageId;
      if (!sent) error = 'twilio not configured or send returned not-sent';
    } catch (err) {
      error = (err as Error).message;
      logger.error('Outbound alert send failed', { kind: alert.kind, error });
    }

    const status: AlertResult['status'] = sent ? 'sent' : 'failed';
    await this.log(alert, ctx, body, status, messageId, error);
    return { sent, status, messageId, body };
  }

  /** Best-effort write to sms_outbound_log — a logging failure never fails a send. */
  private async log(
    alert: TransactionalAlert,
    ctx: AlertContext,
    body: string,
    status: 'sent' | 'failed' | 'skipped',
    messageSid?: string,
    error?: string,
  ): Promise<void> {
    // Template variables (the rendered fields), minus the phone (PII) and the
    // kind (already its own column).
    const { phone: _phone, kind: _kind, ...rest } =
      alert as unknown as Record<string, unknown>;
    void _phone;
    void _kind;
    try {
      await this.query(
        `INSERT INTO sms_outbound_log
           (alert_kind, to_last4, application_id, property_id, status, message_sid, body, variables, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          alert.kind,
          last4(alert.phone),
          ctx.applicationId ?? null,
          ctx.propertyId ?? null,
          status,
          messageSid ?? null,
          body,
          JSON.stringify(rest),
          error ?? null,
        ],
      );
    } catch (err) {
      logger.error('Outbound alert log write failed (non-fatal)', {
        kind: alert.kind,
        error: (err as Error).message,
      });
    }
  }
}
