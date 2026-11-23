const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => MAP[c]);
}

/** Only allow non-script URLs in href; anything else becomes '#'. */
export function safeHref(url: string): string {
  return /^(https?:|mailto:|#|\.{0,2}\/)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : '#';
}
