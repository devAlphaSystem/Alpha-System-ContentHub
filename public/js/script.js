document.addEventListener("DOMContentLoaded", () => {
  const confirmModal = document.getElementById("confirm-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalConfirmBtn = document.getElementById("modal-confirm-btn");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  let formToSubmit = null;

  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  function showConfirmModal(form, title) {
    formToSubmit = form;
    if (modalTitle) modalTitle.textContent = "Confirm Deletion";
    if (modalMessage) {
      modalMessage.innerHTML = `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?<br>This action cannot be undone.`;
    }
    if (confirmModal) {
      confirmModal.classList.add("is-visible");
      confirmModal.setAttribute("aria-hidden", "false");
    }
  }

  function hideConfirmModal() {
    formToSubmit = null;
    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
    }
  }

  function handleDeleteSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const title = form.closest("tr")?.querySelector("td[data-label='Title']")?.textContent || "this entry";
    showConfirmModal(form, title);
  }

  function attachDeleteListeners() {
    const deleteForms = document.querySelectorAll("form.delete-form");
    deleteForms.forEach((form) => {
      form.removeEventListener("submit", handleDeleteSubmit);
      form.addEventListener("submit", handleDeleteSubmit);
    });
  }

  attachDeleteListeners();

  modalConfirmBtn?.addEventListener("click", () => {
    if (formToSubmit) {
      formToSubmit.submit();
    }
    hideConfirmModal();
  });

  modalCancelBtn?.addEventListener("click", hideConfirmModal);
  modalCloseBtn?.addEventListener("click", hideConfirmModal);
  confirmModal?.addEventListener("click", (event) => {
    if (event.target === confirmModal) {
      hideConfirmModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && confirmModal?.classList.contains("is-visible")) {
      hideConfirmModal();
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
    if (link.getAttribute("href") === currentPath || (currentPath === "/" && link.dataset.navId === "dashboard") || (currentPath === "/new" && link.dataset.navId === "create") || (currentPath.startsWith("/edit/") && link.dataset.navId === "dashboard")) {
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
      const characterLimit = 10000;

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

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  mobileNavToggle?.addEventListener("click", () => {
    if (sidebar) sidebar.classList.toggle("is-open");
  });

  document.addEventListener("keydown", (event) => {
    const isSKey = event.key.toLowerCase() === "s";
    const isModifierPressed = event.ctrlKey || event.metaKey;
    if (isSKey && isModifierPressed) {
      const entryForm = document.querySelector("form.entry-form");
      if (entryForm) {
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
  refreshButton?.addEventListener("click", async () => {
    if (refreshButton.disabled) return;

    const originalButtonHtml = refreshButton.innerHTML;
    refreshButton.disabled = true;
    refreshButton.innerHTML = `
      <i class="fas fa-sync-alt fa-spin"></i> <span>Loading...</span>
    `;

    try {
      const response = await fetch("/api/entries");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

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
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No entries found.</td></tr>';
      }
    } catch (error) {
      console.error("Failed to refresh entries:", error);
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--danger-color);">Error loading entries.</td></tr>';
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.innerHTML = originalButtonHtml;
      }
    }
  });

  function renderTableRow(entry) {
    const formattedUpdated = entry.formattedUpdated || new Date(entry.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const viewUrl = entry.viewUrl || `/view/${escapeHtml(entry.id)}`;

    return `
      <tr data-entry-id="${escapeHtml(entry.id)}">
        <td data-label="Title">${escapeHtml(entry.title)}</td>
        <td data-label="Type">
          <span class="badge badge-${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span>
        </td>
        <td data-label="Domain">${escapeHtml(entry.domain)}</td>
        <td data-label="Views">${entry.views || 0}</td>
        <td data-label="Updated">${formattedUpdated}</td>
        <td data-label="Actions" class="actions-cell">
          <a href="${viewUrl}" target="_blank" class="btn btn-icon btn-view" title="View Public Page">
            <i class="fas fa-eye"></i>
          </a>
          <a href="/edit/${escapeHtml(entry.id)}" class="btn btn-icon btn-edit" title="Edit Entry">
            <i class="fas fa-pencil-alt"></i>
          </a>
          <form action="/delete/${escapeHtml(entry.id)}" method="POST" class="delete-form" title="Delete Entry">
            <button type="submit" class="btn btn-icon btn-delete">
              <i class="fas fa-trash-alt"></i>
            </button>
          </form>
        </td>
      </tr>
    `;
  }
});
