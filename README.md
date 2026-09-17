# dsh-additive

DSH 界面增强插件（`~/.dsh/profiles/web` 本地 link 安装）：

1. **品牌自定义** — 左侧栏 Logo 图标与品牌文字（含对话页 Hero 区 Logo）。
   默认显示 **Launcher 品牌**：内置 DSH Launcher 图标（打包在客户端 bundle 内，
   base64）+ **保留官方 DeepSeek 标识**（品牌名默认为空）+ 版本徽章"Launcher"
   （深色药丸）。可上传本地图片覆盖（文件存磁盘 `~/.dsh/dsh-additive/`，引用存
   浏览器 localStorage）、改品牌名、改版本号；保存实时生效。
2. **输入框 ↑/↓ 历史回溯** — 类终端 readline 行为，配置开关控制启用。
3. **AGENTS 指令文件编辑** — 在设置里用**一个下拉框**选择要编辑的文件（第 1 项是
   全局 `$DSH_HOME/AGENTS.md`，即默认 `~/.dsh/AGENTS.md`、Windows 为
   `%USERPROFILE%\.dsh\AGENTS.md`；其后是各工作区的 `AGENTS.local.md`），
   下方单个编辑器直接改内容，带路径显示、保存哈希冲突检测与原子写入。
4. **Python 环境** — 设置里一个可选的「Python 路径」字段 + 两个动作按钮。
   解析顺序为 `pythonPath`（用户填的解释器/虚拟环境目录）> 本机系统
   `python3`/`python` > `$DSH_HOME/python-env/` 一次性虚拟环境（不存在才创建、
   **不重复安装**）。「写入 AGENTS.md」把解析出的环境以**标记块**追加/更新到
   全局 `$DSH_HOME/AGENTS.md`（块内由插件维护，不碰用户手写内容）。

## 安装

### 从 GitHub 安装（推荐）

```bash
npx @deepseek-ai/dsh plugin --profile web add https://github.com/ConvFusion/DSH-additive
```

插件仓库根目录即包本身（`package.json` + 已提交的 `lib/` 构建产物），`lib/`
入库使 `git` 安装无需现场 build，克隆下来的包可直接加载。安装后**重启 DSH web**。

### 本地 link 开发（已在本机配置好）

```jsonc
{
  "dependencies": {
    "dsh-additive": "link:/Users/zengsn/Research/github.com/ConvFusion/DSH-additive"
  },
  "dsh": { "profile": { "bundles": [/* …, */ "dsh-additive"] } }
}
```

```bash
cd ~/.dsh/profiles/web && pnpm install   # 建立/刷新 node_modules 软链
```

## 开发构建

```bash
pnpm install        # 首次
npm run build       # tsc（host）+ esbuild（client bundle，lib/client.js）
npm run smoke:instructions   # 指令文件路由冒烟测试（隔离 DSH_HOME）
npm run smoke:python-env     # Python 环境路由冒烟测试（隔离 DSH_HOME）
```

产物：

