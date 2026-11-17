import { Router, Response } from "express";
import crypto from "crypto";
import prisma from "../utils/prisma";
import { AuthRequest, requireAccount, requireRole } from "../middleware/auth";
import Razorpay from "razorpay";
import {
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_MOCK_MODE,
} from "../utils/secrets";

const router = Router();

export const MEMBERSHIP_CONFIG = {
    tier: "MONTHLY_EARLY_BIRD",
    title: "B² Monthly Membership",
    badge: "Early Bird Offer",
    original_price_inr: 699,
    price_inr: 1,
    amount_paise: 100,
    duration_days: 30,
    perks: [
        "100% Free Entry to All Club Runs & Weekend Sessions",
        "Official B² Club Member Kit & Running Jersey",
        "Verified Gold Member Badge on Profile & Leaderboard",
        "Exclusive Discounts with Partner Cafes & Physios",
        "Priority Access to Marquee Races & Community Events",
    ],
};

const isRazorpayMock = RAZORPAY_MOCK_MODE || !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET;
const razorpayKeyId = RAZORPAY_KEY_ID ?? "unconfigured";
const razorpay = new Razorpay({
    key_id: razorpayKeyId,
    key_secret: RAZORPAY_KEY_SECRET ?? "unconfigured",
});

/**
 * 1. Public Plan Details
 */
router.get("/plan", (_req, res: Response): void => {
    res.json({
        ok: true,
        plan: MEMBERSHIP_CONFIG,
    });
});

/**
 * 2. User's Membership Status
 */
