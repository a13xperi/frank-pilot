/**
 * Pluggable recertification notifier (B2).
 *
 * `processReminders()` used to call TwilioService.sendSMS directly. This
 * indirection lets the dispatch channel be swapped (SMS today, email/both
 * later) and — crucially — lets tests inject a mock so the reminder dispatch
 * logic is verified without ever hitting Twilio.
 *
 * Contract: a notifier MUST NOT throw. Reminder sends are fire-and-forget; a
 * channel outage must never block the reminder state machine. Implementations
 * swallow their own errors (the default does).
 */
import { logger } from '../../utils/logger';
import { TwilioService } from '../integrations/twilio';

/** Channels a recipient can be notified on. */
export type NotifyChannel = 'sms' | 'email';

export interface RecipientNotification {
  /** Destination phone (SMS). Optional — a notifier skips channels it lacks a
   *  destination for. */
  phone?: string | null;
  /** Destination email. Optional. */
  email?: string | null;
  /** SMS / short body. */
  message: string;
  /** Email subject (when the notifier sends email). Falls back to a default. */
  subject?: string;
}

export interface Notifier {
  /** The channels this notifier will attempt. Used by callers/tests to assert
   *  intent without sending. */
  channels(): NotifyChannel[];
  /** Send a notification. Never throws. */
  notify(n: RecipientNotification): Promise<void>;
}

/**
 * Default notifier: SMS via the existing Twilio service (fire-and-forget,
 * matching the prior inline behavior). Email is a pluggable hook — off by
 * default; pass an `email` sender to enable it. Keeping email opt-in avoids
 * sending anything new from the existing daily cron without an explicit choice.
 */
export class TwilioNotifier implements Notifier {
  private twilio: Pick<TwilioService, 'sendSMS'>;
  private email?: (to: string, subject: string, body: string) => Promise<void>;

  constructor(opts: {
    twilio?: Pick<TwilioService, 'sendSMS'>;
    email?: (to: string, subject: string, body: string) => Promise<void>;
  } = {}) {
    this.twilio = opts.twilio ?? new TwilioService();
    this.email = opts.email;
  }

  channels(): NotifyChannel[] {
    return this.email ? ['sms', 'email'] : ['sms'];
  }

  async notify(n: RecipientNotification): Promise<void> {
    if (n.phone) {
      // Fire-and-forget: never let a Twilio failure surface.
      await this.twilio.sendSMS(n.phone, n.message).catch((err) => {
        logger.error('Recert notifier: SMS send failed (non-fatal)', { error: (err as Error).message });
      });
    }
    if (this.email && n.email) {
      await this.email(n.email, n.subject ?? 'Recertification reminder', n.message).catch((err) => {
        logger.error('Recert notifier: email send failed (non-fatal)', { error: (err as Error).message });
      });
    }
  }
}
