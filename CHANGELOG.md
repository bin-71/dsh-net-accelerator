# Changelog

本项目的版本变更记录，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-17

首个可用版本。

### 新增

- `net_accelerate` 工具，两种动作：
  - `status`：只读检查加速状态，四路信号并行采集（hosts 标记块、加速器进程、本地反代端口、真实 HTTPS 探测），并读取对端证书确认流量确实经过 Watt Toolkit。
  - `ensure`：在加速未开启时拉起 Watt Toolkit，并在 `waitMs` 内轮询等待生效。
- `Steam++.exe` 自动定位：配置值优先，其次读取卸载注册表项推导安装目录，最后回退到常见安装路径。优先注册表是为了避开机器上可能残留的旧安装目录。
- 插件显示信息：中英文标题与描述、内置图标、插件详情页文档。

### 已知限制

- 启动 Watt Toolkit 不等于开启加速，后者仍需在程序界面点击；插件在无法自动完成时返回 `needsUserAction` 而不是报告成功。
- 连通性探测会放行 TLS 证书校验（Watt Toolkit 以自有根证书做中间人），该请求不读取任何响应正文。
- 仅支持 Windows，且假设 Watt Toolkit 使用 hosts + 本地反代模式。
- 依赖运行时从 DSH 安装目录动态加载 `@deepseek-ai/dsh-tools`，DSH 大版本升级可能需同步调整路径。

[1.0.0]: https://github.com/bin-71/dsh-net-accelerator/releases/tag/v1.0.0