router.get("/status", requireAccount, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                membership_status: true,
                membership_tier: true,
                membership_expires_at: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const now = new Date();
        const expiresAt = user.membership_expires_at ? new Date(user.membership_expires_at) : null;
        const isActive = user.membership_status === "ACTIVE" && (!expiresAt || expiresAt > now);
        const daysRemaining = expiresAt && isActive ? Math.max(0, Math.ceil((+expiresAt - +now) / (1000 * 60 * 60 * 24))) : 0;

        res.json({
            ok: true,
            membership: {
                is_active: isActive,
                status: isActive ? "ACTIVE" : (user.membership_status === "ACTIVE" ? "EXPIRED" : (user.membership_status || "INACTIVE")),
                tier: user.membership_tier,
                expires_at: user.membership_expires_at,
                days_remaining: daysRemaining,
                plan: MEMBERSHIP_CONFIG,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Could not retrieve membership status" });
    }
});

/**
 * 3. Create Razorpay Order for Membership
 */
router.post("/create-order", requireAccount, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const amountPaise = MEMBERSHIP_CONFIG.amount_paise;
        let razorpayOrderId: string | null = null;

        if (isRazorpayMock) {
            razorpayOrderId = `order_mem_mock_${Math.random().toString(36).substring(2, 11)}`;
        } else {
            const orderOptions = {
                amount: amountPaise,
                currency: "INR",
                receipt: `mem_${userId.slice(0, 8)}_${Date.now()}`,
                payment_capture: 1,
                notes: {
                    userId,
                    type: "MEMBERSHIP",
                    tier: MEMBERSHIP_CONFIG.tier,
                },
            };
            try {
                const order = await (razorpay.orders as any).create(orderOptions);
                razorpayOrderId = (order as any).id;
            } catch (err: any) {
                const detail = err?.error?.description || err?.message || "unknown error";
                res.status(502).json({
                    error: `Could not reach payment gateway: ${detail}`,
                });
                return;
            }
        }

        // Record pending payment
        const paymentRecord = await prisma.membershipPayment.create({
            data: {
                user_id: userId,
                amount_paise: amountPaise,
                tier: MEMBERSHIP_CONFIG.tier,
                razorpay_order_id: razorpayOrderId,
                status: "PENDING",
            },
        });

        res.json({
            ok: true,
            order_id: razorpayOrderId,
            amount_paise: amountPaise,
            currency: "INR",
            razorpay_key_id: isRazorpayMock ? "mock_key_id" : razorpayKeyId,
            mock_mode: isRazorpayMock,
            payment_record_id: paymentRecord.id,
            plan: MEMBERSHIP_CONFIG,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Failed to create membership order" });
    }
});

/**
 * 4. Verify Payment & Activate Membership
 */
router.post("/verify", requireAccount, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};

        if (!razorpay_order_id) {
            res.status(400).json({ error: "razorpay_order_id is required" });
            return;
        }

        // Verify Razorpay signature if not in mock mode
        if (!isRazorpayMock) {
            if (!razorpay_payment_id || !razorpay_signature) {
                res.status(400).json({ error: "razorpay_payment_id and razorpay_signature are required" });
                return;
            }

            const expectedSignature = crypto
                .createHmac("sha256", RAZORPAY_KEY_SECRET!)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest("hex");

            const provided = Buffer.from(String(razorpay_signature));
            const expected = Buffer.from(expectedSignature);

            if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
                res.status(400).json({ error: "Invalid payment signature" });
                return;
            }
        }

        // Calculate 30-day membership validity
        const now = new Date();
        const expiresAt = new Date(+now + MEMBERSHIP_CONFIG.duration_days * 24 * 60 * 60 * 1000);

        // Update payment record
        await prisma.membershipPayment.updateMany({
            where: {
                user_id: userId,
                razorpay_order_id,
            },
            data: {
                status: "PAID",
                razorpay_payment_id: razorpay_payment_id || `pay_mock_${Date.now()}`,
                started_at: now,
                expires_at: expiresAt,
            },
        });

        // Update User account to active MEMBER
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                role: "MEMBER",
                membership_status: "ACTIVE",
                membership_tier: MEMBERSHIP_CONFIG.tier,
                membership_expires_at: expiresAt,
            },
        });

        // Add welcoming notification
        await prisma.notification.create({
            data: {
                user_id: userId,
                message: `🎉 Welcome to B² Run Club Membership! Your Early Bird plan is now active until ${expiresAt.toLocaleDateString("en-IN")}. All event entries are now 100% free!`,
                link: "/profile",
            },
        });

        res.json({
            ok: true,
            message: "Membership activated successfully! You now have free entry to all runs.",
            user: {
                id: updatedUser.id,
                email: updatedUser.email,
                name: updatedUser.name,
                role: updatedUser.role,
                branch: updatedUser.branch,
                membership_status: updatedUser.membership_status,
                membership_tier: updatedUser.membership_tier,
                membership_expires_at: updatedUser.membership_expires_at,
                is_membership_active: true,
            },
            membership: {
                tier: MEMBERSHIP_CONFIG.tier,
                status: "ACTIVE",
                expires_at: expiresAt,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Could not verify membership payment" });
    }
});

/**
 * 5. Admin: Grant or Extend Membership Manually
 */
router.post("/admin/grant", requireRole(["ADMIN"]), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { user_id, days = 30 } = req.body ?? {};
        if (!user_id) {
            res.status(400).json({ error: "user_id is required" });
            return;
        }

        const now = new Date();
        const expiresAt = new Date(+now + Number(days) * 24 * 60 * 60 * 1000);

        const updatedUser = await prisma.user.update({
            where: { id: user_id },
            data: {
                role: "MEMBER",
                membership_status: "ACTIVE",
                membership_tier: MEMBERSHIP_CONFIG.tier,
                membership_expires_at: expiresAt,
            },
        });

        await prisma.membershipPayment.create({
            data: {
                user_id,
                amount_paise: 0,
                tier: "ADMIN_COMPED",
                status: "PAID",
                started_at: now,
                expires_at: expiresAt,
            },
        });

        res.json({
            ok: true,
            message: `Membership granted to ${updatedUser.name} for ${days} days`,
            user: updatedUser,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Failed to grant membership" });
    }
});

export default router;
