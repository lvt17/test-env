#!/usr/bin/env node
/**
 * Normalize Existing DB Data via Backend API
 * Fetches all data, normalizes status values, and updates via API
 * 
 * Usage: node scripts/normalize-db-data.js
 */

const BACKEND_URL = 'https://test-env.vercel.app';

// Status display values (from backend after normalization)
const STATUS_DISPLAY = {
    'Kết quả Check': {
        'ok': 'OK', 'huỷ': 'Huỷ', 'treo': 'Treo',
        'vận đơn xl': 'Vận đơn XL', 'đợi hàng': 'Đợi hàng', 'khách hẹn': 'Khách hẹn'
    },
    'Trạng thái giao hàng NB': {
        'giao thành công': 'Giao Thành Công', 'đang giao': 'Đang Giao',
        'chưa giao': 'Chưa Giao', 'huỷ': 'Huỷ', 'hoàn': 'Hoàn', 'chờ check': 'Chờ Check',
        'giao không thành công': 'Giao không thành công', 'bom_thất lạc': 'Bom_Thất Lạc'
    }
};

/**
 * Normalize value to lowercase + NFC
 */
function normalizeStatus(value) {
    if (!value || typeof value !== 'string') return '';
    return value.normalize('NFC').toLowerCase().trim();
}

async function main() {
    console.log('🔄 Starting data normalization...\n');

    try {
        // Fetch all data from backend
        console.log('📥 Fetching all data from backend...');
        const response = await fetch(`${BACKEND_URL}/sync/db-data?page=1&limit=10000`);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        const data = result.data || [];
        console.log(`📊 Found ${data.length} rows\n`);

        let needsUpdate = 0;
        let alreadyNormalized = 0;
        const updates = [];

        for (const row of data) {
            const maDonHang = row['Mã đơn hàng'];
            if (!maDonHang) continue;

            const changes = {};
            let hasChanges = false;

            // Check "Kết quả Check"
            const ketQuaCheck = row['Kết quả Check'];
            if (ketQuaCheck) {
                const normalized = normalizeStatus(ketQuaCheck);
                const display = STATUS_DISPLAY['Kết quả Check'][normalized];
                if (display && display !== ketQuaCheck) {
                    changes['Kết quả Check'] = display;
                    hasChanges = true;
                }
            }

            // Check "Trạng thái giao hàng NB"
            const trangThai = row['Trạng thái giao hàng NB'];
            if (trangThai) {
                const normalized = normalizeStatus(trangThai);
                const display = STATUS_DISPLAY['Trạng thái giao hàng NB'][normalized];
                if (display && display !== trangThai) {
                    changes['Trạng thái giao hàng NB'] = display;
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                needsUpdate++;
                updates.push({ maDonHang, changes });
                console.log(`   ${maDonHang}: ${JSON.stringify(changes)}`);
            } else {
                alreadyNormalized++;
            }
        }

        console.log('\n========================================');
        console.log(`📊 Summary:`);
        console.log(`   Already normalized: ${alreadyNormalized} rows`);
        console.log(`   Needs update: ${needsUpdate} rows`);
        console.log('========================================');

        if (needsUpdate === 0) {
            console.log('\n✅ All data is already normalized!');
            return;
        }

        console.log('\n⚠️  Note: Updates would need to be done via database directly');
        console.log('The backend will auto-normalize incoming data from now on.');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
