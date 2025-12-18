#!/usr/bin/env node
/**
 * Update prices in existing mock data
 * Run this after deploying the fix to add random prices to existing data
 * 
 * Usage: 
 *   1. Set DATABASE_URL environment variable
 *   2. node scripts/update-prices.js
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

async function updatePrices() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    console.log('🔗 Connecting to database...');

    try {
        // Update all rows with random prices between 50,000 and 500,000 VND
        const query = `
            UPDATE orders 
            SET 
                gia_ban = FLOOR(RANDOM() * 450000 + 50000),
                tong_tien_vnd = FLOOR(RANDOM() * 450000 + 50000)
            WHERE gia_ban = 0 OR gia_ban IS NULL OR tong_tien_vnd = 0 OR tong_tien_vnd IS NULL;
        `;

        console.log('📊 Updating prices for all orders with 0 or NULL values...');
        const startTime = Date.now();

        const result = await pool.query(query);

        const duration = Date.now() - startTime;
        console.log(`✅ Updated ${result.rowCount} orders in ${duration}ms`);

        // Verify update
        const verifyQuery = `
            SELECT 
                COUNT(*) as total,
                AVG(gia_ban) as avg_price,
                MIN(gia_ban) as min_price,
                MAX(gia_ban) as max_price
            FROM orders;
        `;

        const verify = await pool.query(verifyQuery);
        const stats = verify.rows[0];

        console.log('\n📈 Statistics after update:');
        console.log(`   Total orders: ${stats.total}`);
        console.log(`   Average price: ${Math.round(stats.avg_price).toLocaleString('vi-VN')} đ`);
        console.log(`   Min price: ${Math.round(stats.min_price).toLocaleString('vi-VN')} đ`);
        console.log(`   Max price: ${Math.round(stats.max_price).toLocaleString('vi-VN')} đ`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
        console.log('\n🔌 Connection closed');
    }
}

updatePrices();
