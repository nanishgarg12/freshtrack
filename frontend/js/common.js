const API_BASE = `${window.location.origin}/api`;

function getToken() {
  return localStorage.getItem("token") || "";
}

function setToken(token) {
  localStorage.setItem("token", token);
}

function getRole() {
  return localStorage.getItem("role") || "user";
}

function setRole(role) {
  localStorage.setItem("role", role || "user");
}

function isAdmin() {
  return getRole() === "admin";
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("name");
  localStorage.removeItem("role");
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = "login.html";
    return false;
  }

  return true;
}

function requireAdmin() {
  if (!requireAuth()) return false;

  if (!isAdmin()) {
    window.location.href = "dashboard.html";
    return false;
  }

  return true;
}

function redirectIfLoggedIn() {
  if (getToken()) {
    window.location.href = "dashboard.html";
    return true;
  }

  return false;
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || "Request failed";

    if (response.status === 401) {
      clearSession();
      window.location.href = "login.html";
    }

    if (response.status === 403) {
      window.location.href = "dashboard.html";
    }

    throw new Error(message);
  }

  return data;
}

window.APP = {
  API_BASE,
  getToken,
  setToken,
  getRole,
  setRole,
  isAdmin,
  clearSession,
  requireAuth,
  requireAdmin,
  redirectIfLoggedIn,
  apiFetch
};
