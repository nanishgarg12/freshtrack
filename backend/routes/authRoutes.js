const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const { sendExpiryAlertsForUser } = require("../cron/expiryJob");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

function getAdminEmailSet() {
  const raw = process.env.ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveRole(email) {
  const admins = getAdminEmailSet();
  return admins.has(email.toLowerCase()) ? "admin" : "user";
}

function buildLoginMessage(userName) {
  const loginTime = new Date().toISOString();
  return `Hi ${userName || "User"},\n\nYou have successfully logged in to FreshTrack on ${loginTime} (UTC).\n\nIf this was not you, please reset your password immediately.\n\n- FreshTrack`;
}

/* REGISTER */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const role = resolveRole(normalizedEmail);

    await User.create({ name, email: normalizedEmail, password: hashed, role });

    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Registration failed" });
  }
});

/* LOGIN */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

    // Backfill role for older users created before role field existed.
    if (!user.role) {
      user.role = resolveRole(normalizedEmail);
      await user.save();
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "7d"
    });

    // Fire and forget so login stays fast while still sending automatic alerts on login.
    sendEmail(user.email, "FreshTrack Login Alert", buildLoginMessage(user.name)).catch((error) => {
      console.error("Login email failed:", error.message);
    });

    // Fire and forget so login stays fast while still sending automatic alerts on login.
    sendExpiryAlertsForUser(user._id).catch((error) => {
      console.error("Login-triggered expiry email failed:", error.message);
    });

    res.json({ token, name: user.name, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

module.exports = router;
