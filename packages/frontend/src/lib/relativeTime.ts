/** "just now", "5 minutes ago", "3 hours ago", "yesterday", or the date — for "Last synced …". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  if (hours < 48) return 'yesterday'
  return new Date(at).toLocaleDateString()
}
