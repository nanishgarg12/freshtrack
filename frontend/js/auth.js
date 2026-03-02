document.addEventListener("DOMContentLoaded", () => {
  APP.redirectIfLoggedIn();

  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");

  if (registerForm) {
    registerForm.addEventListener("submit", register);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", login);
  }
});

async function register(event) {
  event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const data = await APP.apiFetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });

    alert(data.message || "Registered successfully");
    window.location.href = "login.html";
  } catch (err) {
    alert(err.message);
  }
}

async function login(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const data = await APP.apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    APP.setToken(data.token);
    APP.setRole(data.role || "user");
    localStorage.setItem("name", data.name || "");

    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
}
