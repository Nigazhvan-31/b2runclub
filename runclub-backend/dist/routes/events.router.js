"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVALID = void 0;
exports.parseCapacity = parseCapacity;
exports.parseKids = parseKids;
exports.parseType = parseType;
exports.parseDiscount = parseDiscount;
exports.seatFilter = seatFilter;
exports.seatsTaken = seatsTaken;
exports.capacityOf = capacityOf;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const verified_1 = require("../middleware/verified");
const party_1 = require("../utils/party");
const storage_1 = require("../utils/storage");
const razorpay_1 = __importDefault(require("razorpay"));
const reminders_1 = require("../utils/reminders");
const time_1 = require("../utils/time");
const phone_1 = require("../utils/phone");
const registrationStatus_1 = require("../utils/registrationStatus");
const questionnaire_1 = require("../utils/questionnaire");
const secrets_1 = require("../utils/secrets");
const router = (0, express_1.Router)();
// Razorpay SDK setup. Both values are validated at startup; the placeholders are
// only here to satisfy the constructor when Razorpay is deliberately unconfigured,
// in which case isRazorpayMock short-circuits every call.
const razorpayKeyId = secrets_1.RAZORPAY_KEY_ID ?? "unconfigured";
const razorpay = new razorpay_1.default({
    key_id: razorpayKeyId,
    key_secret: secrets_1.RAZORPAY_KEY_SECRET ?? "unconfigured",
});
const isRazorpayMock = secrets_1.RAZORPAY_MOCK_MODE;
/** Sentinel distinguishing "the caller sent something invalid" from "unlimited". */
exports.INVALID = Symbol("invalid-capacity");
/**
 * Normalises a capacity value from a request body.
 *
 * Returns `undefined` when the field was omitted (leave it alone), `null` for an
 * explicit blank meaning unlimited, a positive integer, or INVALID.
 */
function parseCapacity(raw) {
    if (raw === undefined)
        return undefined;
    if (raw === null || raw === "")
        return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1)
        return exports.INVALID;
    return n;
}
/**
 * Normalises the two children fields together, because they only make sense
 * together.
 *
 * A price with the toggle off is meaningless, and the toggle on with no price is
 * an event nobody can bring a child to — so the first is cleared and the second
 * is refused. Returns INVALID for a malformed price so the caller can answer
 * 400 rather than storing NaN.
 */
function parseKids(raw) {
    const allowed = raw.kids_allowed === true || raw.kids_allowed === "true";
    if (!allowed) {
        // Cleared rather than kept: a stale price behind a disabled toggle is
        // what gets switched back on months later and surprises somebody.
        return { kids_allowed: false, kid_price: null };
    }
    if (raw.kid_price === undefined || raw.kid_price === null || raw.kid_price === "") {
        return exports.INVALID;
    }
    const price = Number(raw.kid_price);
    if (!Number.isFinite(price) || price < 0)
        return exports.INVALID;
    return { kids_allowed: true, kid_price: price };
}
/**
 * Longest a discipline may be.
 *
 * The picker offers a free-text option, so this is no longer a closed set —
 * and a discipline is rendered in a badge on every card, so an essay pasted in
 * would break the layout of pages nobody was editing. Enforced here because a
 * limit that only exists in the form is not a limit.
 */
const MAX_TYPE_LENGTH = 24;
/** Trims a discipline and rejects an empty or over-long one. */
function parseType(raw) {
    if (typeof raw !== "string")
        return exports.INVALID;
    const value = raw.trim();
    if (value.length < 2 || value.length > MAX_TYPE_LENGTH)
        return exports.INVALID;
    return value;
}
/**
 * Normalises the group discount an organiser typed.
 *
 * Blank and zero both mean "no discount on this session" and are stored as null,
 * so the field reads as unset rather than as a discount of nothing. A negative
 * figure is refused instead of clamped: somebody typing "-50" meant something,
 * and silently storing 0 would hide that the event is not priced the way they
 * think it is.
 */
function parseDiscount(raw) {
    if (raw === undefined || raw === null || raw === "")
        return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
        return exports.INVALID;
    return value === 0 ? null : value;
}
/**
 * Filter defining which *bookings* hold places. Shared by the single-event count
 * and the grouped count used for lists, so the two can never disagree.
 *
 *  - A blocked entry frees its places: an organiser barring someone should open
 *    the spots back up.
 *  - FAILED covers failed and refunded payments, which likewise release them.
 *  - EXPIRED, CANCELLED, DEACTIVATED and TEST are all absent, so none of them
 *    consumes capacity. A test booking left on a capped session used to count
 *    against real members.
 *  - PENDING holds places, so a rush of half-finished checkouts cannot oversell
 *    the event — but only until its hold runs out.
 *
 * That last clause is why this is a function of `now` rather than a constant. A
 * PENDING booking past its `hold_expires_at` is expired in every sense that
 * matters; the only thing it is waiting for is a sweep to stamp the status.
 * Counting it until then would make availability depend on how recently the
 * sweeper ran — and on Vercel's Hobby plan a cron fires once a day, which would
 * turn a "24 hour" hold into anywhere between 24 and 48 hours of blocked
 * capacity. Deciding it here makes the count right the moment the deadline
 * passes, whatever the scheduler is doing, leaving the sweep responsible only
 * for the durable record and the member's notification.
 *
 * Volunteers are not excluded here. A booking is a party: the volunteer's own
 * place is free, but anyone they bring is a participant and takes a place.
 * Excluding the whole row would let a marshal walk four guests past a full
 * event, so the exemption lives at the guest level — see seatsTaken.
 */
