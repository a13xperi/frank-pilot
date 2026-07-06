import { query } from "../../config/database";

/**
 * Read-only pre-flight for the audit-#3 UNIQUE-on-conversation_id migration
 * (2026-07-02-applications-conversation-unique.sql). That partial-UNIQUE index
 * fails to build if any two applications share a conversation_id, so this
 * surfaces the duplicates BEFORE the migration deploys — and flags which
 * duplicate rows already carry a succeeded payment (a paired $35.95 charge the
 * operator must reconcile, and must NOT blindly delete). Never mutates.
 *
 * Keep-vs-drop convention: the EARLIEST application per conversation (min
 * created_at) is the keeper; the later rows are the duplicates to reconcile.
 */

export interface DuplicateApplication {
  applicationId: string;
  status: string;
  createdAt: string;
  isKeeper: boolean;
  hasSucceededPayment: boolean;
}

export interface DuplicateConversation {
  conversationId: string;
  count: number;
  applications: DuplicateApplication[];
}

export interface DuplicateReport {
  conversationsWithDuplicates: number;
  duplicateApplications: number; // total rows minus one keeper per conversation
  duplicatesWithPayment: number; // the ones needing charge reconciliation
  conversations: DuplicateConversation[];
}

export async function reportConversationDuplicates(): Promise<DuplicateReport> {
  // Conversations with >1 application, with the earliest flagged as keeper and
  // a boolean for a succeeded payment on each row (left-join so payment-less
  // rows still appear).
  const res = await query(
    `WITH dup_convos AS (
       SELECT conversation_id
         FROM applications
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
       HAVING COUNT(*) > 1
     ),
     ranked AS (
       SELECT a.id,
              a.conversation_id,
              a.status,
              a.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY a.conversation_id ORDER BY a.created_at ASC, a.id ASC
              ) AS rn
         FROM applications a
         JOIN dup_convos d ON d.conversation_id = a.conversation_id
     )
     SELECT r.conversation_id,
            r.id,
            r.status,
            r.created_at,
            (r.rn = 1) AS is_keeper,
            EXISTS (
              SELECT 1 FROM payment_idempotency p
               WHERE p.application_id = r.id AND p.status = 'succeeded'
            ) AS has_succeeded_payment
       FROM ranked r
      ORDER BY r.conversation_id, r.created_at ASC, r.id ASC`
  );

  const byConversation = new Map<string, DuplicateConversation>();
  let duplicateApplications = 0;
  let duplicatesWithPayment = 0;

  for (const row of res.rows as Array<Record<string, unknown>>) {
    const conversationId = row.conversation_id as string;
    const isKeeper = row.is_keeper as boolean;
    const hasSucceededPayment = row.has_succeeded_payment as boolean;

    let convo = byConversation.get(conversationId);
    if (!convo) {
      convo = { conversationId, count: 0, applications: [] };
      byConversation.set(conversationId, convo);
    }
    convo.count += 1;
    convo.applications.push({
      applicationId: row.id as string,
      status: row.status as string,
      createdAt: new Date(row.created_at as string).toISOString(),
      isKeeper,
      hasSucceededPayment,
    });

    if (!isKeeper) {
      duplicateApplications += 1;
      if (hasSucceededPayment) duplicatesWithPayment += 1;
    }
  }

  return {
    conversationsWithDuplicates: byConversation.size,
    duplicateApplications,
    duplicatesWithPayment,
    conversations: Array.from(byConversation.values()),
  };
}
