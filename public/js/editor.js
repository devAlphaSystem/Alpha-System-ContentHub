document.addEventListener("DOMContentLoaded", () => {
  const contentTextArea = document.getElementById("content");
  const templateContentTextArea = document.getElementById("template-content");
  const headerContentTextArea = document.getElementById("header-content");
  const footerContentTextArea = document.getElementById("footer-content");
  const customCssTextArea = document.getElementById("custom-css-editor");
  const customJsTextArea = document.getElementById("custom-js-editor");

  const templateSelect = document.getElementById("template-select");
  const sharePreviewButton = document.getElementById("share-preview-btn");
  const typeSelect = document.getElementById("type");
  const urlPrefixSpan = document.getElementById("url-prefix");
  const urlInput = document.getElementById("url");
  const duplicateButton = document.getElementById("duplicate-entry-btn");
  const urlFeedback = document.getElementById("url-feedback");
  const urlInputGroup = document.getElementById("url-input-group");
  const checkGrammarButton = document.getElementById("check-grammar-btn");
  const grammarStatusElement = document.getElementById("grammar-status");
  const charCountElement = document.getElementById("content-char-count");

  let easyMDEInstance = null;
  let templateEasyMDEInstance = null;
  let headerEasyMDEInstance = null;
  let footerEasyMDEInstance = null;
  let customCssMDEInstance = null;
  let customJsMDEInstance = null;

  let searchDebounceTimer;
  let checkDebounceTimer;
  let currentCheckController = null;
  let currentGrammarMarks = [];

  const standardToolbar = [
    "bold",
    "italic",
    "heading",
    "|",
    "quote",
    "unordered-list",
    "ordered-list",
    {
      name: "insertDetails",
      action: function insertDetailsBlock(editor) {
        const cm = editor.codemirror;
        const selectedText = cm.getSelection();

        if (!selectedText) {
          const output = "<details>\n  <summary>Details</summary>\n  Content goes here...\n</details>";
          cm.replaceSelection(output);
          const cursorPos = cm.getCursor();
          cm.setCursor(cursorPos.line - 2, 11);
          cm.focus();
          return;
        }

        const output = `<details>\n  <summary>Click to expand</summary>\n  ${selectedText}\n</details>`;
        const startPos = cm.getCursor("start");
        cm.replaceSelection(output);

        cm.setCursor(startPos.line + 1, 11);
        cm.focus();
      },
      className: "fas fa-caret-square-down",
      title: "Wrap selection in Details/Summary",
    },
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
    {
      name: "insertMermaid",
      action: function insertMermaidBlock(editor) {
        const cm = editor.codemirror;
        const output = "```mermaid\ngraph TD;\n    A[Start] --> B{Decision};\n    B --> C[End];\n```";
        cm.replaceSelection(output);
        const cursorPos = cm.getCursor();
        cm.setCursor(cursorPos.line - 2, 4);
        cm.focus();
      },
      className: "fas fa-project-diagram",
      title: "Insert Mermaid Diagram Block",
    },
    "|",
    {
      name: "checkGrammar",
      action: (editor) => {
        if (checkGrammarButton && !checkGrammarButton.disabled) {
          performGrammarCheck();
        }
      },
      className: "fas fa-spell-check",
      title: "Check Grammar & Style",
    },
    "|",
    {
      name: "downloadMarkdown",
      action: function downloadMarkdown(editor) {
        const content = editor.value();
        const titleElement = document.getElementById("title");
        const title = titleElement ? titleElement.value.trim() : "untitled";
        const safeTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const filename = `${safeTitle || "download"}.md`;
        const blob = new Blob([content], {
          type: "text/markdown;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      },
      className: "fa fa-download",
      title: "Download as Markdown (.md)",
    },
  ];

  function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

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

  templateSelect?.addEventListener("change", async (event) => {
    const templateId = event.target.value;
    const currentProjectId = document.body.dataset.projectId;

    const applyTemplate = async () => {
      if (!currentProjectId) {
        console.error("Cannot apply template: Project ID is missing.");
        window.showAlertModal("Cannot apply template: Project context is missing.", "Template Error");
        return;
      }
      try {
        const response = await fetch(`/api/projects/${currentProjectId}/templates/${templateId}`);
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

  async function generatePreviewLink(button, password = null) {
    const currentEntryId = button.dataset.entryId;
    const currentProjectId = button.dataset.projectId;

    if (!currentEntryId || !currentProjectId) {
      window.showAlertModal("Cannot generate preview link: Button is missing required IDs.", "Error");
      console.error("Missing IDs on share button:", {
        entry: currentEntryId,
        project: currentProjectId,
      });
      return;
    }

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating...`;

    const requestBody = {};
    if (password) {
      requestBody.password = password;
    }

    try {
      const response = await fetch(`/api/projects/${currentProjectId}/entries/${currentEntryId}/generate-preview`, {
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
      button.disabled = false;
      button.innerHTML = `<i class="fas fa-share-alt"></i> Share Preview`;
    }
  }

  sharePreviewButton?.addEventListener("click", async (event) => {
    const button = event.currentTarget;

    window.showConfirmModal({
      title: "Require Password?",
      message: "Do you want to set a password for this preview link?",
      confirmText: "Yes, Set Password",
      neutralText: "No Password",
      cancelText: "Cancel",
      onConfirm: () => {
        window.showPasswordPromptModal({
          title: "Enter Preview Password",
          message: "Please enter the password for the preview link:",
          confirmText: "Generate Link",
          onConfirm: (password) => {
            generatePreviewLink(button, password);
          },
          onCancel: () => {
            console.log("Password entry cancelled.");
          },
        });
      },
      onNeutral: () => {
        generatePreviewLink(button, null);
      },
      onCancel: () => {
        console.log("Preview generation cancelled.");
      },
    });
  });

  urlPrefixSpan?.addEventListener("click", () => {
    const baseUrlPart = urlPrefixSpan.textContent;
    const entryIdPart = urlInput?.value;
    if (entryIdPart) {
      const fullUrl = baseUrlPart + entryIdPart;
      copyToClipboard(fullUrl, urlPrefixSpan);
    } else {
      console.warn("No entry ID found in the URL input to copy.");
      const originalHtml = urlPrefixSpan.innerHTML;
      urlPrefixSpan.innerHTML = "No ID!";
      setTimeout(() => {
        urlPrefixSpan.innerHTML = originalHtml;
      }, 1500);
    }
  });

  async function handleDuplicateEntry(button) {
    const entryId = button.dataset.entryId;
    const projectId = button.dataset.projectId;

    if (!entryId || !projectId) {
      window.showAlertModal("Cannot duplicate: Button is missing required IDs.", "Error");
      console.error("Missing IDs on duplicate button:", {
        entry: entryId,
        project: projectId,
      });
      return;
    }

    const titleInput = document.getElementById("title");
    const typeSelect = document.getElementById("type");
    const statusSelect = document.getElementById("status");
    const tagsInput = document.getElementById("tags");
    const collectionInput = document.getElementById("collection");
    const docHeaderSelect = document.getElementById("custom_documentation_header");
    const docFooterSelect = document.getElementById("custom_documentation_footer");
    const clHeaderSelect = document.getElementById("custom_changelog_header");
    const clFooterSelect = document.getElementById("custom_changelog_footer");
    const sidebarSelect = document.getElementById("show_in_project_sidebar");
    const roadmapStageSelect = document.getElementById("roadmap_stage");

    const currentContent = easyMDEInstance ? easyMDEInstance.value() : "";
    const currentTitle = titleInput?.value || "";
    const currentType = typeSelect?.value || "documentation";
    const currentStatus = statusSelect?.disabled ? document.querySelector('input[name="status"][type="hidden"]')?.value || "published" : statusSelect?.value || "draft";
    const currentCollection = collectionInput?.disabled ? document.querySelector('input[name="collection"][type="hidden"]')?.value || "" : collectionInput?.value || "";

    const payload = {
      title: currentTitle,
      type: currentType,
      content: currentContent,
      tags: tagsInput?.value || "",
      collection: currentCollection,
      custom_documentation_header: docHeaderSelect?.value || null,
      custom_documentation_footer: docFooterSelect?.value || null,
      custom_changelog_header: clHeaderSelect?.value || null,
      custom_changelog_footer: clFooterSelect?.value || null,
      show_in_project_sidebar: sidebarSelect?.value === "true",
      roadmap_stage: roadmapStageSelect?.value || null,
    };

    window.showConfirmModal({
      title: "Confirm Duplication",
      message: `Create a new draft entry as a copy of the current state of "<strong>${escapeHtml(currentTitle)}</strong>"?`,
      confirmText: "Duplicate as Draft",
      action: "duplicate",
      onConfirm: async () => {
        button.disabled = true;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Duplicating...`;

        try {
          const response = await fetch(`/api/projects/${projectId}/entries/${entryId}/duplicate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
          }

          if (result.newEntryId) {
            window.location.href = `/projects/${projectId}/edit/${result.newEntryId}?duplicated=true`;
          } else {
            throw new Error("API did not return the new entry ID.");
          }
        } catch (error) {
          console.error("Failed to duplicate entry:", error);
          window.showAlertModal(`Could not duplicate entry: ${error.message}`, "Error");
          button.disabled = false;
          button.innerHTML = `<i class="fas fa-copy"></i> Duplicate Entry`;
        }
      },
      onCancel: () => {
        console.log("Duplication cancelled.");
      },
    });
  }

  duplicateButton?.addEventListener("click", () => {
    handleDuplicateEntry(duplicateButton);
  });

  const currentProjectIdForCheck = document.body.dataset.projectId;

  function setUrlFeedback(message, type) {
    if (!urlFeedback || !urlInputGroup) return;

    urlFeedback.textContent = message || "";
    urlFeedback.className = "form-text url-feedback-message";
    urlInputGroup.classList.remove("is-valid", "is-invalid");

    if (type === "success") {
      urlFeedback.classList.add("text-success");
      urlInputGroup.classList.add("is-valid");
    } else if (type === "error") {
      urlFeedback.classList.add("text-danger");
      urlInputGroup.classList.add("is-invalid");
    } else if (type === "checking") {
      urlFeedback.classList.add("text-muted");
    }
  }

  async function checkUrlAvailability() {
    if (!urlInput || !currentProjectIdForCheck) return;

    const entryId = urlInput.value.trim();

    if (currentCheckController) {
      currentCheckController.abort();
    }

    if (entryId === "") {
      setUrlFeedback("", null);
      return;
    }

    if (entryId.length !== 15) {
      setUrlFeedback("ID must be exactly 15 characters.", "error");
      return;
    }

    setUrlFeedback("Checking availability...", "checking");
    urlInput.disabled = true;

    currentCheckController = new AbortController();
    const signal = currentCheckController.signal;

    try {
      const response = await fetch(`/api/projects/${currentProjectIdForCheck}/check-entry-id/${entryId}`, {
        signal,
      });

      if (signal.aborted) {
        console.log("ID check aborted for:", entryId);
        return;
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();
        console.error("Non-JSON response received:", response.status, textResponse);
        throw new Error(`Server returned non-JSON response (Status: ${response.status})`);
      }

      const result = await response.json();

      if (response.ok) {
        if (result.available) {
          setUrlFeedback("ID is available!", "success");
        } else {
          setUrlFeedback(result.reason || "ID is not available.", "error");
        }
      } else {
        setUrlFeedback(result.reason || result.error || `Error: ${response.statusText}`, "error");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("Fetch aborted for ID check:", entryId);
      } else {
        console.error("Error checking ID availability:", error);
        setUrlFeedback(error.message || "Error checking availability. Try again.", "error");
      }
    } finally {
      urlInput.disabled = false;
      currentCheckController = null;
    }
  }

  urlInput?.addEventListener("input", () => {
    clearTimeout(checkDebounceTimer);
    const entryId = urlInput.value.trim();

    if (entryId !== "" && entryId.length !== 15) {
      setUrlFeedback("ID must be exactly 15 characters.", "error");
    } else if (entryId === "") {
      setUrlFeedback("", null);
    } else {
      setUrlFeedback("...", "checking");
      checkDebounceTimer = setTimeout(checkUrlAvailability, 500);
    }
  });

  const updateCharCount = () => {
    if (!easyMDEInstance || !charCountElement) return;
    const characterLimit = 150000;
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

  function clearGrammarHighlights(cm) {
    if (currentGrammarMarks && cm) {
      for (const mark of currentGrammarMarks) {
        mark.clear();
      }
      currentGrammarMarks = [];
    }
    if (grammarStatusElement) {
      grammarStatusElement.textContent = "";
      grammarStatusElement.style.color = "";
      grammarStatusElement.style.marginLeft = "0";
    }
  }

  async function performGrammarCheck() {
    if (!easyMDEInstance) {
      console.warn("EasyMDE instance not available for grammar check.");
      return;
    }

    const cm = easyMDEInstance.codemirror;
    const selectedText = cm.getSelection();
    let textToCheck = "";
    let checkScope = "document";
    let selectionOffset = 0;

    if (selectedText && selectedText.trim() !== "") {
      textToCheck = selectedText;
      checkScope = "selection";
      selectionOffset = cm.indexFromPos(cm.getCursor("start"));
    } else {
      textToCheck = easyMDEInstance.value();
      checkScope = "document";
      selectionOffset = 0;
    }

    if (!textToCheck.trim()) {
      if (grammarStatusElement) {
        grammarStatusElement.textContent = "Nothing to check.";
        grammarStatusElement.style.marginLeft = "10px";
      }
      return;
    }

    clearGrammarHighlights(cm);

    if (grammarStatusElement) {
      grammarStatusElement.textContent = `Checking ${checkScope}...`;
      grammarStatusElement.style.marginLeft = "10px";
    }

    if (checkGrammarButton) {
      checkGrammarButton.disabled = true;
      checkGrammarButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Checking...`;
    }

    const apiUrl = "https://api.languagetool.org/v2/check";
    const params = new URLSearchParams({
      text: textToCheck,
      language: "en-US",
    });

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        let errorDetail = `Status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorDetail = errorData.message || errorDetail;
        } catch (_) {}
        throw new Error(`LanguageTool API error! ${errorDetail}`);
      }

      const result = await response.json();

      if (result.matches && result.matches.length > 0) {
        for (const match of result.matches) {
          const actualFromIndex = match.offset + selectionOffset;
          const actualToIndex = match.offset + match.length + selectionOffset;
          const fromPos = cm.posFromIndex(actualFromIndex);
          const toPos = cm.posFromIndex(actualToIndex);

          const mark = cm.markText(fromPos, toPos, {
            className: "grammar-error",
            title: `${match.message} (Rule: ${match.rule.id})`,
          });
          currentGrammarMarks.push(mark);
        }

        if (grammarStatusElement) {
          grammarStatusElement.textContent = `${result.matches.length} potential issue(s) found in ${checkScope}.`;
          grammarStatusElement.style.color = "var(--warning-color)";
          grammarStatusElement.style.marginLeft = "10px";
        }
      } else {
        if (grammarStatusElement) {
          grammarStatusElement.textContent = `No issues found in ${checkScope}.`;
          grammarStatusElement.style.color = "var(--success-color)";
          grammarStatusElement.style.marginLeft = "10px";
        }
      }
    } catch (error) {
      console.error("Error checking grammar:", error);
      if (grammarStatusElement) {
        grammarStatusElement.textContent = "Error checking grammar.";
        grammarStatusElement.style.color = "var(--danger-color)";
        grammarStatusElement.style.marginLeft = "10px";
      }
      window.showAlertModal(`Could not check grammar: ${error.message}`, "Grammar Check Error");
    } finally {
      if (checkGrammarButton) {
        checkGrammarButton.disabled = false;
        checkGrammarButton.innerHTML = `<i class="fas fa-spell-check"></i> Check Grammar & Style`;
      }
    }
  }

  if (contentTextArea) {
    try {
      const easyMDEConfig = {
        element: contentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: standardToolbar,
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
        errorCallback: (errorMessage) => {
          console.error("EasyMDE Error:", errorMessage);
          window.showAlertModal(`Editor error: ${errorMessage}`, "Editor Error");
        },
      };

      const configEntryId = contentTextArea?.dataset.entryId;
      const configProjectId = document.body.dataset.projectId;

      if (configEntryId && configProjectId) {
        easyMDEConfig.uploadImage = true;
        easyMDEConfig.imageUploadEndpoint = `/api/projects/${configProjectId}/entries/${configEntryId}/upload-image`;
        easyMDEConfig.imagePathAbsolute = true;
        easyMDEConfig.imageAccept = "image/png, image/jpeg, image/gif, image/webp";
        easyMDEConfig.imageMaxSize = 1024 * 1024 * 10;
        easyMDEConfig.imageCSRFToken = false;
        easyMDEConfig.imageTexts = {
          sbInit: "Attach files by dragging & dropping or selecting them.",
          sbOnDragEnter: "Drop image to upload it.",
          sbOnDrop: "Uploading image...",
          sbProgress: "Uploading (##) %...",
          sbOnUploaded: "Uploaded!",
          sizeUnits: " B, KB, MB",
        };
        easyMDEConfig.imageUploadFunction = (file, onSuccess, onError) => {
          const formData = new FormData();
          formData.append("image", file);

          fetch(`/api/projects/${configProjectId}/entries/${configEntryId}/upload-image`, {
            method: "POST",
            body: formData,
          })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({
                  error: `HTTP error ${response.status}`,
                }));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
              }
              return response.json();
            })
            .then((result) => {
              if (result.data?.filePath && result.data.filePath.trim() !== "") {
                onSuccess(result.data.filePath);
              } else {
                console.error("Image Upload Succeeded but API returned invalid/empty filePath:", result.data);
                throw new Error("Server processed upload but did not return a valid file path.");
              }
            })
            .catch((error) => {
              console.error("Image Upload Failed:", error);
              onError(error.message || "Image upload failed. Check console for details.");
            });
        };
      } else {
        console.warn("Image upload disabled: Entry ID or Project ID missing at editor init.");
      }

      easyMDEInstance = new EasyMDE(easyMDEConfig);

      updateCharCount();
      easyMDEInstance.codemirror.on("change", (cm, changeObj) => {
        if (currentGrammarMarks.length > 0) {
          clearGrammarHighlights(cm);
          if (grammarStatusElement) {
            grammarStatusElement.textContent = "Highlights cleared due to edit.";
            grammarStatusElement.style.marginLeft = "10px";
          }
        }
        updateCharCount();
      });

      easyMDEInstance.codemirror.on("keydown", (cm, event) => {
        const isGKey = event.key.toLowerCase() === "g";
        const isModifierPressed = event.ctrlKey || event.metaKey;
        const isShiftPressed = event.shiftKey;

        if (isGKey && isModifierPressed && isShiftPressed) {
          event.preventDefault();
          if (checkGrammarButton && !checkGrammarButton.disabled) {
            checkGrammarButton.click();
          }
        }
      });

      checkGrammarButton?.addEventListener("click", performGrammarCheck);
    } catch (error) {
      console.error("Failed to initialize EasyMDE for content:", error);
      window.showAlertModal("Failed to load the text editor.", "Editor Error");
    }
  }

  if (templateContentTextArea) {
    try {
      templateEasyMDEInstance = new EasyMDE({
        element: templateContentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: standardToolbar,
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for template:", error);
      window.showAlertModal("Failed to load the template editor.", "Editor Error");
    }
  }

  if (headerContentTextArea) {
    try {
      headerEasyMDEInstance = new EasyMDE({
        element: headerContentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: false,
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
        mode: "htmlmixed",
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for header:", error);
      window.showAlertModal("Failed to load the header editor.", "Editor Error");
    }
  }

  if (footerContentTextArea) {
    try {
      footerEasyMDEInstance = new EasyMDE({
        element: footerContentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: false,
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
        mode: "htmlmixed",
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for footer:", error);
      window.showAlertModal("Failed to load the footer editor.", "Editor Error");
    }
  }

  if (customCssTextArea) {
    try {
      customCssMDEInstance = new EasyMDE({
        element: customCssTextArea,
        spellChecker: false,
        toolbar: false,
        status: ["lines", "words"],
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
        mode: "css",
        indentUnit: 2,
        tabSize: 2,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for Custom CSS:", error);
      window.showAlertModal("Failed to load the Custom CSS editor.", "Editor Error");
    }
  }

  if (customJsTextArea) {
    try {
      customJsMDEInstance = new EasyMDE({
        element: customJsTextArea,
        spellChecker: false,
        toolbar: false,
        status: ["lines", "words"],
        renderingConfig: {
          codeSyntaxHighlighting: true,
        },
        uploadImage: false,
        mode: "javascript",
        indentUnit: 2,
        tabSize: 2,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for Custom JS:", error);
      window.showAlertModal("Failed to load the Custom JS editor.", "Editor Error");
    }
  }

  function toggleTypeSpecificFields(selectedType) {
    const docHeaderGroup = document.getElementById("documentation-header-group");
    const docFooterGroup = document.getElementById("documentation-footer-group");
    const clHeaderGroup = document.getElementById("changelog-header-group");
    const clFooterGroup = document.getElementById("changelog-footer-group");
    const roadmapStageGroup = document.getElementById("roadmap-stage-group");
    const contentGroup = document.querySelector(".form-group-content");
    const contentLabel = contentGroup?.querySelector("label[for='content']");
    const tagsGroup = document.getElementById("tags")?.closest(".form-group");
    const sidebarGroup = document.getElementById("show_in_project_sidebar")?.closest(".form-group");

    if (docHeaderGroup) docHeaderGroup.style.display = "none";
    if (docFooterGroup) docFooterGroup.style.display = "none";
    if (clHeaderGroup) clHeaderGroup.style.display = "none";
    if (clFooterGroup) clFooterGroup.style.display = "none";
    if (roadmapStageGroup) roadmapStageGroup.style.display = "none";
    if (tagsGroup) tagsGroup.style.display = "none";
    if (sidebarGroup) sidebarGroup.style.display = "none";

    if (contentGroup) contentGroup.style.display = "block";
    if (contentLabel) contentLabel.innerHTML = 'Content (Markdown) <span class="required">*</span>';

    if (selectedType === "documentation") {
      if (docHeaderGroup) docHeaderGroup.style.display = "block";
      if (docFooterGroup) docFooterGroup.style.display = "block";
      if (tagsGroup) tagsGroup.style.display = "block";
      if (sidebarGroup) sidebarGroup.style.display = "block";
    } else if (selectedType === "changelog") {
      if (clHeaderGroup) clHeaderGroup.style.display = "block";
      if (clFooterGroup) clFooterGroup.style.display = "block";
      if (tagsGroup) tagsGroup.style.display = "block";
      if (sidebarGroup) sidebarGroup.style.display = "block";
    } else if (selectedType === "roadmap") {
      if (roadmapStageGroup) roadmapStageGroup.style.display = "block";
      if (contentGroup) contentGroup.style.display = "block";
      if (contentLabel) contentLabel.innerHTML = "Description (Markdown - Optional)";
      if (tagsGroup) tagsGroup.style.display = "none";
    } else if (selectedType === "knowledge_base") {
      if (contentGroup) contentGroup.style.display = "block";
      if (contentLabel) contentLabel.innerHTML = 'Answer (Markdown) <span class="required">*</span>';
      if (tagsGroup) tagsGroup.style.display = "none";
    } else if (selectedType === "sidebar_header") {
      if (contentGroup) contentGroup.style.display = "none";
      if (sidebarGroup) sidebarGroup.style.display = "block";
    }
  }

  if (typeSelect) {
    typeSelect.addEventListener("change", (event) => {
      toggleTypeSpecificFields(event.target.value);
    });
    toggleTypeSpecificFields(typeSelect.value);
  }
});
