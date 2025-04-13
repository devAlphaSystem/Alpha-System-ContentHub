document.addEventListener("DOMContentLoaded", () => {
  const contentTextArea = document.getElementById("content");
  const templateContentTextArea = document.getElementById("template-content");
  const headerContentTextArea = document.getElementById("header-content");
  const footerContentTextArea = document.getElementById("footer-content");
  const templateSelect = document.getElementById("template-select");
  const sharePreviewButton = document.getElementById("share-preview-btn");
  const entryId = contentTextArea?.dataset.entryId;

  const passwordCheckbox = document.getElementById("set-preview-password-check");
  const passwordInput = document.getElementById("preview-password-input");

  const urlPrefixSpan = document.getElementById("url-prefix");
  const urlInput = document.getElementById("url");

  let easyMDEInstance = null;
  let templateEasyMDEInstance = null;
  let headerEasyMDEInstance = null;
  let footerEasyMDEInstance = null;
  let searchDebounceTimer;

  const standardToolbar = [
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
  ];

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
      const activeForm = document.querySelector("form.entry-form, form.template-form, form.header-form, form.footer-form");
      const confirmModalVisible = document.getElementById("confirm-modal")?.classList.contains("is-visible");
      const alertModalVisible = document.getElementById("alert-modal")?.classList.contains("is-visible");

      if (activeForm && !confirmModalVisible && !alertModalVisible) {
        event.preventDefault();
        const submitButton = activeForm.querySelector('button[type="submit"]');
        if (submitButton) {
          submitButton.click();
        } else {
          activeForm.submit();
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

  if (contentTextArea) {
    try {
      const easyMDEConfig = {
        element: contentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: standardToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
        uploadImage: false,
        errorCallback: (errorMessage) => {
          console.error("EasyMDE Error:", errorMessage);
          window.showAlertModal(`Editor error: ${errorMessage}`, "Editor Error");
        },
      };

      if (entryId) {
        easyMDEConfig.uploadImage = true;
        easyMDEConfig.imageUploadEndpoint = `/api/entries/${entryId}/upload-image`;
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

          fetch(`/api/entries/${entryId}/upload-image`, {
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
        };
      }

      easyMDEInstance = new EasyMDE(easyMDEConfig);

      const charCountElement = document.getElementById("content-char-count");
      const characterLimit = 150000;
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

      const checkGrammarButton = document.getElementById("check-grammar-btn");
      const grammarStatusElement = document.getElementById("grammar-status");
      let currentGrammarMarks = [];

      function clearGrammarHighlights(cm) {
        if (currentGrammarMarks && cm) {
          currentGrammarMarks.forEach((mark) => mark.clear());
          currentGrammarMarks = [];
        }
        if (grammarStatusElement) {
          grammarStatusElement.textContent = "";
          grammarStatusElement.style.color = "";
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
          if (grammarStatusElement) grammarStatusElement.textContent = "Nothing to check.";
          return;
        }

        clearGrammarHighlights(cm);

        if (grammarStatusElement) grammarStatusElement.textContent = `Checking ${checkScope}...`;
        checkGrammarButton.disabled = true;
        checkGrammarButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Checking...`;

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
            result.matches.forEach((match) => {
              const actualFromIndex = match.offset + selectionOffset;
              const actualToIndex = match.offset + match.length + selectionOffset;
              const fromPos = cm.posFromIndex(actualFromIndex);
              const toPos = cm.posFromIndex(actualToIndex);

              const mark = cm.markText(fromPos, toPos, {
                className: "grammar-error",
                title: `${match.message} (Rule: ${match.rule.id})`,
              });
              currentGrammarMarks.push(mark);
            });

            if (grammarStatusElement) {
              grammarStatusElement.textContent = `${result.matches.length} potential issue(s) found in ${checkScope}.`;
              grammarStatusElement.style.color = "var(--warning-color)";
            }
          } else {
            if (grammarStatusElement) {
              grammarStatusElement.textContent = `No issues found in ${checkScope}.`;
              grammarStatusElement.style.color = "var(--success-color)";
            }
          }
        } catch (error) {
          console.error("Error checking grammar:", error);
          if (grammarStatusElement) {
            grammarStatusElement.textContent = "Error checking grammar.";
            grammarStatusElement.style.color = "var(--danger-color)";
          }
          window.showAlertModal(`Could not check grammar: ${error.message}`, "Grammar Check Error");
        } finally {
          checkGrammarButton.disabled = false;
          checkGrammarButton.innerHTML = `<i class="fas fa-spell-check"></i> Check Grammar & Style`;
        }
      }

      checkGrammarButton?.addEventListener("click", performGrammarCheck);

      easyMDEInstance.codemirror.on("change", (cm, changeObj) => {
        if (currentGrammarMarks.length > 0) {
          clearGrammarHighlights(cm);
          if (grammarStatusElement) grammarStatusElement.textContent = "Highlights cleared due to edit.";
        }
        updateCharCount();
      });
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
        renderingConfig: { codeSyntaxHighlighting: true },
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
        toolbar: standardToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
        uploadImage: false,
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
        toolbar: standardToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
        uploadImage: false,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for footer:", error);
      window.showAlertModal("Failed to load the footer editor.", "Editor Error");
    }
  }
});
