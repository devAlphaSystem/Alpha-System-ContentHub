document.addEventListener("DOMContentLoaded", () => {
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

  const collectionFilterSelect = document.getElementById("collection-filter-select");
  const searchInput = document.getElementById("search-input");

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;
  let currentCollectionFilter = "";

  function renderTableRow(entry) {
    const formattedUpdated =
      entry.formattedUpdated ||
      new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    const viewUrl = entry.viewUrl || `/view/${escapeHtml(entry.id)}`;
    const updatedTimestamp = new Date(entry.updated).getTime();
    const editTitle = `Edit ${entry.has_staged_changes ? "Staged " : ""}Entry`;

    const stagedBadge = entry.has_staged_changes ? `<span class="badge status-badge status-staged" title="Unpublished changes exist">Staged</span>` : "";

    const publishStagedButton = entry.has_staged_changes
      ? `
        <button type="button" class="btn btn-icon btn-publish-staged js-publish-staged-btn" data-url="/api/entries/${escapeHtml(entry.id)}/publish-staged" data-entry-title="${escapeHtml(entry.title)}" title="Publish Staged Changes">
          <i class="fas fa-upload"></i>
        </button>
      `
      : "";

    const collectionDisplay = entry.collection ? escapeHtml(entry.collection) : "-";

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}" data-updated-timestamp="${updatedTimestamp}" data-views-value="${entry.views || 0}">
        <td class="checkbox-column"><input type="checkbox" class="entry-checkbox" value="${escapeHtml(entry.id)}"></td>
        <td data-label="Title">${escapeHtml(entry.title)}</td>
        <td data-label="Status">
          <span class="badge status-badge status-${escapeHtml(entry.status.toLowerCase())}">${escapeHtml(entry.status)}</span>
          ${stagedBadge}
        </td>
        <td data-label="Collection">${collectionDisplay}</td>
        <td data-label="Type"><span class="badge type-badge type-${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span></td>
        <td data-label="Views">${entry.views || 0}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          ${publishStagedButton}
          <a href="${viewUrl}" target="_blank" class="btn btn-icon btn-view" title="View Public Page"><i class="fas fa-eye"></i></a>
          <a href="/edit/${escapeHtml(entry.id)}" class="btn btn-icon btn-edit" title="${editTitle}"><i class="fas fa-pencil-alt"></i></a>
          <form action="/archive/${escapeHtml(entry.id)}" method="POST" class="archive-form" title="Archive Entry"><button type="submit" class="btn btn-icon btn-archive"><i class="fas fa-archive"></i></button></form>
          <form action="/delete/${escapeHtml(entry.id)}" method="POST" class="delete-form" title="Delete Entry"><button type="submit" class="btn btn-icon btn-delete"><i class="fas fa-trash-alt"></i></button></form>
        </td>
      </tr>
    `;
  }

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
      entriesTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries found on this page.</td></tr>`;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    attachActionListeners();
  }

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
    if (collectionFilterSelect) collectionFilterSelect.disabled = true;
    if (searchInput) searchInput.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    let url = `/api/entries?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}&fields=*,has_staged_changes`;
    if (currentCollectionFilter && currentCollectionFilter !== "") {
      url += `&collection=${encodeURIComponent(currentCollectionFilter)}`;
    }

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
      applyTableFilters();
      updatePaginationControls();
    } catch (error) {
      console.error("Failed to fetch entries:", error);
      window.showAlertModal("Error loading entries. Please try refreshing the page.", "Loading Error");
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
      if (selectAllCheckbox) selectAllCheckbox.disabled = totalItems === 0;
      if (collectionFilterSelect) collectionFilterSelect.disabled = false;
      if (searchInput) searchInput.disabled = false;
      updatePaginationControls();
    }
  }

  function applyTableFilters() {
    if (!entriesTableBody) return;

    const rows = entriesTableBody.querySelectorAll("tr[data-entry-id]");
    let visibleCount = 0;
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    for (const row of rows) {
      let shouldShow = true;

      if (searchTerm !== "") {
        const title = row.querySelector("td[data-label='Title']")?.textContent.toLowerCase() || "";
        const collection = row.querySelector("td[data-label='Collection']")?.textContent.toLowerCase() || "";
        const type = row.querySelector("td[data-label='Type'] span.type-badge")?.textContent.toLowerCase() || "";

        const matchesSearch = title.includes(searchTerm) || collection.includes(searchTerm) || type.includes(searchTerm);

        if (!matchesSearch) {
          shouldShow = false;
        }
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
        entriesTableBody.insertAdjacentHTML("beforeend", `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries match the current criteria.</td></tr>`);
      }
    } else if (rows.length === 0 && totalItems === 0 && !isLoading) {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    updateBulkActionUI();
  }

  function handleStandardFormSubmit(event) {
    if (!event.target.classList.contains("delete-form") && !event.target.classList.contains("archive-form")) {
      return;
    }

    event.preventDefault();
    const form = event.target;
    const title = form.closest("tr")?.querySelector("td[data-label='Title']")?.textContent || "this entry";
    let options = {};

    if (form.classList.contains("delete-form")) {
      options = {
        form: form,
        title: "Confirm Deletion",
        message: `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`,
        action: "delete",
        confirmText: "Delete",
      };
    } else if (form.classList.contains("archive-form")) {
      options = {
        form: form,
        title: "Confirm Archive",
        message: `Are you sure you want to archive "<strong>${escapeHtml(title)}</strong>"?`,
        action: "archive",
        confirmText: "Archive",
      };
    }

    if (options.title) {
      window.showConfirmModal(options);
    }
  }

  function handleApiButtonClick(event) {
    const button = event.target.closest(".js-publish-staged-btn");
    if (!button) {
      return;
    }

    const apiUrl = button.dataset.url;
    const title = button.dataset.entryTitle || "this entry";

    if (!apiUrl) {
      console.error("Could not find API URL on publish staged button.");
      return;
    }

    window.showConfirmModal({
      title: "Confirm Publish",
      message: `Are you sure you want to publish the staged changes for "<strong>${escapeHtml(title)}</strong>"?<br>This will overwrite the current live content.`,
      action: "publish-staged",
      confirmText: "Publish Changes",
      onConfirm: () => handlePublishStagedConfirm(apiUrl),
    });
  }

  async function handlePublishStagedConfirm(apiUrl) {
    if (isLoading) return;
    isLoading = true;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error ${response.status}`);
      }

      window.showAlertModal(result.message || "Staged changes published.", "Success");

      setTimeout(async () => {
        await fetchEntries();
      }, 100);
    } catch (error) {
      console.error("Failed to publish staged changes:", error);
      window.showAlertModal(`Error publishing changes: ${error.message}`, "Publish Error");
    } finally {
      isLoading = false;
    }
  }

  function attachActionListeners() {
    entriesTableBody?.removeEventListener("submit", handleStandardFormSubmit);
    entriesTableBody?.removeEventListener("click", handleApiButtonClick);

    entriesTableBody?.addEventListener("submit", handleStandardFormSubmit);
    entriesTableBody?.addEventListener("click", handleApiButtonClick);
  }

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

  function handleCheckboxChange(event) {
    if (event.target.classList.contains("entry-checkbox")) {
      updateBulkActionUI();
    }
  }

  function attachEntryCheckboxListeners() {
    entriesTableBody?.removeEventListener("change", handleCheckboxChange);
    entriesTableBody?.addEventListener("change", handleCheckboxChange);
  }

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
        window.showAlertModal(`Error ${response.status}: ${result.error || result.message || "Bulk action failed."}`, "Bulk Action Error");
      } else {
        if (response.status === 207) {
          window.showAlertModal(result.message || "Action completed with some errors.", "Partial Success");
        } else {
          window.showAlertModal(result.message || `Bulk action '${action}' completed successfully.`, "Success");
        }
        setTimeout(async () => {
          await fetchEntries();
        }, 100);
      }
    } catch (error) {
      console.error("Error performing bulk action fetch:", error);
      window.showAlertModal("An unexpected network or server error occurred during the bulk action.", "Bulk Action Error");
    } finally {
      isLoading = false;
      if (bulkActionsButton) {
        bulkActionsButton.disabled = false;
        bulkActionsButton.innerHTML = originalButtonText;
      }
      updateBulkActionUI();
    }
  }

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
        const isDelete = action === "delete" || action === "permanent-delete";
        const isPublishStaged = action === "publish-staged";
        let message = `Are you sure you want to perform the action '<strong>${escapeHtml(action)}</strong>' on <strong>${selectedIds.length}</strong> item(s)?`;
        if (isDelete) message += "<br>This action cannot be undone.";
        if (isPublishStaged) message += "<br>This will overwrite live content.";

        window.showConfirmModal({
          details: { action, ids: selectedIds },
          title: "Confirm Bulk Action",
          message: message,
          action: `bulk-${action}`,
          confirmText: isDelete ? "Delete" : isPublishStaged ? "Publish" : "Confirm",
          onConfirm: () => handleBulkActionConfirm(action, selectedIds),
        });
      }
    }
  });

  collectionFilterSelect?.addEventListener("change", () => {
    if (isLoading) return;
    currentCollectionFilter = collectionFilterSelect.value;
    currentPage = 1;
    fetchEntries();
  });

  searchInput?.addEventListener("input", () => {
    applyTableFilters();
  });

  const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${currentSortKey}"]`);
  if (initialSortHeader) {
    const icon = initialSortHeader.querySelector(".sort-icon i");
    if (icon) {
      icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
    }
  }

  attachActionListeners();
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
      currentPage = 1;
      totalPages = 1;
      totalItems = 0;
    }
  }

  updatePaginationControls();
  updateBulkActionUI();

  const urlParams = new URLSearchParams(window.location.search);
  const actionMessage = urlParams.get("action");
  const errorMessage = urlParams.get("error");

  if (actionMessage || errorMessage) {
    if (actionMessage) {
      let messageText = "Action completed successfully.";
      if (actionMessage === "deleted") messageText = "Entry deleted successfully.";
      else if (actionMessage === "archived") messageText = "Entry archived successfully.";
      else if (actionMessage === "unarchived") messageText = "Entry unarchived successfully.";
      else if (actionMessage === "published_staged") messageText = "Staged changes published successfully.";
      window.showAlertModal(messageText, "Success");
    } else if (errorMessage) {
      let messageText = "An error occurred.";
      if (errorMessage === "delete_failed") messageText = "Failed to delete the entry.";
      else if (errorMessage === "archive_failed") messageText = "Failed to archive the entry.";
      else if (errorMessage === "unarchive_failed") messageText = "Failed to unarchive the entry.";
      else if (errorMessage === "publish_staged_failed") messageText = "Failed to publish staged changes.";
      window.showAlertModal(messageText, "Error");
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const needsInitialFetch = (entriesTableBody && entriesTableBody.children.length === 0 && (!emptyStateCard || emptyStateCard.style.display === "none")) || totalPages > 1;

  if (needsInitialFetch && !actionMessage && !errorMessage) {
    fetchEntries();
  } else if (entriesTableBody && entriesTableBody.children.length > 0) {
    applyTableFilters();
  }

  if (collectionFilterSelect) {
    collectionFilterSelect.value = "";
    currentCollectionFilter = "";
  }
});
