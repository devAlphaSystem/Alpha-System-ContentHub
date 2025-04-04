document.addEventListener("DOMContentLoaded", () => {
  const confirmModal = document.getElementById("confirm-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalConfirmBtn = document.getElementById("modal-confirm-btn");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalCloseBtn = document.getElementById("modal-close-btn");

  const alertModal = document.getElementById("alert-modal");
  const alertModalTitle = document.getElementById("alert-modal-title");
  const alertModalMessage = document.getElementById("alert-modal-message");
  const alertModalOkBtn = document.getElementById("alert-modal-ok-btn");
  const alertModalCloseBtn = document.getElementById("alert-modal-close-btn");

  const templatesTableBody = document.getElementById("templates-table-body");

  let formToSubmit = null;

  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  function showConfirmModal(options) {
    const { form, title, message, action = "delete", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    formToSubmit = form || null;

    if (modalTitle) modalTitle.textContent = title || (action === "delete" ? "Confirm Deletion" : "Confirm Action");
    if (modalMessage) modalMessage.innerHTML = message || "Are you sure?";

    if (modalConfirmBtn) {
      const isDelete = action === "delete";
      modalConfirmBtn.className = `btn ${isDelete ? "btn-danger" : "btn-primary"}`;
      modalConfirmBtn.innerHTML = confirmText;
      if (isDelete) modalConfirmBtn.innerHTML = `<i class="fas fa-trash-alt"></i> ${confirmText}`;
    }

    if (modalCancelBtn) modalCancelBtn.textContent = cancelText;

    if (confirmModal) {
      confirmModal.classList.add("is-visible");
      confirmModal.setAttribute("aria-hidden", "false");
      confirmModal._onConfirm = onConfirm;
      confirmModal._onCancel = onCancel;
    }
  }

  function hideConfirmModal() {
    formToSubmit = null;

    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = null;
      confirmModal._onCancel = null;
    }
  }

  function showAlertModal(message, title = "Notification") {
    if (alertModalMessage) alertModalMessage.innerHTML = message;
    if (alertModalTitle) alertModalTitle.textContent = title;
    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");
    }
  }

  function hideAlertModal() {
    if (alertModal) {
      alertModal.classList.remove("is-visible");
      alertModal.setAttribute("aria-hidden", "true");
    }
  }

  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.classList.contains("delete-template-form")) {
      const title = form.closest("tr")?.querySelector("td[data-label='Name']")?.textContent || "this template";
      const message = `Are you sure you want to delete the template "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`;
      showConfirmModal({
        form: form,
        title: "Confirm Deletion",
        message: message,
        action: "delete",
        confirmText: "Delete",
      });
    }
  }

  function attachDeleteListeners() {
    const deleteTemplateForms = document.querySelectorAll("form.delete-template-form");
    for (const form of deleteTemplateForms) {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    }
  }

  modalConfirmBtn?.addEventListener("click", () => {
    if (formToSubmit) {
      formToSubmit.submit();
    } else if (confirmModal._onConfirm) {
      confirmModal._onConfirm();
    }
    hideConfirmModal();
  });

  modalCancelBtn?.addEventListener("click", () => {
    if (confirmModal._onCancel) {
      confirmModal._onCancel();
    }
    hideConfirmModal();
  });

  modalCloseBtn?.addEventListener("click", hideConfirmModal);

  confirmModal?.addEventListener("click", (event) => {
    if (event.target === confirmModal) {
      hideConfirmModal();
    }
  });

  alertModalOkBtn?.addEventListener("click", hideAlertModal);
  alertModalCloseBtn?.addEventListener("click", hideAlertModal);
  alertModal?.addEventListener("click", (event) => {
    if (event.target === alertModal) {
      hideAlertModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (confirmModal?.classList.contains("is-visible")) {
        hideConfirmModal();
      } else if (alertModal?.classList.contains("is-visible")) {
        hideAlertModal();
      }
    }
  });

  const themeToggleButton = document.getElementById("theme-toggle");

  const applyTheme = (theme) => {
    if (theme === "dark") {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
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
      } else {
        console.log(`Theme preference ${theme} saved to session.`);
      }
    } catch (error) {
      console.error("Network error sending theme preference:", error);
      showAlertModal("Network error saving your theme preference.", "Theme Error");
    }
  }

  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");
  for (const link of sidebarLinks) {
    link.classList.remove("active");
    if ((currentPath === "/" || currentPath.startsWith("/edit/")) && link.dataset.navId === "dashboard") {
      link.classList.add("active");
    } else if (currentPath === "/new" && link.dataset.navId === "create") {
      link.classList.add("active");
    } else if (currentPath.startsWith("/templates") && link.dataset.navId === "templates") {
      link.classList.add("active");
    }
  }

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  mobileNavToggle?.addEventListener("click", () => {
    if (sidebar) sidebar.classList.toggle("is-open");
  });

  function attachSortListeners() {
    const sortableHeaders = document.querySelectorAll(".data-table th[data-sort-key]");
    for (const header of sortableHeaders) {
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);
    }

    const newSortableHeaders = document.querySelectorAll(".data-table th[data-sort-key]");
    for (const header of newSortableHeaders) {
      header.addEventListener("click", () => {
        const table = header.closest("table");
        const tableBody = table?.querySelector("tbody");

        if (!tableBody || tableBody.id !== "templates-table-body") return;

        const sortKey = header.dataset.sortKey;
        const currentSortDir = header.dataset.sortDir || "none";
        let newSortDir;

        if (currentSortDir === "asc") {
          newSortDir = "desc";
        } else {
          newSortDir = "asc";
        }

        const allHeaders = table.querySelectorAll("th[data-sort-key]");
        for (const h of allHeaders) {
          if (h !== header) {
            h.removeAttribute("data-sort-dir");
            const icon = h.querySelector(".sort-icon i");
            if (icon) icon.className = "fas fa-sort";
          }
        }

        header.dataset.sortDir = newSortDir;
        const icon = header.querySelector(".sort-icon i");
        if (icon) {
          icon.className = newSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
        }

        const rows = Array.from(tableBody.querySelectorAll("tr"));
        const tableData = [];
        for (const row of rows) {
          if (row.dataset.templateId) {
            tableData.push({
              id: row.dataset.templateId,
              name: row.querySelector("td[data-label='Name']")?.textContent.trim(),
              updated: Number.parseInt(row.dataset.updatedTimestamp, 10),
              html: row.innerHTML,
            });
          }
        }

        tableData.sort((a, b) => {
          let valA;
          let valB;

          switch (sortKey) {
            case "name":
              valA = a[sortKey]?.toLowerCase() || "";
              valB = b[sortKey]?.toLowerCase() || "";
              break;
            case "updated":
              valA = a[sortKey];
              valB = b[sortKey];
              break;
            default:
              return 0;
          }

          if (valA < valB) {
            return newSortDir === "asc" ? -1 : 1;
          }
          if (valA > valB) {
            return newSortDir === "asc" ? 1 : -1;
          }
          return 0;
        });

        tableBody.innerHTML = "";
        for (const item of tableData) {
          const row = document.createElement("tr");
          row.dataset.templateId = item.id;
          row.dataset.updatedTimestamp = item.updated;
          row.innerHTML = item.html;
          tableBody.appendChild(row);
        }

        attachDeleteListeners();
      });
    }
  }

  attachDeleteListeners();
  attachSortListeners();
});
