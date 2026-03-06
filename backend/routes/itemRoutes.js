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

function normalizeCategory(category) {
  const value = (category || "").trim().toLowerCase();
  const aliases = {
    vegetable: "vegetables",
    grain: "grains",
    pulse: "pulses",
    medicine: "medicines",
    packedfood: "packed",
    "packed food": "packed"
  };

  return aliases[value] || value;
}

function getModel(category) {
  return modelMap[normalizeCategory(category)] || null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactNameRegex(name) {
  return new RegExp(`^${escapeRegex((name || "").trim())}$`, "i");
}

async function inventoryHasItem(userId, category, name) {
  const Model = getModel(category);
  if (!Model) return false;

  const existingInventoryItem = await Model.findOne({
    userId,
    name: exactNameRegex(name),
    qty: { $gt: 0 }
  }).select("_id");

  return Boolean(existingInventoryItem);
}

async function removeShoppingItemsIfInInventory(userId, category, name) {
  const isInInventory = await inventoryHasItem(userId, category, name);
  if (!isInInventory) return;

  await ShoppingItem.deleteMany({
    userId,
    category,
    name: exactNameRegex(name)
  });
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
    const visibleList = [];

    for (const item of list) {
      const isInInventory = await inventoryHasItem(req.userId, item.category, item.name);
      if (isInInventory) {
        await ShoppingItem.deleteOne({ _id: item._id, userId: req.userId });
        continue;
      }

      visibleList.push(item);
    }

    res.json(visibleList);
  } catch (err) {
    res.status(500).json({ message: "Failed to load shopping list" });
  }
});

/* ADD SHOPPING ITEM */
router.post("/shopping", auth, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const category = normalizeCategory(req.body.category);
    const qtyNeeded = req.body.qtyNeeded === undefined ? 1 : Number(req.body.qtyNeeded);

    if (!name || !getModel(category)) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

    if (Number.isNaN(qtyNeeded) || qtyNeeded < 1) {
      return res.status(400).json({ message: "qtyNeeded must be at least 1" });
    }

    const inInventory = await inventoryHasItem(req.userId, category, name);
    if (inInventory) {
      return res.status(409).json({ message: "Item already exists in inventory" });
    }

    const existing = await ShoppingItem.findOne({
      userId: req.userId,
      category,
      name: exactNameRegex(name)
    });

    if (existing) {
      existing.qtyNeeded += qtyNeeded;
      await existing.save();
      return res.json({ message: "Shopping item updated", item: existing });
    }

    const item = await ShoppingItem.create({
      userId: req.userId,
      name,
      category,
      qtyNeeded
    });

    res.json({ message: "Added to shopping list", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to add shopping item" });
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
    const category = normalizeCategory(req.params.category);
    const Model = getModel(category);
    if (!Model) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

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
    const category = normalizeCategory(req.params.category);
    const Model = getModel(category);
    if (!Model) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

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

    await removeShoppingItemsIfInInventory(req.userId, category, payload.name);

    res.json({ message: "Item added successfully", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to add item" });
  }
});

/* USE ITEM QTY */
router.put("/:category/:id", auth, async (req, res) => {
  try {
    const category = normalizeCategory(req.params.category);
    const Model = getModel(category);
    if (!Model) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

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
        category
      });

      if (!exists) {
        await ShoppingItem.create({
          userId: req.userId,
          name: item.name,
          category,
          qtyNeeded: 1
        });
      }
    } else {
      await removeShoppingItemsIfInInventory(req.userId, category, item.name);
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
    const category = normalizeCategory(req.params.category);
    const Model = getModel(category);
    if (!Model) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

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
        category
      });

      if (!exists) {
        await ShoppingItem.create({
          userId: req.userId,
          name: item.name,
          category,
          qtyNeeded: 1
        });
      }
    } else {
      await removeShoppingItemsIfInInventory(req.userId, category, item.name);
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
    const category = normalizeCategory(req.params.category);
    const Model = getModel(category);
    if (!Model) {
      return res
        .status(400)
        .json({ message: "Invalid category. Use vegetables, grains, pulses, medicines, or packed" });
    }

    await Model.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete item" });
  }
});

module.exports = router;
