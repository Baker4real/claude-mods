---
type: readme
title: claude-mods：本机 Claude Code mod 市场
tags: [Claude Code, mod, plugin, marketplace, handoff-status, collapse-work, context-bar-zh]
intent: 查找本机 Claude Code mod 的位置、安装与发布方式和检查命令；各 mod 的行为与已知限制见各自目录下的 README.md。
---

# claude-mods

本机 Claude Code mod（插件）的本地市场 `claude-mods`。`.claude-plugin/marketplace.json` 登记 mod，条目的 `source` 指向 `dist/<mod>`：用 `scripts/Publish-Mod.ps1` 从工作副本 `<mod>/` 发布出来、通过了检查的运行时文件。headless 和桌面端会话都直接读 `dist/<mod>`（证据见「发布」一节末条），发布后在终端会话里运行 `/reload-plugins` 或开新会话即生效，已开着的桌面会话不用重开也会换上（证据同在末条），都不用重装；只改工作副本不影响任何会话。

## 现有 mod

每个 mod 的行为和已知限制（含真机核验记录）写在它自己的 README 里；第三方改版的来源和本地改动另见同目录的 `SOURCE.md`。

- [handoff-status](handoff-status/README.md)：输入框上方的「待你处理」带，外加本轮进度、完成状态和 API 出错后的 [继续]。
- [collapse-work](collapse-work/README.md)：一轮结束后把最终回答之前的过程收成一行「Worked for Xs」。
- [context-bar-zh](context-bar-zh/README.md)：输入框上方的上下文用量条，上游 `context-bar` 的简体中文改版。

## 安装与检查

用户级安装，之后新开的会话都会加载（headless 会话已实测；桌面端 Code 标签页的本地会话按官方说明也会加载，context-bar-zh 已由用户在新开的桌面会话里确认，2026-11-01）：

```powershell
claude plugin marketplace add 'D:\agents\projects\claude-mods'
claude plugin install handoff-status@claude-mods
claude plugin install collapse-work@claude-mods
claude plugin install context-bar-zh@claude-mods
```

- `claude plugin list`：应列出 `handoff-status@claude-mods`、`collapse-work@claude-mods` 和 `context-bar-zh@claude-mods`，`Read from:` 分别指向 `D:\agents\projects\claude-mods\dist\handoff-status`、`dist\collapse-work` 和 `dist\context-bar-zh`。
- 装了上游 `context-bar@claude-code-mods` 的机器，装 `context-bar-zh` 后先 `claude plugin disable context-bar@claude-code-mods`。
- 改了 `.claude-plugin/marketplace.json`（加 mod、改 `source`）后跑 `claude plugin marketplace update claude-mods`，`Read from:` 才跟着变；2026-10-20 把 `source` 从 `./handoff-status` 改成 `./dist/handoff-status` 时，只跑这一步就够了，不用重装。

### 发布

改动在工作副本 `<mod>/` 里做，再发布到已安装插件读取的 `dist/<mod>`：

```powershell
& D:/agents/projects/claude-mods/scripts/Publish-Mod.ps1 handoff-status
```

- 先对工作副本跑 `claude plugin validate`、`claude plugin test`、`tsc -p <mod> --noEmit` 和 `scripts/Test-BandStacking.ps1`（画 `AbovePrompt` / `BelowPrompt` 的 hook 必须用 `stackBands` 叠在下层 mod 的条带上），任一失败就退出 1，`dist/` 不动。
- 都通过后，把 `dist/<mod>` 现有文件复制到 `dist/.previous/<mod>`，再复制运行时文件：`.claude-plugin/plugin.json`、`hooks/`、`types/`，以及存在时的 `assets/`、`commands/`、`agents/`、`skills/`；`tests/`、`tsconfig.json` 和引擎放的 `.claude-plugin/types/` 不发布。最后校验 `dist/<mod>` 并逐个比对哈希，任一不通过就从 `dist/.previous` 恢复。
- 脚本不删文件：`dist/<mod>` 里有工作副本已没有的文件时，拒绝发布并列出这些文件，用受管回收移走后再发。
- `dist/<mod>` 已是工作副本的版本号、运行时文件却变了时，拒绝发布并列出这些文件，先升 `version`：会话和各项检查报的都是版本号，同一个版本号只该对应一份内容；`claude plugin update` 也只认版本号，版本没变时报 `up_to_date`（2026-11-01 实测）。
- 发布后对每个安装范围跑 `claude plugin update <mod>@claude-mods --scope <范围>`，再回读 `installed_plugins.json`：安装记录要是新版本，缓存副本要与 `dist` 逐个文件一致，否则退出 1（这时 `dist` 已发布）。
- 安装时 CLI 另把插件复制到 `C:\Users\WINDOWS\.claude\plugins\cache\claude-mods\<mod>\<version>`，`installed_plugins.json` 的 `installPath` 指向这份副本，但会话加载的是 `dist`，与 `claude plugin list` 的 `Read from:` 一致。headless（2.1.310）看 `Test-FreshSession.ps1` 打印的加载路径；桌面端（2.1.309）看 context-bar-zh 的 `loads`：2026-11-01 09:26Z 发布 0.1.5-zh.4 后，三个桌面会话在 09:40–09:44Z 各记下一条，`$.plugin.root` 都是 `dist\context-bar-zh`。这三个会话都在发布前就开着，没重开也换上了新版：一条与该会话那一轮结束在同一秒，另两条在用户向该会话发下一条消息前几秒；记下的是重载后的第一次绘制，重载本身在什么时候没测出来。更早的旁证来自同日的 collapse-work：0.2.0 的探针代码只在 `dist` 里，缓存那时只有不含这段代码的 0.1.0，插件 store 的 `probe` 里却已有一个桌面会话（`entrypoint` 为 `claude-desktop`）记下的 23 条，那个会话也没有从开发文件夹加载插件。所以新会话拿到新版不靠 `claude plugin update <mod>@claude-mods`，它只让安装记录和缓存跟上 `dist`；发布前照旧升 `version`。实测它在缓存里新建该版本的目录，内容与 `dist` 一致，旧版本目录留着，多一个记着更新时刻（毫秒时间戳）的 `.orphaned_at`；配置文件只改 `installed_plugins.json`，`settings.json` 没动。`claude plugin list` 的 `Version:` 不取自安装记录（collapse-work 的记录还是 0.1.0 时，它已显示 0.2.0），缓存有没有更新，看 `installed_plugins.json` 的 `version` 和 `installPath`。

