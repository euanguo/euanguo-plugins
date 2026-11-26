# Harbor V3 架构重构、左侧栏体验升级与全仓瘦身实施文档

> **状态**：设计定稿（待按波次落地）  
> **基准提交**：`02a2b0a`（P0 功能、安全、Host Git 与 Agent 契约修复之后）  
> **核心铁律**：**禁止保留任何 Shim / 兼容层 / 过渡别名**。所有旧接口、旧弹窗、旧状态键、旧导出与旧测试在同一波次内完成全量迁移并彻底删除。

---

## 0. 背景、现状基线与硬性约束

### 0.1 现状基线（`plugins/harbor`）

全仓静态审计显示，Harbor 当前实质上把三套子系统拼接在了一起——双模式侧边栏与顶栏工作台、跨仓 Feature 驾驶舱与独立弹窗组、以及默认全开的 32 工具 Agent 层——导致代码体量、视觉噪音与上下文成本同时膨胀：

| 指标 | 当前基线 | V3 目标 | 变化 |
| :--- | ---: | ---: | :--- |
| 生产源码行数（TS/TSX/CSS） | ~63,600 行（347 文件） | ~48,000–51,000 行（~290 文件） | **−12,500 ~ −15,500 行（−20%~24%）** |
| 测试源码行数 | ~25,500 行（137 文件） | ~21,500–22,500 行（~115 文件） | **−3,000 ~ −4,000 行**（去 604 条脆弱正则） |
| 超过 90 行的生产函数 | 117 个（最高 618 行） | < 45 个（组件/核心函数 ≤ 250 行） | 消除 400–600 行级巨型函数 |
| RPC 端点数量 | 76–79 个（53% 为 ≤5 行透传） | ~45–52 个 | 合并薄封装、删单仓 Git 提交/旧弹窗接口 |
| 注册的 Agent 工具数 | 32 个（20 个全局常驻，10 开关全开） | **9–10 个**（默认仅读 + 精简上下文） | **−70% 工具数** |
| 普通对话每轮 Agent 上下文税 | ~4,500–5,700 tokens/轮（Feature 内 ~10k） | **< 1,000 tokens/轮**（Feature 内 < 2.8k） | **每轮省 3,500–7,000 tokens** |
| 配置项总量（跨 4 层存储） | ~68 个旋钮（含 18 Hex + 10 Agent 开关） | **~14 个高杠杆控件**（3 分区） | 彻底消灭宿主 10 开关墙与配置碎片化 |

### 0.2 已拍板的 4 项核心产品与架构决议

1. **Worktree 活跃优先双层披露 + 批量清理**：活跃/已命名/24h 内新建的 worktree 常驻，其余 `0 活跃线程`（含线程自动创建的 `bb/*` worktree 与丢失目录记录）自动折成单行摘要 `▸ N inactive worktrees · M modified` 并支持一键批量清理；同时根治 Feature worktree 被误报为 `unseen-worktree` 的双向泄漏。
2. **Feature Hub 成为唯一工作台 + `Changes` 瘦身为跨仓交付矩阵**：直接删除 3 个冗余 Feature 弹窗（`FeatureBriefDialog`、`FeatureRepositoriesDialog`、`FeatureParkDialog`），补齐 0 线程与 Parked Feature 直达 Hub 能力；`FeatureHubChanges` 剥离单仓 staging/commit/手写 diff 合成，专注只有 Harbor 能做的跨仓状态矩阵，单仓 diff/提交交回 BB 原生 `bb--git`。
3. **保留 `Threads` 与 `Workspaces` 双侧边栏模式，但彻底统一底层实现**：两种模式均持续维护，通过合并 `WorkspaceCard` + `WorkspaceGroup`、统一 `NewChatPage` + `NewThreadDialog` 发起链路、去除底部模式切换重复状态圆点、按模式隐藏无效菜单项来消除双模式维护成本。
4. **严格零 Shim 原则（No-Shim Rule）**：
   - **禁止** `export * from` 兼容转发文件、禁止保留废弃类型/函数别名（如 `FEATURES_SCOPE_KEY`、`projectStatusSignals`/`workspaceStatusSignals`、`reorderProjectDrop`、`mergeWorkspaceRefs`、`legacyWorkspaceKeys`、`LEGACY_ROOT_SCHEME`、`data-nested-group`）。
   - **禁止**在 KV / `localStorage` 层写多版本兼容迁移适配器：直接升级到干净的 schema key（`appearance:v2`、`bb.harbor.view-state.v2`、`agentAccess:v1`），遇到旧版本或损坏数据直接回退到干净默认值。
   - **禁止**保留 `bb.settings.define` 宿主开关作为旧设置镜像。
   - **唯一存储安全边界（非 Shim）**：SQLite `bb.storage.migrate(db, migrations)` 为按序号执行的 append-only 迁移历史，**不得删除或重排已发布迁移数组中的历史 SQL 条目**（否则会破坏已有数据库的迁移索引计数）；废弃表通过**追加** `DROP TABLE IF EXISTS` 迁移或仅冻结历史 SQL 字符串、同时彻底删除对应 TypeScript Store 与 RPC 实现。

### 0.3 与前序修复的衔接说明

- **完整保留** `02a2b0a` 落地的全部 P0 修复（`data-harbor-select-root`、拖拽冒泡 `stopPropagation`、Host `lstat`/文件上限/`.code-workspace` 路径校验与 fail-closed、`renameFeatureMemberBranch` 只读 ref 拦截、Header Snooze/`canPark` 校验等）。
- **直接取代**原规划中“设置页保留 ~68 旋钮重排 5 分区（继续保留 10 个默认全开的布尔 Agent 开关）”与“抽共享表单让 Feature Hub 和 3 个旧弹窗继续双轨并存”的方案；若工作树中存在未提交的 10 开关 KV 过渡文件（如 `lib/domain/agent-tools-settings.ts`、`lib/stores/agent-tools-store.ts`、`server/rpc/agent-tools.ts`），在 Wave 0 清理或于 Wave 3 直接替换为单档三态 `agentAccess` 模型，不保留任何旧布尔开关。

### 0.4 全量吸收的前序 P1 缺陷与性能清单（确保 100% 零遗漏）

在按 V3 架构重构的同时，前序静态审查识别出的**全部有益 P1 缺陷与性能项**均纳入对应波次一并根治：

| 归属波次 | 缺陷 / 优化项 | 目标文件与根治方式 |
| :--- | :--- | :--- |
| **Wave 1** | 状态角标重复计数（`"3 of 1 threads"`） | `lib/domain/rollup.ts`：`unread-error` 不再同时累加进 `failed`/`needsYou`/`unread` 三个桶 |
| **Wave 1** | 搜索链剪枝过早（搜不到分组/分支、空项目被吞、多选误剔除） | `lib/domain/inbox-view.ts`：移至建树后按完整树结构过滤并保留已勾中项 |
| **Wave 1** | `By machine` 模式误把 `hostId` 当分组 ID | `components/inbox/group-section.tsx`：区分机器分组头与用户分组头，禁掉重命名/删组菜单并修复折叠与排序 |
| **Wave 1** | 超长 Worktree 路径（>200 字符）破坏排序/展开态 | `lib/domain/manual-order.ts`、`lib/ui/view-state.ts`：上限放宽至 `1024` |
| **Wave 1** | 到期 Snooze 休眠唤醒后滞留 | `hooks/use-lifecycle.ts`：修复 `now < snoozedUntil <= armedAt` 漏触发并推进 `now` |
| **Wave 1** | 拖拽排序缺少 before/after 插入指示线 | `components/inbox/{family-row,project-node,workspace-row}.tsx`：补齐清晰插入指示线 |
| **Wave 1** | 后端并发与边界 4 处 P1 | `server/rpc/icons.ts`（修 7 天未命中缓存 TTL）、`server/project-service.ts`（删项目补发 `ORDER_CHANNEL`）、`server/sidebar-index-service.ts`（>500 路径分批探查不触发 Zod 报错）、`server/lifecycle-service.ts`（`unsnooze` 不误删 `settled` 记录） |
| **Wave 2** | `NewChatPage` 空工作区锁死 + 错误提示缺失 | `app/new-chat/NewChatPage.tsx`：未索引空 worktree 不再隐藏输入框，补齐 `spawn` 错误提示与 `canParkTab` 关闭保护 |
| **Wave 2** | `AllConversationsMenu` 键盘与焦点冲突 | `components/header/AllConversationsMenu.tsx`：修复搜索框拦截 `Escape`/`ArrowDown` 与 hover 抢焦点 |
| **Wave 2** | `FeatureEndDialog` 后台刷新重置输入 | `components/inbox/feature-end-dialog.tsx`：Effect 依赖收敛至 `feature.id` 而非整个 `feature` 对象 |
| **Wave 2** | `FeatureHubDecisions` 交互细节 | `components/feature-hub/feature-hub-decisions.tsx`：补 `Cmd/Ctrl+Enter` 快捷提交与 `Supersede #N` 自动滚焦 |
| **Wave 3** | `appearance-store` 并发写丢更新 + `pageSize` 校验 + Diagnostics 真刷新 + `GroupManagerDialog` 死 UI/冒泡 | 全部直接落在 Wave 3 新版设置页与 `GroupManagerDialog` 中（详见 §3.2） |
| **Wave 4** | 3 份 `runGit` 合并 + `LC_ALL=C` / `core.quotePath=false` + `PRAGMA table_info` 重复执行 + `use-media-query` 重建监听 | 合并统一 `host/git.ts`（补齐重命名 numstat 与 `resolveCompareBase` 显式 `baseBranch` 优先级）；`lib/stores/feature-store.ts` 启动期只查一次表结构；`use-media-query.ts` 稳定化 `subscribe` 引用 |

