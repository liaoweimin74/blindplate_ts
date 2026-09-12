"use client"

import { createPortal } from "react-dom"
import { useToast } from "@/hooks/use-toast"
import { usePortalContainer } from "@/components/ui/portal-container"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()
  // 全屏等场景下 toast 整体重定向进指定容器（原生 Fullscreen top layer 会盖住 body 层浮层）
  const portalContainer = usePortalContainer()

  const content = (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )

  if (portalContainer) return createPortal(content, portalContainer)
  return content
}