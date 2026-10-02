import { Router, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest, requireRole } from "../middleware/auth";
import { ALLOWED_OFFSETS, sweepReminders } from "../utils/reminders";
import { mailerConfig, mailerConfigured, sendMail, testEmail, verifyMailer } from "../utils/mailer";
import { sendWorkbook, slugForFilename } from "../utils/sheets";
import { formatSheetDateTime, holdDeadline } from "../utils/time";
import { toPublicQuestion } from "../utils/questionnaire";
import {
    ADMIN_SETTABLE_STATUSES,
    type AdminSettableStatus,
    statusLabel,
} from "../utils/registrationStatus";
import { sweepHolds } from "../utils/holds";

const router = Router();

// 1. Financial Overview (Admin only)
router.get("/financial-overview", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        // Total revenue from PAID registrations
        const paidRegistrations = await prisma.eventRegistration.findMany({
            where: { status: "PAID" },
            include: { event: true },
        }) as any;

        /* Summed from what each booking was charged, not from the event price.
           A party of three paid three entries, and summing the event price
           counted it once — so revenue read low by exactly the guests. */
        const totalRevenue =
            (paidRegistrations as any[]).reduce((sum, reg) => sum + reg.amount_due_paise, 0) / 100;

        const pendingCounts = await prisma.eventRegistration.count({
            where: { status: "PENDING" },
        });

        const paidCounts = paidRegistrations.length;

        const failedCounts = await prisma.eventRegistration.count({
            where: { status: "FAILED" },
        });

        const freeCounts = await prisma.eventRegistration.count({
            where: { status: "FREE" },
        });

        /*
         * Head count, which is a different number from the registration count.
         *
         * One booking admits up to six people, so "3 registrations" was the
         * answer for a field of eight and there was nowhere on the dashboard
         * that said eight. A blocked booking is excluded: nobody on it is
         * getting in.
         */
        const peopleCount = await prisma.registrationGuest.count({
            where: { registration: { blocked_at: null } },
        });

        // Of those, the ones who can actually be scanned at the start line.
        const peopleTicketReady = await prisma.registrationGuest.count({
            where: { registration: { blocked_at: null, status: { in: ["PAID", "FREE"] } } },
        });

        res.json({
            total_revenue: totalRevenue,
            paid_count: paidCounts,
            pending_count: pendingCounts,
            failed_count: failedCounts,
            volunteer_free_count: freeCounts,
            people_count: peopleCount,
            people_ticket_ready: peopleTicketReady,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch financial overview" });
    }
});

/**
 * The roster of one or more events, as spreadsheet columns and rows.
 *
 * Shared by the single-event export and the all-events one so the two cannot
 * drift. They did drift once: the all-events file was built in the browser from
 * a different query and listed bookings rather than participants, so the same
 * party of four was four rows in one download and one row in the other.
 *
 * One row per *participant*, not per booking. The old single-event export
 * listed only the person who paid, so the rest of a party were invisible —
 * no good in a file whose job is building the event's WhatsApp group and
 * knowing who is turning up.
 *
 * Booking-level detail (payment, amount, status) repeats down a party's rows.
 * Duplicated on purpose: this is a sheet to be sorted and filtered, and a
 * blank cell meaning "see the row above" stops meaning anything the moment
 * somebody sorts by name.
 *
 * `includeEventColumns` prefixes the event's name and date, which only earns
 * its width when more than one event is in the file.
 */
