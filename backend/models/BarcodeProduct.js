const mongoose = require("mongoose");

const barcodeProductSchema = new mongoose.Schema(
  {
    barcode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    name: {
      type: String,
      default: "",
      trim: true
    },
    brand: {
      type: String,
      default: "",
      trim: true
    },
    qty: {
      type: Number,
      default: 1,
      min: 0
    },
    unit: {
      type: String,
      default: "pcs",
      trim: true
    },
    category: {
      type: String,
      default: "packed",
      trim: true
    },
    source: {
      type: String,
      default: "user",
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    lastLookupAt: {
      type: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BarcodeProduct", barcodeProductSchema);

