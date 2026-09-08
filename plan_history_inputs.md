# 开发计划：输入框 ↑/↓ 历史消息回溯插件

## 一、功能概述

### 1.1 需求描述
在 DSH Web 聊天输入框中实现类终端（shell/readline）的历史消息回溯功能：
- **↑ 键**：当光标位于输入框首行开头（或输入框为空）时，用最近一条用户发送的历史消息替换当前输入内容，可连续按 ↑ 逐条往前翻
- **↓ 键**：回溯过程中按 ↓ 往新的方向翻，翻到最新之后回到"当前草稿"状态（即用户翻历史前正在编辑但未发送的内容）
- **编辑保护**：如果用户在回溯出的历史消息基础上做了修改，这些修改不会污染原始历史记录；新草稿会被暂存

### 1.2 交互细节
| 场景 | 按键 | 行为 |
|------|------|------|
| 输入框为空，光标在开头 | ↑ | 填入上一条（最新）用户消息，光标置于末尾 |
| 已回溯到第 k 条历史 | ↑ | 填入第 k-1 条（更早）用户消息 |
| 已回溯到最早一条 | ↑ | 无变化（可蜂鸣/视觉提示，但非必须） |
| 已回溯到第 k 条历史 | ↓ | 填入第 k+1 条（更新）用户消息 |
| 已在最新历史条目 | ↓ | 恢复用户进入历史前的草稿内容；若本来没有草稿则清空 |
| 光标不在首行开头（多行输入中间） | ↑/↓ | 保持原生行为（在文本内移动光标），不触发历史回溯 |
| 回溯中用户编辑了内容 | 任意 | 自动将该修改视为"新草稿"，退出历史导航模式；再按 ↑ 从最新历史重新开始 |
| 用户发送消息 | Enter | 该消息加入历史栈，历史指针重置，草稿清空 |

### 1.3 历史范围
- 仅收录**当前会话中用户（human）发送成功的消息**，不收录 AI 回复、系统消息、工具调用
- 跨会话不持久化（MVP 阶段仅内存保存；后续可考虑 localStorage 按 conversationId 持久化）
- 去重可选：连续相同内容不重复入栈（类 bash HISTCONTROL=ignoredups，建议 MVP 先不做，保持简单）

---

## 二、技术方案

### 2.1 插件形式
新建独立 DSH 客户端插件，包名建议：`dsh-input-history`（或 `@rose43/dsh-input-history`）。

理由：
- 功能边界清晰，不侵入现有 `dsh-client-ui-conversation` 核心
- 可独立启用/禁用、独立发版
- 参考已有的第三方插件 `@rose43/dsh-file` 的结构

### 2.2 插件定位与注入依赖
```json
{
  "name": "dsh-input-history",
  "version": "0.1.0",
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  }
}
```

- 依赖 `dsh-client-runtime`：访问会话（session）/消息流
- 依赖 `dsh-client-ui-conversation`：订阅输入框相关事件 / 访问输入框 slot 或 DOM

### 2.3 核心数据结构
```ts
interface HistoryState {
  /** 用户已发送的消息，按时间从旧到新排列；stack[stack.length - 1] 是最新一条 */
  stack: string[];
  /**
   * 当前浏览位置索引，范围 [-1, stack.length)
   *   -1 ：表示"不在历史中"，输入框显示 draft
   *    k ：显示 stack[k]
   * 初始值 -1；每次发送后重置为 -1
   */
  pointer: number;
  /** 用户开始翻历史时输入框中的内容（未发送草稿），用于 ↓ 翻回去恢复 */
  draft: string;
}
```

每个会话（conversation）维护一份 `HistoryState`；切换会话时切换对应 state（用 conversationId 做 key 的 Map）。

### 2.4 实现路径（两条候选，推荐路径 A）

#### 路径 A：DOM 事件委托 + 会话 Store 订阅（推荐，MVP 最快）
**思路**：插件不尝试 React 内部 setState，而是：
1. 通过 runtime 订阅会话消息流，在"用户消息发送成功"事件里把文本 push 进 stack
2. 通过 `document.addEventListener('keydown', ...)` 在捕获阶段监听输入框上的 ↑/↓，基于光标位置判断是否拦截
3. 拦截时直接通过 `HTMLTextAreaElement.value = ...` + 触发 React 兼容的 `input` 事件来写入内容（React 18 内部依赖原生 value setter + 事件分发）

