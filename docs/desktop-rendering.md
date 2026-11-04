---
type: reference
title: 桌面端怎么画 mod 的 Box、Text、Svg
tags: [Claude Code, mod, desktop, ui.render, Box, Text, Svg, bodyColumns]
intent: 写或改要在桌面端显示的 mod 界面时，查元素画成什么 DOM、数字单位怎么换算、哪些写法在桌面上会折行或不起作用。
---

# 桌面端怎么画 mod 的 Box、Text、Svg

2026-11-03 读自桌面 app 4.4212（MSIX 包 `Claude_4.4212.0.0_x64__pzs8sxrjxfjjc`，自带 Claude Code 2.1.309）的前端包 `app\resources\ion-dist.asar`。2026-11-04 app 自动升级到 4.16336（`Claude_4.16336.0.0_x64__pzs8sxrjxfjjc`）后复查过一次，结果见「重新核对」末条。`claude plugin test` 只比对树、不排版，下面这些只能靠读桌面代码或离线复刻知道。只核对了桌面 app；VS Code 和手机也有 `Svg`，画法没核对。

`scripts/render-band-trees.mjs`（`scripts/Test-BandLayout.ps1` 调它）按这些规则离线复刻。桌面 app 升级后按「重新核对」一节复查，规则变了两处一起改。

## Box

- 数字宽高按字符算：`width: n` 是 `n ch`，`height: n` 是 `n lh`；`"40%"` 这样的百分比原样用。
- 间距：`gap`、`columnGap`、`rowGap`、`margin*`、`padding*` 的数字，横向是 `n ch`，纵向是 `calc(n * var(--engine-row-unit, .5lh))`。没设这个变量的地方半行一档；`Client` 元素的容器把它设成 `1lh`，collapse-work 在消息行里量到 `marginTop: 1` 也是一整行（`D:\agents\run-evidence\claude-mods\20261103-collapse-work-desktop-check\RESULT.md`）。`xs`…`xl` 换成桌面自己的间距令牌。

## Text

- 颜色：`color` 接主题名（`error`、`warning` 等）或色值。`dimColor` 没配 `color` 时是 `var(--engine-dim-ink, <主题的次要文字色>)`，配了是该色混 60% 透明；带 `color` 的 Text 把 `--engine-dim-ink` 设成同样的淡色，里层的 `dimColor` 随它。
- 折行：不给 `wrap` 或 `wrap="wrap"` 时是 `white-space: pre-wrap; overflow-wrap: anywhere`；`truncate` 系列是 `display: inline-block; max-width: 100%; white-space: pre; overflow: hidden; text-overflow: ellipsis; min-width: 0`。嵌套的里层 Text 按各自的 `wrap` 画，默认 `pre-wrap`，外层的 `truncate` 管不住它们。一行放几段时，按 `bodyColumns` 分档省掉次要的段（context-bar-zh 的 `TOTALS`、`HEADROOM`）。
- `weight`：regular 400、medium 500、semibold 600、bold 700。`mono` 换等宽字体，`tabular` 用等宽数字。

## Svg

- 画成 `<img src="data:image/svg+xml,…">`，样式 `display: block; max-width: 100%; border: 0; width: <width>px; height: <height>px`。`width={4096}` 被 `max-width: 100%` 压成整行宽，所以图里的几何写百分比（`x="12.5%"`），高度写死。
- 既然是 `<img>`，页面的 CSS 和主题变量都进不到图里。SVG 根上没写 `color`、`font-family` 时，桌面把条带的文字色和字体补上去，图里只有 `currentColor` 随主题变：中性色用 `currentColor` 加 `fill-opacity`，深浅主题都看得清。根上自己写了 `color`，就不再随主题。
- 引擎只收 `source`、`alt`、`width`、`height`、`isInteractive` 五个属性（没有 `key`），`alt` 不能为空，宽高最大 4096。
- `isInteractive` 的 Svg 不画成 `<img>`，装进带 sandbox 的 `<iframe>`，CSP 禁止脚本；清洗后找不到 svg 根时只显示 `alt` 文字（4.16336 读到）。

## bodyColumns

- 桌面端按代码字体的字宽算 `bodyColumns`，界面文字却用界面字体画：`█─░` 这类字符在界面字体里更宽，按列数排满一行的字符会折行。所以图形界面上按宽度铺满的内容用 `Svg`，终端上用 `<Text mono>`。

## 重新核对

- asar 是二进制包，用 `rg -a -o '.{0,300}<锚点>.{0,300}' <asar>` 取片段。锚点：`image/svg+xml`（Svg 转 `<img>`）、`isInteractive`（Svg 的属性）、`engine-dim-ink`（`dimColor`）、`engine-row-unit`（纵向单位）、`ink:`（条带传给 Svg 的文字色）、`bodyColumns`。压缩后的函数名每个版本都变，只当一次性路标。
- 离线复刻并量折行和溢出：`& D:/agents/projects/claude-mods/scripts/Test-BandLayout.ps1 <mod>`。真机：`scripts/Capture-ClaudeWindow.ps1` 只读截取 Claude 窗口。
- 2026-11-04 在 4.16336 上复查：Svg 的 `<img>` 样式和 4096 上限、SVG 根补色、`dimColor`、纵向单位、Text 两种折行样式都与上文一致，`isInteractive` 的 iframe 画法是这次读到的；Svg 只收五个属性、`alt` 不能为空、Text 的字重档位、`bodyColumns` 按代码字体算，这几条没重看。旧包已被替换，两版没有逐字比对。
