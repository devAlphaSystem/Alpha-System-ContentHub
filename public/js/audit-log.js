document.addEventListener("DOMContentLoaded", () => {
  const detailsModal = document.getElementById("details-modal");
  const detailsModalContent = document.getElementById("details-modal-content");
  const detailsModalCloseBtn = document.getElementById("details-modal-close-btn");
  const detailsModalOkBtn = document.getElementById("details-modal-ok-btn");

  const logsTableBody = document.getElementById("logs-table-body");
  const paginationControls = document.querySelector(".pagination-controls");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageInfo = document.getElementById("page-info");
  const refreshButton = document.getElementById("refresh-logs-btn");
  const dataCard = document.querySelector(".data-card");
  const emptyStateCard = document.querySelector(".empty-state-card");
  const tableElement = document.querySelector(".data-table");

  const clearAllLogsBtn = document.getElementById("clear-all-logs-btn");
  const exportCsvBtn = document.getElementById("export-csv-btn");

  let currentPage = 1;
  let totalPages = 1;
  let totalItems = 0;
  const itemsPerPage = 10;
  let currentSortKey = "created";
  let currentSortDir = "desc";
  let isLoading = false;

  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function showDetailsModal(details) {
    if (!detailsModal || !detailsModalContent) return;
    try {
      detailsModalContent.textContent = JSON.stringify(details, null, 2);
    } catch (e) {
      detailsModalContent.textContent = "Could not display details.";
    }
    detailsModal.classList.add("is-visible");
    detailsModal.setAttribute("aria-hidden", "false");
  }

  function hideDetailsModal() {
    if (detailsModal) {
      detailsModal.classList.remove("is-visible");
      detailsModal.setAttribute("aria-hidden", "true");
    }
  }

  function renderTableRow(log) {
    const timestamp = log.formatted_created || new Date(log.created).toLocaleString();
    const userDisplay = log.user_email ? escapeHtml(log.user_email) : log.user ? `<span class="text-muted">${escapeHtml(log.user)}</span>` : '<span class="text-muted">System/Unknown</span>';
    const targetDisplay = log.target_collection ? `${escapeHtml(log.target_collection)}${log.target_record ? `:${escapeHtml(log.target_record)}` : ""}` : "-";
    const ipDisplay = log.ip_address ? escapeHtml(log.ip_address) : "-";

    const detailsString = log.details && Object.keys(log.details).length > 0 ? JSON.stringify(log.details) : null;
    const escapedDetailsAttribute = detailsString ? detailsString.replace(/"/g, "&quot;") : "";

    const detailsButton = detailsString ? `<button class="btn btn-icon btn-view-details" title="View Details" data-details="${escapedDetailsAttribute}"><i class="fas fa-info-circle"></i></button>` : "-";

    return `
      <tr data-log-id="${escapeHtml(log.id)}">
        <td data-label="Timestamp">${timestamp}</td>
        <td data-label="User">${userDisplay}</td>
        <td data-label="Action"><span class="badge action-badge">${escapeHtml(log.action)}</span></td>
        <td data-label="Target">${targetDisplay}</td>
        <td data-label="Details">${detailsButton}</td>
        <td data-label="IP Address">${ipDisplay}</td>
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
      pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} logs)`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = currentPage <= 1 || isLoading;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = currentPage >= totalPages || isLoading;
    }
  }

  function renderTable(logs) {
    if (!logsTableBody || !tableElement) return;

    logsTableBody.innerHTML = "";

    if (logs.length > 0) {
      let tableHtml = "";
      for (const log of logs) {
        tableHtml += renderTableRow(log);
      }
      logsTableBody.innerHTML = tableHtml;
      if (dataCard) dataCard.classList.remove("hidden");
      if (emptyStateCard) emptyStateCard.style.display = "none";
    } else {
      if (totalItems === 0) {
        if (dataCard) dataCard.classList.add("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "";
      } else {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 6;
        logsTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--text-muted);">No logs match the current criteria.</td></tr>`;
        if (dataCard) dataCard.classList.remove("hidden");
        if (emptyStateCard) emptyStateCard.style.display = "none";
      }
    }
    attachDetailsButtonListeners();
  }

  async function fetchLogs() {
    if (isLoading) return;
    isLoading = true;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>`;
    }
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;

    const sortParam = `${currentSortDir === "desc" ? "-" : ""}${currentSortKey}`;
    const url = `/api/audit-log?page=${currentPage}&perPage=${itemsPerPage}&sort=${sortParam}`;

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
      console.error("Failed to fetch audit logs:", error);
      window.showAlertModal("Error loading audit logs. Please try refreshing.", "Loading Error");
      if (logsTableBody && tableElement) {
        const colSpan = tableElement.querySelector("thead tr")?.childElementCount || 6;
        logsTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading logs.</td></tr>`;
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
          newSortDir = sortKey === "created" ? "desc" : "asc";
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

        fetchLogs();
      });
    }
  }

  function attachDetailsButtonListeners() {
    logsTableBody?.removeEventListener("click", handleDetailsButtonClick);
    logsTableBody?.addEventListener("click", handleDetailsButtonClick);
  }

  function handleDetailsButtonClick(event) {
    const button = event.target.closest(".btn-view-details");
    if (button?.dataset.details) {
      try {
        const detailsData = JSON.parse(button.dataset.details);
        showDetailsModal(detailsData);
      } catch (e) {
        console.error("Failed to parse details JSON:", e);
        showDetailsModal({ error: "Could not parse details." });
      }
    }
  }

  function handleClearAllLogsClick() {
    window.showConfirmModal({
      title: "Confirm Clear All Logs",
      message: "Are you absolutely sure you want to delete <strong>ALL</strong> audit log entries? This action cannot be undone.",
      confirmText: "Delete All Logs",
      action: "delete",
      onConfirm: executeClearAllLogs,
    });
  }

  async function executeClearAllLogs() {
    if (isLoading) return;
    isLoading = true;
    if (clearAllLogsBtn) clearAllLogsBtn.disabled = true;
    if (refreshButton) refreshButton.disabled = true;

    try {
      const response = await fetch("/api/audit-log/all", {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      });

      let resultMessage = "Audit logs cleared successfully.";
      let resultError = null;

      if (response.ok) {
        if (response.status !== 204) {
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            try {
              const result = await response.json();
              resultMessage = result.message || resultMessage;
            } catch (jsonError) {
              console.warn("Failed to parse JSON from successful response:", jsonError);
            }
          }
        }
        window.showAlertModal(resultMessage, "Success");
        currentPage = 1;
        totalPages = 1;
        totalItems = 0;

        setTimeout(async () => {
          await fetchLogs();
        }, 100);
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          try {
            const errorResult = await response.json();
            resultError = errorResult.error || `Server error ${response.status}`;
          } catch (jsonError) {
            console.error("Failed to parse JSON from error response:", jsonError);
            resultError = `Server error ${response.status}: ${response.statusText}`;
          }
        } else {
          resultError = `Server error ${response.status}: ${response.statusText}`;
          try {
            const textError = await response.text();
            console.error("Non-JSON error response body:", textError);
          } catch (_) {}
        }
        throw new Error(resultError);
      }
    } catch (error) {
      console.error("Failed to clear all audit logs:", error);
      window.showAlertModal(`Error clearing logs: ${error.message}`, "Error");
    } finally {
      isLoading = false;
      if (clearAllLogsBtn) clearAllLogsBtn.disabled = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  async function handleExportCsvClick() {
    if (isLoading) return;
    isLoading = true;
    if (exportCsvBtn) {
      exportCsvBtn.disabled = true;
      exportCsvBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Exporting...`;
    }

    try {
      const response = await fetch("/api/audit-log/export/csv", {
        method: "GET",
        headers: {
          Accept: "text/csv",
        },
      });

      if (!response.ok) {
        let errorMsg = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const disposition = response.headers.get("content-disposition");
      let filename = `audit_logs_${new Date().toISOString().split("T")[0]}.csv`;
      if (disposition?.includes("filename=")) {
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch?.[1]) {
          filename = filenameMatch[1];
        }
      }

      const csvData = await response.text();
      const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");

      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        window.showAlertModal("CSV generated, but your browser doesn't support automatic download.", "Download Info");
      }
    } catch (error) {
      console.error("Failed to export CSV:", error);
      window.showAlertModal(`Error exporting CSV: ${error.message}`, "Export Error");
    } finally {
      isLoading = false;
      if (exportCsvBtn) {
        exportCsvBtn.disabled = false;
        exportCsvBtn.innerHTML = `<i class="fas fa-file-csv"></i> Export CSV`;
      }
    }
  }

  detailsModalCloseBtn?.addEventListener("click", hideDetailsModal);
  detailsModalOkBtn?.addEventListener("click", hideDetailsModal);
  detailsModal?.addEventListener("click", (event) => {
    if (event.target === detailsModal) hideDetailsModal();
  });

  refreshButton?.addEventListener("click", () => {
    if (!isLoading) fetchLogs();
  });

  prevPageBtn?.addEventListener("click", () => {
    if (currentPage > 1 && !isLoading) {
      currentPage--;
      fetchLogs();
    }
  });
  nextPageBtn?.addEventListener("click", () => {
    if (currentPage < totalPages && !isLoading) {
      currentPage++;
      fetchLogs();
    }
  });

  clearAllLogsBtn?.addEventListener("click", handleClearAllLogsClick);
  exportCsvBtn?.addEventListener("click", handleExportCsvClick);

  attachSortListeners();
  attachDetailsButtonListeners();

  const initialPageInfo = document.getElementById("page-info")?.textContent || "";
  const pageMatch = initialPageInfo.match(/Page (\d+) of (\d+)/);
  const itemsMatch = initialPageInfo.match(/\((\d+) logs\)/);
  if (pageMatch) {
    currentPage = Number.parseInt(pageMatch[1], 10);
    totalPages = Number.parseInt(pageMatch[2], 10);
  }
  if (itemsMatch) {
    totalItems = Number.parseInt(itemsMatch[1], 10);
  }

  updatePaginationControls();

  const initialSortKey = document.querySelector('.data-table th[data-sort-key="created"]');
  if (initialSortKey) {
    const icon = initialSortKey.querySelector(".sort-icon i");
    if (icon) icon.className = "fas fa-sort-down";
  }
});
