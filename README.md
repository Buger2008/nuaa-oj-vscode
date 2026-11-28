# NUAA OJ for VS Code

在 VS Code 里直接登录、查找题目、编写代码、用样例自测、提交并查看评测结果，**全程不需要浏览器**，也不依赖 Competitive Companion / CPH 等浏览器插件。

> 适用于基于 [HOJ](https://gitee.com/nuaa-zkwang/nuaa-new-oj-system) 的南京航空航天大学 OJ：<https://oj.nuaa.edu.cn>

## 功能

- **侧边栏登录**：活动栏「NUAA OJ」提供账号密码登录；密码保存在系统密钥库（SecretStorage），JWT 过期自动续登。无网络或服务器不可达时会明确提示连接失败及原因，不会误报为“需要登录”。
- **浏览器式侧边栏**：顶部标签包括 **首页 / 自由练习 / 课内实验 / 测验 / 作业 / 状态 / 排名 / 我的**，可在设置中按需隐藏。
  - **自由练习**：题库搜索、难度标签、状态标记、通过率 tooltip。
  - **课内实验**：训练题单，可展开并搜索。
  - **测验**：比赛/测验列表、密码注册、题目、提交记录、排名、倒计时、简介、公告，见下文。
  - **状态**：正式提交与在线自测；支持只看我的、状态筛选、分页。
  - **排名**：ACM / OI 排名与图表。
  - **我的**：个人信息、个人主页、学习路径、能力画像、设置、系统通知。
- **打开题目即建文件**：输入题号（如 `E1`、`9999`、`CPP2-4`）或粘贴题目/训练/测验链接，自动创建以题号命名的代码文件（如 `E1.cpp`）并打开题面。
  - 题目文件夹只使用**题号**，不再带中文标题；普通题、训练题和测验题分别生成不会冲突的目录。
  - 若文件已存在则直接打开，不会覆盖已有代码。
- **英文路径与临时目录**：Windows 临时目录优先使用 `C:\Users\Public\nuaa-oj-temp`（全英文、存在且可写）；其他系统使用 `os.tmpdir()`；退出时自动清理。
- **题面 Markdown + LaTeX 渲染**：本地打包 markdown-it + KaTeX，无需联网 CDN；代码块、表格、列表、公式均可正常显示。
- **语言选择 + 题目级锁定**：
  - 默认按文件扩展名推断语言；默认新建语言为 **C**。
  - 题面面板顶部和侧边栏「当前题目 → 语言」均可切换，只列出该题允许的语言。
  - 单语言题自动锁定，提交按钮会随语言状态更新。
- **本地样例测试**：本地编译并逐样例比较输出（AC / WA / TLE / RE / CE）。支持 C / C++ / Java / Python / Go / JavaScript / Rust / PHP / Ruby；按所选语言套用对应标准（C++14、C++17、C++20，With O2 额外 `-O2`）。
- **云端样例测试与自定义测试**：调用 OJ 的 `submit-problem-test-judge`，适合本地没有编译器或需要验证服务器环境；支持自定义输入，文件 IO 题按题目输入文件规则处理。
- **提交与轮询**：按当前文件语言提交，实时显示 Pending → Judging → Compiling → Accepted 等状态，并显示时间、内存、得分及每个测试点结果。提交/测试前自动保存当前文件。
- **提交记录与详情**：我的提交 / 全部提交 / 我的自测；点击 RUNID 查看提交详情、每个测试点耗时/内存/得分；本人提交可复制代码或覆盖到源文件。
- **测验 / 比赛（完整支持）**：
  - 侧边栏「测验」列出公开赛、私有赛和保护赛。
  - 私有/保护赛需要密码时，直接在 VS Code 内输入密码并调用 `/api/register-contest` 注册，成功后自动进入。
  - 支持比赛题目列表、打开题面、云端测试、比赛提交；提交走比赛专用接口，不再跳到浏览器。
  - 比赛详情包含 **简介 / 题目 / 提交 / 排名 / 公告** 五个视图；支持比赛进度条、倒计时、全部用户提交记录、ACM/OI 排名和公告分页查看。
- **AI 助手**：题面「🤖 AI 助手」按题目提问；通用 AI 助手不带题号；支持历史会话、流式打字机输出、Markdown 渲染，并对齐网页的切换题目/确认语言等交互。
- **按当前文件自动同步题目**：切换或关闭代码文件时，题面面板自动跟随；不是题目代码文件时会关闭题面面板。
- **设置**：资料设置（头像、昵称、学校、学号、博客、GitHub 等）与账号设置（修改密码、验证码改邮箱）；错误提示使用置顶浮层，避免被遮挡。
- **跨平台**：Windows / macOS / Linux；临时文件使用系统临时目录 + `mkdtemp`，POSIX 超时按进程组清理；clang 的 `bits/stdc++.h` shim 只在 Windows/macOS 注入，避免遮蔽 Linux libstdc++。

## 安装（本地打包）

```bash
cd nuaa-oj-vscode
npm install
npm run compile
npx vsce package --no-dependencies --allow-missing-repository
code --install-extension nuaa-oj-1.10.39.vsix
```

也可以用 F5 调试：用 VS Code 打开本文件夹，按 `F5` 启动扩展开发宿主窗口。

## 使用步骤

1. 用 VS Code 打开一个工作文件夹（题目文件会创建在其中的 `NUAA-OJ/` 下）。
2. 点活动栏「NUAA OJ」中的登录按钮，输入学号和密码。
3. `Ctrl+Shift+P` → **NUAA OJ: 打开题目**，输入题号或粘贴链接。
4. 在自动生成并打开的代码文件里写代码。
5. 题面面板点「用样例测试」做本地自测，或按 `Ctrl+Alt+S` / **NUAA OJ: 提交当前代码** 提交到云端。
6. 打开「测验」标签，选择比赛并输入密码即可在扩展内做题、提交、查看排名和公告。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `NUAA OJ: 登录 / 切换账号` | 打开登录表单 |
| `NUAA OJ: 退出登录` | 清除本地令牌与凭据 |
| `NUAA OJ: 打开题目（输入题目编号或链接）` | 支持普通题、训练题、测验题链接 |
| `NUAA OJ: 从剪贴板链接打开题目` | 直接打开剪贴板中的 OJ 链接 |
| `NUAA OJ: 浏览训练题单` | 选择题单 → 选题目 |
| `NUAA OJ: 选择提交语言` | 仅列出该题允许语言；单语言题自动锁定 |
| `NUAA OJ: 用样例测试当前代码` | 本地编译 + 样例对比 |
| `NUAA OJ: 提交当前代码` | 云端评测并轮询结果 |
| `NUAA OJ: 重新显示当前题目描述` | 重新打开/刷新题面 |
| `NUAA OJ: 打开 AI 助手` | 按当前题目打开 AI 助手 |
| `NUAA OJ: 调试当前题目代码` | 启动本地调试 |
| `NUAA OJ: 载入最近通过的代码并覆盖当前文件` | 拉取最近 AC 代码 |

## 配置项（`设置 → NUAA OJ`）

- `nuaaOj.baseUrl`：OJ 站点地址，默认 `https://oj.nuaa.edu.cn`。
- `nuaaOj.defaultLanguage`：新建文件默认语言，默认 **C**（受题目允许语言约束）。
- `nuaaOj.problemFolder`：题目文件保存目录，默认 `NUAA-OJ`。
- `nuaaOj.compiler.c` / `nuaaOj.compiler.cpp`：**留空则自动探测**（cl → gcc/g++ → clang/clang++；找不到回退 clang/clang++）。
- `nuaaOj.compiler.*Args`：编译参数。
- `nuaaOj.compiler.java` / `javaRun` / `python` / `javascript` / `go` / `rust`：其它语言工具链。
- `nuaaOj.pollIntervalMs` / `nuaaOj.pollTimeoutMs`：评测轮询间隔与超时。
- `nuaaOj.submit.confirm`：提交前是否二次确认。
- `nuaaOj.test.timeLimitExtraMs`：本地测试在题限基础上额外放宽的时间。
- `nuaaOj.tabs.*`：控制侧边栏各标签是否显示，包括 `nuaaOj.tabs.contests`。

> 本地测试依赖系统已安装对应编译器/解释器。C/C++ 会自动探测；找不到时可继续使用云端测试/提交。

## API（本项目逆向并实测自 HOJ 后端）

| 功能 | 接口 |
| --- | --- |
| 登录 | `POST /api/login` `{username,password}` → JWT 在响应头 `Authorization` |
| 题目详情 | `GET /api/get-problem-detail?problemId=E1` |
| 训练题目详情 | `GET /api/get-training-problem-details?displayId=...&tid=...` |
| 训练题单列表 | `GET /api/get-training-list` / `GET /api/get-training-problem-list?tid=` |
| 比赛列表 | `GET /api/get-contest-list` |
| 比赛信息 / 访问权限 | `GET /api/get-contest-info?cid=` / `GET /api/get-contest-access?cid=` |
| 注册比赛 | `POST /api/register-contest` `{cid,password}` |
| 比赛题目 | `GET /api/get-contest-problem?cid=` / `GET /api/get-contest-problem-details?cid=&displayId=` |
| 比赛提交 | `GET /api/contest-submissions?...contestID=` |
| 比赛排名 | `POST /api/get-contest-rank` |
| 比赛公告 | `GET /api/get-contest-announcement?cid=` |
| 作业（学习地图） | `GET /recommendation-api/learning-map/<用户名>` |
| 语言列表 | `GET /api/languages?all=false` |
| 提交 | `POST /api/submit-problem-judge` |
| 提交详情/轮询 | `GET /api/get-submission-detail?submitId=` |
| 测试点结果 | `GET /api/get-all-case-result?submitId=` |
| 提交列表 | `GET /api/get-submission-list?onlyMine=true` |

请求头需带 `Url-Type: general`；登录后把 `Authorization` 响应头里的 JWT 原样放入后续请求的 `Authorization` 头。

## 目录结构

```text
nuaa-oj-vscode/
├─ package.json          扩展清单（命令、视图、配置）
├─ src/
│  ├─ extension.ts       入口：注册命令、状态栏、树视图
│  ├─ api.ts             纯 HTTP 客户端（无 vscode 依赖，可独立测试）
│  ├─ auth.ts            登录与凭据/令牌管理
│  ├─ homeView.ts        侧边栏主 Webview（各标签页、测验详情）
│  ├─ problemPanel.ts    题面面板控制器
│  ├─ statement.ts       题面 Webview 渲染
│  ├─ service.ts         业务编排：打开题目/测试/提交/记录/测验
│  ├─ context.ts         题目上下文、文件命名、语言解析
│  ├─ runner.ts          本地编译与运行样例
│  └─ ...                其它面板与工具模块
└─ resources/            图标与前端依赖
```

## 说明

- 独立、可打包的扩展，参考 cph-ng 的「题目 + 测试点 + 面板」思路，但针对 HOJ HTTP API 重新实现，不依赖浏览器插件。
- **比赛（contest）题目已直接支持**：私有/保护赛在扩展内输入密码注册，比赛提交、排名、公告、倒计时均可使用，不再提示用浏览器打开。
- 本扩展仅用于辅助个人学习，请遵守学校 OJ 的使用规定。
