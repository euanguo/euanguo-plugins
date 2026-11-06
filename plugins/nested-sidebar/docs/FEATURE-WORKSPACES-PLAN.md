# 功能工作区：计划与改造方案

状态：标签与物化均已实现。第十四节取代第二节的顺序与第五节的数据结构。
范围：`plugins/nested-sidebar`。不改 bb 内核，不依赖其他插件。

## 目标

一个人手上一件事常常横跨几个仓库。今天这件事散在三到五个项目下，每个项目又各自有 worktree，切换一次上下文要在树里找三层。这份计划把「一件事」提升为侧边栏的第一层维度，让它成为可以直接进入、直接对话的工作区。

具体要达到四件事。

- 新建功能时只建空壳，不立刻占用分支和磁盘。
- 功能目录里有上下文，agent 进入后知道涉及哪些仓库、各自什么状态、下一步该做什么。
- 这个上下文能驱动 agent 自己把需要的 worktree 拉进功能目录。
- 现有分组不因此失效，用户已有的归档习惯照常可用。

## 一、共存还是互斥

结论：共存，且是同一棵树的两种第一层维度，不需要模式互斥。

判断依据来自现有代码，不是偏好。

- `lib/organization.ts` 已经把第一层抽象成「一份行、换一个分桶」。`buildTree` 只读 `assignment[projectId]`，第一层以下完全不变。加一个按功能的视图，不需要第二套树。
- 分组是项目级归档标签，一个项目属于零个或一个分组。功能是工作单元，成员是 workspace，一个 workspace 可以同时出现在多个功能里。两者的归属主体不同，不会互相覆盖。
- 现有分组写入是单键覆盖（`project_group_members` 以 `project_id` 为主键）。功能成员必须多对多（`(feature_id, environment_id)` 双主键），硬塞进分组会同时破坏分桶、排序和状态汇总三处单父假设。

所以规则是三条。

- Group 继续回答「这个项目属于哪个长期归档」。
- Feature 回答「我现在在做哪件事，它横跨哪些 workspace」。
- 两者正交。视图菜单里是并列选项，不是二选一开关；同一个项目可以既在 IM 组，又服务三个功能。

唯一需要互斥的是**项目行在功能视图里的呈现位置**。功能视图按功能分组，所以项目行不再作为一级节点出现；它降级为功能行下 workspace 行的元数据。这是视图规则，不是数据互斥。

## 二、功能的生命周期

功能有四个状态，状态决定目录里有什么。

| 状态 | 目录 | 分支 | 可对话 | 触发方式 |
| --- | --- | --- | --- | --- |
| 空壳 draft | 只有 manifest 和说明 | 不创建 | 可以，根会话只做规划 | 新建功能 |
| 已就绪 ready | 至少一个成员已物化 | 已创建 | 可以 | 用户点物化，或 agent 自己物化 |
| 进行中 active | 有成员在跑 | 已创建 | 可以 | 有 thread 在运行 |
| 已归档 archived | 保留 | 按策略删除 | 只读 | 用户归档，且成员检查通过 |

空壳是默认起点。它让你先把「这件事涉及哪几个仓」写下来，再决定什么时候真的占分支。这与调研里多数工具的差别是有意的：它们大多在创建时就 `git worktree add`，然后在分支被占用时失败回滚。空壳把失败点后移，也让 agent 可以在规划阶段先摸清各仓现状。

空壳允许对话，因为它的目录是普通目录，bb 会把它登记成 unmanaged environment。实测命令与结果见 `docs/FEATURE-WORKSPACES-PLAN.md#七实证记录`。

## 三、目录里的上下文

功能目录不是一个空文件夹。它是 agent 的入口，需要自带三类信息。

- `.nest-feature.json`：机器读的唯一真源。功能身份、成员表、状态、目录布局版本。
- `NEST.md`：人读和 agent 读的说明。这件事做什么、涉及哪些仓、各自职责、验收要点、当前进度。
- 可选的 `AGENTS.md`：如果用户需要 provider 原生的指令发现，在目录根放一份，内容是引用 `NEST.md` 而不是复制。

上下文感知能力分三层，从便宜到贵。