async function buildRosterSheet(
    eventIds: string[],
    { includeEventColumns }: { includeEventColumns: boolean },
) {
    const registrations = (await prisma.eventRegistration.findMany({
        where: { event_id: { in: eventIds } },
        include: {
            event: { select: { id: true, title: true, date_time: true } },
            user: true,
            guests: { orderBy: [{ is_booker: "desc" }, { created_at: "asc" }] },
            answers: true,
        },
        orderBy: [{ event: { date_time: "desc" } }, { user: { name: "asc" } }],
    })) as any[];

    const questions = (
        await prisma.eventQuestion.findMany({
            where: { event_id: { in: eventIds } },
            orderBy: { position: "asc" },
        })
    ).map(toPublicQuestion);

    /* Across several events the same prompt can appear more than once, so
       questions are grouped by wording into a single column — an organiser
       filtering "Vegetarian" wants every event's answers, not one event's. */
    const promptColumns = [...new Set(questions.map((q) => q.prompt))];
    const promptForId = new Map(questions.map((q) => [q.id, q.prompt]));

    const columns = [
        ...(includeEventColumns
            ? [
                  { header: "Event", width: 30 },
                  { header: "Event date", width: 18 },
              ]
            : []),
        { header: "Participant", width: 26 },
        { header: "Mobile", width: 18 },
        { header: "Type", width: 10 },
        { header: "Booked by", width: 26 },
        { header: "Booker email", width: 30 },
        { header: "Status", width: 26 },
        { header: "Event role", width: 12 },
        { header: "Amount (₹)", width: 12 },
        { header: "Payment ID", width: 22 },
        { header: "Registered", width: 18 },
        { header: "Blocked", width: 9 },
        { header: "Checked in", width: 18 },
        ...promptColumns.map((p) => ({ header: p, width: 22 })),
        { header: "Registration ID", width: 38 },
    ];

    const rows: unknown[][] = [];

    for (const reg of registrations) {
        const answerFor = new Map<string, string>();
        for (const a of reg.answers ?? []) {
            const prompt = promptForId.get(a.question_id);
            if (prompt) answerFor.set(prompt, a.answer);
        }

        /* A booking taken before guests existed has no guest rows at all;
           fall back to the booker so the roster never silently omits somebody
           who is on the start line. */
        const party =
            reg.guests?.length > 0
                ? reg.guests
                : [{ name: reg.user.name, kind: "ADULT", is_booker: true, phone: reg.user.phone }];

        for (const person of party) {
            rows.push([
                ...(includeEventColumns
                    ? [reg.event.title, formatSheetDateTime(reg.event.date_time)]
                    : []),
                person.name,
                /* The account's number stands in for a booker whose guest row
                   predates the column, which is the same fallback the on-screen
                   roster applies — the two must not disagree about whether a
                   member has a number. A guest gets no such fallback: theirs
                   was simply never collected. */
                person.phone ?? (person.is_booker ? reg.user.phone ?? "" : ""),
                person.is_booker ? "Booker" : person.kind === "KID" ? "Child" : "Guest",
                reg.user.name,
                reg.user.email,
                statusLabel(reg.status),
                reg.role_at_event,
                (reg.amount_due_paise / 100).toFixed(2),
                reg.razorpay_payment_id || "",
                formatSheetDateTime(reg.created_at),
                reg.blocked_at ? "YES" : "NO",
                formatSheetDateTime(person.admitted_at ?? null),
                ...promptColumns.map((p) => answerFor.get(p) ?? ""),
                reg.id,
            ]);
        }
    }

    return { columns, rows };
}

// 2. One event's roster as a spreadsheet (Admin only)
router.get("/events/:id/roster/export", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const eventId = req.params.id as string;

        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }

        const { columns, rows } = await buildRosterSheet([eventId], {
            includeEventColumns: false,
        });

        await sendWorkbook(res, {
            filename: `roster-${slugForFilename(event.title)}.xlsx`,
            sheetName: "Roster",
            columns,
            rows,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to export roster" });
    }
});

/**
 * 2b. Every event's roster in one spreadsheet (Admin only).
 *
 * Replaces a version assembled in the browser, which fetched each event's
 * roster separately and rebuilt the columns by hand — so it drifted from the
 * single-event file, and a club with thirty events made thirty requests to
 * produce one download.
 */
router.get("/rosters/export", requireRole(["ADMIN"]), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const events = await prisma.event.findMany({ select: { id: true } });
        const { columns, rows } = await buildRosterSheet(
            events.map((e) => e.id),
            { includeEventColumns: true },
        );

        await sendWorkbook(res, {
            filename: `b2-club-all-rosters-${new Date().toISOString().slice(0, 10)}.xlsx`,
            sheetName: "All rosters",
            columns,
            rows,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to export rosters" });
    }
});

/**
 * 2c. The whole membership as a spreadsheet (Admin only).
 *
 * Separate from the roster: that answers "who is coming to this event", this
 * answers "who is in the club". Both were asked for, and merging them would
 * mean one file that is wrong for both jobs.
 */
