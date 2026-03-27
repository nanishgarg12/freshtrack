const mongoose = require("mongoose");

const donationChatMessageSchema = new mongoose.Schema(
  {
    threadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DonationChatThread",
      required: true
    },
    donationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DonationRequest",
      required: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    }
  },
  { timestamps: true }
);

donationChatMessageSchema.index({ threadId: 1, createdAt: 1 });

module.exports = mongoose.model("DonationChatMessage", donationChatMessageSchema);
