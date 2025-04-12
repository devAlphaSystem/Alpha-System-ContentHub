document.addEventListener("DOMContentLoaded", () => {
  window.escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  const confirmModal = document.getElementById("confirm-modal");
  const confirmModalTitle = document.getElementById("modal-title");
  const confirmModalMessage = document.getElementById("modal-message");
  const confirmModalConfirmBtn = document.getElementById("modal-confirm-btn");
  const confirmModalCancelBtn = document.getElementById("modal-cancel-btn");
  const confirmModalCloseBtn = document.getElementById("modal-close-btn");

  const alertModal = document.getElementById("alert-modal");
  const alertModalTitle = document.getElementById("alert-modal-title");
  const alertModalMessage = document.getElementById("alert-modal-message");
  const alertModalOkBtn = document.getElementById("alert-modal-ok-btn");
  const alertModalCloseBtn = document.getElementById("alert-modal-close-btn");

  const themeToggleButton = document.getElementById("theme-toggle");

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  const mobileNavBackdrop = document.getElementById("mobile-nav-backdrop");

  window.showConfirmModal = (options) => {
    const { title, message, confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel, action = "confirm", details, form } = options;

    if (confirmModalTitle) confirmModalTitle.textContent = title || "Confirm Action";
    if (confirmModalMessage) confirmModalMessage.innerHTML = message || "Are you sure?";

    if (confirmModalConfirmBtn) {
      confirmModalConfirmBtn.removeAttribute("data-is-bulk");
      confirmModalConfirmBtn.removeAttribute("data-bulk-action");
      confirmModalConfirmBtn.removeAttribute("data-bulk-ids");

      const isBulk = action?.startsWith("bulk");
      if (isBulk && details) {
        confirmModalConfirmBtn.dataset.isBulk = "true";
        confirmModalConfirmBtn.dataset.bulkAction = details.action;
        confirmModalConfirmBtn.dataset.bulkIds = JSON.stringify(details.ids);
      }

      let btnClass = "btn ";
      let btnIcon = "";
      const isDeleteStyle = action === "delete" || action === "bulk-delete";
      const isPublishStyle = action === "publish-staged" || action === "bulk-publish-staged";

      if (isDeleteStyle) {
        btnClass += "btn-danger";
        btnIcon = '<i class="fas fa-trash-alt"></i> ';
      } else if (isPublishStyle) {
        btnClass += "btn-success";
        btnIcon = '<i class="fas fa-upload"></i> ';
      } else {
        btnClass += "btn-primary";
      }
      confirmModalConfirmBtn.className = btnClass;
      confirmModalConfirmBtn.innerHTML = `${btnIcon}${escapeHtml(confirmText)}`;
    }

    if (confirmModalCancelBtn) confirmModalCancelBtn.textContent = cancelText;

    if (confirmModal) {
      confirmModal.classList.add("is-visible");
      confirmModal.setAttribute("aria-hidden", "false");
      confirmModal._onConfirm = onConfirm;
      confirmModal._onCancel = onCancel;
      confirmModal._formToSubmit = form || null;
    }
  };

  window.hideConfirmModal = () => {
    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = undefined;
      confirmModal._onCancel = undefined;
      confirmModal._formToSubmit = undefined;
      if (confirmModalConfirmBtn) {
        confirmModalConfirmBtn.removeAttribute("data-is-bulk");
        confirmModalConfirmBtn.removeAttribute("data-bulk-action");
        confirmModalConfirmBtn.removeAttribute("data-bulk-ids");
      }
    }
  };

  window.showAlertModal = (message, title = "Notification") => {
    if (alertModalMessage) alertModalMessage.innerHTML = message;
    if (alertModalTitle) alertModalTitle.textContent = title;
    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");
    }
  };

  window.hideAlertModal = () => {
    if (alertModal) {
      alertModal.classList.remove("is-visible");
      alertModal.setAttribute("aria-hidden", "true");
    }
  };

  const applyTheme = (theme) => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    for (const cm of document.querySelectorAll(".EasyMDEContainer .CodeMirror")) {
      cm.classList.toggle("cm-s-easymde-dark", theme === "dark");
    }
  };

  async function setThemePreference(theme) {
    applyTheme(theme);

    try {
      localStorage.setItem("theme", theme);
    } catch (e) {
      console.warn("Could not save theme to localStorage:", e);
    }

    try {
      const response = await fetch("/api/set-theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ theme: theme }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to set theme preference on server:", response.status, errorData.error || response.statusText);
        showAlertModal("Could not save your theme preference to the server.", "Theme Error");
      }
    } catch (error) {
      console.error("Network error sending theme preference:", error);
      showAlertModal("Network error saving your theme preference.", "Theme Error");
    }
  }

  confirmModalConfirmBtn?.addEventListener("click", () => {
    if (confirmModal?._formToSubmit) {
      confirmModal._formToSubmit.submit();
    } else if (confirmModal?._onConfirm) {
      confirmModal._onConfirm();
    }
    hideConfirmModal();
  });

  confirmModalCancelBtn?.addEventListener("click", () => {
    if (confirmModal?._onCancel) {
      confirmModal._onCancel();
    }
    hideConfirmModal();
  });

  confirmModalCloseBtn?.addEventListener("click", hideConfirmModal);

  confirmModal?.addEventListener("click", (event) => {
    if (event.target === confirmModal) hideConfirmModal();
  });

  alertModalOkBtn?.addEventListener("click", hideAlertModal);
  alertModalCloseBtn?.addEventListener("click", hideAlertModal);
  alertModal?.addEventListener("click", (event) => {
    if (event.target === alertModal) hideAlertModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (confirmModal?.classList.contains("is-visible")) {
        hideConfirmModal();
      } else if (alertModal?.classList.contains("is-visible")) {
        hideAlertModal();
      }
      const detailsModal = document.getElementById("details-modal");
      if (detailsModal?.classList.contains("is-visible")) {
        detailsModal.classList.remove("is-visible");
        detailsModal.setAttribute("aria-hidden", "true");
      }
      if (sidebar?.classList.contains("is-open")) {
        sidebar.classList.remove("is-open");
        mobileNavBackdrop?.classList.remove("is-visible");
        document.body.classList.remove("mobile-menu-open");
      }
    }
  });

  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  mobileNavToggle?.addEventListener("click", () => {
    const isOpen = sidebar?.classList.toggle("is-open");
    mobileNavBackdrop?.classList.toggle("is-visible", isOpen);
    document.body.classList.toggle("mobile-menu-open", isOpen);
  });

  mobileNavBackdrop?.addEventListener("click", () => {
    sidebar?.classList.remove("is-open");
    mobileNavBackdrop.classList.remove("is-visible");
    document.body.classList.remove("mobile-menu-open");
  });

  const savedTheme = localStorage.getItem("theme");
  const serverTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  applyTheme(savedTheme || serverTheme);

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-inner .nav-link");
  let activeLinkFound = false;
  for (const link of sidebarLinks) {
    link.classList.remove("active");
    const navId = link.dataset.navId;
    const href = link.getAttribute("href");

    if (href === currentPath) {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "dashboard" && (currentPath === "/" || currentPath.startsWith("/edit/") || currentPath === "/new")) {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "templates" && currentPath.startsWith("/templates")) {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "headers" && currentPath.startsWith("/headers")) {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "footers" && currentPath.startsWith("/footers")) {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "archived" && currentPath === "/archived") {
      link.classList.add("active");
      activeLinkFound = true;
    } else if (navId === "audit-log" && currentPath === "/audit-log") {
      link.classList.add("active");
      activeLinkFound = true;
    }
  }

  if (!activeLinkFound && currentPath !== "/login") {
    const dashboardLink = document.querySelector('.sidebar-nav .nav-link[data-nav-id="dashboard"]');
    dashboardLink?.classList.add("active");
  }
});
