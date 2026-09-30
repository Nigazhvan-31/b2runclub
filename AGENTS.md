# B² Club — Project Guidelines & Architecture

This repository contains the full source code for B² Club, a running club membership and event platform in Madurai, India.

## 1. Project Overview & Architecture
The system consists of two integrated applications:
- **Frontend** (`runclub-frontend/`): React 19, Vite, Tailwind 4, React Router, Framer Motion, GSAP, three.js / react-three-fiber, jsQR. Proxies `/api`, `/uploads`, and `/health` to backend.
- **Backend** (`runclub-backend/`): Express 5, TypeScript, Prisma 7, Supabase Postgres (`@prisma/adapter-pg`), Nodemailer, Razorpay, ExcelJS.

## 2. Live Environments & Custom Domain
- **Live Site**: `https://www.b2club.in` (redirects from `https://b2club.in`)
- **Backend Service**: `https://b2runclub-backend-rho.vercel.app`
- **Database**: Supabase PostgreSQL (`db.<ref>.supabase.co`)
- **File Storage**: Supabase Storage (`uploads` bucket)
- **Admin Email**: `burnandbond.club@gmail.com`

## 3. Local Development (SQLite)
Local development runs on SQLite with `@prisma/adapter-libsql`:
```bash
# Backend (http://localhost:3000)
cd runclub-backend
npm run dev

# Frontend (http://localhost:5173)
cd runclub-frontend
npm run dev
```

> **Note on Prisma Client**:
> Running `npm run build` or `prisma generate` regenerates the Prisma client for Postgres. Run `npm run generate:local` afterwards to restore the SQLite client for local development.

## 4. Database Migrations
Migrations are located in `runclub-backend/prisma/migrations/` using zero-padded numeric prefixes:
`00_init`, `01_event_cover`, ..., `08_party_booking`, `09_party_discount`, `10_participant_details_and_holds`.
- When deploying to production on Vercel, `node scripts/pre-migrate.mjs` automatically reconciles migration records before `npx prisma migrate deploy` executes.

## 5. Automated Tests
```bash
cd runclub-backend
node scripts/api-test-suite.mjs
```
