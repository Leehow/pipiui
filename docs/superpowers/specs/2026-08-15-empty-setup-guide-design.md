# 空主界面引导：API Key → 项目 → 会话 + Git 提示

> Status: **approved, implementing.**
> Date: 2026-08-15.

## Background

朋友首次打开 Electron App 时，中间栏是空白 transcript +「新会话」输入框，
侧栏只有「暂无项目与会话」。无模型时曾自动弹出添加 Provider，关掉后
`localStorage` 记住不再出现。加项目时会静默 `git init`，本机没装 Git
也不提示。结果是：不知道要先配 Key、再加项目、再会话。

## Approved decisions

1. **自动建会话**：`addProject` 成功后，若该项目还没有会话，立刻
   `newSession` 并选中。这是普通 JSONL 会话，存在
   `userData/pi-agent/sessions/<项目路径编码>/`，不是 SQLite，也不是临时会话。
2. **Git 提示仅在本机没有 `git` 可执行文件时出现**；探测失败或方法缺失
   当 `unknown`，不出提示。关掉后写入 `pipiui:git-missing-dismissed`。
3. **空页当主引导，不再自动弹窗**。点「添加 API Key」才打开现有添加
   Provider。关掉弹窗后清单还在。
4. **方案：中间栏步骤清单**。不另做欢迎路由，不强制向导。

## Appearance

`projectsLoaded && !selectedSession` 时，中间栏渲染 `EmptySetupGuide`，
藏 composer 和「新会话」假标题。有选中会话后恢复正常聊天。

项目列表尚未加载完时不闪清单、不闪死输入框。

## Steps

第一个未完成步骤是主按钮：

1. **API Key**：`listModels` 已结算且为空。加载中显示「正在检查模型…」。
2. **项目**：项目列表为空。
3. **会话**：有项目但没有选中会话（删光会话才会落到这一步）。

## Git probe

现有 `capabilities().git` 只表示 host 接了 git API。新增可选
`probeGitBinary(): Promise<boolean>`：Electron / pi-backend 跑
`git --version`。`false` 才出提示。

## Out of scope

- Swift `EmptyStateView` / 2026-08-04 欢迎页稿
- 强制三步向导
- 加完 Key 后自动弹出文件夹选择器
- 营销向功能卖点列表

## Success

1. 全新安装、无 Key：空页主按钮是「添加 API Key」，不自动弹窗。
2. 有 Key、无项目：主按钮是「添加项目」。
3. 加完第一个（或任意尚无会话的）项目：自动建真实会话，输入框出现。
4. 本机无 Git：可关闭的提示；有 Git 或探测失败：无提示。
