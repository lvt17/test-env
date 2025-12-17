import { Router } from 'express';
import webhookController from '../controller/webhook.controller.js';

const router = Router();

// Webhook endpoint for Google Apps Script
router.post('/sheet-change', webhookController.handleSheetChange);

// Health check
router.get('/health', webhookController.health);

// Debug endpoint (should be disabled in production)
router.get('/debug/changes/:sheetName', webhookController.getDebugChanges);

export default router;
