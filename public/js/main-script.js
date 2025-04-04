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

  const statusFilterBtn = document.getElementById("status-filter-btn");
  const filterDraftOption = document.getElementById("filter-draft");
  const filterPublishedOption = document.getElementById("filter-published");
  const entriesTableBody = document.getElementById("entries-table-body");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  const refreshButton = document.getElementById("refresh-entries-btn");
  const bulkActionsContainer = document.getElementById("bulk-actions-container");
  const bulkSelectedCount = document.getElementById("bulk-selected-count");
  const bulkActionsButton = document.getElementById("bulk-actions-button");
  const bulkActionsMenu = document.getElementById("bulk-actions-menu");

  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");

  let formToSubmit = null;
  const currentFilterState = { draft: true, published: true };
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
   * @param {string} [options.action='delete'] Type of action ('delete', 'bulk', etc.).
   * @param {string} [options.confirmText='Confirm'] Text for the confirm button.
   * @param {string} [options.cancelText='Cancel'] Text for the cancel button.
   * @param {function} [options.onConfirm] Callback function on confirm.
   * @param {function} [options.onCancel] Callback function on cancel.
   * @param {object} [options.details] Extra details (e.g., for bulk actions).
   */
  function showConfirmModal(options) {
    const { form, title, message, action = "delete", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel, details } = options;

    formToSubmit = form || null;

    if (modalConfirmBtn) {
      modalConfirmBtn.removeAttribute("data-is-bulk");
      modalConfirmBtn.removeAttribute("data-bulk-action");
      modalConfirmBtn.removeAttribute("data-bulk-ids");
    }

    const isBulk = action === "bulk" || action === "bulk-delete";
    if (isBulk && details) {
      if (modalConfirmBtn) {
        modalConfirmBtn.dataset.isBulk = "true";
        modalConfirmBtn.dataset.bulkAction = details.action;
        modalConfirmBtn.dataset.bulkIds = JSON.stringify(details.ids);
      }
    }

    if (modalTitle) modalTitle.textContent = title || (action === "delete" ? "Confirm Deletion" : "Confirm Action");
    if (modalMessage) modalMessage.innerHTML = message || "Are you sure?";

    if (modalConfirmBtn) {
      const isDeleteStyle = action === "delete" || action === "bulk-delete";
      modalConfirmBtn.className = `btn ${isDeleteStyle ? "btn-danger" : "btn-primary"}`;
      modalConfirmBtn.textContent = confirmText;
      if (isDeleteStyle) {
        modalConfirmBtn.innerHTML = `<i class="fas fa-trash-alt"></i> ${escapeHtml(confirmText)}`;
      }
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

    if (modalConfirmBtn) {
      modalConfirmBtn.removeAttribute("data-is-bulk");
      modalConfirmBtn.removeAttribute("data-bulk-action");
      modalConfirmBtn.removeAttribute("data-bulk-ids");
    }

    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = undefined;
      confirmModal._onCancel = undefined;
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
   * Updates the visual state of the status filter buttons.
   */
  function updateFilterButtonUI() {
    if (!filterDraftOption || !filterPublishedOption) return;
    filterDraftOption.classList.toggle("active", currentFilterState.draft);
    filterPublishedOption.classList.toggle("active", currentFilterState.published);
  }

  /**
   * Renders a single table row for an entry.
   * @param {object} entry The entry data object.
   * @returns {string} The HTML string for the table row.
   */
  function renderTableRow(entry) {
    const formattedUpdated =
      entry.formattedUpdated ||
      new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const viewUrl = entry.viewUrl || `/view/${escapeHtml(entry.id)}`;
    let tagsHtml = '<span class="text-muted">-</span>';
    if (entry.tags?.trim()) {
      const tagsArray = entry.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag);
      tagsHtml = "";
      for (const tag of tagsArray) {
        tagsHtml += `<span class="badge tag-badge">${escapeHtml(tag)}</span> `;
      }
      tagsHtml = tagsHtml.trim();
    }
    const updatedTimestamp = new Date(entry.updated).getTime();

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}" data-updated-timestamp="${updatedTimestamp}" data-views-value="${entry.views || 0}">
        <td class="checkbox-column"><input type="checkbox" class="entry-checkbox" value="${escapeHtml(entry.id)}"></td>
        <td data-label="Title">${escapeHtml(entry.title)}</td>
        <td data-label="Status"><span class="badge status-badge status-${escapeHtml(entry.status.toLowerCase())}">${escapeHtml(entry.status)}</span></td>
        <td data-label="Type"><span class="badge type-badge type-${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span></td>
        <td data-label="Tags" class="tags-cell">${tagsHtml}</td>
        <td data-label="Domain">${escapeHtml(entry.domain)}</td>
        <td data-label="Views">${entry.views || 0}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="${viewUrl}" target="_blank" class="btn btn-icon btn-view" title="View Public Page"><i class="fas fa-eye"></i></a>
          <a href="/edit/${escapeHtml(entry.id)}" class="btn btn-icon btn-edit" title="Edit Entry"><i class="fas fa-pencil-alt"></i></a>
          <form action="/delete/${escapeHtml(entry.id)}" method="POST" class="delete-form" title="Delete Entry"><button type="submit" class="btn btn-icon btn-delete"><i class="fas fa-trash-alt"></i></button></form>
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
   * Renders the table body with the provided entries.
   * @param {Array<object>} entries Array of entry objects for the current page.
   */
  function renderTable(entries) {
    if (!entriesTableBody || !tableElement) return;

    entriesTableBody.innerHTML = "";

    if (entries.length > 0) {
      let tableHtml = "";
      for (const entry of entries) {
        tableHtml += renderTableRow(entry);
      }
      entriesTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
      const noMatchRow = entriesTableBody.querySelector(".no-match-row");
      if (noMatchRow) noMatchRow.remove();
    } else if (totalItems > 0) {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 9;
      entriesTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries match the current criteria.</td></tr>`;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    attachDeleteListeners();
    updateBulkActionUI();
  }

  /**
   * Fetches entries from the API based on current state.
   */
  async function fetchEntries() {
    if (isLoading) return;
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    if (selectAllCheckbox) selectAllCheckbox.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const url = `/api/entries?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}`;

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
      applyTableFilter();
    } catch (error) {
      console.error("Failed to fetch entries:", error);
      showAlertModal("Error loading entries. Please try refreshing the page.", "Loading Error");
      if (entriesTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 9;
        entriesTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>`;
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
      if (selectAllCheckbox) selectAllCheckbox.disabled = false;
      updatePaginationControls();
    }
  }

  /**
   * Applies the current status filter to the visible rows in the table.
   */
  function applyTableFilter() {
    if (!entriesTableBody) return;

    const rows = entriesTableBody.querySelectorAll("tr[data-entry-id]");
    let visibleCount = 0;
    const showDraft = currentFilterState.draft;
    const showPublished = currentFilterState.published;

    for (const row of rows) {
      const statusElement = row.querySelector("td[data-label='Status'] span");
      const rowStatus = statusElement ? statusElement.textContent.toLowerCase().trim() : null;

      let shouldShow = false;
      if (rowStatus === "draft" && showDraft) {
        shouldShow = true;
      } else if (rowStatus === "published" && showPublished) {
        shouldShow = true;
      }

      row.style.display = shouldShow ? "" : "none";
      if (shouldShow) {
        visibleCount++;
      }
    }

    const noMatchRow = entriesTableBody.querySelector(".no-match-row");
    if (noMatchRow) noMatchRow.remove();

    if (rows.length > 0 && visibleCount === 0) {
      const colSpan = tableElement?.querySelector("thead tr")?.childElementCount || 9;
      if (!entriesTableBody.querySelector(".no-match-row")) {
        entriesTableBody.insertAdjacentHTML("beforeend", `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries match the current filter.</td></tr>`);
      }
    }

    updateBulkActionUI();
  }

  /**
   * Handles the submission event for delete forms.
   * @param {Event} event The form submission event.
   */
  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.classList.contains("delete-form")) {
      const title = form.closest("tr")?.querySelector("td[data-label='Title']")?.textContent || "this entry";
      const message = `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`;
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
    const deleteEntryForms = document.querySelectorAll("form.delete-form");
    for (const form of deleteEntryForms) {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    }
  }

  /**
   * Updates the visibility and count of the bulk action bar.
   */
  function updateBulkActionUI() {
    if (!entriesTableBody) return;
    const visibleCheckboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox");
    const checkedVisibleCheckboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox:checked");
    const count = checkedVisibleCheckboxes.length;

    if (count > 0) {
      if (bulkActionsContainer) bulkActionsContainer.style.display = "flex";
      if (bulkSelectedCount) bulkSelectedCount.textContent = count;
    } else {
      if (bulkActionsContainer) bulkActionsContainer.style.display = "none";
      if (bulkActionsMenu) bulkActionsMenu.classList.remove("show");
    }

    if (selectAllCheckbox) {
      const totalVisible = visibleCheckboxes.length;
      selectAllCheckbox.checked = totalVisible > 0 && count === totalVisible;
      selectAllCheckbox.indeterminate = count > 0 && count < totalVisible;
    }
  }

  /**
   * Handles changes to individual entry checkboxes.
   * @param {Event} event The change event.
   */
  function handleCheckboxChange(event) {
    if (event.target.classList.contains("entry-checkbox")) {
      updateBulkActionUI();
    }
  }

  /**
   * Attaches change event listeners to entry checkboxes within the table body.
   */
  function attachEntryCheckboxListeners() {
    entriesTableBody?.removeEventListener("change", handleCheckboxChange);
    entriesTableBody?.addEventListener("change", handleCheckboxChange);
  }

  /**
   * Handles the confirmation of a bulk action via the modal.
   * @param {string} action The action to perform (e.g., 'publish', 'delete').
   * @param {Array<string>} ids Array of entry IDs to perform the action on.
   */
  async function handleBulkActionConfirm(action, ids) {
    if (!bulkActionsButton || isLoading) return;
    isLoading = true;
    const originalButtonText = bulkActionsButton.innerHTML;
    bulkActionsButton.disabled = true;
    bulkActionsButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;

    try {
      const response = await fetch("/api/entries/bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, ids }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("Bulk action failed:", response.status, result);
        showAlertModal(`Error ${response.status}: ${result.error || result.message || "Bulk action failed."}`, "Bulk Action Error");
      } else {
        if (response.status === 207) {
          showAlertModal(result.message || "Action completed with some errors.", "Partial Success");
        }

        setTimeout(async () => {
          await fetchEntries();
        }, 100);
      }
    } catch (error) {
      console.error("Error performing bulk action fetch:", error);
      showAlertModal("An unexpected network or server error occurred during the bulk action.", "Bulk Action Error");
    } finally {
      isLoading = false;
      if (bulkActionsButton) {
        bulkActionsButton.disabled = false;
        bulkActionsButton.innerHTML = originalButtonText;
      }
      updateBulkActionUI();
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

        fetchEntries();
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
    const isBulk = modalConfirmBtn.dataset.isBulk === "true";
    const bulkAction = modalConfirmBtn.dataset.bulkAction;
    const bulkIdsJson = modalConfirmBtn.dataset.bulkIds;

    if (formToSubmit) {
      formToSubmit.submit();
    } else if (isBulk && bulkAction && bulkIdsJson) {
      try {
        const bulkIds = JSON.parse(bulkIdsJson);
        handleBulkActionConfirm(bulkAction, bulkIds);
      } catch (e) {
        console.error("Error parsing bulk IDs or calling handler:", e);
        showAlertModal("An error occurred processing the bulk action data.", "Error");
      }
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
      fetchEntries();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchEntries();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchEntries();
    }
  });

  selectAllCheckbox?.addEventListener("change", (event) => {
    const checkboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox");
    for (const checkbox of checkboxes) {
      checkbox.checked = event.target.checked;
    }
    updateBulkActionUI();
  });

  bulkActionsButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    bulkActionsMenu?.classList.toggle("show");
  });

  document.addEventListener("click", (event) => {
    if (!bulkActionsButton?.contains(event.target) && !bulkActionsMenu?.contains(event.target)) {
      bulkActionsMenu?.classList.remove("show");
    }
  });

  bulkActionsMenu?.addEventListener("click", (event) => {
    if (event.target.classList.contains("dropdown-item")) {
      const action = event.target.dataset.action;
      const selectedCheckboxes = entriesTableBody.querySelectorAll(".entry-checkbox:checked");
      const selectedIds = [];
      for (const cb of selectedCheckboxes) {
        selectedIds.push(cb.value);
      }

      if (action && selectedIds.length > 0) {
        bulkActionsMenu.classList.remove("show");
        const isDelete = action === "delete";
        showConfirmModal({
          details: { action, ids: selectedIds },
          title: "Confirm Bulk Action",
          message: `Are you sure you want to perform the action '<strong>${escapeHtml(action)}</strong>' on <strong>${selectedIds.length}</strong> item(s)? ${isDelete ? "<br>This action cannot be undone." : ""}`,
          action: isDelete ? "bulk-delete" : "bulk",
          confirmText: isDelete ? "Delete" : "Confirm",
        });
      }
    }
  });

  statusFilterBtn?.addEventListener("click", () => {
    if (isLoading) return;
    const wasAll = currentFilterState.draft && currentFilterState.published;
    const wasDraft = currentFilterState.draft && !currentFilterState.published;

    if (wasAll) {
      currentFilterState.draft = true;
      currentFilterState.published = false;
    } else if (wasDraft) {
      currentFilterState.draft = false;
      currentFilterState.published = true;
    } else {
      currentFilterState.draft = true;
      currentFilterState.published = true;
    }

    updateFilterButtonUI();
    applyTableFilter();
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
  attachEntryCheckboxListeners();
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

  updateFilterButtonUI();
  updatePaginationControls();
  updateBulkActionUI();

  if ((entriesTableBody && entriesTableBody.children.length === 0 && !emptyStateCard?.style.display) || emptyStateCard?.style.display === "none") {
    fetchEntries();
  }
});
