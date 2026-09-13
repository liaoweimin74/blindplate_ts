// fontkit 2.0.4 无官方类型 —— 项目最小声明（仅覆盖本项目用到的 API；Task 71）
declare module 'fontkit' {
  /** fontkit 打开的单字体（TTFFont 实例；含 layout 能力，可直传 pdfkit registerFont） */
  export interface FontkitFont {
    postscriptName: string
    layout(text: string): unknown
    [key: string]: unknown
  }
  /** TrueTypeCollection（.ttc 集合容器；未指定 postscriptName 时 create 的返回值） */
  export interface FontkitCollection {
    type: 'TTC'
    getFont(postscriptName: string): FontkitFont | null
    fonts: FontkitFont[]
  }
  /** 按魔数探测格式并打开；.ttc 未提供 postscriptName 时返回集合对象 */
  export function create(buffer: Buffer | Uint8Array, postscriptName?: string): FontkitFont | FontkitCollection
}
