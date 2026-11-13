# Nest 组织形式 v2：工作单元、两种颗粒度、Feature 回归

状态：已实现，0.7.0。D1 至 D5 于 2026-11-13 确认，按第 7 节分三波执行，执行记录见第 10 节。基线：`feat/nest-workspaces` @ `8d6fe2e`（0.6.0）。
这里说的 Conductor 一律指 bb 的 Conductor 布局插件（`bb-conductor-src/plugins/conductor`），不是 conductor.build 桌面应用。

## 0. 结论

模式只改变会话画在哪，不改变东西归谁。

两种模式共用一副侧边栏骨架：Pinned → Features → 分组与项目 → Personal → 搁架。

- **Workspaces 模式**：侧边栏画到工作区为止，不画会话。会话在线程头部的 Tab 栏里，头部标题是 `项目 › 工作区` 面包屑。这是 Conductor 插件的形态，补上它的短处。
- **Threads 模式**：侧边栏画到线程家族，头部完全交回 bb，不显示 Tab 和面包屑。这是原来的 Nest。

Feature 回到一等公民。它不是第三个模式，而是两种模式里都在顶部的一个区块：Workspaces 模式下展开到成员工作区，Threads 模式下展开到会话和成员工作区。

## 1. 之前怎么定的，哪里走偏了

| 阶段 | 你的输入 | 我的处理 | 问题 |
| --- | --- | --- | --- |
| 计划 v1 | 两种模式选「线程 ↔ 工作区」 | 两个模式都画线程，只换分组轴（归属树 vs 磁盘树） | 把「颗粒度」做成了「分组方式」 |
| 计划 v2 | 「功能视图感觉还是一等公民，再想想怎么处置」 | 读成「太一等公民，要降级」 | 这句有两种读法，我没确认 |
| 计划 v3 | 无 | 我建议把 Feature 溶解成 workspace 容器 | 只是建议，不是你的决定 |
| 执行 | 「commit 然后完整执行计划」 | 当成对 v3 全部内容的放行 | 删了功能视图、选择器、隐藏列表 |

0.6.0 的实际表现：

- 两个模式的侧边栏都画线程家族（`components/inbox/workspace-row.tsx` 的 `visibleFamilies.map`）。
- Tab 栏和面包屑无条件注册，Threads 模式下也出现。
- 独立功能视图、功能选择器、隐藏列表已删除；Features 容器项目改为可见。
- Tab 栏上有一键「归档整个工作区」按钮，没有确认。
- 关闭 Tab 直接 archive，不进 Nest 的 Settled 搁架。
- 每个线程 pane 的头部各自拉一次 `listWorkspacePaths`、`listRepoFacts`、`listFeatures`。
- 为了避开 Conductor 的第二条 Tab 栏，挂了一个监听整个 `body` 子树的 `MutationObserver`。

## 2. 真实数据

2026-11-13 从本机 bb 读取（`bb environment list --json`、`bb thread list --json --include-hidden`）。

- 138 个 environment，416 个未归档线程（含隐藏）。
- 存活的 environment：personal 88，worktree 22，checkout 或普通目录 28。
- 每个 environment 的可见顶层会话数：

| 类型 | 1 | 2-3 | 4-6 | 7-12 | 13+ |
| --- | --- | --- | --- | --- | --- |
| worktree | 8 | 3 | 2 | 2 | 2 |
| checkout / 目录 | 4 | 8 | 4 | 3 | 5 |
| personal | 84 | 1 | 1 | 0 | 1 |

- 单个 environment 最多 44 个会话（一个功能根目录）；主 checkout 有 29、16、16、15、13 个。
- 子线程 38 个，隐藏线程 12 个，没有 environment 的线程 0 个。

三个推论：

1. 9 个 environment 超过 13 个会话。Conductor 的「全部会话平铺成 Tab、旧的在前」在这里失效，最新的会话被挤到最右。
2. 主 checkout 和 Personal 是大厅，worktree 和功能目录才是「一件事」。两者在 Tab 栏上的负载完全不同。
3. personal environment 基本一会话一个。把它画成工作区行时应该用会话标题命名，而不是目录名。

## 3. 好的组织形式：六条原则

