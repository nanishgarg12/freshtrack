let mediaStream = null;

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

    for (let attempt = 1; attempt <= 14; attempt++) {
      const canvas = grabFrameToCanvas();
      if (!canvas) {
        await delay(200);
        continue;
      }

      let code = await detectWithBarcodeDetector(canvas);
      if (!code) code = await detectWithQuagga(canvas);

      if (code) {
        document.getElementById("barcodeInput").value = code;
        updateScannerStatus(`Barcode detected: ${code}. Fetching product details...`);
        await fillFromBarcode(code);
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
  const code = (document.getElementById("barcodeInput").value || "").trim();
  if (!code) {
    alert("Enter a barcode first.");
    return;
  }

  await fillFromBarcode(code);
}

async function fillFromBarcode(code) {
  try {
    updateScannerStatus("Looking up product details...");

    const data = await APP.apiFetch(`/scan/barcode-lookup/${encodeURIComponent(code)}`);
    const product = data?.product;

    if (!product) {
      updateScannerStatus("Product not found. Fill details manually.");
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
    updateScannerStatus("Product lookup failed. You can still fill fields manually.");
  }
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

function preprocessCanvasForOcr(canvas) {
  const processed = document.createElement("canvas");
  processed.width = canvas.width;
  processed.height = canvas.height;

  const ctx = processed.getContext("2d");
  ctx.drawImage(canvas, 0, 0);

  const image = ctx.getImageData(0, 0, processed.width, processed.height);
  const { data } = image;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = gray > 145 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return processed;
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

    return data?.detectedDate || null;
  } catch {
    return null;
  }
}

async function detectExpiryViaLocalOcr(canvas) {
  if (!window.Tesseract) return null;

  const result = await window.Tesseract.recognize(canvas, "eng");
  const text = result?.data?.text || "";
  return extractDateFromText(text);
}

async function scanExpiryText() {
  try {
    await startCamera();
    updateScannerStatus("Scanning expiry text...");

    for (let attempt = 1; attempt <= 5; attempt++) {
      const canvas = grabFrameToCanvas();
      if (!canvas) {
        await delay(260);
        continue;
      }

      const processed = preprocessCanvasForOcr(canvas);

      // 1) Try backend OCR API first.
      let dateValue = await detectExpiryViaApi(processed);

      // 2) Fallback to local OCR if API fails or misses.
      if (!dateValue) {
        const localSource = attempt % 2 === 0 ? processed : canvas;
        dateValue = await detectExpiryViaLocalOcr(localSource);
      }

      if (dateValue) {
        document.getElementById("expiryDate").value = dateValue;
        updateScannerStatus(`Expiry date detected: ${dateValue}`);
        return;
      }

      updateScannerStatus(`Scanning expiry text... attempt ${attempt}/5`);
      await delay(220);
    }

    updateScannerStatus("Could not detect expiry date. Enter it manually.");
    alert("Expiry date not detected. Please try again or enter manually.");
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
