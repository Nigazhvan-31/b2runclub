"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const razorpay_1 = __importDefault(require("razorpay"));
const secrets_1 = require("../utils/secrets");
const time_1 = require("../utils/time");
const registrationStatus_1 = require("../utils/registrationStatus");
const razorpay = new razorpay_1.default({
    // Placeholder strings only; every call is gated behind RAZORPAY_MOCK_MODE.
    key_id: secrets_1.RAZORPAY_KEY_ID ?? "unconfigured",
    key_secret: secrets_1.RAZORPAY_KEY_SECRET ?? "unconfigured",
});
const router = (0, express_1.Router)();
/**
 * The fields that stop applying the moment a booking is paid.
 *
 * Written alongside every transition to PAID. The hold is over, so its deadline
 * and its expiry stamp are meaningless — and leaving `expired_at` set on a paid
 * booking would have the roster show a settled member as having lost their
 * place.
 *
 * `payment_reminder_sent_at` is cleared rather than left, so that if an
 * organiser ever reinstates the booking to PENDING the nudge can be sent
 * again. A stale stamp would silently suppress it.
 */
const SETTLED_FIELDS = {
    hold_expires_at: null,
    expired_at: null,
    payment_reminder_sent_at: null,
};
/**
 * Whether a payment may still be applied to this booking.
 *
 * EXPIRED is accepted deliberately. The hold running out releases the *place*,
 * but it does not cancel the Razorpay order, so a member who comes back later
 * can still pay it — and once their money has been taken, refusing to issue a
 * ticket is the one outcome that cannot be defended. The place is honoured and
 * the event may go one over; an organiser can see that on the roster and deal
 * with it, which is a better problem than a charged member with nothing.
 *
 * CANCELLED, DEACTIVATED and TEST are not accepted: those are decisions
 * somebody made on purpose, and a late payment should not quietly undo them.
 */