**优点**：
- 无需修改/反向依赖 conversation 插件内部组件
- 对现有代码侵入为零，升级 DSH 版本不易碎
- 实现工作量小，适合作为 additive 插件先行验证

**缺点**：
- 通过 DOM 写入需要兼容 React 的合成事件系统（需正确触发 native input event，参考 React 受控组件 hack 惯例）
- 依赖输入框的 DOM 选择器稳定性（可通过 `textarea[aria-label*="message" i]` 或"底部 composer 区域 textarea"等较稳健选择器）

#### 路径 B：使用 cordis 补丁 + slots 注入
**思路**：在 `cordis.patch.yml` 中为输入框组件增加一个 slot，或通过 `dsh-client-ui-slots` 提供的输入框相关插槽包裹增强。

**优点**：干净、无 DOM hack
**缺点**：需要先确认 slots 是否已有输入框相关插槽；若没有则需要对核心包提 patch，落地路径更长

**结论**：MVP 采用 **路径 A**；待功能稳定后若 DSH 官方开放输入框 slot，再迁移到路径 B。

### 2.5 关键实现要点

#### 2.5.1 识别输入框
在页面中选择"当前活跃会话的输入框"，候选策略：
- 选择器：`footer textarea, [data-testid="composer"] textarea, textarea[placeholder*="Send"]`
- 兜底：取页面中最后一个可见的 `<textarea>`（DSH 单会话页面通常只有一个主输入框）
- 在 mouseenter / focus 时缓存引用，避免每次 keydown 都查 DOM

#### 2.5.2 拦截 ↑/↓ 的判断条件
当且仅当以下**全部**满足才拦截并做历史导航：
1. 事件目标就是那个输入框 textarea
2. 没有修饰键（Shift/Ctrl/Meta/Alt）—— 保留 Shift+Enter 换行、Ctrl+↑ 等原生行为
3. 对于 ↑：`textarea.selectionStart === 0` 且 `textarea.selectionEnd === 0`（光标在最开头，无选区）
   - 多行输入时，只有光标真正位于第一行第一个字符前才触发；光标在中间行 ↑ 仍走原生光标移动
   - 简化判断可用 `selectionStart === 0`（效果：在任意行首按 ↑ 会触发，这也可接受，类 bash 行为）
4. 对于 ↓：当前处于历史浏览中（`pointer !== -1`），且光标位于文本末尾（`selectionStart === textarea.value.length`）
   - 若 `pointer === -1`（已在草稿态），不拦截，让原生行为继续（输入框为空时 ↓ 也无动作，自然）

拦截时需要 `event.preventDefault()` + `event.stopPropagation()`，避免光标被原生逻辑移动。

#### 2.5.3 写入 React 受控 textarea 的正确姿势
React 18 受控组件监听原生 `input` 事件，直接设置 `textarea.value = "xxx"` 不会触发 React 的 state 更新。需要：
```ts
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const proto = HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // 将光标放到末尾
  el.setSelectionRange(value.length, value.length);
}
```
这是绕过 React 受控状态的惯用技巧，多数插件（如浏览器扩展、油猴脚本）都使用这种方式。

#### 2.5.4 监听用户新消息入库
通过 `dsh-client-runtime` 暴露的会话 observable（API 待实际对接时确认），在"assistant 回复开始流式返回"或"用户消息 append 到 messages 列表"事件中把用户消息文本 `push` 到当前会话的 `stack`。

兜底方案：若 runtime 没有直接的 sent 事件钩子，则观察消息列表变化（订阅 conversation store 的 messages 数组），只新增 role === 'human' 的条目。

要点：
- 只追加 role=human 的文本内容
- 以 message id 去重，避免重复 push
- 消息发送成功（而不是按下 Enter 瞬间）才入栈，防止发送失败也污染历史

#### 2.5.5 检测用户在历史基础上编辑（退出历史模式）
当 `pointer !== -1`（正在浏览历史）且用户键入了任何会改变内容的键（可输入字符、Backspace、Delete、粘贴等），需要：
1. 将当前已被修改的内容视为新的 draft 暂存
2. 把 `pointer` 置为 -1，回到草稿态
3. 后续按 ↑ 重新从最新历史开始

实现方式：在 keydown 拦截之外，额外监听 `input` 事件。若 `pointer !== -1` 且 value 与 `stack[pointer]` 不同，就执行上述退出逻辑。

注意：通过插件本身 setTextareaValue 写入历史内容时，要用一个 `isProgrammaticUpdate` 标志位抑制此次 input 事件的处理，避免误判为用户编辑。

