export const API_URL = import.meta.env.VITE_API_URL || "";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
  return body as T;
}
