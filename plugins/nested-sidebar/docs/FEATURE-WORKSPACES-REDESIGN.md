# 功能工作区：从零评估与改造计划

状态：已实施（2026-11-06）。决策 D1 = 共享 Features 项目，D2 = 所有仓共用 `feat/<slug>`，D3 = 点击功能行只展开或收起。实施记录见第 8 节。
范围：`plugins/nested-sidebar` 的功能维度（features）全链路：数据、归属、物化、上下文、界面、agent 能力。
基线：`main` 的 `1dc051e` 加上评估时工作区里未提交的改动。
与 `FEATURE-WORKSPACES-PLAN.md` 的关系：那份文档记录了这个功能是怎么一步步做出来的。本文不受现有代码约束，只拿最初的理念当标尺，回答它应该是什么样，以及怎么改过去。

---

## 0. 结论

现在的实现把「功能」做成了一个**标签加一个物化对话框**。但最初的理念是一个**可以直接走进去、在里面说话的地方**。差距不在细节，在三处主干：

1. **核心闭环是断的。** 理念是：先建空壳，在功能根目录里对话，agent 按需把仓库拉进来。现状是：
   - 空壳没有目录，不能对话（`hasDirectory` 为假时「New thread」被禁用）。
   - skill 让 agent 调用的 `nest_feature_context` 和 `nest_feature_add_workspace` 两个工具**根本不存在**。
   - skill 本身没有被选中：`lib/agent/wire.ts:46` 返回的是 `skills: []`。
   - 目录里只有 `NEST.md`，没有任何 provider 会自动读它。新线程又不再发提示词，所以 **agent 进了功能目录也不知道自己在哪**。
2. **归属有三套事实，彼此打架。** 一个 worktree 或线程属于哪个功能，同时由三样东西回答：标签表、成员表、路径前缀。成员表的 `environment_id` 永远不会回填，于是 `countThreads` 恒为 0，删除确认会少报损失。标签只在插件自己的 `spawnThread` 里写，从 bb 原生输入框、CLI 或 agent 创建的线程都不会被归入功能。「线程没显示」的根因就在这里。
3. **功能视图是另起的一棵树，没有复用侧边栏的既有能力。** 它不响应分组标签页、搜索和状态过滤，没有置顶、稍后、已完成这三个分区，每条线程下面还多一行 worktree 文案。根对话和仓内对话混在一起，看不出主次。

改造方向，一句话：**功能就是一个目录。磁盘是唯一真源，归属靠路径推导；上下文用 bb 原生的 `agents.configure` 按线程注入，再配合磁盘上的 `AGENTS.md`/`CLAUDE.md`；功能视图复用项目树的全部机制，只换第一层。**

---

## 1. 标尺：从你的原话提炼出的七条理念

后面每一条评估都对照这七条。

| # | 理念 | 来源（你的原话） |
| --- | --- | --- |
| P1 | **一件事一个地方。** 跨仓的一件事收拢到一处，不在项目、worktree 之间来回跳 | 「以一个功能来收拢分组多个项目下的 WorkTree……我要跳来跳去」 |
| P2 | **在功能根目录里对话。** 多个 worktree 物理上放在同一目录下，对话的 cwd 就是这个目录 | 「我只在这个功能目录里根去对话」「让对应多个 WorkTree 实际上在一个目录下面」 |
| P3 | **Nest 原生，不依赖其他插件** | 「不想它依赖插件，而是原生只依靠我们自己单独的 Nest 插件」 |
| P4 | **先空壳，按需物化，由上下文驱动 agent 自己拉仓库** | 「可以先是空壳」「上下文感知……按需把各仓 worktree 拉进自己目录」 |
| P5 | **与分组共存，只有一列。** 功能可以归入分组；项目视图里的 worktree 带功能标识；切换控件在最底部 | 「不要双列 只有单列」「功能也归属到一个分组下」「把切换视图的地方放到最下面」 |
| P6 | **不替用户说话。** 新建线程就是正常新建，靠目录里的 agent 指令文件让 AI 自然读到上下文 | 「为啥点击新建线程默认发一条消息出去……目录下维护一个 agent Markdown」 |
| P7 | **按人的使用情景设计，省空间，视觉一致** | 「为什么把所有 worktree 都直接展示……太占空间」「点了加号不知道线程归属到哪里」「不是你为了快速实现又新编了一套」 |

---

## 2. 现状评估

### 2.1 按理念逐条打分

