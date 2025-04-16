document.addEventListener("DOMContentLoaded", () => {
  const templatesTableBody = document.getElementById("templates-table-body");
  const refreshButton = document.getElementById("refresh-templates-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");
  const projectId = document.body.dataset.projectId;

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "updated";
  let currentSortDir = "desc";
  let isLoading = false;

  function renderTableRow(template) {
    const formattedUpdated =
      template.formattedUpdated ||
      new Date(template.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const updatedTimestamp = new Date(template.updated).getTime();
    const editUrl = `/projects/${projectId}/templates/edit/${escapeHtml(template.id)}`;
    const deleteUrl = `/projects/${projectId}/templates/delete/${escapeHtml(template.id)}`;

    return `
      <tr data-template-id="${escapeHtml(template.id)}" data-updated-timestamp="${updatedTimestamp}">
        <td data-label="Name">${escapeHtml(template.name)}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="${editUrl}" class="btn btn-icon btn-edit" title="Edit Template"><i class="fas fa-pencil-alt"></i></a>
          <form action="${deleteUrl}" method="POST" class="delete-template-form" title="Delete Template">
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

    attachActionListeners();
  }

  async function fetchTemplates() {
    if (isLoading || !projectId) {
      if (!projectId) console.warn("Project ID missing, cannot fetch templates.");
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
    const url = `/api/projects/${projectId}/templates?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}`;

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
      window.showAlertModal("Error loading templates. Please try refreshing.", "Loading Error");
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

  function handleFormSubmit(event) {
    const form = event.target;
    if (form.classList.contains("delete-template-form")) {
      event.preventDefault();
      const templateName = form.closest("tr")?.querySelector("td[data-label='Name']")?.textContent || "this template";
      window.showConfirmModal({
        form: form,
        title: "Confirm Deletion",
        message: `Are you sure you want to delete the template "<strong>${escapeHtml(templateName)}</strong>"? This action cannot be undone.`,
        action: "delete",
        confirmText: "Delete",
      });
    }
  }

  function attachActionListeners() {
    templatesTableBody?.removeEventListener("submit", handleFormSubmit);
    templatesTableBody?.addEventListener("submit", handleFormSubmit);
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
          if (!icon) return;
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

  function initializeProjectTemplates() {
    if (!projectId) {
      console.warn("Project ID missing, cannot initialize templates.");
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

    const needsInitialFetch = (templatesTableBody && templatesTableBody.children.length === 0 && (!emptyStateCard || emptyStateCard.style.display === "none")) || totalPages > 1;

    if (needsInitialFetch) {
      const urlParams = new URLSearchParams(window.location.search);
      const message = urlParams.get("message");
      const error = urlParams.get("error");
      if (!message && !error) {
        fetchTemplates();
      } else {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } else if (templatesTableBody && templatesTableBody.children.length > 0) {
      attachActionListeners();
    }
  }

  initializeProjectTemplates();
});
