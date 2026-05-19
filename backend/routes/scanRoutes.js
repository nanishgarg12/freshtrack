const express = require("express");
const multer = require("multer");
const auth = require("../middleware/authMiddleware");
const BarcodeProduct = require("../models/BarcodeProduct");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function computeGtinCheckDigit(dataDigits) {
  let sum = 0;
  let weight = 3;

  for (let i = dataDigits.length - 1; i >= 0; i--) {
    const digit = dataDigits.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return null;
    sum += digit * weight;
    weight = weight === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10;
}

function isValidGtin(code) {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;

  const expected = computeGtinCheckDigit(code.slice(0, -1));
  if (expected === null) return false;

  return expected === Number(code.slice(-1));
}

function normalizeBarcodeInput(text) {
  const raw = (text || "").toString().trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length >= 8 && digits.length <= 14) return digits;

  if (digits.length > 14) {
    for (const len of [14, 13, 12, 8]) {
      if (digits.length < len) continue;
      const prefix = digits.slice(0, len);
      if (isValidGtin(prefix)) return prefix;
    }

    return digits.slice(0, 14);
  }

  return digits;
}

function isLikelyBarcode(text) {
  const value = (text || "").trim();
  return /^\d{8,14}$/.test(value);
}

function buildBarcodeCandidates(barcode) {
  const value = (barcode || "").trim();
  if (!isLikelyBarcode(value)) return [value].filter(Boolean);

  const candidates = new Set();
  candidates.add(value);

  if (value.length === 12) {
    candidates.add(`0${value}`);
    candidates.add(value.padStart(14, "0"));
  } else if (value.length === 13) {
    candidates.add(value.padStart(14, "0"));
    if (value.startsWith("0")) candidates.add(value.slice(1));
  } else if (value.length === 14) {
    if (value.startsWith("0")) candidates.add(value.slice(1));
    if (value.startsWith("00")) candidates.add(value.slice(2));
  }

  return Array.from(candidates);
}

async function findCachedBarcodeProduct(barcode, candidates) {
  const direct = await BarcodeProduct.findOne({ barcode }).lean();
  if (direct) return direct;

  if (Array.isArray(candidates) && candidates.length) {
    const fallback = await BarcodeProduct.findOne({ barcode: { $in: candidates } }).lean();
    if (fallback) return fallback;
  }

  return null;
}

function buildBarcodeHints(barcode) {
  const hints = [];

  if (!process.env.BARCODE_LOOKUP_API_KEY) {
    hints.push("Set BARCODE_LOOKUP_API_KEY for higher lookup success.");
  }

  if (/^(978|979)\d{10}$/.test(barcode)) {
    hints.push("This barcode looks like an ISBN (books), so food databases may not contain it.");
  }

  hints.push("If lookup fails, fill item details and use 'Save Barcode' to make future scans auto-fill.");

  return hints;
}

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

function normalizeCachedProduct(cached) {
  return {
    source: cached.source || "cache",
    barcode: cached.barcode,
    name: cached.name || "",
    brand: cached.brand || "",
    quantity: "",
    qty: typeof cached.qty === "number" ? cached.qty : 1,
    unit: cached.unit || "pcs",
    category: cached.category || "packed"
  };
}

