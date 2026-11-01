---
type: readme
title: collapse-work：把最终回答前的过程收成一行
tags: [Claude Code, mod, collapse-work]
intent: 查 collapse-work 的折叠行为、桌面端收与不收的内容、临时探针和已知限制。
---

# collapse-work

0.2.0，2026-11-01 加入。第三方 mod 的本地改版，基于 FrogAi/Xenopus 的固定提交，0.2.0 起桌面端也会收工具行。来源、blob 校验和本地改动见 [SOURCE.md](SOURCE.md)；安装、发布和新会话核验见[根目录 README](../README.md)。

- 一轮结束后，把最终回答之前的过程收进一行「Worked for Xs ▸」。点一下展开，再点收起；最终回答保持原样。被中断的一轮不折叠，只在开头标「You stopped after Xs」。
- 桌面端（0.2.0 起）收这几类：最终回答之前的文字、单个工具行及其结果、工具组（「Ran N commands」），以及 Opus 5.5 写进 thinking 的过程说明。
- 桌面端不收需要你看或要你点的行：桌面 app 自带的卡片（`mcp__ccd_*`，如计划、下一步框、会话卡片）、`AskUserQuestion`、`ExitPlanMode`、`SendUserFile`、`Artifact`、`mcp__visualize__show_widget`，以及含这些调用的工具组。除此之外最终回答前没有别的内容时，只显示一行不可点的「Worked for Xs」。
- 终端照旧收起工具行、结果和时长行，thinking 里的说明不另收。
- 只认加载之后完成的轮次。每个会话的轮次表存在插件 store，保留最近 30 个会话；不联网、不调模型、不起进程。
- 临时探针（0.2.0）：桌面端每请 mod 画一行，就记下这一行和折叠逻辑的处理结果，每行每种结果一条，最多 400 条。记录存在插件 store（`C:\Users\WINDOWS\.claude\plugins\store\collapse-work_claude-mods-*.json`）的 `probe` 键里，只留最近一个会话，供真机核对，核对完删掉。
- 文字一字不差重复的段落认不出属于哪一轮，照常显示；最终回答与别的段落重复的那一轮整轮不折叠。

## 已知限制

- 截至 2026-11-01 的核验：
  - 0.2.0 共 8 项测试（上游 4 项，本地桌面折叠 4 项），在 2.1.310 的测试套件上全部通过；headless 新会话（2.1.310）从 `dist/collapse-work` 加载了 0.2.0。
  - 0.1.0 的桌面真机表现：用户截图里那一轮用了 21 分钟、55 次工具调用，只收起 2 段文字，看上去像没生效；插件 store 里有这一轮的记录。
  - 0.2.0 的桌面折叠还没有真机核对（桌面 Code 标签页自带 2.1.309）。2.1.309 的声明里，`ToolUse`、`ToolResult`、`ToolGroup` 标为各界面都会请求；但据 anthropics/claude-code#96497 的一条评论，2.1.295 桌面端画「Ran N commands」分组头时不理 mod 的返回。
  - 写进 thinking 的过程说明能不能收，要看桌面端是否把它当作 `AssistantMessage`（`isSummary`）交给 mod 画（anthropics/claude-code#90425 描述了这类说明的显示方式），这一点等探针核对。内容为空的 thinking 块，桌面端怎么画 mod 管不到。
  - 上游只有一次提交，没有许可声明。这里固定在那次提交，不会自动跟随上游。
