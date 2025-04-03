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

  let formToSubmit = null;
  let bulkActionDetails = null;
  let templateConfirmCallback = null;

  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  function showConfirmModal(options) {
    const { form, title, message, action = "delete", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    formToSubmit = form || null;
    bulkActionDetails = action === "bulk" ? options.details : null;
    templateConfirmCallback = action === "template" ? onConfirm : null;

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
    templateConfirmCallback = null;

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

  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    let title = "this item";
    let message = "";
    if (form.classList.contains("delete-form")) {
      title = form.closest("tr")?.querySelector("td[data-label='Title']")?.textContent || "this entry";
      message = `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`;
    } else if (form.classList.contains("delete-template-form")) {
      title = form.closest("tr")?.querySelector("td[data-label='Name']")?.textContent || "this template";
      message = `Are you sure you want to delete the template "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`;
    }
    showConfirmModal({ form: form, title: "Confirm Deletion", message: message, action: "delete", confirmText: "Delete" });
  }

  function attachDeleteListeners() {
    const deleteEntryForms = document.querySelectorAll("form.delete-form");
    deleteEntryForms.forEach((form) => {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    });

    const deleteTemplateForms = document.querySelectorAll("form.delete-template-form");
    deleteTemplateForms.forEach((form) => {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    });
  }

  attachDeleteListeners();

  modalConfirmBtn?.addEventListener("click", () => {
    if (formToSubmit) {
      formToSubmit.submit();
    } else if (bulkActionDetails) {
      handleBulkActionConfirm(bulkActionDetails.action, bulkActionDetails.ids);
    } else if (templateConfirmCallback) {
      templateConfirmCallback();
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
  const currentTheme = localStorage.getItem("theme") || "light";
  const applyTheme = (theme) => {
    if (theme === "dark") {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }

    const easyMDE_CM = document.querySelector(".EasyMDEContainer .CodeMirror");
    if (easyMDE_CM) {
      if (theme === "dark") {
        easyMDE_CM.classList.add("cm-s-easymde-dark");
      } else {
        easyMDE_CM.classList.remove("cm-s-easymde-dark");
      }
    }
  };

  applyTheme(currentTheme);
  themeToggleButton?.addEventListener("click", () => {
    const newTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
    applyTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  });

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");
  sidebarLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === currentPath || (currentPath === "/" && link.dataset.navId === "dashboard") || (currentPath === "/new" && link.dataset.navId === "create") || (currentPath.startsWith("/edit/") && link.dataset.navId === "dashboard") || (currentPath.startsWith("/templates") && link.dataset.navId === "templates")) {
      link.classList.add("active");
    }
  });

  const contentTextArea = document.getElementById("content");
  let easyMDEInstance = null;
  if (contentTextArea) {
    try {
      const customToolbar = ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "code", "table", "|", "preview"];
      easyMDEInstance = new EasyMDE({
        element: contentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: customToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
      });

      if (document.body.classList.contains("dark-mode")) {
        document.querySelector(".EasyMDEContainer .CodeMirror")?.classList.add("cm-s-easymde-dark");
      }

      const charCountElement = document.getElementById("content-char-count");
      const characterLimit = 50000;

      const updateCharCount = () => {
        if (!easyMDEInstance || !charCountElement) return;
        const currentLength = easyMDEInstance.value().length;
        charCountElement.textContent = `${currentLength} / ${characterLimit}`;
        const easyMDEContainer = easyMDEInstance.element.closest(".EasyMDEContainer");
        if (currentLength > characterLimit) {
          charCountElement.classList.add("over-limit");
          if (easyMDEContainer) easyMDEContainer.classList.add("invalid");
        } else {
          charCountElement.classList.remove("over-limit");
          if (easyMDEContainer) easyMDEContainer.classList.remove("invalid");
        }
      };

      updateCharCount();
      easyMDEInstance.codemirror.on("change", updateCharCount);
    } catch (error) {
      console.error("Failed to initialize EasyMDE:", error);
    }
  }

  const templateContentTextArea = document.getElementById("template-content");
  let templateEasyMDEInstance = null;
  if (templateContentTextArea) {
    try {
      templateEasyMDEInstance = new EasyMDE({
        element: templateContentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "code", "table"],
        renderingConfig: { codeSyntaxHighlighting: true },
      });

      if (document.body.classList.contains("dark-mode")) {
        document.querySelector("#template-content + .EasyMDEContainer .CodeMirror")?.classList.add("cm-s-easymde-dark");
      }
    } catch (error) {
      console.error("Failed to initialize EasyMDE for template:", error);
    }
  }

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  mobileNavToggle?.addEventListener("click", () => {
    if (sidebar) sidebar.classList.toggle("is-open");
  });

  document.addEventListener("keydown", (event) => {
    const isSKey = event.key.toLowerCase() === "s";
    const isModifierPressed = event.ctrlKey || event.metaKey;
    if (isSKey && isModifierPressed) {
      const entryForm = document.querySelector("form.entry-form, form.template-form");
      if (entryForm && !confirmModal?.classList.contains("is-visible") && !alertModal?.classList.contains("is-visible")) {
        event.preventDefault();
        const submitButton = entryForm.querySelector('button[type="submit"]');
        if (submitButton) {
          submitButton.click();
        } else {
          entryForm.submit();
        }
      }
    }
  });

  const refreshButton = document.getElementById("refresh-entries-btn");
  const tableBody = document.getElementById("entries-table-body");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  const bulkActionsContainer = document.getElementById("bulk-actions-container");
  const bulkSelectedCount = document.getElementById("bulk-selected-count");
  const bulkActionsButton = document.getElementById("bulk-actions-button");
  const bulkActionsMenu = document.getElementById("bulk-actions-menu");

  function updateBulkActionUI() {
    const checkedCheckboxes = document.querySelectorAll(".entry-checkbox:checked");
    const count = checkedCheckboxes.length;

    if (count > 0) {
      if (bulkActionsContainer) bulkActionsContainer.style.display = "flex";
      if (bulkSelectedCount) bulkSelectedCount.textContent = count;
    } else {
      if (bulkActionsContainer) bulkActionsContainer.style.display = "none";
      if (bulkActionsMenu) bulkActionsMenu.classList.remove("show");
    }

    if (selectAllCheckbox) {
      const totalCheckboxes = document.querySelectorAll(".entry-checkbox").length;
      selectAllCheckbox.checked = totalCheckboxes > 0 && count === totalCheckboxes;
      selectAllCheckbox.indeterminate = count > 0 && count < totalCheckboxes;
    }
  }

  selectAllCheckbox?.addEventListener("change", (event) => {
    document.querySelectorAll(".entry-checkbox").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
    updateBulkActionUI();
  });

  tableBody?.addEventListener("change", (event) => {
    if (event.target.classList.contains("entry-checkbox")) {
      updateBulkActionUI();
    }
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
      const selectedIds = Array.from(document.querySelectorAll(".entry-checkbox:checked")).map((cb) => cb.value);

      if (action && selectedIds.length > 0) {
        bulkActionsMenu.classList.remove("show");
        showConfirmModal({ details: { action, ids: selectedIds }, title: "Confirm Bulk Action", action: "bulk" });
      }
    }
  });

  async function handleBulkActionConfirm(action, ids) {
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

      if (!tableBody) return;
      tableBody.innerHTML = "";

      const emptyStateCard = document.querySelector(".empty-state-card");
      const dataCard = document.querySelector(".data-card");

      if (entries.length > 0) {
        entries.forEach((entry) => {
          const row = document.createElement("tr");
          row.innerHTML = renderTableRow(entry);
          tableBody.appendChild(row);
        });
        attachDeleteListeners();
        if (dataCard) dataCard.style.display = "";
        if (emptyStateCard) emptyStateCard.style.display = "none";
      } else {
        if (dataCard) dataCard.style.display = "none";
        if (emptyStateCard) emptyStateCard.style.display = "";
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries found.</td></tr>';
      }
    } catch (error) {
      console.error("Failed to refresh entries:", error);
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>';
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = originalButtonHtml;
      }
      if (selectAllCheckbox) selectAllCheckbox.checked = false;
      updateBulkActionUI();
    }
  });

  function renderTableRow(entry) {
    const formattedUpdated = entry.formattedUpdated || new Date(entry.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const viewUrl = entry.viewUrl || `/view/${escapeHtml(entry.id)}`;
    let tagsHtml = '<span class="text-muted">-</span>';
    if (entry.tags?.trim()) {
      tagsHtml = entry.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag)
        .map((tag) => `<a class="badge tag-badge">${escapeHtml(tag)}</a>`)
        .join(" ");
    }

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}">
        <td class="checkbox-column"><input type="checkbox" class="entry-checkbox" value="${escapeHtml(entry.id)}"></td>
        <td data-label="Title">${escapeHtml(entry.title)}</td>
        <td data-label="Status"><span class="badge status-badge status-${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></td>
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

  const templateSelect = document.getElementById("template-select");
  templateSelect?.addEventListener("change", async (event) => {
    const templateId = event.target.value;
    const applyTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${templateId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch template: ${response.statusText}`);
        }
        const templateData = await response.json();
        if (templateData?.content && easyMDEInstance) {
          easyMDEInstance.value(templateData.content);
        } else if (templateData?.content && contentTextArea) {
          contentTextArea.value = templateData.content;
        }
      } catch (error) {
        console.error("Error applying template:", error);
        showAlertModal("Could not load the selected template.", "Template Error");
      }
    };

    if (!templateId) {
      if (easyMDEInstance) easyMDEInstance.value("");
      return;
    }

    if (easyMDEInstance && easyMDEInstance.value().trim() !== "") {
      showConfirmModal({
        title: "Confirm Template Use",
        message: "Using a template will replace the current content. Continue?",
        action: "template",
        confirmText: "Replace Content",
        onConfirm: () => {
          applyTemplate();
        },
        onCancel: () => {
          event.target.value = "";
        },
      });
    } else {
      applyTemplate();
    }
  });
});
