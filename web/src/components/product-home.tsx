import type { ReactNode } from 'react'
import workspacePreview from '@/assets/writer-workspace-preview.jpg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FolderOpen,
  Highlighter,
  Home,
  PenLine,
  Plus,
  Search,
  Sparkles,
  WandSparkles,
} from '@/components/ui/icon'

type ProductHomeMode = 'guest' | 'member'

type RecentProjectSummary = {
  name: string
  stage: string
  updatedAt: string
}

type ProductHomeProps = {
  mode: ProductHomeMode
  authSlot: ReactNode
  saveStatusSlot?: ReactNode
  displayName?: string
  projectCount: number
  noteCount: number
  snippetCount: number
  recentProject?: RecentProjectSummary
  projectSearch: string
  projectList: ReactNode
  onProjectSearchChange: (value: string) => void
  onCreateProject: () => void
  onOpenLibrary: () => void
  onOpenWritingProfile: () => void
  onOpenRecentProject: () => void
}

const productFlow = [
  {
    index: '01',
    title: '采集',
    description: '在小红书笔记页保存原文，并圈选真正打动你的表达。',
    icon: Highlighter,
  },
  {
    index: '02',
    title: '整理',
    description: '文案、文件夹、标签与标注在文案库里集中管理。',
    icon: FolderOpen,
  },
  {
    index: '03',
    title: '学习',
    description: '从遣词、句式和情绪倾向中形成可核验的表达偏好。',
    icon: Sparkles,
  },
  {
    index: '04',
    title: '写作',
    description: '带着本次参考与长期偏好生成，再从你的修改中继续学习。',
    icon: PenLine,
  },
]

function BrandMark() {
  return (
    <span className="flex items-center gap-2.5" aria-label="Lumos AI Writer">
      <span className="flex size-8 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--foreground)] text-white shadow-[var(--shadow-soft)]">
        <WandSparkles className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-[0] text-[var(--foreground)]">
        Lumos AI Writer
      </span>
    </span>
  )
}

function ProductHeader({ authSlot, member = false }: { authSlot: ReactNode; member?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(248,250,252,0.92)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-[var(--ui-page-gutter)]">
        <BrandMark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="首页导航">
          <a
            href="#top"
            className="rounded-[var(--ui-radius-control)] px-3 py-2 text-sm font-medium tracking-[0] text-[var(--foreground)] transition hover:bg-white/76 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          >
            首页
          </a>
          <a
            href={member ? '#projects' : '#capabilities'}
            className="rounded-[var(--ui-radius-control)] px-3 py-2 text-sm font-medium tracking-[0] text-[var(--muted-foreground)] transition hover:bg-white/76 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          >
            {member ? '我的项目' : '产品能力'}
          </a>
          <a
            href="#product-flow"
            className="rounded-[var(--ui-radius-control)] px-3 py-2 text-sm font-medium tracking-[0] text-[var(--muted-foreground)] transition hover:bg-white/76 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          >
            使用方法
          </a>
        </nav>
        <div className="flex shrink-0 items-center">{authSlot}</div>
      </div>
    </header>
  )
}

