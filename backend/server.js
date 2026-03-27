const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const connectDB = require("./config/db");
const { startExpiryCron } = require("./cron/expiryJob");

connectDB();

const app = express();
const uploadsPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(cors());
app.use(express.json());

/* API ROUTES */
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/items", require("./routes/itemRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/scan", require("./routes/scanRoutes"));
app.use("/api/donations", require("./routes/donationRoutes"));

/* HEALTH CHECK */
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

/* STATIC UPLOADS (IMAGES) */
app.use("/uploads", express.static(uploadsPath));

/* SERVE FRONTEND */
app.use(express.static(path.join(__dirname, "../frontend")));

/* DEFAULT ROUTE */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

const enableInProcessCron =
  process.env.ENABLE_IN_PROCESS_CRON === "true" ||
  (process.env.NODE_ENV || "").toLowerCase() !== "production";

if (enableInProcessCron) {
  startExpiryCron();
} else {
  console.log("In-process cron disabled (use Render cron service).");
}

/* SERVER */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
