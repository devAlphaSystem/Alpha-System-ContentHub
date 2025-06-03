document.addEventListener("DOMContentLoaded", () => {
  hljs.highlightAll();

  function initializeMermaid(theme) {
    try {
      const mermaidTheme = theme === "dark" ? "dark" : "neutral";
      mermaid.initialize({
        startOnLoad: false,
        theme: mermaidTheme,
        themeVariables: {
          darkMode: theme === "dark",
          background: theme === "dark" ? "#1f1f1f" : "#ffffff",
        },
      });
      mermaid.run({
        querySelector: ".language-mermaid",
      });
      console.log("Mermaid initialized with theme:", mermaidTheme);
    } catch (e) {
      console.error("Error initializing or running Mermaid:", e);
    }
  }
  const initialTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  initializeMermaid(initialTheme);

  const codeBlocks = document.querySelectorAll(".markdown-body pre");
  for (const preElement of codeBlocks) {
    const codeElement = preElement.querySelector("code");
    if (!codeElement || codeElement.classList.contains("language-mermaid")) {
      continue;
    }
    const copyButton = document.createElement("button");
    copyButton.className = "copy-code-button";
    copyButton.setAttribute("aria-label", "Copy code to clipboard");
    copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy';
    preElement.appendChild(copyButton);
    copyButton.addEventListener("click", () => {
      const codeToCopy = codeElement.innerText;
      navigator.clipboard
        .writeText(codeToCopy)
        .then(() => {
          copyButton.innerHTML = '<i class="fas fa-check"></i> Copied!';
          copyButton.classList.add("copied");
          setTimeout(() => {
            copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy';
            copyButton.classList.remove("copied");
          }, 2000);
        })
        .catch((err) => {
          console.error("Failed to copy code: ", err);
          copyButton.innerText = "Error";
          setTimeout(() => {
            copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy';
          }, 2000);
        });
    });
  }

  const tocContainer = document.getElementById("toc");
  const contentArea = document.getElementById("markdown-content-area");
  const kbContainer = document.querySelector(".kb-container");
  const tocSidebar = document.getElementById("toc-sidebar");

  if (tocContainer && tocSidebar) {
    let sectionsToObserve = [];
    let tocLinks = [];

    if (contentArea) {
      const headings = contentArea.querySelectorAll("h2, h3, h4");
      const tocList = document.createElement("ul");
      const existingSlugs = new Set();

      for (const heading of headings) {
        const level = Number.parseInt(heading.tagName.substring(1), 10);
        const text = heading.textContent?.trim() ?? "";
        if (!text) continue;

        const baseSlug = text
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]+/g, "");
        let uniqueSlug = baseSlug;
        let counter = 1;
        while (existingSlugs.has(uniqueSlug) || document.getElementById(uniqueSlug)) {
          uniqueSlug = `${baseSlug}-${counter}`;
          counter++;
        }
        heading.id = uniqueSlug;
        existingSlugs.add(uniqueSlug);

        const listItem = document.createElement("li");
        listItem.classList.add(`toc-h${level}`);
        const link = document.createElement("a");
        link.href = `#${uniqueSlug}`;
        link.textContent = text;
        listItem.appendChild(link);
        tocList.appendChild(listItem);
        sectionsToObserve.push(heading);
      }

      if (tocList.hasChildNodes()) {
        tocContainer.appendChild(tocList);
        tocLinks = tocContainer.querySelectorAll("a");
      } else {
        tocSidebar.style.display = "none";
      }
    } else if (kbContainer) {
      sectionsToObserve = kbContainer.querySelectorAll(".kb-item");
      tocLinks = tocContainer.querySelectorAll("a");
      if (tocLinks.length === 0) {
        const noEntriesLi = tocContainer.querySelector("li span.text-muted");
        if (!noEntriesLi) {
          tocSidebar.style.display = "none";
        }
      }
    } else {
      tocSidebar.style.display = "none";
    }

    if (sectionsToObserve.length > 0 && tocLinks.length > 0) {
      const observerOptions = {
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0,
      };
      let lastActiveLink = null;

      const observerCallback = (entries) => {
        let topmostVisibleEntry = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topmostVisibleEntry || entry.boundingClientRect.top < topmostVisibleEntry.boundingClientRect.top) {
              topmostVisibleEntry = entry;
            }
          }
        }

        let activeId = null;
        if (topmostVisibleEntry) {
          activeId = topmostVisibleEntry.target.getAttribute("id");
        }

        if (lastActiveLink) {
          lastActiveLink.classList.remove("active");
        }

        if (activeId) {
          const correspondingLink = tocContainer.querySelector(`a[href="#${activeId}"]`);
          if (correspondingLink) {
            correspondingLink.classList.add("active");
            lastActiveLink = correspondingLink;
          } else {
            lastActiveLink = null;
          }
        } else {
          lastActiveLink = null;
        }
      };

      const observer = new IntersectionObserver(observerCallback, observerOptions);
      for (const section of sectionsToObserve) {
        observer.observe(section);
      }

      for (const link of tocLinks) {
        link.addEventListener("click", (e) => {
          if (document.body.classList.contains("toc-sidebar-open")) {
            document.body.classList.remove("toc-sidebar-open");
            document.getElementById("sidebar-backdrop")?.classList.remove("is-visible");
          }
          if (lastActiveLink) lastActiveLink.classList.remove("active");
          link.classList.add("active");
          lastActiveLink = link;
        });
      }
    } else if (tocLinks.length === 0 && !kbContainer) {
      tocSidebar.style.display = "none";
    }
  } else {
    if (tocSidebar) tocSidebar.style.display = "none";
  }

  const themeToggleButton = document.getElementById("theme-toggle");
  themeToggleButton?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    const newTheme = isDark ? "dark" : "light";
    localStorage.setItem("theme", newTheme);
    if (typeof mermaid !== "undefined" && typeof initializeMermaid === "function") {
      initializeMermaid(newTheme);
    }
  });

  const mobileProjectToggle = document.getElementById("mobile-project-nav-toggle");
  const mobileTocToggle = document.getElementById("mobile-toc-nav-toggle");
  const projectSidebar = document.getElementById("project-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  function closeSidebars() {
    document.body.classList.remove("project-sidebar-open", "toc-sidebar-open");
    backdrop?.classList.remove("is-visible");
  }

  mobileProjectToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSidebars();
    document.body.classList.add("project-sidebar-open");
    backdrop?.classList.add("is-visible");
  });

  mobileTocToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSidebars();
    document.body.classList.add("toc-sidebar-open");
    backdrop?.classList.add("is-visible");
  });

  backdrop?.addEventListener("click", () => {
    closeSidebars();
  });

  const entryId = contentArea?.dataset.entryId;
  const viewTimeTrackingEnabled = contentArea?.dataset.viewTimeTrackingEnabled === "true";
  const isStagedPreview = contentArea?.dataset.isStagedPreview === "true";
  const urlParams = new URLSearchParams(window.location.search);
  const isAdminView = urlParams.get("from_admin") === "1";
  const MIN_DURATION_SECONDS = 5;
  const MAX_DURATION_SECONDS = 60 * 30;

  if (entryId && viewTimeTrackingEnabled && !isAdminView && !isStagedPreview) {
    const startTime = Date.now();
    let hasSentBeacon = false;

    const logDuration = () => {
      if (hasSentBeacon) return;

      const endTime = Date.now();
      let durationSeconds = Math.round((endTime - startTime) / 1000);

      if (durationSeconds < MIN_DURATION_SECONDS) {
        console.log(`View duration (${durationSeconds}s) too short, skipping log.`);
        return;
      }
      durationSeconds = Math.min(durationSeconds, MAX_DURATION_SECONDS);

      const payload = JSON.stringify({
        entryId: entryId,
        duration: durationSeconds,
      });

      const beaconUrl = "/api/log-duration-pb";
      if (navigator.sendBeacon) {
        try {
          const sent = navigator.sendBeacon(beaconUrl, payload);
          if (sent) {
            console.log(`Sent duration (${durationSeconds}s) for entry ${entryId} via sendBeacon.`);
            hasSentBeacon = true;
          } else {
            console.warn("navigator.sendBeacon returned false.");
          }
        } catch (e) {
          console.error("Error calling navigator.sendBeacon:", e);
        }
      } else {
        console.warn("navigator.sendBeacon is not supported. Duration not logged.");
      }
    };

    window.addEventListener("pagehide", logDuration);

    window.addEventListener("beforeunload", () => {
      if (!hasSentBeacon && navigator.sendBeacon) {
        logDuration();
      }
    });
  } else {
    if (!entryId) {
      console.warn("Could not find entry ID for duration tracking.");
    }
    if (!viewTimeTrackingEnabled) {
      console.log("View time tracking is disabled for this project.");
    }
    if (isAdminView) {
      console.log("View time tracking skipped due to 'from_admin=1'.");
    }
    if (isStagedPreview) {
      console.log("View time tracking skipped for staged preview page.");
    }
  }

  const headingsToObserve = contentArea ? contentArea.querySelectorAll("h2[id], h3[id], h4[id]") : [];
  const HOVER_DELAY = 2000;

  const styleElement = document.createElement("style");
  styleElement.textContent = `
    .heading-copy-tooltip {
      position: absolute;
      background-color: #333;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      white-space: nowrap;
      z-index: 10;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
      pointer-events: none;
      margin-left: 10px;
      margin-top: -2px;
    }
    .heading-copy-tooltip.visible {
      opacity: 1;
    }
    h2[id], h3[id], h4[id] {
      cursor: pointer;
      position: relative;
    }
  `;
  document.head.appendChild(styleElement);

  for (const heading of headingsToObserve) {
    let hoverTimeoutId = null;
    const tooltip = document.createElement("span");
    tooltip.className = "heading-copy-tooltip";
    tooltip.textContent = "Click to copy link";
    heading.appendChild(tooltip);

    heading.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeoutId);
      hoverTimeoutId = setTimeout(() => {
        tooltip.classList.add("visible");
      }, HOVER_DELAY);
    });

    heading.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimeoutId);
      tooltip.classList.remove("visible");
      setTimeout(() => {
        if (!tooltip.classList.contains("visible")) {
          tooltip.textContent = "Click to copy link";
        }
      }, 200);
    });

    heading.addEventListener("click", (event) => {
      event.preventDefault();
      const link = `${window.location.origin + window.location.pathname}#${heading.id}`;
      navigator.clipboard
        .writeText(link)
        .then(() => {
          tooltip.textContent = "Copied!";
          tooltip.classList.add("visible");
          clearTimeout(hoverTimeoutId);
          setTimeout(() => {
            tooltip.classList.remove("visible");
            setTimeout(() => {
              tooltip.textContent = "Click to copy link";
            }, 200);
          }, 1000);
        })
        .catch((err) => {
          console.error("Failed to copy heading link: ", err);
          tooltip.textContent = "Copy failed";
          tooltip.classList.add("visible");
          clearTimeout(hoverTimeoutId);
          setTimeout(() => {
            tooltip.classList.remove("visible");
            setTimeout(() => {
              tooltip.textContent = "Click to copy link";
            }, 200);
          }, 1000);
        });
    });
  }

  const feedbackSection = document.querySelector(".feedback-section");
  if (feedbackSection) {
    const feedbackButtons = feedbackSection.querySelectorAll(".feedback-btn");
    const feedbackMessage = feedbackSection.querySelector(".feedback-message");
    const entryIdForFeedback = feedbackButtons[0]?.dataset.entryId;

    const disableFeedbackButtons = (messageText) => {
      for (const button of feedbackButtons) {
        button.disabled = true;
      }
      if (feedbackMessage) {
        feedbackMessage.textContent = messageText;
        feedbackMessage.style.display = "block";
      }
    };

    if (entryIdForFeedback) {
      const storageKey = `feedback_voted_${entryIdForFeedback}`;
      if (localStorage.getItem(storageKey) === "true") {
        console.log(`Feedback buttons disabled for entry ${entryIdForFeedback} due to localStorage flag.`);
        disableFeedbackButtons("Thank you for your feedback!");
      }
    }

    for (const button of feedbackButtons) {
      button.addEventListener("click", async () => {
        const currentEntryId = button.dataset.entryId;
        const voteType = button.dataset.voteType;

        if (!currentEntryId || !voteType) {
          console.error("Missing data attributes on feedback button.");
          return;
        }

        disableFeedbackButtons("Submitting...");

        try {
          const response = await fetch("/api/feedback", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ entryId: currentEntryId, voteType }),
          });

          const result = await response.json();

          if (response.ok || response.status === 409) {
            const messageText = response.status === 409 ? "You've already provided feedback for this page." : "Thank you for your feedback!";
            disableFeedbackButtons(messageText);
            const storageKey = `feedback_voted_${currentEntryId}`;
            localStorage.setItem(storageKey, "true");
            console.log(`Feedback submitted or duplicate detected for ${currentEntryId}. Setting localStorage flag.`);
          } else {
            throw new Error(result.error || "Failed to submit feedback.");
          }
        } catch (error) {
          console.error("Feedback submission error:", error);
          if (feedbackMessage) {
            feedbackMessage.textContent = `Error: ${error.message || "Could not submit feedback."}`;
            feedbackMessage.style.display = "block";
            feedbackMessage.style.color = "var(--danger-color)";
          }
          for (const btn of feedbackButtons) {
            btn.disabled = false;
          }
          if (feedbackMessage) {
            setTimeout(() => {
              feedbackMessage.style.display = "none";
              feedbackMessage.style.color = "";
              feedbackMessage.textContent = "";
            }, 3000);
          }
        }
      });
    }
  }

  const roadmapCards = document.querySelectorAll(".js-roadmap-card");
  const roadmapModal = document.getElementById("roadmap-details-modal");
  const roadmapModalTitle = document.getElementById("roadmap-modal-title");
  const roadmapModalContent = document.getElementById("roadmap-modal-content");
  const roadmapModalCloseBtn = document.getElementById("roadmap-modal-close-btn");
  const roadmapModalOkBtn = document.getElementById("roadmap-modal-ok-btn");

  function showRoadmapModal(titleText, contentText) {
    if (!roadmapModal || !roadmapModalTitle || !roadmapModalContent || !marked) return;

    roadmapModalTitle.textContent = titleText || "Roadmap Item Details";

    if (contentText && contentText.trim() !== "") {
      try {
        const unsafeHtml = marked.parse(contentText);
        roadmapModalContent.innerHTML = DOMPurify.sanitize(unsafeHtml, {
          USE_PROFILES: { html: true },
        });
        hljs.highlightAll();
        if (typeof initializeMermaid === "function") {
          const currentTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
          initializeMermaid(currentTheme);
        }
      } catch (e) {
        console.error("Error parsing or rendering roadmap content:", e);
        roadmapModalContent.innerHTML = "<p><em>Error displaying details.</em></p>";
      }
    } else {
      roadmapModalContent.innerHTML = "<p><em>No details provided.</em></p>";
    }

    roadmapModal.classList.add("is-visible");
    roadmapModal.setAttribute("aria-hidden", "false");
  }

  function hideRoadmapModal() {
    if (roadmapModal) {
      roadmapModal.classList.remove("is-visible");
      roadmapModal.setAttribute("aria-hidden", "true");
      if (roadmapModalContent) roadmapModalContent.innerHTML = "";
    }
  }

  for (const card of roadmapCards) {
    card.addEventListener("click", () => {
      const contentEncoded = card.dataset.content;
      const titleText = card.dataset.title || "Details";
      let contentText = "";
      if (contentEncoded) {
        try {
          contentText = decodeURIComponent(contentEncoded);
        } catch (e) {
          console.error("Failed to decode roadmap content:", e);
        }
      }
      showRoadmapModal(titleText, contentText);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
  }

  roadmapModalCloseBtn?.addEventListener("click", hideRoadmapModal);
  roadmapModalOkBtn?.addEventListener("click", hideRoadmapModal);
  roadmapModal?.addEventListener("click", (event) => {
    if (event.target === roadmapModal) {
      hideRoadmapModal();
    }
  });
});