| 理念 | 现状 | 判定 |
| --- | --- | --- |
| P1 一件事一个地方 | 功能视图存在，但根对话借用「第一个成员的项目」（`thread-inbox.tsx` 的 `openFeatureThread`），于是在项目视图里，它会以一个陌生的 unmanaged workspace 出现在 `tea-app-im` 下面。功能的入口仍然散在两处 | 部分偏离 |
| P2 在根目录对话 | 根目录要等第一次物化才创建；空壳不能对话 | **偏离** |
| P3 Nest 原生 | 已不依赖 reqboard | 符合 |
| P4 空壳 + agent 按需物化 | 空壳只是 DB 里的一行；agent 物化工具不存在；skill 未被选中；skill 声称会跑 setup 钩子，实际没有 | **缺失** |
| P5 共存、单列、底部切换 | 结构上已做到；但底部只有 Project 和 Feature，Machine 仍在 View 菜单里，处于 Machine 模式时底部两个都不亮。功能视图忽略分组标签页 | 部分偏离 |
| P6 不替用户说话 | 未提交的改动已经去掉自动消息，这个方向对。但目录里只有 `NEST.md`，Claude Code 只读 `CLAUDE.md`，Codex 只读 `AGENTS.md`，**没有自动读取的入口**，等于上下文丢了 | **偏离（新回归）** |
| P7 人的情景、省空间、一致 | 每条线程下面多一行 worktree 文案；`+` 的含义随状态变化（没目录时变成「添加仓库」）；功能标识用的是新造的样式（`text-[9.5px] rounded-full border-primary`），`title` 里还是中文；服务端错误文案是中文而界面是英文；物化一次只能选一个仓 | 偏离 |

### 2.2 正确性缺陷

以下每一条都有代码证据。

| 严重度 | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| 高 | **全中文的功能名会派生出相同的分支名** | `lib/feature-materialize.ts:123` 的 `branchForMember` 加 `asciiSlug`。实测：`feat_消息回调转预付费` 和 `feat_计费改造` 都得到 `feat/feat/tea-app-im`；`AI 智能语音插件 2` 和 `AI 语音降噪 2` 都得到 `feat/feat_ai-2/tea-app-im` | 第二个功能物化时会被「分支已被占用」拒绝，而且拒绝理由指向另一个功能，用户无从理解 |
| 高 | **agent 工具不存在，skill 未被选中** | `skills/feature-workspaces/SKILL.md:30,37` 引用的工具在代码里不存在；`lib/agent/wire.ts:46` 返回 `skills: []` | P4 整条链路不可用；skill 若被手动加载，还会让 agent 去调用不存在的工具，并禁止它自己执行 `git worktree add` |
| 高 | **新线程拿不到功能上下文** | 自动消息已去掉，但上下文只写进了 `NEST.md` | agent 不知道自己身在多仓目录里，可能直接在根目录跑 `git status` 和 `npm install` |
| 高 | **线程归属只覆盖插件自己的创建入口** | `server/rpc/projects.ts` 的 `onThreadSpawned` 只在插件的 `spawnThread` RPC 里调用；注释说的「bb 原生输入框、agent 也会经过这里」不成立 | bb 原生创建的线程、`bb thread spawn` 创建的线程、子线程都不会进功能视图，即「线程没显示」 |
| 中 | **成员的 `environment_id` 永不回填** | `server/feature-materialize-service.ts:224` 写入 `null`，之后没有任何代码更新它 | `countThreads` 恒为 0；删除确认少报「会影响的线程」；功能视图里同一个 worktree 也可能被画两次 |
| 中 | **删除文案说「线程会被归档」，实际没有归档** | `lib/features.ts:339` 只生成文案；`deleteFeature` 里没有归档调用 | 承诺与行为不符；被删 worktree 上的线程变成孤儿 |
| 中 | **预检和执行用的是两套规则** | 预检的 `targetExists` 只看 `git worktree list`（`feature-materialize-service.ts:137`）；执行时 `createWorktree` 另外检查 `existsSync`（`host/feature-worktree.ts:213`） | 残留的普通目录在预检里显示「Ready」，点了却失败，正好违背文件头注释自己写的原则 |
| 中 | **基线是主 checkout 的 `HEAD`** | `baseRef: null` 加 `baseRef ?? "HEAD"` | 主仓当前停在哪个分支，新功能就从哪里开，不是从最新的 `origin` 默认分支开 |
| 中 | **新 worktree 没有初始化** | 没有 setup 步骤 | 没有 `node_modules`、`.env` 和 submodule，agent 第一件事就是装依赖 |
| 中 | **在迁移日志之外执行 `ALTER TABLE`** | `lib/feature-store.ts:147` 的 `ensureColumn("feature_members", "project_id", …)`，在 store 构造时执行 | 绕过了 bb 的只追加迁移日志；如果早于迁移执行，表还不存在，会直接报错。这与文件里自己写的迁移纪律矛盾 |
| 低 | **只检查第一台机器** | `server/feature-wiring.ts:171` 取 `members[0].hostId` | 成员分布在多台机器时，其余成员的损失不会被统计 |
| 低 | **功能 id 带中文，目录名也跟着带中文** | `featureIdFrom` 保留 `\p{L}` | 在 `~/NestFeatures/feat_ai-智能语音插件-2` 这样的路径下，shell 补全、部分工具链和日志都会更难处理 |

### 2.3 交互与视觉问题（按使用情景）

先走一遍真实情景：「我要做『消息回调转预付费』，它涉及控制台和购买页两个仓」。

