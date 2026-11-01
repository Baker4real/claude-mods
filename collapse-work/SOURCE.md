# collapse-work 来源

第三方 mod 的本地改版。四个上游文件取自固定提交；`hooks/register.js` 和 `.claude-plugin/plugin.json` 在本地改过（见「本地改动」），`hooks/hooks.json` 和 `tests/collapse-work.test.ts` 与上游一致。

- 上游：<https://github.com/FrogAi/Xenopus/tree/dd7d84dc5e5eaf6bdc9bb557d85cff3af4fa6c19/claude/mods/collapse-work>
- 固定提交：`dd7d84dc5e5eaf6bdc9bb557d85cff3af4fa6c19`（2026-09-22，截至 2026-11-01 是上游这个目录唯一的一次提交）
- 取用：2026-11-01，经 GitHub contents API 按该提交取原始字节
- 许可：上游仓库没有 LICENSE，`plugin.json` 也没声明 `license`；只在本机自用，不再分发

| 文件 | 上游 git blob | 现状 |
|---|---|---|
| `.claude-plugin/plugin.json` | `93dc0ca1084d39bd081ab5fb8226f8e5eaec4b92` | 本地改：`version` 0.2.0 |
| `hooks/hooks.json` | `0d5260d1760a8ef5d0f13a7450cc40f622d6bbfc` | 与上游一致 |
| `hooks/register.js` | `e36ad7fc156a1e33368b0bc96c9bb60824796708` | 本地改，见下 |
| `tests/collapse-work.test.ts` | `de6802d75944bd7328977cffe8958c3a73ce2d15` | 与上游一致 |

核对与上游一致的文件：`git hash-object --no-filters -- <文件>` 应等于上表。上游原样的 0.1.0 运行时文件在 `dist/.previous/collapse-work`（2026-11-01 发布 0.2.0 时留下，下次发布会被覆盖）。

## 本地改动

0.2.0（2026-11-01）。起因：0.1.0 在桌面端只收最终回答之前的文字。用户截图的那一轮用了 21 分钟、55 次工具调用，只收起 2 段文字，工具行、「Ran N commands」分组和灰色过程说明都还在，看上去像没生效。上游注释说桌面端的工具行由 app 自己画；2.1.309 的引擎声明里，`ToolUse`、`ToolResult`、`ToolGroup` 已标为各界面都会请求。

- 桌面端新增 `ToolUse`、`ToolResult`、`ToolGroup` 的 `ui.render` hook：已折叠且未展开的一轮，按 `tool_use_id` 认出它的工具行和工具组，画成空。
- 记下 Opus 5.5 写进 `thinking` 块的过程说明（非空的才记，存 `noteKeys`），桌面端按文字哈希认出这些说明并一起收起；终端不变。
- 下列工具的行不收，含这些调用的工具组也不收：`KEPT_TOOLS`（`AskUserQuestion`、`ExitPlanMode`、`SendUserFile`、`Artifact`、`mcp__visualize__show_widget`）和 `mcp__ccd_` 开头的桌面 app 自带工具（计划、下一步框、会话卡片等）。tool_use 的 id 存在 `keptRows`。
- 桌面端标题行：除了不收的行之外，最终回答之前还有内容的，画成可点的「Worked for Xs ▸」；否则是一行不可点的「Worked for Xs」。
- `textKey` 先去掉首尾空白再算哈希，因为过程说明在会话记录里带尾随空格。改动前存下的轮次如果文字首尾有空白，会认不出来，照常显示。
- 临时探针：记下桌面端请 mod 画的每一行，以及折叠逻辑怎么处理了它（`unmapped`、`shown`、`header`、`hidden`、`kept`）。每行每种结果只记一条，最多 400 条；在每轮开始和结束时写进插件 store 的 `probe` 键，只保留最近一个会话。真机核对完就删掉。
- 新增 `tests/desktop-fold.test.ts`，共 4 项。

其他本地新增，都不发布到 `dist/`：

- `tsconfig.json`：继承引擎声明，开 `allowJs`、不开 `checkJs`，只包含 `hooks/` 和 `types/`。钩子是 JS，tsc 只做语法解析。上游测试没写类型，严格模式下报 TS7006，所以不交给 tsc，由 `claude plugin test` 运行。2.1.310 上 8 项全部通过，含上游 4 项。
- `.claude-plugin/types/`：从 `handoff-status` 复制的引擎声明（2.1.299），只供 tsc 用。
- 本文件。

## 换上游新版本

1. 按新提交重取上表四个文件，核对 blob。
2. 把「本地改动」手工合并进新的 `register.js` 和 `plugin.json`。
3. 重跑 `scripts/Publish-Mod.ps1 collapse-work`。
4. 更新本文件。
