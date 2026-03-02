const express = require("express");
const auth = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

const ShoppingItem = require("../models/ShoppingItem");
const Vegetable = require("../models/vegetable");
const Grain = require("../models/grain");
const Pulse = require("../models/pulse");
const Medicine = require("../models/medicine");
const PackedFood = require("../models/packedFood");

const router = express.Router();

const modelMap = {
  vegetables: Vegetable,
  grains: Grain,
  pulses: Pulse,
  medicines: Medicine,
  packed: PackedFood
};

function getModel(category) {
  return modelMap[category] || null;
}

function buildItemPayload(req) {
  const qty = Number(req.body.qty);
  const price = req.body.price === undefined || req.body.price === "" ? 0 : Number(req.body.price);

  return {
    name: (req.body.name || "").trim(),
    qty,
    unit: req.body.unit,
    expiryDate: req.body.expiryDate,
    price,
    image: req.file ? req.file.filename : undefined
  };
}

function getSortConfig(sortBy, sortOrder) {
  const allowedSorts = new Set(["name", "qty", "price", "expiryDate", "createdAt"]);
  const field = allowedSorts.has(sortBy) ? sortBy : "expiryDate";
  const order = sortOrder === "desc" ? -1 : 1;

  return { [field]: order };
}

/* DASHBOARD EXPIRY ALERTS */
router.get("/alerts/expiring", auth, async (req, res) => {
  try {
    const today = new Date();
    const alertDate = new Date();
    alertDate.setDate(today.getDate() + 3);

    const allModels = Object.values(modelMap);
    let alerts = [];

    for (const Model of allModels) {
      const items = await Model.find({
        userId: req.userId,
        expiryDate: { $lte: alertDate }
      }).sort({ expiryDate: 1 });

      alerts = alerts.concat(items);
    }

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: "Failed to load alerts" });
  }
});

/* GET SHOPPING LIST */
router.get("/shopping/list", auth, async (req, res) => {
  try {
    const list = await ShoppingItem.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: "Failed to load shopping list" });
  }
});

/* REMOVE SHOPPING ITEM */
router.delete("/shopping/:id", auth, async (req, res) => {
  try {
    await ShoppingItem.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: "Removed from shopping list" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove item" });
  }
});

/* GET ITEMS BY CATEGORY */
router.get("/:category", auth, async (req, res) => {
  try {
    const Model = getModel(req.params.category);
    if (!Model) return res.status(400).json({ message: "Invalid category" });

    const { q, expiryFilter = "all", sortBy = "expiryDate", sortOrder = "asc" } = req.query;

    const query = { userId: req.userId };

    if (q) {
      query.name = { $regex: q.trim(), $options: "i" };
    }

    const today = new Date();
    const alertDate = new Date();
    alertDate.setDate(today.getDate() + 3);

    if (expiryFilter === "soon") {
      query.expiryDate = { $gte: today, $lte: alertDate };
    } else if (expiryFilter === "expired") {
      query.expiryDate = { $lt: today };
    }

    const items = await Model.find(query).sort(getSortConfig(sortBy, sortOrder));
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch items" });
  }
});

/* ADD ITEM (WITH OPTIONAL IMAGE) */
router.post("/:category", auth, upload.single("image"), async (req, res) => {
  try {
    const Model = getModel(req.params.category);
    if (!Model) return res.status(400).json({ message: "Invalid category" });

    const payload = buildItemPayload(req);

    if (!payload.name || !payload.expiryDate || Number.isNaN(payload.qty) || payload.qty < 0) {
      return res.status(400).json({ message: "Please provide valid name, quantity and expiry date" });
    }

    if (Number.isNaN(payload.price) || payload.price < 0) {
      return res.status(400).json({ message: "Price must be a valid number" });
    }

    const item = await Model.create({
      userId: req.userId,
      ...payload
    });

    res.json({ message: "Item added successfully", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to add item" });
  }
});

/* USE ITEM QTY */
router.put("/:category/:id", auth, async (req, res) => {
  try {
    const Model = getModel(req.params.category);
    if (!Model) return res.status(400).json({ message: "Invalid category" });

    const usedQty = Number(req.body.usedQty);
    if (Number.isNaN(usedQty) || usedQty <= 0) {
      return res.status(400).json({ message: "Used quantity must be greater than 0" });
    }

    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    if (item.qty < usedQty) {
      return res.status(400).json({ message: "Not enough quantity available" });
    }

    const usedOnOrBeforeExpiry = new Date() <= new Date(item.expiryDate);
    item.qty -= usedQty;
    if (usedOnOrBeforeExpiry) {
      item.savedQty = (item.savedQty || 0) + usedQty;
    } else {
      item.usedAfterExpiryQty = (item.usedAfterExpiryQty || 0) + usedQty;
    }

    if (item.qty === 0) {
      const exists = await ShoppingItem.findOne({
        userId: req.userId,
        name: item.name,
        category: req.params.category
      });

      if (!exists) {
        await ShoppingItem.create({
          userId: req.userId,
          name: item.name,
          category: req.params.category,
          qtyNeeded: 1
        });
      }
    }

    await item.save();
    res.json({ message: "Quantity updated", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to update quantity" });
  }
});

/* EDIT ITEM */
router.put("/:category/edit/:id", auth, async (req, res) => {
  try {
    const Model = getModel(req.params.category);
    if (!Model) return res.status(400).json({ message: "Invalid category" });

    const qty = Number(req.body.qty);
    const price = req.body.price === undefined || req.body.price === "" ? undefined : Number(req.body.price);
    const expiryDate = req.body.expiryDate;

    if (Number.isNaN(qty) || qty < 0) {
      return res.status(400).json({ message: "Quantity cannot be negative" });
    }

    if (price !== undefined && (Number.isNaN(price) || price < 0)) {
      return res.status(400).json({ message: "Price cannot be negative" });
    }

    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    item.qty = qty;
    if (price !== undefined) item.price = price;
    if (expiryDate) item.expiryDate = expiryDate;

    if (item.qty === 0) {
      const exists = await ShoppingItem.findOne({
        userId: req.userId,
        name: item.name,
        category: req.params.category
      });

      if (!exists) {
        await ShoppingItem.create({
          userId: req.userId,
          name: item.name,
          category: req.params.category,
          qtyNeeded: 1
        });
      }
    }

    await item.save();
    res.json({ message: "Item updated successfully", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to update item" });
  }
});

/* DELETE ITEM */
router.delete("/:category/:id", auth, async (req, res) => {
  try {
    const Model = getModel(req.params.category);
    if (!Model) return res.status(400).json({ message: "Invalid category" });

    await Model.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete item" });
  }
});

module.exports = router;