function seatFilter(now = new Date()) {
    return {
        blocked_at: null,
        OR: [
            { status: { in: ["PAID", "FREE"] } },
            {
                status: "PENDING",
                OR: [{ hold_expires_at: null }, { hold_expires_at: { gt: now } }],
            },
        ],
    };
}
/**
 * How many participant places an event has given away.
 *
 * Counts *people*, not bookings. It counted rows until parties existed, which
 * would now read a family of five as one place and oversell every capped
 * session. Children count; a volunteer's own place does not, which is the `OR`
 * below: keep a guest row if it is not the booker, or if the booker is not a
 * volunteer.
 */
async function seatsTaken(eventId) {
    return prisma_1.default.registrationGuest.count({
        where: {
            registration: { event_id: eventId, ...seatFilter() },
            OR: [{ is_booker: false }, { registration: { role_at_event: { not: "VOLUNTEER" } } }],
        },
    });
}
/** Capacity view for an event, safe to expose publicly. */
async function capacityOf(event) {
    if (event.capacity === null) {
        return { capacity: null, taken: await seatsTaken(event.id), spots_left: null, full: false };
    }
    const taken = await seatsTaken(event.id);
    return {
        capacity: event.capacity,
        taken,
        spots_left: Math.max(0, event.capacity - taken),
        full: taken >= event.capacity,
    };
}
/**
 * Normalises a `reminder_offsets` payload into a validated, de-duplicated,
 * descending list of hours. Returns null when the caller omitted the field, so
 * an update can distinguish "leave alone" from "set to none".
 */
function parseOffsets(raw) {
    if (raw === undefined)
        return null;
    if (!Array.isArray(raw))
        return [];
    const cleaned = raw
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n) && reminders_1.ALLOWED_OFFSETS.includes(n));
    return [...new Set(cleaned)].sort((a, b) => b - a);
}
/**
 * Reads a whole-number setting that may be left blank.
 *
 * Returns undefined for "not supplied", null for "explicitly cleared, use the
 * club default", and INVALID for a value that is neither. An update needs all
 * three: without the distinction, clearing a field and omitting it look the
 * same and one of them silently does the wrong thing.
 */
function parseOptionalCount(raw, min) {
    if (raw === undefined)
        return undefined;
    if (raw === null || raw === "")
        return null;
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < min)
        return exports.INVALID;
    return n;
}
/**
 * Replaces an event's questionnaire with exactly `questions`.
 *
 * Rewritten wholesale rather than diffed, and that costs the existing answers
 * for any question that changes — which is deliberate and is why the admin
 * form warns before saving. Matching an edited question to its old answers is
 * guesswork: if an organiser rewrites "Food preference" into "Shirt size", the
 * answers underneath it mean nothing, and keeping them would put "Vegetarian"
 * in a shirt-size column on the roster.
 */
