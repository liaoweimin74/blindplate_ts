// 盲板管理系统 - CSV 导出工具（带 BOM，Excel 直接打开不乱码）

/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹 */
function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * 导出 CSV 文件
 * @param filename 文件名（不含扩展名）
 * @param headers 表头
 * @param rows 数据行（与表头对齐）
 */
export function exportCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','))
  const csv = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