### 新会话核验

```powershell
& D:/agents/projects/claude-mods/scripts/Test-FreshSession.ps1 -InitOnly -ExpectTools mcp__handoff-status__hand_off,mcp__handoff-status__close_handoff
```

- 开一个 headless 新会话，读首个 `system/init`：插件要在 `plugins` 里（打印加载路径），`-ExpectTools` 列出的工具要在 `tools` 里。末行是 `PASS` 或 `FAIL: <原因>`，退出码 0 或 1。
- `-InitOnly` 拿到 init 就结束子进程树，不发模型请求，约 4 秒；不带它就跑完一轮，结果不能是错误，约 13 秒。`-WithoutPlugin` 只在这次运行里关掉插件，检查它确实不在。
- collapse-work、context-bar-zh 不注册工具，核验用 `-Plugin <mod> -InitOnly`，不带 `-ExpectTools`。
- 子进程启动前清掉继承的 `CLAUDE*` 环境变量，启动后还原：从桌面会话的工具 shell 直接起 `claude -p`，子进程会等宿主给登录态，报 `Not logged in`。输出写到 `D:/Codex/temp/claude-mods/fresh-session/`，每次覆盖。

### 其他检查

- `claude plugin validate 'D:\agents\projects\claude-mods'`：检查市场文件、manifest 和 hooks 模块。
- `claude plugin test 'D:\agents\projects\claude-mods\handoff-status'`：跑 `tests/` 里的测试。
- `tsc -p 'D:\agents\projects\claude-mods\handoff-status' --noEmit`：类型检查。`tsconfig.json` 继承 `.claude-plugin/types/` 里引擎生成的声明；本目录这份是 2026-10-20 从 2.1.299 的开发副本复制来的。引擎只在热加载开发文件夹（会话 mods 文件夹、`--plugin-dir`、`CLAUDE_CODE_PLUGIN_DIRS`）时重写它，装成插件后的加载不会刷新。mod 自己注册的两个工具不在引擎生成的 MCP 声明里，已在 `types/index.d.ts` 手写。按名字查声明：`& D:/agents/projects/claude-mods/scripts/Show-ModApi.ps1 <名字>`，默认读 plugin-authoring skill 为当前版本写下的那份（`D:/Codex/temp/claude/bundled-skills/<版本>/<哈希>/plugin-authoring/types/claude-code.d.ts`），没有时才读这份 2.1.299 的副本；块长时只列成员，`-Full` 打印整块。

## 候选（未做）

2026-10-20 复盘最近 20 次会话后提出、当时决定暂缓的两个 mod：

- 会话动作账本（以后按需再做）：只记录不拦截，覆盖删除、git commit/push/reset/删分支、计划任务、注册表/服务/自启、提权、ssh/scp 和对外发布（gh issue/pr/api），每条记命令、仓库或目录、成败和时间；push 前用 `git rev-list` 列出将要推出的提交，便于发现别的会话的提交被连带推出。只看得到命令文本，看不到脚本内部做了什么。
- 限额/断线后自动续跑（搁置）：限额提示带重置时间时到点自动发"继续"；断线、上游 5xx、过载按退避最多重试 3 次；余额不足、要求登录、安全拦截、模型不存在不重试，只提醒。handoff-status 0.2.0 已在 API 出错后给手动的 [继续]，自动续跑仍搁置。
