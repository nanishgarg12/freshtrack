const express = require("express");
const multer = require("multer");
const auth = require("../middleware/authMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalizeQuantityToUnit(quantityText) {
  if (!quantityText) return { qty: 1, unit: "pcs" };

  const lower = quantityText.toLowerCase();
  const match = lower.match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|pcs|pc|pack|packs|tablet|tablets|capsule|capsules)/i);

  if (!match) return { qty: 1, unit: quantityText };

  return {
    qty: Number(match[1]) || 1,
    unit: match[2].toLowerCase()
  };
}

function inferCategory(textBlob) {
  const blob = (textBlob || "").toLowerCase();

  if (/medicine|tablet|capsule|syrup|drug|pharma/.test(blob)) return "medicines";
  if (/dal|lentil|pulse|chana|rajma|toor|moong|urad/.test(blob)) return "pulses";
  if (/rice|wheat|grain|flour|atta|oats|barley|millet/.test(blob)) return "grains";
  if (/vegetable|tomato|onion|potato|spinach|cabbage|carrot/.test(blob)) return "vegetables";
  return "packed";
}

function normalizeBarcodeProduct(product, source) {
  const textBlob = [product.name, product.categories, product.brand].filter(Boolean).join(" ");
  const normalizedQty = normalizeQuantityToUnit(product.quantity);

  return {
    source,
    barcode: product.barcode,
    name: product.name || "",
    brand: product.brand || "",
    quantity: product.quantity || "",
    qty: normalizedQty.qty,
    unit: normalizedQty.unit,
    category: inferCategory(textBlob)
  };
}

async function fetchOpenFoodFacts(barcode) {
  const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`);
  if (!response.ok) return null;

  const data = await response.json();
  if (data?.status !== 1 || !data.product) return null;

  const p = data.product;
  return normalizeBarcodeProduct(
    {
      barcode,
      name: p.product_name || p.generic_name,
      brand: p.brands,
      quantity: p.quantity,
      categories: `${p.categories || ""} ${(p.categories_tags || []).join(" ")}`
    },
    "openfoodfacts"
  );
}

async function fetchUpcItemDb(barcode) {
  const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`);
  if (!response.ok) return null;

  const data = await response.json();
  const item = data?.items?.[0];
  if (!item) return null;

  return normalizeBarcodeProduct(
    {
      barcode,
      name: item.title,
      brand: item.brand,
      quantity: item.size,
      categories: (item.category || "")
    },
    "upcitemdb"
  );
}

async function fetchBarcodeLookup(barcode) {
  const apiKey = process.env.BARCODE_LOOKUP_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(
    `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(barcode)}&formatted=y&key=${encodeURIComponent(apiKey)}`
  );
  if (!response.ok) return null;

  const data = await response.json();
  const item = data?.products?.[0];
  if (!item) return null;

  return normalizeBarcodeProduct(
    {
      barcode,
      name: item.product_name,
      brand: item.brand,
      quantity: item.size,
      categories: [item.category, ...(item.stores || []).map((s) => s?.name || "")].join(" ")
    },
    "barcodelookup"
  );
}

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeYear(yearText) {
  const y = Number(yearText);
  if (!y) return null;
  if (String(yearText).length === 2) return y >= 70 ? 1900 + y : 2000 + y;
  return y;
}

function extractDateFromText(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();

  const ymd = clean.match(/\b(20\d{2}|19\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (ymd) return toIsoDate(ymd[1], ymd[2], ymd[3]);

  const dmy = clean.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (dmy) {
    const year = normalizeYear(dmy[3]);
    return toIsoDate(year, dmy[2], dmy[1]);
  }

  const monthMap = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  };

  const textual = clean.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})\b/i);
  if (textual) {
    const year = normalizeYear(textual[3]);
    const month = monthMap[textual[2].slice(0, 3).toLowerCase()];
    return toIsoDate(year, month, textual[1]);
  }

  return null;
}

router.use(auth);

router.get("/barcode-lookup/:barcode", async (req, res) => {
  try {
    const barcode = (req.params.barcode || "").trim();
    if (!barcode) {
      return res.status(400).json({ message: "Barcode is required" });
    }

    const providers = [fetchOpenFoodFacts, fetchUpcItemDb, fetchBarcodeLookup];

    for (const provider of providers) {
      try {
        const product = await provider(barcode);
        if (product) {
          return res.json({ product });
        }
      } catch {
        // Try next provider.
      }
    }

    return res.status(404).json({ message: "Product not found for barcode" });
  } catch (error) {
    return res.status(500).json({ message: "Barcode lookup failed" });
  }
});

router.post("/expiry-ocr", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Image is required" });
    }

    const ocrApiKey = process.env.OCR_SPACE_API_KEY || "helloworld";

    const form = new FormData();
    form.append("apikey", ocrApiKey);
    form.append("language", "eng");
    form.append("isOverlayRequired", "false");
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "image/png" }),
      req.file.originalname || "expiry-scan.png"
    );

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form
    });

    const data = await response.json();

    if (!response.ok || data?.IsErroredOnProcessing) {
      return res.status(422).json({ message: "OCR could not read text", details: data?.ErrorMessage || null });
    }

    const rawText = (data?.ParsedResults || []).map((r) => r.ParsedText || "").join("\n");
    const detectedDate = extractDateFromText(rawText);

    return res.json({ rawText, detectedDate });
  } catch (error) {
    return res.status(500).json({ message: "OCR request failed" });
  }
});

module.exports = router;
