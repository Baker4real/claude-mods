---
type: readme
title: context-bar-zh：上下文用量条（简体中文改版）
tags: [Claude Code, mod, context-bar-zh]
intent: 查 context-bar-zh 的显示与刷新、加载记录、与上游 context-bar 的关系和已知限制。
---

# context-bar-zh

0.1.5-zh.4，2026-11-01 加入。第三方 mod 的本地简体中文改版，取自 hamzafer/claude-code-mods 固定提交里的 `context-bar` 0.1.5（MIT）；来源、blob 校验和本地改动见 [SOURCE.md](SOURCE.md)；安装、发布和新会话核验见[根目录 README](../README.md)。

- 输入框上方默认两行：第一行是「已用 X / Y · Z 时自动压缩」和百分比徽标（离自动压缩点 ≥70% 变黄、≥90% 变红），右边一个 [展开]；第二行是按类别着色的上下文窗口横条（系统提示、系统工具、MCP 工具、记忆文件、Skills、消息等，外加剩余空间和自动压缩缓冲）。
- 展开后是带框的完整视图，多出标题「上下文」和每类的 token 数、占比；右上角 [收起]。展开只在当前会话有效，新会话一律折叠。
- 每轮结束、`/compact`、`/clear` 后刷新；用量由引擎在本地估算，不调 token 计数接口。`/context-bar` 显示或隐藏，这个选择跨会话保留。
- 每个界面第一次绘制时，把本会话加载的插件目录（`$.plugin.root`）、界面、会话 id 和时间追加进插件 store（`C:\Users\WINDOWS\.claude\plugins\store\context-bar-zh_claude-mods-*.json`）的 `loads`，保留最近 20 条，用来核对桌面会话读的是哪一份。记录里没有版本号，只有 zh.4 起的代码会写。
- 命令名 `/context-bar` 与上游版相同，两者同时启用会撞名、多画一条，所以上游 `context-bar@claude-code-mods` 已停用（`claude plugin enable context-bar@claude-code-mods` 可恢复）。

## 已知限制

- 截至 2026-11-01 的核验：0.1.5-zh.4 的 28 项测试（含按桌面界面挂载、加载记录各一项）在 2.1.310 的测试套件上通过；headless 新会话（2.1.310）从 `dist/context-bar-zh` 加载了 0.1.5-zh.4，没有加载已停用的上游 `context-bar`。加载记录：2026-11-01 有三个桌面会话（2.1.309）写进了 `context-bar-zh_claude-mods-8ab2ddccf0ea.json`，`$.plugin.root` 都是 `dist\context-bar-zh`；三个会话都在发布前就开着，见根目录 README「发布」末条。桌面端（桌面 Code 标签页自带 2.1.309）：0.1.5-zh.1 的用户截图里，展开视图能显示，说明 [展开] 能用；折叠时横条折成了两行。按 2.1.309 的声明，桌面按代码字体的字宽算 `bodyColumns`，横条却是用界面字体画的，`█─░` 在界面字体里更宽。0.1.5-zh.3 改用 `mono` 画横条后，用户在新开的桌面会话里确认用量行和横条显示正常；zh.3 起的展开视图还没在桌面上看过。原样上游的两条条带顺序测试在 Windows 上必失败，是测试里的路径问题，已在本版测试修掉，见 SOURCE.md。改版固定在上游那次提交，不会自动跟随上游；上游更新要手工合并。
