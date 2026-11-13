# Nest 侧边栏 — 真机验证与改造记录

> 环境：bb 0.47.1 / macOS / 插件 `nested-sidebar@0.4.1`（path 加载）
> 验证：ego-browser 驱动真实 bb 前端（`http://127.0.0.1:38886/`），
> 配合 `bb` CLI 与插件 SQLite（`~/.bb/plugins/nested-sidebar/data.db`）交叉核对。
> 证据脚本：`/Users/euanguo/ego/nest-verify-20261026-0119/round-01..54.mjs`
> 状态：**改造已完成并通过真机复测**（953 测试全绿，typecheck 干净）

---

## 一、验证结论总表

| # | 初判 | 真机结论 | 处理 |
|---|---|---|---|
| A1 | 经 Nest 建的线程不写项目默认 | **确认，且根因有两个** | **已修** |
| A2 | unarchive 失败静默 | 确认 | **已修** |
| A3 | settle 归档失败仍返回 ok | 确认 | **已修** |
| A4 | snooze 失败会丢线程 | 确认，最严重 | **已修** |
| A5 | `starting` 线程可被误 park | **不成立**：`threadIsWorking` 读 `indicator`，`starting` 时宿主已报 `runtime` | 不改 |
| A6 | pendingOpen 15s 超时静默 | 确认（代码路径） | **已修** |
| A7 | unmanaged seed 丢 path | **本机无法复现**（无 unmanaged 工作区）；代码路径存在 | **未改**，见 §五 |
| B1 | 4 处 `href="#"` | **确认**：36 个锚点全为 `#` | **已修** |
| B2 | 触屏 hover-only 不可达 | **确认，且比初判更糟**：`opacity:0` 但**可点**，实测轻点即写入 snooze | **已修（P0）** |
| B3 | Modal busy 无视觉反馈 | 确认：`DialogClose` 无 `disabled`，`disabled:opacity-50` 是死类名 | **已修** |
| B4 | tablist 无 tabpanel | 确认：5 tab，`aria-controls` 全 null，tabpanel 数 0 | **已修** |
| B5 | 两处 aria-live 重复 | 确认：2 个空 `<output>` | **已修** |
| B6 | 拖拽在触屏失效 | 确认 | **已修**（aria + 能力） |
| B7 | 空状态文案不分场景 | **不成立**：已分三句 | 不改 |
| B8 | 图标搜索 O(n) 掉帧 | **部分成立**：filter 仅 1.3ms，成本在重渲染 | **已修** |
| B9 | 弹窗短屏溢出 | **不成立**：1200×620 下 241px，提交行可见 | 不改 |
| C1 | thread-inbox 上帝组件 | 确认（2375 行 / 47 hooks） | **未做**，见 §五 |
| C2 | server.ts 过大 | 确认（2974 行） | **未做**，见 §五 |
| C3 | repoFacts 三次调用 | **不成立**：首屏仅 1 次；标题栏 band 在当前布局未挂载 | 不改 |
| C4 | useThreadView 双挂载 | 同上 | 不改 |
| C5 | `origin:"plugin"` 语义空转 | 确认：`originPluginId` 全仓库只写不读 | 随 A1 修 |
| C6 | 6.6MB 图标数据 | **不成立**：artwork 只在 server bundle；前端仅 109KB 名单（gzip 25KB），且是刻意设计 | 不改 |
| C7 | dist 体积 | 随 C6 | — |

---

## 二、A1 的完整根因（本次核心发现）

### 修复前实测

| 场景 | 提交 | 线程实际执行 | 项目默认 |
|---|---|---|---|
| Nest 弹窗（`origin:"plugin"`） | GPT-6.1 Sol / High | `gpt-6.1-sol` / **medium** | **null** |
| bb 原生（`origin:"app"`） | GPT-6.1 Sol / High | `gpt-6.1-sol` / **high** | **写入** |

### 两个独立根因

1. **`origin: "plugin"` 让服务端跳过写默认**
   `shouldRememberProjectExecutionDefaults()` 要求 `origin === "app"`。

2. **弹窗内的选择没被标成 `explicit`**（初判漏掉）
   插件包装层只把 `providerId` 覆盖为 `explicit`，其余原样透传。
   而 `resolveRequestedCreateExecutionValue()` 的规则是：
   `sources` 存在但字段缺席 ⇒ **丢弃该值**，改用项目默认。
   所以 reasoning **一定**回落到 `medium`。

### 修复（`server.ts` `spawnThread`）

```ts
origin: "app",
executionInputSources: {
  providerId: "explicit", model: "explicit",
  reasoningLevel: "explicit", permissionMode: "explicit",
  ...(request2.serviceTier === undefined ? {} : { serviceTier: "explicit" }),
},
```

### 修复后实测（`thr_t9dr8x2wfd`，Nest 弹窗建、选 Glm-5.3-Flash）

```
项目默认：pi | magpie/auto/glm-5.3-flash | default | high | full
实际执行：{"model":"magpie/auto/glm-5.3-flash","reasoningLevel":"high","permissionMode":"full"}
```

两项都对上了。**代价**：线程不再带 `originPluginId`（该字段目前零消费者）。

