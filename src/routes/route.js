import express from "express";
import sheetRoute from "./sheet.route.js";
import reportRoute from "./report.route.js";
import webhookRoute from "./webhook.routes.js";
import sseRoute from "./sse.routes.js";
import syncRoute from "./sync.routes.js";

let router = express.Router();
let initWebRoutes = (app, io) => {
    router.use(`/sheet`, sheetRoute);
    router.use(`/report`, reportRoute);
    router.use(`/webhook`, webhookRoute);
    router.use(`/sse`, sseRoute);
    router.use(`/sync`, syncRoute);
    return app.use('/', router);
}

export default initWebRoutes;

