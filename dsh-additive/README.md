# dsh-additive

DSH 界面增强插件（`~/.dsh/profiles/web` 本地 link 安装）：

1. **品牌自定义** — 左侧栏 Logo 图标与品牌文字（含对话页 Hero 区 Logo）。
   默认显示 **Launcher 品牌**：内置 DSH Launcher 图标（打包在客户端 bundle 内，
   base64）+ **保留官方 DeepSeek 标识**（品牌名默认为空）+ 版本徽章"Launcher"
   （深色药丸）。可上传本地图片覆盖（文件存磁盘 `~/.dsh/dsh-additive/`，引用存
   浏览器 localStorage）、改品牌名、改版本号；保存实时生效。
2. **输入框 ↑/↓ 历史回溯** — 类终端 readline 行为，配置开关控制启用。

> 开发计划见仓库根目录 `plan_logo.md` / `plan_history_inputs.md`。

## 安装（本仓库开发方式，已配置完成）

插件通过 `link:` 依赖接入 web profile，profile 的 `package.json`：

```jsonc
{
  "dependencies": {
    "dsh-additive": "link:/Users/zengsn/Research/github.com/ConvFusion/DSH-additive/dsh-additive"
  },
  "dsh": { "profile": { "bundles": [/* …, */ "dsh-additive"] } }
}
```

改动后执行：

```bash
cd ~/.dsh/profiles/web && pnpm install   # 建立/刷新 node_modules 软链
```

然后**重启 DSH web**（新增 bundle 需要 host 端重新组合；仅刷新页面不够）。

## 开发构建

```bash
cd dsh-additive
pnpm install        # 首次
npm run build       # tsc（host）+ esbuild（client bundle，lib/client.js）
```

产物：

- `lib/index.js` — host 入口（注册 `additive` settings namespace）
- `lib/client.js` — 浏览器 bundle（`window.__ModuleLoader__` 包装，react / @deepseek-ai/* 全部 external）

## 配置项（设置 → Additive）

| 字段 | 类型 | 存储位置 | 默认（留空时显示） | 说明 |
|------|------|------|------|------|
| Logo 图片 | 文件 | **图片字节 → 宿主磁盘** `~/.dsh/dsh-additive/logo.<ext>`；**引用 → 浏览器 localStorage** | 内置 DSH Launcher 图标（bundle 内 base64） | 上传本地图片（PNG/JPG/WebP/GIF/SVG/AVIF，≤2MB）；"删除本地图片"恢复默认 |
| `brandName` | string | 浏览器 localStorage | 空（保留官方 DeepSeek 标识 wordmark） | 品牌文字；自定义后替换 wordmark |
| `brandVersion` | string | 浏览器 localStorage | `Launcher` | 品牌名后的深色版本徽章 |
| `inputHistoryEnabled` | boolean | `~/.dsh/settings.yaml` | `false` | 输入框 ↑/↓ 历史回溯开关 |

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
