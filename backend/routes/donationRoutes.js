const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");

const DonationRequest = require("../models/DonationRequest");
const DonationChatThread = require("../models/DonationChatThread");
const DonationChatMessage = require("../models/DonationChatMessage");

const router = express.Router();

router.use(auth);

function cleanText(value, maxLength) {
  const text = (value || "").toString().trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function isAdmin(req) {
  return req.userRole === "admin";
}

function isOwner(req, donorId) {
  return String(donorId) === String(req.userId);
}

async function deleteDonationCascade(donationId) {
  await DonationChatMessage.deleteMany({ donationId });
  await DonationChatThread.deleteMany({ donationId });
  await DonationRequest.deleteOne({ _id: donationId });
}

/* LIST DONATION REQUESTS (VISIBLE TO ALL USERS) */
router.get("/", async (req, res) => {
  try {
    const donations = await DonationRequest.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("donorId", "name")
      .lean();

    const payload = donations.map((donation) => ({
      _id: donation._id,
      itemName: donation.itemName,
      quantity: donation.quantity,
      unit: donation.unit,
      expiryDate: donation.expiryDate,
      location: donation.location,
      notes: donation.notes,
      donor: {
        _id: donation.donorId?._id || donation.donorId,
        name: donation.donorId?.name || "User"
      },
      createdAt: donation.createdAt
    }));

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Failed to load donation requests" });
  }
});

/* CREATE DONATION REQUEST */
router.post("/", async (req, res) => {
  try {
    const itemName = cleanText(req.body.itemName, 80);
    const quantity = Number(req.body.quantity);
    const unit = cleanText(req.body.unit, 20);
    const location = cleanText(req.body.location, 120);
    const notes = cleanText(req.body.notes, 500);

    let expiryDate;
    if (req.body.expiryDate) {
      const parsed = new Date(req.body.expiryDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: "expiryDate must be a valid date" });
      }
      expiryDate = parsed;
    }

    if (!itemName) return res.status(400).json({ message: "Item name is required" });
    if (Number.isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({ message: "Quantity must be greater than 0" });
    }

    const donation = await DonationRequest.create({
      donorId: req.userId,
      itemName,
      quantity,
      unit,
      expiryDate,
      location,
      notes
    });

    const populated = await donation.populate("donorId", "name");

    res.status(201).json({
      message: "Donation request posted",
      donation: {
        _id: populated._id,
        itemName: populated.itemName,
        quantity: populated.quantity,
        unit: populated.unit,
        expiryDate: populated.expiryDate,
        location: populated.location,
        notes: populated.notes,
        donor: {
          _id: populated.donorId?._id || populated.donorId,
          name: populated.donorId?.name || "User"
        },
        createdAt: populated.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to create donation request" });
  }
});

/* LIST MY CHAT THREADS */
router.get("/threads", async (req, res) => {
  try {
    const threads = await DonationChatThread.find({
      $or: [{ donorId: req.userId }, { requesterId: req.userId }]
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate("donationId", "itemName quantity unit")
      .populate("donorId", "name")
      .populate("requesterId", "name")
      .lean();

    const myId = String(req.userId);

    const payload = threads.map((thread) => {
      const donor = thread.donorId;
      const requester = thread.requesterId;
      const donation = thread.donationId;
      const amDonor = String(donor?._id || donor) === myId;
      const otherUser = amDonor ? requester : donor;

      return {
        _id: thread._id,
        donation: donation
          ? {
              _id: donation._id,
              itemName: donation.itemName,
              quantity: donation.quantity,
              unit: donation.unit
            }
          : null,
        otherUser: {
          _id: otherUser?._id || otherUser,
          name: otherUser?.name || "User"
        },
        lastMessageText: thread.lastMessageText || "",
        lastMessageAt: thread.lastMessageAt || thread.updatedAt,
        role: amDonor ? "donor" : "requester"
      };
    });

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Failed to load chat threads" });
  }
});

/* GET THREAD MESSAGES */
router.get("/threads/:threadId/messages", async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ message: "Invalid thread id" });
    }

    const thread = await DonationChatThread.findById(threadId).select("donorId requesterId");
    if (!thread) return res.status(404).json({ message: "Chat thread not found" });

    const allowed =
      String(thread.donorId) === String(req.userId) || String(thread.requesterId) === String(req.userId);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const messages = await DonationChatMessage.find({ threadId })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate("senderId", "name")
      .lean();

    const payload = messages.map((message) => ({
      _id: message._id,
      sender: {
        _id: message.senderId?._id || message.senderId,
        name: message.senderId?.name || "User"
      },
      text: message.text,
      createdAt: message.createdAt
    }));

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Failed to load messages" });
  }
});