- `lib/index.js` — host 入口（注册 `additive` settings namespace）
- `lib/client.js` — 浏览器 bundle（`window.__ModuleLoader__` 包装，react / @deepseek-ai/* 全部 external）

> **注意**：`lib/` 是提交入库的（与 `src/` 一起作为"可安装产物"入库），
> 改完 `src/` 后必须 `npm run build` 并把 `lib/` 一并提交，否则 git 安装
> 装到的还是旧产物。

## 配置项（设置 → Additive）

| 字段 | 类型 | 存储位置 | 默认（留空时显示） | 说明 |
|------|------|------|------|------|
| Logo 图片 | 文件 | **图片字节 → 宿主磁盘** `~/.dsh/dsh-additive/logo.<ext>`；**引用 → 浏览器 localStorage** | 内置 DSH Launcher 图标（bundle 内 base64） | 上传本地图片（PNG/JPG/WebP/GIF/SVG/AVIF，≤2MB）；"删除本地图片"恢复默认 |
| `brandName` | string | 浏览器 localStorage | 空（保留官方 DeepSeek 标识 wordmark） | 品牌文字；自定义后替换 wordmark |
| `brandVersion` | string | 浏览器 localStorage | `Launcher` | 品牌名后的深色版本徽章 |
| `inputHistoryEnabled` | boolean | `~/.dsh/settings.yaml` | `false` | 输入框 ↑/↓ 历史回溯开关 |
| `workspaceDir` | string | `~/.dsh/settings.yaml` | 空 → 取第一个已注册工作区 | 指令文件编辑器要编辑哪个工作区的 `AGENTS.local.md`（设置页选择后自动写入） |
| `pythonPath` | string | `~/.dsh/settings.yaml` | 空 → 自动检测系统 Python，检测不到则安装 `$DSH_HOME/python-env/` 虚拟环境 | Python 环境「单一路径字段」：解释器可执行文件或虚拟环境目录；留空则自动解析并记录/写入 AGENTS.md |

- **Logo/品牌名/版本**：客户端本地存储（localStorage，键 `dsh-additive:brand.*`），
  每次页面加载自动恢复；跨标签页通过 `storage` 事件同步。上传的图片文件写在
  本机 DSH 目录，经 same-origin 路由回源，settings 文档里只存一个短路径。
  默认品牌（Launcher 图标 + 官方 DeepSeek wordmark + "Launcher" 徽章）内置于
  插件，无需任何配置即显示。
- **历史开关**：DSH settings 文档（schema 默认 < cordis.patch.yml 覆盖 < 用户保存值），
  经 settings mirror 同步到浏览器。
- **调试**：浏览器 console 里 `window.__additiveDebug` 可查看历史接线状态
  （`enabled` / `bound` / `inputKind` / `hasInput` / `triggerMenuOpen` /
  `cachedValue`），用于排查 ↑ 失效。

## 实现要点

### Logo 上传与本地存储

- **宿主路由**（`webServer.register` 前缀 `/dsh-additive`，与页面同源、同鉴权）：
  - `POST /dsh-additive/logo` — 上传：magic-byte 嗅探真实图片类型（PNG/JPEG/GIF/
    WEBP/AVIF/SVG），声明的 Content-Type 必须与嗅探一致；2MiB 上限；SVG 拒绝
    `<script>`。写 `~/.dsh/dsh-additive/logo.<ext>` + `logo.meta.json`
    （mediaType/size/updatedAt/sha256），自动清理旧类型文件。
  - `GET /dsh-additive/logo` — 回源：正确 Content-Type、`Cache-Control: no-store`；
    客户端在 URL 上追加 `?v=<updatedAt>` 保证每次重传后必然刷新。
  - `DELETE /dsh-additive/logo` — 删除磁盘文件。
- **前端 brandStore**：localStorage 读写 + 订阅（自身 set 通知 + `storage`
  事件跨标签页），私有模式降级为内存 Map。
- **Logo 槽位同步**：订阅 brandStore，配置非空才注册组件（见下节优先级）。

### Logo 替换（slots）

- 目标槽位：`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`。
- **条件注册**：仅当对应字段非空时注册组件；清空配置即 dispose 注册，
  官方品牌注册自动重新成为槽位 winner（回退无需特殊处理）。
- **优先级**：boot 路径插件默认 priority 0，而 single 槽位同优先级二次注册会被
  SlotCore 拒绝（throw）。官方品牌占 0，本插件以显式 `priority: -1` 注册——
  SlotCore 按 priority 升序取第一个存活条目渲染，-1 胜出，清空后官方回退。
- **时序**：`slots.inject(slot, cb)` 等待声明方（sidebar / conversation）声明槽位后再注册，
  不依赖 boot 顺序；cb 内订阅 brandStore，配置每次变更后同步 (re)register。
- **坏图兜底**：`<img onError>` 渲染占位框（如磁盘文件被手工删除）。
- **空名称 = DeepSeek 字母**：官方 `BrandWordmark` 组件把 HARNESS 药丸烙进同一个
  SVG（无属性可隐藏），因此插件内置一份官方 9 条 "deepseek" 字形路径的本地渲染
  （提取自 dsh-web-frontend 0.1.2-rc.1，`currentColor` 着色，字形逐像素一致）；
  徽章区域只由本插件的版本徽章占据，不再出现 HARNESS。

### AGENTS 指令文件编辑

- **加载方是谁**：指令文件由核心插件 `@deepseek-ai/dsh-agent-instructions`（`dsh-base`
  默认启用）加载——全局 `$DSH_HOME/AGENTS.md`，以及项目链上的 `AGENTS.md` /
  `CLAUDE.md` 与本地覆盖层 `AGENTS.local.md` / `CLAUDE.local.md`。
- **为什么只做"编辑"**：该插件的候选文件名 / `dshHome` / 根标记只在 **composition 层**
  （bundle、`cordis.patch.yml`）生效，**不读** `~/.dsh/settings.yaml`；settings
  namespace 又由注册方插件独占，本插件无法替它注册。所以设置页提供的是官方缺失的
  **内容编辑**入口，而不是"加载开关"。
- **宿主路由**（同一 `/dsh-additive` 前缀）：
  - `GET /dsh-additive/instructions[?workspace=<dir>]` — 返回两个文件的路径、内容、
    `sha256`、字节数，以及工作区列表；
  - `GET /dsh-additive/instructions/workspaces` — `ctx.workspaceRegistry.list()`
    的工作区摘要（id/title/path/目录是否存在）；
  - `POST /dsh-additive/instructions/global` — 写 `$DSH_HOME/AGENTS.md`；
  - `POST /dsh-additive/instructions/local` — 写 `<workspaceDir>/AGENTS.local.md`。
- **界面**：只有一个下拉框 + 一个编辑器（无说明段落）。下拉第 1 项是「全局指令（所有会话）」，
  其余项为各工作区（值前缀 `workspace:`）；切换即读取对应文件，编辑器与保存/重新加载
  始终作用于当前选中项。全局文件不属于任何工作区，因此不会被工作区选择影响。
  编辑器上方只有一行：解析出的路径 + 状态（`已存在 · N 字节` / `尚不存在（保存即创建）`）。
- **路径解析**：全局用 `resolveDshHome()`（显式配置 > `$DSH_HOME` > `os.homedir()/.dsh`），
  因此 Windows 自然落在 `%USERPROFILE%\.dsh\AGENTS.md`；工作区取 `workspaceDir` 设置
  （空则用第一个已注册工作区），文件名固定为 `AGENTS.local.md`，不做递归匹配。
- **安全与一致性**：单文件 1 MiB 上限；只写上述两个文件；写工作区前要求目录存在
  （全局会按需创建 home）；读返回的 `sha256` 作为保存时的 `baseSha256`，磁盘已被外部
  修改则 **409** 并提示重新加载；写入走"同目录临时文件 + rename"原子替换，避免核心
  插件读到半截内容。
- **生效时机**：核心插件**没有 watcher**。新会话立即可见；当前会话在下次成功的
  `read`/`write`/`edit`、会话 resume 对账，或重新进入 pre-step 时更新。

### 输入历史（DOM 事件 + 每输入框独立状态）

- 捕获阶段监听 `document` 上的 `keydown` / `input` / `compositionstart/end`。
- 输入框定位（`ComposerSurface` 抽象，双表面兼容）：
  - DSH 0.1.2+：Lexical **contenteditable**（`[data-composer-card] [data-composer-input]`，
    `role=textbox`）——当前版本输入框**不是 textarea**，这是 ↑ 早期失效的根因。
  - 旧版 DSH：`[data-composer-card] textarea`；再兜底到最后一个可见 textarea。
  - MutationObserver + focusin 保持引用新鲜。
- 拦截条件（全部满足才接管）：
  - 无修饰键（保留 Shift+Enter 换行等）
  - 非 IME 组合态（`e.isComposing` + compositionstart/end 标记）
  - 斜杠命令/`@` 菜单未打开（`[data-composer-card] [role="listbox"]` 不存在；
    菜单关闭时 listbox 不挂载，已验证）
  - contenteditable 处于可编辑态（hero 无会话阶段 `contentEditable=false` 不接管）
  - ↑：**进入**历史需"历史栈非空 + 光标在开头 + 无选区"；进入后连续按 ↑ 直接翻
    更早消息，不再依赖光标位置（每次回填后光标都在末尾）
  - ↓：处于历史浏览（pointer ≠ -1）且光标在末尾
- 写入（带 `__dshAdditiveProgrammatic` 标记，避免自己的写入被误判为"回溯中编辑"）：
  - textarea：原生 `value` setter + 合成 `input` 事件（React 18 受控组件兼容）。
  - contenteditable：全选 + `document.execCommand('insertText')`——走浏览器原生
    文本插入路径（真实 beforeinput/input 往返），Lexical 内部模型与用户输入同路
    径保持同步；execCommand 不可用时回退为 `textContent` + 合成 input。
    **清空**（↓ 翻过最新一条）走 `execCommand('delete')`——`insertText('')`
    在部分浏览器是 no-op（返回 true 但不删除），不能用于清空；delete 后校验
    内容确为空，否则再回退。
- 历史入栈：Enter（捕获阶段）快照文本，发送成功后（输入框被清空）才入栈，
  被拦截/失败的发送不入栈；连续相同内容去重（tail 判重）；上限 200 条。
- 状态：`{ stack, pointer }` 挂在输入框实例上（当前 Web 壳单会话一输入框，
  等价于按会话隔离）；回溯中编辑 → 退出历史模式（已改内容保留，可继续编辑/
  直接发送）；**↓ 翻过最新一条 → 清空输入框**，表示用户要输入新消息。
- 开关由 `inputHistoryEnabled` 控制：关闭时所有监听器解绑、引用释放，
  行为完全回到原生（验收标准"插件禁用后无残留监听器"）。

## 已知限制（MVP）

- 输入历史消息记录保存在前端内存（刷新即清空），v0.2 计划按会话 localStorage 持久化。
- Logo 的引用（localStorage）与图片文件（磁盘）是两回事：只清浏览器站点数据不会
  删磁盘文件（可用设置页"删除本地图片"清理）；手工删磁盘文件后 Logo 显示占位框。
- localStorage 按浏览器 profile 隔离：换浏览器/无痕窗口不共享 Logo 配置。
- 需要权限仲裁的发送（adjudication 延迟清空输入框）可能漏入栈——
  常规聊天消息不受影响。
- 多会话并存时（未来 Web 壳多面板）按输入框实例隔离，尚未做会话 id 映射。
- 指令文件编辑只覆盖 `$DSH_HOME/AGENTS.md` 与所选工作区的 `AGENTS.local.md`：
  `AGENTS.md` / `CLAUDE.md`、嵌套子目录的覆盖层仍需手工编辑或用 `read`/`edit` 工具改。
- 保存冲突检测是"读时哈希 vs 保存时哈希"：命中即 409，不做自动合并（避免静默覆盖）。
- `workspaceDir` 只接受已注册工作区的绝对路径；宿主未提供 `workspaceRegistry`
  （非 Web 组合）时列表为空，需靠 `workspaceDir` 设置指定。

## 自检

```bash
npm run build
node scripts/smoke-instructions.mjs   # 25 项：路径解析 / 读写 / 哈希守卫 / 上限 / 路径边界
```