1. **一行一个工作单元。** 工作单元是 Feature（跨仓）、Worktree（单仓任务）、Checkout（项目大厅）、Personal 会话。会话在工作单元之内。
2. **模式只改变颗粒度，不改变归属。** 两个模式分组完全相同，差别只在会话画在侧边栏还是头部。
3. **一件事一个入口。** 同一个 worktree 不在两个区块重复出现。
4. **位置稳定，状态上浮。** 行不因活动而移动；Failed / Needs you / Working / Unread 逐级汇总，一次点击直达需要你的会话。
5. **推导，不登记。** 工作区、成员、归属都从 bb 的线程、environment 和磁盘事实推出。Nest 只存用户的决定：分组、功能、顺序、搁架。
6. **动作就近，丢东西的动作要确认。**

## 4. Conductor 插件：取长补短

### 4.1 直接沿用

| Conductor 的做法 | 源文件 | Nest 里的位置 |
| --- | --- | --- |
| workspace = environment，纯推导，零存储 | `app/sidebar/model.ts` | `lib/workspace-index.ts`，并补上路径身份 |
| 行上的事实：PR 状态、+/− 行数、会话数 | `app/sidebar/WorkspaceSidebar.tsx` | Workspaces 模式的工作区行 |
| 点击行回到上次活跃会话 | `app/sidebar/prefs.ts` | 工作区行的点击目标 |
| 头部 Tab 栏列出同一 environment 的会话 | `app/tabs/WorkspaceTabs.tsx` | Workspaces 模式头部 |
| 关闭当前 Tab 先跳邻居 | `app/tabs/model.ts` | 沿用 |
| `+` 打开绑定工作区的新会话页，可插入其他会话的 transcript | `app/new-chat/NewChatPage.tsx` | 已移植 |
| `项目 › 工作区` 面包屑 | `app/header/WorkspaceBreadcrumb.tsx` | 已移植，末段改成切换器 |
| Run 读 `.conductor/settings.toml` | `app/scripts/run.ts` | 已移植 |
| Changes 打开 Git diff Tab | `app/tabs/WorkspaceTabs.tsx` | 已移植 |
| Fork to new workspace | `app/fork.ts` | 已移植 |

### 4.2 补上的短处

| Conductor 的短处 | 后果 | Nest 的补法 |
| --- | --- | --- |
| 17 个项目平铺，没有分组 | 列表很长 | 保留分组标签页 All / IM / IOT / Ot / My，并加 Features |
| 工作区行用第一个会话的标题命名 | 主 checkout 被一个旧会话命名 | 别名 → 分支 → 目录；Personal 用会话标题；功能根用功能名 |
| Tab 全量平铺、旧的在前 | 9 个 environment 超过 13 个会话 | 稳定顺序，激活 Tab 滚入可视区，加「全部 (N)」下拉，含状态与搜索 |
| 状态只有 working / waiting，且行上只看第一个会话 | 后台会话失败不可见 | Nest 的家族状态汇总，行和 Tab 都显示 Failed / Needs you / Working / Unread |
| 没有子线程概念 | 38 个子线程没有位置 | Tab 上显示子线程数，上下文行的父子 chips 负责跳转 |
| 关闭 Tab = 归档 | 误关后侧边栏里找不回 | 关闭 = Nest Settle，进 Settled 搁架，可撤回 |
| 没有 Snooze / Settle | 无 | 沿用 Nest 生命周期 |
| 同一目录多条 environment 记录画成两行 | 重复 | WorkspaceIndex 合并 |
| 没有跨仓 | 多仓需求散落在各项目 | Features 区块 |
| Archive workspace 只归档会话 | worktree 残留在磁盘 | 菜单里分开「归档全部会话」和「移除 worktree（安全检查）」 |
| checkout 与 worktree 一视同仁，按创建时间倒序 | checkout 位置漂移 | checkout 领头，worktree 用 Nest 的手动顺序与排序视角 |

## 5. 目标设计

### 5.1 一个模型

```ts
type WorkUnit =
  | { kind: "feature"; feature: Feature; root: Workspace | null; members: Workspace[] }
  | { kind: "worktree"; workspace: Workspace }
  | { kind: "checkout"; workspace: Workspace }
  | { kind: "personal"; workspace: Workspace; title: string };
```

