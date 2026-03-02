const mongoose = require("mongoose");

const shoppingItemSchema = new mongoose.Schema(
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
    category: {
      type: String,
      required: true
    },
    qtyNeeded: {
      type: Number,
      default: 1,
      min: 1
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShoppingItem", shoppingItemSchema);