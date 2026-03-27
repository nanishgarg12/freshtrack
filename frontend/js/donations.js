let activeThreadId = "";
let activeThreadMeta = null;
let messagePoller = null;
let messagesLoading = false;
let autoRefreshTimer = null;
let refreshInFlight = false;

document.addEventListener("DOMContentLoaded", async () => {
  if (!APP.requireAuth()) return;

  const userName = localStorage.getItem("name") || "User";
  const userLabel = document.getElementById("userName");
  if (userLabel) userLabel.textContent = userName;

  const adminLink = document.getElementById("adminLink");
  if (adminLink && !APP.isAdmin()) {
    adminLink.style.display = "none";
  }

  document.getElementById("donationForm")?.addEventListener("submit", postDonation);
  document.getElementById("refreshDonationsBtn")?.addEventListener("click", loadDonations);
  document.getElementById("refreshThreadsBtn")?.addEventListener("click", loadThreads);

  document.getElementById("chatForm")?.addEventListener("submit", sendMessage);
  document.getElementById("chatCloseBtn")?.addEventListener("click", closeChat);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeChat();
  });

  await refreshAll();

  autoRefreshTimer = setInterval(() => {
    refreshAll();
  }, 15000);
});

function logout() {
  APP.clearSession();
  window.location.href = "login.html";
}

window.logout = logout;

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function setChatVisible(visible) {
  const modal = document.getElementById("chatModal");
  if (!modal) return;

  modal.classList.toggle("is-open", visible);
  modal.setAttribute("aria-hidden", visible ? "false" : "true");
}

async function refreshAll() {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    await Promise.all([loadDonations(), loadThreads()]);
  } finally {
    refreshInFlight = false;
  }
}

async function postDonation(event) {
  event.preventDefault();

  const itemName = document.getElementById("donationItemName")?.value.trim() || "";
  const quantityValue = document.getElementById("donationQuantity")?.value || "";
  const quantity = Number(quantityValue);
  const unit = document.getElementById("donationUnit")?.value.trim() || "";
  const expiryDate = document.getElementById("donationExpiryDate")?.value || "";
  const location = document.getElementById("donationLocation")?.value.trim() || "";
  const notes = document.getElementById("donationNotes")?.value.trim() || "";

  if (!itemName) return alert("Food name is required");
  if (Number.isNaN(quantity) || quantity <= 0) return alert("Quantity must be greater than 0");

  const payload = {
    itemName,
    quantity,
    unit,
    location,
    notes
  };

  if (expiryDate) payload.expiryDate = expiryDate;

  try {
    const data = await APP.apiFetch("/donations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    alert(data.message || "Donation posted");
    document.getElementById("donationForm")?.reset();
    await loadDonations();
  } catch (error) {
    alert(error.message);
  }
}

async function loadDonations() {
  const container = document.getElementById("donationsList");
  if (!container) return;

  try {
    const donations = await APP.apiFetch("/donations");
    container.innerHTML = "";

    if (!donations.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No donation requests yet. Be the first to post one!";
      container.appendChild(empty);
      return;
    }

    const myId = APP.getUserId();

    donations.forEach((donation) => {
      const card = document.createElement("div");
      card.className = "donation-card";

      const title = document.createElement("h4");
      title.textContent = donation.itemName || "Donation";

      const meta = document.createElement("p");
      meta.className = "donation-meta";
      const qtyLabel = `${donation.quantity ?? ""}${donation.unit ? ` ${donation.unit}` : ""}`.trim();
      const expiry = formatShortDate(donation.expiryDate);
      meta.textContent = `Qty: ${qtyLabel}${expiry ? ` • Expiry: ${expiry}` : ""}`;

      const donorLine = document.createElement("p");
      donorLine.className = "donation-meta";
      donorLine.textContent = `Donor: ${donation.donor?.name || "User"}${donation.createdAt ? ` • ${formatWhen(donation.createdAt)}` : ""}`;

      const locationLine = document.createElement("p");
      locationLine.className = "donation-meta";
      locationLine.textContent = donation.location ? `Location: ${donation.location}` : "";

      const notesLine = document.createElement("p");
      notesLine.className = "donation-notes";
      notesLine.textContent = donation.notes ? donation.notes : "";

      const actions = document.createElement("div");
      actions.className = "donation-actions";

      const isMine = myId && String(donation.donor?._id || "") === String(myId);

      if (isMine) {
        const fulfillBtn = document.createElement("button");
        fulfillBtn.type = "button";
        fulfillBtn.textContent = "Mark Donated";
        fulfillBtn.addEventListener("click", () => fulfillDonation(donation._id));

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn-danger";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => deleteDonation(donation._id));

        actions.appendChild(fulfillBtn);
        actions.appendChild(deleteBtn);
      } else {
        const chatBtn = document.createElement("button");
        chatBtn.type = "button";
        chatBtn.textContent = "Chat";
        chatBtn.addEventListener("click", () => startChatForDonation(donation._id));
        actions.appendChild(chatBtn);
      }

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(donorLine);
      if (donation.location) card.appendChild(locationLine);
      if (donation.notes) card.appendChild(notesLine);
      card.appendChild(actions);

      container.appendChild(card);
    });
  } catch (error) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = error.message || "Failed to load donations";
    container.appendChild(empty);
  }
}

