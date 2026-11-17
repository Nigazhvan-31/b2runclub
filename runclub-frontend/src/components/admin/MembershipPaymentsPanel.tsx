import { useMemo, useState } from "react";
import { useFetch } from "../../lib/useFetch";
import { api } from "../../lib/api";
import type { AdminBranch } from "../../lib/types";
import { inr } from "../../lib/format";
import { Avatar, Button, Card, EmptyState, ErrorState, Input, Skeleton } from "../ui";
import { UsersIcon } from "../icons";

export function MembershipPaymentsPanel({ adminBranch = "ALL" }: { adminBranch?: AdminBranch }) {
  const { data, loading, error, reload } = useFetch(() => api.adminMembershipPayments());
  const [search, setSearch] = useState("");

  const allRecords = data?.payments ?? [];

  // Filter by branch and search text
  const filtered = useMemo(() => {
    return allRecords.filter((p) => {
      // Branch filter
      const matchB =
        adminBranch === "ALL" ||
        (adminBranch === "MADURAI" && p.branch === "MADURAI") ||
        (adminBranch === "CHENNAI" && p.branch === "CHENNAI");
      if (!matchB) return false;

      // Text search
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        p.razorpay_payment_id.toLowerCase().includes(q) ||
        p.razorpay_order_id.toLowerCase().includes(q)
      );
    });
  }, [allRecords, adminBranch, search]);

  const activeCount = useMemo(() => filtered.filter((p) => p.is_active).length, [filtered]);
  const totalRev = useMemo(() => filtered.reduce((sum, p) => sum + p.amount_inr, 0), [filtered]);

  // Export CSV
  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Branch",
      "Amount (INR)",
      "Status",
      "Payment Date",
      "Expiry Date",
      "Razorpay Payment ID",
      "Razorpay Order ID",
    ];

    const rows = filtered.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.email.replace(/"/g, '""')}"`,
      `"${p.phone.replace(/"/g, '""')}"`,
      p.branch,
      p.amount_inr,
      p.status,
      p.paid_at ? new Date(p.paid_at).toISOString() : "",
      p.expires_at ? new Date(p.expires_at).toISOString() : "",
      `"${p.razorpay_payment_id}"`,
      `"${p.razorpay_order_id}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `b2_paid_memberships_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Card className="mt-8 overflow-hidden border border-gold/30 bg-gradient-to-b from-surface-2/90 via-surface/90 to-surface p-6 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-gold/15 text-gold font-bold">
              ★
            </span>
            <h2 className="text-lg font-bold text-ink">Paid Memberships (B² Club Monthly)</h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            Track runners who paid for membership, their phone number, email, and Razorpay transaction IDs.
          </p>
        </div>

        {filtered.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="shrink-0">
            📥 Export CSV ({filtered.length})
          </Button>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/8 bg-surface-2/60 p-3.5">
          <p className="eyebrow text-ink-3">Paid Members</p>
          <p className="display mt-1 text-2xl text-ink">{filtered.length}</p>
        </div>
        <div className="rounded-xl border border-gold/25 bg-gold/[0.04] p-3.5">
          <p className="eyebrow text-gold">Active Subscriptions</p>
          <p className="display mt-1 text-2xl text-gold">{activeCount}</p>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-xl border border-white/8 bg-surface-2/60 p-3.5">
          <p className="eyebrow text-ink-3">Membership Revenue</p>
          <p className="display mt-1 text-2xl text-[color:var(--color-paid)]">{inr(totalRev)}</p>
        </div>
      </div>

      {/* Search Input */}
      <div className="mt-5 flex items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member by name, phone, email, or Razorpay ID..."
          className="w-full text-sm"
        />
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            Clear
          </Button>
        )}
      </div>

      {/* Data Table */}
      <div className="mt-5">
        {loading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : filtered.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={<UsersIcon className="size-6" />}
              title="No paid memberships found"
              body={
                search
                  ? "No member matches your search filter."
                  : "Paid club memberships will appear here as soon as runners complete payment."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-white/8 bg-surface-3/60 text-[11px] font-bold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Contact (Phone)</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Paid Date</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Razorpay ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((p) => {
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                      {/* Member */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={p.name} size={30} goldRing={p.is_active} />
                          <div className="min-w-0">
                            <p className="font-semibold text-ink truncate">{p.name}</p>
                            <span className="text-[10px] text-ink-3 uppercase font-medium">
                              {p.branch === "CHENNAI" ? "Chennai" : "Madurai"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Phone / WhatsApp */}
                      <td className="px-4 py-3.5">
                        {p.phone && p.phone !== "—" ? (
                          <a
                            href={`https://wa.me/${p.phone.replace(/[^0-9]/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-gold hover:underline flex items-center gap-1"
                            title="Open WhatsApp chat"
                          >
                            <span>💬</span>
                            <span>{p.phone}</span>
                          </a>
                        ) : (
                          <span className="text-ink-3 italic">Not provided</span>
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3.5">
                        <a
                          href={`mailto:${p.email}`}
                          className="text-ink-2 hover:text-ink hover:underline truncate max-w-[180px] block"
                        >
                          {p.email}
                        </a>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3.5 font-bold text-ink whitespace-nowrap">
                        {inr(p.amount_inr)}
                      </td>

                      {/* Paid Date */}
                      <td className="px-4 py-3.5 text-ink-3 whitespace-nowrap">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }) : "—"}
                      </td>

                      {/* Valid Until */}
                      <td className="px-4 py-3.5 text-ink-2 whitespace-nowrap">
                        {p.expires_at ? (
                          <span>
                            {new Date(p.expires_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {p.is_active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/20 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
                            EXPIRED
                          </span>
                        )}
                      </td>

                      {/* Razorpay IDs */}
                      <td className="px-4 py-3.5 font-mono text-[11px] text-ink-3 whitespace-nowrap">
                        <span title={p.razorpay_payment_id || p.razorpay_order_id}>
                          {p.razorpay_payment_id && p.razorpay_payment_id !== "—"
                            ? p.razorpay_payment_id
                            : p.razorpay_order_id}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
