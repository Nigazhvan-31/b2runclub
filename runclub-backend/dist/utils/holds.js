"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireStaleHolds = expireStaleHolds;
exports.sendPaymentReminders = sendPaymentReminders;
exports.sweepHolds = sweepHolds;
exports.startHoldScheduler = startHoldScheduler;
exports.stopHoldScheduler = stopHoldScheduler;
const prisma_1 = __importDefault(require("./prisma"));
const mailer_1 = require("./mailer");
const time_1 = require("./time");
const registrationStatus_1 = require("./registrationStatus");
/**
 * The unpaid-booking lifecycle: nudge, then expire.
 *
 * Two sweeps rather than one, because they answer to different clocks. The
 * event reminder in reminders.ts is timed from the *event* — "your run is in
 * two days". These are timed from the *booking* — "you have four hours left to
 * pay". Running them together was tried in the head and abandoned: a single
 * loop would have to carry both sets of rules, and the rule that matters here
 * is precisely the one the event reminder does not have, which is that a
 * message must never be sent about a booking that has already ended.
 *
 * Both are idempotent and both are safe to run on a server that was asleep. A
 * missed expiry sweep means places come back late, never that they come back
 * twice; a missed nudge is skipped rather than sent hours after the deadline it
 * was warning about, because a warning that arrives after the event it warns of
 * is worse than silence.
 */
const APP_URL = process.env.APP_URL || "http://localhost:5173";
/**
 * How much of the hold has to be gone before the nudge goes out.
 *
 * Two thirds. Sending at once reads as pestering somebody who is still filling
 * in their card, and sending at the last minute is no use to a member who is
 * asleep — on a 24-hour hold this lands at the 16-hour mark, which leaves eight
 * hours to act on it.
 */
const REMINDER_AT_FRACTION = 2 / 3;
/**
 * Expires unpaid bookings whose hold has run out, releasing their places.
 *
 * The status change is the whole mechanism: SEAT_FILTER counts only PENDING,
 * PAID and FREE, so moving a row to EXPIRED is what puts its places back on
 * sale. Nothing is deleted — the club asked for the record to survive, and an
 * organiser looking at a half-empty event needs to see that six people started
 * a booking and did not finish it.
 */
async function expireStaleHolds(now = new Date()) {
    const stale = await prisma_1.default.eventRegistration.findMany({
        where: {
            status: "PENDING",
            hold_expires_at: { not: null, lte: now },
        },
        include: { event: { select: { title: true } } },
    });
    let expired = 0;
    for (const registration of stale) {
        /*
         * Re-checked inside the loop against the row's own status, so a payment
         * that landed between the query and this update is not stamped EXPIRED
         * over the top of it. updateMany with the status in the filter makes
         * that check and the write one statement — a plain update would read,
         * decide, and write with a gap in the middle that a webhook can land in.
         */
        const result = await prisma_1.default.eventRegistration.updateMany({
            where: { id: registration.id, status: "PENDING" },
            data: {
                status: "EXPIRED",
                expired_at: now,
                // The deadline has done its job. Clearing it keeps the row out
                // of every subsequent sweep without needing a status check.
                hold_expires_at: null,
            },
        });
        if (result.count === 0)
            continue;
        expired++;
        await prisma_1.default.notification.create({
            data: {
                user_id: registration.user_id,
                message: `Your spot for "${registration.event.title}" expired because payment wasn't completed in time. You can register again if places are left.`,
                link: `/events/${registration.event_id}`,
            },
        });
    }
    return expired;
}
/**
 * Sends the awaiting-payment nudge to bookings partway through their hold.
 *
 * Deliberately not sent to a booking that is already past its deadline: the
 * expiry sweep runs first in `sweepHolds`, so anything still PENDING here has
 * time left, and the email can honestly say how much.
 */
async function sendPaymentReminders(now = new Date()) {
    const waiting = await prisma_1.default.eventRegistration.findMany({
        where: {
            status: "PENDING",
            hold_expires_at: { not: null, gt: now },
            // Once only.
            payment_reminder_sent_at: null,
        },
        include: {
            event: true,
            user: { select: { id: true, name: true, email: true } },
        },
    });
    let reminded = 0;
    let failed = 0;
    for (const registration of waiting) {
        /*
         * The status guard the client asked for, applied at send time rather
         * than at query time. The query above already filters on status, but
         * this loop can run for a while and a member can pay or be cancelled
         * partway through it — and the one thing worse than a late reminder is
         * a reminder contradicting what the member just did.
         */
        if (!(0, registrationStatus_1.shouldReceiveMail)(registration))
            continue;
        const deadline = registration.hold_expires_at;
        const created = registration.created_at;
        /* Only nudge once enough of the hold has gone. */
        const total = deadline.getTime() - created.getTime();
        const elapsed = now.getTime() - created.getTime();
        if (total > 0 && elapsed / total < REMINDER_AT_FRACTION)
            continue;
        const template = (0, mailer_1.paymentReminderEmail)({
            name: registration.user.name.split(" ")[0],
            eventTitle: registration.event.title,
            when: (0, time_1.formatEventWhen)(registration.event.date_time),
            location: registration.event.location,
            amountDue: `₹${(registration.amount_due_paise / 100).toFixed(2)}`,
            timeLeft: (0, time_1.timeRemaining)(deadline, now),
            payUrl: `${APP_URL}/tickets`,
        });
        const result = await (0, mailer_1.sendMail)({ ...template, to: registration.user.email });
        /*
         * Stamped whether or not it sent, so a permanently undeliverable
         * address is not retried on every sweep for a day. The failure is in
         * the log; the member's place is unaffected either way.
         */
        await prisma_1.default.eventRegistration.update({
            where: { id: registration.id },
            data: { payment_reminder_sent_at: now },
        });
        if (result.ok) {
            reminded++;
            await prisma_1.default.notification.create({
                data: {
                    user_id: registration.user_id,
                    message: `Payment for "${registration.event.title}" is still outstanding — ${(0, time_1.timeRemaining)(deadline, now)} left before your spot is released.`,
                    link: `/tickets`,
                },
            });
        }
        else {
            failed++;
        }
    }
    return { reminded, failed, checked: waiting.length };
}
/**
 * Expire first, then nudge.
 *
 * The order is the point. Nudging first would email somebody about a booking
 * that this same sweep is about to expire a few milliseconds later.
 */
async function sweepHolds(now = new Date()) {
    const expired = await expireStaleHolds(now);
    const { reminded, failed, checked } = await sendPaymentReminders(now);
    return { expired, reminded, failed, checked };
}
let timer = null;
/**
 * Starts the in-process hold sweeper.
 *
 * Every five minutes, which is the accuracy a 24-hour deadline deserves — a
 * place coming back on sale up to five minutes late is invisible, and sweeping
 * more often is work for nothing. On serverless this never runs; the platform
 * cron calls /api/cron/holds instead.
 */
function startHoldScheduler(intervalMs = 5 * 60_000) {
    if (timer)
        return;
    const tick = async () => {
        try {
            const s = await sweepHolds();
            if (s.expired || s.reminded || s.failed) {
                console.log(`[holds] expired=${s.expired} reminded=${s.reminded} failed=${s.failed}`);
            }
        }
        catch (error) {
            console.error("[holds] sweep failed:", error?.message || error);
        }
    };
    setTimeout(tick, 10_000);
    timer = setInterval(tick, intervalMs);
    console.log(`[holds] scheduler started (every ${Math.round(intervalMs / 60_000)}m)`);
}
function stopHoldScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
