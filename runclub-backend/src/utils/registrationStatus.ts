/**
 * What a registration's status means, in one place.
 *
 * Eight states now answer four different questions — does this booking hold a
 * place, may it be paid, can it print a ticket, should it be nudged — and those
 * answers were previously written as inline string comparisons scattered across
 * the routers. That is how a booking ends up counted as taking a place by one
 * query and not by another, which on a capped session shows up as an oversold
 * start line.
 *
 * So the predicates live here and everything asks them. Adding a ninth status
 * means editing this file and finding every consequence in it.
 */

export const REGISTRATION_STATUSES = [
    "PENDING",
    "PAID",
    "FREE",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
    "DEACTIVATED",
    "TEST",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * The statuses an organiser may set by hand.
 *
 * Payment states are deliberately not in here: PAID, FREE, PENDING and FAILED
 * are facts about money that Razorpay and the booking flow own, and letting an
 * admin type "PAID" over an unpaid booking would put the roster and the
 * gateway permanently out of step.
 */
export const ADMIN_SETTABLE_STATUSES = ["CANCELLED", "DEACTIVATED", "TEST"] as const;

export type AdminSettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];

/** What organisers and members are shown. The stored value is never displayed. */
export const STATUS_LABELS: Record<string, string> = {
    PENDING: "Awaiting Payment",
    PAID: "Paid",
    FREE: "Free",
    FAILED: "Payment Failed",
    EXPIRED: "Spot Expired – Register Again",
    CANCELLED: "Cancelled",
    DEACTIVATED: "Deactivated",
    TEST: "Test Registration",
};

export function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

/**
 * Statuses whose bookings occupy places.
 *
 * PENDING is in here on purpose — an unpaid booking holds its places, or a rush
 * of half-finished checkouts would oversell the session. What stops that
 * holding for ever is the expiry sweep, not this list.
 */
export const SEAT_HOLDING_STATUSES = ["PAID", "FREE", "PENDING"] as const;

/** A booking that can still be settled through Checkout. */
export function isPayable(status: string): boolean {
    return status === "PENDING";
}

/** A booking entitled to a QR ticket. */
export function isTicketed(status: string): boolean {
    return status === "PAID" || status === "FREE";
}

/**
 * A booking that is over, whatever the reason.
 *
 * The single check that reminders, exports and counts use to mean "do not treat
 * this as a live entry".
 */
export function isClosed(status: string): boolean {
    return (
        status === "EXPIRED" ||
        status === "CANCELLED" ||
        status === "DEACTIVATED" ||
        status === "TEST" ||
        status === "FAILED"
    );
}

/**
 * Whether any automated email should go to this booking.
 *
 * One predicate for every scheduled message, because the failure it prevents is
 * specific and embarrassing: telling somebody their spot is waiting for payment
 * after they have paid, or after an organiser has cancelled them. A blocked
 * member is excluded too — they are not attending, whatever the payment says.
 */
export function shouldReceiveMail(registration: {
    status: string;
    blocked_at?: Date | null;
}): boolean {
    if (registration.blocked_at) return false;
    return !isClosed(registration.status);
}
