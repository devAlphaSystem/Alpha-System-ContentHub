document.addEventListener("DOMContentLoaded", () => {
  const entriesTableBody = document.getElementById("entries-table-body");
  const refreshButton = document.getElementById("refresh-entries-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCardElement = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");
  const projectFilterSelect = document.getElementById("project-filter-select");
  const searchInput = document.getElementById("search-input");

  const initialStatusFilter = dataCardElement?.dataset.statusFilter || "all";

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;
  let currentProjectFilter = "";
  let currentSearchTerm = "";
  let searchDebounceTimer;

  function debounce(func, delay) {
    return function (...args) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }

  function renderTableRow(entry) {
    const editUrl = entry.project ? `/projects/${entry.project}/edit/${entry.id}` : "#";
    const viewUrl = entry.project && entry.status === "published" && entry.type !== "roadmap" && entry.type !== "knowledge_base" ? `/view/${entry.id}?from_admin=1` : null;

    const projectName = entry.projectName || "N/A";

    return `
      <tr data-entry-id="${entry.id}" data-project-id="${entry.project}">
        <td data-label="Title">${entry.title}</td>
        <td data-label="Type"><span class="badge type-badge type-${entry.type.replace("_", "-")}">${entry.type.replace("_", " ")}</span></td>
        <td data-label="Project">${projectName}</td>
        <td data-label="Status">
          <span class="badge status-badge status-${entry.status.toLowerCase()}">${entry.status}</span>
          ${entry.has_staged_changes ? '<span class="badge status-badge status-staged" title="Unpublished changes exist">Staged</span>' : ""}
        </td>
        <td data-label="Collection">${entry.collection || "-"}</td>
        <td data-label="Updated">${entry.formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          ${editUrl !== "#" ? `<a href="${editUrl}" class="btn btn-icon btn-edit" title="Edit Entry"><i class="fas fa-pencil-alt"></i></a>` : ""}
          ${viewUrl ? `<a href="${viewUrl}" target="_blank" class="btn btn-icon btn-view" title="View Public Page"><i class="fas fa-eye"></i></a>` : ""}
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
      pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} entries)`;
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
      if (dataCardElement) dataCardElement.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 7;
      const message = currentSearchTerm || currentProjectFilter ? "No entries match your criteria." : "No entries found.";
      entriesTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">${message}</td></tr>`;

      if (totalItems === 0 && !currentSearchTerm && !currentProjectFilter) {
        if (dataCardElement) dataCardElement.classList.add("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "";
      } else {
        if (dataCardElement) dataCardElement.classList.remove("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "none";
      }
    }
  }

  async function fetchEntries(isNewSearchOrFilter = false) {
    if (isLoading) return;
    isLoading = true;

    if (isNewSearchOrFilter) {
      currentPage = 1;
    }

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    if (projectFilterSelect) projectFilterSelect.disabled = true;
    if (searchInput) searchInput.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const params = new URLSearchParams({
      page: currentPage.toString(),
      perPage: itemsPerPage.toString(),
      sort: sortParam,
      status: initialStatusFilter,
    });

    if (currentProjectFilter && currentProjectFilter !== "") {
      params.append("project", currentProjectFilter);
    }
    if (currentSearchTerm && currentSearchTerm.trim() !== "") {
      params.append("search", currentSearchTerm.trim());
    }

    const url = `/api/entries?${params.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } catch (_) {}
        throw new Error(errorMsg);
      }
      const data = await response.json();

      currentPage = data.page;
      totalPages = data.totalPages;
      totalItems = data.totalItems;

      renderTable(data.items);
      updatePaginationControls();
    } catch (error) {
      console.error("Failed to fetch entries:", error);
      window.showAlertModal(`Error loading entries: ${error.message}`, "Loading Error");
      if (entriesTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 7;
        entriesTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>`;
      }
      currentPage = 1;
      totalPages = 0;
      totalItems = 0;
      updatePaginationControls();
      if (dataCardElement) dataCardElement.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    } finally {
      isLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = `<i class="fas fa-sync-alt"></i> <span>Refresh</span>`;
      }
      if (projectFilterSelect) projectFilterSelect.disabled = false;
      if (searchInput) searchInput.disabled = false;
      updatePaginationControls();
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
          newSortDir = sortKey === "updated" ? "desc" : "asc";
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

  const debouncedSearch = debounce(() => {
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (searchTerm !== currentSearchTerm) {
      currentSearchTerm = searchTerm;
      fetchEntries(true);
    }
  }, 400);

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

  projectFilterSelect?.addEventListener("change", () => {
    if (isLoading) return;
    currentProjectFilter = projectFilterSelect.value;
    fetchEntries(true);
  });

  searchInput?.addEventListener("input", debouncedSearch);

  function initializeGlobalEntriesList() {
    const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${currentSortKey}"]`);
    if (initialSortHeader) {
      const icon = initialSortHeader.querySelector(".sort-icon i");
      if (icon) {
        icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
      }
    }
    const otherHeaders = document.querySelectorAll(`.data-table th[data-sort-key]:not([data-sort-key="${currentSortKey}"]) .sort-icon i`);
    for (const icon of otherHeaders) {
      icon.className = "fas fa-sort";
    }

    attachSortListeners();

    const initialPaginationData = document.querySelector(".pagination-controls");
    if (initialPaginationData) {
      try {
        const pageInfoText = document.getElementById("page-info")?.textContent || "";
        const pageMatch = pageInfoText.match(/Page (\d+) of (\d+)/);
        const itemsMatch = pageInfoText.match(/\((\d+) entries\)/);
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

    const needsInitialFetch = (entriesTableBody && entriesTableBody.children.length === 0 && (!emptyStateCard || emptyStateCard.style.display === "none")) || totalPages > 1;

    if (needsInitialFetch) {
      fetchEntries();
    }
  }

  initializeGlobalEntriesList();
});
