import pg from 'pg';

const { Pool } = pg;

/**
 * PostgreSQL Database Service
 * Handles connection pooling and CRUD operations for orders
 */
class DatabaseService {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection pool
     */
    async connect() {
        if (this.pool && this.isConnected) {
            return this.pool;
        }

        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
            console.warn('⚠️ DATABASE_URL not configured, database features disabled');
            return null;
        }

        try {
            this.pool = new Pool({
                connectionString: databaseUrl,
                ssl: {
                    rejectUnauthorized: false // Required for Supabase/Neon
                },
                max: 10, // Maximum pool connections
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000
            });

            // Test connection
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();

            this.isConnected = true;
            console.log('✅ PostgreSQL connected');

            return this.pool;
        } catch (error) {
            console.error('❌ PostgreSQL connection failed:', error.message);
            this.isConnected = false;
            return null;
        }
    }

    /**
     * Check if database is available
     */
    isAvailable() {
        return this.isConnected && this.pool !== null;
    }

    /**
     * Execute a query
     */
    async query(text, params = []) {
        if (!this.isAvailable()) {
            await this.connect();
        }

        if (!this.pool) {
            throw new Error('Database not connected');
        }

        const start = Date.now();
        const result = await this.pool.query(text, params);
        const duration = Date.now() - start;

        console.log(`📊 Query (${duration}ms): ${text.substring(0, 50)}...`);
        return result;
    }

    /**
     * Get all orders with pagination
     */
    async getAllOrders(options = {}) {
        const { limit = 100, offset = 0, orderBy = 'updated_at', orderDir = 'DESC' } = options;

        const result = await this.query(
            `SELECT * FROM orders ORDER BY ${orderBy} ${orderDir} LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        return result.rows;
    }

    /**
     * Get order by primary key (ma_don_hang)
     */
    async getOrderByMaDonHang(maDonHang) {
        const result = await this.query(
            'SELECT * FROM orders WHERE ma_don_hang = $1',
            [maDonHang]
        );
        return result.rows[0] || null;
    }

    /**
     * Get orders updated since timestamp
     */
    async getOrdersUpdatedSince(timestamp) {
        const result = await this.query(
            'SELECT * FROM orders WHERE updated_at > $1 ORDER BY updated_at ASC',
            [new Date(timestamp)]
        );
        return result.rows;
    }

    /**
     * Get total count
     */
    async getOrdersCount() {
        const result = await this.query('SELECT COUNT(*) as count FROM orders');
        return parseInt(result.rows[0].count);
    }

    /**
     * Insert or update order (upsert)
     */
    async upsertOrder(orderData) {
        const columns = Object.keys(orderData);
        const values = Object.values(orderData);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        // Build UPDATE clause for conflict
        const updateClause = columns
            .filter(col => col !== 'ma_don_hang')
            .map(col => `${col} = EXCLUDED.${col}`)
            .join(', ');

        const query = `
      INSERT INTO orders (${columns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (ma_don_hang) 
      DO UPDATE SET ${updateClause}, updated_at = NOW()
      RETURNING *
    `;

        const result = await this.query(query, values);
        return result.rows[0];
    }

    /**
     * Bulk upsert orders
     */
    async bulkUpsertOrders(ordersArray) {
        if (!ordersArray || ordersArray.length === 0) return [];

        const results = [];

        // Use transaction for bulk operations
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const order of ordersArray) {
                const result = await this.upsertOrder(order);
                results.push(result);
            }

            await client.query('COMMIT');
            console.log(`✅ Bulk upserted ${results.length} orders`);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        return results;
    }

    /**
     * Delete order
     */
    async deleteOrder(maDonHang) {
        const result = await this.query(
            'DELETE FROM orders WHERE ma_don_hang = $1 RETURNING *',
            [maDonHang]
        );
        return result.rows[0] || null;
    }

    /**
     * Initialize database schema
     */
    async initializeSchema() {
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        ma_don_hang VARCHAR(50) UNIQUE NOT NULL,
        ma_tracking VARCHAR(100),
        ngay_len_don DATE,
        name VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        zipcode VARCHAR(20),
        mat_hang TEXT,
        ten_mat_hang_1 VARCHAR(255),
        so_luong_mat_hang_1 INTEGER DEFAULT 0,
        ten_mat_hang_2 VARCHAR(255),
        so_luong_mat_hang_2 INTEGER DEFAULT 0,
        qua_tang VARCHAR(255),
        so_luong_qua_kem INTEGER DEFAULT 0,
        gia_ban NUMERIC(15,2) DEFAULT 0,
        loai_tien_thanh_toan VARCHAR(20),
        tong_tien_vnd NUMERIC(15,2) DEFAULT 0,
        hinh_thuc_thanh_toan VARCHAR(50),
        ghi_chu TEXT,
        nhan_vien_sale VARCHAR(100),
        nhan_vien_marketing VARCHAR(100),
        nv_van_don VARCHAR(100),
        ket_qua_check VARCHAR(50),
        trang_thai_giao_hang_nb VARCHAR(50),
        ly_do TEXT,
        don_vi_van_chuyen VARCHAR(100),
        trang_thai_thu_tien VARCHAR(50),
        ngay_hen_day_don DATE,
        so_tien_thuc_thu NUMERIC(15,2) DEFAULT 0,
        anh_bill TEXT,
        khu_vuc VARCHAR(100),
        team VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(trang_thai_giao_hang_nb);
      CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(ngay_len_don);
      CREATE INDEX IF NOT EXISTS idx_orders_updated ON orders(updated_at);
      CREATE INDEX IF NOT EXISTS idx_orders_employee ON orders(nhan_vien_sale);
    `;

        await this.query(createTableQuery);
        console.log('✅ Database schema initialized');
    }

    /**
     * Close connection pool
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            console.log('🔌 PostgreSQL connection closed');
        }
    }
}

// Export singleton instance
export default new DatabaseService();
