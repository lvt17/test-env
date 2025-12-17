import { Router } from 'express';
import sseController from '../controller/sse.controller.js';

const router = Router();

// SSE subscription endpoint
router.get('/subscribe/:sheetName', sseController.subscribe);

// SSE stats endpoint
router.get('/stats', sseController.getStats);

export default router;
