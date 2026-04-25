export async function writeText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.readOnly = true
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.width = "1px"
    textarea.style.height = "1px"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)

    try {
      if (!document.execCommand("copy")) throw new Error("Copy command failed")
    } finally {
      textarea.remove()
    }
  }
}