#### 2.5.6 会话切换
- 订阅当前激活 conversationId 的变化
- 用 `Map<conversationId, HistoryState>` 保存每个会话的历史
- 切换会话时，上一个会话的 pointer / draft 保留；切回来时状态恢复

#### 2.5.7 跨会话持久化（v0.2，可选）
- localStorage key：`dsh-input-history::<conversationId>`
- 保存 stack（建议限制条数，如最近 100 条）
- 不保存 pointer/draft（刷新页面后回到 -1/空即可）
- MVP 可不做，保持无副作用

### 2.6 视觉反馈（可选增强）
- 回溯时在输入框右上角/左下角显示一个浅色小提示：`历史 3/12` 或 `↑/↓ 浏览历史`
- 也可完全不做提示，靠肌肉记忆，与终端保持一致

### 2.7 边界情况处理
- **输入框 IME 组合输入中**：在 `compositionstart` 到 `compositionend` 期间，↑/↓ 交给 IME（候选词选择），不拦截
- **多行长内容**：selectionStart===0 的判断天然保证"光标在最开头"才触发；用户在中间编辑不受影响
- **历史消息很长**：textarea 自动扩容行为由 DSH 原生处理，插件无需干预
- **新会话（没有历史）**：按 ↑ 无任何反应，与终端一致
- **附件/多模态消息**：MVP 阶段只处理纯文本输入；如果用户发的是带附件的消息，可跳过不入栈，或仅入文本部分
- **重启/刷新**：MVP 内存状态清空；持久化是后续增强

---

## 三、项目结构

```
DSH-additive/
└── dsh-input-history/
    ├── package.json
    ├── tsconfig.json
    ├── tsconfig.client.json
    ├── README.md
    ├── scripts/
    │   └── build-client.mjs        # 参考 dsh-convfusion 的 client 构建脚本
    └── src/
        ├── index.ts                # 服务端/宿主端入口（可为空壳，或做设置项注册）
        └── client/
            └── index.tsx           # 客户端插件入口，核心逻辑
```

### 3.1 客户端入口核心模块划分
```
src/client/index.tsx
├── 类型与状态
│   ├── HistoryState
│   └── Map<conversationId, HistoryState> states
├── DOM 层
│   ├── getActiveTextarea(): HTMLTextAreaElement | null
│   ├── setTextareaValue(el, value)
│   └── bindTextareaEvents(el)        // keydown / input / compositionstart
├── 历史导航逻辑
│   ├── navigate(direction: 'up' | 'down')
│   ├── exitHistoryMode(reason)
│   └── resetOnSend()
├── Store 订阅
│   ├── subscribeToConversationChanges()
│   └── subscribeToNewMessages()
└── 插件注册
    └── export default plugin(ctx) { ... }
```

### 3.2 构建与注册
参考 dsh-convfusion：
1. `npm run build:client` 通过 esbuild 将 `src/client/index.tsx` 打包为单文件 `lib/client.js`
2. 在 DSH profile 的 node_modules 下创建软链或直接 `pnpm link`
3. 重启 dsh web 让插件清单（`__DSH_BOOT__.entries`）扫描到本插件（dsh 应自动扫描 node_modules 下带 `dsh.client` 字段的包）
4. 在 DSH 插件管理页面启用本插件

---

## 四、开发步骤

### Phase 0：准备工作（0.5 天）
1. [ ] 从 dsh-convfusion 拷贝一份最小插件脚手架到 `DSH-additive/dsh-input-history/`（package.json / tsconfig / build-client.mjs）
2. [ ] 删掉 ConvFusion 业务相关代码，保留最小可注册的 client 插件骨架
3. [ ] 修改包名为 `dsh-input-history`，修正 inject 依赖
4. [ ] 本地 link 到 `~/.dsh/profiles/web/node_modules/`，确认 DSH Web 能加载到空壳插件（控制台打一条 log 即可验证）

### Phase 1：核心历史导航（1 天）
1. [ ] 实现 textarea 定位与缓存逻辑（getActiveTextarea，监听 focusin/点击）
2. [ ] 实现 setTextareaValue（React 受控兼容写入）
3. [ ] 实现 keydown 拦截：按 ↑ 且 selectionStart===0 时，写入最近一条消息
4. [ ] 维护 stack / pointer / draft 三个状态字段，实现连续 ↑/↓ 导航
5. [ ] 实现草稿恢复：从历史模式一直 ↓ 回到 pointer===-1 时恢复 draft
6. [ ] 处理 IME composition：组合输入期间不拦截

