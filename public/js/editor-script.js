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

  const themeToggleButton = document.getElementById("theme-toggle");
  const contentTextArea = document.getElementById("content");
  const templateContentTextArea = document.getElementById("template-content");
  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  const templateSelect = document.getElementById("template-select");
  const sharePreviewButton = document.getElementById("share-preview-btn");
  const entryId = contentTextArea?.dataset.entryId;

  const passwordCheckbox = document.getElementById("set-preview-password-check");
  const passwordInput = document.getElementById("preview-password-input");

  let easyMDEInstance = null;
  let templateEasyMDEInstance = null;

  /**
   * Shows a confirmation modal dialog.
   * @param {object} options - Configuration options for the modal.
   * @param {string} [options.title="Confirm Action"] - The title of the modal.
   * @param {string} [options.message="Are you sure?"] - The message content (HTML allowed).
   * @param {string} [options.confirmText="Confirm"] - Text for the confirm button.
   * @param {string} [options.cancelText="Cancel"] - Text for the cancel button.
   * @param {function} options.onConfirm - Callback function executed when confirmed.
   * @param {function} [options.onCancel] - Callback function executed when cancelled.
   */
  function showConfirmModal(options) {
    const { title, message, confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    if (modalTitle) modalTitle.textContent = title || "Confirm Action";
    if (modalMessage) modalMessage.innerHTML = message || "Are you sure?";

    if (modalConfirmBtn) {
      modalConfirmBtn.className = "btn btn-primary";
      modalConfirmBtn.innerHTML = confirmText;
    }

    if (modalCancelBtn) modalCancelBtn.textContent = cancelText;

    if (confirmModal) {
      confirmModal.classList.add("is-visible");
      confirmModal.setAttribute("aria-hidden", "false");
      confirmModal._onConfirm = onConfirm;
      confirmModal._onCancel = onCancel;
    }
  }

  /**
   * Hides the confirmation modal dialog.
   */
  function hideConfirmModal() {
    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = null;
      confirmModal._onCancel = null;
    }
  }

  /**
   * Shows an alert modal dialog.
   * @param {string} message - The message content (HTML allowed).
   * @param {string} [title="Notification"] - The title of the modal.
   */
  function showAlertModal(message, title = "Notification") {
    if (alertModalMessage) alertModalMessage.innerHTML = message;
    if (alertModalTitle) alertModalTitle.textContent = title;
    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");
    }
  }

  /**
   * Hides the alert modal dialog.
   */
  function hideAlertModal() {
    if (alertModal) {
      alertModal.classList.remove("is-visible");
      alertModal.setAttribute("aria-hidden", "true");
    }
  }

  /**
   * Applies the specified theme (light/dark) to the UI elements.
   * @param {string} theme - The theme to apply ("light" or "dark").
   */
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

    const templateEasyMDE_CM = document.querySelector("#template-content + .EasyMDEContainer .CodeMirror");
    if (templateEasyMDE_CM) {
      if (theme === "dark") {
        templateEasyMDE_CM.classList.add("cm-s-easymde-dark");
      } else {
        templateEasyMDE_CM.classList.remove("cm-s-easymde-dark");
      }
    }
  };

  /**
   * Sets the theme preference locally and attempts to save it on the server.
   * @param {string} theme - The theme to set ("light" or "dark").
   */
  async function setThemePreference(theme) {
    applyTheme(theme);

    try {
      localStorage.setItem("theme", theme);
    } catch (e) {
      console.warn("Could not save theme to localStorage:", e);
    }

    try {
      const response = await fetch("/api/set-theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ theme: theme }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to set theme preference on server:", response.status, errorData.error || response.statusText);
        showAlertModal("Could not save your theme preference to the server.", "Theme Error");
      }
    } catch (error) {
      console.error("Network error sending theme preference:", error);
      showAlertModal("Network error saving your theme preference.", "Theme Error");
    }
  }

  /**
   * Copies text to the clipboard and shows feedback on a button.
   * @param {string} textToCopy The text to copy.
   * @param {HTMLButtonElement} buttonElement The button to show feedback on.
   */
  function copyToClipboard(textToCopy, buttonElement) {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        const originalHtml = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="fas fa-check"></i> Copied!';
        buttonElement.disabled = true;
        setTimeout(() => {
          buttonElement.innerHTML = originalHtml;
          buttonElement.disabled = false;
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
        showAlertModal("Could not copy link to clipboard.", "Copy Error");
      });
  }

  modalConfirmBtn?.addEventListener("click", () => {
    if (confirmModal && typeof confirmModal._onConfirm === "function") {
      confirmModal._onConfirm();
    }
    hideConfirmModal();
  });

  modalCancelBtn?.addEventListener("click", () => {
    if (confirmModal && typeof confirmModal._onCancel === "function") {
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

  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  mobileNavToggle?.addEventListener("click", () => {
    if (sidebar) sidebar.classList.toggle("is-open");
  });

  templateSelect?.addEventListener("change", async (event) => {
    const templateId = event.target.value;

    const applyTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${templateId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch template: ${response.statusText}`);
        }
        const templateData = await response.json();
        if (templateData?.content) {
          if (easyMDEInstance) {
            easyMDEInstance.value(templateData.content);
          } else if (contentTextArea) {
            contentTextArea.value = templateData.content;
          }
        }
      } catch (error) {
        console.error("Error applying template:", error);
        showAlertModal("Could not load the selected template.", "Template Error");
      }
    };

    if (!templateId) {
      if (easyMDEInstance) easyMDEInstance.value("");
      else if (contentTextArea) contentTextArea.value = "";
      return;
    }

    const currentContent = easyMDEInstance ? easyMDEInstance.value() : contentTextArea?.value || "";
    if (currentContent.trim() !== "") {
      showConfirmModal({
        title: "Confirm Template Use",
        message: "Using a template will replace the current content. Continue?",
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

  passwordCheckbox?.addEventListener("change", () => {
    if (passwordInput) {
      passwordInput.style.display = passwordCheckbox.checked ? "inline-block" : "none";
      if (!passwordCheckbox.checked) {
        passwordInput.value = "";
      }
    }
  });

  sharePreviewButton?.addEventListener("click", async () => {
    if (!entryId) {
      showAlertModal("Cannot generate preview link: Entry ID is missing.", "Error");
      return;
    }

    let passwordToSend = null;
    if (passwordCheckbox?.checked) {
      passwordToSend = passwordInput?.value;
      if (!passwordToSend || passwordToSend.trim() === "") {
        showAlertModal("Please enter a password or uncheck the 'Require Password' box.", "Password Missing");
        passwordInput?.focus();
        return;
      }
    }

    sharePreviewButton.disabled = true;
    sharePreviewButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating...`;

    const requestBody = {};
    if (passwordToSend) {
      requestBody.password = passwordToSend;
    }

    try {
      const response = await fetch(`/api/entries/${entryId}/generate-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      const expiryDate = new Date(result.expiresAt);
      const formattedExpiry = expiryDate.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const passwordNotice = result.hasPassword ? '<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 5px;"><strong>Password protected.</strong></p>' : "";

      const modalContent = `
        <p>Shareable preview link generated successfully:</p>
        <input type="text" class="form-control" value="${result.previewUrl}" readonly style="margin-bottom: 10px;">
        <button id="copy-preview-link-btn" class="btn btn-secondary btn-sm">
          <i class="fas fa-copy"></i> Copy Link
        </button>
        ${passwordNotice}
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 10px;">
          Link expires: ${formattedExpiry}
        </p>
      `;
      showAlertModal(modalContent, "Preview Link Generated");

      const copyBtn = document.getElementById("copy-preview-link-btn");
      copyBtn?.addEventListener("click", () => {
        copyToClipboard(result.previewUrl, copyBtn);
      });
    } catch (error) {
      console.error("Failed to generate preview link:", error);
      showAlertModal(`Could not generate preview link: ${error.message}`, "Error");
    } finally {
      sharePreviewButton.disabled = false;
      sharePreviewButton.innerHTML = `<i class="fas fa-share-alt"></i> Share Preview`;
    }
  });

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");

  for (const link of sidebarLinks) {
    link.classList.remove("active");

    const href = link.getAttribute("href");
    const navId = link.dataset.navId;

    const isCurrentPath = href === currentPath;
    const isNewEntry = currentPath === "/new" && navId === "dashboard";
    const isEditEntry = currentPath.startsWith("/edit/") && navId === "dashboard";
    const isNewTemplate = currentPath.startsWith("/templates/new") && navId === "templates";
    const isEditTemplate = currentPath.startsWith("/templates/edit/") && navId === "templates";

    if (isCurrentPath || isNewEntry || isEditEntry || isNewTemplate || isEditTemplate) {
      link.classList.add("active");
    }
  }

  if (contentTextArea) {
    try {
      const customToolbar = ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "code", "table"];
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
      console.error("Failed to initialize EasyMDE for content:", error);
      showAlertModal("Failed to load the text editor.", "Editor Error");
    }
  }

  if (templateContentTextArea) {
    try {
      const customToolbar = ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "code", "table"];
      templateEasyMDEInstance = new EasyMDE({
        element: templateContentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: customToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
      });

      if (document.body.classList.contains("dark-mode")) {
        document.querySelector("#template-content + .EasyMDEContainer .CodeMirror")?.classList.add("cm-s-easymde-dark");
      }
    } catch (error) {
      console.error("Failed to initialize EasyMDE for template:", error);
      showAlertModal("Failed to load the template editor.", "Editor Error");
    }
  }
});
