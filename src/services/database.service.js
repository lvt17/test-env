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
    async upsertOrder(orderData, context = {}) {
        // Filter out internal fields and invalid column names (containing . or special chars)
        const validColumns = Object.keys(orderData).filter(col =>
            !col.startsWith('_') &&
            /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col) // Only valid SQL identifiers
        );

        if (validColumns.length === 0) {
            console.warn('⚠️ upsertOrder: No valid columns to insert');
            return null;
        }

        const columns = validColumns;
        const values = columns.map(col => orderData[col]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        const source = context.source || 'web';
        const isFromSheet = source === 'sheet';

        // Build UPDATE clause for conflict (escape column names with double quotes)
        const updateColumns = columns.filter(col => col !== 'ma_don_hang');

        if (updateColumns.length === 0) {
            console.warn('⚠️ upsertOrder: No columns to update (only primary key)');
            return null;
        }

        const updateClause = updateColumns
            .map(col => `"${col}" = EXCLUDED."${col}"`)
            .join(', ');

        // Escape column names in INSERT
        const escapedColumns = columns.map(col => `"${col}"`).join(', ');

        // For web updates: ALWAYS execute (user intent is king)
        // For sheet updates: Only if timestamp is newer (prevent stale data)
        let query;
        if (isFromSheet) {
            query = `
        INSERT INTO orders (${escapedColumns})
        VALUES (${placeholders})
        ON CONFLICT (ma_don_hang) 
        DO UPDATE SET 
          ${updateClause}, 
          updated_at = NOW()
        WHERE orders.updated_at <= EXCLUDED.updated_at OR EXCLUDED.updated_at IS NULL
        RETURNING *
      `;
        } else {
            // Web updates: ALWAYS execute, no WHERE clause
            query = `
        INSERT INTO orders (${escapedColumns})
        VALUES (${placeholders})
        ON CONFLICT (ma_don_hang) 
        DO UPDATE SET 
          ${updateClause}, 
          updated_at = NOW()
        RETURNING *
      `;
        }

        try {
            const result = await this.query(query, values);
            return result.rows[0];
        } catch (err) {
            console.error('❌ upsertOrder SQL error:', err.message);
            console.error('Query:', query.substring(0, 200));
            console.error('Columns:', columns);
            throw err;
        }
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
        ghi_chu_vd TEXT,
        ngay_hen_day_don DATE,
        so_tien_thuc_thu NUMERIC(15,2) DEFAULT 0,
        anh_bill TEXT,
        khu_vuc VARCHAR(100),
        team VARCHAR(100),
        ngay_dong_hang DATE,
        trang_thai_giao_hang VARCHAR(50),
        thoi_gian_giao_du_kien DATE,
        phi_ship_noi_dia_my NUMERIC(15,2) DEFAULT 0,
        phi_xu_ly_don NUMERIC(15,2) DEFAULT 0,
        ghi_chu_chung TEXT,
        so_tien_ve_tk NUMERIC(15,2) DEFAULT 0,
        ke_toan_xac_nhan VARCHAR(100),
        ngay_doi_soat DATE,
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

        // Add missing columns to existing table (for tables created before schema update)
        const addColumnsQuery = `
      DO $$ 
      BEGIN 
        -- Add ghi_chu_vd if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ghi_chu_vd') THEN
          ALTER TABLE orders ADD COLUMN ghi_chu_vd TEXT;
        END IF;
        
        -- Add ngay_dong_hang if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ngay_dong_hang') THEN
          ALTER TABLE orders ADD COLUMN ngay_dong_hang DATE;
        END IF;
        
        -- Add trang_thai_giao_hang if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='trang_thai_giao_hang') THEN
          ALTER TABLE orders ADD COLUMN trang_thai_giao_hang VARCHAR(50);
        END IF;
        
        -- Add thoi_gian_giao_du_kien if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='thoi_gian_giao_du_kien') THEN
          ALTER TABLE orders ADD COLUMN thoi_gian_giao_du_kien DATE;
        END IF;
        
        -- Add phi_ship_noi_dia_my if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='phi_ship_noi_dia_my') THEN
          ALTER TABLE orders ADD COLUMN phi_ship_noi_dia_my NUMERIC(15,2) DEFAULT 0;
        END IF;
        
        -- Add phi_xu_ly_don if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='phi_xu_ly_don') THEN
          ALTER TABLE orders ADD COLUMN phi_xu_ly_don NUMERIC(15,2) DEFAULT 0;
        END IF;
        
        -- Add ghi_chu_chung if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ghi_chu_chung') THEN
          ALTER TABLE orders ADD COLUMN ghi_chu_chung TEXT;
        END IF;
        
        -- Add so_tien_ve_tk if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='so_tien_ve_tk') THEN
          ALTER TABLE orders ADD COLUMN so_tien_ve_tk NUMERIC(15,2) DEFAULT 0;
        END IF;
        
        -- Add ke_toan_xac_nhan if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ke_toan_xac_nhan') THEN
          ALTER TABLE orders ADD COLUMN ke_toan_xac_nhan VARCHAR(100);
        END IF;
        
        -- Add ngay_doi_soat if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='ngay_doi_soat') THEN
          ALTER TABLE orders ADD COLUMN ngay_doi_soat DATE;
        END IF;
      END $$;
    `;

        try {
            await this.query(addColumnsQuery);
            console.log('✅ Database schema migrated - all columns added');
        } catch (err) {
            console.warn('⚠️ Migration warning:', err.message);
        }

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