router.get("/members/export", requireRole(["ADMIN"]), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const members = (await prisma.user.findMany({
            orderBy: { name: "asc" },
            include: {
                registrations: {
                    select: { status: true, blocked_at: true, amount_due_paise: true },
                },
            },
        })) as any[];

        const rows = members.map((u) => {
            /* Counted here rather than in SQL because the same three numbers
               are wanted per member and the membership is in the hundreds, not
               the millions. A groupBy would be faster and much harder to read. */
            const live = u.registrations.filter(
                (r: any) => !r.blocked_at && (r.status === "PAID" || r.status === "FREE"),
            );
            const paisePaid = live.reduce((sum: number, r: any) => sum + r.amount_due_paise, 0);

            return [
                u.name,
                u.email,
                u.phone ?? "",
                u.emergency_contact ?? "",
                u.role,
                u.email_verified_at ? "Verified" : "Not verified",
                formatSheetDateTime(u.email_verified_at),
                String(live.length),
                (paisePaid / 100).toFixed(2),
                formatSheetDateTime(u.created_at),
                u.id,
            ];
        });

        await sendWorkbook(res, {
            filename: "b2-club-members.xlsx",
            sheetName: "Members",
            columns: [
                { header: "Name", width: 26 },
                { header: "Email", width: 30 },
                { header: "Mobile", width: 18 },
                { header: "Emergency contact", width: 20 },
                { header: "Role", width: 12 },
                { header: "Email status", width: 14 },
                { header: "Verified on", width: 18 },
                { header: "Events attended", width: 15 },
                { header: "Total paid (₹)", width: 14 },
                { header: "Joined", width: 18 },
                { header: "Member ID", width: 38 },
            ],
            rows,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to export members" });
    }
});

/**
 * 2b. Event roster as JSON (Admin only).
 *
 * The CSV export above is for accounting; this is the interactive view the event
 * page uses, so it carries the ids and block state the UI needs to act on.
 */
router.get("/events/:id/registrations", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const eventId = req.params.id as string;

        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }

        const registrations = await prisma.eventRegistration.findMany({
            where: { event_id: eventId },
            include: {
                /* `phone` is here as a fallback for a booking made before
                   guest rows carried one. The Excel export already falls back
                   this way, and without it the screen would read "no number"
                   for a booking whose exported row shows one. */
                user: { select: { id: true, name: true, email: true, role: true, phone: true } },
                // One booking can be several people, so the roster has to be
                // able to show who a row actually covers and which of them
                // have arrived.
                guests: { orderBy: [{ is_booker: "desc" }, { created_at: "asc" }] },
            },
            orderBy: { user: { name: "asc" } },
        }) as any;

        res.json(
            (registrations as any[]).map((r) => ({
                id: r.id,
                user_id: r.user_id,
                name: r.user.name,
                email: r.user.email,
                club_role: r.user.role,
                /** The member's account number, for the fallback described above. */
                member_phone: r.user.phone,
                role_at_event: r.role_at_event,
                status: r.status,
                waiver_signed: r.waiver_signed,
                payment_id: r.razorpay_payment_id,
                blocked_at: r.blocked_at,
                // Attendance and refund state, so the roster can drive check-in
                // and refunds without a second request per row.
                attended_at: r.attended_at,
                refund_id: r.refund_id,
                refunded_at: r.refunded_at,
                refund_amount: r.refund_amount,
                // Only what the roster renders — no admitted_by, which would
                // name one crew member to every admin looking at the list.
                status_label: statusLabel(r.status),
                // The hold, so an organiser can see which bookings are about to
                // release their places rather than discovering it afterwards.
                hold_expires_at: r.hold_expires_at,
                expired_at: r.expired_at,
                cancelled_at: r.cancelled_at,
                cancel_reason: r.cancel_reason,
                created_at: r.created_at,
                guests: (r.guests ?? []).map((g: any) => ({
                    id: g.id,
                    name: g.name,
                    kind: g.kind,
                    is_booker: g.is_booker,
                    admitted_at: g.admitted_at,
                    // The number the club adds to the WhatsApp group.
                    phone: g.phone,
                })),
                party_size: (r.guests ?? []).length || 1,
                amount_due_paise: r.amount_due_paise,
                razorpay_order_id: r.razorpay_order_id ?? null,
            }))
        );
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch registrations" });
    }
});