1. 静态注入。创建根 thread 时，Nest 把 manifest 摘要和成员状态渲染成一段文本写入 prompt。不需要读盘，任何 provider 都能用。
2. 工具读取。根会话里注册 `nest_feature_context`，agent 随时重新读取 manifest 与各成员仓库的真实状态。这解决「会话开始时上下文变旧」的问题。
3. 目录内发现。`NEST.md` 在目录根，agent 用普通文件读取就能看到，不依赖任何 provider 的指令加载机制。

第一层必须有，第二层是 agent 能自己推进物化的关键，第三层是兜底。

## 四、agent 自己物化

这是你提的核心能力，也是这份计划里最容易做错的部分。做法是工具加约束，不是让 agent 自由 `git worktree add`。

两个工具。

- `nest_feature_context(featureId)` 读功能现状：成员、分支、每个成员仓库的当前状态、还缺什么。
- `nest_feature_add_workspace(featureId, projectId, branchName?)` 为一个仓库物化一个 worktree 到功能目录，返回子目录路径和环境 id。

约束有五条，缺一条就会在真实使用里出错。

- 先探测再创建。执行 `git worktree list --porcelain`，分支已被任何 worktree 占用就拒绝，并报告占用位置。绝不静默复用别的 worktree，也绝不重复 add 同一分支。
- 路径由 manifest 决定，不由 agent 拼。agent 只给仓库和分支，子目录名由 Nest 计算，避免两个 agent 写出两套布局。
- 父目录永不 `git init`。功能目录一旦成为仓库，子目录会被 `git add -A` 当成 embedded repository。实测已确认。
- 幂等。同一成员重复调用返回既有结果，不重建、不报错。
- 创建后立刻跑该仓库的 setup 钩子。新 worktree 没有 `.env`、`node_modules` 和 submodule，不跑钩子 agent 会先花时间装环境。这是调研里所有成熟工具都做的事。

写边界也要明确。根会话的 cwd 是功能目录，不是任何一个仓库。所以要么要求所有 git 操作用 `git -C <子目录>`，要么把改动按仓派发给子会话。只写一句「不要改错仓库」不够，要么用钩子硬拦，要么用结构保证。

## 五、数据结构

三张表加一个文件。

```text
features
  id            TEXT PRIMARY KEY
  slug          TEXT NOT NULL UNIQUE        目录名，稳定，改名不改它
  title         TEXT NOT NULL
  status        TEXT NOT NULL               draft | ready | active | archived
  root_path     TEXT NOT NULL
  host_id       TEXT
  root_env_id   TEXT                        bb 为根目录登记的 environment
  root_thread_id TEXT
  layout_version INTEGER NOT NULL
  created_at    INTEGER NOT NULL
  updated_at    INTEGER NOT NULL

feature_members
  feature_id     TEXT NOT NULL
  environment_id TEXT                       已物化时有值
  project_id     TEXT NOT NULL
  repo_key       TEXT NOT NULL              Nest 已有的物理身份
  child_dir      TEXT NOT NULL              目录内子目录名
  branch         TEXT
  base_ref       TEXT
  state          TEXT NOT NULL              planned | attached | dirty | missing | merged
  created_at     INTEGER NOT NULL
  updated_at     INTEGER NOT NULL
  PRIMARY KEY (feature_id, repo_key)

feature_events                              可选的审计尾巴
  id         INTEGER PRIMARY KEY
  feature_id TEXT NOT NULL
  kind       TEXT NOT NULL
  payload    TEXT NOT NULL
  created_at INTEGER NOT NULL
```

`.nest-feature.json` 是同一份信息的目录侧副本，字段与表一致，外加 `layoutVersion`。规则是目录文件优先用于重建，表用于快速查询。两者不一致时报诊断，不自动选一边覆盖。

`repo_key` 而不是 `project_id` 做主键的一部分，理由和 `lib/repo-identity.ts` 里写的一样：项目是记录，可能记错；仓库是磁盘事实。

## 六、接口与界面

新增 RPC，全部放在 `server/contract.ts` 与 `server/rpc/features.ts`。