function ProductFlow({ compact = false }: { compact?: boolean }) {
  return (
    <section
      id="product-flow"
      className={
        compact
          ? 'border-y border-[var(--border)] bg-[rgba(248,250,252,0.7)]'
          : 'border-y border-[var(--border)] bg-[#f8fafc]'
      }
      aria-labelledby="product-flow-title"
    >
      <div className="mx-auto w-full max-w-7xl px-[var(--ui-page-gutter)] py-8 md:py-14">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0] text-[var(--accent)]">从素材到成稿</p>
            <h2
              id="product-flow-title"
              className="mt-2 text-2xl font-semibold tracking-[0] text-[var(--foreground)]"
            >
              一条闭环，越写越懂你
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 tracking-[0] text-[var(--muted-foreground)]">
            每一步都保留来源：参考了什么、学到了什么、最终又被你改成了什么。
          </p>
        </div>

        <ol className="grid border-t border-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          {productFlow.map((item) => {
            const Icon = item.icon
            return (
              <li
                key={item.index}
                className="group border-b border-[var(--border)] px-0 py-5 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-[var(--soft-foreground)]">{item.index}</span>
                  <span className="flex size-8 items-center justify-center rounded-[var(--ui-radius-control)] bg-white text-[var(--accent-strong)] shadow-[var(--shadow-muted)] transition group-hover:-translate-y-0.5">
                    <Icon className="size-4" />
                  </span>
                </div>
                <h3 className="mt-5 text-base font-semibold tracking-[0] text-[var(--foreground)]">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 tracking-[0] text-[var(--muted-foreground)]">
                  {item.description}
                </p>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

function GuestHome({
  authSlot,
  onCreateProject,
  onOpenLibrary,
}: Pick<ProductHomeProps, 'authSlot' | 'onCreateProject' | 'onOpenLibrary'>) {
  return (
    <main id="top" className="min-h-[100dvh] bg-[#f8fafc]">
      <ProductHeader authSlot={authSlot} />

      <section
        className="relative flex min-h-[calc(100dvh-10rem)] items-center overflow-hidden border-b border-[var(--border)] bg-[#e8edf1]"
        aria-labelledby="landing-title"
      >
        <img
          src={workspacePreview}
          alt="Lumos AI Writer 写作工作台界面"
          className="absolute inset-0 size-full object-cover object-center opacity-90"
        />
        <div className="absolute inset-0 bg-[rgba(245,247,249,0.28)]" aria-hidden="true" />
        <div
          className="absolute inset-y-0 left-0 w-full bg-[rgba(248,250,252,0.86)] md:w-[62%]"
          aria-hidden="true"
        />
        <div className="relative mx-auto w-full max-w-7xl px-[var(--ui-page-gutter)] py-8 sm:py-12 md:py-16">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0] text-[var(--accent-strong)]">
              <span className="size-1.5 rounded-full bg-[var(--accent)]" />
              为长期写作建立可用的表达记忆
            </p>
            <h1
              id="landing-title"
              className="mt-4 text-4xl font-semibold leading-[1.08] tracking-[0] text-[var(--foreground)] md:mt-5 md:text-5xl"
            >
              Lumos AI Writer
            </h1>
            <p className="mt-3 max-w-xl text-lg font-medium leading-7 tracking-[0] text-[var(--foreground)] sm:mt-5 sm:text-xl sm:leading-8 md:text-2xl md:leading-9">
              把你喜欢的文案，变成 AI 真正能用的表达能力
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 tracking-[0] text-[var(--muted-foreground)] sm:mt-4 sm:text-base sm:leading-7">
              从浏览器插件采集、文案标注，到表达偏好沉淀与完整写作，所有依据都在同一条工作流里。
            </p>
            <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
              <Button size="xl" onClick={onCreateProject}>
                <Plus className="size-4" />
                开始写作
              </Button>
              <Button size="xl" variant="secondary" onClick={onOpenLibrary}>
                <FolderOpen className="size-4" />
                查看演示文案库
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm tracking-[0] text-[var(--muted-foreground)] sm:mt-8">
              <span>来源可追溯</span>
              <span>偏好可管理</span>
              <span>修改可学习</span>
            </div>
          </div>
        </div>
      </section>

      <ProductFlow />

      <section id="capabilities" className="bg-white" aria-labelledby="capabilities-title">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-[var(--ui-page-gutter)] py-16 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:py-24">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs font-semibold tracking-[0] text-[var(--accent)]">四个入口，一个系统</p>
            <h2
              id="capabilities-title"
              className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-[0] text-[var(--foreground)]"
            >
              从看到好句子，到写出自己的文案
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 tracking-[0] text-[var(--muted-foreground)]">
              插件负责捕捉，文案库负责整理，表达档案负责沉淀，写作台负责把这些依据真正用起来。
            </p>
          </div>

          <div className="border-t border-[var(--border)]">
            {[
              ['浏览器插件', '在原笔记上下文里采集标题、正文、作者、封面与高亮片段。'],
              ['文案库', '按文件夹和标签管理素材，随时校正原文与标注。'],
              ['表达档案', '只记录有证据的偏好、禁忌与常用表达，并允许你管理。'],
              ['AI 写作台', '先确认需求与参考，再生成、局部修改、读者预演和定稿。'],
            ].map(([title, description], index) => (
              <article
                key={title}
                className="grid gap-3 border-b border-[var(--border)] py-6 sm:grid-cols-[3rem_10rem_minmax(0,1fr)] sm:items-start"
              >
                <span className="font-mono text-xs text-[var(--soft-foreground)]">0{index + 1}</span>
                <h3 className="text-base font-semibold tracking-[0] text-[var(--foreground)]">
                  {title}
                </h3>
                <p className="text-sm leading-6 tracking-[0] text-[var(--muted-foreground)]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[#f0f3f5]">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-6 px-[var(--ui-page-gutter)] py-12 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-[0] text-[var(--foreground)]">
              从下一篇文案开始，让修改真正留下来
            </h2>
            <p className="mt-2 text-sm leading-6 tracking-[0] text-[var(--muted-foreground)]">
              未登录也可以体验写作流程，登录后项目、素材和表达档案会持续同步。
            </p>
          </div>
          <Button size="xl" onClick={onCreateProject}>
            <Plus className="size-4" />
            新建写作项目
          </Button>
        </div>
      </section>
    </main>
  )
}

function MemberHome(props: ProductHomeProps) {
  const {
    authSlot,
    saveStatusSlot,
    displayName,
    projectCount,
    noteCount,
    snippetCount,
    recentProject,
    projectSearch,
    projectList,
    onProjectSearchChange,
    onCreateProject,
    onOpenLibrary,
    onOpenWritingProfile,
    onOpenRecentProject,
  } = props

  return (
    <main id="top" className="min-h-[100dvh] bg-[#f6f7f9]">
      <ProductHeader authSlot={authSlot} member />

      <section className="border-b border-[var(--border)] bg-[#eef1f4]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-[var(--ui-page-gutter)] py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-12">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium tracking-[0] text-[var(--muted-foreground)]">
                欢迎回来{displayName ? `，${displayName}` : ''}
              </p>
              {saveStatusSlot}
            </div>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[0] text-[var(--foreground)] md:text-4xl">
              {recentProject ? '继续把这篇文案写完' : '开始建立你的表达系统'}
            </h1>
            {recentProject ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm tracking-[0] text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">{recentProject.name}</span>
                <span>{recentProject.stage}</span>
                <span>{recentProject.updatedAt}</span>
              </div>
            ) : (
              <p className="mt-4 max-w-2xl text-base leading-7 tracking-[0] text-[var(--muted-foreground)]">
                新建第一个项目，选择参考文案后，Lumos 会从需求到定稿保留完整依据。
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {recentProject ? (
              <Button size="xl" onClick={onOpenRecentProject}>
                <PenLine className="size-4" />
                继续写作
              </Button>
            ) : null}
            <Button size="xl" variant={recentProject ? 'secondary' : 'default'} onClick={onCreateProject}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-white" aria-label="工作台概览">
        <div className="mx-auto grid w-full max-w-7xl sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(8rem,0.6fr))_minmax(24rem,1.8fr)]">
          {[
            ['写作项目', projectCount],
            ['文案素材', noteCount],
            ['高亮片段', snippetCount],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-end justify-between border-b border-[var(--border)] px-[var(--ui-page-gutter)] py-5 sm:border-b-0 sm:border-r lg:px-6"
            >
              <span className="text-sm tracking-[0] text-[var(--muted-foreground)]">{label}</span>
              <strong className="font-mono text-xl font-semibold text-[var(--foreground)]">{value}</strong>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 px-[var(--ui-page-gutter)] py-4 sm:col-span-3 lg:col-span-1 lg:grid-cols-3 lg:px-6">
            <Button variant="ghost" className="justify-start" onClick={onOpenLibrary}>
              <FolderOpen className="size-4" />
              文案库
            </Button>
            <Button variant="ghost" className="justify-start" onClick={onOpenWritingProfile}>
              <Sparkles className="size-4" />
              表达档案
            </Button>
            <a
              href="#product-flow"
              className="inline-flex h-[var(--ui-control-height-md)] items-center justify-start gap-2 rounded-[var(--ui-field-radius)] px-4 text-sm font-semibold tracking-[0] text-[var(--muted-foreground)] transition hover:bg-white hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
            >
              <Home className="size-4" />
              使用方法
            </a>
          </div>
        </div>
      </section>

      <section id="projects" className="mx-auto w-full max-w-7xl px-[var(--ui-page-gutter)] py-10">
        <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0] text-[var(--accent)]">工作台</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[0] text-[var(--foreground)]">
              我的项目
            </h2>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--soft-foreground)]" />
              <Input
                value={projectSearch}
                onChange={(event) => onProjectSearchChange(event.target.value)}
                placeholder="搜索项目或参考文件夹"
                aria-label="搜索项目或参考文件夹"
                className="bg-white pl-10 shadow-none"
              />
            </div>
            <Button onClick={onCreateProject}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </div>
        </div>
        {projectList}
      </section>

      <ProductFlow compact />
    </main>
  )
}

export function ProductHome(props: ProductHomeProps) {
  if (props.mode === 'guest') {
    return (
      <GuestHome
        authSlot={props.authSlot}
        onCreateProject={props.onCreateProject}
        onOpenLibrary={props.onOpenLibrary}
      />
    )
  }

  return <MemberHome {...props} />
}

export type { ProductHomeProps, RecentProjectSummary }