async function fulfillDonation(donationId) {
  if (!donationId) return;
  if (!confirm("Mark this donation as completed? This will remove it for everyone.")) return;

  try {
    const data = await APP.apiFetch(`/donations/${donationId}/fulfill`, { method: "POST" });
    alert(data.message || "Donation completed");

    if (activeThreadMeta?.donation?._id === donationId) {
      closeChat();
    }

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteDonation(donationId) {
  if (!donationId) return;
  if (!confirm("Delete this donation request?")) return;

  try {
    const data = await APP.apiFetch(`/donations/${donationId}`, { method: "DELETE" });
    alert(data.message || "Donation deleted");

    if (activeThreadMeta?.donation?._id === donationId) {
      closeChat();
    }

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function loadThreads() {
  const container = document.getElementById("threadsList");
  if (!container) return;

  try {
    const threads = await APP.apiFetch("/donations/threads");
    container.innerHTML = "";

    if (!threads.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No chats yet.";
      container.appendChild(empty);
      return;
    }

    threads.forEach((thread) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thread-item";

      const title = document.createElement("strong");
      title.textContent = thread.otherUser?.name ? thread.otherUser.name : "User";

      const donationLine = document.createElement("div");
      donationLine.className = "thread-meta";
      donationLine.textContent = thread.donation?.itemName ? `Donation: ${thread.donation.itemName}` : "Donation removed";

      const preview = document.createElement("div");
      preview.className = "thread-preview";
      preview.textContent = thread.lastMessageText ? thread.lastMessageText : "No messages yet.";

      const time = document.createElement("div");
      time.className = "thread-time";
      time.textContent = thread.lastMessageAt ? formatWhen(thread.lastMessageAt) : "";

      button.appendChild(title);
      button.appendChild(donationLine);
      button.appendChild(preview);
      button.appendChild(time);

      button.addEventListener("click", () => openChat(thread));

      container.appendChild(button);
    });
  } catch (error) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = error.message || "Failed to load chats";
    container.appendChild(empty);
  }
}

async function startChatForDonation(donationId) {
  if (!donationId) return;

  try {
    const data = await APP.apiFetch(`/donations/${donationId}/threads`, { method: "POST" });
    const thread = data.thread;
    if (!thread?._id) {
      return alert("Failed to start chat");
    }

    await loadThreads();
    openChat(thread);
  } catch (error) {
    alert(error.message);
  }
}

function openChat(thread) {
  if (!thread?._id) return;

  activeThreadId = thread._id;
  activeThreadMeta = thread;

  const title = document.getElementById("chatTitle");
  const subtitle = document.getElementById("chatSubtitle");

  if (title) title.textContent = `Chat with ${thread.otherUser?.name || "User"}`;
  if (subtitle) {
    subtitle.textContent = thread.donation?.itemName ? `Donation: ${thread.donation.itemName}` : "";
  }

  setChatVisible(true);
  loadMessages(true);
  startMessagePolling();

  const input = document.getElementById("chatInput");
  input?.focus();
}

function closeChat() {
  if (!activeThreadId) {
    setChatVisible(false);
    return;
  }

  stopMessagePolling();
  activeThreadId = "";
  activeThreadMeta = null;

  const messages = document.getElementById("chatMessages");
  if (messages) messages.innerHTML = "";

  setChatVisible(false);
}

function startMessagePolling() {
  stopMessagePolling();
  messagePoller = setInterval(() => {
    loadMessages(false);
  }, 3000);
}

function stopMessagePolling() {
  if (messagePoller) {
    clearInterval(messagePoller);
    messagePoller = null;
  }
}

async function loadMessages(forceScroll) {
  if (!activeThreadId) return;
  if (messagesLoading) return;

  const container = document.getElementById("chatMessages");
  if (!container) return;

  const shouldStickToBottom =
    forceScroll ||
    container.scrollTop + container.clientHeight >= container.scrollHeight - 80;

  messagesLoading = true;
  try {
    const messages = await APP.apiFetch(`/donations/threads/${activeThreadId}/messages`);
    container.innerHTML = "";

    const myId = APP.getUserId();

    messages.forEach((message) => {
      const wrap = document.createElement("div");
      wrap.className = "chat-message";

      if (myId && String(message.sender?._id || "") === String(myId)) {
        wrap.classList.add("me");
      }

      const text = document.createElement("div");
      text.className = "chat-text";
      text.textContent = message.text || "";

      const meta = document.createElement("div");
      meta.className = "chat-meta";
      const senderName = message.sender?.name || "User";
      meta.textContent = `${senderName} • ${formatWhen(message.createdAt)}`;

      wrap.appendChild(text);
      wrap.appendChild(meta);
      container.appendChild(wrap);
    });

    if (shouldStickToBottom) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (error) {
    stopMessagePolling();
    alert(error.message);
    closeChat();
  } finally {
    messagesLoading = false;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (!activeThreadId) return;

  const input = document.getElementById("chatInput");
  const text = input?.value.trim() || "";
  if (!text) return;

  try {
    await APP.apiFetch(`/donations/threads/${activeThreadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (input) input.value = "";

    await Promise.all([loadMessages(true), loadThreads()]);
  } catch (error) {
    alert(error.message);
  }
}

