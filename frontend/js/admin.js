document.addEventListener("DOMContentLoaded", async () => {
  if (!APP.requireAdmin()) return;

  const logoutBtn = document.getElementById("logoutBtn");
  const sendTestEmailBtn = document.getElementById("sendTestEmailBtn");
  const triggerExpiryAlertsBtn = document.getElementById("triggerExpiryAlertsBtn");

  logoutBtn?.addEventListener("click", logout);
  sendTestEmailBtn?.addEventListener("click", sendTestEmail);
  triggerExpiryAlertsBtn?.addEventListener("click", triggerExpiryAlerts);

  await loadAnalytics();
});

async function loadAnalytics() {
  try {
    const data = await APP.apiFetch("/admin/analytics");

    document.getElementById("totalItems").textContent = data.totalItems;
    document.getElementById("expiringSoon").textContent = data.expiringSoon;
    document.getElementById("totalValue").textContent = Number(data.totalValue || 0).toFixed(2);
    renderWasteReduction(data.wasteReduction || {});

    const tbody = document.getElementById("categoryTable");
    tbody.innerHTML = "";

    Object.keys(data.categoryStats || {}).forEach((key) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${key}</td>
        <td>${data.categoryStats[key]}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    alert(err.message);
  } 
}

function renderWasteReduction(waste) {
  const savedQty = Number(waste.savedQty || 0);
  const wastedQty = Number(waste.wastedQty || 0);
  const atRiskQty = Number(waste.atRiskQty || 0);
  const usedAfterExpiryQty = Number(waste.usedAfterExpiryQty || 0);
  const savedValue = Number(waste.savedValue || 0);
  const wastedValue = Number(waste.wastedValue || 0);
  const wasteAvoidedPercent = Math.max(0, Math.min(100, Number(waste.wasteAvoidedPercent || 0)));

  document.getElementById("savedQty").textContent = savedQty.toFixed(2);
  document.getElementById("wastedQty").textContent = wastedQty.toFixed(2);
  document.getElementById("atRiskQty").textContent = atRiskQty.toFixed(2);
  document.getElementById("usedAfterExpiryQty").textContent = usedAfterExpiryQty.toFixed(2);
  document.getElementById("savedValue").textContent = savedValue.toFixed(2);
  document.getElementById("wastedValue").textContent = wastedValue.toFixed(2);
  document.getElementById("wasteAvoidedPercent").textContent = `${wasteAvoidedPercent.toFixed(1)}%`;
  document.getElementById("wasteProgressFill").style.width = `${wasteAvoidedPercent}%`;
}

async function sendTestEmail() {
  try {
    const data = await APP.apiFetch("/admin/test-email", { method: "POST" });
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
}

async function triggerExpiryAlerts() {
  try {
    const data = await APP.apiFetch("/admin/trigger-expiry-alerts", { method: "POST" });
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  APP.clearSession();
  window.location.href = "login.html";
}

window.logout = logout;
window.sendTestEmail = sendTestEmail;
window.triggerExpiryAlerts = triggerExpiryAlerts;
