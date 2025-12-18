#!/usr/bin/env node
/**
 * Normalize Existing DB Data
 * Converts all status values to lowercase + NFC Unicode
 * 
 * Usage: node scripts/normalize-db-data.js
 */

import pg from 'pg';
const { Pool } = pg;

// Status columns to normalize
const STATUS_COLUMNS = [
    'ket_qua_check',
    'trang_thai_giao_hang_nb',
    'trang_thai_thu_tien'
];

// Use same connection string as app
const DATABASE_URL = process.env.DATABASE_URL ||
    'postgresql://postgres.zntqqwpbwmhfnqvnwrny:tpKAZsMCNWZGzIbR@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

/**
 * Normalize value to lowercase + NFC
 */
function normalizeStatus(value) {
    if (!value || typeof value !== 'string') return value;
    return value.normalize('NFC').toLowerCase().trim();
}

async function main() {
    console.log('🔄 Starting DB data normalization...\n');

    try {
        const client = await pool.connect();
        console.log('✅ Connected to database\n');

        // Get all rows
        const result = await client.query('SELECT id, ket_qua_check, trang_thai_giao_hang_nb, trang_thai_thu_tien FROM orders');
        console.log(`📊 Found ${result.rows.length} rows\n`);

        let updated = 0;
        let skipped = 0;

        for (const row of result.rows) {
            const updates = {};
            let hasChanges = false;

            for (const col of STATUS_COLUMNS) {
                const originalValue = row[col];
                const normalizedValue = normalizeStatus(originalValue);

                if (originalValue && normalizedValue !== originalValue) {
                    updates[col] = normalizedValue;
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                // Build UPDATE query
                const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 2}`);
                const values = [row.id, ...Object.values(updates)];

                await client.query(
                    `UPDATE orders SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
                    values
                );

                updated++;
                console.log(`✅ Row ${row.id}: ${JSON.stringify(updates)}`);
            } else {
                skipped++;
            }
        }

        client.release();

        console.log('\n========================================');
        console.log(`✅ Normalization complete!`);
        console.log(`   Updated: ${updated} rows`);
        console.log(`   Skipped: ${skipped} rows (already normalized)`);
        console.log('========================================');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
