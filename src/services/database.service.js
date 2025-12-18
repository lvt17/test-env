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
     * Includes protection against stale updates from Sheet
     */
    async upsertOrder(orderData) {
        const columns = Object.keys(orderData);
        const values = Object.values(orderData);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        const isFromSheet = orderData._source === 'sheet' || columns.includes('trang_thai_giao_hang_nb'); // Webhooks often send this

        // Build UPDATE clause for conflict
        const updateClause = columns
            .filter(col => col !== 'ma_don_hang' && !col.startsWith('_'))
            .map(col => `${col} = EXCLUDED.${col}`)
            .join(', ');

        // Logic: Only update if the incoming data is newer (if source is sheet)
        // For web updates, we usually trust them as "now"
        const conflictCondition = isFromSheet
            ? 'WHERE orders.updated_at <= EXCLUDED.updated_at OR EXCLUDED.updated_at IS NULL'
            : '';

        const query = `
      INSERT INTO orders (${columns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (ma_don_hang) 
      DO UPDATE SET 
        ${updateClause}, 
        updated_at = CASE 
          WHEN EXCLUDED.updated_at IS NOT NULL THEN EXCLUDED.updated_at
          ELSE NOW()
        END
      ${conflictCondition}
      RETURNING *
    `;

        const result = await this.query(query, values);
        return result.rows[0];
    }

    /**
     * TRUE Bulk upsert - Single query for all orders (100x faster)
     */
    async bulkUpsertOrders(ordersArray) {
        if (!ordersArray || ordersArray.length === 0) return { inserted: 0 };

        const client = await this.pool.connect();
        const startTime = Date.now();

        try {
            await client.query('BEGIN');

            // Define columns we're inserting (including price fields)
            const columns = ['ma_don_hang', 'ma_tracking', 'ngay_len_don', 'name', 'phone',
                'address', 'city', 'state', 'mat_hang', 'ten_mat_hang_1', 'so_luong_mat_hang_1',
                'ket_qua_check', 'trang_thai_giao_hang_nb', 'ly_do', 'trang_thai_thu_tien',
                'gia_ban', 'tong_tien_vnd', 'khu_vuc', 'team'];

            // Build VALUES clause
            const valueRows = [];
            const params = [];
            let paramIndex = 1;

            for (const order of ordersArray) {
                const rowPlaceholders = [];
                for (const col of columns) {
                    params.push(order[col] ?? null);
                    rowPlaceholders.push(`$${paramIndex++}`);
                }
                valueRows.push(`(${rowPlaceholders.join(', ')})`);
            }

            // Build UPDATE clause for conflict
            const updateClause = columns
                .filter(col => col !== 'ma_don_hang')
                .map(col => `${col} = EXCLUDED.${col}`)
                .join(', ');

            const query = `
                INSERT INTO orders (${columns.join(', ')})
                VALUES ${valueRows.join(', ')}
                ON CONFLICT (ma_don_hang) 
                DO UPDATE SET ${updateClause}, updated_at = NOW()
            `;

            await client.query(query, params);
            await client.query('COMMIT');

            const duration = Date.now() - startTime;
            console.log(`✅ Bulk inserted ${ordersArray.length} orders in ${duration}ms`);

            return { inserted: ordersArray.length, duration: `${duration}ms` };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Bulk insert failed:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get orders with pagination and total count
     */
    async getAllOrdersPaginated(options = {}) {
        const {
            page = 1,
            limit = 40,
            sortBy = 'id',
            order = 'asc',
            status = null
        } = options;

        const offset = (page - 1) * limit;
        const validOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        const validSortBy = ['id', 'ma_don_hang', 'ngay_len_don', 'updated_at', 'trang_thai_giao_hang_nb']
            .includes(sortBy) ? sortBy : 'id';

        // Build WHERE clause
        let whereClause = '';
        const params = [limit, offset];

        if (status) {
            whereClause = 'WHERE trang_thai_giao_hang_nb = $3';
            params.push(status);
        }

        // Parallel query for data and count
        const [dataResult, countResult] = await Promise.all([
            this.query(
                `SELECT * FROM orders ${whereClause} ORDER BY ${validSortBy} ${validOrder} LIMIT $1 OFFSET $2`,
                params
            ),
            this.query(`SELECT COUNT(*) as count FROM orders ${whereClause ? `WHERE trang_thai_giao_hang_nb = $1` : ''}`,
                status ? [status] : [])
        ]);

        const total = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        return {
            data: dataResult.rows,
            meta: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        };
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
