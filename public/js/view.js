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
          background: theme === "dark" ? "#1f2937" : "#ffffff",
        },
      });
      mermaid.run({ querySelector: ".language-mermaid" });
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
  const tocSidebar = document.getElementById("toc-sidebar");

  if (tocContainer && contentArea && tocSidebar) {
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
    }

    if (tocList.hasChildNodes()) {
      tocContainer.appendChild(tocList);
    } else {
      tocSidebar.style.display = "none";
    }

    const tocLinks = tocContainer.querySelectorAll("a");
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

      if (topmostVisibleEntry) {
        const id = topmostVisibleEntry.target.getAttribute("id");
        const correspondingLink = tocContainer.querySelector(`a[href="#${id}"]`);
        if (correspondingLink && correspondingLink !== lastActiveLink) {
          if (lastActiveLink) lastActiveLink.classList.remove("active");
          correspondingLink.classList.add("active");
          lastActiveLink = correspondingLink;
        }
      } else if (!entries.some((e) => e.isIntersecting) && lastActiveLink && window.scrollY < 200) {
        lastActiveLink.classList.remove("active");
        lastActiveLink = null;
      }
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    const sectionsToObserve = contentArea.querySelectorAll("h2, h3, h4");
    for (const section of sectionsToObserve) {
      observer.observe(section);
    }

    for (const link of tocLinks) {
      link.addEventListener("click", (e) => {
        if (document.body.classList.contains("toc-sidebar-open")) {
          document.body.classList.remove("toc-sidebar-open");
          document.getElementById("sidebar-backdrop")?.classList.remove("is-visible");
        }
      });
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
});
