document.addEventListener("DOMContentLoaded", () => {
  const sortableList = document.getElementById("sortable-entries");
  const saveButton = document.getElementById("save-order-btn");
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
        body: JSON.stringify({ entryOrder: orderedIds }),
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
});
