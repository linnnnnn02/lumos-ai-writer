import type { AiAnalysisResult } from '@lumos-ai/shared'
import { Badge } from '@/components/ui/badge'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Highlighter,
  Sparkles,
} from '@/components/ui/icon'
import { buildLearningResultViewModel } from './learning-result-model'

type LearningResultProps = {
  analysis: AiAnalysisResult
  isCloudEnabled: boolean
  referenceCount: number
  snippetCount: number
}

function getReferenceSummary(referenceCount: number, snippetCount: number) {
  if (referenceCount === 0 && snippetCount === 0) return '未使用参考素材'
  if (snippetCount === 0) return `${referenceCount} 篇参考`
  return `${referenceCount} 篇参考 · ${snippetCount} 条标注`
}

export function LearningResult({
  analysis,
  isCloudEnabled,
  referenceCount,
  snippetCount,
}: LearningResultProps) {
  const result = buildLearningResultViewModel(analysis, isCloudEnabled)

  return (
    <section aria-labelledby="learning-result-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <h2
            id="learning-result-title"
            className="text-balance text-lg font-semibold text-[var(--foreground)]"
          >
            学习结论
          </h2>
        </div>
        <Badge variant="outline">{getReferenceSummary(referenceCount, snippetCount)}</Badge>
      </div>

      <p className="mt-3 max-w-[64rem] text-pretty text-[length:var(--ui-text-body)] leading-7 text-[var(--foreground)]">
        {result.conclusion}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.8fr)] md:gap-0 md:divide-x md:divide-[var(--border)]">
        <section className="md:pr-6" aria-labelledby="learning-patterns-title">
          <h3
            id="learning-patterns-title"
            className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]"
          >
            <CheckCircle2 className="size-4 text-[var(--accent-strong)]" aria-hidden="true" />
            可迁移到这次写作
          </h3>
          <ol className="mt-2 grid gap-1.5">
            {result.patterns.map((pattern, index) => (
              <li key={pattern} className="flex gap-2.5 text-sm leading-5 text-[var(--foreground)]">
                <span className="tabular-nums text-xs font-semibold leading-5 text-[var(--soft-foreground)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-pretty">{pattern}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="md:pl-6">
          <section aria-labelledby="learning-scope-title">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="learning-scope-title" className="text-sm font-semibold text-[var(--foreground)]">
                适用范围
              </h3>
              <Badge variant="accent">{result.applicability.modeLabel}</Badge>
              <span className="text-xs text-[var(--soft-foreground)]">
                {result.applicability.confidenceLabel}
              </span>
            </div>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--muted-foreground)]">
              {result.applicability.rationale}
            </p>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--foreground)]">
              {result.applicability.reuseSuggestion}
            </p>
          </section>
        </div>
      </div>

      <section
        className="mt-3 flex flex-col gap-1 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-start sm:gap-3"
        aria-labelledby="learning-pending-title"
      >
        <h3
          id="learning-pending-title"
          className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--foreground)]"
        >
          <AlertTriangle className="size-4 text-[rgb(146,99,31)]" aria-hidden="true" />
          待你确认
        </h3>
        {result.pendingItems.length > 0 ? (
          result.pendingItems.map((item) => (
            <p key={item} className="text-pretty text-sm leading-6 text-[var(--foreground)]">
              {item}
              <span className="ml-2 text-xs text-[var(--soft-foreground)]">可在下方补充，非必答</span>
            </p>
          ))
        ) : (
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            当前没有必须确认的问题，可以继续生成。
          </p>
        )}
      </section>

      <details className="group mt-3 border-t border-[var(--border)] pt-1">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <Highlighter className="size-4 shrink-0 text-[var(--accent-strong)]" aria-hidden="true" />
            查看证据与不适用边界
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-[var(--soft-foreground)] transition-transform duration-150 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="grid gap-4 px-2 pb-2 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.65fr)]">
          <div>
            <p className="text-pretty text-sm leading-6 text-[var(--muted-foreground)]">
              {result.evidenceSummary}
            </p>
            {result.evidenceItems.length > 0 ? (
              <div className="mt-3 divide-y divide-[rgba(15,23,42,0.06)] border-y border-[rgba(15,23,42,0.06)]">
                {result.evidenceItems.map((item) => (
                  <blockquote key={`${item.source}-${item.quote}`} className="py-3">
                    <p className="text-pretty text-sm font-semibold leading-6 text-[var(--foreground)]">
                      “{item.quote}”
                    </p>
                    <footer className="mt-1 text-xs leading-5 text-[var(--soft-foreground)]">
                      《{item.source}》 · {item.reason}
                    </footer>
                  </blockquote>
                ))}
              </div>
            ) : null}
          </div>
          <section className="border-l-2 border-[rgba(169,118,38,0.28)] pl-4" aria-labelledby="learning-boundary-title">
            <h3 id="learning-boundary-title" className="text-sm font-semibold text-[var(--foreground)]">
              不适用边界
            </h3>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--muted-foreground)]">
              {result.applicability.boundary}
            </p>
          </section>
        </div>
      </details>

      <section className="mt-2 flex flex-col gap-2 border-t border-[var(--border)] pt-3 text-xs sm:flex-row sm:gap-4" aria-labelledby="learning-memory-title">
        <h3 id="learning-memory-title" className="sr-only">
          记忆范围
        </h3>
        <div className="flex min-w-0 flex-1 gap-2">
          <span className="shrink-0 text-xs font-semibold text-[var(--accent-strong)]">本次</span>
          <p className="text-pretty text-xs leading-5 text-[var(--muted-foreground)]">
            {result.memory.current}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 gap-2 sm:border-l sm:border-[var(--border)] sm:pl-4">
          <span className="shrink-0 text-xs font-semibold text-[var(--accent-strong)]">长期</span>
          <p className="text-pretty text-xs leading-5 text-[var(--muted-foreground)]">
            {result.memory.longTerm}
          </p>
        </div>
      </section>
    </section>
  )
}
