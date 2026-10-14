/**
 * 图片压缩为 data URL（底图/AI 识别上传共用，Task 127 自 pid-import 抽取）
 * —— 最长边 ≤maxPx、JPEG quality 85：VLM 侧 ~1344 等效、底图 SQLite/传输体积可控
 */
export function loadImageAsDataUrl(file: File, maxPx = 1600, quality = 0.85): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = document.createElement('img')
    const cleanup = () => URL.revokeObjectURL(url)
    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('画布初始化失败')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (err) {
        reject(err instanceof Error ? err : new Error('图片压缩失败'))
      } finally {
        cleanup()
      }
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}
