import type { DraftQualitySnapshot } from '@lumos-ai/shared'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, ShieldCheck } from '@/components/ui/icon'

type DraftQualitySummaryProps = {
  snapshot: DraftQualitySnapshot
  className?: string
}

const statusCopy = {
  passed: {
    title: '生成检查通过',
    action: '查看 4 项结果',
    className: 'text-[#17675b]',
    icon: ShieldCheck,
  },
  needs_review: {
    title: '修改后待复核',
    action: '查看待确认项',
    className: 'text-[#8a5a16]',
    icon: AlertTriangle,
  },
  failed: {
    title: '检查未通过',
    action: '查看需要修正的内容',
    className: 'text-[#a3412f]',
    icon: AlertTriangle,
  },
} as const

const checkStatusCopy = {
  passed: '通过',
  needs_review: '待确认',
  failed: '未通过',
  not_applicable: '未设置',
} as const

export function DraftQualitySummary({
  snapshot,
  className,
}: DraftQualitySummaryProps) {
  const status = statusCopy[snapshot.overallStatus]
  const StatusIcon = status.icon

  return (
    <details
      className={cn(
        'group border-y border-[rgba(15,23,42,0.06)] bg-[rgba(248,250,252,0.46)] px-1 py-3',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 marker:hidden">
        <span className={cn('flex min-w-0 items-center gap-2 text-sm font-semibold', status.className)}>
          <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{status.title}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-[var(--soft-foreground)] group-open:hidden">
          {status.action}
        </span>
        <span className="hidden shrink-0 text-xs font-medium text-[var(--soft-foreground)] group-open:inline">
          收起
        </span>
      </summary>

      <div className="mt-3 border-t border-[rgba(15,23,42,0.05)] pt-3">
        <div className="grid max-h-80 gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
          {snapshot.checks.map((check) => {
            const passed = check.status === 'passed' || check.status === 'not_applicable'
            const CheckIcon = passed ? CheckCircle2 : AlertTriangle
            return (
              <section key={check.id} className="min-w-0">
                <div className="flex items-center gap-2">
                  <CheckIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      check.status === 'not_applicable'
                        ? 'text-[var(--soft-foreground)]'
                        : passed
                        ? 'text-[#17675b]'
                        : check.status === 'failed'
                          ? 'text-[#a3412f]'
                          : 'text-[#8a5a16]',
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-[var(--foreground)]">
                    {check.label}
                  </span>
                  <span className="text-[0.7rem] text-[var(--soft-foreground)]">
                    {checkStatusCopy[check.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  {check.summary}
                </p>
                {check.details.length > 0 ? (
                  <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-xs leading-5 text-[var(--soft-foreground)] marker:text-[rgba(100,116,139,0.5)]">
                    {check.details.map((detail, index) => (
                      <li key={`${check.id}-${index}`}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
        <p className="mt-3 text-[0.7rem] leading-5 text-[var(--soft-foreground)]">
          自动检查用于减少遗漏，不替代你对事实和最终表达的人工确认。
        </p>
      </div>
    </details>
  )
}