/* SEND MESSAGE */
router.post("/threads/:threadId/messages", async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ message: "Invalid thread id" });
    }

    const text = cleanText(req.body.text, 1000);
    if (!text) return res.status(400).json({ message: "Message cannot be empty" });

    const thread = await DonationChatThread.findById(threadId);
    if (!thread) return res.status(404).json({ message: "Chat thread not found" });

    const allowed =
      String(thread.donorId) === String(req.userId) || String(thread.requesterId) === String(req.userId);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const message = await DonationChatMessage.create({
      threadId: thread._id,
      donationId: thread.donationId,
      senderId: req.userId,
      text
    });

    thread.lastMessageAt = new Date();
    thread.lastMessageText = text.slice(0, 140);
    await thread.save();

    const populated = await message.populate("senderId", "name");

    res.status(201).json({
      message: "Message sent",
      chatMessage: {
        _id: populated._id,
        sender: {
          _id: populated.senderId?._id || populated.senderId,
          name: populated.senderId?.name || "User"
        },
        text: populated.text,
        createdAt: populated.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to send message" });
  }
});

/* CREATE OR GET THREAD FOR A DONATION (REQUESTER -> DONOR) */
router.post("/:donationId/threads", async (req, res) => {
  try {
    const { donationId } = req.params;
    if (!isValidObjectId(donationId)) {
      return res.status(400).json({ message: "Invalid donation id" });
    }

    const donation = await DonationRequest.findById(donationId).select("donorId itemName quantity unit");
    if (!donation) return res.status(404).json({ message: "Donation request not found" });

    if (isOwner(req, donation.donorId)) {
      return res.status(400).json({ message: "You cannot start a chat with yourself" });
    }

    let thread = await DonationChatThread.findOne({ donationId, requesterId: req.userId });

    if (!thread) {
      thread = await DonationChatThread.create({
        donationId,
        donorId: donation.donorId,
        requesterId: req.userId
      });
    }

    const populated = await DonationChatThread.findById(thread._id)
      .populate("donationId", "itemName quantity unit")
      .populate("donorId", "name")
      .populate("requesterId", "name")
      .lean();

    const myId = String(req.userId);
    const donor = populated.donorId;
    const requester = populated.requesterId;
    const amDonor = String(donor?._id || donor) === myId;
    const otherUser = amDonor ? requester : donor;

    res.json({
      thread: {
        _id: populated._id,
        donation: populated.donationId
          ? {
              _id: populated.donationId._id,
              itemName: populated.donationId.itemName,
              quantity: populated.donationId.quantity,
              unit: populated.donationId.unit
            }
          : null,
        otherUser: {
          _id: otherUser?._id || otherUser,
          name: otherUser?.name || "User"
        },
        lastMessageText: populated.lastMessageText || "",
        lastMessageAt: populated.lastMessageAt || populated.updatedAt,
        role: amDonor ? "donor" : "requester"
      }
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Chat thread already exists" });
    }

    res.status(500).json({ message: "Failed to start chat" });
  }
});

/* MARK DONATION AS COMPLETED (AUTO REMOVES REQUEST) */
router.post("/:id/fulfill", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid donation id" });

    const donation = await DonationRequest.findById(id).select("donorId");
    if (!donation) return res.status(404).json({ message: "Donation request not found" });

    if (!isOwner(req, donation.donorId) && !isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await deleteDonationCascade(donation._id);

    res.json({ message: "Donation marked as completed and removed" });
  } catch (error) {
    res.status(500).json({ message: "Failed to complete donation" });
  }
});

/* DELETE DONATION REQUEST */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid donation id" });

    const donation = await DonationRequest.findById(id).select("donorId");
    if (!donation) return res.status(404).json({ message: "Donation request not found" });

    if (!isOwner(req, donation.donorId) && !isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await deleteDonationCascade(donation._id);

    res.json({ message: "Donation request deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete donation request" });
  }
});

module.exports = router;