function acceptsPayment(status) {
    return status === "PENDING" || status === "EXPIRED";
}
// Razorpay Webhook Endpoint
router.post("/webhook", async (req, res) => {
    try {
        /**
         * With no webhook secret configured there is nothing to verify against, so
         * every request is refused. Previously this fell back to a default string
         * published in the source, which meant an unconfigured deployment happily
         * accepted forged "payment.captured" events and marked entries paid.
         */
        if (!secrets_1.WEBHOOKS_VERIFIABLE) {
            console.error("[webhook] rejected: RAZORPAY_WEBHOOK_SECRET is not set, so signatures cannot be verified");
            res.status(503).json({
                error: "Webhooks are not configured on this server",
            });
            return;
        }
        const signature = req.headers["x-razorpay-signature"];
        if (!signature) {
            res.status(400).json({ error: "Missing x-razorpay-signature header" });
            return;
        }
        const rawBody = req.rawBody;
        if (!rawBody) {
            res.status(400).json({ error: "Missing raw body for verification" });
            return;
        }
        // Verify signature using HMAC SHA256
        const expectedSignature = crypto_1.default
            .createHmac("sha256", secrets_1.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest("hex");
        if (expectedSignature !== signature) {
            res.status(400).json({ error: "Invalid webhook signature" });
            return;
        }
        // Parse verified payload body
        const payload = JSON.parse(rawBody);
        const eventType = payload.event;
        // We process "order.paid" or general "payment.captured"
        if (eventType === "order.paid" || eventType === "payment.captured") {
            const paymentEntity = payload.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const razorpayPaymentId = paymentEntity.id;
            if (!razorpayOrderId) {
                res.status(400).json({ error: "Missing order_id in payment payload" });
                return;
            }
            // Find registration by Razorpay order ID
            const registration = await prisma_1.default.eventRegistration.findUnique({
                where: { razorpay_order_id: razorpayOrderId },
                include: { event: true, user: true },
            });
            if (!registration) {
                // Log of unrecognized order ID is fine; Razorpay might occasionally resend
                res.status(404).json({ error: `Registration not found for order ${razorpayOrderId}` });
                return;
            }
            // Only update if not already processed, and only onto a booking
            // that is still open to payment — a cancelled one is not.
            if (acceptsPayment(registration.status)) {
                await prisma_1.default.eventRegistration.update({
                    where: { id: registration.id },
                    data: {
                        status: "PAID",
                        razorpay_payment_id: razorpayPaymentId,
                        ...SETTLED_FIELDS,
                    },
                });
                // Trigger Notification to member for successful signup
                await prisma_1.default.notification.create({
                    data: {
                        user_id: registration.user_id,
                        message: `Payment successful! You are registered for the event "${registration.event.title}". scan your QR code ticket at the entrance.`,
                        link: `/api/events/registration/${registration.id}/ticket`,
                    },
                });
            }
        }
        res.status(200).json({ status: "ok" });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Webhook processing failed" });
    }
});
/**
 * Verify a Razorpay Checkout callback and mark the registration paid.
 *
 * The webhook above is the authoritative path in production, but it requires a
 * publicly reachable URL, so it never fires in local development. Razorpay's
 * documented client flow returns { order_id, payment_id, signature } to the
 * browser after a successful payment; this endpoint verifies that signature
 * server-side (HMAC-SHA256 of "order_id|payment_id" keyed with the API secret)
 * and completes the registration. It is idempotent and safe to call twice.
 */
router.post("/verify", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            res.status(400).json({
                error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are all required",
            });
            return;
        }
        // Signature is over "<order_id>|<payment_id>" keyed with the API secret.
        const expectedSignature = crypto_1.default
            .createHmac("sha256", secrets_1.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");
        const provided = Buffer.from(String(razorpay_signature));
        const expected = Buffer.from(expectedSignature);
        if (provided.length !== expected.length ||
            !crypto_1.default.timingSafeEqual(provided, expected)) {
            res.status(400).json({ error: "Payment signature verification failed" });
            return;
        }
        const registration = await prisma_1.default.eventRegistration.findUnique({
            where: { razorpay_order_id },
            include: { event: true },
        });
        if (!registration) {
            res.status(404).json({ error: "No registration found for that order" });
            return;
        }
        // A member may only settle their own registration.
        if (registration.user_id !== req.user.id && req.user.role !== "ADMIN") {
            res.status(403).json({ error: "Access denied to this registration" });
            return;
        }
        // Idempotent: a webhook may already have processed this order.
        if (registration.status === "PAID") {
            res.json({ message: "Payment already recorded", registration });
            return;
        }
        const updated = await prisma_1.default.eventRegistration.update({
            where: { id: registration.id },
            data: { status: "PAID", razorpay_payment_id, ...SETTLED_FIELDS },
        });
        await prisma_1.default.notification.create({
            data: {
                user_id: registration.user_id,
                message: `Payment successful! You are registered for the event "${registration.event.title}". Scan your QR code ticket at the entrance.`,
                link: `/api/events/registration/${registration.id}/ticket`,
            },
        });
        res.json({ message: "Payment verified", registration: updated });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Payment verification failed" });
    }
});
/**
 * Ask Razorpay whether a PENDING booking has in fact been paid, and settle it.
 *
 * Both existing routes to PAID need something to come to us: the webhook needs
 * Razorpay to call in, and `/verify` needs the member's browser to survive
 * Checkout and post the callback. When neither happens the money is captured at
 * Razorpay and the registration sits at PENDING for ever — the ticket route
 * refuses anything that is not PAID or FREE, so the member is charged and gets
 * no QR code. Worse, Checkout will not let them retry: Razorpay rejects a
 * second payment against an order it has already been paid for, so there is no
 * way out from the member's side at all.
 *
 * Losing that callback is ordinary, not exotic. A UPI payment on a phone hands
 * off to GPay or PhonePe, and the browser tab that has to run the callback is
 * frequently evicted while the member is in the other app. Bigger totals — a
 * party booking — are likelier to be paid that way than by a saved card, which
 * is why group bookings were the ones noticed as stuck.
 *
 * So this asks the gateway directly, which is the only authoritative answer, and
 * needs no signature because nothing in the request is trusted: the order id
 * comes from our own row and the payment state comes from Razorpay over an
 * authenticated call. Safe to run repeatedly, and safe to run on a booking that
 * was never paid — it simply reports that nothing was found.
 */