---

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `server.ts` `spawnThread` | `origin: "app"` + 补全 `executionInputSources` |
| `server.ts` 契约 | `settle` 增 `archived`；`unsettle`/`snooze` 增 `message` |
| `server.ts` `settle` | 返回 `archived: archivedThreadIds.length > 0` |
| `server.ts` `unsettle` | `failure` 改为可变，返回最终结果 |
| `server.ts` `snooze` | **unarchive 失败时不写 row**，返回 `{ ok: false, message }` |
| `hooks/use-lifecycle.ts` | `settle`/`unsettle`/`snooze` 各自 catch 并 `announceToSidebar` |
| `hooks/use-project-archived-threads.ts` | 去掉 `.catch(() => undefined)`，改为播报 |
| `components/inbox/row-actions.tsx` | `useRowReveal` 读 `usePointerCoarse()`，粗指针恒显 |
| `components/inbox/thread-card.tsx` | 隐藏态加 `pointer-events-none`；`href={thread.href}` ×2 |
| `components/inbox/slim-row.tsx` | 粗指针常显 restore 按钮；`href={thread.href}` |
| `components/inbox/archived-shelf.tsx` | 粗指针常显 unarchive；`href={thread.href}` |
| `components/inbox/thread-inbox.tsx` | pendingOpen 超时播报；两个 `<output>` 合一；树容器加 `role="tabpanel"` |
| `components/inbox/group-tabs.tsx` | tab 加 `aria-controls` + `id`，新增 `panelId` prop |
| `components/inbox/tree-rows.tsx` | 粗指针下 `canReorder = false` |
| `components/ui/modal.tsx` | `DialogClose` 真 `disabled={busy}` |
| `components/inbox/group-manager-dialog.tsx` | 预计算 label + `useDeferredValue`；placeholder 不再硬编码 6,025 |

新增测试（3 个文件，12 条）：
- `test/spawn-thread-execution.test.ts` — A1 的两个根因 + 守卫未被移除
- `test/lifecycle-failure-reporting.test.ts` — 三个 RPC 的失败上报 + 顺序断言
- `test/archived-shelf.test.ts` 增 — 归档 shelf 的失败播报
- `test/row-affordances.test.ts` 改 — 隐藏即不可点、粗指针恒显
- `test/unarchive-retry.test.ts` 改 — `let failure` + 返回值断言

---

## 四、修复前后实测对照

| 任务 | 修复前 | 修复后 |
|---|---|---|
| T1 触屏 | `opacity:0` + `pointer-events:auto`，轻点即 snooze（`fired:1`） | 细指针：`opacity:0` + `pointer-events:none`，点击落 SPAN；粗指针：64 个按钮 `opacity:1` 可点 |
| T2 snooze | 失败仍写 row → 线程从 UI 消失 | 失败不写 row，返回 `{ok:false}`，前端播报 |
| T3 settle | `{ok:true}` 无 `archived` | `{ok:true, archived:false}` + 播报 |
| T4 unarchive | `.catch(() => undefined)` | `result.message` 播报 + catch 播报 |
| T5 A1 | 默认 `null`，reasoning `medium` | 默认写入 `glm-5.3-flash/high/full`，reasoning `high` |
| T6 pendingOpen | 15s 静默放弃 | 播报「线程已创建，但侧边栏还没收到」 |
| T8 href | 36 锚点全 `#` | `/projects/<id>/threads/<id>`，`anyHash:false` |
| T9 tablist | tabpanel 0，`aria-controls` null | tabpanel 1，`aria-controls` 全部解析，`aria-labelledby` 随选中 tab 变 |
| T10 aria-live | 2 个 `<output>` | 1 个 |
| T11 Modal busy | 无 `disabled` | 真 `disabled` + `cursor-not-allowed` |
| T12 拖拽 | 粗指针仍承诺拖拽 | 粗指针 `canReorder:false`，aria 改「unavailable」 |
| T13 图标搜索 | 37.6 / 66.7 / 66.5 / 83.4 ms | 11.3 / 30.7 / 35.4 / 33.3 ms（首帧） |

**回归验证**（round-54）：点击行仍导航 ✓；组 tab 仍切 scope 且 `aria-labelledby` 跟随 ✓；
settle 成功时播报区为空 ✓。

---

## 五、明确不做的事

- **A7（unmanaged seed 丢 path）**：本机无 unmanaged 工作区，无法真机复现。
  代码路径确实存在（`defaultEnvironment` 的 `unmanaged.path` 无 composer 控件，
  按 SDK 文档会提交 `path: null`）。改动需要覆盖 `onSubmit` 的 environment，
  与 `reuse` 的现有逻辑并列，属于低风险但**无验证**的改动——留待有真实
  unmanaged 工作区时再动。
- **C1 / C2（拆上帝组件）**：纯结构重构，2375 + 2974 行。当前 953 测试
  提供了安全网，但拆分会淹没本次的功能修复。建议独立分支进行。
- **A5 / B7 / B9 / C3 / C4 / C6**：真机验证证明不成立，不动。

---

## 六、清理

验证产生、计划删除：

- 项目 `Nest Verify Scratch`（`proj_pf6d8tu6rq`，源 `/tmp/nest-verify-scratch`）
- 线程 `thr_j2g8crburj`（修复前 Nest 建）、`thr_ibg4mdu47z`（原生建）、
  `thr_t9dr8x2wfd`（修复后 Nest 建）

已清理：实验写入的 snooze 行、`thr_does_not_exist_000` 的 settle 行、
`thr_nchytvhttc` 的 settle 测试（已 unarchive 并删行）。
