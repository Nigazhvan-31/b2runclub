-- Participant mobile numbers, configurable holds and discounts, registration
-- lifecycle statuses, and per-event questionnaires.
--
-- Entirely additive. Every column is nullable or carries a default that matches
-- what existing rows already mean, so nothing has to be backfilled and no live
-- booking changes behaviour when this lands.

-- ── Participant mobile numbers ──────────────────────────────────────────────
-- Per person, because this is what gets added to the event's WhatsApp group.
-- Null on every booking taken before it was collected; the roster prints those
-- as "not collected" rather than inventing one.
ALTER TABLE "RegistrationGuest" ADD COLUMN "phone" TEXT;

-- ── Group discount: how many people qualify ─────────────────────────────────
-- Was a hardcoded 2. Null means "use the club default", which is what every
-- existing event wants.
ALTER TABLE "Event" ADD COLUMN "discount_min_party" INTEGER;

-- ── How long an unpaid booking holds its places ─────────────────────────────
-- Null means the club default of 24 hours.
ALTER TABLE "Event" ADD COLUMN "hold_minutes" INTEGER;

-- ── Registration lifecycle ──────────────────────────────────────────────────
-- `status` gains EXPIRED, CANCELLED, DEACTIVATED and TEST alongside the
-- existing PENDING/PAID/FREE/FAILED. It is a TEXT column with no check
-- constraint, so no DDL is needed for the values themselves.
--
-- hold_expires_at is deliberately left NULL for bookings that already exist:
-- they were made under no deadline, and applying one retroactively would expire
-- somebody's held place for a rule that did not exist when they booked. The
-- sweeper skips NULL.
ALTER TABLE "EventRegistration" ADD COLUMN "hold_expires_at" TIMESTAMP(3);
ALTER TABLE "EventRegistration" ADD COLUMN "expired_at" TIMESTAMP(3);
ALTER TABLE "EventRegistration" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "EventRegistration" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "EventRegistration" ADD COLUMN "payment_reminder_sent_at" TIMESTAMP(3);

-- Existing rows get the deploy time as their created_at. It is not their real
-- booking date, but the column only drives the payment reminder, and the
-- reminder is additionally gated on hold_expires_at, which those rows do not
-- have — so no historical booking is nudged on the strength of this value.
ALTER TABLE "EventRegistration"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The sweepers scan by status and deadline on every run.
CREATE INDEX "EventRegistration_status_hold_expires_at_idx"
    ON "EventRegistration" ("status", "hold_expires_at");

-- ── Event questionnaire ─────────────────────────────────────────────────────
CREATE TABLE "EventQuestion" (
    "id"         TEXT NOT NULL,
    "event_id"   TEXT NOT NULL,
    "prompt"     TEXT NOT NULL,
    "kind"       TEXT NOT NULL DEFAULT 'CHOICE',
    "options"    TEXT NOT NULL DEFAULT '[]',
    "required"   BOOLEAN NOT NULL DEFAULT false,
    "position"   INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventQuestion_event_id_idx" ON "EventQuestion" ("event_id");

ALTER TABLE "EventQuestion"
    ADD CONSTRAINT "EventQuestion_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RegistrationAnswer" (
    "id"              TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "question_id"     TEXT NOT NULL,
    "answer"          TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationAnswer_pkey" PRIMARY KEY ("id")
);

-- One answer per question per booking; re-answering updates in place.
CREATE UNIQUE INDEX "RegistrationAnswer_registration_id_question_id_key"
    ON "RegistrationAnswer" ("registration_id", "question_id");

CREATE INDEX "RegistrationAnswer_registration_id_idx"
    ON "RegistrationAnswer" ("registration_id");

ALTER TABLE "RegistrationAnswer"
    ADD CONSTRAINT "RegistrationAnswer_registration_id_fkey"
    FOREIGN KEY ("registration_id") REFERENCES "EventRegistration" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationAnswer"
    ADD CONSTRAINT "RegistrationAnswer_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "EventQuestion" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
