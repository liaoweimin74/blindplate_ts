'use client'
// 用户菜单：个人信息 / 修改密码 / 退出登录（桌面侧边栏 + 移动端顶栏复用）
import { useState } from 'react'
import { apiPost } from '@/lib/bp-api'
import { BpUser, ROLE_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Building2, Check, Eye, EyeOff, KeyRound, LogOut, Phone, UserRound, X,
} from 'lucide-react'

interface PwdForm {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY_PWD: PwdForm = { oldPassword: '', newPassword: '', confirmPassword: '' }

/** 密码强度：0 弱 / 1 中 / 2 强 */
function pwdStrength(pwd: string): 0 | 1 | 2 {
  if (!pwd) return 0
  const hasLetter = /[a-zA-Z]/.test(pwd)
  const hasDigit = /\d/.test(pwd)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pwd)
  const kinds = [hasLetter, hasDigit, hasSymbol].filter(Boolean).length
  if (pwd.length >= 10 && kinds >= 2) return 2
  if (pwd.length >= 6 && kinds >= 2) return 1
  return 0
}

const STRENGTH_META = [
  { label: '弱', bar: 'bg-red-400', text: 'text-red-500', width: 'w-1/3' },
  { label: '中', bar: 'bg-amber-400', text: 'text-amber-600', width: 'w-2/3' },
  { label: '强', bar: 'bg-emerald-500', text: 'text-emerald-600', width: 'w-full' },
] as const

/** 新密码强度策略（与后端 validatePasswordStrength 同口径）：≥8 位且同时包含字母和数字 */
function pwdPolicyError(pwd: string): string {
  if (pwd.length < 8) return '新密码长度至少 8 位'
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return '新密码必须同时包含字母和数字'
  if (/^(?:([A-Za-z0-9])\1{3,})/.test(pwd)) return '新密码不能包含 4 位以上连续重复字符'
  return ''
}

