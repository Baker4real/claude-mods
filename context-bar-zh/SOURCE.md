# context-bar-zh 来源

第三方 mod 的本地简体中文改版：取自上游 `context-bar` 0.1.5，界面改成简体中文，默认只显示用量一行和一条横条，点「展开」才显示标题和图例。

- 上游：<https://github.com/hamzafer/claude-code-mods/tree/1c9ca96fc5cb8aef40041265ed3aad6e564a8623/mods/context-bar>
- 固定提交：`1c9ca96fc5cb8aef40041265ed3aad6e564a8623`（2026-10-30）
- 取用：2026-11-01，从本机 `claude-code-mods` 市场的克隆（`C:\Users\WINDOWS\.claude\plugins\marketplaces\claude-code-mods`）复制；克隆检出成了 CRLF，换回 LF 后与上游 blob 逐字节一致
- 许可：MIT，`LICENSE` 是上游仓库根的原文。本仓库已公开在 GitHub；MIT 允许分发，条件是附上版权和许可声明，所以 `LICENSE` 要留在仓库里。`dist/` 只放运行文件，不含 `LICENSE`，`hooks/register.tsx` 文件头写了版权行并指向 `LICENSE`

| 文件 | 上游 git blob | 本地 |
|---|---|---|
| `LICENSE`（上游仓库根） | `eb4c21f9c11134646c3baf6aeccc048f1cba0d73` | 原样 |
| `tsconfig.json` | `8681ec01da419175c87f8c968c6a5af2d2b4e5ae` | 原样 |
| `hooks/bands.ts` | `00f403cd6620d11217793258a4f83b5be73b5979` | 原样 |
| `hooks/hooks.json` | `5a63f649593a5d89af8775a8e3d12db0f0940b12` | 原样 |
| `tests/bands.test.ts` | `e1ff13f5fda3a0cfb912c823442f25c632a0d508` | 原样 |
| `.claude-plugin/plugin.json` | `68f49ce209eb161e414b3d360a809cd27dca1760` | 改 |
| `hooks/register.tsx` | `3f8a04ce02b6d9069f596841bd4545124881001d` | 改 |
| `tests/context-bar.test.tsx` | `b5ef7a41e91b35e699a7c7c6bc808ae828df07d5` | 改 |
| `types/index.d.ts` | `64d01d62873539ae42572214b7b55eafa6cd6655` | 改 |

核对：标「原样」的文件，`git hash-object --no-filters -- <文件>` 应等于上表；标「改」的文件，对照上游提交里的同名文件看差异。

本地改动：

- `plugin.json`：名字 `context-bar-zh`，版本 `0.1.5-zh.7`，中文描述，补 `"license": "MIT"`；作者仍是上游作者。
- `register.tsx`：
  - 界面文字改成简体中文：标题「上下文」、「已用 X / Y · Z 时自动压缩」、图例类名（`NAMES` 表，表外的类名原样显示）、`/context-bar` 的说明和回执。
  - 默认折叠成两行：第一行是用量、自动压缩点和百分比，右边「展开」按钮；第二行是占满整行的横条。展开后是上游的整框（标题、用量、百分比、横条、图例）外加「收起」按钮。展开只在本会话有效（`isExpanded` 原子，不写 `$.store`），新会话一律折叠。
  - 图例按显示列宽换行（`cols`：中日韩和全角字符算 2 列），否则中文类名会把一行挤出框外。
  - 横条用 `mono`（等宽字体）画。桌面端按代码字体的字宽算 `bodyColumns`，用界面字体画时 `█─░` 更宽，横条会折成两行；终端忽略 `mono`。zh.5 起桌面端、VS Code、手机不再走这条路，只剩终端和未知的图形界面用字符横条。
  - zh.5 起桌面端、VS Code、手机另有一套画法（上游没有）：标题行「上下文 N%  已用 / 窗口」和「距自动压缩 X」，横条是 `Svg`（`barSvg`：按宽度百分比定位、遮罩切缝、中性部分用 `currentColor`），只分「固定占用 / 消息」两段加剩余轨道、压缩点刻度和缓冲区；展开后无边框，图例用 `swatchSvg` 色块。窄条带按列数省掉总数和「距自动压缩」（zh.6）。`NAMES` 补 `compact buffer`（自动压缩关闭时引擎给缓冲区的名字）。
  - 每个界面第一次绘制时，把本会话加载的插件目录（`$.plugin.root`）、界面、会话 id 和时间追加进 store 的 `loads`，zh.7 起另记所加载那份 `plugin.json` 里的版本号，保留最近 20 条：看得出桌面会话读的是 `dist` 还是安装缓存、是哪个版本。上游没有这项。
  - 状态原子和条带名改用 `context-bar-zh`：条带键是 `band:context-bar-zh`，`bands.json` 的顺序里也写这个名字。
- `types/index.d.ts`：`PluginState` 的键改成 `context-bar-zh`，加 `isExpanded`。
- `tests/context-bar.test.tsx`：跟着改插件名、中文文字和默认折叠，加折叠、展开、收起、按桌面界面挂载、记下加载目录和 `label`、`cols` 的断言；zh.5 起加矢量横条的几何、桌面端标题行与图例、窄条带分档、近压缩点警示色的断言，`engine()` 可传入别的用量；zh.7 起 `fs.read` 的 mock 对本插件的 `plugin.json` 返回一份测试用清单，加载记录多断言版本号，条带顺序文件的断言只数 `bands.json` 的读取。另修上游测试在 Windows 上的一处问题：引擎把 mod 给的 `/home/me/...` 解析成本机绝对路径（`D:\home\me\...`）再交给 `fs.exists`、`fs.read`，上游 mock 按 POSIX 路径查表查不到，两条条带顺序测试必失败（原样上游在本机 2.1.310 上同样是这 2 项失败）；现在 mock 先把路径规整回 POSIX 形式再查。

`/context-bar` 命令名没改，和上游版同时启用会撞名、多画一条，所以启用本版时停用上游版。

本地新增（上游没有，均不发布到 `dist/`）：

- `.claude-plugin/types/`：从 `handoff-status` 复制的引擎声明（2.1.299），只供 tsc 用。
- `tests/layout.dump.tsx`：给 `scripts/Test-BandLayout.ps1` 导出桌面端各列宽的绘制树。不叫 `*.test.tsx`，`claude plugin test` 不跑它；tsc 照常检查。
- 本文件。

换上游新版本：按新提交重取上表文件并核对 blob，把上游的改动手工合进标「改」的文件，重跑 `scripts/Publish-Mod.ps1 context-bar-zh`，再更新本文件。