### Phase 2：消息入库（0.5 天）
1. [ ] 通过 runtime / conversation 依赖订阅当前会话消息列表
2. [ ] 新的 human 消息 append 时，按 message id 去重 push 到 stack
3. [ ] 处理会话切换：用 Map 按 conversationId 隔离状态
4. [ ] 发送后重置 pointer/draft

### Phase 3：编辑检测与边界（0.5 天）
1. [ ] 实现 isProgrammaticUpdate 标志，避免写入历史时误触发"用户编辑"
2. [ ] 历史浏览中用户打字/粘贴/删除 → 自动保存当前内容为 draft 并退出历史模式
3. [ ] 空会话/历史顶端/低端的按键行为：无动作、不报错
4. [ ] 测试多行输入场景：光标在文本中间按 ↑/↓ 不应触发历史

### Phase 4：健壮性 & 体验打磨（0.5 天）
1. [ ] 监听页面导航/textarea 卸载，避免事件监听器泄漏
2. [ ] 可选：在输入框附近显示轻量历史位置提示（如"历史 2/15"）
3. [ ] 可选：设置项（最大历史条数、是否持久化到 localStorage）
4. [ ] 在不同主题（light/dark）下肉眼验证无样式冲突

### Phase 5：发布与文档（0.5 天）
1. [ ] README：功能说明、快捷键、已知限制、与终端 readline 的差异
2. [ ] 截图/GIF 演示
3. [ ] （可选）localStorage 持久化作为 v0.2 功能

**总工作量预估：3 人天左右**

---

## 五、风险与注意事项

| 风险 | 影响 | 应对 |
|------|------|------|
| DSH 核心升级后输入框 DOM 结构/选择器变化 | 插件失效（找不到 textarea 或误选） | 选择器做多级 fallback；启动时找不到就降级为不启用并打 warn 日志；版本兼容声明在 README |
| React 版本升级后 value setter hack 失效 | 写入不能同步到 React state | 已验证 React 18 可用；升级时做回归测试；预留路径 B（slot/patch）作为替代 |
| 多会话/多输入框场景（如分屏、子 agent 面板） | 错误地将历史写入非主输入框 | 通过"当前聚焦的 textarea"+"属于主 composer 区域"双重判断；子 agent 输入框可暂不处理或复用同一份历史 |
| 与其他可能拦截 ↑/↓ 的插件冲突 | 双方都 preventDefault 导致行为错乱 | 在捕获阶段绑定但不强制 stopImmediatePropagation；判断到已被 defaultPrevented 就不再处理 |
| IME（中文输入法）候选词选择被误拦截 | 用户无法选词 | 严格监听 compositionstart/end，组合态不拦截 |

---

## 六、验收标准

- [ ] 在空白输入框按 ↑，立即填入上一条已发送的用户消息，光标位于末尾
- [ ] 连续按 ↑ 可一直回溯到最早一条；到顶后再按无副作用
- [ ] 回溯过程中按 ↓ 可向新的方向翻；翻到底后回到输入前的草稿状态
- [ ] 光标在输入内容中间（非开头/末尾）时，↑/↓ 保持原生行为（移动光标）
- [ ] 在回溯出的历史内容上直接编辑后，按 ↑ 不会覆盖当前编辑，而是退出历史模式
- [ ] 发送新消息后，该消息出现在历史栈顶，指针重置为空
- [ ] 切换到别的会话再切回，各自的历史互不干扰
- [ ] 中文输入法组合输入状态下，↑/↓ 正常选词，不触发历史
- [ ] 刷新页面前提：MVP 可接受历史清空（后续版本再持久化）
- [ ] 插件禁用后行为完全回到原生，无残留监听器/DOM 修改

---

## 七、后续可扩展方向

1. **持久化**：localStorage 按 conversationId 保存最近 N 条历史（如 100 条）
2. **历史搜索**：Ctrl+R 反向搜索（类 bash reverse-i-search）
3. **跨会话全局历史**：类似 zsh 的全局历史，可在新会话中复用
4. **多行历史条目折叠预览**：回溯时超长内容在输入框中显示预览，确认后再完整填入
5. **设置面板**：启用/禁用开关、最大历史条数、是否在新会话保留历史等
6. **官方 slot 迁移**：若 DSH 后续开放输入框增强 slot，从 DOM hack 迁移到 slot 注入，去除选择器依赖
