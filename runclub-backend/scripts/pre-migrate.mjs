import pg from "pg";

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString || connectionString.startsWith("file:")) {
    console.log("[pre-migrate] Local SQLite or no remote database URL found. Skipping pre-migrate.");
    return;
  }

  console.log("[pre-migrate] Checking target database for migration ordering updates...");

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Check if _prisma_migrations table exists
    const res = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations'
      );
    `);

    if (!res.rows[0]?.exists) {
      console.log("[pre-migrate] _prisma_migrations table does not exist yet. Fresh database.");
      return;
    }

    // 1. Delete any failed migrations (where finished_at is NULL) so prisma migrate deploy doesn't fail with P3009
    const failedRes = await client.query(`
      DELETE FROM _prisma_migrations 
      WHERE finished_at IS NULL
      RETURNING migration_name;
    `);
    if (failedRes.rowCount > 0) {
      console.log(`[pre-migrate] Cleaned up ${failedRes.rowCount} failed migration record(s):`, failedRes.rows.map((r) => r.migration_name));
    }

    // 2. Also delete any recorded attempt of 10_participant_details_and_holds if it exists,
    // to ensure it runs in its correct order after 08_party_booking and 09_party_discount
    const tenRes = await client.query(`
      DELETE FROM _prisma_migrations 
      WHERE migration_name = '10_participant_details_and_holds'
      RETURNING migration_name;
    `);
    if (tenRes.rowCount > 0) {
      console.log("[pre-migrate] Reset 10_participant_details_and_holds record to allow re-running in correct order.");
    }

    // 3. Update single-digit migration names (0_init -> 00_init, 1_... -> 01_...) to match the zero-padded folder names
    const renameRes = await client.query(`
      UPDATE _prisma_migrations 
      SET migration_name = '0' || migration_name 
      WHERE migration_name ~ '^[0-9]_'
      RETURNING migration_name;
    `);
    if (renameRes.rowCount > 0) {
      console.log(`[pre-migrate] Renamed ${renameRes.rowCount} migration record(s) to zero-padded format:`, renameRes.rows.map((r) => r.migration_name));
    }

    console.log("[pre-migrate] Target database is ready for prisma migrate deploy.");
  } catch (err) {
    console.warn("[pre-migrate] Warning: unable to check/update _prisma_migrations:", err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