| 方法 | 作用 |
| --- | --- |
| `listFeatures` | 功能列表，含状态汇总与成员计数 |
| `createFeature` | 建空壳：目录 + manifest + 表行，不创建分支 |
| `updateFeature` | 改标题、状态、说明 |
| `archiveFeature` | 归档，先返回阻断项 |
| `listFeatureMembers` | 成员及各自真实状态 |
| `planFeatureMaterialize` | 只读预检：哪些能建、哪些分支被占、哪些目录已存在 |
| `materializeFeatureMember` | 为单个成员物化，幂等 |
| `dematerializeFeatureMember` | 移除单个成员，先检查脏与未推送 |
| `readFeatureContext` | 给根会话用的上下文字符串 |

新增 host 命令：`planWorktreeAdd`、`addWorktree`、`inspectWorktreeAdd`。全部在 `host/` 下，复用现有 `host/git-worktree.ts` 的调用方式。

界面改动四处。

- 视图菜单增加 `By feature`，与 `By project`、`By machine` 并列，写入现有 `view_preferences`。
- 功能行右侧有「打开根对话」，没有根会话时先创建。
- 功能行展开后是成员行，每行显示仓库名、分支、状态和阻断原因。
- 空壳状态显示「规划中」并提供「物化」入口，物化前先显示预检结果。

## 七、实证记录

以下是在本机跑过的，不是推断。

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 两个独立仓库的 worktree 放进同一目录 | `git worktree add <dir>/r1 feat/x`、`r2` 同理 | 各自 `.git` 是文件，指回原仓，分支正确 |
| 父目录不是仓库时子 worktree 是否正常 | `cd <dir> && git status` | `fatal: not a git repository`，子目录不受影响 |
| 父目录是仓库时子 worktree 是否被吞 | 父目录 `git init` 后 `git add -A` | `warning: adding embedded git repository`，子仓变 gitlink |
| 同一分支能否两个 worktree | 再 `add` 到另一个目录 | `fatal: ... already used by worktree` |
| bb 能否用普通目录开 thread | `bb thread spawn --project <id> --environment <dir>` | 成功，自动建 `unmanaged` environment，`isGitRepo:false` |
| personal project 的限制 | 同上但 `--project proj_personal` | `400 Personal project threads must use a personal workspace` |

## 八、分阶段计划

每个阶段都能独立验证，前一个阶段不做完不进下一个。

### 阶段 0：命名与兼容（半天）

- 决定插件显示名与 id 的处理方式，见第九节。
- 若只改显示名，不动 id，不改数据目录，零迁移。
- 在 `package.json` 的 `bb.name` 与 README 更新名称，`id` 保持 `nested-sidebar`。

验证：`bb plugin list` 显示新名称，`bb nest` 命令仍可用，`bb plugin config nested-sidebar` 读出原有设置。

### 阶段 1：功能实体与空壳（2 到 3 天）

- 新增 `lib/features.ts`（纯类型与校验）、`lib/feature-store.ts`（SQLite）、迁移。
- 新增 `server/rpc/features.ts`，实现建、改、列、归档。
- 新增 host 命令 `ensureFeatureDirectory` 与 `writeFeatureManifest`。
- 前端视图菜单增加 `By feature`，先只渲染空壳行。

验证：建一个空壳功能，目录里出现 `.nest-feature.json` 和 `NEST.md`；重启插件后仍在；`bb plugin config` 不报错。

### 阶段 2：上下文与根对话（2 天）

- 实现 `readFeatureContext`，把 manifest 与成员状态渲染成文本。
- 根 thread 创建走现有 `spawnThread`，`environment` 传功能目录，`prompt` 注入上文。
- 注册 agent 工具 `nest_feature_context`、`nest_feature_list`。

验证：建一个空壳并开根对话，问 agent「这件事涉及哪些仓库、各自状态如何」，回答与 manifest 一致。

### 阶段 3：预检与物化（3 到 4 天）

- host 实现 `planWorktreeAdd`，读 `git worktree list --porcelain`。
- 实现 `materializeFeatureMember`，含幂等、分支占用拒绝、setup 钩子。
- 注册 agent 工具 `nest_feature_add_workspace`。
- 前端成员行、预检弹窗、阻断原因。

验证：对已有分支的仓库物化会被拒绝并指出占用位置；对空闲分支物化成功，子目录可独立 `git status`；重复调用不产生第二个 worktree。

### 阶段 4：状态、归档与安全（2 到 3 天）

- 成员状态聚合：dirty、unpushed、missing。
- 归档预检与 `dematerialize`，脏或未推送必须显式确认。
- 与现有 `removeWorktree` 复用同一套安全检查。

