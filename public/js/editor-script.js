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

  let templateConfirmCallback = null;

  function showConfirmModal(options) {
    const { title, message, action = "template", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel } = options;

    templateConfirmCallback = action === "template" ? onConfirm : null;

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

  function hideConfirmModal() {
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

  modalConfirmBtn?.addEventListener("click", () => {
    if (templateConfirmCallback) {
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
      } else {
        console.log(`Theme preference ${theme} saved to session.`);
      }
    } catch (error) {
      console.error("Network error sending theme preference:", error);
      showAlertModal("Network error saving your theme preference.", "Theme Error");
    }
  }

  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");

  for (const link of sidebarLinks) {
    link.classList.remove("active");

    const href = link.getAttribute("href");
    const navId = link.dataset.navId;

    if (href === currentPath || (currentPath === "/new" && navId === "dashboard") || (currentPath.startsWith("/edit/") && navId === "dashboard") || (currentPath.startsWith("/templates/new") && navId === "templates") || (currentPath.startsWith("/templates/edit/") && navId === "templates")) {
      link.classList.add("active");
    }
  }

  const contentTextArea = document.getElementById("content");
  let easyMDEInstance = null;
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
      console.error("Failed to initialize EasyMDE:", error);
    }
  }

  const templateContentTextArea = document.getElementById("template-content");
  let templateEasyMDEInstance = null;
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
