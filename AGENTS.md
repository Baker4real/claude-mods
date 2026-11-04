# claude-mods

本机 Claude Code mod 的本地市场。已安装的插件读的是 `dist/<mod>`（`claude plugin list` 的 `Read from:`），不是工作副本 `<mod>/`：发布到 `dist/` 之后，新开的会话加载新版本，已开着的桌面会话不重开也会换上（证据见 README「发布」末条），发布坏了，这些会话一起坏。安装、发布和核验见 [README.md](README.md)，各 mod 的行为和已知限制见各自目录下的 `README.md`。

## 改动与发布

在工作副本 `<mod>/` 里改，改完用 `& D:/agents/projects/claude-mods/scripts/Publish-Mod.ps1 <mod>` 发布：它先跑 `scripts/Test-Mod.ps1`（对工作副本跑 `claude plugin validate`、`claude plugin test`、`tsc -p <mod> --noEmit` 和 `scripts/Test-BandStacking.ps1`），任一失败就退出 1、`dist/` 不动；都通过才复制进 `dist/<mod>`，上一版留在 `dist/.previous/<mod>`。每次改运行时文件都升 `plugin.json` 的 `version`：`dist` 已是这个版本号时，变了的文件会被拒绝发布。发布后脚本自己跑 `claude plugin update`，让安装记录和缓存副本跟上 `dist`。`dist/` 只经这个脚本写入。

发布后用 `& D:/agents/projects/claude-mods/scripts/Test-FreshSession.ps1 -InitOnly -ExpectTools <工具名,...>` 开 headless 新会话，看 `system/init` 里插件从 `dist` 加载、工具都在（约 4 秒，不发模型请求）；连一轮回答一起验时去掉 `-InitOnly`。手动跑 tsc 也带 `--noEmit`：`.claude-plugin/types/` 缺失时 tsc 会把 `.js` 写到源码旁。提交时 pre-commit hook（`scripts/hooks/`，`core.hooksPath` 已指向它）对暂存了文件的 mod 跑 `Test-Mod.ps1 -Staged`，要求暂存的 `<mod>` 运行时文件与 `dist/<mod>` 是同一份，所以先发布、再把两边一起提交；暂存了 `.md` 时跑 OKF `lint --ci`。

`origin` 是 GitHub 上的公开仓库，推上去的内容任何人都能读。推送前用 `git log -p origin/main..<要推的 SHA>` 过一遍要推出去的改动，确认没有密钥、token、内网地址和别人的数据；第三方 mod 的许可和分发条件见各自的 `SOURCE.md`。

## 真机核验

