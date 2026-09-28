import ExcelJS from "exceljs";
import fs from "fs";
import { execFileSync } from "child_process";

const API = "http://localhost:3000";
const DB = "/Users/mfaarsi/Desktop/B2 Run/runclub-backend/dev.db";
const sql = (q) => execFileSync("sqlite3", [DB, q], { encoding: "utf8" }).trim();

const results = [];
const rec = (id, name, ok, detail = "") => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(9)} ${name}${ok ? "" : "  ← " + detail}`);
};

let TOK = {}; // role -> token

async function call(path, { method = "GET", body, token, raw = false } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const env = Object.fromEntries(
  fs.readFileSync("/Users/mfaarsi/Desktop/B2 Run/runclub-backend/env file", "utf8")
    .split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

// ── setup ──────────────────────────────────────────────────────────────
const login = async (email, password) =>
  (await call("/api/auth/login", { method: "POST", body: { email, password } })).json?.token;

TOK.admin = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
if (!TOK.admin) { console.error("cannot log in as admin — aborting"); process.exit(1); }

const PW = "suite-password-123";
const mk = async (email, name, phone) => {
  await call("/api/auth/register", { method: "POST", body: { email, password: PW, name, phone } });
  sql(`update User set email_verified_at=CURRENT_TIMESTAMP where email='${email}'`);
  return login(email, PW);
};
TOK.member = await mk("suite.member@example.com", "Suite Member", "9800000001");
TOK.member2 = await mk("suite.member2@example.com", "Suite Two", "9800000002");
TOK.unverified = await (async () => {
  await call("/api/auth/register", { method: "POST", body: { email: "suite.unver@example.com", password: PW, name: "Suite Unver", phone: "9800000003" } });
  return login("suite.unver@example.com", PW);
})();
await call("/api/auth/register", { method: "POST", body: { email: "suite.vol@example.com", password: PW, name: "Suite Vol", phone: "9800000004" } });
sql(`update User set email_verified_at=CURRENT_TIMESTAMP, role='VOLUNTEER' where email='suite.vol@example.com'`);
TOK.volunteer = await login("suite.vol@example.com", PW);


// ── §1 signup and login ────────────────────────────────────────────────
let r;
r = await call("/api/auth/register", { method: "POST", body: { email: "s1@example.com", password: PW, name: "No Phone" } });
rec("TC-1.02", "mobile mandatory at signup", r.status === 400, `got ${r.status}`);
r = await call("/api/auth/register", { method: "POST", body: { email: "s2@example.com", password: PW, name: "Bad Phone", phone: "12345" } });
rec("TC-1.03", "mobile validated", r.status === 400, `got ${r.status}`);
rec("TC-1.04", "mobile normalised to E.164",
  sql(`select phone from User where email='suite.member@example.com'`) === "+919800000001",
  sql(`select phone from User where email='suite.member@example.com'`));
r = await call("/api/auth/register", { method: "POST", body: { email: "s3@example.com", password: PW, name: "Intl", phone: "+442071234567" } });
rec("TC-1.05", "overseas number kept", r.status < 300 && sql(`select phone from User where email='s3@example.com'`) === "+442071234567",
  sql(`select phone from User where email='s3@example.com'`));
r = await call("/api/auth/register", { method: "POST", body: { email: "suite.member@example.com", password: PW, name: "Dup", phone: "9800000009" } });
rec("TC-1.06", "duplicate email refused", r.status === 400, `got ${r.status}`);
r = await call("/api/auth/register", { method: "POST", body: { email: "s4@example.com", password: "short12", name: "Short", phone: "9800000010" } });
rec("TC-1.07", "password minimum enforced at signup", r.status === 400, `got ${r.status}`);
r = await call("/api/auth/login", { method: "POST", body: { email: "suite.member@example.com", password: "wrong-password" } });
rec("TC-1.13", "wrong password refused", r.status === 401 || r.status === 400, `got ${r.status}`);
rec("TC-1.12", "login succeeds", Boolean(TOK.member));

// ── events used by the rest ────────────────────────────────────────────
const mkEvent = async (over = {}) => {
  const res = await call("/api/events", { method: "POST", token: TOK.admin, body: {
    title: over.title ?? "Suite Event", type: "Run", date_time: "2026-12-20T00:30:00.000Z",
    location: "Madurai", price: 100, status: "PUBLISHED", ...over } });
  return res.json?.event?.id;
};
const paid = await mkEvent({ title: "Suite Paid", price: 100, capacity: 10, kids_allowed: true, kid_price: 50,
  party_discount: 50, discount_min_party: 3, hold_minutes: 600,
  questions: [
    { prompt: "Playing level", kind: "CHOICE", options: ["Beginner", "Advanced"], required: true },
    { prompt: "Notes", kind: "TEXT", options: [], required: false },
  ] });
const free = await mkEvent({ title: "Suite Free", price: 0 });
const draft = await mkEvent({ title: "Suite Draft", status: "DRAFT" });
const noq = await mkEvent({ title: "Suite NoQ", price: 0 });
const ev = (await call(`/api/events/${paid}`, { token: TOK.admin })).json;
const QID = ev.questions[0].id, QTEXT = ev.questions[1].id;

// ── §11 event configuration ────────────────────────────────────────────
rec("TC-11.03", "6:00 AM IST round-trips", ev.date_time.startsWith("2026-12-20T00:30"), ev.date_time);
rec("TC-11.10", "discount min party configurable", ev.discount_min_party === 3 && ev.discount_min_party_effective === 3,
  `raw ${ev.discount_min_party} eff ${ev.discount_min_party_effective}`);
const evDefault = (await call(`/api/events/${free}`, { token: TOK.admin })).json;
rec("TC-11.11", "discount default is 2", evDefault.discount_min_party_effective === 2, String(evDefault.discount_min_party_effective));
r = await call(`/api/events/${free}`, { method: "PUT", token: TOK.admin, body: { discount_min_party: 1 } });
rec("TC-11.12", "discount size of 1 refused", r.status === 400, `got ${r.status}`);
rec("TC-11.14", "hold length configurable", ev.hold_minutes === 600, String(ev.hold_minutes));
rec("TC-11.15", "hold default (blank)", evDefault.hold_minutes === null, String(evDefault.hold_minutes));
r = await call(`/api/events/${free}`, { method: "PUT", token: TOK.admin, body: { kids_allowed: false } });
rec("TC-11.17", "turning children off clears the price", r.json?.event?.kid_price === null, String(r.json?.event?.kid_price));
r = await call("/api/events", { method: "POST", token: TOK.member, body: { title: "x", type: "Run", date_time: "2026-12-01T00:00:00Z", location: "x", price: 0 } });
rec("TC-11.20", "member cannot create an event", r.status === 403, `got ${r.status}`);
r = await call(`/api/events/${draft}`, { token: TOK.member });
rec("TC-3.14", "draft event hidden from members", r.status === 403 || r.status === 404, `got ${r.status}`);

// ── §3 / §4 registration ───────────────────────────────────────────────
const reg = (token, id, body) => call(`/api/events/${id}/register`, { method: "POST", token, body: { waiver_signed: true, ...body } });
/* Registrations a *validation* test created by unexpectedly succeeding. Left
   behind, they make every later attempt by that member fail as a duplicate —
   one harness bug masquerading as seven app failures. */
const clearRegs = (email) => sql(`delete from EventRegistration where user_id in (select id from User where email='${email}')`);
const regStrict = async (token, id, body, email) => { const res = await reg(token, id, body); if (res.status < 300) clearRegs(email); return res; };
r = await reg(TOK.unverified, free, { phone: "9800000003", emergency_contact: "9811111111" });
rec("TC-1.11", "unverified cannot register", r.status === 403, `got ${r.status}`);
r = await regStrict(TOK.member, paid, { emergency_contact: "9811111111", answers: { [QID]: "Beginner" } }, "suite.member@example.com");
rec("TC-3.05api", "API falls back to the account number when the form omits it",
  r.status < 300, `got ${r.status} ${r.json?.error ?? ""}`);
r = await regStrict(TOK.member, paid, { phone: "12345", emergency_contact: "9811111111", answers: { [QID]: "Beginner" } }, "suite.member@example.com");
rec("TC-3.06", "WhatsApp number validated", r.status === 400, r.json?.error);
/* Tested on an account with no contact on file. Both this and the WhatsApp
   number fall back to the account when the form omits them, so a member who
   has one already cannot be used to prove the field is required. */
sql(`update User set emergency_contact=NULL where email='suite.member2@example.com'`);
r = await regStrict(TOK.member2, paid, { phone: "9800000002", answers: { [QID]: "Beginner" } }, "suite.member2@example.com");
rec("TC-3.07", "emergency contact required (no account fallback available)", r.status === 400, `got ${r.status}`);
r = await call(`/api/events/${paid}/register`, { method: "POST", token: TOK.member, body: { phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Beginner" } } });
rec("TC-3.12", "waiver required", r.status === 400, `got ${r.status}`);
r = await regStrict(TOK.member, paid, { phone: "9800000001", emergency_contact: "9811111111", answers: {} }, "suite.member@example.com");
rec("TC-8.06", "required question blocks registration", r.status === 400 && /Playing level/.test(r.json?.error ?? ""), r.json?.error);
r = await regStrict(TOK.member, paid, { phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Expert" } }, "suite.member@example.com");
rec("TC-8.10b", "answer must be one of the choices", r.status === 400, r.json?.error);
r = await regStrict(TOK.member, paid, { phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Beginner" },
  guests: [{ name: "Guest A", kind: "ADULT", phone: "" }] }, "suite.member@example.com");
rec("TC-4.06", "guest needs a number", r.status === 400 && /Guest A/.test(r.json?.error ?? ""), r.json?.error);
r = await regStrict(TOK.member, paid, { phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Beginner" },
  guests: Array.from({ length: 6 }, (_, i) => ({ name: `G${i}`, kind: "ADULT", use_booker_phone: true })) }, "suite.member@example.com");
rec("TC-4.05", "party ceiling enforced", r.status === 400, r.json?.error);

// the real booking: 2 adults + 1 child, one sharing the booker's number
r = await reg(TOK.member, paid, { phone: "98000 00001", emergency_contact: "9811111111",
  answers: { [QID]: "Beginner", [QTEXT]: "none" },
  guests: [{ name: "Adult G", kind: "ADULT", phone: "98000 00022" }, { name: "Kid G", kind: "KID", use_booker_phone: true }] });
const REG1 = r.json?.registration?.id;
rec("TC-4.13", "party total correct (2 adult + 1 child − ₹50)", r.json?.amount === 20000, `₹${(r.json?.amount ?? 0) / 100}`);
rec("TC-11.09", "group discount applied once", r.json?.registration?.discount_paise_at_booking === 5000, String(r.json?.registration?.discount_paise_at_booking));
rec("TC-3.02", "paid booking is Awaiting Payment", r.json?.registration?.status === "PENDING", r.json?.registration?.status);
rec("TC-6.01", "hold deadline set", Boolean(r.json?.hold_expires_at), String(r.json?.hold_expires_at));
const g = r.json?.registration?.guests ?? [];
rec("TC-4.11", "guest number normalised", g.find((x) => x.name === "Adult G")?.phone === "+919800000022", g.find((x) => x.name === "Adult G")?.phone);
rec("TC-4.08", "shared number inherited", g.find((x) => x.name === "Kid G")?.phone === "+919800000001", g.find((x) => x.name === "Kid G")?.phone);
rec("TC-3.10", "corrected number saved to account", sql(`select phone from User where email='suite.member@example.com'`) === "+919800000001");
r = await reg(TOK.member, paid, { phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Beginner" } });
rec("TC-3.13", "cannot register twice", r.status === 400, `got ${r.status}`);

// account with no phone on file
sql(`update User set phone=NULL where email='suite.member2@example.com'`);
r = await reg(TOK.member2, paid, { phone: "9800000002", emergency_contact: "9811111122", answers: { [QID]: "Advanced" } });
rec("TC-3.11", "phoneless account can supply it in the form", r.status < 300, r.json?.error);
const REG2 = r.json?.registration?.id;

// free event, no questionnaire
r = await reg(TOK.member, free, { phone: "9800000001", emergency_contact: "9811111111" });
rec("TC-3.01", "free booking is settled at once", r.json?.registration?.status === "FREE", r.json?.registration?.status);
rec("TC-6.13", "free booking has no hold", r.json?.hold_expires_at === null, String(r.json?.hold_expires_at));
r = await reg(TOK.member, noq, { phone: "9800000001", emergency_contact: "9811111111" });
rec("TC-8.14", "event without a questionnaire registers fine", r.status < 300, r.json?.error);

// volunteer comping
r = await reg(TOK.volunteer, paid, { phone: "9800000004", emergency_contact: "9811111133", answers: { [QID]: "Beginner" },
  guests: [{ name: "Vol Guest", kind: "ADULT", use_booker_phone: true }] });
rec("TC-4.14", "volunteer's own place comped, guest charged", r.json?.amount === 10000, `₹${(r.json?.amount ?? 0) / 100}`);



const places = async (id) => (await call(`/api/events/${id}`, { token: TOK.admin })).json;

// ── §10 capacity arithmetic across every status ────────────────────────
let p = await places(paid);
const baseline = p.taken;
rec("TC-6.02", "unpaid booking holds its places", baseline > 0, `taken ${baseline}`);

r = await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "CANCELLED", reason: "suite" } });
rec("TC-10.04", "cancel a booking", r.status === 200 && r.json?.registration?.status === "CANCELLED", r.json?.error);
p = await places(paid);
rec("TC-10.05", "cancelling frees places", p.taken === baseline - 3, `taken ${p.taken}, was ${baseline}`);
rec("TC-10.15", "cancelled booking is not deleted", sql(`select count(*) from EventRegistration where id='${REG1}'`) === "1");

r = await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "RESTORE" } });
rec("TC-10.09", "reinstate an unpaid booking → Awaiting Payment with a fresh hold",
  r.json?.registration?.status === "PENDING" && Boolean(r.json?.registration?.hold_expires_at), r.json?.registration?.status);

// a paid booking, reinstated, must come back PAID
sql(`update EventRegistration set status='PAID', razorpay_payment_id='pay_suite_fake' where id='${REG2}'`);
await call(`/api/admin/registrations/${REG2}/status`, { method: "PUT", token: TOK.admin, body: { status: "CANCELLED" } });
r = await call(`/api/admin/registrations/${REG2}/status`, { method: "PUT", token: TOK.admin, body: { status: "RESTORE" } });
rec("TC-10.10", "reinstating a PAID booking returns it to Paid", r.json?.registration?.status === "PAID", r.json?.registration?.status);

r = await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "DEACTIVATED" } });
rec("TC-10.06", "deactivate a booking", r.json?.registration?.status === "DEACTIVATED", r.json?.error);
r = await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "TEST" } });
rec("TC-10.07", "mark as a test registration", r.json?.registration?.status === "TEST", r.json?.error);
p = await places(paid);
rec("TC-10.16", "test registrations do not consume capacity", p.taken === baseline - 3, `taken ${p.taken}`);
const notes = sql(`select count(*) from Notification n join User u on u.id=n.user_id where u.email='suite.member@example.com' and n.message like '%Test Registration%'`);
rec("TC-10.08", "test registrations notify nobody", notes === "0", `${notes} notifications`);
r = await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "PAID" } });
rec("TC-10.11", "payment status cannot be set by hand", r.status === 400, `got ${r.status}`);
await call(`/api/admin/registrations/${REG1}/status`, { method: "PUT", token: TOK.admin, body: { status: "RESTORE" } });

// block / readmit
r = await call(`/api/admin/registrations/${REG1}/block`, { method: "PUT", token: TOK.admin, body: { blocked: true } });
rec("TC-10.12", "block a member", r.status === 200 && Boolean(r.json?.registration?.blocked_at), r.json?.error);
rec("TC-10.12b", "blocking leaves the payment status alone", r.json?.registration?.status === "PENDING", r.json?.registration?.status);
p = await places(paid);
rec("TC-10.14", "blocking frees places", p.taken === baseline - 3, `taken ${p.taken}`);
r = await call(`/api/events/registration/${REG1}/ticket`, { token: TOK.member });
rec("TC-7.03", "blocked member gets no ticket", r.status === 403, `got ${r.status}`);
r = await call(`/api/admin/registrations/${REG1}/block`, { method: "PUT", token: TOK.admin, body: { blocked: false } });
rec("TC-10.13", "readmit a member", r.status === 200 && !r.json?.registration?.blocked_at, r.json?.error);

// capacity floor
r = await call(`/api/events/${paid}`, { method: "PUT", token: TOK.admin, body: { capacity: 1 } });
rec("TC-10.17", "capacity cannot be cut below the places taken", r.status === 400, `got ${r.status}`);

// ── §7 tickets ─────────────────────────────────────────────────────────
r = await call(`/api/events/registration/${REG1}/ticket`, { token: TOK.member });
rec("TC-7.02", "no ticket while unpaid", r.status === 400, `got ${r.status}`);
r = await call(`/api/events/registration/${REG2}/ticket`, { token: TOK.member });
rec("TC-7.04", "cannot open another member's ticket", r.status === 403, `got ${r.status}`);
const t = await fetch(`${API}/api/events/registration/${REG2}/ticket`, { headers: { Authorization: `Bearer ${TOK.member2}` } });
const html = await t.text();
rec("TC-7.01", "paid ticket renders with a QR and the party",
  t.status === 200 && html.includes("data:image/png;base64") && html.includes("Suite Two"), `status ${t.status}`);
rec("TC-13.05", "ticket date is IST", html.includes("20/12/2026"), (html.match(/\d\d\/\d\d\/\d{4}/) ?? ["none"])[0]);

// ── §6 hold expiry ─────────────────────────────────────────────────────
// Force REG1's deadline into the past rather than waiting.
sql(`update EventRegistration set hold_expires_at='2020-01-01T00:00:00.000+00:00' where id='${REG1}'`);
p = await places(paid);
rec("TC-6.07", "a lapsed hold frees places before any sweep runs", p.taken === baseline - 3, `taken ${p.taken}`);
r = await call("/api/admin/holds/sweep", { method: "POST", token: TOK.admin });
rec("TC-6.05", "sweep expires the lapsed hold", sql(`select status from EventRegistration where id='${REG1}'`) === "EXPIRED",
  sql(`select status from EventRegistration where id='${REG1}'`));
rec("TC-6.08", "the expired record survives", sql(`select count(*) from EventRegistration where id='${REG1}'`) === "1");
const expNote = sql(`select count(*) from Notification n join User u on u.id=n.user_id where u.email='suite.member@example.com' and n.message like '%expired%'`);
rec("TC-6.05b", "member is told their spot expired", Number(expNote) > 0, `${expNote} notifications`);
const before = sql(`select count(*) from Notification`);
r = await call("/api/admin/holds/sweep", { method: "POST", token: TOK.admin });
rec("TC-6.09", "no further reminder after expiry", r.json?.reminded === 0 && r.json?.expired === 0, JSON.stringify(r.json));
r = await call(`/api/events/${paid}/register`, { method: "POST", token: TOK.member, body: {
  waiver_signed: true, phone: "9800000001", emergency_contact: "9811111111", answers: { [QID]: "Advanced" } } });
rec("TC-6.10", "re-registration after expiry is allowed", r.status < 300, r.json?.error);
const REG3 = r.json?.registration?.id;

// ── §12 exports ────────────────────────────────────────────────────────
const wbFile = async (path, token) => {
  const res = await call(path, { token, raw: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buf);
  return { res, ws: wb.worksheets[0] };
};
const { res: rres, ws: roster } = await wbFile(`/api/admin/events/${paid}/roster/export`, TOK.admin);
rec("TC-12.01", "roster downloads as a real .xlsx",
  rres.headers.get("content-type").includes("spreadsheetml"), rres.headers.get("content-type"));
const rows = [];
roster.eachRow((row, i) => { if (i > 1) rows.push(row.values.slice(1).map((v) => String(v ?? ""))); });
const header = roster.getRow(1).values.slice(1).map(String);
rec("TC-12.02", "one row per participant", rows.length >= 3, `${rows.length} rows`);
rec("TC-12.03", "numbers are E.164 with no leading apostrophe",
  rows.some((x) => /^\+91\d{10}$/.test(x[1])), rows.map((x) => x[1]).join(","));
rec("TC-12.05", "a shared number appears against the guest who used it",
  rows.filter((x) => x[1] === "+919800000001").length >= 2, rows.map((x) => `${x[0]}=${x[1]}`).join(" "));
rec("TC-12.06", "questionnaire answers are columns", header.includes("Playing level"), header.join(","));
rec("TC-12.07", "statuses are readable", rows.some((x) => x.includes("Awaiting Payment") || x.includes("Spot Expired – Register Again")),
  rows.map((x) => x[5]).join(","));
rec("TC-12.08", "export timestamps are IST", rows.some((x) => /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(x[9])), rows[0]?.[9]);
const { res: mres, ws: members } = await wbFile("/api/admin/members/export", TOK.admin);
rec("TC-12.10", "member list downloads as .xlsx", mres.headers.get("content-type").includes("spreadsheetml"));
const mheader = members.getRow(1).values.slice(1).map(String);
rec("TC-12.12", "member list carries the expected columns",
  ["Name","Email","Mobile","Emergency contact","Role","Email status","Events attended","Total paid (₹)","Joined"].every((h) => mheader.includes(h)),
  mheader.join(","));
rec("TC-12.11", "member list is complete", members.rowCount - 1 >= Number(sql("select count(*) from User")),
  `${members.rowCount - 1} rows vs ${sql("select count(*) from User")} users`);

// a comma in a name must not split a cell
await call(`/api/events/${noq}/register`, { method: "POST", token: TOK.volunteer, body: {
  waiver_signed: true, phone: "9800000004", emergency_contact: "9811111133",
  guests: [{ name: "Smith, John", kind: "ADULT", use_booker_phone: true }] } });
const { ws: comma } = await wbFile(`/api/admin/events/${noq}/roster/export`, TOK.admin);
let found = false;
comma.eachRow((row, i) => { if (i > 1 && String(row.getCell(1).value) === "Smith, John") found = true; });
rec("TC-12.09", "a comma in a name stays in one cell", found);

// ── §15 access control ─────────────────────────────────────────────────
const denied = async (label, id, path, opts) => {
  const res = await call(path, opts);
  rec(id, label, res.status === 403 || res.status === 401, `got ${res.status}`);
};
await denied("member cannot read the admin roster", "TC-15.03", `/api/admin/events/${paid}/registrations`, { token: TOK.member });
await denied("volunteer cannot read the admin roster", "TC-15.04", `/api/admin/events/${paid}/registrations`, { token: TOK.volunteer });
await denied("signed-out visitor cannot list registrations", "TC-15.05", "/api/events/me/registrations", {});
await denied("member cannot refund", "TC-15.06", `/api/payments/refund/${REG2}`, { method: "POST", token: TOK.member });
await denied("member cannot change a registration's status", "TC-15.07", `/api/admin/registrations/${REG2}/status`, { method: "PUT", token: TOK.member, body: { status: "CANCELLED" } });
await denied("member cannot export the member list", "TC-15.08", "/api/admin/members/export", { token: TOK.member });
await denied("member cannot sweep holds", "TC-15.08b", "/api/admin/holds/sweep", { method: "POST", token: TOK.member });
r = await call("/api/events/me/registrations", { token: "not.a.real.token" });
rec("TC-15.09", "a tampered token is refused cleanly", r.status === 401, `got ${r.status}`);
r = await call(`/api/payments/reconcile/${REG3}`, { method: "POST", token: TOK.member });
rec("TC-15.10", "member may reconcile their own booking", r.status !== 403, `got ${r.status}`);
r = await call(`/api/payments/reconcile/${REG3}`, { method: "POST", token: TOK.member2 });
rec("TC-15.11", "member cannot reconcile somebody else's", r.status === 403, `got ${r.status}`);

// ── §5 payment guards ──────────────────────────────────────────────────
r = await call(`/api/payments/refund/${REG3}`, { method: "POST", token: TOK.admin });
rec("TC-5.12", "only a paid entry can be refunded", r.status === 400, `got ${r.status}`);
const cheap = (await call("/api/events", { method: "POST", token: TOK.admin, body: {
  title: "Suite Cheap", type: "Run", date_time: "2026-12-21T00:30:00.000Z", location: "Madurai", price: 0.5, status: "PUBLISHED" } })).json.event.id;
r = await call(`/api/events/${cheap}/register`, { method: "POST", token: TOK.member2, body: {
  waiver_signed: true, phone: "9800000002", emergency_contact: "9811111122" } });
rec("TC-5.13", "sub-₹1 booking refused with an explanation", r.status === 400 && /minimum/i.test(r.json?.error ?? ""), r.json?.error);
r = await call("/api/payments/verify", { method: "POST", token: TOK.member, body: {
  razorpay_order_id: "order_fake", razorpay_payment_id: "pay_fake", razorpay_signature: "deadbeef" } });
rec("TC-5.14", "a forged payment signature is refused", r.status === 400, `got ${r.status}`);

fs.writeFileSync("/tmp/suite-results.json", JSON.stringify(results));
const pass = results.filter((x) => x.ok).length;
console.log(`\n=== TOTAL: ${pass}/${results.length} passed ===`);
if (pass < results.length) console.log("failed:", results.filter((x) => !x.ok).map((x) => x.id).join(", "));