| 步骤 | 你期望 | 现状 |
| --- | --- | --- |
| 1. 建功能 | 起个名字，选好涉及的仓，回车 | 只能起名和选分组；仓要另开对话框，一次一个 |
| 2. 开始干活 | 立刻进入一个对话，agent 已经知道这件事和这两个仓 | 空壳不能对话；物化之后能对话，但 agent 什么上下文都没有 |
| 3. 对话中发现还要动第三个仓 | 直接对 agent 说「把 intl 也拉进来」 | 做不到，只能回到侧边栏手动点物化 |
| 4. 过两天回来 | 在侧边栏一眼看到这件事：谁在跑、谁在等我、PR 到哪一步了 | 能看到线程，但每条线程多占一行；没有 PR 汇总；根对话和仓内对话分不出来 |
| 5. 在项目视图找同一个 worktree | worktree 的名字就是功能名，点一下能跳到功能 | worktree 标签是仓库目录名（所有功能下都叫 `tea-app-im`），只能靠一个小徽标区分，徽标也不能点 |
| 6. 做完了 | 一键「完成」：检查未推送和未合并、归档线程、回收 worktree、保留分支 | 只有「删除」，而且线程统计恒为 0 |

几处具体的界面问题：

- **`+` 一键两义。** 没目录时 `+` 是「添加仓库」，有目录时是「新线程」（`feature-node.tsx`）。同一个图标、同一个位置，行为却随不可见的状态变化，这正是「点了加号不知道去哪了」的来源之一。
- **新线程不会出现在用户眼前。** 创建后不会展开所在的功能、不会选中新线程、也不会滚动到它；再加上归属缺陷，线程可能根本不出现。
- **底部切换和 View 菜单是两个入口，状态还不同步**（Machine 模式）。
- **功能视图里的分组标签页是摆设。** 标签页显示了，点了不过滤。
- **徽标和文案另起一套**：`text-[9.5px]`、`rounded-full`、中文 `title`、服务端中文报错，与侧边栏现有的英文和组件语言不一致。

### 2.4 架构层面的根因

上面这些问题并不各自独立，大多出自三个结构性决定：

1. **归属是写入时决定的，不是读取时推导的。** 在 spawn 时打标签，就必须让所有入口都经过插件，可 bb 有太多入口不经过插件。改成读取时按路径推导，所有入口自然都覆盖到。
2. **成员信息存在 DB 里，不从磁盘读。** 磁盘才是事实：agent 手动执行 `git worktree add`、用户手动删目录，DB 都不知道。改成以扫描目录为准、DB 只做缓存，就不会漂移。
3. **功能视图复制了一套渲染，而不是给现有的树换第一层。** 项目树已经有的能力（过滤、搜索、分组标签页、置顶和稍后分区、拖动排序、多选、键盘导航、恢复提示），功能视图只能逐个补，补不全就是一致性问题。

---

## 3. 目标设计

### 3.1 一个心智模型

```text
功能 = 一个目录（~/NestFeatures/<slug>/）
        ├── AGENTS.md          ← Codex 等读取；Nest 生成的托管区块 + 用户自由区
        ├── CLAUDE.md          ← 只有一行 @AGENTS.md
        ├── .nest-feature.json ← 机器可读的身份信息（id、名称、slug、分支约定）
        ├── tea-app-im/        ← git worktree，分支 feat/<slug>
        └── tea-app-im-buy/    ← git worktree，分支 feat/<slug>

在这个目录里（或其子目录里）跑的线程 = 这个功能的线程
在这个目录里的 worktree = 这个功能的成员
```

规则只有三条，全部由路径推导：

- **R1 归属**：`featureOf(path) = 包含该路径的、最深的功能根目录`。功能目录外的已有 worktree，可以显式「收编」（写一条标签），这是唯一需要存储的归属事实。路径推导的结果优先于标签。
- **R2 成员**：一个功能的成员 = 根目录下 `.git` 为文件且指回某个仓库的直接子目录，外加被收编的外部 worktree。只读磁盘，DB 只做缓存。
- **R3 状态**：草稿、进行中、待合并、已完成，全部从成员和 PR 状态推导。只有「已归档」需要存储。

### 3.2 数据模型（取代现有三张表）

```text
features
  id          TEXT PRIMARY KEY      不透明 ASCII id（f_7k2m9x），永不变化
  name        TEXT NOT NULL         显示名，可以是中文，可以改
  slug        TEXT NOT NULL UNIQUE  ASCII，用作目录名和分支名；第一次物化之前可改
  position    INTEGER NOT NULL
  root_path   TEXT NOT NULL         创建时就确定并创建
  host_id     TEXT NOT NULL
  archived_at INTEGER
  created_at, updated_at

feature_adoptions                   只记录「目录外」被收编的 worktree
  environment_id TEXT PRIMARY KEY
  feature_id     TEXT NOT NULL
  adopted_at     INTEGER NOT NULL
```

删除 `feature_members` 和 `feature_workspace_labels`（迁移只追加：新建表，数据迁到新表，旧表留着不读）。`root_path` 在创建时就写入，空壳也有目录。

### 3.3 上下文：不发消息，也不丢上下文（P6）

两层，同时生效：