/**
 * 2c. Block or unblock a registration (Admin only).
 *
 * Blocking bars the person from the event without touching their payment
 * status: they lose their ticket, cannot re-register (the existing-registration
 * check catches the row), and unblocking restores everything as it was.
 */
router.put("/registrations/:id/block", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const registrationId = req.params.id as string;
        const { blocked } = req.body;

        if (typeof blocked !== "boolean") {
            res.status(400).json({ error: "`blocked` must be true or false" });
            return;
        }

        const registration = await prisma.eventRegistration.findUnique({
            where: { id: registrationId },
            include: { event: true, user: { select: { id: true, name: true } } },
        }) as any;

        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }

        const alreadyBlocked = Boolean(registration.blocked_at);
        if (alreadyBlocked === blocked) {
            res.json({
                message: `${registration.user.name} is already ${blocked ? "blocked" : "allowed"}`,
                changed: false,
            });
            return;
        }

        const updated = await prisma.eventRegistration.update({
            where: { id: registrationId },
            data: { blocked_at: blocked ? new Date() : null },
        }) as any;

        await prisma.notification.create({
            data: {
                user_id: registration.user_id,
                message: blocked
                    ? `An organiser has removed you from "${registration.event.title}". Your ticket is no longer valid — contact them for details.`
                    : `You're back on the list for "${registration.event.title}". Your ticket is valid again.`,
            },
        });

        res.json({
            message: blocked
                ? `${registration.user.name} is blocked from ${registration.event.title}`
                : `${registration.user.name} can attend ${registration.event.title} again`,
            registration: {
                id: updated.id,
                status: updated.status,
                blocked_at: updated.blocked_at,
            },
            changed: true,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to update the block" });
    }
});

/**
 * 2d. Cancel, deactivate or flag a registration as a test (Admin only).
 *
 * Distinct from blocking, which bars a *person* while leaving their booking
 * intact. This retires the *booking*: its places go back on sale, it stops
 * receiving mail, and it drops out of the counts — but the row survives, with
 * a reason attached, because an organiser reconciling a half-empty event needs
 * to know the difference between "nobody booked" and "four test bookings were
 * cleaned up".
 *
 * Restoring is allowed and goes back to PENDING or PAID depending on whether
 * money was taken, because the alternative — a one-way door — means the first
 * misclick costs a member their place.
 */
router.put("/registrations/:id/status", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const registrationId = req.params.id as string;
        const { status, reason } = req.body ?? {};

        const restoring = status === "RESTORE";
        if (!restoring && !ADMIN_SETTABLE_STATUSES.includes(status as AdminSettableStatus)) {
            res.status(400).json({
                error: `\`status\` must be one of ${ADMIN_SETTABLE_STATUSES.join(", ")}, or RESTORE.`,
            });
            return;
        }

        const registration = (await prisma.eventRegistration.findUnique({
            where: { id: registrationId },
            include: { event: true, user: { select: { id: true, name: true } } },
        })) as any;

        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }

        if (restoring) {
            /*
             * Where a restored booking lands is decided by the money, not by
             * what it was before. A cancelled booking that had been paid is
             * still paid — Razorpay holds the payment either way — so putting
             * it back to PENDING would ask the member to pay twice. One with
             * no payment against it goes back to awaiting payment, and gets a
             * fresh hold rather than its original expired one.
             */
            const wasPaid = Boolean(registration.razorpay_payment_id);
            const updated = await prisma.eventRegistration.update({
                where: { id: registrationId },
                data: {
                    status: wasPaid ? "PAID" : "PENDING",
                    cancelled_at: null,
                    cancel_reason: null,
                    expired_at: null,
                    hold_expires_at: wasPaid ? null : holdDeadline(registration.event.hold_minutes),
                    payment_reminder_sent_at: null,
                },
            });

            await prisma.notification.create({
                data: {
                    user_id: registration.user_id,
                    message: `Your registration for "${registration.event.title}" has been reinstated${
                        wasPaid ? " — your ticket is live again." : ". Payment is still outstanding."
                    }`,
                    link: "/tickets",
                },
            });

            res.json({
                message: `${registration.user.name}'s registration is active again`,
                registration: updated,
                changed: true,
            });
            return;
        }

        const now = new Date();
        const updated = await prisma.eventRegistration.update({
            where: { id: registrationId },
            data: {
                status,
                cancelled_at: now,
                cancel_reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
                // The hold is moot once the booking is retired, and leaving it
                // set would have the expiry sweep pick the row up again.
                hold_expires_at: null,
            },
        });

        /* A test registration is an organiser's own housekeeping — telling the
           member their booking is now a "Test Registration" would be noise
           about something they did not do. The other two, they should know. */
        if (status !== "TEST") {
            await prisma.notification.create({
                data: {
                    user_id: registration.user_id,
                    message:
                        status === "CANCELLED"
                            ? `Your registration for "${registration.event.title}" has been cancelled${
                                  updated.cancel_reason ? ` — ${updated.cancel_reason}` : "."
                              }`
                            : `Your registration for "${registration.event.title}" has been deactivated by an organiser.`,
                    link: "/tickets",
                },
            });
        }

        res.json({
            message: `${registration.user.name}'s registration is now ${statusLabel(status)}`,
            registration: updated,
            changed: true,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to update the registration" });
    }
});