验证：有未提交改动的成员不能直接归档；确认后移除且不影响其他成员。

### 阶段 5：skill 与文档（1 天）

- 写 `plugins/nested-sidebar/skills/feature-workspaces/SKILL.md`，见第十节。
- 更新 README、`GATES.md`、`docs/`。

验证：新会话里 agent 能看到并使用该 skill；`bb plugin build` 通过。

## 九、插件改名

结论：改显示名，先不改 id。

原因是插件 id 现在同时是四样东西：数据目录 `~/.bb/plugins/nested-sidebar`、设置命名空间 `bb plugin config nested-sidebar`、CLI 命令 `bb nest` 的来源、以及 `@get-bb/plugin-sdk` 的注册键。改 id 会让已存的 group、排序、别名、视图偏好全部读不到，等于让用户重新配置一次。

可选的名字，按推荐顺序。

- `Nest` 保留。功能工作区是 Nest 的第二种第一层维度，不是另一个产品。名字仍然成立，改动成本为零。
- `Nest · Workspaces`。显示名加限定，id 不变。
- 换一个全新名字。只有在功能工作区成为主能力、且愿意写迁移脚本把旧 id 的数据目录与设置复制到新 id 时才做。迁移脚本要同时处理 SQLite 文件、`bb.settings` 键和 `~/.bb/plugins/<id>` 目录。

我的判断是第一种。名字的作用是让人记住去哪找东西，不是描述所有能力。Nest 现在既管分组又管功能，仍然在管「侧边栏怎么组织」，换名收益低，风险是丢数据。

## 十、配套 skill

插件自带 skill，放在 `plugins/nested-sidebar/skills/`。它服务两类读者：进入功能目录的 agent，以及替用户操作 Nest 的 agent。

草案要点。

- 何时用：任务是跨仓的、需要同时看多个仓库、或者用户提到某个功能名。
- 先读什么：`NEST.md` 和 `.nest-feature.json`，不要凭记忆猜成员。
- 怎么加仓库：调 `nest_feature_add_workspace`，不要自己 `git worktree add`，因为分支占用检查和路径规则在插件里。
- 怎么写文件：功能目录不是仓库，所有 git 操作带 `-C <子目录>`。
- 怎么收尾：改动按仓提交，各自开 PR，不要试图一次提交跨仓改动。
- 失败怎么办：分支被占用、目录已存在、成员脏，各自报什么、怎么恢复。

## 十一、风险与取舍

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 分支独占 | 同一分支不能同时属于两个功能 | 物化前预检并拒绝；提示改分支名 |
| 跨主机 | 不同主机的 worktree 不能放进同一目录 | 功能绑定单一 host，跨主机成员标为不可物化 |
| 存量迁移 | 已存在的 worktree 搬进功能目录要改路径 | 阶段 4 之前只支持新建，不做搬迁 |
| agent 误写 | 根会话 cwd 不是仓库 | 工具约束加根指令，写操作显式带 `-C` |
| 上下文过期 | 会话开始时快照会过时 | 提供 `nest_feature_context` 随时重读 |
| 名称重复 | 两个功能同名导致目录冲突 | slug 唯一，创建时校验 |
| 父目录误建仓 | 子 worktree 变 gitlink | 创建与物化都检查父目录无 `.git` |

## 十二、明确不做

- 不做跨主机的分布式功能目录。
- 不做自动迁移已存在的 worktree，第一阶段只支持新建。
- 不接管 bb 的 project 与 environment 记录，只新增自己的根 environment。
- 不实现跨仓统一提交或跨仓原子 PR，各仓仍各自提交。
- 不替换分组，分组保持现有语义不动。

## 十三、本次已落地的改动

这一节记录本轮真实写进仓库的内容，与上面的实施阶段分开看。上面是计划，这里是现状。

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `docs/FEATURE-WORKSPACES-PLAN.md` | 新增 | 本文件 |
| `skills/feature-workspaces/SKILL.md` | 新增 | 随插件分发的 skill，覆盖读上下文、加仓库、git 作用域、失败处理 |
| `package.json` | 修改 | `bb.skills` 由 `[]` 改为 `["skills"]`；`files` 增加 `skills/` |

验证结果。

