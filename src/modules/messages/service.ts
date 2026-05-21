import { query, transaction } from "../../config/database";

export type SenderRole = "staff" | "applicant" | "tenant";

export interface MessageRecord {
  id: string;
  applicationId: string;
  senderUserId: string;
  senderRole: SenderRole;
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

function rowToMessage(row: any): MessageRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    senderUserId: row.sender_user_id,
    senderRole: row.sender_role,
    senderName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unknown",
    body: row.body,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    readAt:
      row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at || null,
  };
}

export class MessagesService {
  /**
   * Return all messages for an application in chronological order with
   * the sender's display name joined from users.
   */
  async listForApplication(applicationId: string): Promise<MessageRecord[]> {
    const result = await query(
      `SELECT m.id, m.application_id, m.sender_user_id, m.sender_role, m.body,
              m.created_at, m.read_at,
              u.first_name, u.last_name, u.email
       FROM application_messages m
       JOIN users u ON u.id = m.sender_user_id
       WHERE m.application_id = $1
       ORDER BY m.created_at ASC`,
      [applicationId]
    );
    return result.rows.map(rowToMessage);
  }

  /**
   * Insert a new message and return the hydrated record (with sender name).
   */
  async create(input: {
    applicationId: string;
    senderUserId: string;
    senderRole: SenderRole;
    body: string;
  }): Promise<MessageRecord> {
    const trimmed = input.body.trim();
    return transaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO application_messages
           (application_id, sender_user_id, sender_role, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [input.applicationId, input.senderUserId, input.senderRole, trimmed]
      );
      const id = ins.rows[0].id as string;
      const hydrated = await client.query(
        `SELECT m.id, m.application_id, m.sender_user_id, m.sender_role, m.body,
                m.created_at, m.read_at,
                u.first_name, u.last_name, u.email
         FROM application_messages m
         JOIN users u ON u.id = m.sender_user_id
         WHERE m.id = $1`,
        [id]
      );
      return rowToMessage(hydrated.rows[0]);
    });
  }

  /**
   * Mark a message as read by the recipient. Senders may not mark their
   * own messages as read. Returns true if a row was updated.
   *
   * The applicationId scope on the UPDATE closes the IDOR window where a
   * route handler verifies ownership of the URL applicationId but the
   * service-layer mutation only filtered on id — letting an attacker who
   * owned any one application flip read_at on a foreign message by URL
   * mismatch. See PR follow-up P0 #1.
   *
   * Allowed pairings:
   *   - reader is 'staff' AND sender_role is 'applicant'|'tenant'
   *   - reader is 'applicant'|'tenant' AND sender_role is 'staff'
   */
  async markRead(input: {
    applicationId: string;
    messageId: string;
    readerUserId: string;
    readerRole: SenderRole;
  }): Promise<boolean> {
    const isReaderStaff = input.readerRole === "staff";
    const senderRoleCondition = isReaderStaff
      ? "sender_role IN ('applicant','tenant')"
      : "sender_role = 'staff'";

    const result = await query(
      `UPDATE application_messages
         SET read_at = NOW()
       WHERE id = $1
         AND application_id = $2
         AND read_at IS NULL
         AND sender_user_id <> $3
         AND ${senderRoleCondition}
       RETURNING id`,
      [input.messageId, input.applicationId, input.readerUserId]
    );
    return result.rowCount! > 0;
  }

  /**
   * Count unread messages addressed TO the given user — i.e. messages from
   * the opposite side of the conversation.
   */
  async unreadCountForUser(input: {
    applicationId: string;
    userId: string;
    userRole: SenderRole;
  }): Promise<number> {
    const isStaff = input.userRole === "staff";
    const senderRoleCondition = isStaff
      ? "sender_role IN ('applicant','tenant')"
      : "sender_role = 'staff'";
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM application_messages
       WHERE application_id = $1
         AND read_at IS NULL
         AND sender_user_id <> $2
         AND ${senderRoleCondition}`,
      [input.applicationId, input.userId]
    );
    return result.rows[0]?.n || 0;
  }
}