---

## 1. Wave 1 · 左侧栏 IA 重构与 Worktree 双层治理

> **目标**：把左侧栏 UX 启发式评分从 `5/10` 提升到 `9/10`，解决 Worktree 垂直淹没、`Projects → All` 串台、5 处半迁移路由 Bug 与视觉噪音。

### 1.1 Worktree 活跃优先双层披露与批量清理

#### A. 后端元数据补齐与已销毁环境过滤
- **改造文件**：`server/sidebar-index-service.ts`、`lib/domain/workspace.ts`、`lib/domain/workspace-index.ts`、`host/workspace-facts.ts`
- **具体变更**：
  1. 在 `server/sidebar-index-service.ts` 的 `readWorkspaceDescriptors()` 中：
     - **过滤已销毁环境**：跳过 `environment.status === "destroyed"`、`environment.lifecycle?.phase === "destroyed"` 或 `environment.hostLifecycle === "removed"` 的记录，避免已回收环境残留侧边栏。
     - **透传关键分类字段**：将 BB SDK `Environment` 上已有的 `managed: boolean`、`createdAt: number | null`、`updatedAt: number | null`、`providerInstanceKey: string | null`、`dangling: boolean`（结合 `repoFacts` 中 `isDirectory === false` 或 `dangling-path` 诊断推导）写入 `WorkspaceEnvironmentDescriptor`，并保留到 `WorkspaceRecord` 与最终 `Workspace` 对象上，**不再在 `workspace-index.ts` 构造阶段丢弃**。
  2. 将 `lib/domain/workspace.ts` 的 `WorkspaceRef` 明确补充：
     ```ts
     export interface WorkspaceActivityMeta {
       readonly managed: boolean;
       readonly createdAt: number | null;
       readonly dangling: boolean;
     }
     ```
     同时直接删除 0 调用的死代码 `mergeWorkspaceRefs()` 及局部重复的 `chooseCanonicalEnvironment()`（`lib/domain/workspace.ts`）。

#### B. 纯函数分层判定规则（`classifyWorktreeTier`）
在 `lib/domain/workspace.ts` 中新增纯函数，决定每个项目下的工作区属于 **常驻主层（`primary`）** 还是 **自动折叠非活跃层（`inactive`）**：

```ts
export type WorktreeTier = "primary" | "inactive";

export const FRESH_WORKTREE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function classifyWorktreeTier(input: {
  readonly ref: WorkspaceRef;
  readonly openFamilyCount: number;
  readonly isActiveWorkspace: boolean;
  readonly hasOpenPullRequest: boolean;
  readonly inManualOrder: boolean;
  readonly now: number;
}): WorktreeTier
```

判定顺序（命中任一即归入 `primary`，否则归入 `inactive`）：
1. `ref.kind === "project-checkout"`（主检出目录如 `main` 永远常驻）。
2. `isActiveWorkspace === true`（当前主视口正在打开的工作区永远不折叠）。
3. `openFamilyCount > 0`（存在未结案/未休眠的活跃对话——哪怕是线程自动创建的 `bb/*` worktree，只要活还在干就必须常驻）。
4. `hasOpenPullRequest === true`（存在未合并的 Open PR）。
5. `ref.alias !== null`（用户显式起过别名，视为主动管理的长期工作区）。
6. `inManualOrder === true`（用户主动拖动排序固定过位置）。
7. `!ref.dangling && ref.createdAt !== null && now - ref.createdAt < FRESH_WORKTREE_WINDOW_MS`（24 小时内新建的空工作区，防止刚创建就消失）。
8. `!ref.managed && !ref.dangling && ref.lastActiveAt !== null && now - ref.lastActiveAt < 7 * 24 * 60 * 60 * 1000`（非 BB 托管的手工外部 worktree 且 7 天内活跃过）。

> **其余全部归入 `inactive`**（典型如：已 `Settled` 的线程留下的 `bb/phase-1-...` 托管 worktree、长期闲置的 0 线程 worktree、磁盘目录已删除的 `dangling` worktree）。

#### C. 过滤态一致性与 `ProjectNode` 模型扩展
- 在 `lib/domain/tree.ts` 的 `ProjectNode` 新增：
  ```ts
  readonly workspaces: readonly WorkspaceNode[];          // primary 层
  readonly inactiveWorkspaces: readonly WorkspaceNode[];  // inactive 层（按 lastActive/label 排序）
  ```
- **过滤态一致（与 `buildFeatureView` 对齐）**：当 `filterPreset !== "all"`（如 `Needs you`、`Working`、`Unread`）时，`buildProjectNode` **仅保留包含匹配线程的工作区**，直接置 `inactiveWorkspaces = []`，不再在过滤结果里夹带一堆空 worktree。
- **搜索态一致**：在 `searchTree` 中，若搜索词精准命中某个 `inactive` worktree 的分支名或路径，则将其提升并展示；若仅命中项目名，仍保持 `inactiveWorkspaces` 折叠状态，避免搜一个项目名又把 11 个旧 worktree 全炸开。

#### D. 折叠摘要行与批量清理弹窗
- **UI 呈现**（同时适用于 `Threads` 与 `Workspaces` 双模式）：
  - 当 `node.inactiveWorkspaces.length > 0` 时，在项目下活跃工作区列表末尾渲染单行折叠入口（高 24px）：
    - 文案：`▸ 11 inactive worktrees`；若其中有脏改动或缺失目录，追加静默计数：`· 5 modified` / `· 1 missing`（使用 `text-muted-foreground`，不抢活跃行色彩）。
    - Hover/focus 右侧显示紧凑 `Clean…` 按钮。
  - 点击摘要行原地展开/收起（展开态记入 `HarborViewState.expandedInactiveProjects: readonly string[]`，默认收起）；展开后的每条 `inactive` worktree 正常渲染，缺失目录行带清晰 `Missing` 标识。
- **批量清理能力（`BatchPruneWorktreesDialog` + `batchRemoveWorktrees` RPC）**：
  - 弹窗打开时调用后端一次批量巡检（复用 `workspaceService.surveyWorktree` 并行探测，带超时保护与 fail-closed：探测失败标为“未知/不可自动勾选”）。
  - 列表按安全级别分组：
    1. **可安全释放（默认勾选）**：`dangling`（目录已不存在，仅清理 BB environment 记录）与 `clean && unpushed === 0`（干净且无未推提交）。
    2. **含未提交改动或未推提交（默认不勾选，显式标黄）**：展示 `+A -D` / `N unpushed`，用户手动勾选时展示明确风险确认。
  - 底部提供“仅从 BB 释放记录”与“同时删除磁盘 Worktree 目录（强制）”分步选项，逐项汇报成功/失败结果，完成后触发 `repoFacts.invalidate()` 与列表刷新。

---

### 1.2 根治 Feature Worktree 双向泄漏

- **问题回顾**：Harbor 在 `<dataDir>/harbor-features/<slug>/<repo>` 创建的 worktree 在没有 BB environment 时会被 `inferRepos` 误判为源仓库的 `unseen-worktree`；反过来，默认 `showUnregisteredWorktrees === false` 时，新建 Feature 的成员仓进不了 `workspaceIndex.byFeature`，在 Feature 节点下无法显示工作区行。
- **改造方案**：
  1. 在 `server/sidebar-index-service.ts` 注入 `featureStore`（或只读 `listFeatureMemberPaths()` 回调），收集所有 Feature（`active`、`parked`、以及尚未删盘的 `archived`）的 `rootPath` 与成员 worktree `path`（含 `realpath` 归一化），传入 `inferRepos({ ..., featureOwnedPaths })`。
  2. 在 `lib/domain/repo-identity.ts` 中，任何命中 `featureOwnedPaths` 的 linked worktree 标记为内部托管成员，**不再写入 `repo.unseenWorktrees`，也不产生 `[unseen-worktree]` 诊断**（彻底净化 `harbor_sidebar_map` 与 Settings → Diagnostics，且杜绝 Finished Feature 残留目录反漏进 Projects）。
  3. 在 `lib/domain/workspace-index.ts` 的 `buildWorkspaceIndex()` 中，直接从 `input.featureMembers` 合成每个 Feature 成员的工作区条目并挂载到 `byFeature`（若尚无 BB environment 则 `canonicalEnvironmentId: null`，点击 `+` 或行时自动激活/创建环境进入对话），**彻底解除对 `showUnregisteredWorktrees` 的错误依赖**。

---

### 1.3 彻底分离 `Features` 与 `Projects` 顶层视角（修复全部 5 处半迁移 Bug）

#### 目标状态架构（严格互斥）