- `npm run build` 通过，产出 `dist/server.js`、`dist/app.js`、`dist/host.js` 及其 meta。
- `npm run typecheck` 通过。
- `bb plugin install path:...` 重装成功，插件状态 running。
- `bb skill list` 中出现 `feature-workspaces`，scope 为 `plugin`，路径指向本仓库的 `skills/` 目录。

未做。数据表、RPC、宿主命令、前端功能视图都还没写，它们属于阶段 1 到 4。本文档描述的是那些阶段要做成什么样。

## 十五、实现现状（本仓库当前代码）

第十四节的模型已经落成代码。以下按文件写，凡未列的仍是计划。

| 文件 | 作用 |
| --- | --- |
| `lib/features.ts` | 功能与标签的纯模型：状态、校验、id 派生、按分组分桶、失效标签清理 |
| `lib/feature-store.ts` | 两张表与读写：`features`、`feature_workspace_labels`；删功能连带删标签，删分组把功能退回 Ungrouped |
| `lib/feature-view.ts` | 把线程按标签分桶成 `group -> feature -> workspace`，并给出与项目视图同语义的 scope tabs |
| `lib/inbox-view.ts` | 回答 `firstLevel`，在功能模式下返回功能节点与功能 tabs |
| `lib/organization.ts` | `OrganizationMode` 增加 `feature`，与 `project`、`machine` 并列 |
| `server/rpc/features.ts` | 七个方法：列、建、改名、改状态、改分组、删、给 workspace 打标签 |
| `hooks/use-features.ts` | 前端读与写，订阅 `FEATURES` 频道 |
| `components/inbox/feature-tree-panel.tsx` | 功能视图，含空状态与新建入口 |
| `components/inbox/feature-node.tsx` | 功能行：箭头只展开，标题是功能本身，行下固定展开 |
| `components/inbox/feature-manager-dialog.tsx` | 建、改名、改分组、删除 |
| `components/inbox/organization-switch.tsx` | 底部切换，项目与功能 |
| `components/inbox/workspace-row.tsx` | 项目视图的 worktree 行显示功能标识 |
| `components/inbox/workspace-row-menu.tsx` | 右键菜单里给 worktree 选功能或清除 |

验证。

- `npm run typecheck` 与 `typecheck:strict` 通过。
- `npm test` 999 项通过，其中新增 21 项覆盖标签、存储、分桶与失效清理。
- 真实服务端到端：建功能 → 给真实 environment 打标签 → 读回 → 删功能 → 标签自动清空，全部符合预期。

## 十六、物化（已实现）

功能行右侧的 `+` 打开「添加仓库」：选一个仓库，先看预检，再创建。预检是单独一次读，因为最常见的结果是拒绝。

| 文件 | 作用 |
| --- | --- |
| `lib/feature-materialize.ts` | 纯决策：分支占用、目录残留、源不是仓库、拒绝嵌套 |
| `host/feature-worktree.ts` | 真实 git：`worktree list --porcelain`、`worktree add`、写上下文、回收目录 |
| `server/feature-materialize-service.ts` | 编排预检与创建，记录成员，写回根路径 |
| `server/feature-wiring.ts` | 服务端的装配与迁移清单，让入口点保持在一页内 |
| `components/inbox/feature-materialize-dialog.tsx` | 选仓库、看预检、创建或补登记 |

三条 git 硬约束由代码保证，不是靠文档。

- 一个分支只能一个 worktree。占用了就拒绝，并说出占用路径。
- 同一分支同一路径是幂等：返回 `reused`，不建第二个。
- 目录残留不删，只报告。删别人的目录不是这个功能该做的事。

删除功能时，成员目录通过 `git worktree remove` 回收，功能目录在只剩插件自己的两个文件时一并删除；里面有别的东西就保留。真实端到端验证过：建、物化、删除，`removedDirectories: 1`、`removedFeatureDirectory: true`，`git worktree list` 回到只剩主仓。

仍未做。

- 根会话：没有在功能目录里开 thread，也没有把上下文注入 prompt。`NEST.md` 与 `.nest-feature.json` 已经写好，agent 可以自己读。
- 功能行右键菜单：目前是底部切换、行内 `+` 与功能面板。
- 功能排序：存储层支持，界面未接。
- 成员回收前的脏检查：删功能目前直接 `--force`，尚未像 worktree 行那样先问一次。

