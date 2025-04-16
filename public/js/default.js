document.addEventListener("DOMContentLoaded", () => {
  const fields = document.querySelectorAll("input");
  for (const field of fields) {
    field.setAttribute("autocomplete", "off");
  }

  window.escapeHtml = (unsafe) => {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  const confirmModal = document.getElementById("confirm-modal");
  const confirmModalTitle = document.getElementById("modal-title");
  const confirmModalMessage = document.getElementById("modal-message");
  const confirmModalConfirmBtn = document.getElementById("modal-confirm-btn");
  const confirmModalCancelBtn = document.getElementById("modal-cancel-btn");
  const confirmModalCloseBtn = document.getElementById("modal-close-btn");
  const confirmModalFooter = confirmModal?.querySelector(".modal-footer");

  const alertModal = document.getElementById("alert-modal");
  const alertModalTitle = document.getElementById("alert-modal-title");
  const alertModalMessage = document.getElementById("alert-modal-message");
  let alertModalOkBtn = document.getElementById("alert-modal-ok-btn");
  let alertModalCloseBtn = document.getElementById("alert-modal-close-btn");

  const themeToggleButton = document.getElementById("theme-toggle");
  const sidebarLogoImg = document.getElementById("sidebar-logo-img");

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.querySelector(".sidebar");
  const mobileNavBackdrop = document.getElementById("mobile-nav-backdrop");

  window.showConfirmModal = (options) => {
    const { title, message, confirmText = "Confirm", cancelText = "Cancel", neutralText, onConfirm, onCancel, onNeutral, action = "confirm", details, form } = options;

    if (confirmModalTitle) confirmModalTitle.textContent = title || "Confirm Action";
    if (confirmModalMessage) confirmModalMessage.innerHTML = message || "Are you sure?";

    if (confirmModalConfirmBtn) {
      confirmModalConfirmBtn.removeAttribute("data-is-bulk");
      confirmModalConfirmBtn.removeAttribute("data-bulk-action");
      confirmModalConfirmBtn.removeAttribute("data-bulk-ids");

      const isBulk = action?.startsWith("bulk");
      if (isBulk && details) {
        confirmModalConfirmBtn.dataset.isBulk = "true";
        confirmModalConfirmBtn.dataset.bulkAction = details.action;
        confirmModalConfirmBtn.dataset.bulkIds = JSON.stringify(details.ids);
      }

      let btnClass = "btn ";
      let btnIcon = "";
      const isDeleteStyle = action === "delete" || action === "bulk-delete";
      const isPublishStyle = action === "publish-staged" || action === "bulk-publish-staged";

      if (isDeleteStyle) {
        btnClass += "btn-danger";
        btnIcon = '<i class="fas fa-trash-alt"></i> ';
      } else if (isPublishStyle) {
        btnClass += "btn-success";
        btnIcon = '<i class="fas fa-upload"></i> ';
      } else {
        btnClass += "btn-primary";
      }
      confirmModalConfirmBtn.className = btnClass;
      confirmModalConfirmBtn.innerHTML = `${btnIcon}${escapeHtml(confirmText)}`;
    }

    if (confirmModalCancelBtn) confirmModalCancelBtn.textContent = cancelText;

    const existingNeutralBtn = confirmModalFooter?.querySelector("#modal-neutral-btn");
    if (existingNeutralBtn) existingNeutralBtn.remove();

    if (neutralText && onNeutral && confirmModalFooter) {
      const neutralBtn = document.createElement("button");
      neutralBtn.id = "modal-neutral-btn";
      neutralBtn.className = "btn btn-secondary";
      neutralBtn.textContent = neutralText;
      neutralBtn.addEventListener("click", () => {
        if (onNeutral) onNeutral();
        hideConfirmModal();
      });
      confirmModalFooter.insertBefore(neutralBtn, confirmModalConfirmBtn);
    }

    if (confirmModal) {
      confirmModal.classList.add("is-visible");
      confirmModal.setAttribute("aria-hidden", "false");
      confirmModal._onConfirm = onConfirm;
      confirmModal._onCancel = onCancel;
      confirmModal._formToSubmit = form || null;
    }
  };

  window.hideConfirmModal = () => {
    if (confirmModal) {
      confirmModal.classList.remove("is-visible");
      confirmModal.setAttribute("aria-hidden", "true");
      confirmModal._onConfirm = undefined;
      confirmModal._onCancel = undefined;
      confirmModal._formToSubmit = undefined;
      if (confirmModalConfirmBtn) {
        confirmModalConfirmBtn.removeAttribute("data-is-bulk");
        confirmModalConfirmBtn.removeAttribute("data-bulk-action");
        confirmModalConfirmBtn.removeAttribute("data-bulk-ids");
      }
      const existingNeutralBtn = confirmModalFooter?.querySelector("#modal-neutral-btn");
      if (existingNeutralBtn) existingNeutralBtn.remove();
    }
  };

  window.showAlertModal = (message, title = "Notification") => {
    if (alertModalMessage) alertModalMessage.innerHTML = message;
    if (alertModalTitle) alertModalTitle.textContent = title;
    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");
    }
  };

  window.hideAlertModal = () => {
    if (alertModal) {
      alertModal.classList.remove("is-visible");
      alertModal.setAttribute("aria-hidden", "true");
    }
  };

  window.showPasswordPromptModal = (options) => {
    const { title, message, confirmText = "Confirm", onConfirm, onCancel } = options;

    if (alertModalTitle) alertModalTitle.textContent = title || "Enter Password";
    if (alertModalMessage) {
      alertModalMessage.innerHTML = `
        <p>${message || "Please enter the password:"}</p>
        <input type="password" id="modal-password-input" class="form-control" style="margin-top: 10px;" autofocus>
        <small id="modal-password-error" style="color: var(--danger-color); display: none; margin-top: 5px;">Password cannot be empty.</small>
      `;
    }

    if (alertModalOkBtn) {
      alertModalOkBtn.textContent = confirmText;

      const newOkBtn = alertModalOkBtn.cloneNode(true);
      alertModalOkBtn.parentNode.replaceChild(newOkBtn, alertModalOkBtn);
      alertModalOkBtn = newOkBtn;

      alertModalOkBtn.addEventListener("click", () => {
        const passwordInput = document.getElementById("modal-password-input");
        const passwordError = document.getElementById("modal-password-error");
        const password = passwordInput?.value;

        if (!password || password.trim() === "") {
          if (passwordError) passwordError.style.display = "block";
          if (passwordInput) passwordInput.focus();
          return;
        }

        if (passwordError) passwordError.style.display = "none";
        if (onConfirm) onConfirm(password);
        hideAlertModal();
      });
    }

    if (alertModalCloseBtn) {
      const newCloseBtn = alertModalCloseBtn.cloneNode(true);
      alertModalCloseBtn.parentNode.replaceChild(newCloseBtn, alertModalCloseBtn);
      alertModalCloseBtn = newCloseBtn;

      alertModalCloseBtn.addEventListener("click", () => {
        if (onCancel) onCancel();
        hideAlertModal();
      });
    }

    alertModal?.addEventListener("click", (event) => {
      if (event.target === alertModal) {
        if (onCancel) onCancel();
        hideAlertModal();
      }
    });

    if (alertModal) {
      alertModal.classList.add("is-visible");
      alertModal.setAttribute("aria-hidden", "false");

      setTimeout(() => {
        document.getElementById("modal-password-input")?.focus();
      }, 100);
    }
  };

  const applyTheme = (theme) => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    if (sidebarLogoImg) {
      sidebarLogoImg.src = theme === "dark" ? "/img/logo_white.png" : "/img/logo.png";
    }
    const codeMirrors = document.querySelectorAll(".EasyMDEContainer .CodeMirror");
    for (const cm of codeMirrors) {
      cm.classList.toggle("cm-s-easymde-dark", theme === "dark");
    }
    document.dispatchEvent(new CustomEvent("themeChanged", { detail: theme }));
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
      }
    } catch (error) {
      console.error("Network error sending theme preference:", error);
      showAlertModal("Network error saving your theme preference.", "Theme Error");
    }
  }

  confirmModalConfirmBtn?.addEventListener("click", () => {
    if (confirmModal?._formToSubmit) {
      confirmModal._formToSubmit.submit();
    } else if (confirmModal?._onConfirm) {
      confirmModal._onConfirm();
    }
    hideConfirmModal();
  });

  confirmModalCancelBtn?.addEventListener("click", () => {
    if (confirmModal?._onCancel) {
      confirmModal._onCancel();
    }
    hideConfirmModal();
  });

  confirmModalCloseBtn?.addEventListener("click", hideConfirmModal);

  confirmModal?.addEventListener("click", (event) => {
    if (event.target === confirmModal) hideConfirmModal();
  });

  const originalAlertOkBtn = document.getElementById("alert-modal-ok-btn");
  const originalAlertCloseBtn = document.getElementById("alert-modal-close-btn");
  originalAlertOkBtn?.addEventListener("click", hideAlertModal);
  originalAlertCloseBtn?.addEventListener("click", hideAlertModal);
  alertModal?.addEventListener("click", (event) => {
    if (event.target === alertModal && !document.getElementById("modal-password-input")) {
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
      const detailsModal = document.getElementById("details-modal");
      if (detailsModal?.classList.contains("is-visible")) {
        detailsModal.classList.remove("is-visible");
        detailsModal.setAttribute("aria-hidden", "true");
      }
      if (sidebar?.classList.contains("is-open")) {
        sidebar.classList.remove("is-open");
        mobileNavBackdrop?.classList.remove("is-visible");
        document.body.classList.remove("mobile-menu-open");
      }
    }
  });

  themeToggleButton?.addEventListener("click", () => {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    setThemePreference(newTheme);
  });

  mobileNavToggle?.addEventListener("click", () => {
    const isOpen = sidebar?.classList.toggle("is-open");
    mobileNavBackdrop?.classList.toggle("is-visible", isOpen);
    document.body.classList.toggle("mobile-menu-open", isOpen);
  });

  mobileNavBackdrop?.addEventListener("click", () => {
    sidebar?.classList.remove("is-open");
    mobileNavBackdrop.classList.remove("is-visible");
    document.body.classList.remove("mobile-menu-open");
  });

  const savedTheme = localStorage.getItem("theme");
  const serverTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  applyTheme(savedTheme || serverTheme);

  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll(".sidebar-inner .nav-link");
  let activeLinkFound = false;
  const currentProjectId = document.body.dataset.projectId;
  const currentEntryType = document.body.dataset.entryType;

  const projectSubpageRegex = /^\/projects\/([a-zA-Z0-9]+)\/(.+)/;
  const projectEditEntryRegex = /^\/projects\/[a-zA-Z0-9]+\/edit\/[a-zA-Z0-9]+$/;
  const projectNewEntryRegex = /^\/projects\/[a-zA-Z0-9]+\/new$/;

  for (const link of sidebarLinks) {
    link.classList.remove("active");
    const navId = link.dataset.navId;
    const href = link.getAttribute("href");
    let isActive = false;

    if (href === currentPath) {
      isActive = true;
    } else if (navId === "dashboard" && currentPath === "/") {
      isActive = true;
    } else if (navId === "projects" && currentPath === "/projects") {
      isActive = true;
    } else if (navId === "audit-log" && currentPath === "/audit-log") {
      isActive = true;
    } else if (currentProjectId && projectSubpageRegex.test(currentPath)) {
      const match = currentPath.match(projectSubpageRegex);
      const projectIdFromPath = match ? match[1] : null;
      const subPath = match ? match[2] : null;

      if (projectIdFromPath === currentProjectId && subPath) {
        const expectedBasePath = `/projects/${currentProjectId}`;

        switch (navId) {
          case "project-overview":
            isActive = currentPath === expectedBasePath;
            break;
          case "project-templates":
            isActive = currentPath.startsWith(`${expectedBasePath}/templates`);
            break;
          case "project-documentation":
            isActive = currentPath === `${expectedBasePath}/documentation`;
            break;
          case "project-doc-headers":
            isActive = currentPath.startsWith(`${expectedBasePath}/documentation_headers`);
            break;
          case "project-doc-footers":
            isActive = currentPath.startsWith(`${expectedBasePath}/documentation_footers`);
            break;
          case "project-archived-doc":
            isActive = currentPath.startsWith(`${expectedBasePath}/archived_documentation`);
            break;
          case "project-changelogs":
            isActive = currentPath === `${expectedBasePath}/changelogs`;
            break;
          case "project-cl-headers":
            isActive = currentPath.startsWith(`${expectedBasePath}/changelog_headers`);
            break;
          case "project-cl-footers":
            isActive = currentPath.startsWith(`${expectedBasePath}/changelog_footers`);
            break;
          case "project-archived-cl":
            isActive = currentPath.startsWith(`${expectedBasePath}/archived_changelogs`);
            break;
          case "project-roadmaps":
            isActive = currentPath === `${expectedBasePath}/roadmaps`;
            break;
          case "project-archived-roadmap":
            isActive = currentPath.startsWith(`${expectedBasePath}/archived_roadmaps`);
            break;
          case "project-settings":
            isActive = currentPath === `${expectedBasePath}/edit`;
            break;
          case "project-audit-log":
            isActive = currentPath.startsWith(`${expectedBasePath}/audit-log`);
            break;
        }

        if (!isActive) {
          if (projectNewEntryRegex.test(currentPath)) {
            const typeParam = new URLSearchParams(window.location.search).get("type");
            if (typeParam === "documentation" && navId === "project-documentation") isActive = true;
            else if (typeParam === "changelog" && navId === "project-changelogs") isActive = true;
            else if (typeParam === "roadmap" && navId === "project-roadmaps") isActive = true;
            else if (!typeParam && navId === "project-documentation") isActive = true;
          } else if (projectEditEntryRegex.test(currentPath)) {
            if (currentEntryType === "documentation" && navId === "project-documentation") isActive = true;
            else if (currentEntryType === "changelog" && navId === "project-changelogs") isActive = true;
            else if (currentEntryType === "roadmap" && navId === "project-roadmaps") isActive = true;
          }
        }
      }
    }

    if (isActive) {
      link.classList.add("active");
      activeLinkFound = true;

      const collapsibleContent = link.closest(".collapsible-content");
      if (collapsibleContent) {
        const header = document.querySelector(`.collapsible-header[data-target="${collapsibleContent.id}"]`);
        if (header && !header.classList.contains("is-expanded")) {
          header.classList.add("is-expanded");
          header.classList.remove("is-collapsed");
          header.setAttribute("aria-expanded", "true");
          collapsibleContent.classList.add("is-expanded");
          collapsibleContent.classList.remove("is-collapsed");
        }
      }
    }
  }

  if (!activeLinkFound && currentPath !== "/login") {
    if (projectSubpageRegex.test(currentPath)) {
      const overviewLink = document.querySelector(`.sidebar-nav .nav-link[data-nav-id="project-overview"]`);
      if (overviewLink) {
        overviewLink.classList.add("active");
      } else {
        const projectsLink = document.querySelector('.sidebar-nav .nav-link[data-nav-id="projects"]');
        projectsLink?.classList.add("active");
      }
    } else {
      const dashboardLink = document.querySelector('.sidebar-nav .nav-link[data-nav-id="dashboard"]');
      dashboardLink?.classList.add("active");
    }
  }

  const sidebarInner = document.querySelector(".sidebar-inner");
  const sidebarNav = sidebarInner?.querySelector(".sidebar-nav");

  function setInitialCollapseState() {
    const headers = sidebarNav?.querySelectorAll(".collapsible-header");
    if (!headers || !sidebarInner) return;

    sidebarInner.classList.add("collapsible-initializing");

    setTimeout(() => {
      for (const header of headers) {
        const targetId = header.dataset.target;
        const content = document.getElementById(targetId);
        if (!content) continue;

        const storageKey = `sidebarCollapse_${targetId}`;
        const shouldBeCollapsed = localStorage.getItem(storageKey) === "true";
        const isActiveInside = content.querySelector(".nav-link.active");

        if (isActiveInside && shouldBeCollapsed) {
          localStorage.removeItem(storageKey);
        }

        const isCollapsed = isActiveInside ? false : shouldBeCollapsed;

        if (!isCollapsed) {
          header.classList.add("is-expanded");
          header.classList.remove("is-collapsed");
          header.setAttribute("aria-expanded", "true");
          content.classList.add("is-expanded");
          content.classList.remove("is-collapsed");
        } else {
          header.classList.add("is-collapsed");
          header.classList.remove("is-expanded");
          header.setAttribute("aria-expanded", "false");
          content.classList.add("is-collapsed");
          content.classList.remove("is-expanded");
        }
        content.removeAttribute("style");
      }
      requestAnimationFrame(() => {
        sidebarInner.classList.remove("collapsible-initializing");
      });
    }, 0);
  }

  function handleCollapseToggle(event) {
    const header = event.target.closest(".collapsible-header");
    if (!header || !sidebarNav) return;

    if (sidebarInner?.classList.contains("collapsible-initializing")) return;

    const targetId = header.dataset.target;
    const content = document.getElementById(targetId);
    if (!content) return;

    const isCurrentlyExpanded = header.classList.contains("is-expanded");

    header.classList.toggle("is-expanded", !isCurrentlyExpanded);
    header.classList.toggle("is-collapsed", isCurrentlyExpanded);
    header.setAttribute("aria-expanded", String(!isCurrentlyExpanded));

    content.classList.toggle("is-expanded", !isCurrentlyExpanded);
    content.classList.toggle("is-collapsed", isCurrentlyExpanded);

    const storageKey = `sidebarCollapse_${targetId}`;
    if (isCurrentlyExpanded) {
      localStorage.setItem(storageKey, "true");
    } else {
      localStorage.removeItem(storageKey);
    }
  }

  if (sidebarNav && sidebarInner) {
    setInitialCollapseState();
    sidebarNav.addEventListener("click", handleCollapseToggle);
  }
});
