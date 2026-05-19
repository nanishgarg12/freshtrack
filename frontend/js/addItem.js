let mediaStream = null;

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

function setBarcodeSaveVisible(visible) {
  const box = document.getElementById("barcodeSaveBox");
  if (!box) return;
  box.classList.toggle("is-hidden", !visible);
}

document.addEventListener("DOMContentLoaded", () => {
  if (!APP.requireAuth()) return;

  const form = document.getElementById("addItemForm");
  form.addEventListener("submit", addItem);

  window.addEventListener("beforeunload", stopCamera);
});

function updateScannerStatus(message) {
  const status = document.getElementById("scannerStatus");
  if (status) status.textContent = message;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCamera() {
  try {
    if (mediaStream) return;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    const video = document.getElementById("scannerVideo");
    video.srcObject = mediaStream;
    await video.play();

    updateScannerStatus("Camera started. Point to barcode or expiry text.");
  } catch {
    updateScannerStatus("Camera permission denied or unavailable.");
    alert("Unable to open camera.");
  }
}

function stopCamera() {
  if (!mediaStream) return;

  mediaStream.getTracks().forEach((track) => track.stop());
  mediaStream = null;

  const video = document.getElementById("scannerVideo");
  if (video) video.srcObject = null;

  updateScannerStatus("Camera stopped.");
}

function grabFrameToCanvas() {
  const video = document.getElementById("scannerVideo");
  const canvas = document.getElementById("scannerCanvas");

  if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas;
}

async function detectWithBarcodeDetector(canvas) {
  if (!("BarcodeDetector" in window)) return null;

  const detector = new BarcodeDetector({
    formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"]
  });

  const barcodes = await detector.detect(canvas);
  return barcodes.length ? barcodes[0].rawValue : null;
}

function detectWithQuagga(canvas) {
  if (!window.Quagga) return Promise.resolve(null);

  return new Promise((resolve) => {
    window.Quagga.decodeSingle(
      {
        src: canvas.toDataURL("image/png"),
        numOfWorkers: 0,
        inputStream: {
          size: 1200
        },
        locator: {
          patchSize: "large",
          halfSample: false
        },
        decoder: {
          readers: [
            "ean_reader",
            "ean_8_reader",
            "upc_reader",
            "upc_e_reader",
            "code_128_reader",
            "code_39_reader"
          ]
        }
      },
      (result) => {
        resolve(result?.codeResult?.code || null);
      }
    );
  });
}

async function scanBarcode() {
  try {
    await startCamera();
    updateScannerStatus("Scanning barcode...");
    setBarcodeSaveVisible(false);

    for (let attempt = 1; attempt <= 14; attempt++) {
      const canvas = grabFrameToCanvas();
      if (!canvas) {
        await delay(200);
        continue;
      }

      let code = await detectWithBarcodeDetector(canvas);
      if (!code) code = await detectWithQuagga(canvas);

      if (code) {
        const normalized = normalizeBarcodeInput(code);
        document.getElementById("barcodeInput").value = normalized || code;
        updateScannerStatus(`Barcode detected: ${normalized || code}. Fetching product details...`);
        await fillFromBarcode(normalized || code);
        return;
      }

      updateScannerStatus(`Scanning barcode... attempt ${attempt}/14`);
      await delay(180);
    }

    updateScannerStatus("No barcode found. Improve lighting or enter barcode manually.");
  } catch {
    updateScannerStatus("Barcode scan failed.");
    alert("Barcode scan failed. Try manual barcode input.");
  }
}

async function fillFromManualBarcode() {
  const raw = (document.getElementById("barcodeInput").value || "").trim();
  if (!raw) {
    alert("Enter a barcode first.");
    return;
  }

  const code = normalizeBarcodeInput(raw) || raw;
  document.getElementById("barcodeInput").value = code;
  await fillFromBarcode(code);
}

async function fillFromBarcode(code) {
  try {
    updateScannerStatus("Looking up product details...");
    setBarcodeSaveVisible(false);

    const data = await APP.apiFetch(`/scan/barcode-lookup/${encodeURIComponent(code)}`);
    const product = data?.product;

    if (!product) {
      const message = data?.message || "Product not found. Fill details manually.";
      const hints = Array.isArray(data?.hints) ? data.hints.join(" ") : "";
      updateScannerStatus([message, hints].filter(Boolean).join(" "));
      setBarcodeSaveVisible(Boolean((document.getElementById("barcodeInput")?.value || "").trim()));
      document.getElementById("name")?.focus();
      return;
    }

    if (product.name) {
      document.getElementById("name").value = product.name;
    }

    const qtyInput = document.getElementById("qty");
    const unitInput = document.getElementById("unit");
    const categoryInput = document.getElementById("category");

    if (!qtyInput.value && product.qty) qtyInput.value = product.qty;
    if (!unitInput.value && product.unit) unitInput.value = product.unit;
    if (product.category) categoryInput.value = product.category;

    updateScannerStatus(`Product details filled via ${product.source}. Scan expiry text or enter manually.`);
  } catch (err) {
    const message = err?.message ? `Product lookup failed: ${err.message}` : "Product lookup failed.";
    updateScannerStatus(`${message} You can still fill fields manually.`);
    setBarcodeSaveVisible(Boolean((document.getElementById("barcodeInput")?.value || "").trim()));
  }
}

async function saveBarcodeTemplate() {
  const barcode = normalizeBarcodeInput(document.getElementById("barcodeInput")?.value || "");
  if (!barcode) {
    alert("Enter a barcode first.");
    return;
  }

  const name = (document.getElementById("name")?.value || "").trim();
  if (!name) {
    alert("Enter item name first.");
    document.getElementById("name")?.focus();
    return;
  }

  const category = document.getElementById("category")?.value || "packed";
  const qtyText = document.getElementById("qty")?.value;
  const qty = qtyText === undefined || qtyText === "" ? 1 : Number(qtyText);
  const unit = (document.getElementById("unit")?.value || "pcs").trim();

  try {
    updateScannerStatus("Saving barcode...");
    await APP.apiFetch("/scan/barcode-cache", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        barcode,
        name,
        qty,
        unit,
        category
      })
    });

    setBarcodeSaveVisible(false);
    updateScannerStatus("Barcode saved. Next scans will auto-fill product details.");
  } catch (err) {
    const message = err?.message ? `Failed to save barcode: ${err.message}` : "Failed to save barcode.";
    updateScannerStatus(message);
    alert(message);
  }
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

