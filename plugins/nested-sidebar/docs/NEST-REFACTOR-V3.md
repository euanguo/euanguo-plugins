# Nest 插件多维度评审与改造计划 v3

状态：评审完成，计划待执行。  
基线：`feat/nest-workspaces`，`nested-sidebar@0.7.1`，SDK 0.6.141。  
评审方式：六个只读切片并行，全部使用 `claude-deepseek-v4.1-flash[1m]`、`xhigh`。评审线程未修改任何文件。

## 0. 一句话结论

产品方向和领域设计是这个仓库最强的部分。主要问题不在代码风格，而在同一个事实有多个住处，由此产生了当前已坏但未被测试覆盖的路径，以及一套会阻碍重构的实现锁定测试。改造的主线是收敛归属，不是重写。

## 1. 基线

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run typecheck:strict` | 通过，覆盖 282 个生产文件 |
| `npm test` | 1235 个测试，264 个 suite，0 失败，约 4.5 秒 |
| `npm run build` | 通过 |
| 生产源码 | 50,113 行，`app/components/hooks/lib/server/host` |
| 测试 | 22,341 行，128 个文件，3,146 条断言 |
| 对外表面 | 61 个 RPC 方法，27 个 agent tool，10 个 agent 开关 |

## 2. 评审结论

### 2.1 总体判断

| 维度 | 结论 | 主要风险 |
| --- | --- | --- |
| 产品与领域设计 | 强。归属从磁盘和 bb 派生，只有人的决定落库 | 派生规则有三套实现时，归属会漂移 |
| 架构与边界 | 方向正确，host 与 server 的职责切得干净 | `lib/` 混了纯规则、SQLite store、React 三层 |
| 服务端与 host | 破坏性操作有很好的协议和守卫 | 2 个 P0，3 条可能丢数据或误删的路径 |
| 领域与持久化 | 迁移 append-only、读时校验、快照防崩 | 三套 workspace 身份、两套索引、三份 settled 状态 |
| UI 组件 | 视觉系统清楚，行组件覆盖面完整 | 同一行骨架抄了 4 到 7 份，无 memo，焦点环缺失 |
| Hooks 与前端状态 | 组合丰富，单文件小而多 | 同一事实重复读取，双重写入，订阅者各自为政 |
| 测试与门禁 | 测试快、数量大、纯函数覆盖好 | 53 个测试读源码，36 个不 import 生产模块；无 lint、无 CI |
| 文档与打包 | 注释和文档质量高 | README 自相矛盾，计划文档过期，8 个依赖未使用 |

这不是一个需要重写的代码库，而是一个需要把同一件事实收回一个家的代码库。改造的价值在删除重复的写者、重复的身份和重复的派生，不在新增抽象。

### 2.2 必须保留的优点

1. 归属从磁盘和 bb 派生。Feature 成员不落库，workspace 索引不落库。第一个 `git worktree add` 不会让副本过期。`lib/features.ts:1-28`
2. 迁移 append-only 且事务化。bb 按 index 记录 hash，改旧语句会让插件拒绝加载。`lib/feature-store.ts:43-50`、`server.ts:59-84`
3. 破坏性操作的协议。批量删除的 token、60 秒 TTL、族谱二次比对、working/waiting/unread/pinned 拦截；worktree 移除的 survey、refusal、acknowledgement；feature removal 的纯函数计划。`lib/bulk-delete.ts`、`lib/worktree-removal.ts`、`lib/features.ts:342-400`
4. 纯决策与传输分离。`planWorktreeRemoval`、`features.ts`、`repo-identity.ts`、`realtime-coalesce.ts` 都能无依赖单测，这是 1235 个测试 4.5 秒跑完的原因。
5. host 只做形状转换。`host/contract.ts` 明确拒绝的理由是决策，host 没有一行 domain 规则。
6. agent 表面有门禁。27 个 tool 按 feature 映射到 10 个开关，注册不能撤销时用运行时读 flag 加 `configure` 双保险；指令 4096 字符上限，按重要性整段丢弃；名称去控制字符并加引号。
7. 暖启动和快照的防崩设计。localStorage 用户可写且跨插件共享，decode 绝不 throw，尺寸有上限，拒绝 `__proto__`，跨窗口 storage 失效。渲染期 throw 会让 bb 退役整个插件，这个理由真实且关键。
8. `app.tsx` 是纯注册。两个组装根里做得对的那个。

### 2.3 P0 当前已坏路径

这些路径当前就会失败。它们不是新功能，是已经承诺但坏掉的能力。修复不属于行为保持重构，建议先做。

#### P0-1 功能内 `nest_thread_spawn` 永远失败

- 生产端：`server/feature-service.ts:88, 278, 329-331` 的 `homeProjects` 以容器目录路径为键。
- 消费端：`server/feature-wiring.ts:108` 的 `homeProject: async (hostId) => snapshot().homeProjects[hostId]` 按 hostId 查。
- 后果：`lib/agent/tools-spawn.ts:159-164` 取不到就返回 "The Features project for this machine is not available yet."。agent 在功能目录里开线程这条能力 100% 不可用。
- 证据：评审 B 驱动真实 `wireFeatures` 复现，`homeProjects: { '/fdata/nested-sidebar-features': 'prj_1' }`，`spawnPort.homeProject('host_1') -> null`。

#### P0-2 新装机器上 feature 根目录落在 bb 的 managed storage 内

- `host.ts:27-30` 把 host worker 的 `context.experimental_paths.dataDir` 当作 bb 数据目录返回。SDK 类型明确写着它是 "Persistent directory scoped to this plugin on this daemon"，实际值是 `<daemonDataDir>/plugins/<pluginId>/host-data`。
- `server/feature-containers.ts:116-131` 的 `chooseFeaturesFolder` 于是会选 `<host-data>/nested-sidebar-features`。`reservedWorkspaceReason` 只检查这个 dataDir 下的 `worktrees`、`personal-workspaces`、`plugins/...`，守卫完全失效。
- bb 会把这条路径判为 managed storage，并在用 unmanaged workspace 起第一条线程时返回 409。
- 本机没暴露，是因为生产库 `feature_roots` 还记着旧根 `/Users/wyatt/.bb/nested-sidebar-features`。

#### P0-3 machine 组织模式下点击机器标签得到空树

- `lib/inbox-view.ts:272-281` 的 scope 过滤用 `groupAssignment`（用户分组 map），但同一函数的树分桶（`:381`）、标签计数（`:290-298`）、标签构造（`:335-360`）都用 `organization.assignment`（机器或分组）。
- `hooks/use-inbox-tree-model.ts:169-171` 传入的是 `groupsApi.assignment`。
- 实测最小输入：

```
{"tabs":[["All",1],["Features",0],["Machine A",1]],"projectGroups":0,"treeNodes":0}
```

标签上写着 1，点进去什么都没有。`projectInScope` 用 `organizationIds` 校验 group id，而 machine id 和 group id 是两个 id 空间，必然不匹配。

### 2.4 P1 结构与正确性

#### 服务端与 host

1. **移除一个仓库时按目录名前缀误归档兄弟 worktree。** `server/feature-service.ts:767-771` 用 `normalizeFeaturePath(environment.path).startsWith(normalizeFeaturePath(member.path))`，没有路径分隔符边界。`.../alpha/tea-app` 会匹配 `.../alpha/tea-app-intl`，随后 `archiveThreads` 把兄弟目录的线程全部归档，但 `removeMembers` 只移除 `tea-app`。正确写法在 `lib/features.ts:291-309`，它做了分段比较。
2. **删除 feature 时，worktree 移除失败或成员快照为空仍然删掉数据库记录。** `server/feature-service.ts:720-732` 在 `leftovers.length > 0` 时跳过目录删除，但仍然 `store.remove(args.featureId)`。`feature_branches` 一起被删，之后无法再通过 UI 清理或删分支。空快照场景是 `refresh()` 在 host 不可达时保留旧答案，初次加载就是 `members: []`，`survey()` 不先 refresh，于是告诉用户“0 个仓库、无警告”，确认后一个 worktree 都不移除，却删掉记录。
3. **worktree 删除的二次 survey 没有把确认绑定到用户看到的计划。** 文件头注释说 survey 两次，但第二次只用来调 `removalSubmissionBlocker(plan, { deleteDirectory, acknowledged })`，`acknowledged` 是与具体数值无关的布尔。用户勾选时 0 个改动文件，勾选后 agent 写入新文件，目录照样被递归删掉。这是唯一会毁目录的操作。批量删除已经用 token 加 `descendantIds` 绑定了族谱，worktree 删除缺同样的绑定。
4. **feature 的 `finish` 和 `remove` 吞掉归档失败。** `server/feature-service.ts:649-658` 的 `archiveThreads` 每个 environment 都 `.catch(() => null)`，失败只体现为计数少一个，调用方无法区分“没有线程”和“归档失败”。随后 `removeMembers` 会把 worktree 从磁盘移除，仍在运行的线程会指向一个不存在的目录。
5. **host 侧 `git` 没有超时。** `host/git-worktree.ts:52-69` 没有 timer；`server.ts:180-188` 的 120 秒应用层超时放弃等待后，git 进程可能稍后成功删目录，服务端结论与磁盘事实相反。`host/feature-worktree.ts:51-78` 的 `runGit` 只发 `SIGTERM`，不升级 `SIGKILL`。
6. **main working tree 被归入 fallback。** `host/git-worktree.ts:29-34` 把 "is a main working tree" 归入 fallback，而 `server/workspace-service.ts:149-168` 对 fallback 的处理是 `bb.sdk.files.remove({recursive:true})`。当前被 `planWorktreeRemoval` 的 `!gitWorktree` 拒绝挡住，但分类器语义和注释相反，是个埋着的雷。
7. **大项目会直接让批量删除预览和归档 shelf 报错。** `server/thread-reader.ts:100-116` 在 50 页乘 200 条后抛 `RangeError`。`bulk-delete-service.ts:50-62` 为了找 root 的一条记录，先对整个 project 做两次分页读。archived 超过 5000 条的项目会让预览和 shelf 直接失败。
8. **`listFeatures` 读接口在做写操作。** `server/rpc/features.ts:54` 触发 `server/feature-service.ts:262-365` 的 `ensureRoot`、`store.setRoot`、`recordContainer`、`writeContext`。`prime()` 与首个 `listFeatures` 会并发执行同一段逻辑，`contextWritten.has()` 与 `add()` 之间隔着 `await`，两个 refresh 会各写一次 `AGENTS.md`。
9. **有界但静默截断。** `server/feature-service.ts:586-589` 的 `environments.list({ limit: 1000 })`，`server/thread-reader.ts:86-98` 的 10,000 条上限，`server/sidebar-index-service.ts:17, 34` 的 500 个 environment 上限。都没有 `truncated` 信号。

#### 架构与边界

1. **`lib/` 没有真正的层。** 名义上是纯领域，实际混了三类东西：纯规则、SQLite store、只能在浏览器里活的模块（`lib/workspace-pull-requests.ts:2`、`lib/portal-scope.ts:5`、`lib/workspace-index-store.ts:15`、`lib/row-status-mount.ts:20`）。`test/architecture-contract.test.ts` 只检查 `lib/` 不依赖 `components/` 和 `hooks/`。`server/` 写 `import { useEffect } from "../lib/portal-scope.ts"` 能通过测试，然后在 Node 里炸。
2. **同一个管理写入有两份实现，已经漂移。** `server/rpc/projects.ts:36-56` 的 `renameProject` 和 `removeProject`，与 `server/agent-actions.ts:44-56, 88-93` 逐行重复。RPC 版本的 `removeProject` 少了 `refreshIndex()`，`renameProject` 不 publish、不刷索引。`server/rpc/groups.ts:64-72` 的 `deleteGroup` 又是第三份。
3. **wire schema 与 domain 类型是两份手写声明。** `Feature` 在 `lib/features.ts:61-102`，`featureSchema` 在 `server/contract-schemas.ts:129-137`。`FeatureMember`、`RepositoryResult`、`RepoFacts`、`WorktreeSurvey`、`WorkspaceRemovalOutcome` 都是成对的重复。`server/contract.ts:732-763` 的 `listSettledThreads` 又把 `recoveryThreadRowSchema` 逐字段重写了一遍。
4. **`Handlers<M>` 边界样板在 13 个 RPC 文件里逐字重复。** 新增一个 RPC subject 有 13 处可以抄错。`server.ts:89-132` 的若干 re-export 已经没有调用者。

#### 领域模型与持久化

1. **旧 feature root 永远无法升级。** `server/feature-containers.ts:69-83` 在 `inUse && !current` 时写入 `stored.scheme ?? FEATURE_ROOT_SCHEME`。旧行的 `scheme` 是 NULL，第一次被使用就被盖上当前 scheme。之后即使 `inUse` 变为 false，`current` 也为 true，旧根永久接住新功能。
2. **三套 workspace 身份，两个同名 `physicalWorkspaceKey`。** `lib/repo-identity.ts:169-171` 用 realPath，`lib/workspace-index.ts:38-40` 用 bb 记录的原始 path，`lib/workspace.ts:174-180` 还有 `workspace:${hostId}:${projectId}:${path}`。对 symlink、`/var` 与 `/private/var`、或拼写不同的 checkout，ownership 行与索引行会是两个 key。
3. **settled 状态有三份权威副本。** 插件 DB 行（`server/lifecycle-service.ts`）、bb 的 archive（`server/thread-reader.ts:86-98`）、浏览器暖启动 `nest:v1:lifecycle-rows`（`lib/warm-start.ts`）。对账逻辑散在 `resolveShelf`、`wokenSettledThreadIds`、`serverRowsLoaded`、host-wins 合并、`pendingSettledCount`、`rowsMatch` 去抖里。
4. **feature 元数据表跨模块拥有，删除靠手写级联。** `lib/feature-store.ts:16` 从 `lib/feature-meta-store.ts` 导入迁移，`:146` 拼进 feature 日志，`:336-338` 直接 DELETE `feature_briefs`、`feature_refs`、`feature_decisions`。没有外键，没有 `ON DELETE CASCADE`。
5. **破坏性操作基于内存缓存的 members，而模型宣称成员来自磁盘。** `server/feature-service.ts:597-630` 的 `survey` 和 `:748-758` 的 `removeRepository` 用 `membersOf()` 即 `cached.members`。手工新增的 worktree 不会出现在 survey 里。
6. **非法状态可表达。** `ThreadLifecycleRow` 三个独立可空列允许 `settledAt` 与 `snoozedUntil` 同时非空，今天靠写入手工清空另一侧维持。
7. **`features.group_id` 从不读写。** `lib/feature-store.ts:34-41` 仍在建列。`feature_members` 表只在 `remove` 里 DELETE。`Feature.position` 文档称“显式用户顺序”，但唯一写点是 create 的 `nextPosition`，实际语义是创建顺序。
8. **order revision 的 guard 是 check-then-act。** `lib/order-store.ts:139-157` 先 `guard(baseRevision)` 再 `write()`，各自事务。单进程 better-sqlite3 串行使其概率很低，但多进程或未来异步化会真实丢更新。

#### UI 组件

1. **行渲染是同一骨架的多份实现。** `thread-card.tsx:372-390`、`thread-child-row.tsx:115-130`、`slim-row.tsx:70-84`、`workspace-card.tsx:402-412` 都重复全行锚点、`data-sidebar-thread-*` 合同、modifier-click split、`aria-current`、hover 和 active tint。`workspace-row.tsx` 和 `workspace-card.tsx` 是同一个 workspace 行的两个平行实现。`project-node.tsx:175-289` 与 `feature-node.tsx:232-295` 又重复 expandable header。
2. **`TreeRowHandlers` 是一个 30 字段的袋子。** `tree-row-types.ts:32-124` 把 navigation、preferences、selection、reorder、workspace、archive、feature adoption、group/project rename 全部塞进一个 interface。`thread-inbox.tsx:246-288` 每次渲染新建完整对象，`project-node.tsx:159-162` 再 `{...handlers}`，`feature-node.tsx:113-119` 再 `{...handlers, reorderEnabled:false}`。
3. **全行锚点四份里有三份没有键盘焦点环。** `thread-card.tsx:389`、`thread-child-row.tsx:129`、`slim-row.tsx:83`、`archived-shelf.tsx:76` 都没有 `focus-visible:ring-*`，只有 `workspace-card.tsx:411` 有。
4. **对话框的 async、busy、error、confirm 四种横切逻辑各复制 5 到 10 份。** `messageOf` 五份。`lib/errors.ts` 的 `errorMessage` 更完整，却只被两个 hook 使用。`if (!busy) onClose()` 在 7 个文件 8 处。`DialogActions` 加 ghost Cancel 加主按钮在 13 个导入点 15 处。
5. **三个上帝文件已接近行数上限。** `feature-brief-dialog.tsx` 867 行，`nest-settings.tsx` 857 行，`responsive-overlay.tsx` 823 行。`server/feature-service.ts` 885 行，硬上限是 900。
6. **分页三件套加页码 state 复制五遍。** `project-node.tsx:110, 129-157`、`workspace-row.tsx:79-94`、`feature-node.tsx:88, 98-106`、`parked-shelf.tsx:51-67`、`thread-inbox.tsx:90-91`。
7. **零 `React.memo`，且 derived handlers 每层重建。** 44 个线程加子行时，selection、clock、preferences、view-state 任一变化都会从 `ThreadInbox` 向下重渲染。`use-thread-card-model.ts` 的 `familyStatus([thread, ...childThreads], now)` 和返回对象每次新分配。`ThreadCard` 里 `threadDisplayTitle(thread)` 调用 8 次。
8. **展开态同时有本地 state 和持久 store。** `use-thread-card-model.ts:32, 41-50` 与 `thread-child-row.tsx:57, 74-81` 的 `override: storedOverride ?? expandedOverride`。先本地 setState，再 store patch，双次渲染。
9. **CSS tooltip 的 `role="tooltip"` 在 5 个文件里手写，多数没有 `aria-describedby`。** `thread-card.tsx:277-282`、`row-metadata.tsx:32-41`、`row-controls.tsx:63-65`、`family-status.tsx:207-210`、`provider-glyph.tsx:141-142`。

#### Hooks 与前端状态

1. **`viewPreferences` 每次渲染都是新引用。** `hooks/use-view-preferences.ts:171-183` 返回对象字面量，未 `useMemo`。`hooks/use-inbox-tree-model.ts:189-222` 的巨型 `useMemo` 依赖它。`ThreadInbox` 的任何本地 state 变化都会让 `buildInboxView` 全量重跑。
2. **Title bar 与 Inbox 各挂一套相同的 hook。** `components/title-attention.tsx:37-43` 与 `hooks/use-inbox-sources.ts:84-102` 各调一次 `useThreadView`、`useProjectColors`、`useRepoFacts`、`useAppearance`、`useLifecycleSnapshot`。两份 lifecycle rows 各自按自己的响应更新，短暂不一致时 title bar 与 sidebar 会对“某线程是否已 park”给出不同答案。
3. **`useInboxSources` 是 15 个 hook 的聚合器。** `hooks/use-inbox-sources.ts:80-195` 一个 hook 返回 30 个字段。追踪一个行状态是 8 层。
4. **同一个 `workspaceIndex` 有三种构建路径。** `hooks/use-inbox-tree-model.ts:56-76` 是权威版，`lib/inbox-view.ts:220-231` 在缺失时又建一次且不含 repos，`hooks/use-workspace-index.ts:25-53` 是 light 版。三者对同一环境给出的字段并不一致。
5. **`view-state` 有双重写入。** `hooks/use-inbox-view-sync.ts:103-112` 在 updater 内 `writeViewState(next)` 后返回 `next`，`hooks/use-inbox-view-state.ts:60-70` 的 `patchWith` 随后又写一次。
6. **一个 `lifecycle` publish 最多触发 4 条独立读链。** 订阅点：`hooks/use-lifecycle.ts:174`、`hooks/use-settled-threads.ts:122`、`hooks/use-project-archived-threads.ts:170`，加上 title bar 的第二份 `useLifecycleSnapshot`。
7. **三个时钟各自回答“现在几点”。** `hooks/use-minute-clock.ts:3-16`、`hooks/use-lifecycle.ts:104`、`components/title-attention.tsx:44-53`。
8. **`useFeatures(enabled)` 的开关是死代码。** `hooks/use-features.ts:122` 默认 true，但全仓唯一调用点是 `hooks/use-inbox-sources.ts:100` 的 `useFeatures()`。
9. **四个 `focus` 和 `visibilitychange` 唤醒监听各读各的。** `use-workspace-paths.ts:111-122`、`use-repo-facts.ts:89-100`、`use-pinned-order.ts:72-76`，另有 `lib/row-status-mount.ts:69`。

#### 测试、门禁、文档、打包、Agent 表面

1. **53 个测试读源码文本，其中 36 个不 import 任何生产模块。** 把 `thread-inbox.tsx:90` 的局部状态 `settledPages` 改名为 `settledPageCount`，行为完全不变，`paging-contract` 立刻 4/15 失败，因为断言直接锁住了 `const [settledPages, setSettledPages] = useState(1)`。`test/badge-contract.test.ts:152` 锁死带换行和缩进的模板字符串，`test/active-toggle-styles.test.ts` 16 条断言里 13 条是 Tailwind 类名。
2. **没有 lint、没有格式化、`check` 不含 build、没有 CI。** `package.json:101` 的 `check = typecheck && typecheck:strict && test`。仓库和插件目录都没有 ESLint、Prettier、Biome 配置，也没有 `.github/workflows`。
3. **README 的 agent 开关表与代码相反，且自相矛盾。** `README.md:476` 写 "Every switch in this build starts on"，表格 484-493 却有 4 行写 off。`lib/agent/settings.ts` 十个 descriptor 全是 `default: true`。`lib/agent/settings.ts:6` 的头注释还写着 "Reading is on and every write is off"。`README.md:964` 写 "The five agent switches"，实际是 10 个。
4. **`nest_worktree_remove` 的 `delete_directory` 默认 `true`。** `lib/agent/tools-destructive.ts:154-156` 的 `.default(true)`，而侧边栏对话框 `components/inbox/remove-worktree-dialog.tsx:52` 的 `useState(false)` 是“先保留目录”。
5. **服务端编排层没有执行测试。** 没有任何测试 import `server/rpc/*`，13 个 handler 全部只被文本断言或 `readBackend()` 拼进去。15 个 `server/*` 模块里 12 个没有测试 import，包括 `feature-service`、`feature-wiring`、`lifecycle-service`、`workspace-service`、`worktree-removal-service`。`lib/appearance-store.ts`、`lib/workspace-index-store.ts` 两个有状态 store 没有执行测试。没有任何组件渲染测试。
6. **`files` 白名单漏了 `server/` 和 `app/`。** `package.json:42-62` 列了 `server.ts`、`app.tsx`、`lib/`、`components/`、`hooks/`、`host/`、`dist/*`，但没有 `server/`，也没有 `app/`。当前 `private: true` 且从本地路径安装，实际不受影响。
7. **8 个未使用的运行时依赖。** `@pierre/diffs`、`@radix-ui/react-alert-dialog`、`@radix-ui/react-menubar`、`@radix-ui/react-navigation-menu`、`@radix-ui/react-separator`、`@radix-ui/react-tooltip`、`hono`、`vaul`。其中 `@radix-ui/react-separator` 还在 `dependencies` 里。
8. **文档过期和矛盾。** `GATES.md` 引用已删除的 `lib/collapse.ts`，`GATES-ECOSYSTEM.md` 引用 `components/inbox/rename-field.tsx`、`test/rename-contract.test.ts`、`test/windowing.test.ts`。`PLAN-AGENT-TOOLS.md` 写 "five names"、"five booleans, read-only by default"、"892 tests"。`README.md:237` 写 Plugin SDK ≥ 0.5.8，`package.json:23` 是 ≥ 0.6.141。`README.md:1062` 和 `THIRD_PARTY_NOTICES.md` 仍提 Hugeicons，而 `test/distribution-contract.test.ts` 明确禁止 Hugeicons 依赖。
9. **agent 指令块把路径和 remote URL 未转义地插进去。** `lib/agent/instructions.ts:236`、`:252`、`:216` 都是裸插值，而同文件 `:20` 宣称 "Every value is untrusted"，`:45` 的 `quoteName` 只用于名称。
10. **`deleteGroup` 不刷新索引。** `server/agent-actions.ts:58-66` 删除组后没有 `refreshIndex`，`server/rpc/groups.ts:64-72` 的 UI 删除路径也不刷新。

### 2.5 P2 质量与整洁

- `lib/order-store.ts:139-157` 的 revision guard 不在写入事务里。
- `lib/store-snapshot.ts` 和 `lib/warm-start.ts` 两套浏览器持久化框架。解码策略有整包拒绝、逐条丢弃、逐字段回退三种。
- `Workspace.conflict` 三次计算，`launchable` 是 `canonicalEnvironmentId !== null` 的别名，`InboxView.projectStatusSignals` 与 `workspaceStatusSignals` 是同一个对象。
- `feature-store.list()` 在 500 条截断，但被用于所有唯一性与查找。
- `Feature` 的 `rootPath` 和 `hostId` 是两个独立可空字段，允许半填充。
- `view state` 只增不删，空操作也写盘。
- `components/ui/empty-state.tsx`、`components/ui/motion.ts` 全仓零导入。
- `ProjectBadge` 定义在 `project-node.tsx:488`，却被 `feature-node.tsx:7`、`feature-tree-panel.tsx:5` 反向导入。
- `server/lifecycle-store.ts` 注释已失真，文件现在是纯类型模块。
- `app/` 没有写进任一 tsconfig 的 `include`，只靠 `app.tsx` 传递引入。

### 2.6 跨插件约束

`plugins/chatgpt-skin/themes/chatgpt.css:890` 用 `[data-bb-portaled-overlay].w-72.rounded-lg` 匹配 Nest 的 hover card，`:1384-1400` 用 `data-bb-icon-button` 和 `size-5`、`size-6` 匹配 Nest 的方形图标按钮。UI 重构如果改这些 class 或 marker，chatgpt-skin 会静默失效。改造必须保留这些 seam，或在同一个 PR 里更新主题。

## 3. 改造计划

### 3.1 边界与验收定义

“最终能力不变”在本计划里的含义：

- 61 个 RPC 方法名不变。
- 27 个 agent tool 名不变。
- 10 个 agent 开关 key 不变。
- 两种侧边栏模式、Features 区块、Tab 栏、Pinned、Snoozed、Settled、设置页、agent 工具的行为不变。
- 数据库迁移语句只追加，不修改旧语句。
- 不改视觉稿，不改交互流程，不加新功能。

Phase 0 是缺陷修复，不属于行为保持重构。它修复已经承诺但当前坏掉的路径。如果只做结构、不动行为，可以整体跳过 Phase 0，但不建议。评审已经证明这些路径在真实使用中会失败。

### 3.2 Phase 0：修复当前已坏路径

每个修复先写一个失败的回归测试，再改代码。修改范围小，单独 PR。

| 编号 | 问题 | 改动 | 文件边界 | 验证 |
| --- | --- | --- | --- | --- |
| 0.1 | machine 标签空树 | `buildInboxView` 只接收一个 `OrganizationView`，删除独立的 `groupAssignment` 入参；scope 过滤、计数、分桶、标签全部读同一个值 | `lib/inbox-view.ts`、`hooks/use-inbox-tree-model.ts`、`test/inbox-view.test.ts` | machine 模式下 tab 计数等于 projectGroups 长度；project 模式回归不变 |
| 0.2 | 功能内 spawn 永远失败 | 端口改成按 container path 查，或 snapshot 增加 `homeProjectByHost`；`tools-spawn` 传 feature 的容器路径 | `server/feature-service.ts`、`server/feature-wiring.ts`、`lib/agent/tools-spawn.ts` | fake host 创建 feature 后 spawn 能拿到 projectId |
| 0.3 | 新机器 feature 根落在 managed storage | `chooseFeaturesFolder` 不再选插件 host-data；回退到 `~/NestFeatures`；加一条 warn | `server/feature-containers.ts`、`test/feature-root.test.ts` | 用真实 host-data 形态断言候选根不在 bb managed storage |
| 0.4 | 兄弟 worktree 被误归档 | `removeRepository` 的 prefix 判断改成 `isWithinPath` 分段比较；审计所有 prefix | `server/feature-service.ts`、`lib/features.ts` | `tea-app` 不归档 `tea-app-intl` |
| 0.5 | feature 删除丢记录 | `archiveThreads` 返回失败环境；`remove` 在 leftovers 或归档失败时保留记录；`finish` 报告 leftovers | `server/feature-service.ts` | worktree 移除失败、归档失败、空快照三条路径都保留记录 |
| 0.6 | worktree 删除确认未绑定计划 | `inspectWorktree` 返回 digest；`removeWorktree` 要求 digest 并比对；不一致返回 `blocker: "changed"` | `server/worktree-removal-service.ts`、`lib/worktree-removal.ts`、`server/rpc/workspaces.ts`、`components/inbox/remove-worktree-dialog.tsx` | inspect 后计划变化，remove 被拒绝 |
| 0.7 | agent 移除 worktree 默认删目录 | `.default(true)` 改 `.default(false)` | `lib/agent/tools-destructive.ts` | 不传参时只释放环境，保留目录 |
| 0.8 | deleteGroup 不刷索引，指令路径未转义 | `deleteGroup` 成功时 `refreshIndex`；路径和 URL 过 `quotePath` | `server/agent-actions.ts`、`lib/agent/instructions.ts` | 删组后 index 不含旧组；含换行的路径不伪造指令行 |

### 3.3 Phase 1：安全网与门禁

这一步必须在结构移动之前完成。当前 53 个源码文本测试会在任何重命名时变红，不先处理，后面每一步都无法判断红是因为行为变了还是因为实现变了。

1. **删除 10 个纯实现锁定测试。** `active-toggle-styles`、`disclosure-contract`、`header-chips`、`pin-button-contract`、`settle-button-contract`、`row-shape-contract`、`thread-card-layout`、`trailing-rail-layout`、`scroll-geometry`、`repositories-dialog-layout`，以及 `refactor-contract` 里锁 README 散文的断言。删除前确认它们不 import 生产模块。
2. **保留 21 个有真实执行的测试。** `source-shape`、`architecture-contract`、`distribution-contract`、`agent-surface-contract`、`archived-shelf`、`organization`、`pinned`、`pull-request-presentation`、`realtime-coalesce`、`row-status`、`title-attention`、`badge-contract` 的 rollup 单测、`palette-contract` 的角色表、`feature-directory-cleanup`、`feature-host`、`feature-thread-ownership`、`unarchive-retry`、`palette-bridge` 的生产 import 部分。
3. **转换 22 个 wiring 测试。** 纯逻辑（页面计数、可见行、排序、tab 计算、搜索过滤）提到 `lib/` 单测；SDK 常量断言保留；组件行为改用渲染测试。转换与它所属模块的改造在同一个 PR 完成，不做一次性大迁移。
4. **新增三类执行测试。**
   - `server/rpc` handler harness：注入 fake bb、fake host、`:memory:` SQLite，覆盖 destructive、removal、bulk 三条路径。
   - 两个未测 store：`appearance-store`、`workspace-index-store`。
   - 行和对话框的渲染测试：先抽 `ThreadRowLink`、`DisclosureButton`、`ConfirmDialogFooter`，再用 `react-dom/server` 或 `@testing-library/react` 加 happy-dom 验证焦点环、`aria-current`、modifier split、busy 关闭闸门。
5. **门禁补齐。**
   - `check` 加入 `build`。
   - 加 Biome，`lint` 和 `format:check`。
   - 加 `.github/workflows/ci.yml`，`npm ci && npm run check`，Node 22.6 以上。
   - `package.json` 加 `engines.node`。
   - 依赖门禁：每个声明的依赖必须在源码中被 import。直接抓出 8 个死依赖。
   - 覆盖率下限只针对 `lib/`、`server/`、`host/`，不对文本测试算覆盖率。
   - `architecture-contract` 扫描 `app/`，解析相对路径。
   - 新增“反模式护栏”：新测试若读源码且不 import 生产模块，除 3 个门禁测试外直接失败。
6. **能力清单测试。** 把 61 个 RPC 方法名、27 个 agent tool 名、10 个开关 key 固化成测试。任何后续 PR 删除或重命名这些表面都会红。这是“最终能力不变”的结构化保证。
7. **文档收敛。** 删除 `REFACTOR-PLAN.md`、`ICON-LIBRARY-RESEARCH.md`，归档 `PLAN.md`、`GATES.md`、`PLAN-ECOSYSTEM.md`、`GATES-ECOSYSTEM.md`、`docs/NEST-REVIEW-AND-PLAN.md`、`docs/FEATURE-WORKSPACES-PLAN.md`、`docs/WORKSPACE-REFACTOR-PLAN.md`。保留 `docs/NEST-ORGANIZATION-V2.md`、`docs/repository-ownership-feasibility.md`。给 `docs/FEATURE-WORKSPACES-REDESIGN.md` 加“已被 v2 取代”。`PLAN-AGENT-TOOLS.md` 重写或删除，同时修 `tools-read.ts:9` 和 `agent-surface-contract` 对它的引用。README 拆成 README、`docs/USAGE.md`、`docs/DESIGN.md`，agent 表由 `AGENT_TOOL_SETTING_DESCRIPTORS` 生成。

### 3.4 Phase 2：收敛归属

这是整个改造的核心。目标不是加层，而是让每个事实只有一个构造点、一个写者、一个订阅。

1. **`OrganizationView`。** 在 `lib/organization.ts` 增加 `{ axis, assignment, sections, validIds }`，`buildInboxView` 只接收它。scope 过滤、计数、分桶、标签全部读同一个值。这是 0.1 的结构版本，如果 0.1 已经做了，这一步只是把类型命名和边界收紧。
2. **一个 `WorkspaceKey` 和一个 `Workspace` 工厂。** 主键明确选“bb 记录的规范化路径”，realPath 作为 `aliases`，`legacyWorkspaceKeys` 统一产出历史拼写。`repo-identity` 不再导出同名工厂。`Workspace` 由工厂一次算完 `projectId`、`conflict`、`canonicalEnvironmentId`、`launchable`、`featureId`。`buildWorkspaceIndex` 是唯一构造点，light fallback 改成明确的 `PartialWorkspaceIndex`，只保证 `environmentId -> key`。
3. **`FeatureRepository`。** 一个模块拥有 features、labels、roots、containers、branches、briefs、refs、decisions 全部表和迁移日志。`remove` 在一个事务里级联。迁移语句保持现有顺序和文本，只做组装位置搬移。`features.group_id` 和 `feature_members` 保留在旧日志索引里，但不再读写。
4. **`Parked` 判别联合。** `type Parked = { kind: "settled"; at: number; archivedIds: string[] } | { kind: "snoozed"; until: number; setAt: number } | null`。`rowFromColumns` 和 `columnsFromRow` 是唯一列映射。`server/lifecycle-service.ts` 是唯一写者。`useLifecycle` 和 `useThreadShelves` 合并成一个 provider。暖启动明确标注为 cache，`serverRowsLoaded` 的语义收进一个 `LifecycleStore` 状态机。
5. **一个浏览器快照原语。** `lib/persistence/define-snapshot.ts`：`{ key, codec, policy, crossWindow? }`，统一 memory tier、persisted 去重、长度上限、decode 策略枚举。`warm-start` 退化为 codec 加两个 key。`view-state` 只允许 `useInboxViewState` 写，`useInboxViewSync` 只计算 `next`。
6. **一个项目与分组写入服务。** `server/project-service.ts` 拥有 rename、delete、group CRUD，publish 和 refreshIndex 属于服务。RPC handler 和 agent actions 都调用它。`deleteGroup` 的索引刷新由服务保证，不再靠调用者记得。
7. **一个 realtime 规则。** 谁写谁发，且只发一次。store 或 service 写完发，handler 不发。所有订阅改回 `lib/realtime-channels.ts` 的常量。给 workspace 标签一个真正的 channel，或删掉误导性的 `GROUP_CHANNEL` publish。
8. **一个共享服务端 store hook。** `useSharedServerStore(key, read, channel)` 统一 appearance、colors、icons、preferences、groups 的“snapshot 初值 + cancelled/nonce 读取 + useCoalescedRealtime + 失败回退”。Title bar 和 sidebar 共享同一个 provider，不再各挂一套。subscriber 数量从 4 个 lifecycle 订阅降到 1 个 store 加派生。

### 3.5 Phase 3：分层

把 `lib/` 分成四个目录，这是机械移动，不改行为。

```
lib/domain/       纯函数，无 React，无 better-sqlite3，无 @get-bb/plugin-sdk/app
lib/stores/       SQLite store、迁移、序列化
lib/persistence/  浏览器快照、codec、storage 策略
lib/ui/           React 或客户端专用：portal-scope、workspace-index-store、row-status-mount、workspace-pull-requests
```

配套规则：

- `server/` 和 `host/` 只能 import `lib/domain` 和 `lib/stores`。
- `hooks/` 可以 import `lib/domain`、`lib/persistence`、`lib/ui`，但不能再 import `components/`。把 `view-state-context.tsx` 的 context 和 `useNestViewState` 移到 `hooks/` 或新的 `context/`。
- `components/` 可以 import `lib/domain` 和 `lib/ui`。
- `test/architecture-contract.test.ts` 按目录断言，并补上 `app/` 和相对路径解析，再加一条“`server`、`host`、`lib/domain` 禁止 import `react` 或 `@get-bb/plugin-sdk/app`”。
- `tsconfig.json` 和 `tsconfig.source-strict.json` 的 `include` 补上 `app`。

移动顺序：先 `lib/domain`，再 `lib/stores`，再 `lib/persistence`，最后 `lib/ui`。每一步用 `git mv` 加 import codemod，跑全量 `check`。一步一个 PR。

### 3.6 Phase 4：UI 拆分

保持视觉与交互不变，只减少重复。

1. **行原语。** `ThreadRowLink` 负责全行锚点、焦点环、`aria-current`、modifier split；`RowTint` 负责 hover 和 active；`useReorderableRow` 负责 `dragStarted`、`dataTransfer`、键盘 Alt 加方向、drop 位置计算；`DisclosureButton` 四个变体（icon、chip、shelf、text）；`WorkspaceRowShell` 由 `mode` 决定 disclosure 和 trailing；`ExpandableNodeRow` 由 Project 和 Feature 传 glyph、menu、body、click policy。不要硬合并 `SlimRow`、`ChildThreadRow`、`CompactThreadRow`，它们的 park、restore、disclosure、密度是真实差异。
2. **对话框原语。** `useDialogTask` 返回 `{ busy, error, run, reset }`，自带 `finally` 和取消语义；`ConfirmDialogFooter`；`DialogErrorText`；`messageOf` 统一走 `lib/errors.ts`。用 `key={featureId}` 重挂载替代“打开即重置”的 effect。
3. **拆分上帝组件。** `FeatureBriefDialog` 拆成 `RequirementPane`、`DecisionsPane`、`ReferencesPane` 加 `useFeatureBriefMeta`，字段用 `BRIEF_FIELDS` 映射，`toBriefDraft`、`toBriefInput`、`linesOf` 移到 `lib/feature-meta.ts`。`NestSettings` 拆成三个 panel 文件加 `ui/settings-row` 和 `ui/badge-swatch`。`ResponsiveOverlay` 拆成 `keyboard-inset`、`focus-trap`、`drawer-drag` 三个 hook 加展示壳。`Dialog` 拆成 compact 和 floating 两实现加一个薄分发。
4. **稳定 handlers 和 memo。** `TreeRowHandlersContext` 在 `ThreadInbox` 提供一次并 `useMemo`；`FamilyRow` 用 `useFamilyRowHandlers(rootId)` 选择自己需要的字段，不再把 30 个字段摊成 `ThreadCard` props。然后对 `ThreadCard`、`WorkspaceRowShell`、`ExpandableNodeRow` 加 `React.memo`。`useThreadCardModel` 内部 `useMemo` 掉 `familyStatus` 和返回对象。行内 `threadDisplayTitle` 只算一次。
5. **删除本地展开镜像。** `use-thread-card-model` 和 `thread-child-row` 只写 store，不再保留 `expandedOverride`。
6. **分页原语。** `usePagedRows` 返回 `{ visible, hasMore, nextPage, controlsProps }`，`searching` 时自动全量。
7. **可访问性。** `RowTooltip` 要求 `aria-describedby`；补全四份行锚点的 `focus-visible:ring-*`；`DisclosureButton` 统一 `aria-expanded` 和 `aria-controls`；`ThreadCard` 的 children tooltip 从不可聚焦 `span` 移到可聚焦元素。
8. **跨插件 seam。** 保留 `data-bb-icon-button`、`[data-bb-portaled-overlay].w-72.rounded-lg`、`size-5`、`size-6`。如果必须改，同一个 PR 更新 `plugins/chatgpt-skin/themes/chatgpt.css` 并跑主题回归。

### 3.7 Phase 5：服务端与契约

1. **拆 `server/feature-service.ts`（885 行）。** 按知识所有权拆成 `server/feature/create.ts`、`server/feature/members.ts`、`server/feature/removal.ts`、`server/feature/service.ts`。`survey` 在决策前强制一次该 feature 的扫描，或返回 `{ members, stale }`。`archiveThreads` 返回 `{ archived, failedEnvironmentIds }`。`remove` 在 leftovers 或归档失败时保留记录。迁移语句不动。
2. **契约派生。** 先只做六对重复：`Feature`、`FeatureMember`、`RepositoryResult`、`RepoFacts`、`WorktreeSurvey`、`WorkspaceRemovalOutcome`。用 `z.infer` 或 `satisfies` 绑定 domain 类型，让漏字段在编译期报错。`listSettledThreads` 用 `recoveryThreadRowSchema.extend({ settledAt })`。`Handlers<M>` 类型移到 `server/contract.ts`，13 个 RPC 文件不再各写一份。
3. **最小错误模型。** 不做全表面 `Result` 重写。先给三条破坏性路径加 `code: "stale" | "blocked" | "unavailable" | "conflict" | "invalid"`，把 `FeatureError` 改成携带 code，handler 边界统一映射。前端只改这三条路径的 catch。
4. **host 超时和分类。** `runGit` 接受 `timeoutMs`，超时后 `SIGKILL`；host handler 透传 `context.signal` 到 `spawn`；`git worktree remove` 把 main working tree 分成独立 `refused`，不再 fallback 到递归删除。
5. **分页和截断。** `thread-reader` 的 root 读取改成按 id 单条读；`listProjectArchivedThreads` 用 archived 分页加目标 limit 提前终止；所有上限返回 `truncated` 标记，不再静默。
6. **handler harness 扩展。** 用 fake bb 和 fake host 覆盖 `feature-service` 的创建、追加仓库、finish、remove、removeRepository，`workspace-service` 的 survey 和 remove，`lifecycle-service` 的 settle、unsettle、snooze，`bulk-delete-service` 的 token 和族谱。

### 3.8 Phase 6：清理与最终证明

1. **死代码。** 删除 `components/ui/empty-state.tsx`、`components/ui/motion.ts`，删除 `PLUGIN_SETTING_DESCRIPTORS` 空占位或接上，删除 `useFeatures(enabled)` 的死参数，删除 `InboxSources.settledThreads` 无消费者的导出，删除 `features.group_id` 和 `feature_members` 的新读写（旧迁移语句保留）。
2. **依赖和打包。** 删除 8 个未使用依赖，`npm install` 更新 lock。删除 `files` 和 `publishConfig`，保留 `private: true`，或补全 `server/` 和 `app/` 并移除 `dist/`。加 `engines.node`。修 `engines.bb` 的下限。
3. **文档。** README 拆成手册、用法、设计。agent 表由 descriptor 生成。修 SDK 版本、Hugeicons 说明、`PLAN-AGENT-TOOLS.md` 的过期数字。所有已被取代的计划文档加归档标记。
4. **最终证明。**
   - `npm ci` 从干净状态安装。
   - `npm run check` 全绿，包含 build。
   - 能力清单测试通过，61 个 RPC、27 个 tool、10 个开关不变。
   - 在 bb 里真实加载插件，手动走查：两种模式、machine 标签、Features 区块、Tab 栏、Pinned、Snoozed、Settled、设置四个 tab、feature 内 agent spawn、settle 和 snooze 和 unsettle、worktree 移除的 inspect 和 remove、批量删除预览。
   - 记录一份 capability manifest 作为交付物。

### 3.9 验收门

| 门 | 内容 | 失败处理 |
| --- | --- | --- |
| G1 能力不变 | 61 个 RPC、27 个 tool、10 个开关、两种模式、Features、Tab、Pinned、Shelf、Settings 全部保持 | 回滚该 PR |
| G2 全量检查 | `npm ci && npm run check` 通过，含 lint、format、build、test | 不进下一步 |
| G3 迁移不变 | 旧迁移语句文本和顺序不变，只追加 | 回滚 |
| G4 真实走查 | 3.8 的手动清单全部通过 | 不进下一步 |
| G5 Reader load | 每个 Phase 必须删掉至少一条重复路径，或至少一个重复写者。如果 diff 没有降低 reader load，回滚 | 回滚 |
| G6 跨插件 seam | chatgpt-skin 的 `data-bb-icon-button`、hover card、size 选择器仍匹配 | 同一 PR 更新主题 |

### 3.10 非目标

- 不把 feature 成员或 workspace 索引存进数据库。
- 不把四种行密度硬合并成一个组件，密度、disclosure、split、restore 是真实差异。
- 不删除暖启动或 localStorage 快照，它们修复真实的闪烁和冷启动问题。
- 不修改迁移日志的旧语句。
- 不重写 feature 模型或两种模式。
- 不引入状态管理库或新的组件库。
- 不追求 100% 覆盖率，只测编排层和破坏性路径。
- 不为了架构好看而增加没有删掉分支或状态的抽象。

### 3.11 建议的第一个切片

如果只做一个可交付切片，建议这个顺序：

1. Phase 0 的 0.1、0.2、0.3、0.4、0.5，五个修复加五个回归测试。它们都是小改动，直接恢复已经承诺的能力。
2. Phase 1 的“删除 10 个实现锁定测试 + 新增能力清单测试 + `check` 加 build + CI”。这一步不改生产代码，但决定了后面所有重构是否可验证。
3. 然后进入 Phase 2 的 2.1 和 2.2，先把 `OrganizationView` 和 `WorkspaceKey` 收敛。这两个是后面所有视图和持久化改动的基座。

这三步完成后，仓库会处于一个“行为已经修正、安全网可信、最大的两个身份问题已收敛”的状态。后续 Phase 3 到 6 可以按模块并行，不需要一次性大爆炸。

## 4. 应用的原则

- **Model the Domain**：用 `Parked` 判别联合替代三个可空时间列，用 `WorkspaceKey` 替代三套身份，用 `OrganizationView` 替代两个 assignment。这些都删除非法状态和分支，不是加间接层。
- **Foundational Thinking**：先做 Phase 0 和 Phase 1 的安全网，再做结构移动。数据形状先定，测试和门禁是 scaffold。
- **Boundary Discipline** 和 **Type System Discipline**：wire 类型从 domain 派生，外部数据在 RPC 边界解析，内部信任类型。
- **Minimize Reader Load**：一个 workspace 索引、一个 lifecycle store、一个 view-state 写者、一个项目写入服务。目标是让读者能在 30 秒内回答“这个事实从哪来，谁能改它”。
- **Subtract Before You Add**：先删 10 个实现锁定测试、8 个未使用依赖、死 schema、过期文档、死参数，再引入新原语。
- **Laziness Protocol**：不合并四种行组件，不引入新状态库，不做全表面错误模型重写。只做能删掉分支和重复写者的改动。
- **Test Behavior, Not Implementation**：测试三分类，保留 21、转换 22、删除 10。新增 handler harness 和渲染测试。
- **Sequence Verifiable Units**：每个 Phase 一个可独立回滚的 PR 序列，每一步以 `check` 绿和能力清单通过结束。
- **Separate Before Serializing Shared State**：同一事实只留一个写者，不做多个 store 之间的人肉对账。
- **Migrate Callers Then Delete Legacy APIs**：workspace key、错误码、行原语都在同一波迁移所有调用者并删除旧入口，不留兼容层。
- **Outcome-Oriented Execution**：目标分层是 `domain/stores/persistence/ui`，不在中间状态保留旧路径。
- **Prove It Works**：P0 用复现脚本，最终用 `npm ci`、真实 bb 走查和能力清单证明。
- **Guard the Context Window**：六个只读切片并行，主线程只保留高信号文件和结论。
- **Encode Lessons in Structure**：README agent 表由 descriptor 生成，依赖由门禁检查，架构边界由目录测试检查，能力由清单测试固定。

## 5. 证据与未验证项

`[实测]` 直接运行或复现的：

- `npm run typecheck`、`npm run typecheck:strict`、`npm test`（1235 通过）、`npm run build`。
- machine 模式空树：`tabs` 计数 1，`projectGroups` 0，`treeNodes` 0。
- 128 个测试文件、53 个读源码、36 个不 import 生产模块、3,146 条断言。
- 61 个 RPC 方法、27 个 agent tool、10 个 agent 开关。
- 8 个未使用运行时依赖。
- `package.json` 的 `files` 漏 `server/` 和 `app/`，`check` 不含 build，无 CI，无 lint 配置。
- README agent 表与 `lib/agent/settings.ts` 相反，README 写 5 个开关而实际 10 个。
- `nest_worktree_remove` 的 `delete_directory` 默认 true。

`[评审]` 来自六个只读线程并带 file:line：

- P0 功能内 spawn 失败（B 用 fake host 运行复现）。
- P0 新机器 feature 根落入 managed storage（B 用真实 host-data 形态复现，bb 侧 409 为读 bb 源码推断）。
- 兄弟 worktree 误归档（B 运行复现）。
- feature 删除丢记录（B 运行复现）。
- worktree 删除 TOCTOU（B 读码推断，未构造并发窗口）。
- 三套 workspace 身份、两套索引、三份 settled 状态、旧根 scheme 永不升级（C 读码，P0-3 有运行复现）。
- 行组件、对话框、分页、焦点环、memo 的重复（D 读码加结构事实）。
- hooks 的重复读取、双重写入、四个 lifecycle 订阅、三个时钟、死参数（E 读码）。
- 测试分诊 21 保留、22 转换、10 删除（F 读码加实测改名实验）。

未验证：

- bb 0.36 是否真是插件 API 的下限。
- `npm pack` 的实际内容，沙箱里 npm 缓存权限挡住了 dry run。
- 生产环境是否存在 `environment.path` 与 realPath 不一致的 checkout。
- `useSidebarThreadSplit` 每行订阅的真实开销。
- Radix `HoverCard.Root` 和 `ContextMenu.Root` 每行一个的实际渲染成本。
- 多 bb 进程是否共享同一个插件 SQLite 文件，这决定 order revision 的 TOCTOU 是理论问题还是真实丢更新。

---

## 6. 执行记录（2026-11-16）

计划已执行。全部提交在 `feat/nest-workspaces`，未 push。

| 阶段 | 结果 |
| --- | --- |
| Phase 0 缺陷修复 | 完成，含 0.1 到 0.8 与回归测试 |
| Phase 1 安全网 | 完成；删除 10 个实现锁定测试，能力清单、依赖门禁、Biome、CI、Node engine 已就位 |
| Phase 2 归属收敛 | 完成；FeatureRepository、Parked 联合、ProjectService、WorkspaceKey、快照原语、view-state 单写者 |
| Phase 3 分层 | 完成；`lib/domain`、`lib/stores`、`lib/persistence`、`lib/ui` 四层，根目录只剩 `realtime-channels.ts` 与 `agent/` |
| Phase 4 UI | 完成；ThreadRowLink、对话框原语、两个上帝组件拆分、drawer/dialog 拆分、usePagedRows、稳定 handlers 与 memo、tooltip 统一 |
| Phase 5 服务端 | 完成；契约派生、host 超时与主工作树拒绝、分页截断、feature service 拆出 repositories 与 removal ops |
| Phase 6 清理 | 完成；死代码、依赖、打包、文档归档、README 拆分 |

与计划的差异：

- 错误模型采用 typed code，不引入全表面 `Result` 信封：`lib/domain/rpc-error.ts` 提供六个 code，`FeatureError` 携带 code，worktree 移除的 `WorkspaceRemovalOutcome` 用 `code`，bulk delete 保留 typed `reason`。agent tool 回复 `code: message`。
- 没有留下任何 shim 或兼容转发层。`tree-rows` barrel、`FEATURE_MIGRATIONS` 别名、`server.ts` 的兼容 re-export、类型 re-export、group-icons barrel、responsive-overlay 的 drawer re-export、`DialogFooter` 别名都已删除并迁移调用方。
- 视觉走查已完成：用 ego-browser 打开本机 bb 前端，确认两种模式、Features 区块、工作区行、头部面包屑与 Tab 栏、设置页四个 tab，并捕获页面无 console error。走查期间发现 header 在 `environment` prop 为 null 时不渲染面包屑和 Tab 栏，已改为回退到线程行自身的 environment/project id。
- `scroll-geometry.test.ts` 由共享 checkout 的侧栏几何线程维护，删除它的事项留给该工作流。

验证：`npm ci`、`npm run check`（双 typecheck、lint、1290 个测试、`bb plugin build`）全部通过；真实插件 reload 后 8 个只读 RPC 全部返回有效结果；ego-browser 走查通过；能力清单保持 61 个 RPC、27 个 agent tool、10 个开关。
