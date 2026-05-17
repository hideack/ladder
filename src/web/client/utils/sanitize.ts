import DOMPurify from 'isomorphic-dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'loading'],
  });
}

export function postProcess(html: string): string {
  // Force links to open in new tab and lazy-load images.
  // We do this in the browser because DOMPurify's ADD_ATTR allows but doesn't set.
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  for (const a of tmp.querySelectorAll('a')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  for (const img of tmp.querySelectorAll('img')) {
    img.setAttribute('loading', 'lazy');
  }
  return tmp.innerHTML;
}

export function renderHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  return postProcess(sanitizeHtml(raw));
}
