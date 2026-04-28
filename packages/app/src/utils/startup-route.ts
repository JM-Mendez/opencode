export const LAST_VISITED_PATH_KEY = "opencode.settings.dat:lastVisitedPath"

function normalizeLocalPath(value: string, origin: string) {
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin) return
    if (!url.pathname.startsWith("/")) return
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return
  }
}

export function resolveStartupPath(current: string, stored: string | null, origin: string) {
  if (current !== "/") return
  if (!stored) return
  const next = normalizeLocalPath(stored, origin)
  if (!next || next === "/") return
  if (/^\/[^/]+\/session\//.test(next)) return
  return next
}

export function persistablePath(path: string) {
  return path.startsWith("/")
}