| 维度 | `surface === "features"` | `surface === "projects"` |
| :--- | :--- | :--- |
| **顶部切换** | `SurfaceSwitch` 高亮 `Features`（带活跃数与关注状态点） | `SurfaceSwitch` 高亮 `Projects` |
| **二级筛选条** | **专属 Feature 工具条**：状态筛选项（`All` / `Needs you` / `Dirty` / `Stale`）+ `+ New feature` 按钮（独立状态 `featureFilter`，不与 Projects 串台） | `GroupTabs`（`All` / 自定义分组 / `Ungrouped`）+ `ViewMenu` + 批量选择（Threads 模式）+ 分组管理 |
| **主体树内容** | `Active Features` + `ParkedFeaturesShelf`（**默认折叠且持久化**）+ `FinishedShelf` | `GroupSection` → `ProjectNode` → 活跃 `Workspace` + 折叠 `inactiveWorkspaces`（**绝不渲染任何 Feature 列表或货架**） |
| **跨视角锚点** | 成员仓可右键/点击查看所属项目 | 有活跃 Feature 关联的项目保留紧凑 `<InFeaturesLine>`（`2 in features ▸`），**点击切 `surface: "features"` 并展开滚动到对应 Feature** |
| **线程货架** | 仅渲染属于 Feature 线程的 `Snoozed` / `Settled` | 仅渲染当前 `Projects`（且受当前 `groupScope` 过滤）的 `Snoozed` / `Settled` |

#### 具体代码改造清单（零 Shim）
1. **删除 `FEATURES_SCOPE_KEY` 与旧 `scope: "__features__"` 兼容逻辑**：
   - `lib/domain/groups.ts`：从 `GroupScope` 联合类型中移除 `{ kind: "features" }`；`GroupScope` 仅保留 `all | ungrouped | group`。
   - `lib/ui/view-state.ts`：升版 `VIEW_STATE_STORAGE_KEY = "bb.harbor.view-state.v2"`；删除 `FEATURES_SCOPE_KEY`、`legacyFeaturesScope` 转换逻辑及 `hiddenFeatureIds`；新增：
     - `featureFilter: FeatureFilterPreset`（`"all" | "needs-you" | "dirty" | "stale"`）
     - `parkedFeaturesOpen: boolean`（默认 `false`）
     - `expandedInactiveProjects: readonly string[]`（默认 `[]`）
     - 将 `MAX_ID_LENGTH` 从 `200` 放宽至 `1024`（同时放宽 `lib/domain/manual-order.ts` 对应上限，避免超长 worktree 路径在重载时清空整组展开/排序状态）。
2. **严格隔离视图模型**：
   - `lib/domain/feature-view.ts`：删除 `featureInScope(scope)`，改为由调用方显式依据 `surface === "features"` 决定是否构建 Feature 视图；`archived` 列表同样仅在 `surface === "features"` 返回。
   - `lib/domain/inbox-view.ts`：
     - `snoozed` / `settled` 列表按 `surface` 与当前 `groupScope`（`all` / 指定分组 / `ungrouped`）过滤，杜绝跨视角与跨分组泄漏。
     - 删除未使用的 `InboxViewInput.unseenWorkspaces`、`InboxViewInput.featureAdoptions` 字段。
     - 删除重复的 `projectStatusSignals` / `workspaceStatusSignals` 字段。
3. **修复半迁移跳转与创建状态**：
   - `hooks/use-feature-surface.ts`：
     - `reveal(featureId)` 必须同时将 `surface` 设为 `"features"`、从 `collapsedProjects` 移除 `featureId`，并在目标 Feature 处于 `parked` 时自动展开 `parkedFeaturesOpen: true`。
     - `onCreated(feature, startConversation)` 直接将 `surface` 设为 `"features"`，不再写入 `scope`。
4. **重塑 `ParkedFeaturesShelf`**（`components/inbox/feature-parked-shelf.tsx`）：
   - 移除内部局部 `useState(true)`，改为受控 props（`expanded={viewState.parkedFeaturesOpen}`，`onToggle` 写入 `viewState`），**默认折叠**。
   - 折叠头展示总数与已到期提醒角标（如 `Parked · 10 · 2 due`）。
   - `ParkedFeatureRow` 支持直接单击打开 Feature Hub（查看 Brief / Decisions / Repos 或一键 Wake），不再是死胡同。

---

### 1.4 左侧栏 Chrome 与视觉降噪（兼容 `Threads` & `Workspaces` 双模式）