/**
 * 2e. Run the hold sweep by hand (Admin only).
 *
 * The same sweep the scheduler runs. Useful when an organiser wants the places
 * from a batch of abandoned bookings back right now rather than within five
 * minutes, and it is how the behaviour gets demonstrated in UAT without
 * waiting a day.
 */
router.post("/holds/sweep", requireRole(["ADMIN"]), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const summary = await sweepHolds();
        res.json({ message: "Hold sweep complete", ...summary });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Hold sweep failed" });
    }
});

/** 2f. Reminder schedule and delivery status for one event (Admin only). */
router.get("/events/:id/reminders", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const eventId = req.params.id as string;
        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }

        const reminders = (await prisma.eventReminder.findMany({
            where: { event_id: eventId },
            orderBy: { hours_before: "desc" },
            include: { deliveries: true },
        })) as any[];

        const start = new Date(event.date_time).getTime();

        res.json({
            allowed_offsets: ALLOWED_OFFSETS,
            mailer_configured: mailerConfigured,
            reminders: reminders.map((r) => {
                const dueAt = new Date(start - r.hours_before * 3600_000);
                return {
                    id: r.id,
                    hours_before: r.hours_before,
                    due_at: dueAt,
                    // Not yet due, due now, or already fired for everyone.
                    state: r.deliveries.length > 0 ? "sent" : dueAt <= new Date() ? "due" : "scheduled",
                    sent_count: r.deliveries.filter((d: any) => d.status === "SENT").length,
                    failed_count: r.deliveries.filter((d: any) => d.status === "FAILED").length,
                };
            }),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch reminders" });
    }
});

/** 2e. Run the sweep now for one event (Admin only). Idempotent. */
router.post("/events/:id/reminders/run", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const summary = await sweepReminders(req.params.id as string);
        res.json({
            message: summary.sent
                ? `${summary.sent} reminder${summary.sent === 1 ? "" : "s"} sent`
                : "Nothing was due — no reminders sent",
            ...summary,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to run reminders" });
    }
});

/** 2f. Email diagnostics (Admin only). */
router.get("/mailer", requireRole(["ADMIN"]), async (_req: AuthRequest, res: Response): Promise<void> => {
    const result = await verifyMailer();
    res.json({
        configured: mailerConfigured,
        ok: result.ok,
        simulated: result.simulated,
        error: result.error ?? null,
        // Which settings are present, so a misconfiguration is diagnosable from
        // the admin screen rather than by reading the server's .env.
        config: mailerConfig(),
    });
});

