# claude-mods

本机 Claude Code mod 的本地市场。已安装的插件读的是 `dist/<mod>`（`claude plugin list` 的 `Read from:`），不是工作副本 `<mod>/`：发布到 `dist/` 之后，新开的会话加载新版本，已开着的桌面会话不重开也会换上（证据见 README「发布」末条），发布坏了，这些会话一起坏。安装、发布和核验见 [README.md](README.md)，各 mod 的行为和已知限制见各自目录下的 `README.md`。

## 改动与发布

在工作副本 `<mod>/` 里改，改完用 `& D:/agents/projects/claude-mods/scripts/Publish-Mod.ps1 <mod>` 发布：它先对工作副本跑 `claude plugin validate`、`claude plugin test`、`tsc -p <mod> --noEmit` 和 `scripts/Test-BandStacking.ps1`，任一失败就退出 1、`dist/` 不动；都通过才复制进 `dist/<mod>`，上一版留在 `dist/.previous/<mod>`。每次改运行时文件都升 `plugin.json` 的 `version`：`dist` 已是这个版本号时，变了的文件会被拒绝发布。发布后脚本自己跑 `claude plugin update`，让安装记录和缓存副本跟上 `dist`。`dist/` 只经这个脚本写入。

发布后用 `& D:/agents/projects/claude-mods/scripts/Test-FreshSession.ps1 -InitOnly -ExpectTools <工具名,...>` 开 headless 新会话，看 `system/init` 里插件从 `dist` 加载、工具都在（约 4 秒，不发模型请求）；连一轮回答一起验时去掉 `-InitOnly`。手动跑 tsc 也带 `--noEmit`：`.claude-plugin/types/` 缺失时 tsc 会把 `.js` 写到源码旁。改任何一份 README 后跑 OKF `lint --ci`（项目根有 `.okf-frontmatter.json`）。

## 真机核验

桌面端的按钮有没有生效，查会话记录 `C:\Users\WINDOWS\.claude\projects\<目录名>\<会话 id>.jsonl`（目录名是会话工作目录把 `:`、`\` 换成 `-`，如 `D--agents-projects-misc`）。按钮发出的用户消息带 `"origin":{"kind":"plugin","name":"<mod>"}`，以用户名义回的另带 `"asUser":true`，人手输入的是 `{"kind":"human"}`；`entrypoint` 为 `claude-desktop` 说明来自桌面端。统计用 `rg -o '"origin":\{[^}]*\}' <记录>`。

桌面端加载的是哪一份、让 mod 画了什么，会话记录里看不到：让 mod 把它记进插件 store，再读 `C:\Users\WINDOWS\.claude\plugins\store\<mod>_claude-mods-*.json`。现成的两个：context-bar-zh 的 `loads`（每个界面第一次绘制时记下插件目录 `$.plugin.root`、界面和会话 id），collapse-work 的 `probe`（桌面端每次请它画的行和折叠结果）。

## mod 写法里的坑

- 画 `AbovePrompt` / `BelowPrompt` 的 `ui.render` hook 先 `const rest = await next(e)`，再用 `hooks/bands.ts` 的 `stackBands` 把自己的叠上去：只返回自己的树会盖掉下层 mod 的条带（handoff-status 0.1.0 就盖住过 context-bar-zh）。`Publish-Mod.ps1` 用 `scripts/Test-BandStacking.ps1` 拦下不叠的。
- `$` 只传给文件顶层声明的函数（function 声明或绑定到函数的顶层 const）；闭包里的 helper 收 `$` 会让整个模块加载失败，validate 报错。
- `read` / `update` 的 atom 在调用处直接写文件顶层的 atom 常量；把 atom 当参数传给 helper，validate 会拒绝整个模块。
- mod 用 `$.tool.register` 注册的工具不在引擎生成的 MCP 类型里，在 mod 的 `types/index.d.ts` 里用 `McpToolInputs` 声明。
- 界面相关的定时工作只在 `$.session.surfaces()` 非空时启动：headless `-p` 运行里每次 `$.ui.invalidate` 都会变成一行 stream-json 输出。
- 按列数排满一行的内容（如横条）用 `<Text mono>` 画：桌面端按代码字体的字宽算 `bodyColumns`，界面字体里 `█─░` 这类字符更宽，会折行，`claude plugin test` 测不出来。
- 在 Windows 上跑 `claude plugin test`，引擎先把 mod 交给 `$.fs` 的 `/home/me/x` 解析成 `D:\home\me\x`，再交给测试里的 mock：按 POSIX 路径查表的 mock 要先把路径规整回去，写法见 `context-bar-zh/tests/context-bar.test.tsx` 的 `posix`。
- API、事件和元素按名字查：`& D:/agents/projects/claude-mods/scripts/Show-ModApi.ps1 <名字>`（如 `tool.call`、`session.surfaces`、`ToolCallResult`、`Pane`），打印声明和它的注释，长块只列成员，`-Full` 打印整块。classic 事件写 `classic.<事件>`，查到的是它的 `e`；`EngineEventOf`、`OpEventOf` 列出全部引擎事件和 `$` 上的调用。默认读 plugin-authoring skill 为当前版本写在 `D:/Codex/temp/claude/bundled-skills/<版本>/` 下的那份，没有时退回 handoff-status 里 2.1.299 的旧副本。一次查询约 1–3k 字符，整份有 2 万多行。

## 目录

- 每个 mod 一个工作副本子目录：`.claude-plugin/plugin.json`、`hooks/`、`tests/`，按需的 `types/index.d.ts`，以及写行为和已知限制的 `README.md`（不发布）。
- `dist/<mod>`：发布出的运行时文件，市场条目的 `source` 指向它；`dist/.previous/<mod>`：上一次发布前的文件。
- `scripts/`：`Publish-Mod.ps1`、`Test-BandStacking.ps1`、`Test-FreshSession.ps1`、`Show-ModApi.ps1`。
- 新 mod 在 `.claude-plugin/marketplace.json` 加一条 `"source": "./dist/<mod>"`，发布后按 README「安装与检查」装上。

## 当前状态

- 市场里的 mod 都已用户级安装，从 `dist/<mod>` 加载；各自桌面端还没真机核对的项列在各自 `README.md`「已知限制」。
- collapse-work 0.2.0 带临时探针（插件 store 的 `probe`），桌面折叠核对完就删，见 `collapse-work/README.md`。
- 候选 mod（会话动作账本、限额/断线后自动续跑）未做，见 README「候选（未做）」。
