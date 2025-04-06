document.addEventListener("DOMContentLoaded", () => {
  const contentTextArea = document.getElementById("content");
  const templateContentTextArea = document.getElementById("template-content");
  const templateSelect = document.getElementById("template-select");
  const sharePreviewButton = document.getElementById("share-preview-btn");
  const entryId = contentTextArea?.dataset.entryId;

  const passwordCheckbox = document.getElementById("set-preview-password-check");
  const passwordInput = document.getElementById("preview-password-input");

  let easyMDEInstance = null;
  let templateEasyMDEInstance = null;

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
        window.showAlertModal("Could not copy link to clipboard.", "Copy Error");
      });
  }

  document.addEventListener("keydown", (event) => {
    const isSKey = event.key.toLowerCase() === "s";
    const isModifierPressed = event.ctrlKey || event.metaKey;
    if (isSKey && isModifierPressed) {
      const entryForm = document.querySelector("form.entry-form, form.template-form");
      const confirmModalVisible = document.getElementById("confirm-modal")?.classList.contains("is-visible");
      const alertModalVisible = document.getElementById("alert-modal")?.classList.contains("is-visible");

      if (entryForm && !confirmModalVisible && !alertModalVisible) {
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
        window.showAlertModal("Could not load the selected template.", "Template Error");
      }
    };

    if (!templateId) {
      if (easyMDEInstance) easyMDEInstance.value("");
      else if (contentTextArea) contentTextArea.value = "";
      return;
    }

    const currentContent = easyMDEInstance ? easyMDEInstance.value() : contentTextArea?.value || "";
    if (currentContent.trim() !== "") {
      window.showConfirmModal({
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
      window.showAlertModal("Cannot generate preview link: Entry ID is missing.", "Error");
      return;
    }

    let passwordToSend = null;
    if (passwordCheckbox?.checked) {
      passwordToSend = passwordInput?.value;
      if (!passwordToSend || passwordToSend.trim() === "") {
        window.showAlertModal("Please enter a password or uncheck the 'Require Password' box.", "Password Missing");
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
      window.showAlertModal(modalContent, "Preview Link Generated");

      const copyBtn = document.getElementById("copy-preview-link-btn");
      copyBtn?.addEventListener("click", () => {
        copyToClipboard(result.previewUrl, copyBtn);
      });
    } catch (error) {
      console.error("Failed to generate preview link:", error);
      window.showAlertModal(`Could not generate preview link: ${error.message}`, "Error");
    } finally {
      sharePreviewButton.disabled = false;
      sharePreviewButton.innerHTML = `<i class="fas fa-share-alt"></i> Share Preview`;
    }
  });

  if (contentTextArea && entryId) {
    try {
      const customToolbar = [
        "bold",
        "italic",
        "heading",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "image",
        "code",
        "table",
        "|",
        {
          name: "navButtons",
          action: function customFunction(editor) {
            const cm = editor.codemirror;
            const output = "```nav-buttons\nprev: [Previous Text](/previous-url)\nnext: [Next Text](/next-url)\n```";
            cm.replaceSelection(output);
            const cursorPos = cm.getCursor();
            cm.setCursor(cursorPos.line - 2, 7);
            cm.focus();
          },
          className: "fa fa-arrows-alt-h",
          title: "Insert Previous/Next Buttons Block",
        },
      ];

      easyMDEInstance = new EasyMDE({
        element: contentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: customToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
        uploadImage: true,
        imageUploadEndpoint: `/api/entries/${entryId}/upload-image`,
        imagePathAbsolute: true,
        imageAccept: "image/png, image/jpeg, image/gif, image/webp",
        imageMaxSize: 1024 * 1024 * 10,
        imageCSRFToken: false,
        imageTexts: {
          sbInit: "Attach files by dragging & dropping or selecting them.",
          sbOnDragEnter: "Drop image to upload it.",
          sbOnDrop: "Uploading image...",
          sbProgress: "Uploading (##) %...",
          sbOnUploaded: "Uploaded!",
          sizeUnits: " B, KB, MB",
        },
        errorCallback: (errorMessage) => {
          console.error("EasyMDE Error:", errorMessage);
          window.showAlertModal(`Editor error: ${errorMessage}`, "Editor Error");
        },
        imageUploadFunction: (file, onSuccess, onError) => {
          const formData = new FormData();
          formData.append("image", file);

          fetch(`/api/entries/${entryId}/upload-image`, {
            method: "POST",
            body: formData,
          })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP error ${response.status}` }));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
              }
              return response.json();
            })
            .then((result) => {
              if (result.data?.filePath) {
                onSuccess(result.data.filePath);
              } else {
                throw new Error("Invalid response format from server.");
              }
            })
            .catch((error) => {
              console.error("Image Upload Failed:", error);
              onError(error.message || "Image upload failed. Check console for details.");
            });
        },
      });

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
      window.showAlertModal("Failed to load the text editor.", "Editor Error");
    }
  } else if (contentTextArea) {
    console.warn("EasyMDE not fully initialized for content: Missing entryId.");
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
        uploadImage: false,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for template:", error);
      window.showAlertModal("Failed to load the template editor.", "Editor Error");
    }
  }
});