桌面端的按钮有没有生效，查会话记录 `C:\Users\WINDOWS\.claude\projects\<目录名>\<会话 id>.jsonl`（目录名是会话工作目录把 `:`、`\` 换成 `-`，如 `D--agents-projects-misc`）。按钮发出的用户消息带 `"origin":{"kind":"plugin","name":"<mod>"}`，以用户名义回的另带 `"asUser":true`，人手输入的是 `{"kind":"human"}`；`entrypoint` 为 `claude-desktop` 说明来自桌面端。统计用 `rg -o '"origin":\{[^}]*\}' <记录>`。

桌面端加载的是哪一份、让 mod 画了什么，会话记录里看不到：让 mod 把它记进插件 store，再读 `C:\Users\WINDOWS\.claude\plugins\store\<mod>_claude-mods-*.json`。现成的是 context-bar-zh 的 `loads`（每个界面第一次绘制时记下插件目录 `$.plugin.root`、版本号、界面和会话 id）。collapse-work 0.2.0 的 `probe`（桌面端每次请它画的行和折叠结果）已在 0.3.0 删掉，记录和结论存在 `D:\agents\run-evidence\claude-mods\20261103-collapse-work-desktop-check\`。

条带画成什么样：先离线跑 `scripts/Test-BandLayout.ps1 <mod>`，它用 mod 的 `tests/layout.dump.tsx` 导出各列宽的绘制树，按桌面样式规则排版，量折行和溢出，`-Screenshot` 另出浅、深色截图；字体和列宽是近似值。真机用 `scripts/Capture-ClaudeWindow.ps1` 只读截取 Claude 窗口，`-Frames`、`-Color` 连拍查闪烁。computer-use 不给操作 Claude 自己的窗口，内置浏览器不能操作本地文件页。

## mod 写法里的坑

- 画 `AbovePrompt` / `BelowPrompt` 的 `ui.render` hook 先 `const rest = await next(e)`，再用 `hooks/bands.ts` 的 `stackBands` 把自己的叠上去：只返回自己的树会盖掉下层 mod 的条带（handoff-status 0.1.0 就盖住过 context-bar-zh）。`Publish-Mod.ps1` 用 `scripts/Test-BandStacking.ps1` 拦下不叠的。
- `$` 只传给文件顶层声明的函数（function 声明或绑定到函数的顶层 const）；闭包里的 helper 收 `$` 会让整个模块加载失败，validate 报错。
- `read` / `update` 的 atom 在调用处直接写文件顶层的 atom 常量；把 atom 当参数传给 helper，validate 会拒绝整个模块。
- mod 用 `$.tool.register` 注册的工具不在引擎生成的 MCP 类型里，在 mod 的 `types/index.d.ts` 里用 `McpToolInputs` 声明。
- 界面相关的定时工作只在 `$.session.surfaces()` 非空时启动：headless `-p` 运行里每次 `$.ui.invalidate` 都会变成一行 stream-json 输出。
- 要铺满一行的内容（如横条），图形界面（desktop、vscode、mobile）上用 `Svg` 画：`width={4096}` 加桌面的 `max-width:100%` 正好铺满整行，图里的几何写百分比。字符画只留给终端；没有 `Svg` 的图形界面用 `<Text mono>`，因为桌面按代码字体的字宽算 `bodyColumns`，界面字体里 `█─░` 更宽，会折行。
- 一行几段文字放不下时，按 `bodyColumns` 分档省掉次要的段：桌面端嵌套的 `Text` 各自折行，外层的 `truncate` 管不住。这条和上一条 `claude plugin test` 都测不出来，用 `scripts/Test-BandLayout.ps1` 离线量；桌面怎么画元素见 `docs/desktop-rendering.md`。
- 在 Windows 上跑 `claude plugin test`，引擎先把 mod 交给 `$.fs` 的 `/home/me/x` 解析成 `D:\home\me\x`，再交给测试里的 mock：按 POSIX 路径查表的 mock 要先把路径规整回去，写法见 `context-bar-zh/tests/context-bar.test.tsx` 的 `posix`。
- API、事件和元素按名字查：`& D:/agents/projects/claude-mods/scripts/Show-ModApi.ps1 <名字>`（如 `tool.call`、`session.surfaces`、`ToolCallResult`、`Pane`），打印声明和它的注释，长块只列成员，`-Full` 打印整块。classic 事件写 `classic.<事件>`，查到的是它的 `e`；`EngineEventOf`、`OpEventOf` 列出全部引擎事件和 `$` 上的调用。默认读 plugin-authoring skill 为当前版本写在 `D:/Codex/temp/claude/bundled-skills/<版本>/` 下的那份，没有时退回 handoff-status 里 2.1.299 的旧副本。一次查询约 1–3k 字符，整份有 2 万多行。

## 目录

- 每个 mod 一个工作副本子目录：`.claude-plugin/plugin.json`、`hooks/`、`tests/`，按需的 `types/index.d.ts`，以及写行为和已知限制的 `README.md`（不发布）。
- `dist/<mod>`：发布出的运行时文件，市场条目的 `source` 指向它；`dist/.previous/<mod>`：上一次发布前的文件。
- `scripts/`：`Publish-Mod.ps1`、`Test-Mod.ps1`（两者共用 `ModFiles.ps1`）、`Test-BandStacking.ps1`、`Test-BandLayout.ps1`（排版用 `render-band-trees.mjs`）、`Capture-ClaudeWindow.ps1`、`Test-FreshSession.ps1`、`Show-ModApi.ps1`；`scripts/hooks/` 是 pre-commit hook。
- `docs/`：跨 mod 的参考，现有 `desktop-rendering.md`（桌面端怎么画 Box、Text、Svg）。
- 新 mod 在 `.claude-plugin/marketplace.json` 加一条 `"source": "./dist/<mod>"`，发布后按 README「安装与检查」装上。

## 当前状态

- 市场里的 mod 都已用户级安装，从 `dist/<mod>` 加载；各自桌面端还没真机核对的项列在各自 `README.md`「已知限制」。
- collapse-work 0.3.0 已删掉 0.2.0 的临时探针；桌面端只收最终回答前的文字，过程说明和工具组标题由桌面 app 自己画、收不了，见 `collapse-work/README.md`「已知限制」。
- 候选 mod（会话动作账本、限额/断线后自动续跑）未做，见 README「候选（未做）」。
