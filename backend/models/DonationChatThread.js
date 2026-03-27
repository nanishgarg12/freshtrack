const mongoose = require("mongoose");

const donationChatThreadSchema = new mongoose.Schema(
  {
    donationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DonationRequest",
      required: true
    },
    donorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    lastMessageAt: {
      type: Date
    },
    lastMessageText: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

donationChatThreadSchema.index({ donationId: 1, requesterId: 1 }, { unique: true });
donationChatThreadSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model("DonationChatThread", donationChatThreadSchema);
