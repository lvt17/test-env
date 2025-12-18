//create server using express import
import express from "express";
import cors from "cors";
import router from "./src/routes/route.js";
import bodyParser from "body-parser";
import 'dotenv/config';
import compression from 'compression';
//create server using express
const app = express();
const corsOpts = {
  origin: "*",

  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],

  allowedHeaders: ["*"],
};
//allow all requests from all domains & localhost
app.use(cors(corsOpts));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(compression()); // Tự động nén tất cả response

// Serve static files (frontend HTML) with cache control
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve index.html explicitly with no-cache to ensure latest version
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(htmlPath);
});

// Static files for other assets
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

router(app);
let port = process.env.PORT || 8081;
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
// Force redeploy Thu Dec 18 23:09:16 +07 2025