| 改动项 | 目标文件 | 具体改动 |
| :--- | :--- | :--- |
| **消除空 Pinned 占位** | `components/inbox/inbox-chrome.tsx` | `pinned.roots.length === 0` 时不渲染外层 `pb-1.5` 容器，直接返回 `null`。 |
| **消除展开态重复 Rollup 徽章** | `group-section.tsx`、`project-node.tsx`、`workspace-row.tsx`、`feature-node.tsx` | 展开态的 `GroupSection` 与 `WorkspaceGroup` **隐藏 `<RollupJump>`**；展开态的 `ProjectNode` 仅在存在**折叠子工作区**含需关注线程时才展示 `<RollupJump>`。 |
| **移除底部模式切换重复圆点** | `components/inbox/organization-switch.tsx` | 删除 `StatusDotCluster` 及 `projectSignals` / `workspaceSignals` props；`Threads \| Workspaces` 保持干净的视图深度切换。 |
| **Diff 统计色彩降噪** | `components/inbox/workspace-row.tsx`（合并后） | 活跃工作区行的 `+A -D` 改为低饱和度 `text-muted-foreground/75`（仅选中行或 hover 时切至柔和语义色），把高饱和绿/红严格留给 `Working` / `Failed` 线程状态。 |
| **消除右侧 `+` 墙 & 补齐显性 `⋯` 入口** | `components/inbox/workspace-row.tsx`、`project-node.tsx`、`feature-node.tsx`、`group-section.tsx` | 工作区行的 `+` 改为 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`（选中行及粗指针设备常驻），释放 20px 给分支名；同时在 Group/Project/Feature/Workspace 行旁增加同策略 hover 显现的 `⋯` 触发器，复用现有右键菜单项，消除“纯右键隐藏功能”的发现性盲区。 |
| **收口与修复 `ViewMenu`** | `components/inbox/view-menu.tsx`、`hooks/use-inbox-actions.ts` | (1) `sidebarMode === "workspaces"` 时隐藏无效的 `Sort threads` 子菜单；(2) 单机环境（`hosts.length <= 1`）隐藏 `Group by → By machine`；(3) 将 `Group by repository` 与 `Show unregistered worktrees` 从 Settings 迁入 `ViewMenu` 树视图分组（单一归口，Settings 不再重复摆）；(4) `resetView()` 补齐重置 `scopeStrip`；(5) `collapseAll()` 补齐折叠 `expandedWorkspaces`、`expandedFeatures`、`expandedPersonalProjects`、`expandedInactiveProjects`。 |

---

### 1.5 侧边栏浮层与弹窗体系重构（防多重重叠、主题契约对齐与交互减噪）

#### A. 现状根因排查：为什么会出现“三层夹心弹窗”与主题失配

1. **三层浮层互相穿透的精确根因**：
   - 侧边栏当前并存 **6 类独立浮层**（`InfoCard` HoverCard、`RowMenu` ContextMenu、`Menu` DropdownMenu、`RowTooltip` 纯 CSS 气泡、`Popover`、`Modal`），彼此**全部非受控且零互斥**。
   - **同级 z-index + DOM 顺序打架**：`RowMenu` 主菜单（`menu.tsx:32`）与 `InfoCard`（`hover-card.tsx:81`）同为 **`z-50`**，而右键子菜单 `ContextMenu.SubContent`（`menu.tsx:39`）为 **`z-[60]`**。悬停行后右键打开菜单再滑入子菜单时，后挂或仍打开的 `InfoCard (z-50)` 横切压在 `ContextMenu (z-50)` 上方，而 `SubContent (z-[60])` 又压在 `InfoCard` 正中央，形成“三明治穿透”。
   - **8 类极限边界并发冲突**：
     1. `HoverCard × ContextMenu × Submenu` 三层夹心；
     2. `DropdownMenu`（`menu.tsx:117` 写死 `modal={false}`）打开 `ViewMenu`/`ChildrenChip` 后，滑过下方行仍会弹出 `InfoCard`，甚至右键还能双开 `RowMenu`；
     3. `InfoCard` 与按钮自带非 portaled `RowTooltip`（`z-30`）双重叠加，且 `RowTooltip` 会被侧边栏 `overflow-y: auto` 裁切；
     4. 跨行快速移动时多个 `HoverCard` 的 `openDelay=350 / closeDelay=80` 定时器无全局单例，易出现滞留与短暂叠层；
     5. 拖拽排序开始（`dragstart`）不关闭 `InfoCard`，拖出 352px 幽灵浮窗；
     6. 滚轮滚动侧边栏时不关闭 `InfoCard`，悬停卡脱锚漂移；
     7. 键盘 `Tab` 遍历触发 Radix `HoverCard` onFocus 自动弹卡，遮挡主聊天区；
     8. `DialogFloatingContent`（`dialog-floating.tsx:36,46`）硬编码 `z-50` 未遵守 `Z_DIALOG`；`lib/ui/portal-scope.ts:43-56` 的 `useOverlayPortalContainer()` 仍在查询早已废弃的原生 `dialog[data-harbor-modal]`。

2. **“带仓库信息的悬浮卡”为什么没命中 BB 主题 CSS（如 `chatgpt-skin`）**：
   - **它不是 BB 官方组件**：`@get-bb/plugin-sdk` 未导出 `HoverCard`/`InfoCard`，该弹窗为 Harbor 基于 `@radix-ui/react-hover-card` 自绘（`components/ui/hover-card.tsx`）。
   - **缺失 BB `shared-ui` 主题选择器契约属性**：BB 官方组件及皮肤 CSS（如 `chatgpt-skin`）匹配浮动层依赖 `data-radix-hover-card-content`、`data-radix-popover-content`、`data-radix-select-content`、`data-radix-dialog-content` 等标记。`@radix-ui/react-context-menu` 原生自带 `role="menu"` + `data-radix-menu-content` 所以碰巧命中主题；但 `@radix-ui/react-hover-card` 既不输出 `role` 也不输出 `data-radix-hover-card-content`，导致 `InfoCard` 完全脱靶！同类漏标同时存在于 `popover.tsx`、`select.tsx`、`dialog-floating.tsx`。
   - **强硬覆写对抗主题**：`hover-card.tsx` 硬编码 `rounded-lg border border-foreground/15 shadow-xl`，同时 `semantic-tones.css:50-53` 用 `.harbor-opaque-surface { background-color: var(--popover) !important; }` 和各浮层上的内联 `style={{ backgroundColor: "var(--popover)" }}` 强行打死皮肤的半透明毛玻璃与自定义圆角/阴影。

#### B. 架构解法 1：全局浮层互斥协调器 + 严格 z-index 阶梯

新增轻量非 Context 订阅协调器 `lib/ui/overlay-coordinator.ts`（~50 行，零全树重渲染）：

1. **唯一 z-index 阶梯**（收口于 `components/ui/overlay-layers.ts`，禁止任何组件私写 `z-50`）：
   - `Z_HOVER = "z-40"`：悬停预览卡与气泡（**永远低于任何打开的菜单与弹窗**）
   - `Z_MENU = "z-50"`：`ContextMenu` / `DropdownMenu` / `Popover`
   - `Z_SUBMENU = "z-[55]"`：二级子菜单
   - `Z_DIALOG = "z-[60]"`：`Modal` 遮罩与弹窗主体
   - `Z_DIALOG_POPOVER = "z-[70]"`：弹窗内部的 `Select` / 图标 `Popover`
2. **四条互斥铁律（从根上消灭多重浮层共存）**：
   - **交互层一开，悬停层立死**：任意 `ContextMenu` / `DropdownMenu` / `Popover` / `Modal` 打开时，立即向协调器注册为活跃交互层，强制关闭全部 `HoverPreview` 与 `RowTooltip` 并锁定 `hoverSuppressed = true`；所有交互层关闭后增加 **150ms 冷却期**再恢复悬停响应，杜绝关闭菜单瞬间鼠标正好落在行上把悬停卡弹回。
   - **单一交互菜单**：任意新 `RowMenu` 或 `DropdownMenu` 打开前，先关闭当前已打开的旧菜单；`ViewMenu` / `ChildrenChip` 取消非互斥自由悬停态（关闭时自动释放锁）。
   - **悬停层全局单例 + 交互即关**：全侧边栏同时最多挂载 **1 个** 悬停预览卡（开启新行立刻关闭旧行）；在侧边栏发生 `scroll`、`dragstart`、`contextmenu`、`pointerdown` 时立即关闭悬停层；**禁止 `focus` 触发悬停卡**（仅 pointer hover 触发）。
   - **删除废弃 `useOverlayPortalContainer`**：直接移除 `lib/ui/portal-scope.ts` 中针对已删除原生 `dialog[data-harbor-modal]` 的无效查询，统一由 z-index 阶梯管理所有 Radix Portal 层级。

#### C. 架构解法 2：100% 对齐 BB 官方浮层主题契约

1. **补齐全部 `shared-ui` 契约属性**：
   - `HoverCard.Content` → `data-radix-hover-card-content=""`
   - `Popover.Content` → `data-radix-popover-content=""`
   - `Select.Content` → `data-radix-select-content=""`
   - `Dialog.Content` → `data-radix-dialog-content=""`
   - `ContextMenu.Content` / `SubContent` → `data-radix-context-menu-content=""`
   - `DropdownMenu.Content` / `SubContent` → `data-radix-dropdown-menu-content=""`
2. **彻底删除对抗皮肤的 `!important` 与内联背景**：
   - **删除** `components/ui/semantic-tones.css:49-53` 中的 `.harbor-opaque-surface` 规则及全仓所有 `harbor-opaque-surface` 类名与内联 `style={{ backgroundColor: "var(--popover)" }}`。
   - 所有浮层统一采用与 BB `shared-ui` 一致的柔和基础 Token：`rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg`，默认主题下自带清晰不透明实色 `var(--popover)`，启用第三方皮肤（如 `chatgpt-skin`）时零阻力继承其圆角、环绕阴影与毛玻璃质感。

#### D. 产品与交互重设计：各浮层该展示什么、怎么交互更克制高效

将当前“每行无差别弹 352px 大诊断卡 + 右键菜单重复塞 3 个 Copy 项”重构为**三层职责清晰的交互分工**：

| 浮层类型 | 触发方式与延迟 | 定位与内容规范 | 增删调整 |
| :--- | :--- | :--- | :--- |
| **1. 轻量悬停预览卡（`HoverPreview`）** | 仅 pointer hover；`openDelay=600ms` / `closeDelay=50ms`；宽度收紧至 **`w-64`（256px）**；**零 Copy 按钮、零 `Env ID` / `Project ID` / `Group ID` 调试字段** | 只展示“因侧边栏窄而被截断、但决策前想一眼扫清的高价值状态”：<br>• **Group 行**：**取消悬停卡**（零信息增量）。<br>• **Project 行**：完整仓库名/remote、单行中间省略路径（禁止单字换行）、活跃/折叠 worktree 数、归属异常提示。<br>• **Workspace / Worktree 行**：**完整分支名**（解决 `bb/phase-...` 截断痛点）、Git 摘要（`Clean` 或 `+A −D · N files` + `↑ahead ↓behind` + 关联 PR 状态）、来源类型（`Primary` / `Thread worktree` / `Manual` / `Missing`）+ 最近活跃时间 + 线程分布（`2 open · 33 settled`）、单行截断路径。<br>• **Feature 行（Active & Parked）**：1 行 Goal 摘要（或 Park 原因/唤醒倒计时）+ **跨仓状态微列表**（每仓分支与 `+A −D`）+ 待确认决策数。<br>• **Thread 行**（仅 `compact` 密度或标题截断时）：完整标题 + 分支 + Provider + PR + 活跃时间。 | **删**：Group 悬停卡、所有 `Copy` 按钮、所有原始 ID 字段、随意断字的 `break-words` 路径。<br>**增**：完整分支名、Ahead/Behind、PR 状态、最近活跃时间、Feature 跨仓微列表。 |
| **2. 行操作菜单（`RowMenu`：右键 + Hover `⋯` 双入口共用）** | 右键行或点击 hover 显现的 `⋯` 按钮（两者强互斥） | **缩短主菜单长度、高频置顶、低频折叠**：<br>1. 主操作：`New thread here`、`Rename worktree…`（可选：`Reveal in Finder` / `Open terminal`）<br>2. Feature 编排：`Feature ▸`、`Promote to Feature…`（或在 Feature 内为 `Open Feature Hub`）<br>3. 信息与复制：**把原先平铺占 3 行的 `Copy path` / `Copy branch` / `Copy environment ID` 收拢为 1 个 `Copy ▸` 子菜单**，并新增 **`Inspect details…`**（打开第 3 层按需详情弹窗）<br>4. 危险区：`Archive threads here`（仅 `threadCount > 0`）、`Remove worktree…` | **删**：一级菜单连排 3 条 `Copy *` 噪声。<br>**增**：hover `⋯` 显性入口、`Copy ▸` 子菜单、`Inspect details…` 入口。 |
| **3. 按需详情检视弹窗（`InspectDetailsModal`）** | 仅通过菜单 `Inspect details…` 或选中行按快捷键 `I` 主动打开 | 承担原本错放在 HoverCard 里的调试与复制职责：完整展示 `Path`、`Branch`、`Env ID`、`Project ID`、`Repo Key`、`Workspace ownership`、`Diagnostic` 全部原文，每行配一键复制按钮，可自由框选文字、不会因鼠标微移消失。 | **新抽象**：彻底解耦“一眼速览（Hover）”与“排错复制（Modal）”。 |

> **收口 `RowTooltip`**：按钮提示（如 `+`、Pin/Snooze/Settle）优先使用原生 `title` 或经协调器管理的 portaled 轻量 Tooltip（`Z_HOVER`），且当鼠标进入行内子按钮时暂停行级 `HoverPreview`，彻底杜绝“气泡叠大卡 + 被滚动容器裁切”。

---

## 2. Wave 2 · 唯一 Feature 工作台、跨仓交付矩阵与冗余表面清除

> **目标**：砍掉约 **3,800+ 行**双轨并行 UI 与 BB 重复表面，让 Feature 操作只有一条清晰心智路径。

### 2.1 删除 3 个冗余 Feature 弹窗，Feature Hub 成为唯一工作台

#### 彻底删除的文件清单（−1,691 行，零 Shim）
- `components/inbox/feature-brief-dialog.tsx`
- `components/inbox/brief/requirement-pane.tsx`
- `components/inbox/brief/references-pane.tsx`
- `components/inbox/brief/decisions-pane.tsx`
- `components/inbox/feature-repositories-dialog.tsx`
- `components/inbox/feature-park-dialog.tsx`

> 弹窗仅保留“生/死/改名”三类瞬时操作：`FeatureCreateDialog`、`FeaturePromoteDialog`、`FeatureEndDialog`（Finish / Delete）、以及通用 `<RenameDialog>`。

#### Feature Hub 能力补全与唯一入口改造
1. **吸收 3 个旧弹窗的优势能力进入 Feature Hub（只写一份）**：
   - `FeatureHubRepos`：接入已有的 `RepositoryPicker` 多选能力 + `planRepositories` 预检冲突提示 + Worktree/Ref 角色切换 + 脏仓 Remove 二次确认与强制选项。
   - `FeatureHubOverview`：Park 区域补齐自定义 reason 与 `datetime-local` 唤醒时间；References 区域补齐 `kind`、`refId` 与无 URL 纯文本参考支持。
2. **切 Tab 保留未提交草稿**：
   - `components/feature-hub/feature-hub-panel.tsx`：对 4 个子面板使用受控可见性（`hidden` 类或抬升草稿状态），禁止切 Tab 直接卸载丢草稿。
3. **支持 0 线程 Feature 与 Parked Feature 直达 Feature Hub（消灭 `setTimeout` 轮询黑魔法）**：
   - 将 `<FeatureHubPanel>` 改为接收显式 `featureId: string` + `initialSection?: HubSection` + `initialDirectory?: string | null` 的纯内容组件。
   - **有活跃线程且当前在 Feature 线程内**：直接通过 BB 原生 `experimental_tab` 打开右侧/主区 Feature Hub Tab。
   - **0 线程 Feature、Parked Feature，或从 Projects/侧边栏直接点开**：通过薄壳 `<FeatureHubModal open featureId={...} />`（宽度 `max-w-4xl h-[80vh]`）渲染**同一个 `<FeatureHubPanel>`**。
   - **彻底删除** `components/header/WorkspaceTabs.tsx` 里的全局 `pendingOpen` 单例、`FEATURE_HUB_OPEN_EVENT` 与 5 档 `[50, 150, 350, 700, 1200]` `setTimeout` 轮询补丁。
4. **简化 `FeatureNode` 菜单与操作条**：
   - `FeatureActionsRow` 与右键菜单不再并列 `Open Feature Hub` / `Requirement & decisions…` / `Repositories…` / `Park feature…` 四个入口，收口为一个清晰的 **Open Feature Hub**（快捷操作条可直接带深链 `Overview` / `Repos` / `Matrix` 打开 Hub 对应页签）。

### 2.2 `FeatureHubChanges` 瘦身为“跨仓交付矩阵（Delivery Matrix）”

- **设计定位**：单仓逐文件 diff/暂存/提交由 BB 原生 `bb--git`（顶栏 `[Changes]` 按钮）负责；Harbor 只做 BB 做不到的**跨仓全局视图与批处理协调**。
- **新版 `FeatureHubChanges`（目标 ≤ 250 行）**：
  1. 顶部汇总栏：显示 Feature 涉及的 `N 个工作区仓 · M 个有改动 · K 个待推送 · R 个只读参考仓` + 刷新按钮 + 一键 `Copy all git -C status` / `Push all clean ahead`。
  2. **跨仓矩阵表**：每行对应一个成员仓，展示：
     - `Repo & Role`（Worktree / Ref / Submodule 徽标）
     - `Branch`（含内联改分支与 base 分支偏离提示）
     - `Working Tree`（`+A -D · N files` 或 `Clean`）
     - `Sync`（`↑ahead ↓behind` 或无 upstream 提示）
     - `PR`（如已关联 BB PR 状态）
     - `Actions`：`Open Repo Thread`（直达该仓对话）、`Native Diff`（打开该仓对话并拉起 BB 原生 Diff Tab）、`Push`（仅当 `ahead > 0` 且非 ref）、`Inspect`（展开只读预览抽屉）。
  3. **只读快速预览（服务于 Feature 根目录线程）**：点击某脏仓的 `Inspect` 仅展开轻量的只读文件列表与 `<BbDiff>`（无 checkbox、无 partial stage、无 commit message 输入框与猜标题按钮），底部放 `Open in Native Diff` 与 `Ask Agent to Commit` 按钮。
- **彻底删除的后端 / Host / 契约代码（−1,200 ~ −1,500 行，零 Shim）**：
  - `host/feature-git.ts`：删除 `synthesizeUntrackedPatch()`、`stageAndCommitRepo()`、`stageFiles()`、`unstageFiles()` 等单仓暂存/提交实现，保留轻量跨仓 `inspectFeatureRepos`（状态汇总）、`readFeatureRepoDiff`（只读预览，严格带文件大小与 `lstat` 保护）与 `pushFeatureRepo`。
  - `lib/domain/feature-git.ts`：删除 `suggestCommitMessageFromFiles()` 及部分暂存提交状态类型。
  - `server/feature/git-ops.ts`、`server/contract-feature-cockpit.ts`（合并后）、`host/contract.ts`：删除 `commitFeatureRepo` 等单仓提交 RPC 与契约。
  - `components/header/WorkspaceTabs.tsx`：成员仓顶栏的 `[Hub]` 按钮默认打开 `overview`（而非与旁边原生 `[Changes]` 撞车的 `changes`）。

### 2.3 清除 BB 重复与遗留表面（−1,000+ 行，零 Shim）

| 清除项 | 删除/改造清单 | 收益 |
| :--- | :--- | :--- |
| **1. 删除 `.conductor/settings.toml` 遗留运行器** | 删除 `app/scripts/run.ts`、`app/scripts/settings.ts`、`test/run-settings.test.ts`；移除 `app.tsx` 中劫持 `Cmd/Ctrl+R` 的 `run-workspace-script` 命令；移除 `WorkspaceTabs.tsx` 中常驻的 `Run` 按钮。 | 释放全局快捷键，消除无配置报错按钮（−260L） |
| **2. 删除 `FeatureSelector`（隐藏复选框）** | 删除 `components/inbox/feature-selector.tsx`、`hooks/use-feature-selector.tsx`、`test/feature-selector.test.ts`；移除 `HarborViewState.hiddenFeatureIds` 与 `buildFeatureView` 相关分支。 | 统一使用 `Active / Parked / Finished` 三态管理 10–15 个长周期 Feature（−240L） |
| **3. 合并 Thread Context / Info 重复槽位** | `components/thread-context/feature-context-card.tsx` 删除 `FeatureContextCardReposSection` 与 `FeatureInfoReposSection`（不再把同一份仓库列表渲染第 4、5 遍）；抽单一共享 hook + 紧凑组件，仅保留 1 条可点击摘要芯片（`Feature: <name> · 2 dirty · Open Hub`）；同步更新 `app.tsx` 移除 2 个多余槽位注册。 | 消除重复 `useFeatureGitStatus` 请求与信息冗余（−170L） |
| **4. 统一 `NewChatPage` 与 `NewThreadDialog` 发起链路** | 抽取共享 `hooks/use-workspace-spawn.ts`：统一调用 `sdk.threads.spawn(request)` → `navigate.toThread(thread.id)`，并统一接入 `canParkTab` 关闭保护（修复 `NewChatPage` 直接 `settle` 绕过保护的问题）。删除 `hooks/use-new-thread.ts` 里的 `rpc.call("spawnThread")` + 15 秒 `hostThreads` 轮询黑魔法；`Threads` 模式点 `+` 改为打开轻量绑定目标工作区的 `NewChatPage`（或同链路轻量 Modal），删除后端冗余 `spawnThread` RPC（仅保留 Agent 内部调用路径）。 | 消除双份发起路径分叉与 15 秒轮询（−250L） |
| **5. `TitleAttention` 默认克制** | 为 `TitleAttention` 增加外观开关 `showTitleAttention`（默认 `false`，或收口进 Settings → Sidebar），不再未经许可覆盖 BB 顶栏；评估 `harbor-row-status` 内容脚本是否随 Harbor 开关按需生效。 | 减少对 BB 原生顶栏的侵入 |

---

## 3. Wave 3 · Agent 减负与设置页大瘦身

> **目标**：把普通 BB 对话的 Harbor 上下文开销砍掉 **80%+**，把设置页从“10 开关宿主墙 + 68 个配置旋钮”压成“单层 3 分区、~14 个高杠杆控件”。

### 3.1 Agent 权限重构：10 开关 → 1 个三档模式，32 工具 → 9 工具

#### A. 权限与存储模型（零 Shim）
- **彻底移除** `server.ts` 中的 `bb.settings.define({ ...AGENT_TOOL_SETTING_DESCRIPTORS })`（宿主不再渲染任何 Harbor 开关墙）。
- **彻底删除** `lib/agent/settings.ts` 中 10 个默认全 `true` 的布尔描述符与 `AgentToolFlags` 10 字段结构（以及任何临时过渡的 10 开关 KV 文件）。
- 新增唯一纯领域模块 `lib/domain/agent-access.ts`，存入 `bb.storage.kv` 键 `agentAccess:v1`：
  ```ts
  export type AgentAccessTier = "context-only" | "feature-worker" | "full-admin";
  export const DEFAULT_AGENT_ACCESS_TIER: AgentAccessTier = "context-only";
  ```

#### B. 32 工具 → 9–10 工具精准收口表

| 最终工具名 | 所属档位 | 作用域 | 来源与合并说明 |
| :--- | :--- | :--- | :--- |
| `harbor_sidebar_map` | `context-only` 及以上 | 全局 | 保留；移除过时的 `"## What can be changed"` 硬编码页脚 |
| `harbor_feature_list` | `context-only` 及以上 | 全局 | 保留（含 `02a2b0a` 已修复的 `feature.id` 输出） |
| `harbor_feature_brief` | `context-only` 及以上 | 仅 Feature 内 | 保留（`context-only` 下仅可读；`feature-worker` 及以上可读写） |
| `harbor_feature_git_status` | `context-only` 及以上 | 仅 Feature 内 | 保留（只读跨仓状态） |
| `harbor_feature_decide` | `feature-worker` 及以上 | 仅 Feature 内 | 保留（记录/确认决策） |
| `harbor_feature_link` | `feature-worker` 及以上 | 仅 Feature 内 | 保留（添加参考链接/工单） |
| `harbor_feature_repos` | `feature-worker` 及以上 | 仅 Feature 内 | **合并**原 `harbor_feature_add_repos` + `harbor_feature_add_ref` + `harbor_feature_remove_repo`（`action: "add" \| "remove"`, `role: "worktree" \| "ref"`；`force: true` 仅 `full-admin` 且强制 `acknowledged: true`） |
| `harbor_feature_lifecycle` | `full-admin` | 全局/Feature | **合并**原 `create` / `rename` / `park` / `unpark` / `reopen` / `promote` / `adopt` / `delete`（删除仍需 `acknowledged: true` 二步确认） |
| `harbor_sidebar_organize` | `full-admin` | 全局 | **合并**原 `project_rename` / `project_set_group` / `group_create` / `group_rename` / `workspace_set_alias` / `thread_settle` / `thread_snooze` / `thread_pin` / `thread_rename` |
| `harbor_admin_delete` | `full-admin` | 全局 | **合并**原 `thread_delete` / `project_delete` / `group_delete` / `worktree_remove`（全部要求 preview + `acknowledged: true`） |

**直接删除的工具（零 Shim）**：
- `harbor_feature_context`（系统提示词 + `<workspace_folders>` + 磁盘 `AGENTS.md` 已完整提供，三份冗余）。
- `harbor_thread_spawn`（与 BB 原生 `bbtools_thread_spawn` / `bb thread spawn` 重叠；在 `featureInstructions` 中直接给出每个子仓路径，Agent 直接用 BB 原生工具即可）。

#### C. 系统提示词瘦身与 `wire.ts` 同步修复
1. `lib/agent/instructions.ts`：
   - **删除**每次注入的 `Other projects: ...` 全量其他项目清单（多项目环境白白浪费数百 tokens；Agent 需要时自行调 `harbor_sidebar_map`）。
   - 单条普通对话的系统提示词压至 **≤ 400 chars**（仅声明当前项目、工作区路径/分支与 Harbor 可用档位）。
2. `lib/agent/wire.ts`：
   - 保证 `contributeInstructions` 与 `configure` 共用同一个 `resolveVisibleToolNames(tier, insideFeature)` 函数，彻底根治“工具被过滤、提示词仍广播全量工具名”的失步问题，并正确传入 `environmentId`。
3. 更新 `PLUGIN_OVERVIEW.md` 与 `docs/DESIGN.md`，确保文档与默认只读策略 100% 一致。

---

### 3.2 设置页大减脂：~68 旋钮 → ~14 核心项（单层 3 分区工作台）

#### A. 精简 `appearance:v2` 模型（零 Shim）
- **删除**：18 个独立 Hex 颜色键（`workingColor` … `prClosedColor`）、`Custom` 预设、`components/settings/palette-editor.tsx`（210L）、`components/settings/palette-panel.tsx`（36L）与 `lib/domain/preferences.ts` 中对应的 18 项自定义色表；删除 `rowLayout` + `rowDetails` 冲突的旧组合与 8 个微粒度行字段开关。
- **保留与精简后的 `APPEARANCE_V2_DEFAULTS`（仅 11 项，全部真实生效）**：
  1. `palettePreset`: `"Default" | "High contrast" | "Colorblind-friendly"`
  2. `rowDensity`: `"compact" | "detailed"`（`compact` = 单行标题+状态+悬停详情；`detailed` = 双行含分支/PR/Provider/相对时间）
  3. `statusDisplay`: `"dot" | "icon"`
  4. `worktreeLabel`: `"alias-over-branch" | "alias-and-branch" | "branch-only"`
  5. `defaultChildExpansion`: `"expanded" | "collapsed"`
  6. `showQuickActions`: `boolean`（统一控制 hover 快捷 Pin/Snooze/Settle）
  7. `pageSize`: `number`（强制校验 `1..100` 整数，失焦/步进器提交）
  8. `autoProjectIcons`: `boolean`
  9. `workspaceOwnership`: `"filesystem" | "claimed"`
  10. `showTitleAttention`: `boolean`（默认 `false`）
  11. `featureBranchTemplate`: `string`（默认 `"feat/{slug}"`）+ `featureDefaultBase`: `string`（默认 `""` 即自动探测）
- **并发安全**：在 `lib/stores/appearance-store.ts` 内用内存 Promise 串行队列锁保护 `patch()`，杜绝快速连续切换丢失更新。
- **去掉冗余外壳**：`app.tsx` 注册 `settingsSection` 时去掉多余的嵌套卡片边框，让 Harbor 单一主视图铺满设置页。

#### B. 新版 3 分区设置工作台布局（宽屏左侧 152px 导航 / 窄屏顶部分段器）

1. **① Sidebar & Features**
   - 顶部放置**真实渲染的实时行预览**（直接复用真实行样式，`compact` 与 `detailed` 100% 所见即所得）。
   - **列表与工作区**：`Row density`、`Status display`、`Worktree label`、`Default child expansion`、`Quick row actions`、`Rows per page`（带 `-/+` 步进器）、`Auto-detect project icons`、`Title bar attention chips`。
   - **Feature 默认值与模板**：`Branch template`、`Default base branch`、已保存 `Presets` 列表（查看/重命名/删除）、Feature 根目录只读展示与复制。
   - **归属规则**：`Workspace ownership`（`Filesystem` / `bb claims`），底部一行健康状态直达 Diagnostics。
2. **② Colors & Badges**
   - **状态调色盘**：3 张带 6 色真实预览圆点的预设卡片（`Default` / `High contrast` / `Colorblind-friendly`），点击即存。
   - **项目徽章色**：取消逐行 `Save` 按钮（删除 `projects-panel.tsx` 里 ~160 行草稿与冲突代码），统一改为**选色防抖即存 + 单键 Reset 图标**。
   - 底部提供带二次确认的 `Reset appearance to defaults`。
3. **③ Agents & Diagnostics**
   - **Agent 访问级别**：3 张语义清晰的单选卡片（`Context + Read-only [Recommended]` / `Feature Worker` / `Full Admin [Caution]`），直观列出当前档位开放的精确工具列表与上下文估算。
   - **Workspace & Repo Diagnostics（保留并强化 Harbor 核心超能力）**：
     - 导航标签带异常角标点（`unseen + conflicts + dangling > 0`）。
     - 修复 `Refresh` 按钮真正调用 `repoFacts.invalidate()` + 显示上次扫描时间，空状态同样提供 `Refresh`。
     - 每条 `unseen-worktree`（已排除 Harbor 自身 Feature 目录）直接提供一键 **`Activate`** 与 **`Adopt into Feature`** 操作按钮。
   - 顺手清理 `GroupManagerDialog` 中从未被 `GroupTabs` 渲染的 `All` / `Ungrouped` 图标死 UI，并给自定义 emoji 表单补上 `event.stopPropagation()`。

---

## 4. Wave 4 · 解除测试枷锁与全仓代码大瘦身

> **核心顺序**：必须**先拆除脆弱源码正则测试**，再落地非 UI 与前端结构合并，否则每次清理/重命名都会触发数百条假阳性报错。

### 4.1 拆除 29 个源码正则测试 + 修正 `source-shape.test.ts`（−2,900 ~ −3,400 行）

1. **直接删除 17 个纯源码正则测试文件 + `test/_sources.ts`**：
   - 删掉所有 0 生产代码导入、仅靠 `readFile` + 正则匹配缩进空格/变量名/JSX 顺序的测试文件（包括 `settings-contract.test.ts`、`header-registration.test.ts`、`order-revision-wiring.test.ts`、`reorder-ui-contract.test.ts`、`palette-contract.test.ts`、`view-state-wiring.test.ts`、`badge-contract.test.ts`、`view-menu-contract.test.ts`、`removal-contract.test.ts`、`row-pointer-reveal.test.ts` 等 17 个文件与 `test/_sources.ts`）。
2. **剥离 12 个混合测试文件中的源码正则 `describe` 块**（保留其全部真实行为单测！）：
   - 重点清理 `test/pinned.test.ts`（L360–492 的 52 条缩进/变量正则）、`archived-shelf.test.ts`、`row-status.test.ts`、`unarchive-retry.test.ts`、`recovery-wiring.test.ts`、`thread-actions.test.ts`、`title-attention.test.ts`、`organization.test.ts`、`agent-surface-contract.test.ts`、`lifecycle-failure-reporting.test.ts`、`palette-bridge.test.ts`、`copy-actions.test.ts`。
3. **补齐 3 个高价值运行时行为集成测试**：
   - `test/server-wiring.test.ts`：用 stub `bb` 真正调用 `plugin(bb)`，验证迁移顺序、RPC 注册与关键 handler 行为。
   - `test/agent-access.test.ts`：覆盖 3 档 `AgentAccessTier` 下可见工具集、提示词同步一致性与破坏性二次确认。
   - `test/worktree-tiering.test.ts`：覆盖 `classifyWorktreeTier` 全部 8 条规则、过滤态行为与 Feature worktree 不误报 `unseen-worktree`。
4. **保留并修正 5 个合法静态门禁**：
   - 保留 `architecture-contract.test.ts`、`capability-manifest.test.ts`、`distribution-contract.test.ts`、`dependency-manifest.test.ts`。
   - 修改 `test/source-shape.test.ts`：删除 `server.ts <= 500`、`server/feature/service.ts <= 320` 等诱导水平碎片化的局部小限额，仅保留单文件 900 行全局硬上限。

---

### 4.2 非 UI 层深度瘦身（目标 −4,350 ~ −6,000 行，−20~25 文件）

1. **Schema-first 单一 DTO 源（−900 ~ −1,200L）**：
   - 在 `lib/schemas/` 建立按领域划分的 Zod Schema（`workspace.ts`、`feature.ts`、`sidebar.ts`、`settings.ts`），所有前后端/Domain TS 类型一律通过 `z.infer<typeof ...>` 导出。
   - `host/contract.ts` 与 `server/contract.ts` 直接引用 `lib/schemas/*`，**彻底删除** `server/contract-schemas.ts`（652L）与 `server/contract-feature-cockpit.ts`（290L）中的重复镜像定义。
   - 输出数组 Schema 统一使用 `.readonly()` 或对齐可变签名，清除 `server/rpc/*` 中纯为应付只读类型而写的 `[...arr]` 拷贝。
2. **用 Zod 替换 `lib/persistence/` 650 行手写解码器（−650 ~ −750L）**：
   - 将 `lib/persistence/store-snapshot.ts`（69L）并入 `lib/persistence/snapshot.ts` 并删除原文件。
   - 删除 `lib/persistence/warm-start.ts` 中重复的 `defaultStorage()` 及 `warm-start.ts` + `store-persistence.ts` 内全部手写 `decode*` 函数，统一改为 `zodCodec(schema)` 复用 `lib/schemas/*`。
3. **合并浅层 RPC、Agent 透传与 Store 重复（−550 ~ −750L）**：
   - 将 14 个零碎 `server/rpc/*.ts`（含 5 个 30–57L 微文件）收口为 **4 个内聚模块**：`server/rpc/sidebar.ts`（分组/排序/置顶/货架/批量删除）、`server/rpc/settings.ts`（appearance/colors/icons/prefs/agentAccess）、`server/rpc/workspaces.ts`（paths/facts/removal/batchPrune）、`server/rpc/features.ts`（Feature CRUD + 跨仓只读状态/Push）。
   - 删除 `server/feature/wiring.ts` 与 `lib/stores/feature-repository.ts` 中**重复实例化两次 `createFeatureStore(db)`** 的缺陷，统一只传 `repository`。
   - 合并 3 份重复的 `resolveProjects` 为 `lib/agent/resolve-projects.ts`；将 9 处 `try/catch describeActionError` 下沉至 `lib/agent/toolkit.ts` 的 `register()` 包装器中。
   - 在 `lib/stores/sqlite-helpers.ts` 抽出通用行读取与预编译 Statement 辅助，减少 10 个 SQLite Store 的样板重复，同时删除不再使用的 `scope_icons` TS Store 与 RPC（保留 SQL 历史迁移项）。
4. **领域层去重与性能优化（−450 ~ −650L）**：
   - `lib/domain/workspace-ownership.ts` 与 `lib/domain/workspace.ts` 统一 `classifyWorkspace` / `kindFor`（消除双份分类逻辑）。
   - `lib/domain/workspace-tabs.ts`：单次预构建 `byParent` Map，消除每 Tab 重建全量树的 $O(T^2)$ 复杂度。
   - `lib/domain/inbox-view.ts`：单次遍历 `projectUnfilteredGroups` 同时产出所有 Tab 计数与最高状态，消除 `O(tabs × projects × families)` 重复扫描。
   - `lib/domain/tree.ts`：`foreignClaimsForProject` 直接读取 `workspaceIndex.byProject` 已算好的 `claimedProjectIds`，不再重扫原始 `environments`。
   - 删除 `lib/domain/workspace-key.ts` 中 `legacyWorkspaceKeys`、`server/feature/containers.ts` 中 `LEGACY_ROOT_SCHEME` 等旧兼容路径。
5. **死导出、微文件与 Host/UI 工具去重（−600 ~ −850L）**：
   - 清理非 UI 层 **192 个 0 引用死导出**（可用 `knip` 或静态 AST 扫描验证归零）。
   - 将 `lib/ui/workspace-changes.ts`（59L）并入 `lib/ui/workspace-change-counts.ts`（删除重复的 `bb--git` RPC 契约定义）。
   - `host/workspace-facts.ts` 与 `host/feature-worktree.ts` 共享 `.git` / `commondir` / worktree 解析函数；`host/feature-worktree.ts:inspectWorktrees` 复用 `host/feature-git.ts` 统一状态探测（且承接 `02a2b0a` 已统一的 `LC_ALL=C` + `-c core.quotePath=false` `runGit`）。
   - 内联单调用微文件：`lib/domain/codepoint.ts` (4L)、`lib/ui/row-pointer-events.ts` (6L)、`lib/domain/errors.ts` (13L)、`server/lifecycle-store.ts` (17L)、`lib/domain/thread-row-link.ts` (17L)、`lib/domain/group-scope-icons.ts` (31L)。
6. **精简历史叙事长注释（−1,200 ~ −1,800L）**：
   - 清理非 UI 层 5,511 行注释中的历史迁移日记（如“过去有 34 个 descriptor”“过去用过 Hugeicons”），只保留简洁的接口契约与核心不变量注释。

---

### 4.3 前端层深度瘦身（保留双模式下，目标 −4,800 ~ −6,000 行，−30+ 文件）

1. **统一 `WorkspaceCard` + `WorkspaceGroup`（−260 ~ −320L，−3 文件）**：
   - 合并 `components/inbox/workspace-card.tsx` (461L) 与 `components/inbox/workspace-row.tsx` (424L) 为单一 `<WorkspaceRow variant="card" | "group" />` + `useWorkspaceRow()` Hook；内联仅被二者调用的 `workspace-drag.ts` (24L) 与 `workspace-dialogs.tsx` (41L)。
   - 保留 `Threads`（点击展开子线程列表）与 `Workspaces`（点击直达工作区顶栏标签页、展示线程数与柔和 diff）完整双体验，零代码重复。
2. **卸载照搬 BB 宿主的移动端抽屉物理栈（−1,250 ~ −1,450L，−9 文件）**：
   - **删除**：`components/ui/dialog.tsx` (391L)、`components/ui/dialog/dialog-compact.tsx`、`dialog-floating.tsx`、`components/ui/drawer/responsive-drawer-shell.tsx`、`focus-trap.ts`、`drawer-drag.ts`、`keyboard-inset.ts`、`components/ui/responsive-overlay.tsx`、`components/ui/overlay-trigger.ts`、`hooks/useBrowserDimmingModal.ts`（5L 空壳）。
   - **替换**：`components/ui/modal.tsx` 直接封装 `@radix-ui/react-dialog`（窄屏自动 `max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-auto max-sm:translate-y-0 rounded-t-xl` 底部弹窗样式，由 Radix 原生负责焦点陷阱、Esc 关闭与无障碍）；`components/ui/popover.tsx` 直接封装 `@radix-ui/react-popover`。同步统一 `z-index` 使用 `menu.tsx` 阶梯常量，杜绝弹窗/下拉层级打架。
3. **合并重复 Hook 与通用弹窗（−1,050 ~ −1,250L，−7 文件）**：
   - 3 个排序 Hook（`hooks/reorder/use-{family,project,workspace}-reorder.ts`，506L）→ 1 个泛型 `hooks/use-scoped-reorder.ts`（删除 `reorderProjectDrop` 别名）。
   - 4 个单输入重命名弹窗（`RenameGroupDialog` / `RenameProjectDialog` / `FeatureRenameDialog` / `ThreadRenameDialog`，304L）+ 2 份私藏 `errorMessage` → 1 个通用 `components/inbox/rename-dialog.tsx`（~65L）。
   - 重写 `hooks/use-features.ts`（502L → ≤ 240L）：DTO 从 `lib/schemas/feature.ts` 直接引入，21 个机械 `useCallback` 改为单一 `useMemo` 工厂构造。
   - 提取 `hooks/use-focus-synced-rpc.ts`（合并 `use-repo-facts.ts` + `use-workspace-paths.ts`）与 `hooks/use-realtime-rpc-store.ts`（收口 `use-lifecycle` / `use-project-colors` / `use-project-icons` / `use-settled-threads` 四份重复的 `requestSeq + retry + realtime + reconnect` 模板）。
   - 抽取 `components/inbox/repo-role-branch-list.tsx` 给 `FeatureCreateDialog`、`FeaturePromoteDialog`、`FeatureHubRepos` 三处复用。
4. **精简过度特效与复用 BB SDK 0.6.157 原生组件（−900 ~ −1,200L，−6 文件）**：
   - 删掉 `pin-button.css` / `snooze-button.css` / `settle-button.css`（415L 粒子特效 CSS）并大幅精简 `row-controls.tsx`（377L → ≤ 140L），使用干净的 Tailwind hover/active 微动效。
   - 评估并替换为 `@get-bb/plugin-sdk/app` 0.6.157 已内置的 `experimental_ProviderIcon`、`experimental_ThreadStatusGlyph`、`experimental_ThreadRowMetadata`、`experimental_ThreadActionsMenu`（如主题色变量完全兼容则直接删除 Harbor 自维护的 772L 副本；若有细微差异则仅保留极薄 adapter）。
5. **清除前端死代码、浅封装与拆解巨型组件（−1,050 ~ −1,450L，−10 文件）**：
   - 清理 `TreeRowHandlers` 中 5 个 0 读取死字段（`projectReorderEnabled`、`projectReorderDisabledReason`、`onProjectReorder`、`onProjectKeyboardMove`、`onRenameProject`）与 `useInboxActions.renameProject`；清理 `coarse-pointer-sizing.ts` 中 20/22 未用常量、`family-status.tsx` / `row-metadata.tsx` / `status-glyph.tsx` / `ui/*` 未用导出、`WorkspaceTabStrip.tsx:136-138` 重复 `useEffect`、`group-section.tsx` 无外部调用者的 `GroupShell` 与旧属性 `data-nested-group`。
   - 内联单调用浅壳：`inbox-overlays.tsx`、`icon-button.tsx`、`group-badge.tsx`（并入 `ProjectBadge`）、`thread-row-parts.tsx`、`motion.ts`；统一 `SurfaceSwitch` + `OrganizationSwitch` 为 `<SegmentedBar>`；统一 `SlimRow` / `ArchivedShelf` 行 / `CompactThreadRow` 为 `<CompactThreadRow>`；统一 `FeatureMetaLine` + `RepositoriesLine`。
   - 拆分 `TreeRowHandlersContext` 为 `TreeActionsContext`（稳定回调）+ `TreeLiveStateContext`（`activeThreadId`、`now`、`selectedRootIds`），让 `ThreadCard` 直接消费拆分后的上下文，取消 `FamilyRow → ThreadCard` 23 个 prop 拆装层。
   - 拆解剩余 400+ 行巨型组件：`FeatureHubOverview`（拆出 `BriefSection`、`ReferencesSection`、`ParkSection`）、`FeatureCreateDialog`（拆出 `PresetBar` 与 `WorkspaceImport`）、`WorkspaceTabStrip`（拆出 `CompactTabChip` 与 `TabItem`）、`ThreadInbox`（压平 3 跳大对象传参）。

---

## 5. 分波执行路线、验收门禁与删除台账

### 5.1 分波实施计划（每波独立全绿 + 一次本地 Commit）

| 波次 | 范围 | 核心交付物 | 验收门禁 |
| :--- | :--- | :--- | :--- |
| **Wave 0 · 基线对齐** | 清理前序未提交的过渡文件 | 确认以 `02a2b0a` 为起点，移除未落盘的旧 10 开关 KV 草案，确保工作树干净 | `git status` 干净；`npm run check` 全绿 |
| **Wave 1 · 左侧栏 IA、Worktree 与浮层体系治理** | §1.1–§1.5 全部项 | Worktree 双层披露 + 批量清理弹窗；Feature worktree 零误报；`Features` / `Projects` 严格分离 + 修 5 处半迁移 Bug；Chrome 视觉降噪与 `ViewMenu` 收口；全局浮层互斥协调器 + z-index 阶梯 + 补齐 BB `data-radix-*-content` 主题契约（删 `harbor-opaque-surface`）+ 轻量 `HoverPreview` / `Copy ▸` / `InspectDetailsModal` 分层 | `npm run check` + 新增 `worktree-tiering.test.ts` 与 `overlay-coordinator.test.ts`；真实浏览器验证：11 个旧 `bb/*` 折成 1 行、`Projects → All` 零 Feature、悬停后右键+子菜单**绝不出现双层/三层叠窗**、暗/亮与 `chatgpt-skin` 下全部浮层材质/圆角/阴影完全一致 |
| **Wave 2 · 唯一 Feature Hub & 删冗余表面** | §2.1–§2.3 全部项 | 删除 3 个旧 Feature 弹窗；Hub 支持 0 线程/Parked 弹窗兜底 + 切 Tab 保留草稿；`FeatureHubChanges` 升级为跨仓交付矩阵并删单仓提交；删 `.conductor`、`FeatureSelector`、重复 Context Card 槽位；统一 Spawn 链路 | `npm run check`；真实浏览器验证：0 线程/Parked/活跃 Feature 均直达 Hub、跨仓矩阵与原生 Diff 跳转正常、无 `Cmd+R` 劫持 |
| **Wave 3 · Agent 减负 & 设置页大减脂** | §3.1–§3.2 全部项 | 取消 `bb.settings.define` 10 开关墙；落地 3 档 `AgentAccessTier`（默认只读精简上下文）+ 9–10 工具；`appearance:v2` 精简至 11 项 + 串行写锁 + 3 分区清爽设置页 + Diagnostics 真刷新与一键 Activate | `npm run check` + 新增 `agent-access.test.ts`；验证普通对话 Harbor 注入 < 1,000 tokens；浏览器验证 3 分区设置页亮/暗主题与 Diagnostics 刷新 |
| **Wave 4 · 拆测试枷锁 & 全仓结构瘦身** | §4.1–§4.3 全部项 | 先删 29 个源码正则测试与 `_sources.ts` 并补运行时测试；落地 `lib/schemas/*` 单一 Zod 源 + 删 650L 手写 decoder + 合并 RPC/Store/Host 重复 + 清 192 个死导出；前端合并 `WorkspaceRow`、删 1.5kL 移动端抽屉栈、合并 Reorder/Rename/RPC Hooks、拆巨型组件 | `npm run check` + `node scripts/check-sanitization.mjs` + 零 Shim 扫描；统计净删行数与最长函数分布 |
| **Wave 5 · 全功能 Dogfooding 终审** | 端到端回归 | 在真实 BB 桌面/网页环境覆盖 `Threads` + `Workspaces` 双模式、亮/暗主题、1280px 窄屏与常规桌面视口，确认零控制台错误与视觉瑕疵 | 全量浏览器断言 + `npm run check` + `node scripts/check-sanitization.mjs` |

### 5.2 零 Shim 专项校验清单（每波合入前必跑）

```sh
# 1. 全套类型、严格模式、Lint、测试与构建
cd plugins/harbor && npm run check

# 2. 公开仓库脱敏扫描（严禁泄漏私有路径/项目名/主机 ID）
cd ../.. && node scripts/check-sanitization.mjs

# 3. 零 Shim 残留符号巡检（Wave 4 完成后全部应返回 0 命中）
rg -n "FEATURES_SCOPE_KEY|legacyFeaturesScope|legacyWorkspaceKeys|LEGACY_ROOT_SCHEME|data-nested-group|projectStatusSignals|workspaceStatusSignals|mergeWorkspaceRefs|reorderProjectDrop|useBrowserDimmingModal|AGENT_TOOL_SETTING_DESCRIPTORS|hiddenFeatureIds|run-workspace-script|\.conductor/settings\.toml|harbor-opaque-surface|useOverlayPortalContainer" plugins/harbor
```

### 5.3 彻底删除文件总台账（共 ~68 文件）

- **冗余弹窗与表面（12 文件）**：`components/inbox/feature-brief-dialog.tsx`、`components/inbox/brief/{requirement,references,decisions}-pane.tsx`、`components/inbox/feature-repositories-dialog.tsx`、`components/inbox/feature-park-dialog.tsx`、`components/inbox/feature-selector.tsx`、`hooks/use-feature-selector.tsx`、`app/scripts/run.ts`、`app/scripts/settings.ts`、`components/settings/palette-editor.tsx`、`components/settings/palette-panel.tsx`。
- **前端重复壳与照搬宿主抽屉栈（23 文件）**：`components/inbox/workspace-card.tsx`（并入 `workspace-row.tsx`）、`workspace-drag.ts`、`workspace-dialogs.tsx`、`inbox-overlays.tsx`、`thread-row-parts.tsx`、`thread-rename-dialog.tsx`、`pin-button.css`、`snooze-button.css`、`settle-button.css`、`hooks/reorder/use-{family,project,workspace}-reorder.ts`、`hooks/useBrowserDimmingModal.ts`、`components/ui/dialog.tsx`、`components/ui/dialog/{dialog-compact,dialog-floating}.tsx`、`components/ui/drawer/{responsive-drawer-shell,focus-trap,drawer-drag,keyboard-inset}.tsx/ts`、`components/ui/responsive-overlay.tsx`、`components/ui/overlay-trigger.ts`、`components/ui/icon-button.tsx`、`components/ui/group-badge.tsx`、`components/ui/motion.ts`。
- **非 UI 冗余契约、薄 RPC 与微文件（~15 文件）**：`server/contract-schemas.ts`、`server/contract-feature-cockpit.ts`、`lib/persistence/store-snapshot.ts`、`lib/ui/workspace-changes.ts`、`lib/domain/codepoint.ts`、`lib/ui/row-pointer-events.ts`、`lib/domain/errors.ts`、`server/lifecycle-store.ts`、`lib/domain/thread-row-link.ts`、`lib/domain/group-scope-icons.ts`、`lib/stores/scope-icon-store.ts`、`lib/agent/settings.ts`（由 `lib/domain/agent-access.ts` 取代）、以及合并后的零碎 `server/rpc/{appearance,bulk,colors,prefs,shelf,order,pinned,groups}.ts`。
- **脆弱源码正则测试与过期测试（~19 文件）**：`test/_sources.ts`、17 个纯源码正则测试文件、`test/run-settings.test.ts`、`test/feature-selector.test.ts`。