1. **磁盘层，给任何 agent 用。** 在根目录生成 `AGENTS.md`，Codex 会读；生成 `CLAUDE.md`，内容只有 `@AGENTS.md`，Claude Code 会读。`AGENTS.md` 分两部分：
   - `<!-- nest:managed -->` 区块，由 Nest 维护：这件事是什么、成员表（目录、仓库、分支、基线）、工作守则（每条 git 命令都带 `-C <子目录>`，根目录永远不 `git init`，每个仓各自提交）。
   - 区块之外是用户和 agent 的自由区（需求要点、验收标准、进度笔记），Nest 永不覆盖。
   成员变化时只重写托管区块。
2. **bb 原生层，给 bb 里的线程用。** 在 `bb.agents.configure(ctx)` 里，根据 `ctx.environment.path` 判断线程是否在某个功能里：
   - 在根目录：注入实时上下文（成员、分支、dirty 和 ahead 计数、PR 状态，上限 4096 字），选中 `feature-workspaces` skill 和 `nest_feature_*` 工具。
   - 在某个成员 worktree 里：注入「你在功能 X 的 repo Y 里，兄弟仓库在 `../`」。
   - 不在任何功能里：什么都不加。

   `configure` 要求同步、快速返回，所以复用现有 `lib/agent/index-cache.ts` 的做法，维护一份内存中的功能索引。

这样，新建线程就是正常的空对话，agent 却能自然读到上下文。

### 3.4 agent 能力（P4）

注册为真实工具，挂在 Nest 现有的 agent 工具开关下，新增一个 `features` 开关：

| 工具 | 作用 | 要点 |
| --- | --- | --- |
| `nest_feature_context` | 读取当前功能的实时状态 | 默认取调用线程所在的功能，不需要传 id |
| `nest_feature_add_repos` | 批量拉仓库进来 | 每个仓库单独预检并单独返回结果；幂等；创建后执行 setup |
| `nest_feature_remove_repo` | 移除一个成员 | 先检查 dirty 和未推送，有损失时返回需要确认，而不是直接删 |
| `nest_feature_list` | 列出功能 | 供在功能外的 agent 定位 |
| `nest_feature_start_worker`（P2 阶段） | 在某个成员 worktree 里开一个子线程，挂在根对话下 | 根对话负责编排，各仓的子线程负责执行；在侧边栏里以线程家族的形式出现 |

skill 改写成只描述真实存在的工具，并在 `configure` 里对功能线程选中它。

### 3.5 物化规则（修正）

- **分支名**：功能级的 ASCII slug，默认所有成员共用一个主题分支 `feat/<slug>`。这与 Google `repo start <topic>` 和 meta-repo 工具的惯例一致：同名分支本身就表达「这几个仓是同一件事」，PR 也好对。slug 在创建时根据名称自动建议：有 ASCII 词就取 ASCII 词，没有就用 `f-<短 id>`，并提示用户改。每个仓都可以改成「使用已有分支」，用来收编已经开工的分支。（见 §6 决策 D2）
- **基线**：先 `git fetch`，默认从 `origin/HEAD` 开分支，每个仓都可以改。
- **预检和执行同源**：预检返回目标目录是否存在（包括非 worktree 的残留目录）、分支是否被占用（以及被谁占用）、远端是否可达。执行时完全复用同一个函数。
- **setup**：按顺序找仓库里的 `.nest/setup.sh`、bb 项目配置的环境初始化、包管理器锁文件（`pnpm i`、`npm ci`、`yarn`），默认开启，可关闭。
- **批量**：一次预检多个仓，结果在同一张表里显示，可以只创建能创建的那些。

### 3.6 侧边栏信息结构（P5、P7）

**单列，第一层可切换，下面复用项目树的全部机制。** 功能视图不再是独立的面板，而是 `buildTree` 的另一种分桶：分组 → 功能 → 线程家族。

功能视图的线稿：

```text
 [All] [IM] [IOT] [Ot]                         ← 分组标签页，真的会过滤
 ┌──────────────────────────────────────────┐
 │ ▾ IM                                      │
 │   ▸ ◉ AI 智能语音   2 running · 3 PR   💬 + │  ← 功能行（折叠）
 │   ▾ ● 消息回调转预付费          1 waiting 💬 + │  ← 功能行（展开）
 │       ● 梳理接口改造方案            2m      │  ← 根对话（cwd = 功能目录）
 │         └ ◐ tea-app-im · 修复计费弹窗  run │  ← 子线程，仓库在 metadata 里
 │       ○ tea-app-im-buy · 下单页联调   1h   │  ← 成员 worktree 里的线程
 │       ⌄ 2 repos  tea-app-im ✓ · buy ●      │  ← 成员条：一行，默认折叠
 └──────────────────────────────────────────┘
 [ Project | Feature | Machine ]                ← 底部唯一的切换入口
```

交互规则：

