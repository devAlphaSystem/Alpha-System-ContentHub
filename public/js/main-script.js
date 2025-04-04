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

  let formToSubmit = null;
  let bulkActionDetails = null;
  let currentFilterState = "all";

  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  function showConfirmModal(options) {
    const { form, title, message, action = "delete", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    formToSubmit = form || null;
    bulkActionDetails = action === "bulk" ? options.details : null;

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
    bulkActionDetails = null;

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

  function updateFilterButtonUI(state) {
    if (!filterDraftOption || !filterPublishedOption) return;

    filterDraftOption.classList.remove("active");
    filterPublishedOption.classList.remove("active");

    if (state === "all") {
      filterDraftOption.classList.add("active");
      filterPublishedOption.classList.add("active");
    } else if (state === "draft") {
      filterDraftOption.classList.add("active");
    } else if (state === "published") {
      filterPublishedOption.classList.add("active");
    }
  }

  function applyTableFilter(state) {
    if (!entriesTableBody || state === undefined) return;

    const rows = entriesTableBody.querySelectorAll("tr");
    let visibleCount = 0;

    for (const row of rows) {
      if (!row.dataset.entryId) {
        continue;
      }

      const statusElement = row.querySelector("td[data-label='Status'] span");
      const rowStatus = statusElement ? statusElement.textContent.toLowerCase().trim() : null;

      let shouldShow = false;
      if (state === "all") {
        shouldShow = true;
      } else if (state === "draft") {
        shouldShow = rowStatus === "draft";
      } else if (state === "published") {
        shouldShow = rowStatus === "published";
      }

      row.style.display = shouldShow ? "" : "none";

      if (shouldShow) {
        visibleCount++;
      }
    }

    if (selectAllCheckbox) {
      const checkedVisibleCheckboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox:checked").length;
      const totalVisibleCheckboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox").length;

      selectAllCheckbox.checked = totalVisibleCheckboxes > 0 && checkedVisibleCheckboxes === totalVisibleCheckboxes;
      selectAllCheckbox.indeterminate = checkedVisibleCheckboxes > 0 && checkedVisibleCheckboxes < totalVisibleCheckboxes;
    }

    const emptyStateCard = document.querySelector(".empty-state-card");
    const dataCard = document.querySelector(".data-card");
    const hasAnyEntries = document.querySelectorAll("#entries-table-body tr[data-entry-id]").length > 0;

    if (dataCard) dataCard.style.display = hasAnyEntries ? "" : "none";
    if (emptyStateCard) emptyStateCard.style.display = hasAnyEntries ? "none" : "";

    const noMatchRow = entriesTableBody.querySelector(".no-match-row");
    if (noMatchRow) noMatchRow.remove();

    if (hasAnyEntries && visibleCount === 0) {
      const colSpan = entriesTableBody.closest("table")?.querySelector("thead tr")?.childElementCount || 9;
      if (!entriesTableBody.querySelector(".no-match-row")) {
        entriesTableBody.insertAdjacentHTML("beforeend", `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries match the current filter.</td></tr>`);
      }
    }
  }

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

  function attachDeleteListeners() {
    const deleteEntryForms = document.querySelectorAll("form.delete-form");
    for (const form of deleteEntryForms) {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    }
  }

  modalConfirmBtn?.addEventListener("click", () => {
    if (formToSubmit) {
      formToSubmit.submit();
    } else if (bulkActionDetails) {
      handleBulkActionConfirm(bulkActionDetails.action, bulkActionDetails.ids);
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

  selectAllCheckbox?.addEventListener("change", (event) => {
    const checkboxes = entriesTableBody.querySelectorAll("tr:not([style*='display: none']) .entry-checkbox");
    for (const checkbox of checkboxes) {
      checkbox.checked = event.target.checked;
    }
    updateBulkActionUI();
  });

  function attachEntryCheckboxListeners() {
    entriesTableBody?.removeEventListener("change", handleCheckboxChange);
    entriesTableBody?.addEventListener("change", handleCheckboxChange);
  }

  function handleCheckboxChange(event) {
    if (event.target.classList.contains("entry-checkbox")) {
      updateBulkActionUI();
    }
  }

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
      const selectedCheckboxes = document.querySelectorAll(".entry-checkbox:checked");
      const selectedIds = [];
      for (const cb of selectedCheckboxes) {
        selectedIds.push(cb.value);
      }

      if (action && selectedIds.length > 0) {
        bulkActionsMenu.classList.remove("show");
        showConfirmModal({
          details: { action, ids: selectedIds },
          title: "Confirm Bulk Action",
          message: `Are you sure you want to perform the action '<strong>${escapeHtml(action)}</strong>' on <strong>${selectedIds.length}</strong> item(s)?`,
          action: "bulk",
          confirmText: "Confirm",
        });
      }
    }
  });

  async function handleBulkActionConfirm(action, ids) {
    if (!bulkActionsButton) return;
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
        console.error("Bulk action failed:", result);
        showAlertModal(`Error: ${result.error || result.message || "Bulk action failed."}`, "Bulk Action Error");
      } else {
        console.log("Bulk action result:", result);
        refreshButton?.click();
      }
    } catch (error) {
      console.error("Error performing bulk action:", error);
      showAlertModal("An unexpected error occurred during the bulk action.", "Bulk Action Error");
    } finally {
      bulkActionsButton.disabled = false;
      bulkActionsButton.innerHTML = originalButtonText;
      updateBulkActionUI();
    }
  }

  refreshButton?.addEventListener("click", async () => {
    if (refreshButton.disabled) return;

    const originalButtonHtml = refreshButton.innerHTML;
    refreshButton.disabled = true;
    refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;

    try {
      const response = await fetch("/api/entries");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const entries = await response.json();

      if (!entriesTableBody) return;
      entriesTableBody.innerHTML = "";

      const emptyStateCard = document.querySelector(".empty-state-card");
      const dataCard = document.querySelector(".data-card");

      if (entries.length > 0) {
        for (const entry of entries) {
          const rowHtml = renderTableRow(entry);
          entriesTableBody.insertAdjacentHTML("beforeend", rowHtml);
        }
        if (dataCard) dataCard.style.display = "";
        if (emptyStateCard) emptyStateCard.style.display = "none";
      } else {
        if (dataCard) dataCard.style.display = "none";
        if (emptyStateCard) emptyStateCard.style.display = "";
      }

      attachDeleteListeners();
      attachEntryCheckboxListeners();
      attachSortListeners();
      applyTableFilter(currentFilterState);
    } catch (error) {
      console.error("Failed to refresh entries:", error);
      if (entriesTableBody) {
        const colSpan = entriesTableBody.closest("table")?.querySelector("thead tr")?.childElementCount || 9;
        entriesTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>`;
      }
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = originalButtonHtml;
      }
      updateBulkActionUI();
    }
  });

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

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}" data-updated-timestamp="${entry.updated}" data-views-value="${entry.views || 0}">
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

        if (!tableBody || tableBody.id !== "entries-table-body") return;

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
          if (row.dataset.entryId) {
            tableData.push({
              id: row.dataset.entryId,
              title: row.querySelector("td[data-label='Title']")?.textContent.trim(),
              status: row.querySelector("td[data-label='Status']")?.textContent.trim(),
              type: row.querySelector("td[data-label='Type']")?.textContent.trim(),
              domain: row.querySelector("td[data-label='Domain']")?.textContent.trim(),
              views: Number.parseInt(row.dataset.viewsValue, 10) || 0,
              updated: Number.parseInt(row.dataset.updatedTimestamp, 10),
              html: row.innerHTML,
            });
          }
        }

        tableData.sort((a, b) => {
          let valA;
          let valB;

          switch (sortKey) {
            case "title":
            case "status":
            case "type":
            case "domain":
              valA = a[sortKey]?.toLowerCase() || "";
              valB = b[sortKey]?.toLowerCase() || "";
              break;
            case "views":
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
          row.dataset.entryId = item.id;
          row.dataset.updatedTimestamp = item.updated;
          row.dataset.viewsValue = item.views;
          row.innerHTML = item.html;
          tableBody.appendChild(row);
        }

        applyTableFilter(currentFilterState);
        attachDeleteListeners();
        attachEntryCheckboxListeners();
        updateBulkActionUI();
      });
    }
  }

  statusFilterBtn?.addEventListener("click", () => {
    if (currentFilterState === "all") {
      currentFilterState = "draft";
    } else if (currentFilterState === "draft") {
      currentFilterState = "published";
    } else {
      currentFilterState = "all";
    }
    updateFilterButtonUI(currentFilterState);
    applyTableFilter(currentFilterState);
    updateBulkActionUI();
  });

  updateFilterButtonUI(currentFilterState);
  applyTableFilter(currentFilterState);
  attachDeleteListeners();
  attachEntryCheckboxListeners();
  attachSortListeners();
  updateBulkActionUI();
});
