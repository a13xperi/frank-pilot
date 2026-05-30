/**
 * BP-02 Compliance Tape — Lane C event payload makers.
 *
 * Re-exports every `make*Payload` function and its associated input type so
 * callers can import from a single path.
 *
 * Usage:
 *   import { makeWelcomeLetterDeliveredPayload } from "../tape/events";
 */

export {
  makeWelcomeLetterDeliveredPayload,
  type WelcomeLetterDeliveredInput,
} from "./welcome-letter-delivered";

export {
  makeHud9281FairHousingPostedPayload,
  type Hud9281FairHousingPostedInput,
  type FairHousingMedium,
} from "./hud-928-1-fair-housing";

export {
  makeWaitingListAppCapturedPayload,
  type WaitingListAppCapturedInput,
} from "./waiting-list-app-captured";

export {
  makeHud92006SupplementCapturedPayload,
  type Hud92006SupplementCapturedInput,
} from "./hud-92006-supplement-captured";

export {
  makePositionLetterSentPayload,
  type PositionLetterSentInput,
} from "./position-letter-sent";

export {
  makeLeaseExecutedPayload,
  type LeaseExecutedInput,
} from "./lease-executed";

export {
  makeScreeningStateTransitionPayload,
  type ScreeningStateTransitionInput,
} from "./screening-state-transition";
