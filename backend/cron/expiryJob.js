const cron = require("node-cron");
const sendEmail = require("../utils/sendEmail");
const User = require("../models/user");
const Vegetable = require("../models/vegetable");
const Grain = require("../models/grain");
const Pulse = require("../models/pulse");
const Medicine = require("../models/medicine");
const PackedFood = require("../models/packedFood");

const models = {
  vegetables: Vegetable,
  grains: Grain,
  pulses: Pulse,
  medicines: Medicine,
  packed: PackedFood
};

let jobStarted = false;

function buildAlertMessage(userName, items) {
  const lines = items
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
    .map(
      (item) =>
        `- ${item.name} (${item.category}) expires on ${new Date(item.expiryDate)
          .toISOString()
          .split("T")[0]}`
    );

  return `Hi ${userName || "User"},\n\nThese items are expiring within 3 days:\n\n${lines.join(
    "\n"
  )}\n\nPlease use or restock them.\n\n- FreshTrack`;
}

async function collectExpiringItemsByUser(userId = null) {
  const today = new Date();
  const alertDate = new Date();
  alertDate.setDate(today.getDate() + 3);

  const perUserItems = new Map();

  for (const category of Object.keys(models)) {
    const Model = models[category];
    const query = {
      expiryDate: { $lte: alertDate }
    };

    if (userId) {
      query.userId = userId;
    }

    const items = await Model.find(query).select("name expiryDate userId");

    items.forEach((item) => {
      const userKey = String(item.userId);
      const list = perUserItems.get(userKey) || [];

      list.push({
        name: item.name,
        category,
        expiryDate: item.expiryDate
      });

      perUserItems.set(userKey, list);
    });
  }

  return perUserItems;
}

async function sendExpiryAlertsForUser(userId) {
  const perUserItems = await collectExpiringItemsByUser(userId);
  const items = perUserItems.get(String(userId)) || [];

  if (!items.length) {
    console.log(`No expiring items for user ${userId}`);
    return;
  }

  const user = await User.findById(userId).select("name email");
  if (!user || !user.email) return;

  const message = buildAlertMessage(user.name, items);
  await sendEmail(user.email, "FreshTrack Expiry Alert", message);
}

async function sendExpiryAlerts() {
  const perUserItems = await collectExpiringItemsByUser();

  if (!perUserItems.size) {
    console.log("No expiring items found for email alerts");
    return;
  }

  const userIds = [...perUserItems.keys()];
  const users = await User.find({ _id: { $in: userIds } }).select("name email");

  for (const user of users) {
    const items = perUserItems.get(String(user._id)) || [];
    if (!items.length || !user.email) continue;

    const message = buildAlertMessage(user.name, items);

    try {
      await sendEmail(user.email, "FreshTrack Expiry Alert", message);
    } catch {
      // Continue processing remaining users.
    }
  }
}

function startExpiryCron() {
  if (jobStarted) return;

  const schedule = process.env.EXPIRY_CRON_SCHEDULE || "0 9 * * *";
  const timezone = process.env.EXPIRY_CRON_TZ;
  const options = timezone ? { timezone } : undefined;

  cron.schedule(
    schedule,
    async () => {
      console.log("Running scheduled expiry alert job...");
      try {
        await sendExpiryAlerts();
      } catch (error) {
        console.error("Expiry alert job failed:", error.message);
      }
    },
    options
  );

  jobStarted = true;
  console.log(
    `Expiry alert cron job started (schedule: ${schedule}${timezone ? `, tz: ${timezone}` : ""})`
  );
}

module.exports = {
  sendExpiryAlerts,
  sendExpiryAlertsForUser,
  startExpiryCron
};
