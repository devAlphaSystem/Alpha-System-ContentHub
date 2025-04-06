document.addEventListener("DOMContentLoaded", () => {
  hljs.highlightAll();

  const codeBlocks = document.querySelectorAll(".markdown-body pre");

  for (const preElement of codeBlocks) {
    const codeElement = preElement.querySelector("code");
    if (!codeElement) {
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

  if (tocContainer && contentArea) {
    const headings = contentArea.querySelectorAll("h2, h3, h4");
    const tocList = document.createElement("ul");
    const existingSlugs = new Set();

    for (const heading of headings) {
      const level = Number.parseInt(heading.tagName.substring(1), 10);
      const text = heading.textContent?.trim() ?? "";

      if (!text) {
        continue;
      }

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
      const tocTitle = document.querySelector(".toc-title");
      if (tocTitle) {
        tocTitle.style.display = "none";
      }
    }

    const tocLinks = tocContainer.querySelectorAll("a");
    const observerOptions = {
      rootMargin: "-50px 0px -50% 0px",
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
          if (lastActiveLink) {
            lastActiveLink.classList.remove("active");
          }
          correspondingLink.classList.add("active");
          lastActiveLink = correspondingLink;
        }
      }
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    const sectionsToObserve = contentArea.querySelectorAll("h2, h3, h4");

    for (const section of sectionsToObserve) {
      observer.observe(section);
    }
  }

  const themeToggleButton = document.getElementById("theme-toggle");
  themeToggleButton?.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const theme = document.body.classList.contains("dark-mode") ? "dark" : "light";
    localStorage.setItem("theme", theme);
  });
});
