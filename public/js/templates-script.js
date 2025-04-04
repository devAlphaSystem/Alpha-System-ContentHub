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
  const refreshButton = document.getElementById("refresh-templates-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");

  let formToSubmit = null;
  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;

  /**
   * Escapes HTML special characters in a string.
   * @param {string} unsafe The potentially unsafe string.
   * @returns {string} The escaped string.
   */
  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  /**
   * Shows the confirmation modal.
   * @param {object} options Configuration options for the modal.
   * @param {HTMLFormElement} [options.form] The form to submit on confirmation.
   * @param {string} [options.title] Modal title.
   * @param {string} [options.message] Modal message (HTML allowed).
   * @param {string} [options.action='delete'] Type of action ('delete', etc.).
   * @param {string} [options.confirmText='Confirm'] Text for the confirm button.
   * @param {string} [options.cancelText='Cancel'] Text for the cancel button.
   * @param {function} [options.onConfirm] Callback function on confirm.
   * @param {function} [options.onCancel] Callback function on cancel.
   */
  function showConfirmModal(options) {
    const { form, title, message, action = "delete", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    formToSubmit = form || null;

    if (modalTitle) modalTitle.textContent = title || (action === "delete" ? "Confirm Deletion" : "Confirm Action");
    if (modalMessage) modalMessage.innerHTML = message || "Are you sure?";

    if (modalConfirmBtn) {
      const isDelete = action === "delete";
      modalConfirmBtn.className = `btn ${isDelete ? "btn-danger" : "btn-primary"}`;
      modalConfirmBtn.textContent = confirmText;
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

  /**
   * Hides the confirmation modal.
   */
  function hideConfirmModal() {
    formToSubmit = null;

    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = null;
      confirmModal._onCancel = null;
    }
  }

  /**
   * Shows the alert modal.
   * @param {string} message The message to display (HTML allowed).
   * @param {string} [title='Notification'] The title of the alert modal.
   */
  function showAlertModal(message, title = "Notification") {
    if (alertModalMessage) alertModalMessage.innerHTML = message;
    if (alertModalTitle) alertModalTitle.textContent = title;
    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");
    }
  }

  /**
   * Hides the alert modal.
   */
  function hideAlertModal() {
    if (alertModal) {
      alertModal.classList.remove("is-visible");
      alertModal.setAttribute("aria-hidden", "true");
    }
  }

  /**
   * Renders a single table row for a template.
   * @param {object} template The template data object.
   * @returns {string} The HTML string for the table row.
   */
  function renderTableRow(template) {
    const formattedUpdated =
      template.formattedUpdated ||
      new Date(template.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const updatedTimestamp = new Date(template.updated).getTime();

    return `
      <tr data-template-id="${escapeHtml(template.id)}" data-updated-timestamp="${updatedTimestamp}">
        <td data-label="Name">${escapeHtml(template.name)}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="/templates/edit/${escapeHtml(template.id)}" class="btn btn-icon btn-edit" title="Edit Template"><i class="fas fa-pencil-alt"></i></a>
          <form action="/templates/delete/${escapeHtml(template.id)}" method="POST" class="delete-template-form" title="Delete Template"><button type="submit" class="btn btn-icon btn-delete"><i class="fas fa-trash-alt"></i></button></form>
        </td>
      </tr>
    `;
  }

  /**
   * Updates the pagination controls (buttons and info text).
   */
  function updatePaginationControls() {
    if (!paginationControls) return;

    if (totalItems === 0) {
      paginationControls.style.display = "none";
      return;
    }

    paginationControls.style.display = "flex";
    if (pageInfo) {
      pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} items)`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = currentPage <= 1 || isLoading;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = currentPage >= totalPages || isLoading;
    }
  }

  /**
   * Renders the table body with the provided templates.
   * @param {Array<object>} templates Array of template objects for the current page.
   */
  function renderTable(templates) {
    if (!templatesTableBody || !tableElement) return;

    templatesTableBody.innerHTML = "";

    if (templates.length > 0) {
      let tableHtml = "";
      for (const template of templates) {
        tableHtml += renderTableRow(template);
      }
      templatesTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
      const noMatchRow = templatesTableBody.querySelector(".no-match-row");
      if (noMatchRow) noMatchRow.remove();
    } else if (totalItems > 0) {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 3;
      templatesTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No templates found for this page.</td></tr>`;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    attachDeleteListeners();
  }

  /**
   * Fetches templates from the API based on current state.
   */
  async function fetchTemplates() {
    if (isLoading) return;
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const url = `/api/templates?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      currentPage = data.page;
      totalPages = data.totalPages;
      totalItems = data.totalItems;

      renderTable(data.items);
      updatePaginationControls();
    } catch (error) {
      console.error("Failed to fetch templates:", error);
      showAlertModal("Error loading templates. Please try refreshing the page.", "Loading Error");
      if (templatesTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 3;
        templatesTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading templates.</td></tr>`;
      }
      currentPage = 1;
      totalPages = 0;
      totalItems = 0;
      updatePaginationControls();
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    } finally {
      isLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = `<i class="fas fa-sync-alt"></i> <span>Refresh</span>`;
      }
      updatePaginationControls();
    }
  }

  /**
   * Handles the submission event for delete forms.
   * @param {Event} event The form submission event.
   */
  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.classList.contains("delete-template-form")) {
      const name = form.closest("tr")?.querySelector("td[data-label='Name']")?.textContent || "this template";
      const message = `Are you sure you want to delete the template "<strong>${escapeHtml(name)}</strong>"?<br>This action cannot be undone.`;
      showConfirmModal({
        form: form,
        title: "Confirm Deletion",
        message: message,
        action: "delete",
        confirmText: "Delete",
      });
    }
  }

  /**
   * Attaches submit event listeners to all delete forms.
   */
  function attachDeleteListeners() {
    const deleteTemplateForms = document.querySelectorAll("form.delete-template-form");
    for (const form of deleteTemplateForms) {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    }
  }

  /**
   * Attaches click event listeners to sortable table headers.
   */
  function attachSortListeners() {
    const sortableHeaders = document.querySelectorAll(".data-table th[data-sort-key]");
    for (const header of sortableHeaders) {
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);
      newHeader.addEventListener("click", () => {
        if (isLoading) return;

        const sortKey = newHeader.dataset.sortKey;
        let newSortDir;

        if (sortKey === currentSortKey) {
          newSortDir = currentSortDir === "asc" ? "desc" : "asc";
        } else {
          newSortDir = "asc";
        }

        currentSortKey = sortKey;
        currentSortDir = newSortDir;
        currentPage = 1;

        const allHeaders = document.querySelectorAll(".data-table th[data-sort-key]");
        for (const h of allHeaders) {
          const icon = h.querySelector(".sort-icon i");
          if (!icon) continue;
          if (h.dataset.sortKey === currentSortKey) {
            icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
          } else {
            icon.className = "fas fa-sort";
          }
        }

        fetchTemplates();
      });
    }
  }

  /**
   * Applies the selected theme (light/dark).
   * @param {string} theme The theme name ('light' or 'dark').
   */
  const applyTheme = (theme) => {
    document.body.classList.toggle("dark-mode", theme === "dark");
  };

  /**
   * Sets the theme preference locally and on the server.
   * @param {string} theme The theme name ('light' or 'dark').
   */
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
  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) {
      fetchTemplates();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchTemplates();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchTemplates();
    }
  });

  const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${currentSortKey}"]`);
  if (initialSortHeader) {
    const icon = initialSortHeader.querySelector(".sort-icon i");
    if (icon) {
      icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
    }
  }

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");
  for (const link of sidebarLinks) {
    link.classList.remove("active");
    const navId = link.dataset.navId;
    if ((currentPath === "/" || currentPath.startsWith("/edit/")) && navId === "dashboard") {
      link.classList.add("active");
    } else if (currentPath === "/new" && navId === "create") {
      link.classList.add("active");
    } else if (currentPath.startsWith("/templates") && navId === "templates") {
      link.classList.add("active");
    }
  }

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  mobileNavToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("is-open");
  });

  attachDeleteListeners();
  attachSortListeners();

  const initialPaginationData = document.querySelector(".pagination-controls");
  if (initialPaginationData) {
    try {
      const pageInfoText = document.getElementById("page-info")?.textContent || "";
      const pageMatch = pageInfoText.match(/Page (\d+) of (\d+)/);
      const itemsMatch = pageInfoText.match(/\((\d+) items\)/);
      if (pageMatch) {
        currentPage = Number.parseInt(pageMatch[1], 10);
        totalPages = Number.parseInt(pageMatch[2], 10);
      }
      if (itemsMatch) {
        totalItems = Number.parseInt(itemsMatch[1], 10);
      }
    } catch (e) {
      console.warn("Could not parse initial pagination state from EJS.");
    }
  }

  updatePaginationControls();

  if (templatesTableBody && templatesTableBody.children.length === 0 && (!emptyStateCard?.style.display || emptyStateCard?.style.display === "none")) {
    fetchTemplates();
  }
});
