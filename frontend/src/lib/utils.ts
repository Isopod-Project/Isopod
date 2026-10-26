import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

// Player names come from user input and server files, so they're encoded before going into a URL
export function playerAvatarUrl(identifier: string, size = 32) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(identifier || "steve")}/${size}`
}

/** Second avatar source, for an <img> onError when mc-heads.net doesn't answer. */
export function fallbackAvatarUrl(name: string, size = 32) {
  return `https://crafthead.net/avatar/${encodeURIComponent(name)}/${size}`
}
