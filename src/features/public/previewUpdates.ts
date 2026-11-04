export const previewUpdateEvent = 'booking-public-page-updated'
export const previewUpdateStorageKey = 'booking-public-page-update'

export function notifyPublicPageUpdate() {
  window.dispatchEvent(new Event(previewUpdateEvent))
  try { localStorage.setItem(previewUpdateStorageKey,crypto.randomUUID()) }
  catch { /* The current window still updates when browser storage is unavailable. */ }
}
