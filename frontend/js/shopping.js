document.addEventListener("DOMContentLoaded", async () => {
  if (!APP.requireAuth()) return;
  const form = document.getElementById("shoppingForm");
  if (form) {
    form.addEventListener("submit", addShoppingItem);
  }
  await loadShoppingList();
});

async function loadShoppingList() {
  try {
    const data = await APP.apiFetch("/items/shopping/list");
    const tbody = document.getElementById("shoppingBody");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = "<tr><td colspan='4'>No items to buy.</td></tr>";
      return;
    }

    data.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${item.qtyNeeded}</td>
        <td><button onclick="removeItem('${item._id}')">Bought</button></td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    alert(err.message);
  }
}

async function removeItem(id) {
  try {
    await APP.apiFetch(`/items/shopping/${id}`, { method: "DELETE" });
    await loadShoppingList();
  } catch (err) {
    alert(err.message);
  }
}

async function addShoppingItem(event) {
  event.preventDefault();

  const name = document.getElementById("shoppingName").value.trim();
  const category = document.getElementById("shoppingCategory").value;
  const qtyNeeded = Number(document.getElementById("shoppingQtyNeeded").value);

  try {
    const data = await APP.apiFetch("/items/shopping", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, category, qtyNeeded })
    });

    alert(data.message || "Added to shopping list");
    event.target.reset();
    document.getElementById("shoppingQtyNeeded").value = 1;
    await loadShoppingList();
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  APP.clearSession();
  window.location.href = "login.html";
}

window.removeItem = removeItem;
window.logout = logout;
