import prisma from "./prisma";
import { reminderEmail, sendMail } from "./mailer";
import { formatEventWhen } from "./time";
import { isTicketed, SEAT_HOLDING_STATUSES, shouldReceiveMail } from "./registrationStatus";

/**
 * Reminder sweeper.
 *
 * Runs on an interval and emails registrants whose reminder window has opened.
 *
 * Rules, chosen so behaviour is predictable rather than clever:
 *  - only PUBLISHED events that have not started yet,
 *  - a reminder becomes due at `start - hours_before` and stops being due once
 *    the window has been missed by more than GRACE_HOURS — see below,
 *  - blocked registrations are excluded — they are not attending,
 *  - closed bookings are excluded: expired, cancelled, deactivated, test and
 *    failed. PENDING are included, since the nudge is partly the point,
 *  - a unique (reminder_id, user_id) row is written per send, so a restart, an
 *    overlapping sweep or a manual run can never double-send.
 */

/**
 * How late a reminder may still be delivered.
 *
 * The rule used to be "stays due until the event starts", on the reasoning that
 * a late reminder beats none. In practice that is how a member gets told their
 * run starts "in 1 week" ninety minutes before the gun: the sweep only runs
 * when the platform cron fires, so a 168-hour reminder that was missed stayed
 * due for the whole week and went out with its original, now nonsensical,
 * wording attached.
 *
 * Six hours is the compromise. A sweep delayed by a normal outage still
 * delivers; one that missed the window by days stays quiet, which is the
 * better of the two wrong answers.
 */
const GRACE_HOURS = 6;

const APP_URL = process.env.APP_URL || "http://localhost:5173";

/** Offsets an organiser may choose, in hours. */
export const ALLOWED_OFFSETS = [168, 72, 48, 24, 12, 4, 2, 1];

export interface SweepSummary {
    checked: number;
    sent: number;
    failed: number;
    skipped: number;
    simulated: boolean;
}

/**
 * Sends any reminders that are currently due.
 * `eventId` limits the sweep to one event, used by the manual admin trigger.
 */
export async function sweepReminders(eventId?: string): Promise<SweepSummary> {
    const now = new Date();
    const summary: SweepSummary = {
        checked: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        simulated: false,
    };

    const reminders = (await prisma.eventReminder.findMany({
        where: {
            ...(eventId ? { event_id: eventId } : {}),
            event: { status: "PUBLISHED", date_time: { gt: now } },
        },
        include: {
            event: true,
            deliveries: { select: { user_id: true } },
        },
    })) as any[];

    for (const reminder of reminders) {
        const start = new Date(reminder.event.date_time);
        const dueAt = new Date(start.getTime() - reminder.hours_before * 3600_000);
        const staleAfter = new Date(dueAt.getTime() + GRACE_HOURS * 3600_000);

        summary.checked++;
        if (now < dueAt || now > staleAfter) {
            summary.skipped++;
            continue;
        }

        const alreadySent = new Set<string>(reminder.deliveries.map((d: any) => d.user_id));

        const registrations = (await prisma.eventRegistration.findMany({
            where: {
                event_id: reminder.event_id,
                blocked_at: null,
                // Expired, cancelled, deactivated and test bookings are not
                // attending, so they are not reminded. shouldReceiveMail below
                // is the same rule applied again at send time.
                status: { in: [...SEAT_HOLDING_STATUSES] },
            },
            include: { user: { select: { id: true, name: true, email: true } } },
        })) as any[];

        for (const reg of registrations) {
            if (alreadySent.has(reg.user_id)) {
                summary.skipped++;
                continue;
            }

            /*
             * Re-checked at send time, not just in the query. A sweep over a
             * large event takes a while, and a booking can expire or be
             * cancelled while it runs — the client's requirement is that no
             * automated mail contradicts the booking's state at the moment it
             * is triggered, and the query's snapshot is not that moment.
             */
            if (!shouldReceiveMail(reg)) {
                summary.skipped++;
                continue;
            }

            const ticketReady = isTicketed(reg.status);
            const template = reminderEmail({
                name: reg.user.name.split(" ")[0],
                eventTitle: reminder.event.title,
                when: formatEventWhen(start),
                location: reminder.event.location,
                hoursBefore: reminder.hours_before,
                ticketReady,
                /* The booking's own total, not the event's per-head price. A
                   party of four was being told it owed one entry fee. */
                amountDue: ticketReady
                    ? null
                    : `₹${(reg.amount_due_paise / 100).toFixed(2)}`,
                ticketUrl: `${APP_URL}/tickets`,
            });

            const result = await sendMail({ ...template, to: reg.user.email });
            if (result.simulated) summary.simulated = true;

            try {
                // Written whether or not the send worked, so a permanent failure
                // is not retried forever on every sweep. `status` records which.
                await prisma.reminderDelivery.create({
                    data: {
                        reminder_id: reminder.id,
                        user_id: reg.user_id,
                        status: result.ok ? "SENT" : "FAILED",
                        error: result.error ?? null,
                    },
                });
            } catch {
                // Unique constraint tripped — another sweep got there first.
                summary.skipped++;
                continue;
            }

            if (result.ok) {
                summary.sent++;
                // Mirror it in-app so the bell agrees with the inbox.
                await prisma.notification.create({
                    data: {
                        user_id: reg.user_id,
                        message: `Reminder: "${reminder.event.title}" starts ${formatEventWhen(start)}.`,
                        link: `/api/events/registration/${reg.id}/ticket`,
                    },
                });
            } else {
                summary.failed++;
            }
        }
    }

    return summary;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the interval sweeper. A single in-process timer is the right weight for
 * one server; a multi-instance deployment would need a shared lock or a real job
 * queue so instances do not race (the unique constraint would keep it correct,
 * just noisy).
 */
export function startReminderScheduler(intervalMs = 60_000) {
    if (timer) return;

    const tick = async () => {
        try {
            const s = await sweepReminders();
            if (s.sent || s.failed) {
                console.log(
                    `[reminders] sent=${s.sent} failed=${s.failed} skipped=${s.skipped}` +
                        (s.simulated ? " (logged only — SMTP not configured)" : "")
                );
            }
        } catch (error: any) {
            console.error("[reminders] sweep failed:", error?.message || error);
        }
    };

    // A short first run so a freshly added reminder fires promptly.
    setTimeout(tick, 5_000);
    timer = setInterval(tick, intervalMs);
    console.log(`[reminders] scheduler started (every ${Math.round(intervalMs / 1000)}s)`);
}

export function stopReminderScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