async function syncQuestions(eventId, questions) {
    const existing = await prisma_1.default.eventQuestion.findMany({
        where: { event_id: eventId },
        orderBy: { position: "asc" },
    });
    /* Unchanged questions are left alone so their answers survive an edit that
       only touched the question next to them. */
    const sameShape = (a, b) => a.prompt === b.prompt &&
        a.kind === b.kind &&
        a.required === b.required &&
        a.options === JSON.stringify(b.options);
    const matched = new Set();
    for (const [i, q] of questions.entries()) {
        const hit = existing.find((e) => !matched.has(e.id) && sameShape(e, q));
        if (hit) {
            matched.add(hit.id);
            if (hit.position !== i) {
                await prisma_1.default.eventQuestion.update({ where: { id: hit.id }, data: { position: i } });
            }
        }
    }
    const stale = existing.filter((e) => !matched.has(e.id));
    if (stale.length) {
        await prisma_1.default.eventQuestion.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } });
    }
    for (const [i, q] of questions.entries()) {
        const already = existing.find((e) => matched.has(e.id) && sameShape(e, q));
        if (already)
            continue;
        await prisma_1.default.eventQuestion.create({
            data: {
                event_id: eventId,
                prompt: q.prompt,
                kind: q.kind,
                options: JSON.stringify(q.options),
                required: q.required,
                position: i,
            },
        });
    }
}
/** Replaces an event's reminders with exactly `offsets`. */
async function syncReminders(eventId, offsets) {
    const existing = await prisma_1.default.eventReminder.findMany({ where: { event_id: eventId } });
    const keep = new Set(offsets);
    // Removing a reminder drops its delivery log too (cascade), which is fine:
    // the reminder no longer exists, so there is nothing to be idempotent about.
    const toDelete = existing.filter((r) => !keep.has(r.hours_before));
    if (toDelete.length) {
        await prisma_1.default.eventReminder.deleteMany({
            where: { id: { in: toDelete.map((r) => r.id) } },
        });
    }
    const have = new Set(existing.map((r) => r.hours_before));
    const toCreate = offsets.filter((h) => !have.has(h));
    for (const hours_before of toCreate) {
        await prisma_1.default.eventReminder.create({ data: { event_id: eventId, hours_before } });
    }
}
// 1. Create Event (Admin only)
router.post("/", (0, auth_1.requireRole)(["ADMIN"]), async (req, res) => {
    try {
        const { title, type, date_time, location, price, status, description, capacity, cover_url } = req.body;
        const kids = parseKids(req.body ?? {});
        if (kids === exports.INVALID) {
            res.status(400).json({
                error: "Set an entry price for children of 0 or more, or turn children off for this session.",
            });
            return;
        }
        const partyDiscount = parseDiscount(req.body?.party_discount);
        if (partyDiscount === exports.INVALID) {
            res.status(400).json({ error: "A group discount must be 0 or more, or blank for none." });
            return;
        }
        /* Two, not one: a "group" of one is every booking, which would make the
           discount unconditional and is never what an organiser means. */
        const minParty = parseOptionalCount(req.body?.discount_min_party, 2);
        if (minParty === exports.INVALID) {
            res.status(400).json({
                error: "The group size for the discount must be a whole number of 2 or more, or blank for the club default.",
            });
            return;
        }
        const holdMinutes = parseOptionalCount(req.body?.hold_minutes, 5);
        if (holdMinutes === exports.INVALID) {
            res.status(400).json({
                error: "The payment hold must be at least 5 minutes, or blank for the club default of 24 hours.",
            });
            return;
        }
        const parsedQuestions = (0, questionnaire_1.parseQuestions)(req.body?.questions);
        if (!parsedQuestions.ok) {
            res.status(400).json({ error: parsedQuestions.error });
            return;
        }
        const adminId = req.user.id;
        if (!title || !type || !date_time || !location || price === undefined) {
            res.status(400).json({ error: "Missing required fields for event creation" });
            return;
        }
        const discipline = parseType(type);
        if (discipline === exports.INVALID) {
            res.status(400).json({
                error: `A discipline must be between 2 and ${MAX_TYPE_LENGTH} characters.`,
            });
            return;
        }
        const eventPrice = parseFloat(price);
        if (isNaN(eventPrice) || eventPrice < 0) {
            res.status(400).json({ error: "Invalid price value" });
            return;
        }
        const eventCapacity = parseCapacity(capacity);
        if (eventCapacity === exports.INVALID) {
            res.status(400).json({ error: "Capacity must be a whole number of 1 or more, or blank for unlimited" });
            return;
        }
        const eventStatus = status || "DRAFT";
        if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(eventStatus)) {
            res.status(400).json({ error: "Invalid status value" });
            return;
        }
        const event = await prisma_1.default.event.create({
            data: {
                title,
                // The trimmed value, not the raw one: otherwise the guard
                // above validates a string the row never receives.
                type: discipline,
                date_time: new Date(date_time),
                location,
                price: eventPrice,
                status: eventStatus,
                admin_id: adminId,
                description: description?.trim() || null,
                capacity: eventCapacity,
                // Already a stored URL by this point — the client uploads to
                // /api/content/uploads/image first.
                cover_url: typeof cover_url === "string" ? cover_url.trim() || null : null,
                kids_allowed: kids.kids_allowed,
                kid_price: kids.kid_price,
                party_discount: partyDiscount,
                discount_min_party: minParty ?? null,
                hold_minutes: holdMinutes ?? null,
            },
        });
        const offsets = parseOffsets(req.body.reminder_offsets);
        if (offsets?.length)
            await syncReminders(event.id, offsets);
        if (parsedQuestions.questions?.length) {
            await syncQuestions(event.id, parsedQuestions.questions);
        }
        res.status(211).json({
            message: "Event created successfully",
            event,
            reminder_offsets: offsets ?? [],
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to create event" });
    }
});
// 2. Get Events (Public & Auth role-restricted)
router.get("/", async (req, res) => {
    try {
        const userRole = req.user ? req.user.role : "VISITOR";
        let events;
        if (userRole === "ADMIN") {
            // Admins see all events (DRAFT, PUBLISHED, ARCHIVED)
            events = await prisma_1.default.event.findMany({
                orderBy: { date_time: "asc" },
            });
        }
        else {
            // Members, Volunteers, Visitors see only PUBLISHED (or ARCHIVED past events, but let's filters PUBLISHED for active)
            events = await prisma_1.default.event.findMany({
                where: { status: "PUBLISHED" },
                orderBy: { date_time: "asc" },
            });
        }
        /**
         * Attach capacity to every row so a list can show "3 spots left" or grey
         * out a full event without a request per card. One grouped count covers the
         * whole page rather than N queries.
         */
        const capped = events.filter((e) => e.capacity !== null);
        const counts = new Map();
        if (capped.length > 0) {
            /*
             * Guest rows, tallied here rather than by the database.
             *
             * This was a `groupBy` on registrations, which now undercounts: a
             * party of five is one row. Prisma cannot group by a field on a
             * relation, so the alternative is raw SQL per dialect — the app runs
             * on SQLite locally and Postgres in production, and two hand-written
             * queries that must stay in step is a worse trade than tallying a
             * few hundred rows in memory. Still one query for the whole page,
             * which is what this block exists for.
             */
            const rows = await prisma_1.default.registrationGuest.findMany({
                where: {
                    registration: { event_id: { in: capped.map((e) => e.id) }, ...seatFilter() },
                    OR: [
                        { is_booker: false },
                        { registration: { role_at_event: { not: "VOLUNTEER" } } },
                    ],
                },
                select: { registration: { select: { event_id: true } } },
            });
            for (const row of rows) {
                const id = row.registration.event_id;
                counts.set(id, (counts.get(id) ?? 0) + 1);
            }
        }
        res.json(
        /* The party ceiling rides along on every event rather than living
           in a second constant on the client. The form and the server then
           cannot disagree about it, which is the failure mode a duplicated
           limit eventually always has. */
        events.map((e) => {
            if (e.capacity === null) {
                return {
                    ...e,
                    taken: null,
                    spots_left: null,
                    full: false,
                    max_party_size: party_1.MAX_PARTY_SIZE,
                    discount_min_party_effective: (0, party_1.discountMinParty)(e),
                };
            }
            const taken = counts.get(e.id) ?? 0;
            return {
                ...e,
                taken,
                spots_left: Math.max(0, e.capacity - taken),
                full: taken >= e.capacity,
                max_party_size: party_1.MAX_PARTY_SIZE,
                discount_min_party_effective: (0, party_1.discountMinParty)(e),
            };
        }));
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to fetch events" });
    }
});
// 3. Get the signed-in user's own registrations (with event details).
// Registered before "/:id" for clarity; the ticket and roster routes only ever
// expose a single registration or an admin CSV, so this is the read the member
// UI needs to list its own tickets.
router.get("/me/registrations", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        const userId = req.user.id;
        const registrations = await prisma_1.default.eventRegistration.findMany({
            where: { user_id: userId },
            /* The party travels with the booking, so a ticket can name everyone it
               covers. Without this the QR showed only the member who booked,
               which is the one thing a marshal cannot work from. */
            include: {
                event: true,
                guests: { orderBy: [{ is_booker: "desc" }, { created_at: "asc" }] },
            },
            orderBy: { event: { date_time: "desc" } },
        });
        res.json(registrations);
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to fetch registrations" });
    }
});
/**
 * 3b. Cancel a registration — give up a spot on an event.
 *
 * A member may cancel their own registration while nothing has been captured
 * (PENDING or FREE). A PAID entry needs a refund, so only an admin can remove
 * it; admins may cancel on anyone's behalf. Blocked registrations are the
 * admin's to manage via the block endpoint.
 */
