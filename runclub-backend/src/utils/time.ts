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

/** IANA zone for every event the club runs. */
export const CLUB_TIME_ZONE = "Asia/Kolkata";

/**
 * "Sunday, 20 September at 6:00 am" — the long form used when a member needs to
 * know both the day and the time, e.g. a reminder email.
 */
export function formatEventWhen(date: Date): string {
    return new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: CLUB_TIME_ZONE,
    }).format(date);
}

/**
 * "20/9/2026" — the short form for a line that already has its context, like
 * the meta row on a ticket or a refund confirmation.
 */
export function formatEventDate(date: Date): string {
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        timeZone: CLUB_TIME_ZONE,
    }).format(date);
}