function normalizeInventoryCategory(category) {
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

  const candidate = new Date(Date.UTC(y, m - 1, d));
  if (
    candidate.getUTCFullYear() !== y ||
    candidate.getUTCMonth() !== m - 1 ||
    candidate.getUTCDate() !== d
  ) {
    return null;
  }

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDayOfMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) return null;

  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function normalizeYear(yearText) {
  const y = Number(yearText);
  if (!y) return null;
  if (String(yearText).length === 2) return y >= 70 ? 1900 + y : 2000 + y;
  return y;
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
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function normalizeOcrText(text) {
  return (text || "")
    .replace(/[|]/g, "1")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\b([Ee])\s*[Xx]\s*[Pp]\b/g, "EXP")
    .replace(/\b([Mm])\s*[Ff]\s*[Gg]\b/g, "MFG")
    .replace(/\b([Bb])\s*[Bb]\s*[Ee]?\b/g, "BBE")
    .replace(/\s*([/.\-:])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function addDateCandidate(candidates, date, score) {
  if (!date) return;
  const year = Number(date.slice(0, 4));
  if (year < 1990 || year > 2099) return;
  const existing = candidates.get(date);
  if (!existing || score > existing) candidates.set(date, score);
}

function collectDateCandidates(text, markerScore = 0) {
  const clean = normalizeOcrText(text);
  const candidates = new Map();

  const add = (year, month, day, score) => {
    addDateCandidate(candidates, toIsoDate(normalizeYear(year), month, day), score + markerScore);
  };
  const addMonthYear = (year, month, score) => {
    const normalizedYear = normalizeYear(year);
    const day = lastDayOfMonth(normalizedYear, month);
    addDateCandidate(candidates, toIsoDate(normalizedYear, month, day), score + markerScore);
  };

  for (const match of clean.matchAll(/\b(20\d{2}|19\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g)) {
    add(match[1], match[2], match[3], 88);
  }

  for (const match of clean.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    add(match[3], match[2], match[1], 92);
  }

  for (const match of clean.matchAll(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\/.\-\s]*(\d{2,4})\b/gi)) {
    add(match[3], monthMap[match[2].slice(0, 4).toLowerCase()] || monthMap[match[2].slice(0, 3).toLowerCase()], match[1], 94);
  }

  for (const match of clean.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\/.\-\s]*(\d{1,2})[,]?[\/.\-\s]*(\d{2,4})\b/gi)) {
    add(match[3], monthMap[match[1].slice(0, 4).toLowerCase()] || monthMap[match[1].slice(0, 3).toLowerCase()], match[2], 90);
  }

  for (const match of clean.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\/.\-\s]*(\d{2,4})\b/gi)) {
    addMonthYear(match[2], monthMap[match[1].slice(0, 4).toLowerCase()] || monthMap[match[1].slice(0, 3).toLowerCase()], 84);
  }

  for (const match of clean.matchAll(/\b(20\d{2}|19\d{2})[\/.\-](\d{1,2})(?![\/.\-]\d{1,2})\b/g)) {
    addMonthYear(match[1], match[2], 78);
  }

  for (const match of clean.matchAll(/\b(\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    addMonthYear(match[2], match[1], 82);
  }

  for (const match of clean.matchAll(/\b(0[1-9]|1[0-2])\s*(\d{2})\b/g)) {
    addMonthYear(match[2], match[1], 65);
  }

  for (const match of clean.matchAll(/\b(\d{2})(\d{2})(20\d{2}|19\d{2})\b/g)) {
    add(match[3], match[2], match[1], 70);
  }

  return candidates;
}

function pickBestDate(candidates) {
  let best = null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  for (const [date, score] of candidates.entries()) {
    const time = Date.parse(`${date}T00:00:00Z`);
    const futureBoost = time >= today ? 12 : 0;
    const value = score + futureBoost;

    if (!best || value > best.value || (value === best.value && time > best.time)) {
      best = { date, value, time };
    }
  }

  return best?.date || null;
}

function extractDateFromTextBlob(clean, markerScore = 0) {
  return pickBestDate(collectDateCandidates(clean, markerScore));
}

function extractDateFromText(text) {
  const clean = normalizeOcrText(text);
  if (!clean) return null;

  const priorityMarkers = [
    /\bexp(?:iry|ires?|iration)?\b/i,
    /\bbest before\b/i,
    /\buse by\b/i,
    /\buse before\b/i,
    /\bbb(?:e|d)?\b/i,
    /\bvalid till\b/i
  ];

  const allCandidates = new Map();

  for (const marker of priorityMarkers) {
    const match = clean.match(marker);
    if (!match || match.index === undefined) continue;

    const windowText = clean.slice(match.index, match.index + 120);
    const markerCandidates = collectDateCandidates(windowText, 40);
    for (const [date, score] of markerCandidates.entries()) addDateCandidate(allCandidates, date, score);
  }

  const markerDate = pickBestDate(allCandidates);
  if (markerDate) return markerDate;

  const withoutManufacturing = clean
    .replace(/\b(?:mfg|mfd|manufactured|packed|pkd|pack date)\b.{0,45}/gi, " ")
    .replace(/\s+/g, " ");

  return extractDateFromTextBlob(withoutManufacturing);
}

router.use(auth);

router.get("/barcode-lookup/:barcode", async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.params.barcode);
    if (!barcode) {
      return res.status(400).json({ message: "Barcode is required" });
    }

    if (!isLikelyBarcode(barcode)) {
      return res.status(400).json({ message: "Barcode must be 8-14 digits" });
    }

    const candidates = buildBarcodeCandidates(barcode);

    const cached = await findCachedBarcodeProduct(barcode, candidates);
    if (cached) {
      await BarcodeProduct.updateOne({ _id: cached._id }, { $set: { lastLookupAt: new Date(), updatedBy: req.userId } });
      return res.json({ product: normalizeCachedProduct(cached) });
    }

    const providers = [
      { name: "openfoodfacts", fn: fetchOpenFoodFacts },
      { name: "upcitemdb", fn: fetchUpcItemDb },
      { name: "barcodelookup", fn: fetchBarcodeLookup }
    ];

    let providerErrors = 0;

    for (const provider of providers) {
      let providerHadSuccessfulCall = false;
      let providerThrewEveryTime = true;

      for (const candidate of candidates) {
        try {
          const product = await provider.fn(candidate);
          providerHadSuccessfulCall = true;
          providerThrewEveryTime = false;

          if (product) {
            await BarcodeProduct.updateOne(
              { barcode },
              {
                $set: {
                  name: product.name,
                  brand: product.brand,
                  qty: product.qty,
                  unit: product.unit,
                  category: product.category,
                  source: product.source,
                  lastLookupAt: new Date(),
                  updatedBy: req.userId
                },
                $setOnInsert: {
                  barcode,
                  createdBy: req.userId
                }
              },
              { upsert: true }
            );
            return res.json({ product });
          }
        } catch {
          // Keep trying other candidates/providers.
        }
      }

      if (!providerHadSuccessfulCall && providerThrewEveryTime) {
        providerErrors += 1;
      }
    }

    if (providerErrors === providers.length) {
      return res.status(502).json({ message: "Barcode lookup providers unavailable" });
    }

    const hints = buildBarcodeHints(barcode);

    return res.json({
      product: null,
      message: "Product not found for barcode",
      ...(hints.length ? { hints } : {})
    });
  } catch (error) {
    return res.status(500).json({ message: "Barcode lookup failed" });
  }
});

