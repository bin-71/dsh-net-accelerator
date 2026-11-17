# dsh-net-accelerator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/bin-71/dsh-net-accelerator)](https://github.com/bin-71/dsh-net-accelerator/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/bin-71/dsh-net-accelerator)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）用的 Host 插件：在访问 GitHub 等外网站点前，自动检查并开启 **Watt Toolkit（Steam++）** 的系统加速。

装上之后，你的 agent 会多一个 `net_accelerate` 工具，下载前先调一次：加速没开就自己拉起 Watt Toolkit 并等待生效；拉不起来就如实告诉你「需要点一下开关」。

---

## 为什么需要它

国内网络直连 GitHub 基本不通。Watt Toolkit 的加速方式是：

1. 改写 `C:\Windows\System32\drivers\etc\hosts`，把加速域名指向 `127.0.0.1`；
2. 由 `Steam++.Accelerator.exe` 在本地 `80` / `443` 端口做反向代理。

所以「加速有没有生效」并不是一个开关状态能读出来的，而是四个条件同时成立。人工每次去确认很麻烦，这个插件把判断和启动都自动化了。

## 判断依据

`net_accelerate` 会并行采集四个信号，并额外确认 TLS 对端证书：

| 信号 | 检查方式 | 含义 |
| --- | --- | --- |
| `hostsBlock` | 读取 hosts，找 `# Steam++ Start` 标记块 | 加速规则已写入 |
| `acceleratorProcess` | `tasklist` 查 `Steam++.Accelerator.exe` | 加速器进程在跑 |
| `localProxy` | 连接 `127.0.0.1:443` | 本地反代在监听 |
| `githubReachable` | 真实 HTTPS 请求测试地址 | 链路真的通了 |
| `viaSteamToolsCert` | 读取对端证书签发者是否含 `SteamTools` | 确认流量确实过了 Watt Toolkit |

四项全部成立时 `accelerated` 为 `true`。

> **关于证书**：Watt Toolkit 对加速域名做的是 MITM，用的是它自己的根证书（`SteamTools Certificate`，已装入 Windows 证书库）。Node 自带 CA 列表不认这张证书，所以探测时放行了证书校验 —— 该请求**只用于判断连通性，不读取任何响应内容**。

## 安装

**前置条件**