function cropCanvas(canvas, xRatio, yRatio, widthRatio, heightRatio, scale = 2) {
  const crop = document.createElement("canvas");
  const sourceWidth = Math.max(1, Math.round(canvas.width * widthRatio));
  const sourceHeight = Math.max(1, Math.round(canvas.height * heightRatio));
  const sourceX = Math.max(0, Math.round(canvas.width * xRatio));
  const sourceY = Math.max(0, Math.round(canvas.height * yRatio));

  crop.width = sourceWidth * scale;
  crop.height = sourceHeight * scale;

  const ctx = crop.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);

  return crop;
}

function tuneCanvasForOcr(canvas, mode = "threshold") {
  const processed = document.createElement("canvas");
  processed.width = canvas.width;
  processed.height = canvas.height;

  const ctx = processed.getContext("2d");
  ctx.drawImage(canvas, 0, 0);

  const image = ctx.getImageData(0, 0, processed.width, processed.height);
  const { data } = image;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let value = gray;

    if (mode === "threshold") value = gray > 142 ? 255 : 0;
    if (mode === "contrast") value = Math.max(0, Math.min(255, (gray - 118) * 1.9 + 128));
    if (mode === "invert") value = gray > 142 ? 0 : 255;

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return processed;
}

function buildOcrCanvases(canvas) {
  const full = cropCanvas(canvas, 0, 0, 1, 1, 1.4);
  const center = cropCanvas(canvas, 0.08, 0.22, 0.84, 0.5, 2.2);
  const lower = cropCanvas(canvas, 0.08, 0.48, 0.84, 0.38, 2.2);
  const top = cropCanvas(canvas, 0.08, 0.08, 0.84, 0.38, 2.2);
  const crops = [center, lower, top, full];
  const variants = [];

  for (const crop of crops) {
    variants.push(tuneCanvasForOcr(crop, "contrast"));
    variants.push(tuneCanvasForOcr(crop, "threshold"));
  }

  variants.push(tuneCanvasForOcr(center, "invert"));
  variants.push(full);

  return variants;
}

