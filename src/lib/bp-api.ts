// 盲板管理系统 - 前端 API 封装
'use client'

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...init,
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 空响应体 */
  }
  if (!res.ok) {
    const errObj = (body && typeof body === 'object' ? body : {}) as { error?: unknown; message?: unknown }
    const msg =
      (typeof errObj.error === 'string' && errObj.error) ||
      (typeof errObj.message === 'string' && errObj.message) ||
      `请求失败(${res.status})`
    throw new Error(msg)
  }
  return body as T
}

export const apiGet = <T = unknown,>(path: string) => api<T>(path)
export const apiPost = <T = unknown,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const apiPut = <T = unknown,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
export const apiPatch = <T = unknown,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
export const apiDelete = <T = unknown,>(path: string) => api<T>(path, { method: 'DELETE' })

/** multipart 上传（不要手动设 Content-Type，浏览器自动带 boundary） */
export async function apiUpload<T = unknown,>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form, cache: 'no-store' })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 空响应体 */
  }
  if (!res.ok) {
    const errObj = (body && typeof body === 'object' ? body : {}) as { error?: unknown }
    throw new Error((typeof errObj.error === 'string' && errObj.error) || `上传失败(${res.status})`)
  }
  return body as T
}

/** 从本地缓存读取当前登录用户（登录时写入 bp_current_user），供审计日志等场景使用 */
export function getStoredUser(): { id: string; name: string; role?: string } | null {
  try {
    const raw = localStorage.getItem('bp_current_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ============ 格式化辅助 ============
export function fmtDate(d?: string | Date | null): string {
  if (!d) return '-'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '-'
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return '-'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '-'
  return `${fmtDate(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

/** 转换为 datetime-local input 需要的值 */
export function toLocalInput(d?: string | Date | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return `${fmtDate(dt)}T${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}
