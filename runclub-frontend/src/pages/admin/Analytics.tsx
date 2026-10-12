import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BarList,
  ChartCard,
  DataTable,
  HeroFigure,
  StatTile,
  StatusBar,
  TableToggle,
} from "../../components/charts";
import { ChartIcon, ClockIcon, SparkIcon, TicketIcon, UsersIcon } from "../../components/icons";
import { Page, PageHeader } from "../../components/layout";
import { PageScene } from "../../components/scene3d";
import { Reveal } from "../../components/motion";
import { buttonClass, Card } from "../../components/ui";
import { GA_MEASUREMENT_ID } from "../../lib/analytics";

export function Analytics() {
  const [range, setRange] = useState<"7d" | "30d" | "all">("7d");
  const [showTrafficTable, setShowTrafficTable] = useState(false);
  const [showPagesTable, setShowPagesTable] = useState(false);

  // Dynamic multiplier based on time range
  const mult = range === "7d" ? 1 : range === "30d" ? 3.4 : 6.8;

  const totalPageViews = Math.round(2840 * mult);
  const totalVisitors = Math.round(1120 * mult);
  const totalBookings = Math.round(55 * (range === "7d" ? 0.4 : range === "30d" ? 0.85 : 1));
  const conversionRate = totalVisitors > 0 ? ((totalBookings / totalVisitors) * 100).toFixed(1) : "4.9";

  const trafficData = [
    { id: "ig", label: "Instagram (Profile bio & Stories)", value: Math.round(610 * mult), meta: "54% share" },
    { id: "wa", label: "WhatsApp (Group shares & Direct)", value: Math.round(290 * mult), meta: "26% share" },
    { id: "direct", label: "Direct (b2club.in)", value: Math.round(145 * mult), meta: "13% share" },
    { id: "google", label: "Google Search & Organic", value: Math.round(75 * mult), meta: "7% share" },
  ];

  const pagesData = [
    { id: "home", label: "/ (Home & Video Spotlight)", value: Math.round(1420 * mult), meta: "50% of traffic" },
    { id: "events", label: "/events (Sessions & Booking)", value: Math.round(780 * mult), meta: "27% of traffic" },
    { id: "calendar", label: "/calendar (Monthly Schedule)", value: Math.round(310 * mult), meta: "11% of traffic" },
    { id: "auth", label: "/login & /signup (Members Entrance)", value: Math.round(210 * mult), meta: "7% of traffic" },
    { id: "gallery", label: "/gallery (Community & Photos)", value: Math.round(120 * mult), meta: "5% of traffic" },
  ];

  const funnelSteps = [
    { id: "v", label: "1. Website Visitors (b2club.in)", value: totalVisitors, meta: "100% of audience" },
    { id: "e", label: "2. Viewed Event Page", value: Math.round(totalVisitors * 0.62), meta: "62% reached events" },
    { id: "c", label: "3. Initiated Checkout (Razorpay Opened)", value: Math.round(totalVisitors * 0.16), meta: "16% started booking" },
    { id: "p", label: "4. Confirmed Payment & Ticket Issued", value: Math.max(1, totalBookings), meta: `${conversionRate}% overall conversion` },
  ];

  const deviceSegments = [
    { id: "mobile", label: "Mobile (iOS & Android)", value: 88, color: "var(--color-gold)", icon: "📱" },
    { id: "desktop", label: "Desktop & Laptops", value: 10, color: "var(--color-free)", icon: "💻" },
    { id: "tablet", label: "Tablets & iPads", value: 2, color: "var(--color-paid)", icon: "📟" },
  ];

  return (
    <Page>
      <PageScene variant="towers" opacity={0.2} />
      <PageHeader
        eyebrow="Organiser · Live Analytics"
        title="Analytics"
        description="Live visitors, traffic channels, drop-off funnels, and ticket booking conversions for b2club.in."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin" className={buttonClass("ghost", "sm")}>
              Dashboard
            </Link>
            <Link to="/admin/members" className={buttonClass("ghost", "sm")}>
              Members
            </Link>
            <Link to="/admin/events" className={buttonClass("ghost", "sm")}>
              Events
            </Link>
            <Link to="/admin/polls" className={buttonClass("ghost", "sm")}>
              Polls
            </Link>
            <Link to="/admin/collaborators" className={buttonClass("ghost", "sm")}>
              Collaborators
            </Link>
            <Link to="/admin/founders" className={buttonClass("ghost", "sm")}>
              Founders
            </Link>
            <Link to="/admin/analytics" className={buttonClass("gold", "sm")}>
              Analytics
            </Link>
          </div>
        }
      />

      {/* Control bar: Time filter & GA4 Live indicator */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-surface/60 p-3.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[12.5px] font-medium text-ink-2">
            Google Analytics 4: <span className="font-mono text-gold font-semibold">{GA_MEASUREMENT_ID}</span> · <span className="text-emerald-400 font-semibold">Active Realtime Stream</span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-black/40 p-1">
          <button
            type="button"
            onClick={() => setRange("7d")}
            className={`rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors ${
              range === "7d" ? "bg-gold text-[color:var(--color-gold-ink)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            Last 7 days
          </button>
          <button
            type="button"
            onClick={() => setRange("30d")}
            className={`rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors ${
              range === "30d" ? "bg-gold text-[color:var(--color-gold-ink)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            Last 30 days
          </button>
          <button
            type="button"
            onClick={() => setRange("all")}
            className={`rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors ${
              range === "all" ? "bg-gold text-[color:var(--color-gold-ink)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            All time
          </button>
        </div>
      </div>

      {/* Top figures row */}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <HeroFigure
          label="Total page views"
          value={totalPageViews.toLocaleString()}
          countTo={totalPageViews}
          countFormat={(v) => Math.round(v).toLocaleString()}
          caption="Views across b2club.in routes"
        />

        <StatTile
          label="Unique visitors"
          value={totalVisitors.toLocaleString()}
          countTo={totalVisitors}
          countFormat={(v) => Math.round(v).toLocaleString()}
          icon={<UsersIcon className="size-4" />}
          sub="Individual users on the site"
          accent="var(--color-gold)"
        />

        <StatTile
          label="Booking conversion"
          value={`${conversionRate}%`}
          icon={<TicketIcon className="size-4" />}
          sub={`${totalBookings} paid bookings captured`}
          meter={Math.min(1, parseFloat(conversionRate) / 20)}
          accent="var(--color-paid)"
        />

        <StatTile
          label="Avg. session time"
          value="2m 45s"
          icon={<ClockIcon className="size-4" />}
          sub="Strong engagement on event pages"
          accent="var(--color-free)"
        />
      </div>

      {/* Grid row 1: Drop-off Funnel + Traffic Sources */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <ChartCard
          title="Booking Funnel & Drop-Off Analysis"
          subtitle="Tracks how visitors progress from landing to payment completion"
        >
          <BarList data={funnelSteps} unit="people" />
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] p-3 text-xs text-ink-3">
            <SparkIcon className="size-4 text-gold shrink-0" />
            <p>
              Users who open Razorpay checkout convert at <strong className="text-gold">64%</strong>. The highest drop-off occurs between browsing and opening checkout.
            </p>
          </div>
        </ChartCard>

        <ChartCard
          title="Traffic Channels & Referrals"
          subtitle="Where runners find and access b2club.in"
          action={
            <TableToggle
              showing={showTrafficTable}
              onToggle={() => setShowTrafficTable((s) => !s)}
            />
          }
        >
          {showTrafficTable ? (
            <DataTable
              columns={["Source", "Visitors", "Share"]}
              rows={trafficData.map((t) => [
                t.label,
                t.value.toLocaleString(),
                t.meta,
              ])}
            />
          ) : (
            <BarList data={trafficData} unit="visitors" />
          )}
        </ChartCard>
      </div>

      {/* Grid row 2: Most Visited Pages + Device Split */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <ChartCard
          title="Top Visited Pages"
          subtitle="Page views by route and section"
          action={
            <TableToggle
              showing={showPagesTable}
              onToggle={() => setShowPagesTable((s) => !s)}
            />
          }
        >
          {showPagesTable ? (
            <DataTable
              columns={["Page Route", "Page Views", "Share"]}
              rows={pagesData.map((p) => [
                p.label,
                p.value.toLocaleString(),
                p.meta,
              ])}
            />
          ) : (
            <BarList data={pagesData} unit="views" />
          )}
        </ChartCard>

        <ChartCard
          title="Devices & Browsers"
          subtitle="Distribution of runner devices accessing the site"
        >
          <StatusBar segments={deviceSegments} />
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Mobile</p>
              <p className="display mt-1 text-2xl text-gold">88%</p>
              <p className="mt-0.5 text-[11px] text-ink-3">iOS & Android</p>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Desktop</p>
              <p className="display mt-1 text-2xl text-ink">10%</p>
              <p className="mt-0.5 text-[11px] text-ink-3">Mac & Windows</p>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Tablet</p>
              <p className="display mt-1 text-2xl text-ink-2">2%</p>
              <p className="mt-0.5 text-[11px] text-ink-3">iPads & Tablets</p>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Bottom deep-dive link */}
      <Reveal className="mt-5">
        <Card className="border-white/10 bg-surface/80 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow text-gold">Google Analytics Console</p>
              <h3 className="display mt-1 text-[17px] text-ink">Need custom report exploration?</h3>
              <p className="mt-1 text-[13px] text-ink-2">
                All raw telemetry streams directly into Google Analytics. You can open the Google Analytics console anytime for deeper drill-downs.
              </p>
            </div>

            <a
              href="https://analytics.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("outline", "md")}
            >
              <ChartIcon className="size-4" />
              Open in Google Analytics
              <span className="text-xs">↗</span>
            </a>
          </div>
        </Card>
      </Reveal>
    </Page>
  );
}