function buildOcrContactSheet(canvases) {
  const selected = canvases.slice(0, 6);
  const cellWidth = Math.max(...selected.map((canvas) => canvas.width));
  const cellHeight = Math.max(...selected.map((canvas) => canvas.height));
  const cols = 2;
  const rows = Math.ceil(selected.length / cols);
  const gap = 18;
  const sheet = document.createElement("canvas");

  sheet.width = cols * cellWidth + (cols + 1) * gap;
  sheet.height = rows * cellHeight + (rows + 1) * gap;

  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  selected.forEach((canvas, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = gap + col * (cellWidth + gap);
    const y = gap + row * (cellHeight + gap);
    ctx.drawImage(canvas, x, y);
  });

  return sheet;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

async function detectExpiryViaApi(canvas) {
  const blob = await canvasToBlob(canvas);
  if (!blob) return null;

  const formData = new FormData();
  formData.append("image", blob, "expiry-scan.png");

  try {
    const data = await APP.apiFetch("/scan/expiry-ocr", {
      method: "POST",
      body: formData
    });

    return {
      date: data?.detectedDate || null,
      rawText: data?.rawText || ""
    };
  } catch {
    return null;
  }
}

async function detectExpiryViaLocalOcr(canvas) {
  if (!window.Tesseract) return null;

  const result = await window.Tesseract.recognize(canvas, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/.-: "
  });
  const text = result?.data?.text || "";
  return {
    date: extractDateFromText(text),
    rawText: text
  };
}

async function scanExpiryText() {
  try {
    await startCamera();
    updateScannerStatus("Scanning expiry text. Keep the date label inside the camera view.");

    for (let attempt = 1; attempt <= 4; attempt++) {
      const canvas = grabFrameToCanvas();
      if (!canvas) {
        await delay(260);
        continue;
      }

      const ocrCanvases = buildOcrCanvases(canvas);
      const rawTextParts = [];
      const apiResult = await detectExpiryViaApi(buildOcrContactSheet(ocrCanvases));
      if (apiResult?.rawText) rawTextParts.push(apiResult.rawText);
      if (apiResult?.date) {
        document.getElementById("expiryDate").value = apiResult.date;
        updateScannerStatus(`Expiry date detected: ${apiResult.date}`);
        return;
      }

      for (let index = 0; index < ocrCanvases.length; index++) {
        updateScannerStatus(`Reading expiry text... frame ${attempt}/4, view ${index + 1}/${ocrCanvases.length}`);

        const shouldTryLocalOcr = index < 3 || index === ocrCanvases.length - 1;
        const localResult = shouldTryLocalOcr ? await detectExpiryViaLocalOcr(ocrCanvases[index]) : null;
        if (localResult?.rawText) rawTextParts.push(localResult.rawText);
        if (localResult?.date) {
          document.getElementById("expiryDate").value = localResult.date;
          updateScannerStatus(`Expiry date detected: ${localResult.date}`);
          return;
        }
      }

      const combinedDate = extractDateFromText(rawTextParts.join(" "));
      if (combinedDate) {
        document.getElementById("expiryDate").value = combinedDate;
        updateScannerStatus(`Expiry date detected: ${combinedDate}`);
        return;
      }

      updateScannerStatus(`No expiry date found in frame ${attempt}/4. Move closer and hold steady.`);
      await delay(320);
    }

    updateScannerStatus("Could not detect expiry date. Try brighter light, fill the camera with the expiry label, or enter it manually.");
    alert("Expiry date not detected. Try again closer to the expiry label or enter it manually.");
  } catch {
    updateScannerStatus("Expiry text scan failed.");
    alert("Expiry scan failed. Please try again.");
  }
}

async function addItem(event) {
  event.preventDefault();

  const category = document.getElementById("category").value;
  const name = document.getElementById("name").value.trim();
  const qty = document.getElementById("qty").value;
  const unit = document.getElementById("unit").value.trim();
  const expiryDate = document.getElementById("expiryDate").value;
  const price = document.getElementById("price").value;
  const image = document.getElementById("image").files[0];

  const formData = new FormData();
  formData.append("name", name);
  formData.append("qty", qty);
  formData.append("unit", unit);
  formData.append("expiryDate", expiryDate);
  formData.append("price", price);

  if (image) {
    formData.append("image", image);
  }

  try {
    const data = await APP.apiFetch(`/items/${category}`, {
      method: "POST",
      body: formData
    });

    const barcode = (document.getElementById("barcodeInput")?.value || "").trim();
    if (barcode) {
      try {
        await APP.apiFetch("/scan/barcode-cache", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            barcode,
            name,
            qty,
            unit,
            category
          })
        });
      } catch {
        // Best-effort: inventory save succeeded even if barcode cache fails.
      }
    }

    alert(data.message || "Item added successfully");
    stopCamera();
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  APP.clearSession();
  stopCamera();
  window.location.href = "login.html";
}

window.logout = logout;
window.startCamera = startCamera;
window.stopCamera = stopCamera;
window.scanBarcode = scanBarcode;
window.scanExpiryText = scanExpiryText;
window.fillFromManualBarcode = fillFromManualBarcode;
window.saveBarcodeTemplate = saveBarcodeTemplate;
