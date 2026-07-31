import { ArrowLeft, MessageCircle } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'

type WorkflowHeaderNavProps = {
  onBackToWorkspace: () => void
  onOpenSidebar: () => void
  showDivider?: boolean
}

export function WorkflowHeaderNav({
  onBackToWorkspace,
  onOpenSidebar,
  showDivider = true,
}: WorkflowHeaderNavProps) {
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex items-center gap-[var(--ui-gap-related)]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBackToWorkspace}
          aria-label="返回项目页"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开对话列表"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      </div>
      {showDivider ? (
        <span
          className="ml-[var(--ui-gap-control)] mr-[var(--ui-gap-block)] h-5 w-px shrink-0 bg-[var(--border)]"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}
