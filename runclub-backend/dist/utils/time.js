"use strict";
/**
 * The club's timezone, in one place.
 *
 * Every event happens in Madurai, and every member reads about it from there.
 * The browser gets this right for free — it formats a UTC instant in whatever
 * zone the reader is sitting in, which is IST. The server does not: Vercel runs
 * functions with TZ=UTC, so a bare `Intl.DateTimeFormat("en-IN", …)` or
 * `toLocaleDateString()` silently renders five and a half hours early.
 *
 * That shipped. A 6:00 AM trek went out in a reminder email as "12:30 am",
 * because "en-IN" sets the language, not the zone. Anything starting before
 * 5:30 AM IST loses a day as well, which is worse than a wrong clock — it tells
 * a member the wrong date.
 *
 * So: any date rendered *on the server* goes through here. Never pass a Date to
 * a locale formatter in backend code without a zone.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HOLD_MINUTES = exports.CLUB_TIME_ZONE = void 0;
exports.formatEventWhen = formatEventWhen;
exports.formatEventDate = formatEventDate;
exports.formatSheetDateTime = formatSheetDateTime;
exports.holdDeadline = holdDeadline;
exports.timeRemaining = timeRemaining;
/** IANA zone for every event the club runs. */
exports.CLUB_TIME_ZONE = "Asia/Kolkata";
/**
 * "Sunday, 20 September at 6:00 am" — the long form used when a member needs to
 * know both the day and the time, e.g. a reminder email.
 */
function formatEventWhen(date) {
    return new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: exports.CLUB_TIME_ZONE,
    }).format(date);
}
/**
 * "20/9/2026" — the short form for a line that already has its context, like
 * the meta row on a ticket or a refund confirmation.
 */
function formatEventDate(date) {
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        timeZone: exports.CLUB_TIME_ZONE,
    }).format(date);
}
/**
 * "20/09/2026 06:00" — a sortable stamp for a spreadsheet cell.
 *
 * Exports get their own format because a reader opening the file in Excel has
 * no way to ask what zone a bare time is in. Day-first to match how the club
 * writes dates, zero-padded so a column of them sorts as text.
 */
function formatSheetDateTime(date) {
    if (!date)
        return "";
    const parts = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: exports.CLUB_TIME_ZONE,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}
/**
 * How long a member has to pay before their places go back on sale.
 *
 * A day, as the club asked. Per-event overrides sit on `Event.hold_minutes`;
 * this is what a session that has not set one gets.
 */
exports.DEFAULT_HOLD_MINUTES = 24 * 60;
/** The deadline a booking made now would be given, for an event's setting. */
function holdDeadline(holdMinutes, from = new Date()) {
    const minutes = holdMinutes && holdMinutes > 0 ? holdMinutes : exports.DEFAULT_HOLD_MINUTES;
    return new Date(from.getTime() + minutes * 60_000);
}
/**
 * "in 22 hours" / "in 35 minutes" — how long is left on a hold.
 *
 * Rounded down, because a member told "1 hour left" at 1 hour 59 minutes and
 * locked out 59 minutes later would be right to complain.
 */
function timeRemaining(deadline, from = new Date()) {
    const ms = deadline.getTime() - from.getTime();
    if (ms <= 0)
        return "no time left";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60)
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
}
