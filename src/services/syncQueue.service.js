import fastq from 'fastq';

/**
 * SyncQueueService - In-memory queue for serializing updates
 * Prevents race conditions by processing updates one at a time
 */
class SyncQueueService {
    constructor() {
        // Version tracking: primaryKey -> { timestamp, hash }
        this.versionMap = new Map();

        // Last change timestamp per sheet
        this.lastChangeTimestamp = new Map();

        // Pending changes buffer for polling
        this.pendingChanges = new Map(); // sheetName -> [changes]

        // Create queue with concurrency 1 (serialized)
        this.queue = fastq.promise(this, this.processUpdate.bind(this), 1);

        // Stats
        this.stats = {
            processed: 0,
            conflicts: 0,
            errors: 0
        };

        console.log('✅ SyncQueueService initialized with in-memory queue');
    }

    /**
     * Enqueue an update operation
     * @param {Object} task - { sheetName, updateData, clientVersion, resolve, reject }
     */
    async enqueue(sheetName, updateData, clientVersion = null) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                sheetName,
                updateData,
                clientVersion,
                resolve,
                reject,
                enqueuedAt: Date.now()
            });
        });
    }

    /**
     * Worker function - processes one update at a time
     */
    async processUpdate(task) {
        const { sheetName, updateData, clientVersion, resolve, reject, enqueuedAt } = task;

        try {
            const primaryKey = this.getPrimaryKey(updateData);
            const serverVersion = this.getVersion(sheetName, primaryKey);

            // Check for conflict
            if (clientVersion && serverVersion > clientVersion) {
                this.stats.conflicts++;
                resolve({
                    success: false,
                    conflict: true,
                    serverVersion,
                    message: 'Data đã được cập nhật bởi người khác'
                });
                return;
            }

            // Update version map
            const newVersion = Date.now();
            this.setVersion(sheetName, primaryKey, newVersion);

            // Add to pending changes for polling
            this.addPendingChange(sheetName, {
                ...updateData,
                _version: newVersion,
                _updatedAt: new Date().toISOString()
            });

            this.stats.processed++;

            resolve({
                success: true,
                serverVersion: newVersion,
                queueTime: Date.now() - enqueuedAt
            });

        } catch (error) {
            this.stats.errors++;
            reject(error);
        }
    }

    /**
     * Get primary key from update data (assumes first key is primary)
     */
    getPrimaryKey(updateData) {
        const keys = Object.keys(updateData);
        if (keys.length === 0) return 'unknown';

        // Common primary key names
        const primaryKeyNames = ['MaVanDon', 'id', 'ID', 'primaryKey', 'key'];
        for (const name of primaryKeyNames) {
            if (updateData[name]) return `${name}:${updateData[name]}`;
        }

        return `${keys[0]}:${updateData[keys[0]]}`;
    }

    /**
     * Get version for a specific row
     */
    getVersion(sheetName, primaryKey) {
        const key = `${sheetName}:${primaryKey}`;
        return this.versionMap.get(key) || 0;
    }

    /**
     * Set version for a specific row
     */
    setVersion(sheetName, primaryKey, version) {
        const key = `${sheetName}:${primaryKey}`;
        this.versionMap.set(key, version);
        this.lastChangeTimestamp.set(sheetName, version);
    }

    /**
     * Add change to pending buffer (for polling)
     */
    addPendingChange(sheetName, change) {
        if (!this.pendingChanges.has(sheetName)) {
            this.pendingChanges.set(sheetName, []);
        }

        const changes = this.pendingChanges.get(sheetName);

        // Keep only last 100 changes per sheet (memory limit)
        if (changes.length >= 100) {
            changes.shift();
        }

        changes.push(change);
    }

    /**
     * Get changes since a specific timestamp (for polling)
     */
    getChangesSince(sheetName, sinceTimestamp) {
        const changes = this.pendingChanges.get(sheetName) || [];
        return changes.filter(c => c._version > sinceTimestamp);
    }

    /**
     * Get last change timestamp for a sheet
     */
    getLastChangeTimestamp(sheetName) {
        return this.lastChangeTimestamp.get(sheetName) || 0;
    }

    /**
     * Record external change (from webhook)
     */
    recordExternalChange(sheetName, changeData) {
        const primaryKey = this.getPrimaryKey(changeData);
        const version = Date.now();

        this.setVersion(sheetName, primaryKey, version);
        this.addPendingChange(sheetName, {
            ...changeData,
            _version: version,
            _updatedAt: new Date().toISOString(),
            _external: true
        });

        return version;
    }

    /**
     * Get queue stats
     */
    getStats() {
        return {
            ...this.stats,
            queueLength: this.queue.length(),
            trackedRows: this.versionMap.size,
            pendingChangesCount: Array.from(this.pendingChanges.values())
                .reduce((sum, arr) => sum + arr.length, 0)
        };
    }

    /**
     * Clear old pending changes (cleanup)
     */
    cleanup(maxAgeMs = 300000) { // 5 minutes default
        const cutoff = Date.now() - maxAgeMs;

        for (const [sheetName, changes] of this.pendingChanges.entries()) {
            const filtered = changes.filter(c => c._version > cutoff);
            this.pendingChanges.set(sheetName, filtered);
        }
    }
}

// Singleton instance
const syncQueueService = new SyncQueueService();

// Cleanup old changes every 5 minutes
setInterval(() => {
    syncQueueService.cleanup();
}, 300000);

export default syncQueueService;
