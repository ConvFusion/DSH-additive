# DSH 自定义 Logo 插件开发计划

## 项目概述
开发一个 DeepSeek Harness (DSH) 第三方插件 `@rose43/dsh-custom-logo`，允许用户自定义左上角 Logo 图标和品牌文字，无需修改 DSH 核心源码。

---

## 功能规划

### v0.1 - 最小可用版本（MVP）
- [ ] 插件基础骨架（package.json、构建配置）
- [ ] 注册 `sidebar.brand.mark` 插槽替换 Logo
- [ ] 注册 `sidebar.brand.name` 插槽替换品牌文字
- [ ] 通过 `cordis.patch.yml` 配置自定义 Logo URL 和文字
- [ ] 安装到本地 web profile 验证可运行

### v0.2 - GUI 设置界面
- [ ] 在「通用设置」页面添加配置项
- [ ] Logo URL 输入框
- [ ] 品牌名称输入框
- [ ] 设置实时生效（无需重启）
- [ ] 支持回退到默认 Logo（不配置则使用官方默认）

### v0.3 - 增强功能
- [ ] 本地图片上传（选择本地图片文件，自动存储）
- [ ] Logo 样式自定义（大小、圆角）
- [ ] 明暗主题双 Logo 支持
- [ ] Logo 点击跳转 URL 自定义
- [ ] Logo 预览功能

---

## 技术实现细节

### 核心技术点
1. **Slot 系统**：使用 DSH 原生插槽机制覆盖品牌区域
   - 目标插槽：`sidebar.brand.mark`（图标）、`sidebar.brand.name`（文字）
   - API：`ctx.slots.register({ name, render })`

2. **插件结构**：遵循 DSH Cordis 插件规范
   ```
   packages/dsh-custom-logo/
   ├── package.json          # 包声明，dsh bundle 配置
   ├── cordis.patch.yml      # 默认配置
   ├── tsconfig.json
   ├── build.mjs             # esbuild 构建脚本
   └── src/
       ├── index.ts          # Host 端（Node.js）入口
       └── client.tsx        # Client 端（浏览器）入口
   ```

3. **配置存储**：使用 DSH 原生 settings 系统，自动持久化到 `~/.dsh/settings.yaml`

4. **参考插件**：
   - `@rose43/dsh-file`：第三方插件完整结构参考
   - `@deepseek-ai/dsh-client-ui-brand-official`：官方品牌实现参考
   - `dsh-convfusion`：本地开发插件链接方式参考

### package.json 核心配置
```json
{
  "name": "@rose43/dsh-custom-logo",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client.js"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "react": "^18.3.1"
  }
}
```

### 核心实现代码（v0.1）
```tsx
// src/client.tsx
import React from 'react';

export default function(ctx: any) {
  // 从配置读取
  const config = ctx.config.get('custom-logo') ?? {};
  
  // 替换 Logo 图标
  ctx.slots.register({
    name: 'sidebar.brand.mark',
    render: ({ size }: { size: number }) => {
      if (!config.logoUrl) return null; // 回退默认
      return (
        <img 
          src={config.logoUrl} 
          width={size} 
          height={size}
          style={{ borderRadius: config.borderRadius ?? 4 }}
          alt="custom logo"
        />
      );
    }
  });
  
  // 替换品牌文字
  ctx.slots.register({
    name: 'sidebar.brand.name',
    render: () => {
      if (!config.brandName) return null; // 回退默认
      return <span>{config.brandName}</span>;
    }
  });
}
```

```yaml
# cordis.patch.yml 默认配置
- id: custom-logo
  config:
    logoUrl: ""      # 自定义 Logo URL，空则用默认
    brandName: ""    # 自定义品牌名称，空则用默认
    borderRadius: 4
    clickUrl: ""     # v0.3 实现
```

---

## 开发与测试流程

### 本地开发步骤
1. 在 workspace 初始化插件项目
2. 使用 `pnpm link` 或本地 file: 依赖链接到 `~/.dsh/profiles/web/`
3. 在 profile 的 `package.json > dsh.profile.bundles` 添加插件包名
4. 运行 DSH web 模式测试
5. 利用 HMR 热重载快速迭代

### 安装启用方式
用户安装后只需要：
1. 在 `~/.dsh/profiles/web/` 执行 `npm install @rose43/dsh-custom-logo`
2. 在 `package.json` 的 bundles 数组中添加 `"@rose43/dsh-custom-logo"`
3. 重启 DSH 或刷新页面即可生效
4. 在「设置 → 通用」中配置自定义 Logo

---

## 里程碑
| 版本 | 目标 | 预计工作量 |
|------|------|-----------|
| v0.1 | 可工作的最小版本，通过配置文件自定义 | 30分钟 |
| v0.2 | GUI 设置界面，可视化配置 | 1小时 |
| v0.3 | 上传、主题适配、跳转等增强功能 | 2小时 |

---

## 后续扩展（可选）
- [ ] 支持预设 Logo 模板（内置几种常用风格）
- [ ] 支持动画 Logo（gif/apng/webp）
- [ ] 支持不同分辨率/尺寸适配
- [ ] 支持侧边栏折叠/展开不同 Logo
