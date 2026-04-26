;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "vercel"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  }

  var scheme = localStorage.getItem("opencode-color-scheme") || "dark"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  var css =
    themeId === "oc-2"
      ? isDark
        ? "--background-base:#101010;--background-weak:#1e1e1e;--background-strong:#121212;--background-stronger:#151515;"
        : "--background-base:#f8f8f8;--background-weak:#f3f3f3;--background-strong:#fcfcfc;--background-stronger:#fcfcfc;"
      : themeId === "vercel"
        ? isDark
          ? "--background-base:#000000;--background-weak:#101010;--background-strong:#000000;--background-stronger:#151515;"
          : "--background-base:#ffffff;--background-weak:#f3f3f3;--background-strong:#ffffff;--background-stronger:#fcfcfc;"
        : localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}body{background:var(--background-base)}"
    document.head.appendChild(style)
  }
})()