router.post("/barcode-cache", async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.body?.barcode);
    if (!barcode) return res.status(400).json({ message: "Barcode is required" });
    if (!isLikelyBarcode(barcode)) return res.status(400).json({ message: "Barcode must be 8-14 digits" });

    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "Name is required" });

    const qty = req.body?.qty === undefined || req.body?.qty === "" ? 1 : Number(req.body.qty);
    if (Number.isNaN(qty) || qty < 0) {
      return res.status(400).json({ message: "Quantity must be a valid number" });
    }

    const unit = (req.body?.unit || "pcs").trim() || "pcs";
    const category = normalizeInventoryCategory(req.body?.category) || "packed";

    const candidates = buildBarcodeCandidates(barcode);
    const existing = await BarcodeProduct.findOne({ barcode: { $in: candidates } }).lean();
    const targetBarcode = existing?.barcode || barcode;

    const doc = await BarcodeProduct.findOneAndUpdate(
      { barcode: targetBarcode },
      {
        $set: {
          name,
          qty,
          unit,
          category,
          source: "user",
          lastLookupAt: new Date(),
          updatedBy: req.userId
        },
        $setOnInsert: {
          barcode: targetBarcode,
          createdBy: req.userId
        }
      },
      { upsert: true, new: true }
    ).lean();

    return res.json({ message: "Barcode saved", product: normalizeCachedProduct(doc) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save barcode" });
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
    form.append("scale", "true");
    form.append("detectOrientation", "true");
    form.append("OCREngine", "2");
    form.append("filetype", "PNG");
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "image/png" }),
      req.file.originalname || "expiry-scan.png"
    );

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const rawText = (data?.ParsedResults || []).map((r) => r.ParsedText || "").join("\n");

    if (!response.ok || data?.IsErroredOnProcessing) {
      return res.json({
        rawText,
        detectedDate: null,
        message: "OCR could not read text",
        details: data?.ErrorMessage || null
      });
    }

    const detectedDate = extractDateFromText(rawText);

    return res.json({ rawText, detectedDate });
  } catch (error) {
    return res.status(500).json({ message: "OCR request failed" });
  }
});

module.exports = router;