/**
 * 2b. Send a real test email to the organiser's own address.
 *
 * `verify()` above only completes the SMTP handshake and authenticates. That
 * passing tells you the credentials are right — it does not tell you a message is
 * accepted and delivered, which is where the actual failures live: an unverified
 * sender address, a provider sandbox that only allows one recipient, SPF/DKIM
 * rejection, or a From that the relay refuses. Only a real send proves the path.
 *
 * Deliberately sends only to the caller, never an arbitrary address, so this can't
 * be turned into a way to send mail to anyone.
 */
router.post("/mailer/test", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const admin = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { name: true, email: true },
        });
        if (!admin) {
            res.status(404).json({ error: "Account not found" });
            return;
        }

        const cfg = mailerConfig();

        if (!cfg.configured) {
            res.status(400).json({
                error: `SMTP isn't configured, so nothing can be sent. Missing: ${cfg.missing.join(", ")}.`,
                config: cfg,
            });
            return;
        }

        const mail = testEmail({ name: admin.name.split(" ")[0], host: cfg.host ?? "SMTP" });
        const started = Date.now();
        const result = await sendMail({ ...mail, to: admin.email });
        const ms = Date.now() - started;

        if (!result.ok) {
            res.status(502).json({
                error: `The relay rejected it: ${result.error}`,
                sent: false,
                config: cfg,
            });
            return;
        }

        res.json({
            message: `Test email sent to ${admin.email}`,
            sent: true,
            to: admin.email,
            took_ms: ms,
            config: cfg,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Could not send the test email" });
    }
});

// 3. Member directory (Admin only)
// The club roster of people, as opposed to a single event's roster. Carries the
// contact detail an organiser actually needs on event day.
router.get("/members", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        /**
         * The full directory: everyone, every role, with the history an organiser
         * needs to make a decision about a person — do they turn up, have they paid,
         * do they marshal.
         *
         * Registrations, results and shift assignments are pulled in one query each
         * and folded together in memory rather than N queries per person. At club
         * scale that is two extra round-trips total.
         *
         * Imported health workouts are deliberately NOT included. Members are told
         * "organisers never see them" on the profile page, and that has to stay true.
         */
        const [members, registrations, results, shifts] = await Promise.all([
            prisma.user.findMany({
                orderBy: [{ role: "asc" }, { name: "asc" }],
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    created_at: true,
                    emergency_contact: true,
                    _count: { select: { registrations: true } },
                },
            }) as any,
            prisma.eventRegistration.findMany({
                select: {
                    user_id: true,
                    status: true,
                    blocked_at: true,
                    attended_at: true,
                    role_at_event: true,
                    refunded_at: true,
                    refund_amount: true,
                    event: { select: { title: true, date_time: true, price: true } },
                },
            }) as any,
            prisma.eventResult.findMany({
                select: { user_id: true, status: true, finish_secs: true },
            }) as any,
            prisma.shiftAssignment.findMany({ select: { user_id: true } }) as any,
        ]);

        /** Per-person rollup, keyed by user id. */
        const byUser = new Map<string, any>();
        const ensure = (id: string) => {
            if (!byUser.has(id)) {
                byUser.set(id, {
                    registrations: 0,
                    attended: 0,
                    paid: 0,
                    pending: 0,
                    comped: 0,
                    refunded: 0,
                    blocked: 0,
                    marshalled: 0,
                    total_paid: 0,
                    total_refunded: 0,
                    last_event: null as null | { title: string; date_time: Date; attended: boolean },
                    finished: 0,
                });
            }
            return byUser.get(id);
        };

        for (const r of registrations as any[]) {
            const u = ensure(r.user_id);
            u.registrations += 1;
            if (r.blocked_at) u.blocked += 1;
            if (r.attended_at) u.attended += 1;
            if (r.role_at_event === "VOLUNTEER") u.marshalled += 1;

            if (r.status === "PAID") {
                u.paid += 1;
                u.total_paid += r.amount_due_paise / 100;
            } else if (r.status === "PENDING") u.pending += 1;
            else if (r.status === "FREE") u.comped += 1;

            if (r.refunded_at) {
                u.refunded += 1;
                u.total_refunded += r.refund_amount ?? 0;
            }

            // Most recent session they were on the list for, attended or not.
            if (!u.last_event || r.event.date_time > u.last_event.date_time) {
                u.last_event = {
                    title: r.event.title,
                    date_time: r.event.date_time,
                    attended: Boolean(r.attended_at),
                };
            }
        }

        for (const res_ of results as any[]) {
            if (res_.status === "FINISHED" && res_.finish_secs) ensure(res_.user_id).finished += 1;
        }
        /** Marshal posts claimed, which is separate from registering as a volunteer. */
        const shiftCounts = new Map<string, number>();
        for (const s of shifts as any[]) {
            shiftCounts.set(s.user_id, (shiftCounts.get(s.user_id) ?? 0) + 1);
        }

        // Never expose password_hash; everything else here is deliberate — an
        // organiser needs the emergency contact on the day, and this route is
        // ADMIN-only.
        res.json(
            (members as any[]).map((m) => {
                return {
                    id: m.id,
                    name: m.name,
                    email: m.email,
                    role: m.role,
                    created_at: m.created_at,
                    emergency_contact: m.emergency_contact,
                    has_emergency_contact: Boolean(m.emergency_contact),
                    registration_count: m._count.registrations,

                    /** Complete history for the directory's detail view. */
                    activity: (() => {
                        const u = byUser.get(m.id);
                        const shiftsClaimed = shiftCounts.get(m.id) ?? 0;
                        if (!u) {
                            return {
                                registrations: 0,
                                attended: 0,
                                no_shows: 0,
                                attendance_rate: null,
                                paid_count: 0,
                                pending_count: 0,
                                comped_count: 0,
                                refunded_count: 0,
                                blocked_count: 0,
                                marshalled_count: 0,
                                shifts_claimed: shiftsClaimed,
                                results_finished: 0,
                                total_paid: 0,
                                total_refunded: 0,
                                last_event: null,
                            };
                        }
                        // Only entries that could have been attended count against
                        // attendance: a pending or blocked one was never expected.
                        const expected = u.paid + u.comped - u.blocked;
                        return {
                            registrations: u.registrations,
                            attended: u.attended,
                            no_shows: Math.max(0, expected - u.attended),
                            attendance_rate:
                                expected > 0 ? Math.round((u.attended / expected) * 100) : null,
                            paid_count: u.paid,
                            pending_count: u.pending,
                            comped_count: u.comped,
                            refunded_count: u.refunded,
                            blocked_count: u.blocked,
                            marshalled_count: u.marshalled,
                            shifts_claimed: shiftsClaimed,
                            results_finished: u.finished,
                            total_paid: Number(u.total_paid.toFixed(2)),
                            total_refunded: Number(u.total_refunded.toFixed(2)),
                            last_event: u.last_event,
                        };
                    })(),
                };
            })
        );
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch members" });
    }
});