async function settleFromGateway(registration) {
    const list = (await razorpay.orders.fetchPayments(registration.razorpay_order_id));
    const payments = list?.items ?? [];
    // "captured" is money actually taken. "authorized" is money held but not
    // collected, which happens when auto-capture is off — reported separately
    // rather than treated as paid, because releasing a ticket for funds that
    // were never captured hands away an entry.
    const captured = payments.find((p) => p.status === "captured");
    if (captured) {
        return { outcome: "paid", paymentId: captured.id, amountPaise: captured.amount };
    }
    const authorized = payments.find((p) => p.status === "authorized");
    if (authorized) {
        return {
            outcome: "authorized",
            paymentId: authorized.id,
            amountPaise: authorized.amount,
        };
    }
    return { outcome: "nothing", attempts: payments.length };
}
/** Flips the row and tells the member, in the one place both callers need it. */
async function markPaidFromGateway(registration, paymentId) {
    const updated = await prisma_1.default.eventRegistration.update({
        where: { id: registration.id },
        data: { status: "PAID", razorpay_payment_id: paymentId, ...SETTLED_FIELDS },
    });
    await prisma_1.default.notification.create({
        data: {
            user_id: registration.user_id,
            message: `Your payment for "${registration.event.title}" is confirmed — the QR ticket is ready. Scan it at the entrance.`,
            link: `/api/events/registration/${registration.id}/ticket`,
        },
    });
    return updated;
}
/**
 * Settle one booking against the gateway.
 *
 * Open to the member who owns it as well as to admins: it cannot take a payment
 * or invent one, it can only notice a payment that Razorpay already holds, and
 * the member is the one who knows they paid.
 */
router.post("/reconcile/:registrationId", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        if (secrets_1.RAZORPAY_MOCK_MODE) {
            res.status(400).json({
                error: "Razorpay isn't configured on this server, so there is nothing to check against.",
            });
            return;
        }
        const registration = (await prisma_1.default.eventRegistration.findUnique({
            where: { id: req.params.registrationId },
            include: { event: true },
        }));
        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }
        if (registration.user_id !== req.user.id && req.user.role !== "ADMIN") {
            res.status(403).json({ error: "You can only check your own booking" });
            return;
        }
        if (registration.status === "PAID" || registration.status === "FREE") {
            res.json({
                message: "This booking is already settled — your ticket is live.",
                registration,
                changed: false,
            });
            return;
        }
        /* An expired booking is still worth checking — that is the whole
           point of this route for somebody who paid and never got a
           ticket. Cancelled and deactivated ones are not, and saying so is
           better than reporting "no payment found" for a booking that was
           deliberately retired. */
        if (!acceptsPayment(registration.status)) {
            res.status(400).json({
                error: `This booking is ${(0, registrationStatus_1.statusLabel)(registration.status)}, so no payment can be applied to it. Contact an organiser.`,
                changed: false,
            });
            return;
        }
        if (!registration.razorpay_order_id) {
            res.status(400).json({ error: "This booking has no payment order to check." });
            return;
        }
        if (registration.razorpay_order_id.startsWith("order_mock_")) {
            res.status(400).json({
                error: "This booking carries a placeholder order that Razorpay never saw.",
            });
            return;
        }
        let result;
        try {
            result = await settleFromGateway(registration);
        }
        catch (err) {
            const detail = err?.error?.description || err?.message || "unknown error";
            console.error(`[reconcile] registration ${registration.id}: ${detail}`);
            res.status(502).json({ error: `Could not reach Razorpay: ${detail}` });
            return;
        }
        if (result.outcome === "paid") {
            const updated = await markPaidFromGateway(registration, result.paymentId);
            console.log(`[reconcile] registration ${registration.id} settled from gateway: ${result.paymentId}`);
            res.json({
                message: "Your payment was already with Razorpay — your ticket is live now.",
                registration: updated,
                changed: true,
            });
            return;
        }
        if (result.outcome === "authorized") {
            res.status(409).json({
                error: `Razorpay is holding ₹${(result.amountPaise / 100).toFixed(2)} on this booking but has not captured it (${result.paymentId}). An organiser needs to capture it in the Razorpay dashboard.`,
                changed: false,
            });
            return;
        }
        res.status(404).json({
            error: result.attempts === 0
                ? "Razorpay has no payment against this booking, so nothing has been charged."
                : "Razorpay has attempts against this booking but none of them completed, so nothing has been charged.",
            changed: false,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Could not check the payment" });
    }
});
/**
 * The same check across every stuck booking, for an organiser.
 *
 * Optional `event_id` narrows it to one session. Each booking is handled on its
 * own so one gateway error does not abandon the rest of the sweep.
 */