| 元素 | 行为 |
| --- | --- |
| 功能行，点标题 | **进入功能**：打开最近一次活跃的根对话；没有根对话时，打开新建对话框，预填功能目录 |
| 功能行，点箭头 | 展开或收起，与项目行一致 |
| `💬` 按钮 | 同「点标题」，悬停时显示「Open \<最近根对话的标题\>」 |
| `+` 按钮 | **永远是**「在这个功能里新建对话」。对话框标题写「New thread in \<功能名\>」，并显示目录 |
| 展开后的内容 | 线程家族，按关注度排序（等我、运行中、其他）。仓库名放进行内的 metadata 位，不另起一行 |
| 成员条 | 一行汇总：仓库数、每个仓的状态点（✓ 干净、● 有改动、↑ 未推送、PR 状态）。点开后每个仓一行（分支、基线、状态），每行的 `⋯` 菜单里有「在项目视图中显示 / 移除 / 新建线程于此仓」 |
| 新建线程之后 | 乐观插入一行，立即展开所在功能，选中并滚动到新线程，toast 提示「Started in \<功能名\>」 |
| 右键功能行 | Rename · Repositories… · Reveal in Finder · Copy path · Finish feature… · Delete feature… |

项目视图：

| 元素 | 行为 |
| --- | --- |
| 功能目录里的 worktree | 行标签显示**功能名**，原来所有功能下都叫 `tea-app-im`；分支名放在 detail 位 |
| 功能标识 | 用侧边栏已有的 chip 或 alias 样式，不新造样式。点一下切到功能视图并定位到该功能 |
| 被收编的外部 worktree | 同样显示标识；右键里有「Move into feature / Release」 |
| 功能的根目录 | 不在项目视图里出现（见 §6 决策 D1） |

底部切换：作为唯一入口，包含 Project / Feature / Machine 三项（只有一台机器时隐藏 Machine），从 View 菜单里移除这一项。

### 3.7 生命周期（P4、P7）

| 状态（推导） | 条件 | 行上的提示 |
| --- | --- | --- |
| Draft | 没有成员 | 灰色标题加「no repos」，依然可以对话（规划阶段） |
| Active | 有成员，至少一个有改动或有线程 | 状态点 |
| In review | 所有成员都有 PR 且 PR 处于打开状态 | PR 图标加计数 |
| Done | 所有 PR 都已合并，或成员没有剩余改动 | 对勾，提示「Finish?」 |
| Archived（存储） | 用户执行了「Finish feature」 | 移到底部的已归档区，与已完成分区的交互一致 |

**Finish feature** 与 **Delete feature** 分成两个动作：

- **Finish**：预检（dirty、未推送、未合并的 PR）→ 用 `bb.sdk.environments.archiveThreads` 归档线程 → `git worktree remove` 回收成员 → **保留分支** → 保留目录里的 `AGENTS.md` 作为记录 → 标记为已归档。
- **Delete**：在 Finish 的基础上再删目录，可选删分支。有损失时必须输入功能名确认，沿用现有模式。

---

## 4. 改造计划

每个阶段都能独立验收；后一阶段依赖前一阶段，但每个阶段完成后侧边栏都保持可用。

```text
阶段 0 止血 ──▶ 阶段 1 模型重构 ──▶ 阶段 2 上下文与 agent ──▶ 阶段 3 交互重做 ──▶ 阶段 4 生命周期 ──▶ 阶段 5 收尾
  (0.5d)         (2-3d)               (2d)                     (3-4d)              (2d)               (1d)
```

### 阶段 0：探针与止血（0.5 天）

先跑四个探针，结论会改变后面的设计，必须先做：

| 探针 | 问题 | 影响 |
| --- | --- | --- |
| S1 | `bb.sdk.projects.create` 能否把非 git 目录 `~/NestFeatures` 作为 `local_path` 源？在它下面能否用 unmanaged workspace 开线程？ | 决定 D1：根对话归到哪个项目 |
| S2 | 对 unmanaged environment 调用 `agents.configure(ctx)` 时，`ctx.environment.path` 是否有值？ | 决定 §3.3 的 bb 原生层是否成立 |
| S3 | 在非 git 的 cwd 里，Claude Code 是否读取 `CLAUDE.md`、Codex 是否读取 `AGENTS.md`？ | 决定磁盘层需要生成哪些文件 |
| S4 | `threads.spawn` 带 `parentThreadId` 时，能否把子线程放到另一个 environment（成员 worktree）里？ | 决定 `nest_feature_start_worker` 能否做 |

止血项（不改模型，只修错）：

- 在 `configure` 里把 skill 选中，并先从 skill 里删掉对不存在工具的描述。
- 在根目录补写 `AGENTS.md` 和 `CLAUDE.md`（先复用 `NEST.md` 的内容）。
- 修复分支名冲突：功能 id 改成 ASCII 不透明 id；对已有的中文 id，在 `asciiSlug` 退化时追加 id 的短哈希。
- 把预检和执行的目录存在性检查合成一个函数。

**验收**：用两个全中文名的功能，分别物化同一个仓，两次都成功；在功能根目录用 bb 原生输入框新建线程，问「你在哪、有哪些仓」，回答正确。

