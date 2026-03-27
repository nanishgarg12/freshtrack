const mongoose = require("mongoose");

const donationRequestSchema = new mongoose.Schema(
  {
    donorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    itemName: {
      type: String,
      required: true,
      trim: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      trim: true
    },
    expiryDate: {
      type: Date
    },
    location: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

donationRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model("DonationRequest", donationRequestSchema);
