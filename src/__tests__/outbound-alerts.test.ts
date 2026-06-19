/**
 * Unit tests for src/modules/integrations/outbound-alerts.ts (C7).
 *
 * No real Twilio, no real DB — a mock SmsSender + mock query are injected.
 * Asserts: correct message rendering per kind, that a send is logged (sent +
 * failed + skipped), that a Twilio throw is swallowed (never propagates), and
 * that the destination phone never lands in the log payload (PII-minimal).
 */
import {
  OutboundAlertService,
  renderAlert,
  type SmsSender,
  type QueryFn,
  type TransactionalAlert,
} from '../modules/integrations/outbound-alerts';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// Guard: if the default (real) query/Twilio were ever reached, fail loudly.
jest.mock('../config/database', () => ({
  query: jest.fn(() => {
    throw new Error('real database.query must not be called in this test');
  }),
}));
jest.mock('../modules/integrations/twilio', () => ({
  TwilioService: jest.fn(() => {
    throw new Error('real TwilioService must not be constructed in this test');
  }),
}));

function makeMocks(sendImpl?: SmsSender['sendSMS']) {
  const sendSMS = jest.fn(
    sendImpl ?? (async () => ({ sent: true, messageId: 'SM_test_123' })),
  );
  const twilio: SmsSender = { sendSMS };
  const query = jest.fn(async () => ({ rows: [] })) as unknown as jest.MockedFunction<QueryFn>;
  const svc = new OutboundAlertService({ twilio, query });
  return { svc, sendSMS, query };
}

describe('renderAlert', () => {
  it('rent_due includes name, formatted amount, and due date', () => {
    const body = renderAlert({
      kind: 'rent_due', phone: '+17025550101', tenantName: 'Jane Doe',
      amountDue: 1200, dueDate: 'July 1',
    });
    expect(body).toContain('Jane Doe');
    expect(body).toContain('$1,200.00');
    expect(body).toContain('July 1');
    expect(body).toContain('CDPC Nevada');
  });

  it('payment_confirmed includes amount and optional confirmation', () => {
    expect(
      renderAlert({ kind: 'payment_confirmed', phone: 'x', tenantName: 'Bob', amountPaid: 950 }),
    ).toContain('$950.00');
    expect(
      renderAlert({
        kind: 'payment_confirmed', phone: 'x', tenantName: 'Bob',
        amountPaid: 950, confirmation: 'CONF-9',
      }),
    ).toContain('Confirmation: CONF-9');
  });

  it('maintenance_status includes the work-order ref, status, and detail', () => {
    const body = renderAlert({
      kind: 'maintenance_status', phone: 'x', tenantName: 'Ana',
      workOrderRef: 'WO-1042', status: 'scheduled', detail: 'Tech arrives Tue 9-11am.',
    });
    expect(body).toContain('WO-1042');
    expect(body).toContain('scheduled');
    expect(body).toContain('Tech arrives Tue 9-11am.');
  });
});

describe('OutboundAlertService.send', () => {
  const rent: TransactionalAlert = {
    kind: 'rent_due', phone: '+1 (702) 555-0101', tenantName: 'Jane Doe',
    amountDue: 1200, dueDate: 'July 1',
  };

  it('sends via Twilio and logs a sent row', async () => {
    const { svc, sendSMS, query } = makeMocks();
    const res = await svc.send(rent, { applicationId: 'app-1', propertyId: 'prop-1' });

    expect(res.sent).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.messageId).toBe('SM_test_123');

    // Twilio was called once with the rendered body.
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS).toHaveBeenCalledWith('+1 (702) 555-0101', res.body);

    // One log INSERT with the right scalar params.
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('rent_due');           // alert_kind
    expect(params[1]).toBe('0101');               // to_last4 (last 4 only)
    expect(params[2]).toBe('app-1');              // application_id
    expect(params[3]).toBe('prop-1');             // property_id
    expect(params[4]).toBe('sent');               // status
    expect(params[5]).toBe('SM_test_123');        // message_sid
  });

  it('never writes the full phone number into the log payload (PII-minimal)', async () => {
    const { svc, query } = makeMocks();
    await svc.send(rent);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    const variablesJson = params[7] as string;   // variables JSONB
    expect(variablesJson).not.toContain('555-0101');
    expect(variablesJson).not.toContain('7025550101');
    // but it does carry the non-PII template fields
    expect(variablesJson).toContain('Jane Doe');
    expect(variablesJson).toContain('July 1');
    // and to_last4 is only the last 4
    expect(params[1]).toBe('0101');
  });

  it('logs a failed row when Twilio returns not-sent (unconfigured)', async () => {
    const { svc, query } = makeMocks(async () => ({ sent: false }));
    const res = await svc.send(rent);
    expect(res.sent).toBe(false);
    expect(res.status).toBe('failed');
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBe('failed');
  });

  it('swallows a Twilio throw and records failed (does not propagate)', async () => {
    const { svc, query } = makeMocks(async () => { throw new Error('twilio boom'); });
    const res = await svc.send(rent);              // must not reject
    expect(res.sent).toBe(false);
    expect(res.status).toBe('failed');
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBe('failed');
    expect(params[8]).toBe('twilio boom');         // error column
  });

  it('skips Twilio entirely and logs skipped when there is no phone', async () => {
    const { svc, sendSMS, query } = makeMocks();
    const res = await svc.send({ ...rent, phone: '' });
    expect(res.status).toBe('skipped');
    expect(sendSMS).not.toHaveBeenCalled();
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBe('skipped');
  });

  it('a log-write failure does not fail the send', async () => {
    const sendSMS = jest.fn(async () => ({ sent: true, messageId: 'SM_ok' }));
    const query = jest.fn(async () => { throw new Error('db down'); }) as unknown as jest.MockedFunction<QueryFn>;
    const svc = new OutboundAlertService({ twilio: { sendSMS }, query });
    const res = await svc.send(rent);              // must not reject
    expect(res.sent).toBe(true);
    expect(res.status).toBe('sent');
  });
});
