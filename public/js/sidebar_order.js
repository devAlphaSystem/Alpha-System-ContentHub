document.addEventListener("DOMContentLoaded", () => {
  const sortableList = document.getElementById("sortable-entries");
  const saveButton = document.getElementById("save-order-btn");
  const addHeaderButton = document.getElementById("add-header-btn");
  const addHeaderModal = document.getElementById("add-header-modal");
  const addHeaderCloseBtn = document.getElementById("add-header-modal-close-btn");
  const addHeaderCancelBtn = document.getElementById("add-header-modal-cancel-btn");
  const addHeaderConfirmBtn = document.getElementById("add-header-modal-confirm-btn");
  const headerTitleInput = document.getElementById("header-title-input");
  const headerTitleError = document.getElementById("header-title-error");

  const editHeaderModal = document.getElementById("edit-header-modal");
  const editHeaderCloseBtn = document.getElementById("edit-header-modal-close-btn");
  const editHeaderCancelBtn = document.getElementById("edit-header-modal-cancel-btn");
  const editHeaderConfirmBtn = document.getElementById("edit-header-modal-confirm-btn");
  const editHeaderTitleInput = document.getElementById("edit-header-title-input");
  const editHeaderTitleError = document.getElementById("edit-header-title-error");

  const projectId = document.body.dataset.projectId;
  let sortableInstance = null;

  if (sortableList) {
    if (typeof Sortable !== "undefined") {
      sortableInstance = new Sortable(sortableList, {
        animation: 150,
        ghostClass: "sortable-ghost",
        chosenClass: "sortable-chosen",
        handle: ".handle",
      });
    } else {
      console.error("SortableJS library not found. Drag and drop will not work.");
      if (saveButton) saveButton.disabled = true;
    }
  }

  function showAddHeaderModal() {
    if (addHeaderModal && headerTitleInput && headerTitleError) {
      headerTitleInput.value = "";
      headerTitleError.style.display = "none";
      addHeaderModal.classList.add("is-visible");
      addHeaderModal.setAttribute("aria-hidden", "false");
      setTimeout(() => headerTitleInput.focus(), 100);
    }
  }

  function hideAddHeaderModal() {
    if (addHeaderModal) {
      addHeaderModal.classList.remove("is-visible");
      addHeaderModal.setAttribute("aria-hidden", "true");
    }
  }

  function showEditHeaderModal(headerId, currentTitle) {
    if (editHeaderModal && editHeaderTitleInput && editHeaderTitleError) {
      editHeaderTitleInput.value = currentTitle;
      editHeaderConfirmBtn.dataset.headerId = headerId;
      editHeaderTitleError.style.display = "none";
      editHeaderModal.classList.add("is-visible");
      editHeaderModal.setAttribute("aria-hidden", "false");
      setTimeout(() => editHeaderTitleInput.focus(), 100);
    }
  }

  function hideEditHeaderModal() {
    if (editHeaderModal) {
      editHeaderModal.classList.remove("is-visible");
      editHeaderModal.setAttribute("aria-hidden", "true");
      editHeaderConfirmBtn.dataset.headerId = "";
      editHeaderTitleInput.value = "";
    }
  }

  addHeaderButton?.addEventListener("click", showAddHeaderModal);
  addHeaderCloseBtn?.addEventListener("click", hideAddHeaderModal);
  addHeaderCancelBtn?.addEventListener("click", hideAddHeaderModal);
  addHeaderModal?.addEventListener("click", (event) => {
    if (event.target === addHeaderModal) {
      hideAddHeaderModal();
    }
  });

  editHeaderCloseBtn?.addEventListener("click", hideEditHeaderModal);
  editHeaderCancelBtn?.addEventListener("click", hideEditHeaderModal);
  editHeaderModal?.addEventListener("click", (event) => {
    if (event.target === editHeaderModal) {
      hideEditHeaderModal();
    }
  });

  addHeaderConfirmBtn?.addEventListener("click", async () => {
    if (!headerTitleInput || !headerTitleError || !projectId) return;

    const title = headerTitleInput.value.trim();
    if (!title) {
      headerTitleError.style.display = "block";
      headerTitleInput.focus();
      return;
    }
    headerTitleError.style.display = "none";

    addHeaderConfirmBtn.disabled = true;
    addHeaderConfirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Adding...`;

    try {
      const response = await fetch(`/api/projects/${projectId}/sidebar-headers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ title }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Server error ${response.status}`);
      }

      hideAddHeaderModal();
      window.showAlertModal("Sidebar header added successfully!", "Success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error("Failed to add sidebar header:", error);
      window.showAlertModal(`Error adding header: ${error.message}`, "Error");
    } finally {
      addHeaderConfirmBtn.disabled = false;
      addHeaderConfirmBtn.innerHTML = "Add Header";
    }
  });

  editHeaderConfirmBtn?.addEventListener("click", async () => {
    if (!editHeaderTitleInput || !editHeaderTitleError || !projectId) return;

    const headerId = editHeaderConfirmBtn.dataset.headerId;
    const newTitle = editHeaderTitleInput.value.trim();

    if (!headerId) {
      console.error("Header ID missing from edit modal confirm button.");
      window.showAlertModal("Error saving changes: Header ID missing.", "Error");
      return;
    }

    if (!newTitle) {
      editHeaderTitleError.style.display = "block";
      editHeaderTitleInput.focus();
      return;
    }
    editHeaderTitleError.style.display = "none";

    editHeaderConfirmBtn.disabled = true;
    editHeaderConfirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

    try {
      const response = await fetch(`/api/projects/${projectId}/sidebar-headers/${headerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ title: newTitle }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Server error ${response.status}`);
      }

      const listItem = sortableList?.querySelector(`li[data-id="${headerId}"]`);
      const titleSpan = listItem?.querySelector(".item-title");
      if (titleSpan) {
        titleSpan.textContent = newTitle;
      }
      const editButton = listItem?.querySelector(".edit-header-btn");
      if (editButton) {
        editButton.dataset.currentTitle = newTitle;
      }

      hideEditHeaderModal();
      window.showAlertModal("Sidebar header updated successfully!", "Success");
    } catch (error) {
      console.error("Failed to update sidebar header:", error);
      window.showAlertModal(`Error updating header: ${error.message}`, "Error");
    } finally {
      editHeaderConfirmBtn.disabled = false;
      editHeaderConfirmBtn.innerHTML = "Save Changes";
    }
  });

  saveButton?.addEventListener("click", async () => {
    if (!sortableInstance || !projectId) {
      console.error("Cannot save order: Sortable instance or Project ID missing.");
      window.showAlertModal("Error saving order. Please refresh.", "Save Error");
      return;
    }

    const orderedIds = sortableInstance.toArray();

    saveButton.disabled = true;
    saveButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

    try {
      const response = await fetch(`/projects/${projectId}/sidebar-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          entryOrder: orderedIds,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("Error response from server:", result);
        throw new Error(result.error || `Server error ${response.status}`);
      }

      window.showAlertModal("Sidebar order saved successfully!", "Success");
    } catch (error) {
      console.error("Failed to save sidebar order:", error);
      window.showAlertModal(`Error saving order: ${error.message}`, "Save Error");
    } finally {
      saveButton.disabled = false;
      saveButton.innerHTML = `<i class="fas fa-save"></i> Save Order`;
    }
  });

  sortableList?.addEventListener("click", (event) => {
    const editButton = event.target.closest(".edit-header-btn");
    if (editButton) {
      const headerId = editButton.dataset.headerId;
      const currentTitle = editButton.dataset.currentTitle;
      showEditHeaderModal(headerId, currentTitle);
    }
  });

  sortableList?.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.classList.contains("delete-sidebar-header-form")) {
      event.preventDefault();
      const listItem = form.closest("li");
      const headerName = listItem?.querySelector(".item-title")?.textContent || "this header";
      window.showConfirmModal({
        form: form,
        title: "Confirm Deletion",
        message: `Are you sure you want to delete the sidebar header "<strong>${escapeHtml(headerName)}</strong>"? This action cannot be undone.`,
        action: "delete",
        confirmText: "Delete Header",
      });
    }
  });

  function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
});
