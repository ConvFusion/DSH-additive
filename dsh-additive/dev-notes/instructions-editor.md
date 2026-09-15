# 设置页编辑 AGENTS 指令文件 — 实现说明

## 目标

在 **设置 → Additive** 中直接编辑两个「工作区指令」文件：

| 目标 | 文件 | 说明 |
|------|------|------|
| 全局 | `$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`） | 所有会话都会注入的用户级指令 |
| 工作区 | `<工作区目录>/AGENTS.local.md` | 当前工作区（项目）级本地指令覆盖层 |

同时展示实际解析出的绝对路径，便于确认加载位置。

## 关键约束（为什么是"编辑"而不是"开关"）

指令文件由 DSH 核心插件 `@deepseek-ai/dsh-agent-instructions`（`@deepseek-ai/dsh-base`
默认启用）加载，其可选字段为：

```
dshHome?, projectRootMarkers?, maxBytes, maxSourceBytes?,
instructionFileCandidates?, localInstructionFileCandidates?
```

- 这些字段只在 **composition 层**（bundle / `cordis.patch.yml`）生效，**不读** `~/.dsh/settings.yaml`；
- settings namespace 由注册方插件独占（`ctx.settings.register(ns, …)` 每个 ns 只能注册一次），
  因此本插件**无法**从设置里改写核心插件的 config；
- 默认行为已经会加载 `~/.dsh/AGENTS.md` 与项目链上的 `AGENTS.local.md` / `CLAUDE.local.md`。

所以本次实现落在**内容编辑**：不改变「加载哪些文件」，只提供官方缺失的编辑入口。
若将来要做「是否加载」的开关，需要给核心插件加 settings 绑定并把解析结果改为动态
（本插件不能替它注册 namespace），属于另一件事。

## 路径解析（跨平台）

- 全局：`resolveDshHome()`（`@deepseek-ai/dsh-home-paths`）→ 依次取
  显式配置 > `$DSH_HOME` > `os.homedir()/.dsh`。
  Windows 下自然解析为 `%USERPROFILE%\.dsh\AGENTS.md`，不硬编码 `~`。
  展示用 `dshHomeDisplay()`（默认 home 显示为 `~/.dsh`）。
- 工作区：`workspaceDir`（settings 文档）中的**绝对目录** + 固定文件名 `AGENTS.local.md`。
  写入范围因此被钉死在单个文件上，不做递归/通配。
  `workspaceDir` 为空时，客户端从 `ctx.workspaceRegistry.list()` 拿到的工作区列表里挑一个。

## 接口（同源、同鉴权，挂在 `/dsh-additive` 前缀路由下）

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/dsh-additive/instructions?workspace=<dir>` | 返回全局 + 指定工作区两个文件的元信息与内容；`workspace` 省略时用 settings 里的 `workspaceDir` |
| POST | `/dsh-additive/instructions/global` | 写全局文件，body `{ content, baseSha256? }` |
| POST | `/dsh-additive/instructions/local` | 写工作区文件，body `{ content, baseSha256?, workspace? }` |
| GET | `/dsh-additive/instructions/workspaces` | 列出已注册工作区（id/title/path/exists），供客户端选择 |

响应统一 `{ ok: true, ... }` / `{ ok: false, error, message }`。

### 安全与一致性

- 单文件上限 `MAX_INSTRUCTION_BYTES = 1 MiB`（读、写都封顶）。
- 只写 `<workspaceDir>/AGENTS.local.md`（文件名固定，无路径拼接用户输入）。
- 写前 `realpath` 工作区目录并要求目录存在；全局文件允许 `mkdir -p` 父目录。
- **写入冲突**：GET 返回 `sha256`；保存时带上作为 `baseSha256`，磁盘内容已变则 409，
  由用户选择重新加载或覆盖（避免静默吞掉外部编辑）。
- 写入走「同目录临时文件 + rename」原子替换（`writeInstructionFile`），避免半截文件
  被核心插件读到。这里没有引入 `@deepseek-ai/dsh-atomic-write` 依赖：插件是 monorepo
  外的 `link:` 包，其依赖只在 pnpm store 内，新增运行时依赖需要改 profile 的锁文件。

## 客户端

`src/client/index.tsx` 内新增「AGENTS 指令文件」分组，**一个下拉框 + 一个编辑器**：

- 下拉第 1 项 = 全局文件（value `''`），其余项 = 各工作区（value `workspace:<绝对路径>`，
  来自 `GET /workspaces`，即宿主的 `workspaceRegistry`）。全局文件不受工作区选择影响，
  所以它占据第 1 项而不是排在列表下面。
- 切换下拉即重新读取选中文件；编辑器、保存、重新加载都只作用于当前项。
  选中工作区时把目录写进 settings 的 `workspaceDir`（host 持久化），重启后仍指向同一工作区。
- 未保存修改标「● 未保存」，切换文件或点重新加载会丢弃草稿；后台重载不会覆盖草稿。
- 界面刻意保持极简：分组头只有标题，编辑器上方只有「路径 · 状态」一行，
  其余解释（加载方是谁、Windows 路径、生效时机等）全部写在本文档与 README，不占用设置页。
- 保存成功后用返回的 `sha256` 续接，冲突时提示先重新加载。

## 生效时机

核心插件**没有 watcher**：改动会在下一次成功的第一方 `read`/`write`/`edit`、
会话 resume 对账，或进入 pre-step 恢复 baseline 时生效。
新会话立即可见；当前正在跑的会话可能要到下次文件操作后才刷新。
