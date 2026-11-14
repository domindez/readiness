/** Utilidades de navegador compartidas por los scripts de las páginas. */

export function toast(message: string, isError = false) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 2500);
}

/** Recarga la página y muestra el mensaje al volver. */
export function reloadWithToast(message: string, url?: string) {
  try {
    sessionStorage.setItem('toast', message);
  } catch {}
  if (url) location.href = url;
  else location.reload();
}

export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
