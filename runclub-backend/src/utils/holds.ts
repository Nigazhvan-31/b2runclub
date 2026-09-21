import prisma from "./prisma";
import { paymentReminderEmail, sendMail } from "./mailer";
import { formatEventWhen, timeRemaining } from "./time";
import { shouldReceiveMail } from "./registrationStatus";

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

export interface HoldSweepSummary {
    /** Bookings whose hold ran out; places released. */
    expired: number;
    /** Nudges sent. */
    reminded: number;
    /** Nudges that failed to send. */
    failed: number;
    checked: number;
}

/**
 * Expires unpaid bookings whose hold has run out, releasing their places.
 *
 * The status change is the whole mechanism: SEAT_FILTER counts only PENDING,
 * PAID and FREE, so moving a row to EXPIRED is what puts its places back on
 * sale. Nothing is deleted — the club asked for the record to survive, and an
 * organiser looking at a half-empty event needs to see that six people started
 * a booking and did not finish it.
 */
export async function expireStaleHolds(now: Date = new Date()): Promise<number> {
    const stale = await prisma.eventRegistration.findMany({
        where: {
            status: "PENDING",
            hold_expires_at: { not: null, lte: now },
        },
        include: { event: { select: { title: true } } },
    });

    let expired = 0;

    for (const registration of stale as any[]) {
        /*
         * Re-checked inside the loop against the row's own status, so a payment
         * that landed between the query and this update is not stamped EXPIRED
         * over the top of it. updateMany with the status in the filter makes
         * that check and the write one statement — a plain update would read,
         * decide, and write with a gap in the middle that a webhook can land in.
         */
        const result = await prisma.eventRegistration.updateMany({
            where: { id: registration.id, status: "PENDING" },
            data: {
                status: "EXPIRED",
                expired_at: now,
                // The deadline has done its job. Clearing it keeps the row out
                // of every subsequent sweep without needing a status check.
                hold_expires_at: null,
            },
        });

        if (result.count === 0) continue;
        expired++;

        await prisma.notification.create({
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
export async function sendPaymentReminders(
    now: Date = new Date(),
): Promise<{ reminded: number; failed: number; checked: number }> {
    const waiting = await prisma.eventRegistration.findMany({
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

    for (const registration of waiting as any[]) {
        /*
         * The status guard the client asked for, applied at send time rather
         * than at query time. The query above already filters on status, but
         * this loop can run for a while and a member can pay or be cancelled
         * partway through it — and the one thing worse than a late reminder is
         * a reminder contradicting what the member just did.
         */
        if (!shouldReceiveMail(registration)) continue;

        const deadline: Date = registration.hold_expires_at;
        const created: Date = registration.created_at;

        /* Only nudge once enough of the hold has gone. */
        const total = deadline.getTime() - created.getTime();
        const elapsed = now.getTime() - created.getTime();
        if (total > 0 && elapsed / total < REMINDER_AT_FRACTION) continue;

        const template = paymentReminderEmail({
            name: registration.user.name.split(" ")[0],
            eventTitle: registration.event.title,
            when: formatEventWhen(registration.event.date_time),
            location: registration.event.location,
            amountDue: `₹${(registration.amount_due_paise / 100).toFixed(2)}`,
            timeLeft: timeRemaining(deadline, now),
            payUrl: `${APP_URL}/tickets`,
        });

        const result = await sendMail({ ...template, to: registration.user.email });

        /*
         * Stamped whether or not it sent, so a permanently undeliverable
         * address is not retried on every sweep for a day. The failure is in
         * the log; the member's place is unaffected either way.
         */
        await prisma.eventRegistration.update({
            where: { id: registration.id },
            data: { payment_reminder_sent_at: now },
        });

        if (result.ok) {
            reminded++;
            await prisma.notification.create({
                data: {
                    user_id: registration.user_id,
                    message: `Payment for "${registration.event.title}" is still outstanding — ${timeRemaining(deadline, now)} left before your spot is released.`,
                    link: `/tickets`,
                },
            });
        } else {
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
export async function sweepHolds(now: Date = new Date()): Promise<HoldSweepSummary> {
    const expired = await expireStaleHolds(now);
    const { reminded, failed, checked } = await sendPaymentReminders(now);
    return { expired, reminded, failed, checked };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the in-process hold sweeper.
 *
 * Every five minutes, which is the accuracy a 24-hour deadline deserves — a
 * place coming back on sale up to five minutes late is invisible, and sweeping
 * more often is work for nothing. On serverless this never runs; the platform
 * cron calls /api/cron/holds instead.
 */
export function startHoldScheduler(intervalMs = 5 * 60_000) {
    if (timer) return;

    const tick = async () => {
        try {
            const s = await sweepHolds();
            if (s.expired || s.reminded || s.failed) {
                console.log(
                    `[holds] expired=${s.expired} reminded=${s.reminded} failed=${s.failed}`,
                );
            }
        } catch (error: any) {
            console.error("[holds] sweep failed:", error?.message || error);
        }
    };

    setTimeout(tick, 10_000);
    timer = setInterval(tick, intervalMs);
    console.log(`[holds] scheduler started (every ${Math.round(intervalMs / 60_000)}m)`);
}

export function stopHoldScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