### 阶段 1：归属与数据模型重构（2 到 3 天）

- 新增迁移：`features` 补上 `slug`、`archived_at`、`created_at`，新建 `feature_adoptions` 表，数据从旧表迁过来。迁移只追加，并删除 `ensureColumn` 这种绕过日志的写法。
- 新的 host 命令 `scanFeatureDirectory(rootPath)`：返回各子目录的 worktree 身份（仓库、分支、dirty、ahead）。
- `lib/feature-attribution.ts`（纯函数）：`featureOfPath`、`featureOfEnvironment`，实现路径优先、收编次之。
- 视图模型改成读取时推导；删除 `onThreadSpawned`、`members.environmentId`、`recordMember`。
- 创建功能时立即建目录、写入 manifest、`AGENTS.md` 和 `CLAUDE.md`。
- 统一错误模型：服务端返回 `code` 和参数，文案由前端按英文渲染，不再出现中文硬编码。

**验收**：
- 用 `bb thread spawn --environment <功能目录>`（不经过插件）创建的线程，会出现在功能视图里。
- agent 在功能目录里手动执行 `git worktree add` 后，成员条自动出现这个新成员。
- 删除确认里的线程数正确。

### 阶段 2：上下文注入与 agent 工具（2 天）

- `lib/agent/feature-context.ts`：渲染 ≤4096 字的实时上下文，基于内存索引，满足同步要求。
- `wire.ts` 里的 `configure` 按 `ctx.environment.path` 选择工具、skill 和 instructions。
- 注册 `nest_feature_context`、`nest_feature_add_repos`、`nest_feature_remove_repo`、`nest_feature_list`，并在设置里加一个 `features` 开关。
- `AGENTS.md` 托管区块的读写工具函数，保证区块之外的内容永不被覆盖。
- 物化补上基线（fetch 后用 `origin/HEAD`）、setup 步骤和批量模式。
- 重写 skill。

**验收**：
- 空壳功能里开一个对话，说「把 tea-app-im 和 buy 拉进来」，agent 调用工具成功，成员条随之更新，`AGENTS.md` 的托管区块随之刷新。
- 对一个分支被占用的仓，agent 收到的结构化拒绝信息里包含占用路径。

### 阶段 3：交互重做（3 到 4 天）

- 用 `buildTree` 的分桶参数实现「分组 → 功能 → 家族」，删除独立的 `FeatureTreePanel` 渲染路径。功能视图因此自动获得过滤、搜索、分组标签页、置顶和稍后分区、多选、键盘导航和恢复提示。
- `FeatureNode` 改用项目行的骨架；仓库名进入行内 metadata 位；新增成员条组件，默认折叠。
- 功能行的点击行为：标题进入功能，箭头展开，`💬` 打开根对话，`+` 永远是新建。
- 新建流程：乐观插入，然后展开、选中、滚动、toast。
- 新建功能对话框：名称、分组（默认当前标签页）、仓库多选（可以不选）、slug 建议、「创建后立即开始对话」（默认勾选）。
- 添加仓库对话框：多选，每个仓一行显示预检结果，可选分支和基线。
- 项目视图：功能目录里的 worktree 显示功能名；标识复用现有的 chip 样式，点击可跳转。
- 底部切换包含三项，作为唯一入口；从 View 菜单里移除。
- 扩展 `feature-surface-contract.test.ts`：禁止出现任意像素值的 class（`text-[` 之类）；功能行必须由项目行的骨架渲染；所有面向用户的文案必须来自前端。

**验收**：跑完 §2.3 的六步情景，每一步都满足「你期望」那一列；用 impeccable 做一轮视觉审计，没有新造的样式。

### 阶段 4：生命周期（2 天）

- 推导状态，并在功能行上显示 PR 汇总（`environments.pullRequest`）。
- Finish 流程：预检、归档线程、回收成员、保留分支、进入已归档区。
- Delete 流程：复用 Finish，再删目录，可选删分支。
- 已归档区的交互与已完成分区一致。

**验收**：在一个有已合并 PR 的功能上执行 Finish，线程被归档、worktree 被回收、分支还在、`AGENTS.md` 还在。

### 阶段 5：收尾（1 天）

- `FEATURE-WORKSPACES-PLAN.md` 标记为历史文档，以本文为准；更新 README 和 `GATES.md`。
- 补 e2e 脚本：真实执行创建、对话、agent 物化、Finish，并把输出写进测试报告。
- `nest_feature_start_worker`：只有 S4 探针通过才做。

---

## 5. 删除清单

改造后不再需要的东西，避免新旧两套并存：

| 删除 | 原因 |
| --- | --- |
| `feature_workspace_labels`、`feature_members` 两张表的读路径 | 改为路径推导，加收编表 |
| `onThreadSpawned` 及其在 `projects.ts` 里的接线 | 改为读取时推导 |
| `components/inbox/feature-tree-panel.tsx` 的独立渲染 | 合入 `buildTree` |
| `NEST.md` | 被 `AGENTS.md` 和 `CLAUDE.md` 取代 |
| `lib/feature-view.ts` 的大部分 | 只保留分桶函数 |
| View 菜单里的 Organization 项 | 底部切换是唯一入口 |
| 服务端的中文错误字符串 | 改为错误码 |