不新增表。由 `WorkspaceIndex`（已有）和 Feature 表（已有）推导。会话属于某个工作单元里的某个 environment。

### 5.2 两个模式

| | Workspaces | Threads |
| --- | --- | --- |
| 侧边栏最细到 | 工作区行 | 线程家族 |
| 会话入口 | 头部 Tab 栏 | 侧边栏 |
| 头部 | 面包屑 + Tab 栏 | bb 原样 |
| 分组 | 相同 | 相同 |
| Feature | 顶部区块，展开到成员工作区 | 顶部区块，展开到会话与成员工作区 |
| 适合 | worktree 驱动、并行推进多件事 | 会话驱动、以对话为主 |

机器视角留在 View 菜单的「分组方式：分组 / 机器」，两个模式通用。

### 5.3 侧边栏骨架

```text
[All] [Features] [IM] [IOT] [Ot] [My]          ⚙
PINNED
FEATURES                                    +  ⌕
  ▾ 功能 A …
IM
  ▾ tea-app-im …
IOT …
PERSONAL（默认折叠，按最近活动，分页）
SNOOZED · SETTLED · FINISHED
[ Workspaces | Threads ]
```

- 分组标签页增加 Features，只看功能。
- 选 IM 时，Features 区块只显示有 IM 成员仓库的功能。这是从成员项目的分组推出来的，不存储，也不改变「功能不归入分组」的旧决定。

### 5.4 工作区行（Workspaces 模式）

| 部位 | 规则 |
| --- | --- |
| 图标 | 家族状态汇总优先（Failed > Needs you > Working > Unread），其次 PR 状态，最后类型图标（checkout / worktree / 功能根 / personal） |
| 标签 | 别名 → 分支 → 目录名；功能根用功能名；Personal 用会话标题 |
| 尾部 | 会话数（大于 1 时）、+/− 行数、未读点 |
| 悬停 | `+` 新会话、`⋯` 菜单 |
| 点击 | 有需要你的会话就打开它，否则打开上次活跃会话，再否则打开最早的顶层会话 |
| 菜单 | 重命名、新会话、复制路径、在 Finder 打开、归档全部会话（undo）、移除 worktree（安全检查）、归入功能 / 移出 |
| 顺序 | checkout 领头；worktree 用 Nest 手动顺序与排序视角；没有会话的工作区仍然显示 |

项目行：展开、计数、`+` 新 worktree 或新会话。功能成员不在项目下重复，项目下显示一行「↗ 2 个在功能里」，点一下定位到功能。

### 5.5 Features 区块

| 部位 | 规则 |
| --- | --- |
| 功能行 | 功能名、仓库数、状态汇总、PR 汇总；`+` 在功能根目录新会话；`⋯` 仓库、笔记与决策、重命名、完成、删除 |
| Workspaces 展开 | 功能根行（根目录会话所在）+ 每个成员工作区行 |
| Threads 展开 | 根目录会话平铺 + 成员工作区行，成员行可再展开到会话 |
| 选择器 | 区块头的 `⌕`，逐个勾选显示；新功能默认显示 |
| 完成 | 进底部 Finished 搁架 |
| 容器项目 | Features 容器项目恢复隐藏，避免第二个入口 |

### 5.6 头部（只在 Workspaces 模式）

面包屑：`项目 › 工作区 ▾`；功能内为 `功能 › 仓库 ▾`。末段是切换器，列出同项目或同功能的其他工作区。

Tab 栏：

- 一个 Tab 是一个可见顶层会话；当前打开的子线程或侧聊也临时成为 Tab。
- 顺序稳定，旧的在前；激活 Tab 自动滚入可视区。
- 状态点用 Nest 家族状态；有子线程时显示小计数。
- 关闭 = Settle；关闭当前 Tab 时先跳邻居再 Settle。
- 尾部：「全部 (N)」下拉（搜索、状态、Settle / Snooze）、Changes +/−、Run、`⋯`（归档全部会话、移除 worktree、复制路径）。
- 新会话页显示一个 Untitled Tab。

