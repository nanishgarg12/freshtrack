const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
const { sendExpiryAlerts } = require("../cron/expiryJob");

async function run() {
  try {
    await connectDB();
    await sendExpiryAlerts();
    console.log("Expiry alert cron run completed");
    process.exit(0);
  } catch (error) {
    console.error("Expiry alert cron run failed:", error.message);
    process.exit(1);
  }
}

run();
