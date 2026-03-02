let currentCategory = "vegetables";

function getFilters() {
  return {
    q: document.getElementById("searchInput")?.value.trim() || "",
    expiryFilter: document.getElementById("expiryFilter")?.value || "all",
    sortBy: document.getElementById("sortBy")?.value || "expiryDate",
    sortOrder: document.getElementById("sortOrder")?.value || "asc"
  };
}

function buildItemsQuery() {
  const filters = getFilters();
  const params = new URLSearchParams();

  if (filters.q) params.append("q", filters.q);
  params.append("expiryFilter", filters.expiryFilter);
  params.append("sortBy", filters.sortBy);
  params.append("sortOrder", filters.sortOrder);

  return params.toString() ? `?${params.toString()}` : "";
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!APP.requireAuth()) return;

  const userName = localStorage.getItem("name") || "User";
  const userLabel = document.getElementById("userName");
  if (userLabel) userLabel.textContent = userName;

  const adminLink = document.getElementById("adminLink");
  if (adminLink && !APP.isAdmin()) {
    adminLink.style.display = "none";
  }

  const searchInput = document.getElementById("searchInput");
  searchInput?.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await loadItems(currentCategory);
    }
  });

  await loadItems(currentCategory);
  await loadExpiryAlerts();
});

async function loadItems(category) {
  currentCategory = category;

  const active = document.getElementById("activeCategory");
  if (active) active.textContent = category;

  try {
    const query = buildItemsQuery();
    const items = await APP.apiFetch(`/items/${category}${query}`);
    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    if (!items.length) {
      tbody.innerHTML = "<tr><td colspan='5'>No items matched your filters</td></tr>";
      return;
    }

    items.forEach((item) => {
      const daysLeft = Math.ceil(
        (new Date(item.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
      );

      const tr = document.createElement("tr");
      if (daysLeft <= 3) tr.style.background = "#fff3cd";

      const imageMarkup = item.image
        ? `<img src="/uploads/${item.image}" width="40" height="40" alt="${item.name}">`
        : "";

      tr.innerHTML = `
        <td>${imageMarkup}${item.name}</td>
        <td>${item.qty} ${item.unit || ""}</td>
        <td>${(item.price || 0).toFixed(2)}</td>
        <td>${new Date(item.expiryDate).toISOString().split("T")[0]}</td>
        <td>
          <button onclick="useItem('${category}','${item._id}')">Use</button>
          <button onclick="editItem('${category}','${item._id}',${item.qty},${item.price || 0})">Edit</button>
          <button onclick="deleteItem('${category}','${item._id}')">Delete</button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    alert(err.message);
  }
}

async function loadExpiryAlerts() {
  try {
    const data = await APP.apiFetch("/items/alerts/expiring");
    const list = document.getElementById("expiryAlerts");
    list.innerHTML = "";

    if (!data.length) {
      list.innerHTML = "<li>No items expiring in the next 3 days.</li>";
      return;
    }

    data.forEach((item) => {
      const daysLeft = Math.ceil(
        (new Date(item.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
      );

      const li = document.createElement("li");
      li.textContent = `${item.name} expires in ${Math.max(daysLeft, 0)} day(s)`;
      list.appendChild(li);
    });
  } catch (err) {
    alert(err.message);
  }
}

async function useItem(category, id) {
  const usedQty = Number(prompt("Enter quantity used:"));
  if (!usedQty) return;

  try {
    const data = await APP.apiFetch(`/items/${category}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usedQty })
    });

    alert(data.message);
    await loadItems(category);
    await loadExpiryAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function editItem(category, id, currentQty, currentPrice) {
  const newQty = prompt("Enter new quantity:", currentQty);
  if (newQty === null) return;

  const newPrice = prompt("Enter price:", currentPrice);
  if (newPrice === null) return;

  try {
    const data = await APP.apiFetch(`/items/${category}/edit/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: Number(newQty), price: Number(newPrice) })
    });

    alert(data.message);
    await loadItems(category);
    await loadExpiryAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteItem(category, id) {
  if (!confirm("Are you sure you want to delete this item?")) return;

  try {
    const data = await APP.apiFetch(`/items/${category}/${id}`, {
      method: "DELETE"
    });

    alert(data.message);
    await loadItems(category);
    await loadExpiryAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function applyFilters() {
  await loadItems(currentCategory);
}

async function clearFilters() {
  const searchInput = document.getElementById("searchInput");
  const expiryFilter = document.getElementById("expiryFilter");
  const sortBy = document.getElementById("sortBy");
  const sortOrder = document.getElementById("sortOrder");

  if (searchInput) searchInput.value = "";
  if (expiryFilter) expiryFilter.value = "all";
  if (sortBy) sortBy.value = "expiryDate";
  if (sortOrder) sortOrder.value = "asc";

  await loadItems(currentCategory);
}

function logout() {
  APP.clearSession();
  window.location.href = "login.html";
}

window.loadItems = loadItems;
window.useItem = useItem;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.logout = logout;
