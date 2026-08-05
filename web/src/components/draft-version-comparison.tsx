import { buildDraftVersionDiff } from '@/lib/draft-version-diff'
import type { DraftVersionRecord } from '@/lib/draft-versions'

type DraftVersionComparisonProps = {
  before: DraftVersionRecord
  after: DraftVersionRecord
}

function DiffSide({
  label,
  paragraph,
  tone,
}: {
  label: string
  paragraph: string
  tone: 'before' | 'after'
}) {
  return (
    <div
      className={
        tone === 'before'
          ? 'border-l-2 border-[#a3412f]/35 bg-[#a3412f]/[0.035] px-4 py-3 sm:px-5'
          : 'border-l-2 border-[#17675b]/35 bg-[#17675b]/[0.035] px-4 py-3 sm:px-5'
      }
    >
      <span
        className={
          tone === 'before'
            ? 'text-[0.7rem] font-semibold text-[#a3412f]'
            : 'text-[0.7rem] font-semibold text-[#17675b]'
        }
      >
        {label}
      </span>
      <p className="mt-1.5 text-pretty text-sm leading-7 text-[var(--foreground)] sm:text-[0.95rem]">
        {paragraph || '（空段落）'}
      </p>
    </div>
  )
}

export function DraftVersionComparison({
  before,
  after,
}: DraftVersionComparisonProps) {
  const diff = buildDraftVersionDiff(before, after)
  const changeCount = diff.summary.added + diff.summary.modified + diff.summary.removed

  return (
    <div className="mx-auto max-w-[56rem]">
      <header className="border-b border-[rgba(15,23,42,0.07)] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              版本 <span className="tabular-nums">{before.version}</span> → 版本{' '}
              <span className="tabular-nums">{after.version}</span>
            </p>
            <p className="mt-1 text-pretty text-xs leading-5 text-[var(--soft-foreground)]">
              按段落对齐展示；未改内容也会保留，便于核对上下文。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
            {diff.title.changed ? <span className="text-[#8a5a16]">标题已改</span> : null}
            {diff.summary.modified > 0 ? (
              <span className="text-[#8a5a16]">{diff.summary.modified} 段改写</span>
            ) : null}
            {diff.summary.added > 0 ? (
              <span className="text-[#17675b]">+{diff.summary.added} 段新增</span>
            ) : null}
            {diff.summary.removed > 0 ? (
              <span className="text-[#a3412f]">-{diff.summary.removed} 段删除</span>
            ) : null}
            {!diff.title.changed && changeCount === 0 ? (
              <span className="text-[var(--soft-foreground)]">内容一致</span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="border-b border-[rgba(15,23,42,0.07)] py-5">
        <p className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">标题</p>
        {diff.title.changed ? (
          <div className="grid gap-3 md:grid-cols-2 md:gap-5">
            <DiffSide label="原标题" paragraph={diff.title.before} tone="before" />
            <DiffSide label="新标题" paragraph={diff.title.after} tone="after" />
          </div>
        ) : (
          <h3 className="text-balance text-xl font-semibold leading-8 text-[var(--foreground)] sm:text-2xl">
            {diff.title.after || '无标题'}
          </h3>
        )}
      </section>

      <div>
        {diff.paragraphs.map((paragraph, index) => {
          if (paragraph.kind === 'modified') {
            return (
              <section
                key={`modified-${paragraph.beforeIndex}-${paragraph.afterIndex}-${index}`}
                className="border-b border-[rgba(15,23,42,0.07)] py-5"
              >
                <div className="grid gap-3 md:grid-cols-2 md:gap-5">
                  <DiffSide
                    label={`原第 ${paragraph.beforeIndex} 段`}
                    paragraph={paragraph.before ?? ''}
                    tone="before"
                  />
                  <DiffSide
                    label={`新第 ${paragraph.afterIndex} 段`}
                    paragraph={paragraph.after ?? ''}
                    tone="after"
                  />
                </div>
              </section>
            )
          }

          if (paragraph.kind === 'removed') {
            return (
              <section
                key={`removed-${paragraph.beforeIndex}-${index}`}
                className="border-b border-[rgba(15,23,42,0.07)] py-5"
              >
                <DiffSide
                  label={`已删除 · 原第 ${paragraph.beforeIndex} 段`}
                  paragraph={paragraph.before ?? ''}
                  tone="before"
                />
              </section>
            )
          }

          if (paragraph.kind === 'added') {
            return (
              <section
                key={`added-${paragraph.afterIndex}-${index}`}
                className="border-b border-[rgba(15,23,42,0.07)] py-5"
              >
                <DiffSide
                  label={`新增 · 新第 ${paragraph.afterIndex} 段`}
                  paragraph={paragraph.after ?? ''}
                  tone="after"
                />
              </section>
            )
          }

          return (
            <section
              key={`unchanged-${paragraph.afterIndex}-${index}`}
              className="border-b border-[rgba(15,23,42,0.055)] py-4"
            >
              <span className="text-[0.7rem] font-medium text-[var(--soft-foreground)]">
                未改 · 第 {paragraph.afterIndex} 段
              </span>
              <p className="mt-1 text-pretty text-sm leading-7 text-[var(--muted-foreground)] sm:text-[0.95rem]">
                {paragraph.after || '（空段落）'}
              </p>
            </section>
          )
        })}
      </div>
    </div>
  )
}
