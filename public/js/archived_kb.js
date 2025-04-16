document.addEventListener("DOMContentLoaded", () => {
  const archivedTableBody = document.getElementById("archived-table-body");
  const refreshButton = document.getElementById("refresh-archived-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");
  const projectId = document.body.dataset.projectId;
  const entryType = document.body.dataset.entryType;

  if (!projectId || !entryType || !["documentation", "changelog", "roadmap", "knowledge_base"].includes(entryType)) {
    console.warn("Archived JS loaded on unexpected page type or context missing.");
    return;
  }

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;

  function renderTableRow(entry) {
    const formattedArchivedDate =
      entry.formattedUpdated ||
      new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const updatedTimestamp = new Date(entry.updated).getTime();
    const unarchiveUrl = `/projects/${projectId}/unarchive/${escapeHtml(entry.id)}`;
    const deleteUrl = `/projects/${projectId}/delete-archived/${escapeHtml(entry.id)}`;

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}" data-updated-timestamp="${updatedTimestamp}">
        <td data-label="Question">${escapeHtml(entry.title)}</td>
        <td data-label="Status"><span class="badge status-badge status-${escapeHtml(entry.status.toLowerCase())}">${escapeHtml(entry.status)}</span></td>
        <td data-label="Archived">${formattedArchivedDate}</td>
        <td data-label="Actions" class="actions-cell">
          <form action="${unarchiveUrl}" method="POST" class="unarchive-form" title="Unarchive">
            <button type="submit" class="btn btn-icon btn-unarchive"><i class="fas fa-box-open"></i></button>
          </form>
          <form action="${deleteUrl}" method="POST" class="delete-archived-form" title="Delete Permanently">
            <button type="submit" class="btn btn-icon btn-delete"><i class="fas fa-trash-alt"></i></button>
          </form>
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
    if (!archivedTableBody || !tableElement) return;

    archivedTableBody.innerHTML = "";

    if (entries.length > 0) {
      let tableHtml = "";
      for (const entry of entries) {
        tableHtml += renderTableRow(entry);
      }
      archivedTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
      const noMatchRow = archivedTableBody.querySelector(".no-match-row");
      if (noMatchRow) noMatchRow.remove();
    } else if (totalItems > 0) {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 4;
      archivedTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No archived ${entryType.replace("_", " ")} entries found for this page.</td></tr>`;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    attachActionListeners();
  }

  async function fetchArchivedEntries() {
    if (isLoading || !projectId || !entryType) {
      if (!projectId) console.warn("Project ID missing, cannot fetch archived entries.");
      if (!entryType) console.warn("Entry Type missing, cannot fetch archived entries.");
      return;
    }
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const url = `/api/projects/${projectId}/archived-entries?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}&type=${entryType}`;

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
      console.error("Failed to fetch archived entries:", error);
      window.showAlertModal("Error loading archived entries. Please try refreshing.", "Loading Error");
      if (archivedTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 4;
        archivedTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>`;
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

  function handleFormSubmit(event) {
    const form = event.target;
    let options = {};

    if (form.classList.contains("unarchive-form")) {
      event.preventDefault();
      const title = form.closest("tr")?.querySelector("td[data-label='Question']")?.textContent || "this entry";
      options = {
        form: form,
        title: "Confirm Unarchive",
        message: `Are you sure you want to unarchive "<strong>${escapeHtml(title)}</strong>"? It will be moved back to the project's active entries.`,
        action: "unarchive",
        confirmText: "Unarchive",
      };
    } else if (form.classList.contains("delete-archived-form")) {
      event.preventDefault();
      const title = form.closest("tr")?.querySelector("td[data-label='Question']")?.textContent || "this entry";
      options = {
        form: form,
        title: "Confirm Permanent Deletion",
        message: `Are you sure you want to <strong>permanently delete</strong> the archived entry "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`,
        action: "delete",
        confirmText: "Delete Permanently",
      };
    }

    if (options.title) {
      window.showConfirmModal(options);
    }
  }

  function attachActionListeners() {
    archivedTableBody?.removeEventListener("submit", handleFormSubmit);
    archivedTableBody?.addEventListener("submit", handleFormSubmit);
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
          newSortDir = sortKey === "updated" ? "desc" : "asc";
        }

        currentSortKey = sortKey;
        currentSortDir = newSortDir;
        currentPage = 1;

        for (const h of document.querySelectorAll(".data-table th[data-sort-key]")) {
          const icon = h.querySelector(".sort-icon i");
          if (!icon) return;
          if (h.dataset.sortKey === currentSortKey) {
            icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
          } else {
            icon.className = "fas fa-sort";
          }
        }

        fetchArchivedEntries();
      });
    }
  }

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) {
      fetchArchivedEntries();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchArchivedEntries();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchArchivedEntries();
    }
  });

  function initializeProjectArchived() {
    if (!projectId || !entryType) {
      console.warn("Project ID or Entry Type missing, cannot initialize archived entries.");
      return;
    }

    const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${currentSortKey}"]`);
    if (initialSortHeader) {
      const icon = initialSortHeader.querySelector(".sort-icon i");
      if (icon) {
        icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
      }
    }

    attachActionListeners();
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

    const needsInitialFetch = (archivedTableBody && archivedTableBody.children.length === 0 && (!emptyStateCard || emptyStateCard.style.display === "none")) || totalPages > 1;

    if (needsInitialFetch) {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get("action");
      const error = urlParams.get("error");
      if (!action && !error) {
        fetchArchivedEntries();
      } else {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } else if (archivedTableBody && archivedTableBody.children.length > 0) {
      attachActionListeners();
    }
  }

  initializeProjectArchived();
});
