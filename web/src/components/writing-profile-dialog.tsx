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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  PenLine,
  Sparkles,
  Trash2,
} from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
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

const contentModeLabels: Record<WritingPreference['contentModes'][number], string> = {
  unclassified: '所有场景',
  brand_story: '品牌叙事',
  product_education: '产品说明',
  campaign_interaction: '活动互动',
  event_announcement: '事件通知',
  social_moment: '日常热点',
  other: '其他场景',
}

const statusLabels: Record<WritingPreference['status'], string> = {
  candidate: '待确认',
  active: '已启用',
  disabled: '已停用',
  rejected: '已移除',
}

type PreferenceAction = 'enable' | 'disable' | 'delete' | 'correct'

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
  onClearError: () => void
  onRefresh: () => void
  onAddCorrection: (input: {
    scope: WritingProfileScope
    content: string
  }) => Promise<boolean>
  onManagePreference: (input: {
    scope: WritingProfileScope
    preference: WritingPreference
    action: PreferenceAction
    content?: string
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
    <section className="border-t border-[var(--border)] py-[var(--ui-space-4)] first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-[var(--ui-gap-control)] grid gap-[var(--ui-gap-control)]">
          {items.slice(0, 8).map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-6 text-[var(--muted-foreground)]">
              <span className="mt-[0.62rem] size-1.5 shrink-0 rounded-full bg-[var(--accent-strong)]" />
              <span className="text-pretty">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-[var(--ui-gap-control)] text-sm leading-6 text-[var(--soft-foreground)]">
          {emptyText}
        </p>
      )}
    </section>
  )
}