export default function UserMenu({ user, onLogout, compact = false }: {
  user: BpUser
  onLogout: () => void
  compact?: boolean
}) {
  const { toast } = useToast()
  const [pwdOpen, setPwdOpen] = useState(false)
  const [form, setForm] = useState<PwdForm>(EMPTY_PWD)
  const [saving, setSaving] = useState(false)
  const [showPwd, setShowPwd] = useState<{ old: boolean; next: boolean; confirm: boolean }>({ old: false, next: false, confirm: false })

  const roleMeta = ROLE_MAP[user.role]
  const strength = pwdStrength(form.newPassword)
  const policyError = form.newPassword.length > 0 ? pwdPolicyError(form.newPassword) : ''
  const confirmMismatch = form.confirmPassword.length > 0 && form.confirmPassword !== form.newPassword
  const canSubmit = form.oldPassword.length > 0 && form.newPassword.length >= 8 && form.newPassword === form.confirmPassword

  const openPwdDialog = () => {
    setForm(EMPTY_PWD)
    setShowPwd({ old: false, next: false, confirm: false })
    setPwdOpen(true)
  }

  const submitPwd = async () => {
    if (!canSubmit) {
      toast({ title: '请检查表单', description: '新密码至少 8 位且包含字母和数字，两次输入一致', variant: 'destructive' })
      return
    }
    const policyErr = pwdPolicyError(form.newPassword)
    if (policyErr) {
      toast({ title: '密码强度不足', description: policyErr, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/auth/change-password', {
        userId: user.id,
        oldPassword: form.oldPassword,
        newPassword: form.newPassword,
      })
      toast({ title: '密码修改成功', description: '下次登录请使用新密码' })
      setPwdOpen(false)
    } catch (err) {
      toast({ title: '修改失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // 密码输入框（含可见性切换）
  const pwdInput = (key: 'old' | 'next' | 'confirm', label: string, placeholder: string, value: string, onChange: (v: string) => void) => (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type={showPwd[key] ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="pr-9"
        />
        <button
          type="button"
          aria-label={showPwd[key] ? '隐藏密码' : '显示密码'}
          onClick={() => setShowPwd({ ...showPwd, [key]: !showPwd[key] })}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
        >
          {showPwd[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )

  const changePwdDialog = (
    <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-700" /> 修改登录密码
          </DialogTitle>
          <DialogDescription>为账号「{user.username}」设置新密码，修改后立即生效</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {pwdInput('old', '旧密码', '请输入当前密码', form.oldPassword, (v) => setForm({ ...form, oldPassword: v }))}
          <div className="grid gap-1.5">
            {pwdInput('next', '新密码', '至少 8 位，须包含字母和数字', form.newPassword, (v) => setForm({ ...form, newPassword: v }))}
            {form.newPassword.length > 0 && (
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-300', STRENGTH_META[strength].bar, STRENGTH_META[strength].width)} />
                </div>
                <span className={cn('text-[10px] font-medium', STRENGTH_META[strength].text)}>
                  密码强度：{STRENGTH_META[strength].label}
                </span>
              </div>
            )}
          </div>
          {pwdInput('confirm', '确认新密码', '再次输入新密码', form.confirmPassword, (v) => setForm({ ...form, confirmPassword: v }))}
          {policyError && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <X className="h-3 w-3" /> {policyError}
            </p>
          )}
          {confirmMismatch && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <X className="h-3 w-3" /> 两次输入的密码不一致
            </p>
          )}
          {!confirmMismatch && form.confirmPassword.length > 0 && form.newPassword === form.confirmPassword && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <Check className="h-3 w-3" /> 两次输入一致
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
          <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving || !canSubmit} onClick={() => void submitPwd()}>
            {saving ? '提交中…' : '确认修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // ============ 移动端紧凑触发器 ============
  if (compact) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="用户菜单"
              className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0 ring-2 ring-transparent hover:ring-emerald-400/50 transition-all"
            >
              {user.name.slice(0, 1)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {user.name.slice(0, 1)}
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-semibold text-stone-800 truncate">{user.name}</div>
                <div className="text-[11px] text-stone-400 truncate">{user.department ?? '-'}</div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openPwdDialog}>
              <KeyRound className="h-4 w-4 mr-2 text-stone-400" /> 修改密码
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout} className="text-rose-600 focus:text-rose-700 focus:bg-rose-50">
              <LogOut className="h-4 w-4 mr-2" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {changePwdDialog}
      </>
    )
  }

  // ============ 桌面侧边栏用户卡 ============
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="用户菜单"
            className="w-full flex items-center gap-2.5 rounded-lg bg-stone-800/60 px-3 py-2.5 text-left hover:bg-stone-800 transition-colors group/u"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {user.name.slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-white text-sm truncate">{user.name}</div>
              <div className="text-[11px] text-stone-500 truncate">{user.department ?? '-'}</div>
            </div>
            <ChevronDownTiny />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          {/* 个人信息 */}
          <DropdownMenuLabel className="px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center text-base font-bold shrink-0 shadow-sm">
                {user.name.slice(0, 1)}
              </div>
              <div className="min-w-0 leading-snug">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-stone-800 truncate">{user.name}</span>
                  <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', roleMeta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200')}>
                    {roleMeta?.label ?? user.role}
                  </Badge>
                </div>
                <div className="text-[11px] text-stone-400 font-mono truncate">@{user.username}</div>
              </div>
            </div>
            <div className="mt-2.5 space-y-1 text-[11px] text-stone-500">
              {user.department && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3 w-3 text-stone-400 shrink-0" /> {user.department}
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-stone-400 shrink-0" /> {user.phone}
                </div>
              )}
              {!user.phone && !user.department && (
                <div className="flex items-center gap-1.5 text-stone-400">
                  <UserRound className="h-3 w-3 shrink-0" /> 暂无更多资料
                </div>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openPwdDialog} className="cursor-pointer">
            <KeyRound className="h-4 w-4 mr-2 text-stone-400" /> 修改密码
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50">
            <LogOut className="h-4 w-4 mr-2" /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changePwdDialog}
    </>
  )
}

function ChevronDownTiny() {
  return (
    <svg
      className="w-3.5 h-3.5 text-stone-500 group-hover/u:text-stone-300 transition-all group-hover/u:translate-y-0.5 shrink-0"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
