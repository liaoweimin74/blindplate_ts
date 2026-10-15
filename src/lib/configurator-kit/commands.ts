// ============ 二级·工具命令注册表（headless 工具条） ============
// 三级抽象定位：工具条按钮 = 命令注册表的一行。命令实现（缩放/重置/显隐/导出/
// 布局/删除等）由本模块内置工厂提供 —— 壳层只做「按钮渲染 + 快捷键转发」，
// 每壳工具条压到百行内。命令可被宿主扩展（enabled 动态禁用、自定义命令注入）。

export interface CommandDef {
  id: string
  label: string
  group: 'zoom' | 'edit' | 'view' | 'layout' | 'export'
  /** 快捷键（'mod+z' / 'shift+del'；mod = Ctrl|Meta） */
  shortcut?: string
  /** 动态禁用（如查看态禁编辑命令）；缺省恒可用 */
  enabled?: () => boolean
  run: () => void
  /** 是否渲染分隔线在此命令前（工具条分组） */
  separatorBefore?: boolean
}

export interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** 归一化快捷键串（'Mod+z' 统一小写、mod 代指 Ctrl/Meta） */
function normalizeShortcut(s: string): string {
  return s.toLowerCase().replace('ctrl', 'mod').replace('cmd', 'mod').split('+').map((p) => p.trim()).sort().join('+')
}

function eventToShortcut(e: ShortcutEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  parts.push(e.key.toLowerCase())
  return parts.sort().join('+')
}

export class CommandRegistry {
  private cmds = new Map<string, CommandDef>()
  private byShortcut = new Map<string, string>()

  register(cmd: CommandDef): void {
    this.cmds.set(cmd.id, cmd)
    if (cmd.shortcut) this.byShortcut.set(normalizeShortcut(cmd.shortcut), cmd.id)
  }

  registerAll(cmds: CommandDef[]): void {
    cmds.forEach((c) => this.register(c))
  }

  get(id: string): CommandDef | undefined {
    return this.cmds.get(id)
  }

  list(): CommandDef[] {
    return [...this.cmds.values()]
  }

  run(id: string): boolean {
    const cmd = this.cmds.get(id)
    if (!cmd) return false
    if (cmd.enabled && !cmd.enabled()) return false
    cmd.run()
    return true
  }

  /** keydown 转发入口：命中返回并执行命令；未命中返回 false */
  handleShortcut(e: ShortcutEvent): boolean {
    const id = this.byShortcut.get(eventToShortcut(e))
    return id ? this.run(id) : false
  }
}

/** 宿主工具函数契约：壳层把视口/文档操作注入进来即可得到完整内置命令集 */
export interface ToolContext {
  zoomIn(): void
  zoomOut(): void
  resetView(): void
  fitView(): void
  toggleLabels(): void
  labelsVisible(): boolean
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  duplicate(): void
  deleteSelection(): void
  align(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void
  autoLayout(): void
  exportSvg(): void
  exportPng(): void
  /** 编辑态门禁（canvas-mode.interactionsAllowed 的宿主闭包） */
  editAllowed(): boolean
}

export function createBuiltinCommands(t: ToolContext): CommandDef[] {
  const editGate = () => t.editAllowed()
  return [
    { id: 'zoom.in', label: '放大', group: 'zoom', shortcut: 'mod+=', run: t.zoomIn },
    { id: 'zoom.out', label: '缩小', group: 'zoom', shortcut: 'mod+-', run: t.zoomOut },
    { id: 'zoom.reset', label: '重置视图', group: 'zoom', run: t.resetView },
    { id: 'zoom.fit', label: '适应画布', group: 'zoom', run: t.fitView },
    {
      id: 'view.labels',
      label: '属性文字显隐',
      group: 'view',
      run: t.toggleLabels,
      enabled: () => t.labelsVisible() || t.editAllowed(),
    },
    { id: 'edit.undo', label: '撤销', group: 'edit', shortcut: 'mod+z', run: t.undo, enabled: () => t.editAllowed() && t.canUndo() },
    { id: 'edit.redo', label: '重做', group: 'edit', shortcut: 'mod+shift+z', run: t.redo, enabled: () => t.editAllowed() && t.canRedo() },
    { id: 'edit.duplicate', label: '复制图元', group: 'edit', shortcut: 'mod+d', run: t.duplicate, enabled: editGate, separatorBefore: true },
    { id: 'edit.delete', label: '删除选中', group: 'edit', shortcut: 'delete', run: t.deleteSelection, enabled: editGate },
    { id: 'edit.align.left', label: '左对齐', group: 'edit', run: () => t.align('left'), enabled: editGate },
    { id: 'edit.align.hcenter', label: '水平居中', group: 'edit', run: () => t.align('hcenter'), enabled: editGate },
    { id: 'edit.align.right', label: '右对齐', group: 'edit', run: () => t.align('right'), enabled: editGate },
    { id: 'edit.align.top', label: '顶对齐', group: 'edit', run: () => t.align('top'), enabled: editGate },
    { id: 'edit.align.vcenter', label: '垂直居中', group: 'edit', run: () => t.align('vcenter'), enabled: editGate },
    { id: 'edit.align.bottom', label: '底对齐', group: 'edit', run: () => t.align('bottom'), enabled: editGate },
    { id: 'layout.auto', label: '自动布局', group: 'layout', run: t.autoLayout, enabled: editGate, separatorBefore: true },
    { id: 'export.svg', label: '导出 SVG', group: 'export', run: t.exportSvg, separatorBefore: true },
    { id: 'export.png', label: '导出 PNG', group: 'export', run: t.exportPng },
  ]
}
