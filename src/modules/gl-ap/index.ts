/**
 * B3 — Entity-level GL/AP ledger (GENERIC double-entry foundation).
 *
 * Public surface of the module. The LAWS are pure + tested (posting,
 * ap-state-machine, posting-rules, reconciliation); the service binds them to
 * the gl_/ap_ tables. Entity-specific behavior (Tanya's chart of accounts +
 * 8 posting rules) is DATA loaded from config — see ./config and
 * docs/deals/TANYA-GL-INTAKE.md. See ./README.md for the go-live checklist.
 */

export * from "./types";
export * from "./posting";
export * from "./ap-state-machine";
export * from "./posting-rules";
export * from "./reconciliation";
export { GlApService, glApService, PeriodLockedError } from "./service";
