# Agent 发布约定

- 每次构建新版本（修改 `package.json` 的 `version`）后，必须自动运行 `scripts/release-all.ps1` 完成构建、打包、提交、推送和三端 Release，不需要再次询问用户。
- 代码只推 GitHub `Buger2008/nuaa-oj-vscode`；Gitee / GitCode 是镜像，由发布脚本同步或检测。
- Release 名称使用纯版本号（例如 `1.10.23`），说明放进 Release body。
- 本地安装验证仍使用 `code --install-extension <vsix> --force`。
