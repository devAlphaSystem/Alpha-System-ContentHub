document.addEventListener("DOMContentLoaded", () => {
  const projectsTableBody = document.getElementById("projects-table-body");
  const refreshButton = document.getElementById("refresh-projects-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");
  const searchInput = document.getElementById("search-projects-input");

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "name";
  let currentSortDir = "asc";
  let isLoading = false;
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

  function renderTableRow(project) {
    const formattedUpdated =
      project.formattedUpdated ||
      new Date(project.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const updatedTimestamp = new Date(project.updated).getTime();
    const viewUrl = `/projects/${escapeHtml(project.id)}/`;
    const editUrl = `/projects/${escapeHtml(project.id)}/edit`;
    const deleteUrl = `/projects/${escapeHtml(project.id)}/delete`;

    return `
      <tr data-project-id="${escapeHtml(project.id)}" data-updated-timestamp="${updatedTimestamp}">
        <td data-label="Name"><a href="${viewUrl}">${escapeHtml(project.name)}</a></td>
        <td data-label="Description">${escapeHtml(project.description) || "-"}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="${viewUrl}" class="btn btn-icon btn-view" title="View Project Entries"><i class="fas fa-tachometer-alt"></i></a>
          <a href="${editUrl}" class="btn btn-icon btn-edit" title="Edit Project Settings"><i class="fas fa-cog"></i></a>
          <form action="${deleteUrl}" method="POST" class="delete-project-form" title="Delete Project" style="display: inline;">
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
      pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} projects)`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = currentPage <= 1 || isLoading;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = currentPage >= totalPages || isLoading;
    }
  }

  function renderTable(projects) {
    if (!projectsTableBody || !tableElement) return;

    projectsTableBody.innerHTML = "";

    if (projects.length > 0) {
      let tableHtml = "";
      for (const project of projects) {
        tableHtml += renderTableRow(project);
      }
      projectsTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
      const noMatchRow = projectsTableBody.querySelector(".no-match-row");
      if (noMatchRow) noMatchRow.remove();
    } else {
      const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 4;
      const message = currentSearchTerm ? "No projects match your search." : "No projects found.";
      projectsTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">${message}</td></tr>`;

      if (totalItems === 0) {
        if (dataCard) dataCard.classList.add("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "";
      } else {
        if (dataCard) dataCard.classList.remove("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "none";
      }
    }

    attachActionListeners();
  }

  async function fetchProjects(isNewSearch = false) {
    if (isLoading) return;
    isLoading = true;

    if (isNewSearch) {
      currentPage = 1;
    }

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    if (searchInput) searchInput.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const params = new URLSearchParams({
      page: currentPage.toString(),
      perPage: itemsPerPage.toString(),
      sort: sortParam,
    });

    if (currentSearchTerm && currentSearchTerm.trim() !== "") {
      params.append("search", currentSearchTerm.trim());
    }

    const url = `/api/projects?${params.toString()}`;

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
      console.error("Failed to fetch projects:", error);
      window.showAlertModal(`Error loading projects: ${error.message}`, "Loading Error");
      if (projectsTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 4;
        projectsTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading projects.</td></tr>`;
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
      if (searchInput) searchInput.disabled = false;
      updatePaginationControls();
    }
  }

  function handleFormSubmit(event) {
    const form = event.target;
    if (form.classList.contains("delete-project-form")) {
      event.preventDefault();
      const projectName = form.closest("tr")?.querySelector("td[data-label='Name'] a")?.textContent || "this project";
      window.showConfirmModal({
        form: form,
        title: "Confirm Project Deletion",
        message: `Are you sure you want to delete the project "<strong>${escapeHtml(projectName)}</strong>"?<br><strong>Warning:</strong> This will permanently delete the project and ALL associated entries, templates, headers, and footers. This action cannot be undone.`,
        action: "delete",
        confirmText: "Delete Project Permanently",
      });
    }
  }

  function attachActionListeners() {
    projectsTableBody?.removeEventListener("submit", handleFormSubmit);
    projectsTableBody?.addEventListener("submit", handleFormSubmit);
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

        fetchProjects();
      });
    }
  }

  const debouncedSearch = debounce(() => {
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (searchTerm !== currentSearchTerm) {
      currentSearchTerm = searchTerm;
      fetchProjects(true);
    }
  }, 400);

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) {
      fetchProjects();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchProjects();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchProjects();
    }
  });

  searchInput?.addEventListener("input", debouncedSearch);

  function initializeProjectsPage() {
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

    attachActionListeners();
    attachSortListeners();

    const initialPaginationData = document.querySelector(".pagination-controls");
    if (initialPaginationData) {
      try {
        const pageInfoText = document.getElementById("page-info")?.textContent || "";
        const pageMatch = pageInfoText.match(/Page (\d+) of (\d+)/);
        const itemsMatch = pageInfoText.match(/\((\d+) projects\)/);
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

    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get("message");
    const error = urlParams.get("error");

    if (message || error) {
      if (message) {
        window.showAlertModal(message, "Success");
      } else if (error) {
        window.showAlertModal(error, "Error");
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }

    const needsInitialFetch = (projectsTableBody && projectsTableBody.children.length === 0 && (!emptyStateCard || emptyStateCard.style.display === "none")) || totalPages > 1;

    if (needsInitialFetch && !message && !error) {
      fetchProjects();
    } else if (projectsTableBody && projectsTableBody.children.length > 0) {
      attachActionListeners();
    }

    if (searchInput) {
      searchInput.value = "";
      currentSearchTerm = "";
    }
  }

  initializeProjectsPage();
});
