document.addEventListener("DOMContentLoaded", () => {
  const filesTableBody = document.getElementById("files-table-body");
  const refreshButton = document.getElementById("refresh-files-btn");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");
  const totalSizeDisplay = document.getElementById("total-size-display");

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  let totalSize = null;
  const itemsPerPage = 10;
  let currentSortKey = "-created";
  let isLoading = false;

  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
  }

  function renderTableRow(file) {
    const projectUrl = `/projects/${escapeHtml(file.projectId)}`;
    const entryUrl = `/projects/${escapeHtml(file.projectId)}/edit/${escapeHtml(file.entryId)}`;
    const deleteApiUrl = `/api/entries/${escapeHtml(file.entryId)}/files/${encodeURIComponent(file.filename)}`;
    const thumbUrl = `${escapeHtml(file.fileUrl)}?thumb=50x50`;
    const fullUrl = escapeHtml(file.fileUrl);

    return `
      <tr data-entry-id="${escapeHtml(file.entryId)}" data-filename="${escapeHtml(file.filename)}">
        <td data-label="Preview">
          <a href="${fullUrl}" target="_blank" title="View full image">
            <img src="${thumbUrl}" alt="Preview" class="file-preview" loading="lazy">
          </a>
        </td>
        <td data-label="Project">
          <a href="${projectUrl}">${escapeHtml(file.projectName)}</a>
        </td>
        <td data-label="Entry">
          <a href="${entryUrl}">${escapeHtml(file.entryTitle)}</a>
        </td>
        <td data-label="Filename">${escapeHtml(file.filename)}</td>
        <td data-label="Uploaded">${file.formattedCreated || "-"}</td>
        <td data-label="Actions" class="actions-cell">
          <button type="button" class="btn btn-icon btn-delete js-delete-file-btn" data-url="${deleteApiUrl}" data-filename="${escapeHtml(file.filename)}" title="Delete File">
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>
    `;
  }

  function updatePaginationControls() {
    if (paginationControls) {
      if (totalItems === 0) {
        paginationControls.style.display = "none";
      } else {
        paginationControls.style.display = "flex";
        if (pageInfo) {
          pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} files)`;
        }
        if (prevPageBtn) {
          prevPageBtn.disabled = currentPage <= 1 || isLoading;
        }
        if (nextPageBtn) {
          nextPageBtn.disabled = currentPage >= totalPages || isLoading;
        }
      }
    }

    if (totalSizeDisplay) {
      if (totalSize !== null) {
        totalSizeDisplay.textContent = `Total Storage Used: ${formatBytes(totalSize)}`;
        totalSizeDisplay.style.display = totalItems > 0 ? "block" : "none";
      } else {
        totalSizeDisplay.textContent = "Total Storage Used: Calculation disabled in settings.";
        totalSizeDisplay.style.display = "block";
      }
    }
  }

  function renderTable(files) {
    if (!filesTableBody || !tableElement) return;

    filesTableBody.innerHTML = "";

    if (files.length > 0) {
      let tableHtml = "";
      for (const file of files) {
        tableHtml += renderTableRow(file);
      }
      filesTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (totalItems === 0) {
        if (dataCard) dataCard.classList.add("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "";
      } else {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 6;
        filesTableBody.innerHTML = `<tr class="no-match-row"><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No files found for this page.</td></tr>`;
        if (dataCard) dataCard.classList.remove("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "none";
      }
    }
    attachActionListeners();
  }

  async function fetchFiles() {
    if (isLoading) return;
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    if (totalSizeDisplay) totalSizeDisplay.textContent = "Total Storage Used: Calculating...";

    const url = `/api/files?page=${currentPage}&perPage=${itemsPerPage}&sort=${currentSortKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      currentPage = data.page;
      totalPages = data.totalPages;
      totalItems = data.totalItems;
      totalSize = data.totalSize;

      console.log(`[FILES JS] fetchFiles success: Received totalSize = ${totalSize}, totalItems = ${totalItems}`);

      renderTable(data.items);
      updatePaginationControls();
    } catch (error) {
      console.error("Failed to fetch files:", error);
      window.showAlertModal("Error loading files. Please try refreshing.", "Loading Error");
      if (filesTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 6;
        filesTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading files.</td></tr>`;
      }
      currentPage = 1;
      totalPages = 0;
      totalItems = 0;
      totalSize = null;
      updatePaginationControls();
      if (dataCard) dataCard.classList.add("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "";
      if (totalSizeDisplay) totalSizeDisplay.textContent = "Total Storage Used: Error";
    } finally {
      isLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = `<i class="fas fa-sync-alt"></i> <span>Refresh</span>`;
      }
      updatePaginationControls();
    }
  }

  function handleDeleteFileClick(event) {
    const button = event.target.closest(".js-delete-file-btn");
    if (!button) return;

    const apiUrl = button.dataset.url;
    const filename = button.dataset.filename || "this file";

    if (!apiUrl) {
      console.error("Could not find API URL on delete button.");
      window.showAlertModal("Cannot delete file: Missing URL.", "Error");
      return;
    }

    window.showConfirmModal({
      title: "Confirm File Deletion",
      message: `Are you sure you want to delete the file "<strong>${escapeHtml(filename)}</strong>"? This will remove it from the associated entry. This action cannot be undone.`,
      action: "delete",
      confirmText: "Delete File",
      onConfirm: () => handleDeleteFileConfirm(apiUrl, button),
    });
  }

  async function handleDeleteFileConfirm(apiUrl, button) {
    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

    try {
      const response = await fetch(apiUrl, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error ${response.status}`);
      }

      window.showAlertModal(result.message || "File deleted successfully.", "Success");
      setTimeout(async () => {
        await fetchFiles();
      }, 100);
    } catch (error) {
      console.error("Failed to delete file:", error);
      window.showAlertModal(`Error deleting file: ${error.message}`, "Delete Error");
      button.disabled = false;
      button.innerHTML = `<i class="fas fa-trash-alt"></i>`;
    }
  }

  function attachActionListeners() {
    filesTableBody?.removeEventListener("click", handleDeleteFileClick);
    filesTableBody?.addEventListener("click", handleDeleteFileClick);
  }

  function attachSortListeners() {
    const sortableHeaders = document.querySelectorAll(".data-table th[data-sort-key]");
    for (const header of sortableHeaders) {
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);

      newHeader.addEventListener("click", () => {
        if (isLoading) return;

        const sortKey = newHeader.dataset.sortKey;
        let newSortDirPrefix;

        if (sortKey === currentSortKey.replace(/^-/, "")) {
          newSortDirPrefix = currentSortKey.startsWith("-") ? "" : "-";
        } else {
          newSortDirPrefix = sortKey === "created" ? "-" : "";
        }

        currentSortKey = `${newSortDirPrefix}${sortKey}`;
        currentPage = 1;

        for (const h of document.querySelectorAll(".data-table th[data-sort-key]")) {
          const icon = h.querySelector(".sort-icon i");
          if (!icon) continue;
          if (h.dataset.sortKey === sortKey) {
            icon.className = newSortDirPrefix === "-" ? "fas fa-sort-down" : "fas fa-sort-up";
          } else {
            icon.className = "fas fa-sort";
          }
        }

        fetchFiles();
      });
    }
  }

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) {
      fetchFiles();
    }
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchFiles();
    }
  });

  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchFiles();
    }
  });

  function initializeFilesPage() {
    const initialSortKey = currentSortKey.replace(/^-/, "");
    const initialSortDirPrefix = currentSortKey.startsWith("-") ? "-" : "";
    const initialSortHeader = document.querySelector(`.data-table th[data-sort-key="${initialSortKey}"]`);
    if (initialSortHeader) {
      const icon = initialSortHeader.querySelector(".sort-icon i");
      if (icon) {
        icon.className = initialSortDirPrefix === "-" ? "fas fa-sort-down" : "fas fa-sort-up";
      }
    }
    const otherHeaders = document.querySelectorAll(`.data-table th[data-sort-key]:not([data-sort-key="${initialSortKey}"])`);
    for (const h of otherHeaders) {
      const icon = h.querySelector(".sort-icon i");
      if (icon) icon.className = "fas fa-sort";
    }

    attachActionListeners();
    attachSortListeners();
    fetchFiles();
  }

  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  initializeFilesPage();
});