---

## 6. 需要你拍板的决策

| # | 决策 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | 根对话属于哪个 bb 项目 | A. 一个共享的系统项目「Features」，源目录是 `~/NestFeatures`（要等 S1 探针）· B. 每个功能单独一个项目 · C. 维持现状，借用第一个成员的项目 | **A**。项目视图里会有一个「Features」项目，下面每个功能目录是一个 workspace，这也符合「一件事一个地方」。S1 不通过就选 B |
| D2 | 分支命名 | A. 所有仓共用 `feat/<slug>` · B. 每个仓不同，`feat/<slug>/<repo>`（现状） | **A**。业界多仓的惯例，同名本身就在表达「这是同一件事」。每个仓仍然可以单独改 |
| D3 | 点击功能行的主动作 | A. 进入最近的根对话 · B. 只展开或收起 | **A**。「进入功能」就是进入那场对话，展开交给箭头 |
| D4 | 根对话是否唯一 | A. 允许多个，「进入」打开最近一个 · B. 强制唯一 | **A**。你之前确认过，新对话会自己读目录里的上下文 |
| D5 | 外部已有 worktree 能否收编 | A. 能（标签模式）· B. 不能，只认目录里的 worktree | **A**。存量工作很常见。但要明确标注「不在功能目录内」，提示可以迁入 |

---

## 7. 风险

| 风险 | 处理 |
| --- | --- |
| S1 或 S2 探针失败 | D1 退回到 B；上下文退回到只靠磁盘层 |
| `configure` 的同步约束 | 使用内存索引，由 realtime 频道触发增量刷新；索引过期最多导致一次线程启动时的上下文略旧 |
| 迁移到新表 | 旧表保留不删，新表从旧表回填；回填失败时降级为路径推导，路径推导本身不依赖存储 |
| 与正在进行的 `thr_za5cd632x7` 冲突 | 它正在改同一批文件。应先让它提交当前改动，再按本计划从阶段 0 开始，避免两套方向叠在一起 |

---

## 8. 实施记录

按第 4 节的阶段落地，与计划的出入如下。

| 计划 | 实际 |
| --- | --- |
| 探针 S1–S4 | S1 通过：非 git 目录可以作为项目源，子目录里能开线程。S3 通过：在非 git 的 cwd 下，Claude Code 读到了 `CLAUDE.md`（内容是 `@AGENTS.md`），Codex 读到了 `AGENTS.md`。S2 在端到端里通过：从 CLI 开出的线程拿到了注入的上下文、skill 和工具。S4 没做 |
| `nest_feature_remove_repo` 给 agent | **没做**。插件的既有原则是 agent 拿不到任何会丢工作的操作，且有测试守着。移除仓库只在侧边栏的 Repositories 对话框里做 |
| 成员只从磁盘读，DB 不存 | 成员确实只从磁盘读。另外加了一张 `feature_branches` 表，只记录功能**创建过**的分支：完成功能会把 worktree 收回，之后磁盘上就不知道哪些仓有 `feat/<slug>`，删除功能时要删分支只能靠这条记录 |
| 新 worktree 的 setup | 复制主仓里未跟踪的 `.env*` 文件，初始化 submodule。装依赖交给 agent：可能要几分钟，宿主调用卡几分钟会让侧边栏看起来像卡死。`AGENTS.md` 里写了每个仓的安装命令 |
| 底部切换三项 | 机器只有一台时隐藏 Machine |

端到端验证用的是 `$TMPDIR` 下的临时仓库和临时 bb 项目，结束后都清掉了：

1. 新建一个带两个仓的功能：目录、`AGENTS.md`、`CLAUDE.md` 都生成了；两个仓都在 `feat/e2e` 上，没有跟踪 main；`.env.local` 复制过去了。
2. 不经过 Nest，用 `bb thread spawn` 在功能目录里开线程：agent 答对了功能名和仓库，`nest_feature_*` 工具都在，`nest_feature_context` 能用。
3. 让这个 agent 把第三个仓拉进来：worktree 建好了，`AGENTS.md` 跟着刷新。
4. 拒绝路径：分支被别处占用时，报出占用路径；有残留的普通目录时，预检就拦下了。
5. 完成功能：有未跟踪文件时，没传确认会被拒绝；确认后 worktree 被收回，分支、目录和笔记都保留，线程被归档；之后可以重新打开。
6. 删除功能：目录删掉了；勾选删分支时，`feat/<slug>` 也删了，包括已经完成过的功能。

旧数据迁移：演示功能「AI 智能语音插件 2」（中文 id）被读成 slug `ai-2`，4 个 worktree 都扫描到了；`NEST.md` 被换成了 `AGENTS.md` 和 `CLAUDE.md`。

### 2026-11-09 调整

三处按实际使用改掉。

