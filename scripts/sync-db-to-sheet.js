#!/usr/bin/env node
/**
 * Sync DB → Sheet via Backend API
 * Uses deployed backend (has valid credentials)
 * 
 * Usage: node scripts/sync-db-to-sheet.js
 */

const BACKEND_URL = 'https://test-env.vercel.app';
const SHEET_NAME = 'F3';
const BATCH_SIZE = 50; // Rows per API call
const DELAY_MS = 1500; // Delay between batches (rate limit)

async function fetchAllFromDB() {
    console.log('📊 Fetching all data from PostgreSQL...');

    let allData = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const url = `${BACKEND_URL}/sync/db-data?page=${page}&limit=500&sortBy=id&order=asc`;
        const response = await fetch(url);
        const json = await response.json();

        if (!json.success) throw new Error(json.message);

        const rows = json.data || [];
        if (rows.length === 0) {
            hasMore = false;
        } else {
            allData = allData.concat(rows);
            console.log(`   Page ${page}: ${rows.length} rows (Total: ${allData.length})`);
            page++;
        }

        await new Promise(r => setTimeout(r, 200));
    }

    return allData;
}

async function addRowsToSheet(rows) {
    const url = `${BACKEND_URL}/sheet/${SHEET_NAME}/rows/batch`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
    });

    const json = await response.json();
    return json;
}

async function main() {
    console.log('🚀 Sync DB → Sheet (via Backend API)\n');
    console.log('========================================\n');

    try {
        // 1. Fetch all from DB
        const dbData = await fetchAllFromDB();
        console.log(`\n📦 Total DB rows: ${dbData.length}`);

        // 2. Skip first 10 (already in Sheet)
        const newRows = dbData.slice(10);
        console.log(`📦 New rows to sync: ${newRows.length}\n`);

        if (newRows.length === 0) {
            console.log('⏭️ No new rows to sync!');
            return;
        }

        // 3. Sync in batches
        let synced = 0;
        let failed = 0;
        const totalBatches = Math.ceil(newRows.length / BATCH_SIZE);

        for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
            const batch = newRows.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;

            try {
                const result = await addRowsToSheet(batch);

                if (result.success) {
                    synced += result.summary?.added || batch.length;
                    console.log(`✅ Batch ${batchNum}/${totalBatches}: +${result.summary?.added || batch.length} (Total: ${synced})`);
                } else {
                    failed += batch.length;
                    console.log(`❌ Batch ${batchNum}: ${result.message}`);
                }
            } catch (err) {
                failed += batch.length;
                console.error(`❌ Batch ${batchNum} error:`, err.message);
            }

            // Rate limit
            await new Promise(r => setTimeout(r, DELAY_MS));
        }

        console.log('\n========================================');
        console.log(`✅ Sync complete!`);
        console.log(`   Added: ${synced} rows`);
        console.log(`   Failed: ${failed} rows`);
        console.log('========================================');

    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

main();
