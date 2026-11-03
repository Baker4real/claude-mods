# collapse-work 来源

第三方 mod 的本地改版。四个上游文件取自固定提交；`hooks/register.js` 和 `.claude-plugin/plugin.json` 在本地改过（见「本地改动」），`hooks/hooks.json` 和 `tests/collapse-work.test.ts` 与上游一致。

- 上游：<https://github.com/FrogAi/Xenopus/tree/dd7d84dc5e5eaf6bdc9bb557d85cff3af4fa6c19/claude/mods/collapse-work>
- 固定提交：`dd7d84dc5e5eaf6bdc9bb557d85cff3af4fa6c19`（2026-09-22，截至 2026-11-01 是上游这个目录唯一的一次提交）。上游后来改写了历史：2026-11-03 回查，它已不在 `master` 上（按 SHA 仍取得到），`master` 上这个目录唯一的提交是 `358c3679185093b3df8bb0d3eaa2a5ad6716318f`，四个文件的 blob 与下表相同
- 取用：2026-11-01，经 GitHub contents API 按该提交取原始字节
- 许可：The Unlicense（公有领域声明）。固定提交的仓库根就有 `LICENSE`（blob `efb98088164f5786b17e83ed384971fc3c74f93c`，`master` 上相同），`plugin.json` 没声明 `license`。2026-11-01 记成「上游仓库没有 LICENSE、只在本机自用」是记错了，2026-11-03 回查更正。可以复制、修改和公开分发，不要求署名

| 文件 | 上游 git blob | 现状 |
|---|---|---|
| `.claude-plugin/plugin.json` | `93dc0ca1084d39bd081ab5fb8226f8e5eaec4b92` | 本地改：`version` 0.3.0 |
| `hooks/hooks.json` | `0d5260d1760a8ef5d0f13a7450cc40f622d6bbfc` | 与上游一致 |
| `hooks/register.js` | `e36ad7fc156a1e33368b0bc96c9bb60824796708` | 本地改，见下 |
| `tests/collapse-work.test.ts` | `de6802d75944bd7328977cffe8958c3a73ce2d15` | 与上游一致 |

核对与上游一致的文件：`git hash-object --no-filters -- <文件>` 应等于上表。`dist/.previous/collapse-work` 存的是上一次发布的版本，不是上游原样；上游原始字节按上面的提交重取。

## 本地改动

0.3.0（2026-11-03）。0.2.0（2026-11-01）让桌面端也收工具行、工具组和写进 thinking 的过程说明，并加了临时探针。2026-11-03 按用户截图真机核对：过程说明和工具组标题由桌面端自己画，mod 收不了；被画成空的工具行在点开工具组时成了空行，单独的工具行留下空白（证据见 `D:\agents\run-evidence\claude-mods\20261103-collapse-work-desktop-check\RESULT.md`）。0.3.0 撤回这些，桌面端回到上游只收文字的做法。现在与上游相比只改了这几处：

- `textKey` 先去掉首尾空白再算哈希：桌面端交来的文字没有尾随空白，会话记录里有的段落带着。改动前存下的轮次如果文字首尾有空白，会认不出来，照常显示。
- 新增 `headerRow`：「Worked for」「You stopped after」这一行在终端照旧上方空一行，在桌面端不加边距。桌面端把 `marginTop: 1` 按一行行高画，叠在它自己的行间距上，多出一整行空白。
- `load` 删掉 0.2.0 留在插件 store 的 `probe` 键。
- `desktopHeader` 的注释改写成真机核对得出的原因。
- `tests/desktop-fold.test.ts`，共 4 项：桌面端只收文字，工具行和工具组照常；标题行在桌面端无边距、终端有；只有工具调用的一轮显示不可点的「Worked for」；进行中的一轮不动。

其他本地新增，都不发布到 `dist/`：

- `tsconfig.json`：继承引擎声明，开 `allowJs`、不开 `checkJs`，只包含 `hooks/` 和 `types/`。钩子是 JS，tsc 只做语法解析。测试没写类型，严格模式下报 TS7006，所以不交给 tsc，由 `claude plugin test` 运行。
- `.claude-plugin/types/`：从 `handoff-status` 复制的引擎声明（2.1.299），只供 tsc 用。
- 本文件。

## 换上游新版本

1. 按新提交重取上表四个文件，核对 blob。
2. 把「本地改动」手工合并进新的 `register.js` 和 `plugin.json`。
3. 重跑 `scripts/Publish-Mod.ps1 collapse-work`。
4. 更新本文件。
