document.addEventListener("DOMContentLoaded", () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = document.querySelectorAll(
    ".auth-box, .form-box, .categories, .filter-bar, .alert-box, table, .analytics-cards, .waste-dashboard, .section-title"
  );

  targets.forEach((el, index) => {
    el.classList.add("reveal");
    setTimeout(() => {
      el.classList.add("is-visible");
    }, 70 * index);
  });
});