- Windows（插件依赖 hosts 机制与 `tasklist`）
- DSH Desktop 0.2.x
- 已安装 [Watt Toolkit](https://steampp.net/)

**方式一：下载发布包（推荐，不需要 git）**

1. 打开 [Releases](https://github.com/bin-71/dsh-net-accelerator/releases) 页面，下载最新的 `dsh-net-accelerator-v*.zip`
2. 解压，得到一个 `dsh-net-accelerator` 文件夹，放到一个**稳定的位置**（不要放临时目录或桌面回收站附近）
3. 打开 DSH → **Plugins**（插件）→ **Add plugin** → 选择该文件夹
4. 插件列表出现「Watt Toolkit 加速开关」即安装成功

**方式二：从源码目录安装**

1. `git clone https://github.com/bin-71/dsh-net-accelerator.git`，例如克隆到 `E:\plugins\dsh-net-accelerator`
2. 打开 DSH → **Plugins**（插件）→ **Add plugin** → 选择该目录

**方式三：通过 agent**

让 agent 调用 `plugin_manager`：

```
install_bundle  target=<插件目录绝对路径>
```

> 安装是**目录链接**方式，之后不要删除或移动该目录，否则插件会失效。升级时用新版本解压覆盖同一目录，然后在 Plugins 里禁用再启用即可。

## 配置

插件行支持以下配置项（都有默认值，通常不用改）：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `steamExe` | 自动探测 | `Steam++.exe` 路径；留空则先查注册表卸载项，再尝试常见安装目录 |
| `hostsPath` | `C:\Windows\System32\drivers\etc\hosts` | hosts 文件位置 |
| `proxyPort` | `443` | 本地反代端口 |
| `waitMs` | `25000` | `ensure` 等待加速生效的最长时间（毫秒） |
| `testUrl` | `https://github.com/` | 连通性测试地址 |

自动探测顺序：**配置值 → 注册表登记的安装位置 → 常见默认目录**。之所以注册表优先，是因为机器上可能同时存在旧版残留目录，直接按目录名猜会启动错副本。

## 使用

让 agent 在下载前调用即可，也可以自己指定：

```
net_accelerate { "action": "status" }   # 只读查询
net_accelerate { "action": "ensure" }   # 没开就开启并等待
```

返回示例（已加速状态，节选）：

```json
{
  "action": "ensure",
  "accelerated": true,
  "hostsBlock": true,
  "acceleratorProcess": true,
  "localProxy": true,
  "githubReachable": true,
  "githubMs": 158,
  "peerCertIssuer": "SteamTools Certificate",
  "viaSteamToolsCert": true,
  "needsUserAction": false,
  "steamExe": "E:\\Steam++\\Steam++.exe"
}
```

各字段含义：

| 字段 | 说明 |
| --- | --- |
| `accelerated` | 综合结论 |
| `hostsBlock` / `hostsGithub` | hosts 标记块是否存在、github 是否被指向 127.0.0.1 |
| `acceleratorProcess` / `localProxy` | 进程与端口状态 |
| `githubReachable` / `githubMs` / `githubStatus` | 探测结果与耗时 |
| `peerCertCN` / `peerCertIssuer` | 对端证书主题与签发者 |
| `viaSteamToolsCert` | 是否确为 Watt Toolkit 的证书 |
| `startedApp` | 本次调用是否启动了 Watt Toolkit |
| `needsUserAction` / `hint` | 需要用户手动操作时的提示 |

## 已知限制

- **启动程序 ≠ 开启加速**。Watt Toolkit 的加速开关在它自己的界面里，命令行启动后不保证自动恢复。插件会在 `waitMs` 内轮询，失败时返回 `needsUserAction: true` 和一句提示，而不会假装成功。
- **探测放行证书校验**（原因见上），仅用于连通性判断；插件不读取、不回传任何响应正文。
- **只支持 Windows**，且假设 Watt Toolkit 使用 hosts + 本地反代这一机制（v3.x 的常规模式）。
- **依赖运行时动态加载 DSH 内部模块**：profile 安装的插件无法通过正常模块解析找到 `@deepseek-ai/dsh-tools`，因此插件在加载时按 `DSH_INSTALL_DIR` → `process.resourcesPath`（`app.asar` / `app.asar.unpacked`）的顺序定位该包。DSH 大版本升级若改变目录结构，可能需要同步调整。
- **仅在作者本机验证过**（Windows 11 + DSH 0.2.2-rc.3 + Watt Toolkit 3.1.2025.0）。其它组合遇到问题欢迎提 issue。

## 目录结构

```
dsh-net-accelerator/
├── index.js            # 插件入口：net_accelerate 工具实现
├── cordis.patch.yml    # bundle 补丁，插入插件行
├── package.json        # 声明 dsh.bundle.patch 与导出
├── icon.svg            # 插件图标
├── locale/             # 中英文显示名与描述
│   ├── en.json
│   └── zh.json
└── docs/
    └── DETAIL.md       # 插件详情页文档
```

## English

A DSH (DeepSeek Harness) Host plugin that exposes one tool, `net_accelerate`. Before downloads from GitHub it verifies four independent signals — the `# Steam++ Start` hosts block, the `Steam++.Accelerator.exe` process, the local reverse proxy port, and a real HTTPS probe — and confirms the peer certificate was issued by Watt Toolkit. `action: "ensure"` launches Watt Toolkit when acceleration is off and polls until it takes effect; when it cannot, it returns `needsUserAction` instead of claiming success.

Windows only. Requires DSH Desktop 0.2.x and [Watt Toolkit](https://steampp.net/).

## 更新日志

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT — 见 [LICENSE](LICENSE)。
