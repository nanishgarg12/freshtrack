const mongoose = require("mongoose");

const grainSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    name: {
      type: String,
      required: true
    },
    qty: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String
    },
    expiryDate: {
      type: Date,
      required: true
    },
    price: {
      type: Number,
      default: 0
    },
    image: {
      type: String
    },
    savedQty: {
      type: Number,
      default: 0,
      min: 0
    },
    usedAfterExpiryQty: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Grain", grainSchema);