Threads 模式下，头部行返回 null，标题组件渲染 bb 自己的 `ThreadTitle`。

### 5.7 数据

- 不新增表。
- view state 新增 `lastActiveByWorkspace`（localStorage，与 Conductor 相同）；恢复 `hiddenFeatureIds`。
- 新增派生：WorkUnit、功能所属分组（成员项目分组的并集）、工作区行的点击目标。
- 共享索引：侧边栏构建 `WorkspaceIndex` 后写入模块级 store，头部和新会话页读它。侧边栏没挂载时（用户选了 bb 原生列表），头部用 `useSidebarThreads` 按 `environment.id` 轻量推导，和 Conductor 一样，不再每个 pane 拉三次 RPC。

## 6. 对 0.6.0 分支的处置

| 提交 | 处置 |
| --- | --- |
| `d06004d` SDK 0.6.141 | 保留 |
| `358f4bb` WorkspaceIndex | 保留 |
| `440537f` 两态开关 | 修：Workspaces 模式不再画会话；Features 容器项目恢复隐藏 |
| `7430663` 头部 Tab | 修：按模式门控；家族状态；关闭改 Settle；溢出下拉；面包屑切换器 |
| `3db62c0` 新会话 / Run / Fork | 保留实现；一键归档按钮移进 `⋯` 菜单 |
| `8d6fe2e` 清理 | 修：从 `3db62c0` 恢复 `lib/feature-view.ts`、`components/inbox/feature-node.tsx`、`feature-tree-panel.tsx`、`feature-selector.tsx`、`hooks/use-feature-selector.tsx` 并改成区块；删除 `MutationObserver` |

## 7. 分阶段

| 阶段 | 内容 | 主要文件 | 验证 | 预估 |
| --- | --- | --- | --- | --- |
| P0 止血 | 头部按模式门控；去掉一键归档和 `MutationObserver` | `components/header/*` | Threads 模式头部与 bb 原生一致；单测 | 0.5 天 |
| P1 共享索引 | 模块级 WorkspaceIndex 与 sidebarMode store；头部与新会话页改读它；无侧边栏时轻量推导；`lastActiveByWorkspace` store | `lib/workspace-index-store.ts`、`lib/last-active.ts`、`hooks/use-workspace-index.ts` | 打开 5 个 pane，RPC 次数不随 pane 增长 | 0.5 天 |
| P2 Features 区块 | 恢复功能视图文件并改成区块；两模式各自的展开；选择器；Features 标签页；分组推导；Features 容器项目恢复隐藏 | `lib/feature-view.ts`、`components/inbox/feature-*` | 功能在两个模式都可见；选 IM 时只显示含 IM 仓库的功能 | 1.5 天 |
| P3 Workspaces 侧边栏 | 新的工作区行组件；点击目标；项目下「↗ N 个在功能里」；Personal 区块分页 | `components/inbox/workspace-card.tsx`、`lib/workspace-view.ts` | 侧边栏无会话行；点击直达需要你的会话 | 1.5 天 |
| P4 Tab 栏 v2 | 家族状态、子线程计数、关闭 = Settle、滚入可视区、「全部 (N)」、`⋯` 菜单、Untitled Tab、面包屑切换器 | `components/header/*`、`lib/workspace-tabs.ts` | 44 个会话的功能根目录可用；关闭后出现在 Settled | 1.5 天 |
| P5 收尾 | README、计划文档、0.7.0、源码约束测试 | `README.md`、`docs/*`、`package.json` | `npm run check` 全绿；两模式截图评审 | 0.5 天 |

### 执行方式

| 波次 | 线程 | 范围 | 文件边界 |
| --- | --- | --- | --- |
| 第一波 | A | P0 + P1 | `components/header/**`、`hooks/use-workspace-index.ts`、`lib/workspace-index-store.ts`、`lib/last-active.ts`、`hooks/use-inbox-tree-model.ts`（只加发布）、对应测试 |
| 第二波 | B | P2 + P3 | `lib/inbox-view.ts`、`lib/workspace-view.ts`、`lib/feature-view.ts`、`lib/view-state.ts`、`components/inbox/**`、`hooks/use-inbox-*`、`hooks/use-feature-*`、对应测试 |
| 第二波 | C | P4 | `components/header/**`、`lib/workspace-tabs.ts`、`app/new-chat/**`、对应测试 |
| 第三波 | 协调者 | 合并 B、C；P5 | `README.md`、`docs/**`、`package.json` |

