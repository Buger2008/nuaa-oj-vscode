# NUAA OJ for VS Code

在 VS Code 里直接登录、查找题目、编写代码、用样例自测、提交并查看评测结果 —— **全程不需要浏览器**，也不依赖 Competitive Companion / CPH 等浏览器插件。

> 适用于基于 [HOJ](https://gitee.com/nuaa-zkwang/nuaa-new-oj-system) 的南京航空航天大学 OJ：<https://oj.nuaa.edu.cn>

## 功能

- **侧边栏登录**：活动栏「NUAA OJ」每个面板标题栏都有登录按钮，点开是传统账号密码表单；密码保存在系统密钥库（SecretStorage），JWT 过期自动续登。
- **侧边栏（浏览器式标签）**：活动栏「NUAA OJ」是一个带**顶部标签**的面板：**自由练习**（对应 /problem 题库，含搜索、难度标签、AC✓，鼠标悬停显示难度与各状态通过率）、**课内实验**（对应 /training 训练题单，可展开、含搜索）、**作业**（learning-map 章节/作业/练习）、**状态**（提交记录，可按状态筛选、可只看我的，支持页码分页与每页条数）、**我的**（个人信息；未登录时显示醒目的蓝色登录按钮）。以后新增入口只是加一个标签，不会拥挤。
- **打开题目即建文件**：输入题号（如 `E1`、`9999`、`CPP2-4`）或粘贴题目/训练题链接，自动在 `NUAA-OJ/<题号 标题>/` 下新建以**题目编号**命名的代码文件（如 `E1.cpp`）并打开，同时弹出题面面板。
  - **代码模板**：如果题目自带代码模板（`codeTemplate`），或用代码块内嵌了「待改错程序」（如 [HQ-4-9](https://oj.nuaa.edu.cn/problem/HQ-4-9)），会把那段代码放进新文件；否则新建**空文件**（不再自动塞入骨架代码）。
  - **续写不覆盖**：如果该文件已存在，则**直接打开它**（比如写一半关掉后再打开继续写），绝不会覆盖旧代码。
- **未打开文件夹也能用**：如果当前没有打开任何文件夹，会在系统临时目录新建一个随机 UUID 的临时工作区来放题目文件，**退出 VS Code 时自动清理**。
- **题面 Markdown + LaTeX 渲染**：题目描述/输入/输出/提示里的 Markdown（加粗、列表、代码块、表格等）和 LaTeX 公式（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`）会用**本地打包的 markdown-it + KaTeX** 在题面面板中渲染，无需联网 CDN；对富文本编辑器把公式/文字包进 `<span>` 的情况会先解包，保证公式与加粗/斜体正确渲染。
- **语言选择 + 题目级锁定**：
  - 默认按**文件扩展名**推断语言；
  - **在题面面板顶部和侧边栏「当前题目 → 语言」都能切换语言**（只列出该题允许的语言）；切换语言会**像打开题目一样新建对应语言的代码文件**；
  - **若题目只允许一种语言（例如只允许 C），会自动锁定为该语言**，无法切换到其它语言，新建文件也会用对应扩展名。
- **本地样例测试**：根据题面自带样例，在本地编译并运行你的程序，逐样例对比输出（AC / WA / TLE / RE / CE）。支持 C / C++ / Java / Python / Go / JavaScript / Rust / PHP / Ruby；本地会按**所选语言**套用与云端相同的标准（C++=c++14、C++ 17=c++17、C++ 20=c++20，With O2 额外加 -O2）。
- **云端样例测试**：题面面板另有「☁ 云端样例测试」按钮，用 OJ 服务器的在线调试（`submit-problem-test-judge`）运行当前代码并返回结果，适合本地没装编译器或想验证服务器环境。受站点限流影响每例约需 5 秒（自动等待/重试），输入超 1000 字符的样例会跳过；面板下方还有「云端自定义测试」输入框，可自己输入数据在云端运行（无需期望输出）；无样例题允许空白输入测试。**文件 IO 题**：有样例时会把样例内容写入输入文件进行本地/云端测试（与浏览器在线调试同理）；无样例（如二进制题）点“测试”将直接按**提交评测**处理。
- **C/C++ 编译器自动探测**：留空时依次尝试 `cl`（MSVC）、`gcc`/`g++`、`clang`/`clang++`，都找不到时回退 `clang`/`clang++`。会用「实际编译一个小程序」的方式验证编译器可用性，避免选到不能用的编译器。
  - 使用 clang 时会自动补一个 `bits/stdc++.h` 头文件垫片（shim），因此 `#include <bits/stdc++.h>` 的代码在 clang（libc++）下也能本地编译。
- **提交并轮询结果**：按**当前文件**的语言提交，实时显示 Pending → Judging → Accepted 等状态，最终给出时间、内存、得分，以及每题测试点详情。
  - **测试 / 提交前会自动保存**当前代码（VS Code 通常不会自动保存），保证评测的就是屏幕上最新的代码。
- **载入最近通过代码**：题面面板提交按钮旁的「⤓ 最近AC代码」可拉取你**最近一次 AC 的代码**并覆盖当前文件；覆盖前会弹窗确认，若从未通过会提示“还没有通过过”；**若最近通过的代码语言与当前文件不同，会自动切换/新建对应语言的文件再写入**。`n- **设置（资料 + 账号）**：侧边栏「我的」→「⚙ 设置」打开面板：**资料设置**（头像/真实姓名/昵称/学校/学号/Codeforces/博客/GitHub/性别/签名，`/api/change-userInfo`）、**账号设置**（改密码 `/api/change-password`；改邮箱：`/api/get-change-email-code` 发邮件验证码 + `/api/change-email` 提交）。邮箱验证：服务端生成 6 位码存 Redis 10 分钟、经 JavaMail 模板发到新邮箱；扩展侧加 60s 冷却与限流。改密码成功会弹窗提示并退出登录、打开登录页；成功/错误提示改为置顶浮层，避免被遮挡。`n- **能力画像**：侧边栏「我的」里点「📊 能力画像」，展示**知识能力/六维能力雷达图**、知识点掌握列表，以及两段 **AI 生成**的「知识点重要性」「学习方法建议」（流式，`recommendation-api/student_profile` + `advice/*/stream`）。`n- **AI 助手（NUAA 专属）**：题面面板「🤖 AI 助手」按钮（或命令 `NUAA OJ: 打开 AI 助手`）打开**原生聊天面板**，接入 `recommendation-api/student/{uid}/assistant/*`，自动带上当前题号与最近提交，**流式打字机输出 + Markdown 渲染**（代码块/加粗/列表），支持**历史会话**查看/续聊。`n- **提交记录标签页**：题面面板有「我的提交 / 全部提交 / 我的自测」按钮，点击在**新标签页**打开记录表格：我的/全部为服务端真实提交（点行可在浏览器打开提交详情）；我的自测为本次会话在本扩展运行过的测试概览（OJ 本身不保存在线自测历史）；**点击 RUNID 打开提交详情**（突出显示运行时间，便于性能对比），本人提交可查看并复制代码；详情还列出**每个测试点的时间/内存/得分**（如 Test #1 AC 1ms/300KB 10pts）；本人提交的详情里「复制代码」旁还有「覆盖到源文件」，可把该提交代码写入对应语言源文件（覆盖前确认，语言不同会自动切换文件）。`n- **按当前文件自动同步题目与语言**：切换编辑器里的文件时，会按文件名识别它属于哪道题、是什么语言——若是某题的代码文件，右侧题面自动切到该题并显示该语言；若该语言在本题被禁止，会弹提示并**把提交按钮置灰**；若打开的不是题目代码文件、或该题目文件被**关闭/删除**，则**自动关闭右侧题面面板**（不再依赖重新点击文件才更新）。
- **文件 IO 题友好**：有样例的文件题支持本地/云端样例测试（自动把样例内容写入输入文件）；无样例（如二进制）时提示直接提交评测。
- **状态栏**：右下角显示当前登录用户，点击即可打开登录面板切换账号。

## 安装（本地打包）

```bash
cd nuaa-oj-vscode
npm install
npm run compile
npx vsce package --no-dependencies --allow-missing-repository
code --install-extension nuaa-oj-1.7.1.vsix
```

也可以用 F5 调试：用 VS Code 打开本文件夹，按 `F5` 启动扩展开发宿主窗口。

## 使用步骤

1. 用 VS Code 打开一个工作文件夹（题目文件会创建在其中的 `NUAA-OJ/` 下）。
2. 点活动栏「NUAA OJ」面板标题栏的**登录**按钮，输入学号和密码。
3. `Ctrl+Shift+P` → **NUAA OJ: 打开题目**，输入 `E1` 或粘贴链接。
4. 在自动生成并打开的 `E1.cpp`（或对应语言文件）里写代码。
5. 题面面板点 **用样例测试** 做本地自测，或按 `Ctrl+Alt+S` / **NUAA OJ: 提交当前代码** 提交到云端。
6. 结果会实时显示在题面面板；侧边栏「当前题目」可随时**切换语言**（受题目允许语言限制），「我的提交」可查看历史。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `NUAA OJ: 登录 / 切换账号` | 打开侧边栏登录表单 |
| `NUAA OJ: 退出登录` | 清除本地令牌与凭据 |
| `NUAA OJ: 打开题目（输入题目编号或链接）` | 支持普通题与训练题 |
| `NUAA OJ: 从剪贴板链接打开题目` | 复制 OJ 链接后直接打开 |
| `NUAA OJ: 搜索题目` | 关键词搜索题目列表 |
| `NUAA OJ: 浏览训练题单` | 选择题单 → 选题目 |
| `NUAA OJ: 选择提交语言` | 仅列出该题允许的语言；单语言题自动锁定 |
| `NUAA OJ: 用样例测试当前代码` | 本地编译 + 样例对比 |
| `NUAA OJ: 提交当前代码` | 云端评测并轮询结果 |
| `NUAA OJ: 重新显示当前题目描述` | 重新打开/刷新题面面板 |

## 配置项（`设置 → NUAA OJ`）

- `nuaaOj.baseUrl`：OJ 站点地址，默认 `https://oj.nuaa.edu.cn`。
- `nuaaOj.defaultLanguage`：新建文件默认语言，默认 `C++`（会受题目允许语言约束）。
- `nuaaOj.problemFolder`：题目文件保存目录，默认 `NUAA-OJ`。
- `nuaaOj.compiler.c` / `nuaaOj.compiler.cpp`：**留空则自动探测**（cl → gcc/g++ → clang/clang++，找不到回退 clang/clang++）。也可显式指定路径。
- `nuaaOj.compiler.*Args`：编译参数（默认 `-O2 -std=c11 -lm` / `-O2 -std=c++17`）。
- `nuaaOj.compiler.java` / `javaRun` / `python` / `javascript` / `go` / `rust`：其它语言工具链。
- `nuaaOj.pollIntervalMs` / `nuaaOj.pollTimeoutMs`：评测轮询间隔与超时。
- `nuaaOj.submit.confirm`：提交前是否二次确认。
- `nuaaOj.test.timeLimitExtraMs`：本地测试在题限基础上额外放宽的时间。

> 本地测试依赖系统已安装对应编译器/解释器。C/C++ 会自动探测，无需手动配置；找不到时会给出提示，此时仍可直接提交到云端评测。

## API（本项目逆向并实测自 HOJ 后端）

| 功能 | 接口 |
| --- | --- |
| 登录 | `POST /api/login` `{username,password}` → JWT 在响应头 `Authorization` |
| 题目详情 | `GET /api/get-problem-detail?problemId=E1`（含 `data.languages`：该题允许语言） |
| 训练题目详情 | `GET /api/get-training-problem-details?displayId=9999&tid=8` |
| 训练题单列表 | `GET /api/get-training-list` / `GET /api/get-training-problem-list?tid=` |
| 作业（学习地图） | `GET /recommendation-api/learning-map/<用户名>`（含 `stages`、`knowledge_problems.homework`、`student_progress`） |
| 语言列表 | `GET /api/languages?all=false` |
| 提交 | `POST /api/submit-problem-judge` `{pid,language,code,cid:0,isRemote:false}` |
| 提交详情/轮询 | `GET /api/get-submission-detail?submitId=` |
| 测试点结果 | `GET /api/get-all-case-result?submitId=` |
| 提交列表 | `GET /api/get-submission-list?onlyMine=true` |

请求头需带 `Url-Type: general`；登录后把 `Authorization` 响应头里的 JWT 原样放入后续请求的 `Authorization` 头。

## 目录结构

```
nuaa-oj-vscode/
├─ package.json          扩展清单（命令、视图、配置）
├─ src/
│  ├─ extension.ts       入口：注册命令、状态栏、树视图
│  ├─ api.ts             纯 HTTP 客户端（无 vscode 依赖，可独立测试）
│  ├─ auth.ts            登录与凭据/令牌管理（SecretStorage）
│  ├─ loginPanel.ts      侧边栏登录表单（webview）
│  ├─ types.ts           HOJ 数据类型
│  ├─ status.ts          评测状态码映射
│  ├─ context.ts         题目上下文、文件命名、语言解析、临时工作区、本地元数据
│  ├─ codeExtract.ts     从题面（Markdown 代码块 / <pre>）提取「待改错代码」
│  ├─ toolchain.ts       C/C++ 编译器自动探测（cl/gcc/g++/clang/clang++）
│  ├─ samples.ts         题面 examples 解析
│  ├─ runner.ts          本地编译 & 运行样例（含 bits/stdc++.h 垫片）
│  ├─ statement.ts       题面 webview 渲染
│  ├─ problemPanel.ts    题面面板控制器
│  ├─ service.ts         编排：打开题目 / 语言 / 测试 / 提交轮询
│  └─ tree.ts            当前题目 / 作业 / 题目 / 训练题单 / 提交记录树视图
└─ resources/            图标
```

## 说明

- 独立、可打包的扩展，参考了 cph-ng 的「题目 + 测试点 + 面板」思路，但针对 HOJ 的 HTTP API 重新实现，不依赖浏览器插件。
- 比赛（contest）题目暂未直接支持（需要先注册比赛、且比赛提交规则不同），会提示在浏览器打开。
- 本扩展仅用于辅助个人学习，请遵守学校 OJ 的使用规定。



























