- **功能不再归入分组。** 功能视图是一个平铺的列表，没有分组标题，也没有顶部的分组标签。分组是「这个项目放在哪里」，而功能本身就是工作，靠底部的切换找到它；再给它套一层桶没有意义。数据上 `groupId` 从功能模型里去掉了，`features.group_id` 列按迁移只能追加的规则留在库里，但不再读写。创建对话框不再有分组，功能行的右键菜单不再有 Move to group。
- **项目视图不再画 Features 项目。** 它就是 `~/NestFeatures` 那个项目，每个功能目录是它下面的一个 workspace。它的行全部是「某个功能在哪里」，而功能视图已经回答了这个问题；留着它就是同一件事的第二个入口，而且入口上的名字是目录名。它下面的线程仍然会出现在功能视图里——根对话就在那里跑。
- **旧成员的分支会被改到 `feat/<slug>`。** 上一个版本给每个仓生成 `feat/<功能 id>/<仓名>`，与「一个功能一个主题分支」的约定不一致，而且旧规则会把中文 id 变成 `feat_ai-2` 这样的前缀。启动时每个功能检查一次：只改本插件命名的分支，且目标分支在该仓空闲时才改；人自己选的分支不动。演示功能那四个仓已经改到 `feat/ai-2`。

旧演示功能的**目录**仍叫 `feat_ai-智能语音插件-2`（旧版用功能 id 做目录名），因为里面有五个正在使用的根对话，搬目录会让它们的 cwd 失效。它在项目视图里已经看不到；新功能的目录一律用 ASCII slug。

### 2026-11-09 调整：分支按仓库

- **分支是每个仓库自己的属性。** `feat/<slug>` 只是添加仓库时的默认建议；每个仓可以填自己的命名（`feature/…`、带单号的前缀），也可以直接填一个已经存在的分支。创建对话框和「Repositories」对话框里，每个勾选的仓都有一行分支输入。
- **已有成员可以改分支名。** Repositories 对话框里每行有「Branch」，改完调用 `git branch -m`，worktree 和提交都跟着走，记录同步更新。
- **不再自动改名旧分支。** 上一版会在启动时把旧格式改到 `feat/<slug>`；现在各仓可以有自己的命名，这个自动改名被去掉了。
- **删除功能只删 Nest 建过的分支。** 依据是 `feature_branches` 记录，不再按 `feat/<slug>` 去猜；人自己带进来的分支不会被删。
- **功能行不再显示单一分支。** 悬停卡片列出各成员实际所在的分支，`AGENTS.md` 的表格本来就逐仓列出。

### 2026-11-09 调整：功能目录放哪

试过两版，最后定在 bb 自己的目录。

- **不放在家目录，也不放在代码目录。** `~/NestFeatures` 会把一个工作目录放在家目录最上层；后来改成「项目源路径最常见的父目录 + NestFeatures」，虽然和代码放在一起，但那还是用户自己的地方，不是 bb 的。
- **最终：bb 的 host data 目录。** 通过宿主拿 `experimental_paths.dataDir`（这台机器上是 `~/.bb/plugins/nested-sidebar/host-data`），功能目录放在它下面的 `features/`。bb 自己的 managed worktree 也放在 `<host-data>/worktrees`，这是同一套约定。
- **选择结果记在 `feature_roots` 表，并带 `scheme`。** 旧版本选的根如果没有功能在用，会升级到新方案；如果还有功能在旧根下，就继续用旧根——bb 不能改 environment 的路径，搬目录会让已有线程的 cwd 失效。旧演示功能仍在 `~/NestFeatures/feat_ai-智能语音插件-2`。
- **宿主张不到 dataDir 时**退回 `~/NestFeatures`。
- **容器项目按路径登记。** `homeProjects` 是「容器路径 → Features 项目」，旧根和新根各一个，项目视图把两者都隐藏（`featureProjectIds`）。

### 2026-11-09 调整：功能视图总开关

- 设置里新增 **Features · Show the feature view**，默认开。关掉后：底部不再出现 Feature 标签、项目视图不再显示功能标识和收编/移除菜单、功能视图和新建功能入口都不可达；如果当时正停在功能视图，会自动切回项目视图。
- **只隐藏 UI，不删数据。** 功能、目录、标签都保留，重新打开就回来。
- 视图关掉时前端也不再读 `listFeatures`，避免一次只为了画界面而创建 Features 项目。
- agent 工具开关仍独立：`Agents · Work in features` 控制工具和上下文注入，两者互不影响。

### 2026-11-09 修正：空的容器项目也会被隐藏

- 删掉最后一个功能后，`featureProjectIds` 曾变成空集，因为它是从「当前有功能的根」推出来的：功能没了，容器路径也没了，两个空的 `Features` 项目就回到了项目视图里。
- 现在多了一张 `feature_containers` 表，记录**用过的每个容器路径**；`feature_roots` 里每台机器的当前根也计入。即使功能数为零，容器项目仍然隐藏。
- 之前两个空的 `Features` 项目：`~/Documents/Code/NestFeatures` 那个是中间方案留下的，已经删除；`~/.bb/.../host-data/features` 是当前根，保留并隐藏。
