/**
 * SSE Controller - Server-Sent Events for real-time sync
 * Manages client connections and broadcasts changes instantly
 */

class SSEController {
    constructor() {
        // Map of sheetName -> Set of client responses
        this.clients = new Map();

        // Stats
        this.stats = {
            totalConnections: 0,
            activeConnections: 0,
            messagesSent: 0
        };

        console.log('✅ SSE Controller initialized');
    }

    /**
     * Subscribe to SSE events for a specific sheet
     * GET /sse/subscribe/:sheetName
     */
    subscribe = (req, res) => {
        const { sheetName } = req.params;

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

        // Send initial connection event
        res.write(`event: connected\n`);
        res.write(`data: ${JSON.stringify({
            message: 'SSE connected',
            sheetName,
            timestamp: Date.now()
        })}\n\n`);

        // Add client to the set
        this.addClient(sheetName, res);

        // Keep connection alive with heartbeat every 30 seconds
        const heartbeatInterval = setInterval(() => {
            res.write(`:heartbeat\n\n`);
        }, 30000);

        // Handle client disconnect
        req.on('close', () => {
            clearInterval(heartbeatInterval);
            this.removeClient(sheetName, res);
            console.log(`📤 SSE client disconnected from ${sheetName}`);
        });

        console.log(`📥 SSE client connected to ${sheetName} (${this.getClientCount(sheetName)} clients)`);
    }

    /**
     * Add a client to the subscribers list
     */
    addClient(sheetName, res) {
        if (!this.clients.has(sheetName)) {
            this.clients.set(sheetName, new Set());
        }
        this.clients.get(sheetName).add(res);
        this.stats.totalConnections++;
        this.stats.activeConnections++;
    }

    /**
     * Remove a client from the subscribers list
     */
    removeClient(sheetName, res) {
        const clientSet = this.clients.get(sheetName);
        if (clientSet) {
            clientSet.delete(res);
            this.stats.activeConnections--;

            // Clean up empty sets
            if (clientSet.size === 0) {
                this.clients.delete(sheetName);
            }
        }
    }

    /**
     * Broadcast a change to all connected clients for a sheet
     */
    broadcast(sheetName, data) {
        const clientSet = this.clients.get(sheetName);

        if (!clientSet || clientSet.size === 0) {
            console.log(`📭 No SSE clients for ${sheetName}`);
            return 0;
        }

        const eventData = JSON.stringify({
            ...data,
            _sseTimestamp: Date.now()
        });

        let successCount = 0;
        const deadClients = [];

        clientSet.forEach(client => {
            try {
                client.write(`event: change\n`);
                client.write(`data: ${eventData}\n\n`);
                successCount++;
                this.stats.messagesSent++;
            } catch (error) {
                console.error('SSE write error:', error.message);
                deadClients.push(client);
            }
        });

        // Clean up dead clients
        deadClients.forEach(client => {
            this.removeClient(sheetName, client);
        });

        console.log(`📡 SSE broadcast to ${successCount}/${clientSet.size} clients for ${sheetName}`);
        return successCount;
    }

    /**
     * Broadcast to all sheets (for global events)
     */
    broadcastAll(data) {
        let totalSent = 0;
        for (const sheetName of this.clients.keys()) {
            totalSent += this.broadcast(sheetName, data);
        }
        return totalSent;
    }

    /**
     * Get client count for a sheet
     */
    getClientCount(sheetName) {
        const clientSet = this.clients.get(sheetName);
        return clientSet ? clientSet.size : 0;
    }

    /**
     * Get SSE stats
     */
    getStats = (req, res) => {
        const clientsBySheet = {};
        for (const [sheetName, clients] of this.clients.entries()) {
            clientsBySheet[sheetName] = clients.size;
        }

        res.json({
            success: true,
            stats: {
                ...this.stats,
                clientsBySheet
            }
        });
    }
}

// Singleton instance
const sseController = new SSEController();

export default sseController;
