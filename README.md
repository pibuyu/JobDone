# JobDone

一个轻量的 macOS 桌面悬浮待办工具。它会常驻在桌面上方，失焦后自动收起成紧凑小窗，只展示当前待办列表；需要添加或编辑待办时，点击小窗即可展开。

这个版本基于开源项目 [KoNananachan/JobDone](https://github.com/KoNananachan/JobDone) 做了轻量化改造，删掉了分类、优先级、搁置状态和语言切换，只保留日常使用里最直接的待办管理能力。

## 一键安装

### 推荐方式：下载 DMG

1. 打开项目的 GitHub Releases 页面。
2. 下载 `JobDone-0.2.1-mac-arm64.dmg`。
3. 双击打开 DMG，把 `JobDone.app` 拖到 `Applications`。
4. 第一次启动时，如果 macOS 提示未签名应用，打开 Finder 中的 `Applications`，右键 `JobDone`，选择 `打开`。

### 已拿到 DMG 文件时的命令安装

如果同事已经拿到了 `JobDone-0.2.1-mac-arm64.dmg`，也可以在终端一键安装：

```bash
hdiutil attach JobDone-0.2.1-mac-arm64.dmg
cp -R /Volumes/JobDone\ 0.2.1/JobDone.app /Applications/
hdiutil detach /Volumes/JobDone\ 0.2.1
open /Applications/JobDone.app
```

### 从源码构建安装

适合需要自己打包或二次改造的同事：

```bash
git clone <your-repo-url>
cd JobDone
npm ci
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never --mac --arm64
open release/JobDone-0.2.1-mac-arm64.dmg
```

## 核心功能

- 桌面悬浮显示，默认置顶。
- 失焦后自动收起，只展示待办列表；最多展示 9 行，超过后列表内部滚动。
- 失焦紧凑态保留顶部 `JobDone` 拖动栏，拖动窗口不会展开编辑 UI。
- 点击紧凑小窗的内容区域才展开添加栏、筛选栏和设置按钮。
- 支持添加根待办和递归子待办。
- 子待办不计入待办数量，只有根待办会算作一条待办。
- 完成父待办时，会递归完成其下所有子待办。
- 每条待办左侧是完成按钮，右侧依次是添加子待办、置顶、删除。
- 双击待办文本可以编辑。
- 支持识别 `https://`、`http://` 和 `www.` 链接，点击后用浏览器打开。
- 点击完成时恢复原版彩带动效。
- macOS 菜单栏显示未完成根待办数量。
- 设置页只保留字体大小和字体颜色。

## 使用方式

| 操作 | 方式 |
| --- | --- |
| 添加待办 | 点击小窗展开后，在输入框输入内容并回车 |
| 输入中文 | 输入法组词阶段按 Enter 不会误提交 |
| 完成待办 | 点击待办最左侧圆形完成按钮 |
| 添加子待办 | 点击待办右侧的 `+` 按钮 |
| 置顶待办 | 点击待办右侧的图钉按钮 |
| 删除待办 | 点击待办最右侧删除按钮 |
| 编辑待办 | 双击待办文本 |
| 打开链接 | 点击待办文本里的链接 |
| 拖动窗口 | 失焦紧凑态拖动顶部 `JobDone` 标题栏 |
| 调整字体 | 展开后点击右上角设置按钮 |

## 数据位置

所有数据都存储在本机，不依赖账号、云同步或远端服务。

macOS 数据文件：

```text
~/Library/Application Support/jobdone/jobdone.json
```

应用启动时会自动保存快照，最多保留 10 份：

```text
~/Library/Application Support/jobdone/jobdone.snapshot-*.json
```

如需迁移或备份，只需要复制 `jobdone.json`。

## 开发命令

```bash
npm run dev       # 本地开发，启动 Vite + Electron
npm run build     # 构建前端资源
npm start         # 用生产构建启动 Electron
npm run pack      # 打包 .app，不生成 DMG
npm run dist:mac  # 生成 macOS DMG
```

本项目使用：

- Electron 31
- React 18
- TypeScript
- Vite
- electron-builder

## 打包说明

macOS arm64 打包命令：

```bash
npm ci
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never --mac --arm64
```

产物位置：

```text
release/mac-arm64/JobDone.app
release/JobDone-0.2.1-mac-arm64.dmg
```

由于当前没有 Apple Developer ID 签名，首次打开时 macOS 可能会触发 Gatekeeper 提示。使用 Finder 右键打开一次即可。

## 与原版的主要差异

- 删除 Work / Personal 分类管理。
- 删除优先级和 workload。
- 删除搁置状态，只保留进行和完成。
- 删除语言切换，界面固定为中文。
- 设置页只保留字体大小和字体颜色。
- 添加递归子待办。
- 添加置顶按钮。
- 添加链接识别和浏览器打开。
- 添加失焦自动收起和紧凑窗口高度自适应。
- 菜单栏显示未完成根待办数量。

## License

原项目使用 [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)。本改造版本仍遵循原项目 License。
