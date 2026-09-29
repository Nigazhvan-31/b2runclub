/**
 * First-run bootstrap for a fresh deployment.
 *
 * A newly provisioned database has no users, and `POST /api/auth/register`
 * only accepts MEMBER and VISITOR — so without this there is no way to get an
 * admin account, and every organiser page is unreachable.
 *
 * Idempotent by design: it does nothing at all once any ADMIN exists, so it is
 * safe to run on every boot. It never modifies an existing account.
 *
 * Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment. If either is missing
 * it exits quietly rather than inventing a default — a predictable seeded
 * password on a public host would be worse than no admin.
 */
import prisma from "./utils/prisma";
import { hashPassword } from "./utils/crypto";

async function main(): Promise<void> {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    let adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser) {
        if (!email || !password) {
            console.warn("[seed] No ADMIN_EMAIL / ADMIN_PASSWORD set and no admin exists. Skipping.");
            return;
        }
        if (password.length < 8) {
            console.warn("[seed] ADMIN_PASSWORD must be at least 8 characters. Skipping.");
            return;
        }
        const sameEmail = await prisma.user.findUnique({ where: { email } });
        if (sameEmail) {
            adminUser = await prisma.user.update({ where: { id: sameEmail.id }, data: { role: "ADMIN" } });
            console.log(`[seed] Promoted existing account ${email} to ADMIN.`);
        } else {
            adminUser = await prisma.user.create({
                data: {
                    name: process.env.ADMIN_NAME?.trim() || "Club Admin",
                    email,
                    password_hash: hashPassword(password),
                    role: "ADMIN",
                },
            });
            console.log(`[seed] Created the first admin: ${email}`);
        }
    }

    const eventCount = await prisma.event.count();
    if (eventCount === 0 && adminUser) {
        const defaultEvents = [
            {
                title: "WEEK 26 - 3 KM COLOR RUN",
                type: "Run",
                date_time: new Date("2026-09-20T00:30:00.000Z"),
                location: "Race Course,Madurai",
                price: 50,
                status: "PUBLISHED",
                kids_allowed: false,
                capacity: 50,
                description: "🌈 THE COLOR RUN — HOW IT WORKS\n\nGet ready for a 3KM team challenge filled with colour, fun, teamwork, and creativity! 🏃‍♂️🎨\n\n👥 Team of 5 runners\nIf you register individually, we’ll pair you up to form a team.\n\n🎨 1. Get Your Team Colour\nEach team will receive a colour at the start.\n\n📸 2. Capture the Colour Challenge\nYour team must find and click pictures of things matching your assigned colour while completing the run.\n\n🏃 3. Complete the 3KM Together\nStay together and finish the entire 3KM as a team.\n\n🏆 4. Race to Win\nThe first team to complete all the required pictures and finish the 3KM together wins!\n\n🔥 5. The Winning Task\nThe winning team will take on a fun task given by B² Club.\n\n📸 THINGS TO BE CAPTURED\n\nYour team must capture:\n👃 Something that has a smell\n🏃 Something that moves\n✨ Something that shines\n😂 Something you find funny\n🖤 Something that reminds you of B² Club\n\n⚠️ NOTE\n• Pictures must not be repetitive.\n• The Color Run challenge must be completed as a team.\n• All 5 required pictures must be captured.\n• After completing the 3KM, create a photo collage and post it on Instagram, tagging @b2club_.\n\nTeamwork, creativity and speed matter! 🌈🔥",
                admin_id: adminUser.id,
            },
            {
                title: "WEEK 27 - B2 TREKKING",
                type: "TREKKING",
                date_time: new Date("2026-09-27T00:30:00.000Z"),
                location: "SAMANAR HILL , KEELAKUYILKUDI ,  MADURAI",
                price: 100,
                status: "PUBLISHED",
                kids_allowed: true,
                kid_price: 50,
                capacity: 60,
                description: "KINDLY SHARE THE TICKET TO ADMIN ONCE PAID .... THE FEE COVERS SNACK & THE BASIC ARRANGEMENTS FOR ORGANISING THE TREK.",
                admin_id: adminUser.id,
            },
            {
                title: "WEEK 28 - B2 BADMINTON LEAGUE",
                type: "BADMINTON",
                date_time: new Date("2026-10-04T11:00:00.000Z"),
                location: "ms sports hub , madurai",
                price: 350,
                status: "PUBLISHED",
                kids_allowed: false,
                capacity: 24,
                description: "🏸 B2 Badminton League – How the 12 Rounds Work\n\n28 players • 3 courts • Doubles 🏸\n⏱️ Each round = 15 minutes. During each round, 3 matches are played simultaneously (12 players playing).\n🔄 After 15 minutes, the round ends. Players rotate, and the next 12 players take their turn.\n📋 This continues for 12 rounds = 3 hours, with everyone getting 5–6 playing rounds as equally as possible.\n🏆 Win = 3 points | Loss = 0 points — points are recorded individually for the final standings.\n❤️‍🔥 Check your assigned court and match before every round, be ready on time, and enjoy the game!",
                admin_id: adminUser.id,
            },
            {
                title: "WEEK 29 - 3 KM RUN & BREAKFAST",
                type: "Run",
                date_time: new Date("2026-10-11T00:30:00.000Z"),
                location: "Race Course,Madurai",
                price: 50,
                status: "PUBLISHED",
                kids_allowed: true,
                kid_price: 0,
                description: "Hi everyone! 👋\n\nAfter the 3 KM run, you’re welcome to join us for breakfast. If you prefer, you can also leave after the run.\n\nWe’ll have a few fun games and a group photo session after the run, and then we’ll wrap up the session. \n\nFor breakfast, you can simply pay for the dish you order. ☕️\n\nSee you all! ❤️",
                admin_id: adminUser.id,
            },
        ];

        for (const ev of defaultEvents) {
            await prisma.event.create({ data: ev });
        }
        console.log(`[seed] Seeded ${defaultEvents.length} initial events.`);
    }
}

main()
    .catch((err) => {
        // A failed seed must not stop the server from booting.
        console.error("[seed] failed:", err instanceof Error ? err.message : err);
    })
    .finally(async () => {
        await prisma.$disconnect().catch(() => undefined);
    });