router.delete("/registration/:id", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        const registrationId = req.params.id;
        const isAdmin = req.user.role === "ADMIN";
        const registration = await prisma_1.default.eventRegistration.findUnique({
            where: { id: registrationId },
            include: { event: true },
        });
        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }
        if (registration.user_id !== req.user.id && !isAdmin) {
            res.status(403).json({ error: "You can only cancel your own registration" });
            return;
        }
        // Once the event has started there is nothing left to cancel, and
        // removing the row would rewrite attendance history.
        if (registration.event.date_time.getTime() <= Date.now()) {
            res.status(400).json({
                error: "This event has already started — cancellation is no longer possible",
            });
            return;
        }
        if (registration.blocked_at && !isAdmin) {
            res.status(403).json({
                error: "An organiser has removed you from this event. Contact them for details.",
            });
            return;
        }
        if (registration.status === "PAID" && !isAdmin) {
            res.status(400).json({
                error: "Paid entries need a refund — ask an organiser to cancel this for you.",
            });
            return;
        }
        await prisma_1.default.eventRegistration.delete({ where: { id: registrationId } });
        // An admin cancelling someone else's spot should tell them.
        if (isAdmin && registration.user_id !== req.user.id) {
            await prisma_1.default.notification.create({
                data: {
                    user_id: registration.user_id,
                    message: `An organiser cancelled your registration for "${registration.event.title}".`,
                },
            });
        }
        res.json({
            message: `Registration for "${registration.event.title}" cancelled`,
            event_id: registration.event_id,
            refund_due: registration.status === "PAID",
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to cancel registration" });
    }
});
// 4. Get Single Event
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const userRole = req.user ? req.user.role : "VISITOR";
        const event = (await prisma_1.default.event.findUnique({
            where: { id },
            /* The questionnaire travels with the event, because the booking
               form has to render it and a second round trip to fetch it would
               let the form open before its own questions arrive. */
            include: { questions: { orderBy: { position: "asc" } } },
        }));
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }
        if (event.status !== "PUBLISHED" && userRole !== "ADMIN") {
            res.status(403).json({ error: "Access denied to unpublished event" });
            return;
        }
        res.json({
            ...event,
            questions: (event.questions ?? []).map(questionnaire_1.toPublicQuestion),
            ...(await capacityOf(event)),
            max_party_size: party_1.MAX_PARTY_SIZE,
            discount_min_party_effective: (0, party_1.discountMinParty)(event),
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to fetch event" });
    }
});
// 4. Update Event (Admin only)
router.put("/:id", (0, auth_1.requireRole)(["ADMIN"]), async (req, res) => {
    try {
        const id = req.params.id;
        const { title, type, date_time, location, price, status, description, capacity, cover_url } = req.body;
        const event = await prisma_1.default.event.findUnique({ where: { id } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }
        /* Parsed here, with every other validation, rather than next to the
           write that uses it: a questionnaire rejected after the event row had
           already been updated would answer 400 on a request that had in fact
           changed the event. Undefined means "leave the questionnaire alone". */
        let questionUpdate;
        if (req.body?.questions !== undefined) {
            const parsed = (0, questionnaire_1.parseQuestions)(req.body.questions);
            if (!parsed.ok) {
                res.status(400).json({ error: parsed.error });
                return;
            }
            questionUpdate = parsed.questions;
        }
        const dataToUpdate = {};
        if (title !== undefined)
            dataToUpdate.title = title;
        if (type !== undefined) {
            const discipline = parseType(type);
            if (discipline === exports.INVALID) {
                res.status(400).json({
                    error: `A discipline must be between 2 and ${MAX_TYPE_LENGTH} characters.`,
                });
                return;
            }
            dataToUpdate.type = discipline;
        }
        if (date_time !== undefined)
            dataToUpdate.date_time = new Date(date_time);
        if (location !== undefined)
            dataToUpdate.location = location;
        if (price !== undefined) {
            const p = parseFloat(price);
            if (isNaN(p) || p < 0) {
                res.status(400).json({ error: "Invalid price value" });
                return;
            }
            dataToUpdate.price = p;
        }
        if (status !== undefined) {
            if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
                res.status(400).json({ error: "Invalid status value" });
                return;
            }
            dataToUpdate.status = status;
        }
        if (description !== undefined) {
            dataToUpdate.description = description?.trim() || null;
        }
        // Present-but-empty clears the cover, so this is keyed on `undefined`
        // rather than falsiness. The replaced file is binned after the row is
        // updated, further down.
        //
        // The type check matters: the form sends cover_url: null for an event
        // saved without a picture, and String(null) is the four-character string
        // "null" — truthy, so it survived the `|| null` and got written to the
        // column. Every card then pointed an <img> at /null. Same shape as the
        // create route above, deliberately.
        if (cover_url !== undefined) {
            dataToUpdate.cover_url = typeof cover_url === "string" ? cover_url.trim() || null : null;
        }
        /* Keyed on the toggle rather than either field, because the two move
           together: turning children off has to clear the price, which an
           `undefined` check on kid_price alone would skip. */
        /* Keyed on the field being present rather than truthy: clearing the
           discount sends "" or 0, both of which a truthiness check would skip,
           leaving the old figure in place. */
        if (req.body?.party_discount !== undefined) {
            const discount = parseDiscount(req.body.party_discount);
            if (discount === exports.INVALID) {
                res.status(400).json({ error: "A group discount must be 0 or more, or blank for none." });
                return;
            }
            dataToUpdate.party_discount = discount;
        }
        /* Same present-not-truthy rule: blanking the field means "use the club
           default", which a truthiness check would read as "unchanged". */
        if (req.body?.discount_min_party !== undefined) {
            const minParty = parseOptionalCount(req.body.discount_min_party, 2);
            if (minParty === exports.INVALID) {
                res.status(400).json({
                    error: "The group size for the discount must be a whole number of 2 or more, or blank for the club default.",
                });
                return;
            }
            dataToUpdate.discount_min_party = minParty ?? null;
        }
        if (req.body?.hold_minutes !== undefined) {
            const holdMinutes = parseOptionalCount(req.body.hold_minutes, 5);
            if (holdMinutes === exports.INVALID) {
                res.status(400).json({
                    error: "The payment hold must be at least 5 minutes, or blank for the club default of 24 hours.",
                });
                return;
            }
            dataToUpdate.hold_minutes = holdMinutes ?? null;
        }
        if (req.body?.kids_allowed !== undefined) {
            const kids = parseKids(req.body);
            if (kids === exports.INVALID) {
                res.status(400).json({
                    error: "Set an entry price for children of 0 or more, or turn children off for this session.",
                });
                return;
            }
            dataToUpdate.kids_allowed = kids.kids_allowed;
            dataToUpdate.kid_price = kids.kid_price;
        }
        if (capacity !== undefined) {
            const parsed = parseCapacity(capacity);
            if (parsed === exports.INVALID) {
                res.status(400).json({
                    error: "Capacity must be a whole number of 1 or more, or blank for unlimited",
                });
                return;
            }
            /**
             * Refuse to set a cap below the number of places already given away.
             * Silently accepting it would leave the event over its own limit with
             * no way to reconcile — the organiser has to cancel entries first.
             */
            if (typeof parsed === "number") {
                const taken = await seatsTaken(id);
                if (parsed < taken) {
                    res.status(400).json({
                        error: `${taken} people already hold a place, so the cap can't be set to ${parsed}. Cancel some registrations first.`,
                        taken,
                    });
                    return;
                }
            }
            dataToUpdate.capacity = parsed;
        }
        const previousCover = event.cover_url;
        const updatedEvent = await prisma_1.default.event.update({
            where: { id },
            data: dataToUpdate,
        });
        // Bin the old cover only once the row actually points elsewhere, so a
        // failed update cannot leave the event referencing a deleted file.
        // deleteObject ignores anything this app did not store.
        if (previousCover && updatedEvent.cover_url !== previousCover) {
            void (0, storage_1.deleteObject)(previousCover);
        }
        const offsets = parseOffsets(req.body.reminder_offsets);
        if (offsets !== null)
            await syncReminders(id, offsets);
        // An empty list turns the questionnaire off; undefined never gets here.
        if (questionUpdate !== undefined)
            await syncQuestions(id, questionUpdate);
        const reminders = await prisma_1.default.eventReminder.findMany({
            where: { event_id: id },
            orderBy: { hours_before: "desc" },
        });
        const questions = await prisma_1.default.eventQuestion.findMany({
            where: { event_id: id },
            orderBy: { position: "asc" },
        });
        res.json({
            message: "Event updated successfully",
            event: updatedEvent,
            reminder_offsets: reminders.map((r) => r.hours_before),
            questions: questions.map(questionnaire_1.toPublicQuestion),
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to update event" });
    }
});
// 5. Delete Event (Admin only)
router.delete("/:id", (0, auth_1.requireRole)(["ADMIN"]), async (req, res) => {
    try {
        const id = req.params.id;
        const event = await prisma_1.default.event.findUnique({ where: { id } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }
        // Cascade delete registrations first to maintain relational integrity
        await prisma_1.default.eventRegistration.deleteMany({ where: { event_id: id } });
        await prisma_1.default.event.delete({ where: { id } });
        // After the row is gone, so a failed delete cannot strand the event
        // pointing at a file that no longer exists.
        void (0, storage_1.deleteObject)(event.cover_url);
        res.json({ message: "Event deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Failed to delete event" });
    }
});
// 6. Register / Checkout Flow
router.post("/:id/register", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), verified_1.requireVerified, async (req, res) => {
    try {
        const eventId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role;
        // `req.body` is undefined when a client posts with no JSON body at all;
        // destructuring it directly turned that into a 500 instead of the 400 the
        // waiver check below is meant to give.
        const { waiver_signed, emergency_contact, phone } = req.body ?? {};
        // Check emergency contact is provided (from request or check database)
        const user = await prisma_1.default.user.findUnique({ where: { id: userId } });
        const finalEmergencyContact = emergency_contact || user?.emergency_contact;
        if (!finalEmergencyContact) {
            res.status(400).json({ error: "Emergency contact information is required for registration" });
            return;
        }
        // Validate liability waiver signing
        if (waiver_signed !== true) {
            res.status(400).json({ error: "You must consent and sign the liability waiver to register" });
            return;
        }
        // Check if event exists and is PUBLISHED
        const event = await prisma_1.default.event.findUnique({ where: { id: eventId } });
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }
        if (event.status !== "PUBLISHED") {
            res.status(400).json({ error: "Registration is not open for this event" });
            return;
        }
        /*
         * Already registered?
         *
         * Only a *live* booking blocks a new one. This used to match any row at
         * all, which was right when the only way out of a registration was to
         * delete it — but a booking can now end in EXPIRED, CANCELLED,
         * DEACTIVATED or TEST, and matching those would mean a member whose
         * hold ran out could never rebook. "Spot Expired – Register Again" has
         * to actually permit registering again.
         *
         * Blocked rows are matched deliberately, whatever their status: being
         * barred from an event is not something to be shed by rebooking.
         */
        const existingRegistration = await prisma_1.default.eventRegistration.findFirst({
            where: {
                event_id: eventId,
                user_id: userId,
                OR: [{ status: { in: [...registrationStatus_1.SEAT_HOLDING_STATUSES] } }, { blocked_at: { not: null } }],
            },
        });
        if (existingRegistration) {
            // A blocked row also lands here, which stops a barred member from
            // simply registering again — but it needs its own explanation.
            if (existingRegistration.blocked_at) {
                res.status(403).json({
                    error: "An organiser has removed you from this event. Contact them for details.",
                });
                return;
            }
            res.status(400).json({
                error: "You are already registered for this event",
                registration: existingRegistration,
            });
            return;
        }
        /*
         * The party, validated before anything is charged or written. Names of
         * the extra people only — the member's own row is built from their
         * account below, so nobody can book under a name that is not theirs.
         */
        if (!user) {
            // Authenticated, so this cannot normally happen — but the booker's
            // name is read off this row below, and a `!` there would turn a
            // deleted account into a crash rather than an answer.
            res.status(404).json({ error: "Account not found" });
            return;
        }
        /*
         * The booker's own WhatsApp number — the one the club adds to the
         * event's group — and the number every guest ticking "use my number"
         * inherits.
         *
         * Taken from the request when the form sends one, falling back to the
         * account. The form now asks for it on every booking, prefilled from
         * the account, for two reasons: the member gets to correct a number
         * that has changed at the moment it matters, and an account predating
         * the signup requirement can be completed here instead of dead-ending
         * on "go to your profile first" halfway through a booking.
         *
         * Normalised through the same function as the account's own number, so
         * the roster stays one consistent column of E.164 rather than a mix of
         * whatever each member happened to type.
         */
        const suppliedPhone = typeof phone === "string" ? phone.trim() : "";
        let bookerPhone;
        if (suppliedPhone) {
            const normalised = (0, phone_1.normalisePhone)(suppliedPhone);
            if (!normalised.ok) {
                res.status(400).json({ error: `Your WhatsApp number: ${normalised.error}` });
                return;
            }
            bookerPhone = normalised.e164;
        }
        else if (user.phone) {
            bookerPhone = user.phone;
        }
        else {
            res.status(400).json({
                error: "A WhatsApp number is required — the club uses it for the event group and to reach you on the day.",
                needs_phone: true,
            });
            return;
        }
        const parsed = (0, party_1.parseGuests)(req.body?.guests, event, bookerPhone);
        if (!parsed.ok) {
            res.status(400).json({ error: parsed.error });
            return;
        }
        const extraGuests = parsed.guests;
        /* The event's own questions, and this member's answers to them.
           Validated before anything is charged — a booking that cannot be
           answered correctly should not reach a payment sheet. */
        const eventQuestions = (await prisma_1.default.eventQuestion.findMany({
            where: { event_id: eventId },
            orderBy: { position: "asc" },
        })).map(questionnaire_1.toPublicQuestion);
        const parsedAnswers = (0, questionnaire_1.parseAnswers)(req.body?.answers, eventQuestions);
        if (!parsedAnswers.ok) {
            res.status(400).json({ error: parsedAnswers.error });
            return;
        }
        const isVolunteer = userRole === "VOLUNTEER";
        const party = (0, party_1.priceParty)({ event, guests: extraGuests, isVolunteer });
        /**
         * Capacity check, after the already-registered check so somebody who is
         * already on the list is never told the event is full.
         *
         * Compares against the *whole party*, not one place. `taken >= capacity`
         * would let a family of five into a session with one place left, which
         * is the bug that arrives with party bookings and does not announce
         * itself until the start line.
         *
         * A volunteer's own place is still exempt — crew are not participants,
         * and a full event still needs marshals — but the people they bring
         * are, so seatCost drops one place for them and counts the rest.
         */
        const cost = (0, party_1.seatCost)(party.partySize, isVolunteer);
        if (event.capacity !== null && cost > 0) {
            const taken = await seatsTaken(eventId);
            if (taken + cost > event.capacity) {
                const left = Math.max(0, event.capacity - taken);
                res.status(409).json({
                    error: left === 0
                        ? "This event is full."
                        : `Only ${left} place${left === 1 ? "" : "s"} left, and you asked for ${cost}.`,
                    full: left === 0,
                    capacity: event.capacity,
                    taken,
                    spots_left: left,
                    requested: cost,
                });
                return;
            }
        }
        /*
         * Carry both numbers back to the account, so the next booking is
         * prefilled with what the member last confirmed rather than with
         * whatever they first typed months ago.
         *
         * One update for the pair. They are compared before writing because
         * this runs on every booking and most bookings change neither.
         */
        const contactChanged = Boolean(emergency_contact && emergency_contact !== user?.emergency_contact);
        const phoneChanged = bookerPhone !== user.phone;
        if (contactChanged || phoneChanged) {
            await prisma_1.default.user.update({
                where: { id: userId },
                data: {
                    ...(contactChanged ? { emergency_contact } : {}),
                    ...(phoneChanged ? { phone: bookerPhone } : {}),
                },
            });
        }
        /*
         * Status follows the party total rather than the role.
         *
         * A volunteer used to be FREE unconditionally. Their own place still is,
         * but the club's rule is that only the volunteer is comped — so a
         * marshal bringing two children owes for two children, and marking that
         * booking FREE would have handed the entry away.
         */
        const roleAtEvent = isVolunteer ? "VOLUNTEER" : "MEMBER";
        let paymentStatus = party.amountPaise === 0 ? "FREE" : "PENDING";
        let razorpayOrderId = null;
        /* The whole party's total, rounded to paise per unit price before being
           multiplied — see priceParty. One number used for the order, the stored
           snapshot and the response, so the three cannot disagree. */
        const amountPaise = party.amountPaise;
        if (paymentStatus === "PENDING") {
            /**
             * Razorpay rejects orders under 100 paise (₹1). Caught here so the
             * member sees why rather than an opaque gateway error, and so no
             * registration row is created for an order that cannot exist.
             *
             * Reachable: an organiser can set any price above zero, and
             * anything from 0.01 to 0.99 lands in this gap.
             */
            if (amountPaise < 100) {
                res.status(400).json({
                    error: `This booking comes to ₹${(amountPaise / 100).toFixed(2)}, which is below the ₹1 minimum a card payment can take. Ask an organiser to make the entry free or at least ₹1.`,
                });
                return;
            }
            // Create Razorpay Order
            if (isRazorpayMock) {
                razorpayOrderId = `order_mock_${Math.random().toString(36).substring(2, 11)}`;
            }
            else {
                const orderOptions = {
                    amount: amountPaise, // In Indian Paisa
                    currency: "INR",
                    receipt: `event_registration_${Date.now()}`,
                    payment_capture: 1, // Automatically capture payments immediately
                    notes: {
                        eventId,
                        userId,
                    },
                };
                try {
                    const order = await razorpay.orders.create(orderOptions);
                    razorpayOrderId = order.id;
                }
                catch (err) {
                    /**
                     * Separated from the handler's catch-all so a rejected key or
                     * a gateway outage does not read as "Registration failed".
                     * Razorpay puts the useful text in error.description.
                     */
                    const detail = err?.error?.description || err?.message || "unknown error";
                    const status = err?.statusCode === 401 ? 401 : 502;
                    res.status(status).json({
                        error: status === 401
                            ? "The club's payment credentials were rejected. An organiser needs to check them."
                            : `Could not reach the payment gateway: ${detail}`,
                    });
                    return;
                }
            }
        }
        /*
         * The booking and its people in one nested create, so a party can never
         * exist without its guest rows. That matters beyond tidiness: capacity
         * counts guest rows, so a registration written without them would hold
         * zero places and quietly oversell the session.
         *
         * The booker's row is built from their account name, never from the
         * request.
         */
        /* Only an unpaid booking is on the clock. A free or comped entry owes
           nothing, so there is no deadline to hold it to. */
        const holdExpiresAt = paymentStatus === "PENDING" ? (0, time_1.holdDeadline)(event.hold_minutes) : null;
        const registration = await prisma_1.default.eventRegistration.create({
            data: {
                event_id: eventId,
                user_id: userId,
                status: paymentStatus,
                role_at_event: roleAtEvent,
                waiver_signed: true,
                razorpay_order_id: razorpayOrderId,
                amount_due_paise: amountPaise,
                adult_price_at_booking: party.adultPrice,
                kid_price_at_booking: party.kidPrice,
                discount_paise_at_booking: party.discountPaise,
                hold_expires_at: holdExpiresAt,
                guests: {
                    create: [
                        {
                            name: user.name,
                            kind: "ADULT",
                            is_booker: true,
                            phone: bookerPhone,
                        },
                        ...extraGuests.map((g) => ({
                            name: g.name,
                            kind: g.kind,
                            phone: g.phone,
                        })),
                    ],
                },
                ...(parsedAnswers.answers?.length
                    ? { answers: { create: parsedAnswers.answers } }
                    : {}),
            },
            include: {
                guests: { orderBy: [{ is_booker: "desc" }, { created_at: "asc" }] },
                answers: true,
            },
        });
        res.status(211).json({
            message: paymentStatus === "FREE" ? "Registration completed successfully (Free)" : "Registration initiated",
            registration,
            razorpay_key_id: isRazorpayMock ? "mock_key_id" : razorpayKeyId,
            amount: amountPaise,
            hold_expires_at: holdExpiresAt,
            party: {
                size: party.partySize,
                adults: party.adults,
                kids: party.kids,
                paying_adults: party.payingAdults,
                seats_used: cost,
            },
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Registration failed" });
    }
});
exports.default = router;
