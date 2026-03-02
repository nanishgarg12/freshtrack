const express = require("express");
const auth = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/adminMiddleware");

const Vegetable = require("../models/vegetable");
const Grain = require("../models/grain");
const Pulse = require("../models/pulse");
const Medicine = require("../models/medicine");
const PackedFood = require("../models/packedFood");
const User = require("../models/user");
const sendEmail = require("../utils/sendEmail");
const { sendExpiryAlerts } = require("../cron/expiryJob");

const router = express.Router();

const models = {
  vegetables: Vegetable,
  grains: Grain,
  pulses: Pulse,
  medicines: Medicine,
  packed: PackedFood
};

router.use(auth, requireAdmin);

/* DASHBOARD ANALYTICS */
router.get("/analytics", async (req, res) => {
  let totalItems = 0;
  let expiringSoon = 0;
  let totalValue = 0;
  let savedQty = 0;
  let usedAfterExpiryQty = 0;
  let wastedQty = 0;
  let atRiskQty = 0;
  let savedValue = 0;
  let wastedValue = 0;

  const today = new Date();
  const alertDate = new Date();
  alertDate.setDate(today.getDate() + 3);

  const categoryStats = {};

  for (const key in models) {
    const items = await models[key].find({ userId: req.userId });

    categoryStats[key] = items.length;
    totalItems += items.length;

    items.forEach((item) => {
      const qty = item.qty || 0;
      const price = item.price || 0;
      const itemSavedQty = item.savedQty || 0;
      const itemUsedAfterExpiryQty = item.usedAfterExpiryQty || 0;
      const expiry = new Date(item.expiryDate);

      if (expiry <= alertDate && qty > 0) expiringSoon++;
      totalValue += price * qty;
      savedQty += itemSavedQty;
      usedAfterExpiryQty += itemUsedAfterExpiryQty;
      savedValue += price * itemSavedQty;

      if (expiry < today && qty > 0) {
        wastedQty += qty;
        wastedValue += price * qty;
      }

      if (expiry >= today && expiry <= alertDate && qty > 0) {
        atRiskQty += qty;
      }
    });
  }

  const denominator = savedQty + wastedQty;
  const wasteAvoidedPercent = denominator > 0 ? (savedQty / denominator) * 100 : 0;

  res.json({
    totalItems,
    expiringSoon,
    totalValue,
    categoryStats,
    wasteReduction: {
      savedQty,
      usedAfterExpiryQty,
      wastedQty,
      atRiskQty,
      savedValue,
      wastedValue,
      wasteAvoidedPercent
    }
  });
});

/* SEND TEST EMAIL TO LOGGED-IN USER */
router.post("/test-email", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("name email");
    if (!user || !user.email) {
      return res.status(404).json({ message: "User email not found" });
    }

    const now = new Date().toISOString();
    const message = `Hi ${user.name || "User"},\n\nThis is a FreshTrack test email sent at ${now}.\n\nIf you received this, your email setup is working.`;

    await sendEmail(user.email, "FreshTrack Test Email", message);

    res.json({ message: `Test email sent to ${user.email}` });
  } catch (error) {
    res.status(500).json({ message: "Failed to send test email" });
  }
});

/* MANUAL TRIGGER FOR EXPIRY EMAIL JOB */
router.post("/trigger-expiry-alerts", async (req, res) => {
  try {
    await sendExpiryAlerts();
    res.json({ message: "Expiry alert job triggered" });
  } catch (error) {
    res.status(500).json({ message: "Failed to trigger expiry alerts" });
  }
});

module.exports = router;