router.post("/reconcile", (0, auth_1.requireRole)(["ADMIN"]), async (req, res) => {
    try {
        if (secrets_1.RAZORPAY_MOCK_MODE) {
            res.status(400).json({
                error: "Razorpay isn't configured on this server, so there is nothing to check against.",
            });
            return;
        }
        const eventId = typeof req.body?.event_id === "string" ? req.body.event_id : undefined;
        /* Expired bookings are swept as well as pending ones. A member who
           paid and never got the callback is exactly the person whose hold
           then ran out, so restricting this to PENDING would miss the
           cases it exists to find. */
        const pending = (await prisma_1.default.eventRegistration.findMany({
            where: {
                status: { in: ["PENDING", "EXPIRED"] },
                ...(eventId ? { event_id: eventId } : {}),
            },
            include: { event: true, user: { select: { name: true, email: true } } },
        }));
        const settled = [];
        const held = [];
        const failed = [];
        let unpaid = 0;
        let skipped = 0;
        for (const registration of pending) {
            if (!registration.razorpay_order_id ||
                registration.razorpay_order_id.startsWith("order_mock_")) {
                skipped++;
                continue;
            }
            try {
                const result = await settleFromGateway(registration);
                if (result.outcome === "paid") {
                    await markPaidFromGateway(registration, result.paymentId);
                    settled.push({
                        registration_id: registration.id,
                        member: registration.user.name,
                        event: registration.event.title,
                        payment_id: result.paymentId,
                        amount: result.amountPaise / 100,
                    });
                }
                else if (result.outcome === "authorized") {
                    held.push({
                        registration_id: registration.id,
                        member: registration.user.name,
                        payment_id: result.paymentId,
                        amount: result.amountPaise / 100,
                    });
                }
                else {
                    unpaid++;
                }
            }
            catch (err) {
                failed.push({
                    registration_id: registration.id,
                    error: err?.error?.description || err?.message || "unknown error",
                });
            }
        }
        console.log(`[reconcile] sweep: checked=${pending.length} settled=${settled.length} held=${held.length} unpaid=${unpaid} failed=${failed.length}`);
        res.json({
            checked: pending.length,
            settled,
            awaiting_capture: held,
            unpaid,
            skipped,
            failed,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Reconciliation failed" });
    }
});
/**
 * Development-only: settle a mock order without Razorpay.
 *
 * With placeholder credentials the backend mints `order_mock_*` ids that real
 * Checkout would reject, so a paid registration could never leave PENDING and
 * the flow was impossible to demonstrate. This completes it locally.
 *
 * Three hard guards, all of which must hold:
 *  - NODE_ENV must not be "production",
 *  - the backend must actually be in mock mode (placeholder key id),
 *  - the order id must carry the `order_mock_` prefix.
 *
 * With real keys configured, this route refuses every request and the genuine
 * Checkout → /verify path is the only way to pay.
 */
const isMockMode = secrets_1.RAZORPAY_MOCK_MODE;
router.post("/simulate", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        if (process.env.NODE_ENV === "production") {
            res.status(404).json({ error: "Not found" });
            return;
        }
        if (!isMockMode) {
            res.status(400).json({
                error: "Razorpay keys are configured — use the real Checkout flow.",
            });
            return;
        }
        const { registration_id } = req.body;
        if (!registration_id) {
            res.status(400).json({ error: "registration_id is required" });
            return;
        }
        const registration = await prisma_1.default.eventRegistration.findUnique({
            where: { id: registration_id },
            include: { event: true },
        });
        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }
        if (registration.user_id !== req.user.id && req.user.role !== "ADMIN") {
            res.status(403).json({ error: "You can only settle your own registration" });
            return;
        }
        if (!registration.razorpay_order_id?.startsWith("order_mock_")) {
            res.status(400).json({
                error: "This registration has a real Razorpay order — pay through Checkout.",
            });
            return;
        }
        if (registration.status === "PAID") {
            res.json({ message: "Already paid", registration, changed: false });
            return;
        }
        const updated = await prisma_1.default.eventRegistration.update({
            where: { id: registration.id },
            data: {
                status: "PAID",
                razorpay_payment_id: `pay_simulated_${Date.now()}`,
                ...SETTLED_FIELDS,
            },
        });
        await prisma_1.default.notification.create({
            data: {
                user_id: registration.user_id,
                message: `Payment simulated for "${registration.event.title}" (development mode). Your ticket is live.`,
                link: `/api/events/registration/${registration.id}/ticket`,
            },
        });
        res.json({
            message: "Payment simulated — your ticket is live",
            registration: updated,
            changed: true,
            simulated: true,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Simulation failed" });
    }
});
/**
 * Mint a fresh Razorpay order for a registration that cannot be paid.
 *
 * A registration created while Razorpay was unconfigured carries an
 * `order_mock_…` id. Once real keys are added, that registration is stranded:
 * Checkout rejects the order because it does not exist at Razorpay, and
 * `/simulate` refuses because keys are now present. The member is left with a
 * PENDING entry and no way to settle it.
 *
 * This re-mints a genuine order against the same registration, so the spot and
 * the signup date are preserved rather than being cancelled and redone.
 */
router.post("/order/:registrationId/refresh", (0, auth_1.requireRole)(["MEMBER", "VOLUNTEER", "ADMIN"]), async (req, res) => {
    try {
        if (isMockMode) {
            res.status(400).json({
                error: "Razorpay isn't configured on this server, so a real order can't be created.",
            });
            return;
        }
        const registration = (await prisma_1.default.eventRegistration.findUnique({
            where: { id: req.params.registrationId },
            include: { event: true },
        }));
        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }
        if (registration.user_id !== req.user.id && req.user.role !== "ADMIN") {
            res.status(403).json({ error: "You can only refresh your own registration" });
            return;
        }
        if (registration.status !== "PENDING") {
            res.status(400).json({
                error: `Only a PENDING registration needs a new order — this one is ${registration.status}.`,
            });
            return;
        }
        if (registration.blocked_at) {
            res.status(403).json({
                error: "An organiser has removed you from this event.",
            });
            return;
        }
        /* The booking's own total, not the event price. A party on a
           session that is free for adults can still owe for a child, and a
           party of three on a paid session owes three times the entry — so
           reading the event here would have let somebody re-pay a fraction
           of what they booked. */
        if (registration.amount_due_paise <= 0) {
            res.status(400).json({ error: "Nothing is owed on this booking." });
            return;
        }
        let order;
        try {
            order = (await razorpay.orders.create({
                amount: registration.amount_due_paise, // paise, as booked
                currency: "INR",
                receipt: `reg_${registration.id.slice(0, 30)}`,
                notes: {
                    registration_id: registration.id,
                    event: registration.event.title,
                    reason: "re-issued for an unusable order id",
                },
            }));
        }
        catch (err) {
            const detail = err?.error?.description ||
                err?.message ||
                (err?.statusCode === 401
                    ? "Razorpay rejected the API credentials."
                    : `Razorpay refused to create the order${err?.statusCode ? ` (HTTP ${err.statusCode})` : ""}.`);
            console.error(`[order-refresh] registration ${registration.id}:`, JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
            res.status(400).json({ error: detail });
            return;
        }
        const previous = registration.razorpay_order_id;
        const updated = await prisma_1.default.eventRegistration.update({
            where: { id: registration.id },
            data: { razorpay_order_id: order.id },
        });
        console.log(`[order-refresh] registration ${registration.id}: ${previous} -> ${order.id}`);
        res.json({
            message: "A new payment order is ready",
            registration: updated,
            razorpay_order_id: order.id,
            previous_order_id: previous,
            razorpay_key_id: secrets_1.RAZORPAY_KEY_ID,
            amount: registration.amount_due_paise,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Could not create a new order" });
    }
});
/** Lets the client know whether real Checkout is available. */
router.get("/config", async (_req, res) => {
    res.json({
        mock_mode: isMockMode,
        // Publishable key only — never the secret.
        key_id: isMockMode ? null : secrets_1.RAZORPAY_KEY_ID,
        simulation_available: isMockMode && process.env.NODE_ENV !== "production",
    });
});
/**
 * Refund a paid registration (Admin only).
 *
 * Calls Razorpay's refund API for the captured payment, then records the refund
 * on the registration so it is auditable. The registration is left in place with
 * `refunded_at` set rather than deleted — a deleted row loses the fact that money
 * moved, which is exactly what accounting needs to see.
 */
router.post("/refund/:registrationId", (0, auth_1.requireRole)(["ADMIN"]), async (req, res) => {
    try {
        const registration = await prisma_1.default.eventRegistration.findUnique({
            where: { id: req.params.registrationId },
            include: { event: true, user: { select: { id: true, name: true } } },
        });
        if (!registration) {
            res.status(404).json({ error: "Registration not found" });
            return;
        }
        // Checked before the status guard: a refund flips status to FAILED, so
        // asking about status first would report "this one is FAILED" for an
        // already-refunded row instead of saying it was refunded.
        if (registration.refunded_at) {
            res.status(400).json({
                error: `Already refunded — ₹${registration.refund_amount} on ${(0, time_1.formatEventDate)(new Date(registration.refunded_at))}.`,
            });
            return;
        }
        if (registration.status !== "PAID") {
            res.status(400).json({
                error: `Only a PAID registration can be refunded — this one is ${registration.status}.`,
            });
            return;
        }
        if (!registration.razorpay_payment_id) {
            res.status(400).json({ error: "No captured payment id to refund against" });
            return;
        }
        /*
         * Bounded by what this booking actually paid, not by the event's
         * current entry fee. Two reasons, and both bite:
         *
         *  - A party paid a multiple of the entry. Capping at the entry
         *    would have refunded a family of three one third of their money
         *    and called it complete.
         *  - An organiser can edit the price after people book, so the
         *    event is not a record of what was taken. amount_due_paise is.
         *
         * The club chose all-or-nothing for party refunds — you cannot
         * refund one guest out of three — which is what defaulting to the
         * full booked total gives. An explicit smaller figure is still
         * accepted, as it was before, for a goodwill adjustment.
         */
        const bookedRupees = registration.amount_due_paise / 100;
        const requested = req.body?.amount;
        const amount = requested === undefined ? bookedRupees : Number.parseFloat(requested);
        if (!Number.isFinite(amount) || amount <= 0 || amount > bookedRupees) {
            res.status(400).json({
                error: `Refund must be between 0 and what this booking paid (₹${bookedRupees.toFixed(2)}).`,
            });
            return;
        }
        let refundId;
        if (isMockMode || registration.razorpay_payment_id.startsWith("pay_simulated")) {
            // A simulated payment has no counterpart at Razorpay, so calling
            // their API would 400. Record it locally instead.
            refundId = `rfnd_local_${Date.now()}`;
        }
        else {
            try {
                const refund = await razorpay.payments.refund(registration.razorpay_payment_id, {
                    amount: Math.round(amount * 100), // paise
                    speed: "normal",
                    notes: { registration_id: registration.id, event: registration.event.title },
                });
                refundId = refund.id;
            }
            catch (err) {
                // Razorpay's SDK is inconsistent here: sometimes it gives a full
                // { error: { description } }, but for a 404 it throws bare
                // { statusCode: 404 } with no message at all. Falling straight
                // through to a generic string left the admin with nothing to act
                // on, so map the status codes we can actually explain.
                const byStatus = {
                    400: "Razorpay rejected the refund — the payment may already be fully refunded.",
                    401: "Razorpay credentials were rejected. Check RAZORPAY_KEY_ID / KEY_SECRET.",
                    404: "Razorpay has no record of this payment. It was likely captured under different API keys.",
                };
                const detail = err?.error?.description ||
                    err?.message ||
                    byStatus[err?.statusCode] ||
                    `Refund was rejected${err?.statusCode ? ` (HTTP ${err.statusCode})` : ""}.`;
                console.error(`[refund] registration ${registration.id} failed:`, JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
                res.status(400).json({ error: detail });
                return;
            }
        }
        const updated = await prisma_1.default.eventRegistration.update({
            where: { id: registration.id },
            data: {
                refund_id: refundId,
                refunded_at: new Date(),
                refund_amount: amount,
                // FAILED reads correctly downstream: it drops out of revenue
                // and out of the ticket-ready count.
                status: "FAILED",
            },
        });
        await prisma_1.default.notification.create({
            data: {
                user_id: registration.user_id,
                message: `₹${amount} has been refunded for "${registration.event.title}". It should reach your account in 5–7 days.`,
            },
        });
        res.json({
            message: `₹${amount} refunded to ${registration.user.name}`,
            refund_id: refundId,
            amount,
            simulated: refundId.startsWith("rfnd_local_"),
            registration: updated,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Refund failed" });
    }
});
exports.default = router;