## 十四、模型修订：标签优先

这一节是对前面设计的修正，不是补充。它取代第二节「先物化」的顺序，也取代第五节的数据结构。保留原文是因为推理过程有用，但实现按这一节来。

### 归属方向反过来

旧模型把归属写在功能一侧，功能是一个容器，成员表列着它拥有的仓库和分支。问题是 worktree 常常先存在、功能后出现，容器模型就要求用户先把已有 worktree 迁进目录，或者维护一份「计划成员」和「实际成员」两套数据。

新模型把标签写在 worktree 一侧。一个 workspace 记一个 `feature_id`，功能和项目并列成为同一批行的两种分桶。这与现有 `project_group_members` 的形状完全一致，单键覆盖，不需要新的多对多机制。

```text
features
  id, slug, title, status      status: draft | active | archived
  group_id                     nullable, reuses project_groups
  root_path, host_id, root_env_id   nullable, only when materialized
  created_at, updated_at

feature_workspaces             the label
  environment_id  TEXT PRIMARY KEY
  feature_id      TEXT NOT NULL
  source          TEXT NOT NULL   'labeled' | 'path'
  labeled_at      INTEGER NOT NULL
```

`features` 不再有成员表。空壳就是一个没有任何标签的功能，加上一份 `NEST.md` 说明它打算涉及什么。计划是散文，机器状态只有标签。

### 一条 worktree 只挂一个功能

理由和 git 一样：一个 worktree 就是一个分支，一个分支就是一件事。要两件事，开两个 worktree。这样标签可以单键存储，功能视图不会把一个 workspace 画两次。两个功能共用一个 worktree 在 git 层面也无法物化成两个目录，所以这条限制不需要额外维护。

### 功能可以归属分组，但分组只决定它出现在哪

规则有两条，缺一条就会出错。

- 功能的分组是归档位置，不是包含关系。一个归档到 IM 的功能，可以包含 Ot 组里仓库的 worktree。「AI 语音」在现有数据里正好横跨 IM 和 Ot，这条规则就是为它写的。
- 分组的状态汇总只来自项目。功能行贡献零。同一个 worktree 已经在项目树里被计过一次，如果功能行再计一次，分组角标就不可信了。功能行显示自己的计数，不向上汇总。

代价是三处界面要改。分组管理对话框要能同时改项目和功能。删除分组时两类都要落回 Ungrouped。分组标签上的计数要能区分「项目」和「功能」，不能加在一起。

### 物化降级为可选

空壳不需要目录。物化是后面的一步，做两件事：在功能目录里 `git worktree add`，然后写一条 `source = 'path'` 的标签。

路径与标签冲突时的优先级，沿用 Nest 已经确立的规则：磁盘事实优先。worktree 在功能 A 的目录里，标签就被推导成 A，显式改成 B 会被拒绝并报诊断。这和 `workspaceOwnership` 覆盖 `projectId` 是同一条原则。

### 显示控制用两轴，不用三态

「只项目 / 只功能 / 同时」这个三态里，「同时」没有唯一定义，会不断长边界条件。换成两个正交控制。

| 控制 | 取值 | 作用 |
| --- | --- | --- |
| 分组方式 | 按项目 / 按功能 | 决定第一层是什么 |
| 功能标签 | 显示 / 隐藏 | 只在按项目时生效，给 worktree 行加功能标识 |

三个意图的映射。

- 只项目 = 按项目 + 标签隐藏。这就是今天的样子。
- 只功能 = 按功能。
- 同时 = 按项目 + 标签显示。

这样任何时刻只有一棵树，不存在同一行出现两次、选中态分叉、键盘遍历重复的问题。

### 点击行为

- 功能行有两个热区。左侧箭头只负责展开收起，标题点击打开功能本身。整行既展开又打开是没有答案的交互。
- 功能下的 worktree 行，点击就地展开它的线程族。不要跳到项目视图，跳转会重新交一次导航税，而这正是功能视图要消除的东西。
- 「在项目中显示」作为显式动作放在右键或行内次要位置，用于需要看兄弟节点的少数场景。

行下固定一条折叠行的做法，复用现有的 `RowDisclosure`，它已经带 `aria-controls` 和展开旋转，覆盖了键盘与触屏。不要用 hover 浮层，它在触屏和键盘下都不可达。
