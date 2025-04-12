document.addEventListener("DOMContentLoaded", () => {
  const headersTableBody = document.getElementById("headers-table-body");
  const refreshButton = document.getElementById("refresh-headers-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;

  function renderTableRow(header) {
    const formattedUpdated =
      header.formattedUpdated ||
      new Date(header.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const updatedTimestamp = new Date(header.updated).getTime();

    return `
      <tr data-header-id="${escapeHtml(header.id)}" data-updated-timestamp="${updatedTimestamp}">
        <td data-label="Name">${escapeHtml(header.name)}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="/headers/edit/${escapeHtml(header.id)}" class="btn btn-icon btn-edit" title="Edit Header"><i class="fas fa-pencil-alt"></i></a>
          <form action="/headers/delete/${escapeHtml(header.id)}" method="POST" class="delete-header-form" title="Delete Header"><button type="submit" class="btn btn-icon btn-delete"><i class="fas fa-trash-alt"></i></button></form>
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

  function renderTable(headers) {
    if (!headersTableBody || !tableElement) return;

    headersTableBody.innerHTML = "";

    if (headers.length > 0) {
      let tableHtml = "";
      for (const header of headers) {
        tableHtml += renderTableRow(header);
      }
      headersTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
      const noMatchRow = headersTableBody.querySelector(".no-match-row");
      if (noMatchRow) noMatchRow.remove();
    } else if (totalItems > 0) {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 3;
      headersTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No headers found for this page.</td></tr>`;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
    }

    attachDeleteListeners();
  }

  async function fetchHeaders() {
    if (isLoading) return;
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const url = `/api/headers?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}`;

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
      console.error("Failed to fetch headers:", error);
      window.showAlertModal("Error loading headers. Please try refreshing the page.", "Loading Error");
      if (headersTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 3;
        headersTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading headers.</td></tr>`;
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

  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.classList.contains("delete-header-form")) {
      const name = form.closest("tr")?.querySelector("td[data-label='Name']")?.textContent || "this header";
      const message = `Are you sure you want to delete the header "<strong>${escapeHtml(name)}</strong>"?<br>This action cannot be undone. Entries using this header will revert to the default.`;
      window.showConfirmModal({
        form: form,
        title: "Confirm Deletion",
        message: message,
        action: "delete",
        confirmText: "Delete",
      });
    }
  }

  function attachDeleteListeners() {
    const deleteHeaderForms = document.querySelectorAll("form.delete-header-form");
    for (const form of deleteHeaderForms) {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
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

        fetchHeaders();
      });
    }
  }

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) {
      fetchHeaders();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchHeaders();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchHeaders();
    }
  });

  const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${currentSortKey}"]`);
  if (initialSortHeader) {
    const icon = initialSortHeader.querySelector(".sort-icon i");
    if (icon) {
      icon.className = currentSortDir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
    }
  }

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

  const needsInitialFetch = (headersTableBody && headersTableBody.children.length === 0 && (!emptyStateCard?.style.display || emptyStateCard?.style.display === "none")) || totalPages > 1;

  if (needsInitialFetch) {
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get("message");
    const error = urlParams.get("error");

    if (!message && !error) {
      fetchHeaders();
    } else {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
});
