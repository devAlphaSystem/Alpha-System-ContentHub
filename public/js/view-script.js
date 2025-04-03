document.addEventListener("DOMContentLoaded", () => {
  hljs.highlightAll();

  const codeBlocks = document.querySelectorAll(".markdown-body pre");
  codeBlocks.forEach((preElement) => {
    const codeElement = preElement.querySelector("code");
    if (!codeElement) return;

    const copyButton = document.createElement("button");
    copyButton.className = "copy-code-button";
    copyButton.setAttribute("aria-label", "Copy code to clipboard");
    copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy';

    const checkIcon = document.createElement("i");
    checkIcon.className = "fas fa-check";
    copyButton.appendChild(checkIcon);

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
            copyButton.appendChild(checkIcon);
          }, 2000);
        })
        .catch((err) => {
          console.error("Failed to copy code: ", err);
          copyButton.innerText = "Error";
          setTimeout(() => {
            copyButton.innerHTML = '<i class="fas fa-copy"></i> Copy';
            copyButton.appendChild(checkIcon);
          }, 2000);
        });
    });
  });

  const tocContainer = document.getElementById("toc");
  const contentArea = document.getElementById("markdown-content-area");
  if (tocContainer && contentArea) {
    const headings = contentArea.querySelectorAll("h2, h3, h4");
    const tocList = document.createElement("ul");

    headings.forEach((heading) => {
      const level = Number.parseInt(heading.tagName.substring(1), 10);
      const text = heading.textContent.trim();

      const slug = text
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]+/g, "");

      let counter = 1;
      let uniqueSlug = slug;
      while (document.getElementById(uniqueSlug)) {
        uniqueSlug = `${slug}-${counter}`;
        counter++;
      }
      heading.id = uniqueSlug;

      const listItem = document.createElement("li");
      listItem.classList.add(`toc-h${level}`);

      const link = document.createElement("a");
      link.href = `#${uniqueSlug}`;
      link.textContent = text;

      listItem.appendChild(link);
      tocList.appendChild(listItem);
    });

    if (tocList.hasChildNodes()) {
      tocContainer.appendChild(tocList);
    } else {
      const tocTitle = document.querySelector(".toc-title");
      if (tocTitle) tocTitle.style.display = "none";
    }
  }

  const tocLinks = tocContainer?.querySelectorAll("a");
  const observerOptions = {
    rootMargin: "-50px 0px -50% 0px",
    threshold: 0,
  };

  const observerCallback = (entries) => {
    entries.forEach((entry) => {
      const id = entry.target.getAttribute("id");
      const correspondingLink = tocContainer?.querySelector(`a[href="#${id}"]`);

      if (entry.isIntersecting) {
        tocLinks?.forEach((link) => link.classList.remove("active"));
        correspondingLink?.classList.add("active");
      }
    });
  };

  const observer = new IntersectionObserver(observerCallback, observerOptions);
  contentArea?.querySelectorAll("h2, h3, h4").forEach((section) => {
    observer.observe(section);
  });

  const themeToggleButton = document.getElementById("theme-toggle");
  themeToggleButton?.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    let theme = "light";
    if (document.body.classList.contains("dark-mode")) {
      theme = "dark";
    }
    localStorage.setItem("theme", theme);
  });
});
