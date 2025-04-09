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

  if (contentTextArea) {
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

      const easyMDEConfig = {
        element: contentTextArea,
        spellChecker: false,
        status: ["lines", "words"],
        toolbar: customToolbar,
        renderingConfig: { codeSyntaxHighlighting: true },
        uploadImage: false,
        errorCallback: (errorMessage) => {
          console.error("EasyMDE Error:", errorMessage);
          window.showAlertModal(`Editor error: ${errorMessage}`, "Editor Error");
        },
      };

      if (entryId) {
        console.log("Initializing EasyMDE with image upload for entry:", entryId);
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
      } else {
        console.log("Initializing EasyMDE without image upload (no entryId found).");
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
          for (let i = 0; i < currentGrammarMarks.length; i++) {
            currentGrammarMarks[i].clear();
          }
          currentGrammarMarks = [];
        }
        if (grammarStatusElement) grammarStatusElement.textContent = "";
      }

      async function performGrammarCheck() {
        if (!easyMDEInstance) {
          console.warn("EasyMDE instance not available for grammar check.");
          return;
        }

        const cm = easyMDEInstance.codemirror;
        const textContent = easyMDEInstance.value();

        if (!textContent.trim()) {
          if (grammarStatusElement) grammarStatusElement.textContent = "Nothing to check.";
          return;
        }

        clearGrammarHighlights(cm);
        if (grammarStatusElement) grammarStatusElement.textContent = "Checking...";
        checkGrammarButton.disabled = true;
        checkGrammarButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Checking...`;

        const apiUrl = "https://api.languagetool.org/v2/check";
        const params = new URLSearchParams({
          text: textContent,
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
            throw new Error(`LanguageTool API error! Status: ${response.status}`);
          }

          const result = await response.json();

          if (result.matches && result.matches.length > 0) {
            for (let i = 0; i < result.matches.length; i++) {
              const match = result.matches[i];
              const fromPos = cm.posFromIndex(match.offset);
              const toPos = cm.posFromIndex(match.offset + match.length);

              const mark = cm.markText(fromPos, toPos, {
                className: "grammar-error",
                title: `${match.message} (Rule: ${match.rule.id})`,
              });
              currentGrammarMarks.push(mark);
            }
            if (grammarStatusElement) {
              grammarStatusElement.textContent = `${result.matches.length} potential issue(s) found.`;
              grammarStatusElement.style.color = "var(--warning-color)";
            }
          } else {
            if (grammarStatusElement) {
              grammarStatusElement.textContent = "No issues found.";
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
        let clearNeeded = false;
        const changeStart = cm.indexFromPos(changeObj.from);
        const changeEnd = cm.indexFromPos(changeObj.to);

        for (let i = 0; i < currentGrammarMarks.length; i++) {
          const mark = currentGrammarMarks[i];
          const markedRange = mark.find();
          if (markedRange) {
            const markStart = cm.indexFromPos(markedRange.from);
            const markEnd = cm.indexFromPos(markedRange.to);
            if (Math.max(changeStart, markStart) < Math.min(changeEnd + changeObj.text.join("").length, markEnd)) {
              clearNeeded = true;
              break;
            }
          }
        }

        if (clearNeeded) {
          clearGrammarHighlights(cm);
          if (grammarStatusElement) grammarStatusElement.textContent = "Highlights cleared due to edit.";
        }
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for content:", error);
      window.showAlertModal("Failed to load the text editor.", "Editor Error");
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
        uploadImage: false,
      });
    } catch (error) {
      console.error("Failed to initialize EasyMDE for template:", error);
      window.showAlertModal("Failed to load the template editor.", "Editor Error");
    }
  }
});
