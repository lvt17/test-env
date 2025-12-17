import syncQueueService from '../services/syncQueue.service.js';
import sseController from './sse.controller.js';

class WebhookController {
    /**
     * Handle sheet change webhook from Google Apps Script
     * POST /webhook/sheet-change
     */
    async handleSheetChange(req, res) {
        try {
            const {
                sheetName,
                range,
                row,
                column,
                oldValue,
                newValue,
                user,
                timestamp,
                primaryKey,
                changedFields
            } = req.body;

            console.log(`📥 Webhook received: ${sheetName} - Row ${row} by ${user}`);

            // Validate required fields
            if (!sheetName) {
                return res.status(400).json({
                    success: false,
                    error: 'sheetName is required'
                });
            }

            // Record the external change
            const changeData = {
                sheetName,
                range,
                row,
                column,
                oldValue,
                newValue,
                user,
                timestamp: timestamp || new Date().toISOString(),
                primaryKey,
                changedFields
            };

            const version = syncQueueService.recordExternalChange(sheetName, changeData);

            // 🚀 Broadcast change to all SSE clients instantly
            const clientsNotified = sseController.broadcast(sheetName, {
                type: 'sheet_change',
                ...changeData,
                version
            });

            res.json({
                success: true,
                message: 'Change recorded and broadcast',
                version,
                clientsNotified
            });

        } catch (error) {
            console.error('❌ Webhook error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Health check endpoint
     * GET /webhook/health
     */
    async health(req, res) {
        const stats = syncQueueService.getStats();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            queueStats: stats
        });
    }

    /**
     * Get pending changes for debugging
     * GET /webhook/debug/changes/:sheetName
     */
    async getDebugChanges(req, res) {
        const { sheetName } = req.params;
        const { since = 0 } = req.query;

        const changes = syncQueueService.getChangesSince(sheetName, parseInt(since));

        res.json({
            success: true,
            sheetName,
            since: parseInt(since),
            changes,
            count: changes.length
        });
    }
}

export default new WebhookController();