function PreferenceGroup({
  title,
  description,
  count,
  children,
}: {
  title: string
  description: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="pt-[var(--ui-space-5)] first:pt-0">
      <div className="flex items-start justify-between gap-[var(--ui-gap-block)]">
        <div>
          <h4 className="text-sm font-semibold text-[var(--foreground)]">{title}</h4>
          <p className="mt-[var(--ui-gap-related)] text-xs leading-5 text-[var(--soft-foreground)]">
            {description}
          </p>
        </div>
        <Badge variant="outline" className="tabular-nums">
          {count}
        </Badge>
      </div>
      <div className="mt-[var(--ui-gap-group)] divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {children}
      </div>
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
  onClearError,
  onRefresh,
  onAddCorrection,
  onManagePreference,
}: WritingProfileDialogProps) {
  const [scope, setScope] = React.useState<WritingProfileScope>('account')
  const [corrections, setCorrections] = React.useState<Record<WritingProfileScope, string>>({
    account: '',
    project: '',
  })
  const [saved, setSaved] = React.useState(false)
  const [editingPreferenceId, setEditingPreferenceId] = React.useState('')
  const [editingPreferenceValue, setEditingPreferenceValue] = React.useState('')
  const [pendingPreferenceId, setPendingPreferenceId] = React.useState('')
  const [lastActionPreferenceId, setLastActionPreferenceId] = React.useState('')
  const [preferenceNotice, setPreferenceNotice] = React.useState<{
    preferenceId: string
    text: string
  } | null>(null)
  const [feedbackContext, setFeedbackContext] = React.useState<
    'correction' | 'preference' | null
  >(null)
  const revision = scope === 'account' ? accountProfile : projectProfile
  const profile = revision?.profile ?? null
  const preferences = profile?.preferences ?? []
  const candidatePreferences = preferences.filter((preference) => preference.status === 'candidate')
  const activePreferences = preferences.filter((preference) => preference.status === 'active')
  const disabledPreferences = preferences.filter((preference) => preference.status === 'disabled')
  const removedPreferences = preferences.filter((preference) => preference.status === 'rejected')
  const correction = corrections[scope]

  function resetTransientState() {
    setSaved(false)
    setEditingPreferenceId('')
    setEditingPreferenceValue('')
    setPendingPreferenceId('')
    setLastActionPreferenceId('')
    setPreferenceNotice(null)
    setFeedbackContext(null)
  }

  function handleScopeChange(nextScope: WritingProfileScope) {
    setScope(nextScope)
    resetTransientState()
    if (error) onClearError()
  }

  async function handleSubmit() {
    const content = correction.trim()
    if (!content || isSaving || !canLearn) return

    setSaved(false)
    setFeedbackContext('correction')
    setPreferenceNotice(null)
    const didSave = await onAddCorrection({ scope, content })
    if (!didSave) return

    setCorrections((current) => ({ ...current, [scope]: '' }))
    setSaved(true)
  }

  async function handlePreferenceAction(
    preference: WritingPreference,
    action: PreferenceAction,
  ) {
    const content = action === 'correct' ? editingPreferenceValue.trim() : undefined
    if ((action === 'correct' && !content) || isSaving || !canLearn) return

    setFeedbackContext('preference')
    setPreferenceNotice(null)
    setLastActionPreferenceId(preference.id)
    setPendingPreferenceId(preference.id)
    try {
      const didSave = await onManagePreference({ scope, preference, action, content })
      if (!didSave) return

      setEditingPreferenceId('')
      setEditingPreferenceValue('')
      setPreferenceNotice({
        preferenceId: preference.id,
        text:
          action === 'disable'
            ? '已停用，后续写作不会再使用这条规则。'
            : action === 'delete'
              ? '已移除这条规则。'
              : action === 'correct'
                ? '已按你的修改更新并启用。'
                : preference.status === 'rejected'
                  ? '已恢复并重新启用。'
                  : '已启用，后续写作会参考这条规则。',
      })
    } finally {
      setPendingPreferenceId('')
    }
  }

  function startEditing(preference: WritingPreference) {
    setEditingPreferenceId(preference.id)
    setEditingPreferenceValue(preference.statement)
    setFeedbackContext(null)
    setPreferenceNotice(null)
    if (error) onClearError()
  }

  function cancelEditing() {
    setEditingPreferenceId('')
    setEditingPreferenceValue('')
  }

  function renderPreference(preference: WritingPreference) {
    const isEditing = editingPreferenceId === preference.id
    const isPending = pendingPreferenceId === preference.id
    const actionError =
      feedbackContext === 'preference' &&
      lastActionPreferenceId === preference.id &&
      Boolean(error)
    const modeText =
      preference.contentModes.length > 0
        ? preference.contentModes.map((mode) => contentModeLabels[mode]).join('、')
        : '所有场景'

    return (
      <div
        key={preference.id}
        className={cn(
          'py-[var(--ui-space-4)]',
          (preference.status === 'disabled' || preference.status === 'rejected') && 'opacity-75',
        )}
      >
        <div className="flex flex-col gap-[var(--ui-gap-group)] sm:flex-row sm:items-start sm:justify-between sm:gap-[var(--ui-gap-section)]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[var(--ui-gap-control)]">
              <Badge variant="outline">{dimensionLabels[preference.dimension]}</Badge>
              <span
                className={cn(
                  'inline-flex min-h-6 items-center rounded-full px-2 text-xs font-semibold',
                  preference.status === 'active' && 'bg-[#e8f5ef] text-[#17675b]',
                  preference.status === 'candidate' &&
                    'bg-[rgba(240,122,47,0.1)] text-[#934719]',
                  (preference.status === 'disabled' || preference.status === 'rejected') &&
                    'bg-[var(--surface-muted)] text-[var(--soft-foreground)]',
                )}
              >
                {statusLabels[preference.status]}
              </span>
            </div>

            {isEditing ? (
              <div className="mt-[var(--ui-gap-group)]">
                <Input
                  autoFocus
                  controlSize="sm"
                  maxLength={800}
                  value={editingPreferenceValue}
                  onChange={(event) => setEditingPreferenceValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handlePreferenceAction(preference, 'correct')
                    }
                    if (event.key === 'Escape') cancelEditing()
                  }}
                  aria-label="修改表达规则"
                  aria-describedby={`preference-meta-${preference.id}`}
                  disabled={!canLearn || isSaving}
                />
                <div className="mt-[var(--ui-gap-control)] flex flex-wrap gap-[var(--ui-gap-control)]">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handlePreferenceAction(preference, 'correct')}
                    disabled={!canLearn || !editingPreferenceValue.trim() || isSaving}
                  >
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {isPending ? '正在保存' : '保存并启用'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelEditing}
                    disabled={isSaving}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-[var(--ui-gap-control)] text-pretty text-sm leading-6 text-[var(--foreground)]">
                {preference.statement}
              </p>
            )}

            <p
              id={`preference-meta-${preference.id}`}
              className="mt-[var(--ui-gap-related)] text-xs leading-5 text-[var(--soft-foreground)] tabular-nums"
            >
              {preference.supportCount} 条依据 · {Math.round(preference.confidence * 100)}% 可信度 ·{' '}
              {modeText}
            </p>

            {actionError ? (
              <p className="mt-[var(--ui-gap-control)] text-xs leading-5 text-[var(--destructive)]" role="alert">
                {error}
              </p>
            ) : preferenceNotice?.preferenceId === preference.id ? (
              <p
                className="mt-[var(--ui-gap-control)] flex items-center gap-1.5 text-xs font-medium text-[#17675b]"
                role="status"
              >
                <CheckCircle2 className="size-3.5" />
                {preferenceNotice.text}
              </p>
            ) : null}
          </div>

          {!isEditing ? (
            <div className="flex shrink-0 flex-wrap items-center gap-[var(--ui-gap-control)] sm:justify-end">
              {preference.status === 'candidate' ? (
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => void handlePreferenceAction(preference, 'enable')}
                  disabled={!canLearn || isSaving}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {isPending ? '正在启用' : '确认启用'}
                </Button>
              ) : preference.status === 'disabled' ? (
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => void handlePreferenceAction(preference, 'enable')}
                  disabled={!canLearn || isSaving}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isPending ? '正在启用' : '重新启用'}
                </Button>
              ) : preference.status === 'rejected' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handlePreferenceAction(preference, 'enable')}
                  disabled={!canLearn || isSaving}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isPending ? '正在恢复' : '恢复并启用'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handlePreferenceAction(preference, 'disable')}
                  disabled={!canLearn || isSaving}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isPending ? '正在停用' : '停用'}
                </Button>
              )}

              {preference.status !== 'rejected' && preference.status !== 'disabled' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="修改规则"
                  onClick={() => startEditing(preference)}
                  disabled={!canLearn || isSaving}
                >
                  <PenLine className="size-4" />
                </Button>
              ) : null}

              {preference.status === 'disabled' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="移除规则"
                  onClick={() => void handlePreferenceAction(preference, 'delete')}
                  disabled={!canLearn || isSaving}
                  className="text-[var(--soft-foreground)] hover:text-[var(--destructive)]"
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetTransientState()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <div className="shrink-0 border-b border-[var(--border)] px-[var(--ui-dialog-inset)] pb-[var(--ui-space-5)] pt-[var(--ui-dialog-inset)] pr-14">
          <DialogHeader>
            <div className="flex items-center gap-[var(--ui-gap-control)]">
              <span className="flex size-8 items-center justify-center rounded-[var(--ui-field-radius)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <Sparkles className="size-4" />
              </span>
              <DialogTitle className="text-balance">表达档案</DialogTitle>
            </div>
            <DialogDescription className="text-pretty">
              AI 根据你的素材和修改逐步理解你的写作方式。只有已启用的规则会影响生成。
            </DialogDescription>
          </DialogHeader>

          <div
            className="mt-[var(--ui-space-4)] grid grid-cols-2 gap-1 rounded-[var(--ui-field-radius)] bg-[var(--surface-muted)] p-1"
            role="tablist"
            aria-label="表达档案范围"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={scope === 'account'}
              onClick={() => handleScopeChange('account')}
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
              onClick={() => handleScopeChange('project')}
              className={cn(
                'h-9 min-w-0 focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.12)]',
                scope === 'project' && 'bg-white text-[var(--foreground)] shadow-sm hover:bg-white',
              )}
            >
              <span className="truncate">当前项目</span>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--ui-dialog-inset)] py-[var(--ui-space-5)] [scrollbar-gutter:stable]">
          {error && feedbackContext === null ? (
            <p
              className="mb-[var(--ui-space-4)] rounded-[var(--ui-radius-card)] border border-[rgba(214,90,60,0.16)] bg-[rgba(214,90,60,0.06)] px-3 py-2 text-sm leading-6 text-[var(--destructive)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {isLoading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="size-4 animate-spin" />
              正在读取表达档案
            </div>
          ) : profile ? (
            <div>
              <section className="pb-[var(--ui-space-4)]">
                <div className="flex flex-wrap items-center gap-[var(--ui-gap-control)]">
                  <Badge variant="accent" className="tabular-nums">
                    已启用 {activePreferences.length}
                  </Badge>
                  <Badge variant="outline" className="tabular-nums">
                    待确认 {candidatePreferences.length}
                  </Badge>
                  <span className="text-xs text-[var(--soft-foreground)] tabular-nums">
                    第 {revision?.version ?? 1} 版 · {profile.evidenceCount} 条证据 ·{' '}
                    {scope === 'account' ? '跨项目使用' : `仅用于 ${projectName}`}
                  </span>
                </div>
              </section>

              <section className="border-t border-[var(--border)] pt-[var(--ui-space-5)]">
                <div className="flex items-start justify-between gap-[var(--ui-gap-block)]">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--foreground)]">写作规则</h3>
                    <p className="mt-[var(--ui-gap-related)] text-pretty text-xs leading-5 text-[var(--soft-foreground)]">
                      先确认 AI 的判断，再决定是否用于后续生成和改写。
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--soft-foreground)] tabular-nums">
                    共 {preferences.length} 条
                  </span>
                </div>

                <div className="mt-[var(--ui-space-5)] grid gap-[var(--ui-space-6)]">
                  {candidatePreferences.length > 0 ? (
                    <PreferenceGroup
                      title="待确认"
                      description="AI 的初步判断，确认或修改后才会用于写作。"
                      count={candidatePreferences.length}
                    >
                      {candidatePreferences.map(renderPreference)}
                    </PreferenceGroup>
                  ) : null}

                  <PreferenceGroup
                    title="已启用"
                    description="生成和改写时会参考这些规则。"
                    count={activePreferences.length}
                  >
                    {activePreferences.length > 0 ? (
                      activePreferences.map(renderPreference)
                    ) : (
                      <p className="py-[var(--ui-space-4)] text-sm leading-6 text-[var(--soft-foreground)]">
                        还没有已启用规则。你可以确认上方规则，或在下方直接添加。
                      </p>
                    )}
                  </PreferenceGroup>

                  {disabledPreferences.length > 0 ? (
                    <details className="group border-t border-[var(--border)]">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--muted-foreground)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2">
                          已停用
                          <span className="font-normal text-[var(--soft-foreground)] tabular-nums">
                            {disabledPreferences.length}
                          </span>
                        </span>
                        <ChevronDown className="size-4 group-open:hidden" />
                        <ChevronUp className="hidden size-4 group-open:block" />
                      </summary>
                      <p className="pb-[var(--ui-gap-group)] text-xs leading-5 text-[var(--soft-foreground)]">
                        这些规则暂时不会影响写作，可以重新启用或移除。
                      </p>
                      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                        {disabledPreferences.map(renderPreference)}
                      </div>
                    </details>
                  ) : null}

                  {removedPreferences.length > 0 ? (
                    <details className="group border-t border-[var(--border)]">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--soft-foreground)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2">
                          已移除
                          <span className="font-normal tabular-nums">{removedPreferences.length}</span>
                        </span>
                        <ChevronDown className="size-4 group-open:hidden" />
                        <ChevronUp className="hidden size-4 group-open:block" />
                      </summary>
                      <p className="pb-[var(--ui-gap-group)] text-xs leading-5 text-[var(--soft-foreground)]">
                        这些规则不会影响写作，必要时可以恢复并重新启用。
                      </p>
                      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                        {removedPreferences.map(renderPreference)}
                      </div>
                    </details>
                  ) : null}
                </div>
              </section>

              <details className="group mt-[var(--ui-space-6)] border-t border-[var(--border)]">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--muted-foreground)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
                  <span>查看 AI 的整体理解</span>
                  <ChevronDown className="size-4 group-open:hidden" />
                  <ChevronUp className="hidden size-4 group-open:block" />
                </summary>
                <p className="pb-[var(--ui-space-5)] text-pretty text-sm leading-6 text-[var(--foreground)]">
                  {profile.summary}
                </p>
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
              </details>
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <Sparkles className="size-5 text-[var(--soft-foreground)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                还没有形成{scope === 'account' ? '长期' : '项目'}表达档案
              </p>
              <p className="mt-1 max-w-sm text-pretty text-sm leading-6 text-[var(--muted-foreground)]">
                修改并确认文案后，系统会在下一次生成前整理这些变化。
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setFeedbackContext(null)
                  onRefresh()
                }}
                disabled={!canLearn || isLoading}
              >
                立即整理
              </Button>
            </div>
          )}

          <section className="mt-[var(--ui-space-6)] border-t border-[var(--border)] bg-[var(--surface-muted)] px-[var(--ui-space-4)] py-[var(--ui-space-4)]">
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--ui-gap-control)]">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                直接添加一条{scope === 'account' ? '长期习惯' : '当前项目规则'}
              </h3>
              <p className="text-xs leading-5 text-[var(--soft-foreground)]">
                保存后会直接启用
              </p>
            </div>
            <div className="mt-[var(--ui-gap-group)] flex flex-col gap-[var(--ui-gap-control)] sm:flex-row sm:items-end">
              <Textarea
                value={correction}
                onChange={(event) => {
                  setCorrections((current) => ({ ...current, [scope]: event.target.value }))
                  setSaved(false)
                  if (error) onClearError()
                }}
                disabled={!canLearn || isSaving}
                className="min-h-16 flex-1 resize-none bg-white"
                aria-label={`直接添加一条${scope === 'account' ? '长期习惯' : '当前项目规则'}`}
                placeholder="例如：结尾写到具体感受就停，不要突然升华"
              />
              <Button
                type="button"
                className="shrink-0"
                onClick={() => void handleSubmit()}
                disabled={!canLearn || !correction.trim() || isSaving}
              >
                {isSaving && feedbackContext === 'correction' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {isSaving && feedbackContext === 'correction' ? '正在保存' : '添加并启用'}
              </Button>
            </div>
            {error && feedbackContext === 'correction' ? (
              <p className="mt-2 text-xs leading-5 text-[var(--destructive)]" role="alert">
                {error}
              </p>
            ) : saved ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#17675b]" role="status">
                <CheckCircle2 className="size-3.5" />
                已添加并启用这条规则
              </p>
            ) : !canLearn ? (
              <p className="mt-2 text-xs leading-5 text-[var(--soft-foreground)]">
                登录后才能保存和管理表达规则。
              </p>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