每个线程在自己的 worktree 里工作，从 `feat/nest-workspaces` 起分支，只提交到自己的分支，不 push，不 reload 已安装的插件。协调者在主 checkout 合并、跑 `npm run check`、构建并 reload。

真界面验证需要能截取 bb 窗口。当前 bb-agent-toolbox 的浏览器工具组是关闭的；打开它，或者由你截图评审。

## 8. 已定决策

2026-11-13 全部按推荐确认。

| # | 问题 | 采用 | 未采用 |
| --- | --- | --- | --- |
| D1 | Feature 放哪 | 两个模式顶部都有 Features 区块 | 只在 Threads 模式作为分组视角（恢复 Projects / Features / Machines）；做成第三个底部模式 |
| D2 | 功能成员 worktree 在项目下怎么显示 | 只在功能下，项目下一行「↗ N 个在功能里」 | 两处都显示，项目下带功能徽标 |
| D3 | 关闭 Tab 做什么 | Settle，可从 Settled 搁架撤回 | Archive，与 Conductor 一致 |
| D4 | Threads 模式头部 | 完全交回 bb | 保留面包屑，只去掉 Tab |
| D5 | 点击工作区行 | 先打开需要你的会话，再上次活跃 | 总是上次活跃 |

## 9. 风险

| 风险 | 处理 |
| --- | --- |
| Workspaces 模式下后台会话的 Needs you 容易被忽略 | 行和项目逐级汇总；标题栏注意力 chips；点击直达 |
| 功能成员只在功能下，按项目找的人找不到 | 项目下「↗ N 个在功能里」 |
| 关闭 = Settle 依赖 Nest 服务端 | 头部走 RPC，bb 原生列表下同样可用 |
| `thread-inbox.tsx` 有 500 行预算 | 模式分支下沉到 `InboxTreePanel` 和新组件 |

## 10. 执行记录

2026-11-13，三波全部合并到 `feat/nest-workspaces`，`npm run check` 1230 个通过，`npm run build` 无 warning。

| 波次 | 线程 | Commit | 内容 |
| --- | --- | --- | --- |
| 第一波 | A | `57cad8e`、`3cae514` | 共享 WorkspaceIndex 与 sidebarMode store，侧边栏是唯一发布方；`lastActive` 按工作区记录；Threads 模式头部交回 bb；删掉一键归档和 `MutationObserver` |
| 第二波 | C | `daa4e29`、`978e0cf` | Tab 规则写成 `lib/workspace-tabs.ts` 纯函数；家族状态与子线程计数；关闭 = Settle，先导航再 settle；「All (N)」带搜索、Settle、Snooze；`⋯` 菜单；Untitled Tab；面包屑切换器；双击重命名 |
| 第二波 | B | `1cb10a4`、`ddeb41a`，合并 `6f3a45e` | Features 区块与 Features 标签页、分组推导、功能选择器、Finished 搁架；容器项目隐藏；成员只在功能下，项目下「↗ N in features」；工作区行、D5 点击目标、Personal 紧凑行、Pinned 工作区去重、列表级 +/− |
| 第三波 | 协调者 | 本节所在 commit | 索引记录 `featureNames`，面包屑在功能根目录没有 environment 时也能显示功能名；README；0.7.0 |

与计划的偏差：

- 插件自己的「Features · Show the feature view」开关没有恢复。Features 已是两种模式的固定区块，单个功能用 `⌕` 选择器隐藏。
- 面包屑切换器沿用 C 的规则：上次活跃 → 最早的会话 → 新会话页。侧边栏工作区行按 D5 先打开需要你的会话。两处规则不同，是否统一待定。
- 「Archive all conversations」只归档工作区的规范 environment 上的会话；同一目录有重复 environment 记录时，其他记录上的会话不在其内。
- 两种模式的真界面截图评审还没做：bb-agent-toolbox 的浏览器工具组是关闭的。

