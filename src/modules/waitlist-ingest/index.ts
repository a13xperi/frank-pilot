// Wait-list ingest + compliance sequencing (DM-FRANK-029).
// Load a property's wait-list export as an ordered queue, enforce a 48-hour
// per-offer response window and a 12-day overall removal window.
export {
  ingestOneSiteCsv,
  offerNext,
  markResponded,
  expireOverdueOffers,
  removeExpiredEntries,
  getQueue,
  RESPONSE_WINDOW_HOURS,
  REMOVAL_WINDOW_DAYS,
  type IngestResult,
} from './service';
export { parseOneSiteCsv, parseCsv, type RawWaitlistRow } from './onesite-adapter';
export { waitlistRowSchema, type ValidWaitlistRow } from './validation';