/**
 * 4. Change a member's role (Admin only) — e.g. promoting a MEMBER to
 * VOLUNTEER, which comps their entry on future registrations.
 *
 * Deliberately cannot grant ADMIN: this is a member-management screen, and
 * handing out organiser rights from it would make privilege escalation a
 * one-click operation. Promote an organiser directly in the database instead.
 */
const ASSIGNABLE_ROLES = ["MEMBER", "VOLUNTEER", "VISITOR", "BLOCKED"];

router.put("/members/:id/role", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.params.id as string;
        const { role } = req.body;

        if (!role) {
            res.status(400).json({ error: "A role is required" });
            return;
        }

        if (!ASSIGNABLE_ROLES.includes(role)) {
            res.status(400).json({
                error: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}. Organiser rights cannot be granted here.`,
            });
            return;
        }

        // An admin changing their own role could lock the club out of its own
        // admin tools, so it is refused outright.
        if (userId === req.user!.id) {
            res.status(400).json({ error: "You cannot change your own role" });
            return;
        }

        const target = await prisma.user.findUnique({
            where: { id: userId },
            // Explicit select: findUnique would otherwise include password_hash,
            // and this object is echoed back in the response below.
            select: { id: true, name: true, email: true, role: true },
        });
        if (!target) {
            res.status(404).json({ error: "Member not found" });
            return;
        }

        if (target.role === "ADMIN") {
            res.status(403).json({ error: "Another organiser's role cannot be changed here" });
            return;
        }

        if (target.role === role) {
            res.json({
                message: `${target.name} is already a ${role.toLowerCase()}`,
                user: target,
                changed: false,
            });
            return;
        }

        const previousRole = target.role;

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { role },
            select: { id: true, name: true, email: true, role: true },
        });

        // Tell the person what changed, and what it means for them.
        const message =
            role === "BLOCKED"
                ? "Your account has been blocked by an organiser. Please contact the club."
                : role === "VOLUNTEER"
                  ? `You're now a club volunteer. Marshal an event and your entry is comped — future registrations are free.`
                  : previousRole === "VOLUNTEER"
                    ? `Your club role is now ${role.toLowerCase()}. Volunteer comped entry no longer applies.`
                    : `Your club role is now ${role.toLowerCase()}.`;

        await prisma.notification.create({
            data: { user_id: userId, message },
        });

        res.json({
            message: `${updated.name} is now ${role === "BLOCKED" ? "blocked" : `a ${role.toLowerCase()}`}`,
            user: updated,
            previous_role: previousRole,
            changed: true,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to change role" });
    }
});

/**
 * 4b. Permanently Delete / Remove a member account (Admin only).
 *
 * Removes the member and cascades all child records cleanly in one transaction.
 */
router.delete("/members/:id", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.params.id as string;
        if (userId === req.user!.id) {
            res.status(400).json({ error: "You cannot delete your own organiser account" });
            return;
        }

        const target = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true, role: true },
        });

        if (!target) {
            res.status(404).json({ error: "Member not found" });
            return;
        }

        if (target.role === "ADMIN") {
            res.status(403).json({ error: "Cannot delete an organiser from this panel" });
            return;
        }

        await prisma.$transaction(async (tx) => {
            // Remove dependent records in child tables
            await tx.registrationAnswer.deleteMany({ where: { registration: { user_id: userId } } });
            await tx.registrationGuest.deleteMany({ where: { registration: { user_id: userId } } });
            await tx.eventRegistration.deleteMany({ where: { user_id: userId } });
            await tx.notification.deleteMany({ where: { user_id: userId } });
            await tx.comment.deleteMany({ where: { user_id: userId } });
            await tx.post.deleteMany({ where: { author_id: userId } });
            await tx.pollVote.deleteMany({ where: { user_id: userId } });
            await tx.photo.deleteMany({ where: { uploader_id: userId } });
            await tx.eventFeedback.deleteMany({ where: { user_id: userId } });
            await tx.eventResult.deleteMany({ where: { user_id: userId } });
            await tx.shiftAssignment.deleteMany({ where: { user_id: userId } });
            await tx.checkpointSplit.deleteMany({ where: { user_id: userId } });
            await tx.healthWorkout.deleteMany({ where: { user_id: userId } });
            await tx.verificationCode.deleteMany({ where: { user_id: userId } });
            await tx.passwordResetToken.deleteMany({ where: { user_id: userId } });
            await tx.user.delete({ where: { id: userId } });
        });

        res.json({ message: `Member ${target.name} (${target.email}) was removed successfully` });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to remove member" });
    }
});

// 5. Poll Analytics (Admin only)
router.get("/polls/:id/analytics", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const pollId = req.params.id as string;

        const poll = await prisma.poll.findUnique({
            where: { id: pollId },
            include: {
                options: {
                    include: {
                        _count: { select: { votes: true } },
                    },
                },
            },
        });

        if (!poll) {
            res.status(404).json({ error: "Poll not found" });
            return;
        }

        // Calculate total votes cast
        const totalVotes = (poll as any).options.reduce((sum: number, opt: any) => sum + opt._count.votes, 0);

        const optionsAnalytics = (poll as any).options.map((opt: any) => {
            const voteCount = opt._count.votes;
            const percentage = totalVotes > 0 ? parseFloat(((voteCount / totalVotes) * 100).toFixed(2)) : 0;

            return {
                option_id: opt.id,
                option_text: opt.option_text,
                vote_count: voteCount,
                percentage,
            };
        });

        res.json({
            poll_id: poll.id,
            title: poll.title,
            active: poll.active,
            total_votes: totalVotes,
            options_analytics: optionsAnalytics,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to fetch poll analytics" });
    }
});

export default router;
