import * as React from 'react'
import type {
  WritingPreference,
  WritingProfileRevisionDto,
  WritingProfileScope,
} from '@lumos-ai/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckCircle2, Loader2, Sparkles } from '@/components/ui/icon'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const dimensionLabels: Record<WritingPreference['dimension'], string> = {
  content_selection: '选材',
  viewpoint: '观点',
  structure: '结构',
  opening: '开头',
  progression: '推进',
  ending: '结尾',
  tone: '语气',
  vocabulary: '用词',
  sentence_rhythm: '句式节奏',
  reader_relationship: '读者关系',
  emotional_expression: '情感倾向',
  persuasion: '说服方式',
  forbidden_pattern: '禁用表达',
}

type WritingProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountProfile: WritingProfileRevisionDto | null
  projectProfile: WritingProfileRevisionDto | null
  projectName: string
  canLearn: boolean
  isLoading: boolean
  isSaving: boolean
  error: string
  onRefresh: () => void
  onAddCorrection: (input: {
    scope: WritingProfileScope
    content: string
  }) => Promise<boolean>
}

function ProfileList({
  title,
  items,
  emptyText,
}: {
  title: string
  items: string[]
  emptyText: string
}) {
  return (
    <section className="border-t border-[var(--border)] py-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-2 grid gap-2">
          {items.slice(0, 8).map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-6 text-[var(--muted-foreground)]">
              <span className="mt-[0.62rem] size-1.5 shrink-0 rounded-full bg-[var(--accent-strong)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[var(--soft-foreground)]">{emptyText}</p>
      )}
    </section>
  )
}

export function WritingProfileDialog({
  open,
  onOpenChange,
  accountProfile,
  projectProfile,
  projectName,
  canLearn,
  isLoading,
  isSaving,
  error,
  onRefresh,
  onAddCorrection,
}: WritingProfileDialogProps) {
  const [scope, setScope] = React.useState<WritingProfileScope>('account')
  const [correction, setCorrection] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const revision = scope === 'account' ? accountProfile : projectProfile
  const profile = revision?.profile ?? null

  async function handleSubmit() {
    const content = correction.trim()
    if (!content || isSaving) return

    const didSave = await onAddCorrection({ scope, content })
    if (!didSave) return

    setCorrection('')
    setSaved(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setSaved(false)
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <div className="shrink-0 border-b border-[var(--border)] px-6 pb-5 pt-6 pr-14">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-[var(--ui-field-radius)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <DialogTitle>表达档案</DialogTitle>
            </div>
            <DialogDescription>
              系统从你保留、改写和明确纠正的内容中学习。单次修改只作为候选，多次一致后才会成为稳定习惯。
            </DialogDescription>
          </DialogHeader>

          <div
            className="mt-4 grid grid-cols-2 gap-1 rounded-[var(--ui-field-radius)] bg-[var(--surface-muted)] p-1"
            role="tablist"
            aria-label="表达档案范围"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={scope === 'account'}
              onClick={() => {
                setScope('account')
                setSaved(false)
              }}
              className={cn(
                'h-9 focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.12)]',
                scope === 'account' && 'bg-white text-[var(--foreground)] shadow-sm hover:bg-white',
              )}
            >
              长期习惯
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={scope === 'project'}
              onClick={() => {
                setScope('project')
                setSaved(false)
              }}
              className={cn(
                'h-9 min-w-0 focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.12)]',
                scope === 'project' && 'bg-white text-[var(--foreground)] shadow-sm hover:bg-white',
              )}
            >
              <span className="truncate">当前项目</span>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
          {isLoading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取表达档案
            </div>
          ) : profile ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 pb-4">
                <Badge variant="accent">第 {revision?.version ?? 1} 版</Badge>
                <Badge variant="outline">{profile.evidenceCount} 条证据</Badge>
                <span className="text-xs text-[var(--soft-foreground)]">
                  {scope === 'account' ? '跨项目使用' : `仅用于 ${projectName}`}
                </span>
              </div>
              <p className="pb-5 text-sm leading-6 text-[var(--foreground)]">{profile.summary}</p>
              <ProfileList
                title="更像你的表达"
                items={Array.from(new Set([...profile.mustKeep, ...profile.voicePatterns]))}
                emptyText="还没有形成稳定的表达倾向"
              />
              <ProfileList
                title="明确避开"
                items={profile.mustAvoid}
                emptyText="还没有记录明确禁忌"
              />

              <section className="border-t border-[var(--border)] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">学习中的规则</h3>
                  <span className="text-xs text-[var(--soft-foreground)]">
                    {profile.preferences.length} 条
                  </span>
                </div>
                <div className="mt-3 grid gap-3">
                  {profile.preferences.slice(0, 12).map((preference) => (
                    <div key={preference.id} className="border-l-2 border-[var(--border)] pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{dimensionLabels[preference.dimension]}</Badge>
                        <span className="text-xs text-[var(--soft-foreground)]">
                          {preference.supportCount} 条依据 · {Math.round(preference.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-[var(--foreground)]">
                        {preference.statement}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <Sparkles className="h-5 w-5 text-[var(--soft-foreground)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                还没有形成{scope === 'account' ? '长期' : '项目'}表达档案
              </p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                修改并确认文案后，系统会在下一次生成前整理这些变化。
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={onRefresh}
                disabled={!canLearn || isLoading}
              >
                立即整理
              </Button>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-muted)] px-6 py-5">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">
              主动告诉 AI 一条{scope === 'account' ? '长期习惯' : '当前项目规则'}
            </span>
            <Textarea
              value={correction}
              onChange={(event) => {
                setCorrection(event.target.value)
                setSaved(false)
              }}
              disabled={!canLearn || isSaving}
              className="min-h-20 resize-none bg-white"
              placeholder="例如：不要用“不仅……更……”；结尾写到具体感受就停，不要突然升华"
            />
          </label>
          {error ? (
            <p className="mt-2 text-xs leading-5 text-[var(--destructive)]" role="alert">
              {error}
            </p>
          ) : saved ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#17675b]" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已记录并更新表达档案
            </p>
          ) : null}
          <DialogFooter className="mt-4">
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canLearn || !correction.trim() || isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isSaving ? '正在学习' : '记住这条规则'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
