import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { openCheckout, isMockPayment } from "../lib/razorpay";
import { Card, useToast } from "./ui";
import { Confetti } from "./motion";
import { fullDate } from "../lib/format";

export function MembershipCard() {
  const { user, isMembershipActive, refreshUser } = useAuth();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [resetting, setResetting] = useState(false);

  // The membership section only appears after logging in
  if (!user) return null;

  const handleResetTest = async () => {
    setResetting(true);
    try {
      await api.adminResetMyMembership();
      await refreshUser();
      toast("Membership removed for this account! You can now test the coming soon view.", "ok");
    } catch {
      toast("Could not reset test membership", "err");
    } finally {
      setResetting(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    try {
      // 1. Create membership order
      const orderRes = await api.createMembershipOrder();

      // If mock mode on dev without keys
      if (orderRes.mock_mode || isMockPayment(orderRes.razorpay_key_id, orderRes.order_id)) {
        const verifyRes = await api.verifyMembershipPayment({
          razorpay_order_id: orderRes.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });

        await refreshUser();
        setCelebrate(true);
        toast(verifyRes.message || "Welcome to B² Membership!", "ok");
        return;
      }

      // 2. Open live Razorpay overlay
      const paymentResult = await openCheckout({
        keyId: orderRes.razorpay_key_id,
        orderId: orderRes.order_id,
        amountPaise: orderRes.amount_paise,
        eventTitle: "B² Club Monthly Membership",
        description: "B² Club Monthly Membership — ₹599",
        userName: user.name,
        userEmail: user.email,
        contact: user.phone,
        notes: {
          payment_type: "MEMBERSHIP",
          product: "B² Club Monthly Membership",
          member_name: user.name,
          member_email: user.email,
          member_phone: user.phone || "Not provided",
        },
      });

      // 3. Verify signature on backend
      const verifyRes = await api.verifyMembershipPayment({
        razorpay_order_id: paymentResult.razorpay_order_id,
        razorpay_payment_id: paymentResult.razorpay_payment_id,
        razorpay_signature: paymentResult.razorpay_signature,
      });

      await refreshUser();
      setCelebrate(true);
      toast(verifyRes.message || "Membership activated! You now have free entry to all runs.", "ok");
    } catch (err: any) {
      if (err?.name === "CheckoutDismissed") {
        toast("Payment cancelled.", "info");
      } else {
        toast(err?.message || "Could not complete membership payment", "err");
      }
    } finally {
      setBusy(false);
    }
  };

  if (isMembershipActive) {
    return (
      <section className="relative mx-auto max-w-5xl px-4 py-3 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden border border-gold/40 bg-gradient-to-r from-surface-2/95 via-surface/90 to-surface-2/95 p-5 sm:p-6 shadow-[0_0_35px_rgba(233,185,73,0.12)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-gold">
                  ★ Active B² Member
                </div>
                <p className="text-[14px] font-medium text-ink">
                  Your monthly membership is active · 100% Free entry to all club runs
                </p>
                {user?.membership_expires_at && (
                  <p className="text-xs text-ink-3">
                    Valid until {fullDate(user.membership_expires_at)} · Renews every 30 days
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleResetTest}
                  disabled={resetting}
                  className="block text-[11px] text-ink-3 hover:text-gold transition-colors underline pt-1 text-left cursor-pointer"
                >
                  {resetting ? "Removing..." : "Remove membership for this account (test runner view)"}
                </button>
              </div>
              <Link
                to="/events"
                className="inline-flex items-center justify-center shrink-0 rounded-xl bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[color:var(--color-gold-ink)] transition-transform hover:scale-[1.02]"
              >
                Browse Free Runs →
              </Link>
            </div>
          </Card>
        </motion.div>
      </section>
    );
  }

  return (
    <>
      <Confetti show={celebrate} />
      <section className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden border border-gold/40 bg-gradient-to-br from-surface-2/95 via-surface/90 to-void p-6 sm:p-10 shadow-[0_0_50px_rgba(233,185,73,0.12)]">
            {/* Ambient Background Glow */}
            <div
              className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-gold/15 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-sky-500/10 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              {/* Left Column: Heading & Details */}
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gold shadow-sm">
                  <span className="inline-block size-1.5 rounded-full bg-gold animate-pulse" />
                  Coming Soon
                </div>

                <h2 className="display mt-3 text-2xl font-bold sm:text-3xl lg:text-4xl text-ink tracking-tight">
                  B² Club Membership
                </h2>

                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  Unlock the full B² experience. Train with the community, race harder, and never pay per event again.
                </p>
              </div>

              {/* Right Column: Clean Coming Soon Badge */}
              <div className="sm:shrink-0 flex flex-col items-start sm:items-end">
                <span className="inline-flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-gold shadow-sm">
                  <span className="text-base">✨</span>
                  <span>Coming Soon</span>
                </span>
                {user?.role === "ADMIN" && (
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={busy}
                    className="mt-2 text-[11px] text-ink-3 hover:text-gold transition-colors underline cursor-pointer"
                  >
                    {busy ? "Processing..." : "Admin Test: Test Pay ₹599"}
                  </button>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      </section>
    </>
  );
}
