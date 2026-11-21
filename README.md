# Nebula Memory

> **零依赖 · 纯本地 · 可视化的 Agent 记忆系统。装完即用，不花钱，不上云。**

一个自包含的记忆引擎：**本地 JSONL 四臂召回**（词法 / 激活 / 图扩散 / 画像）+ **可交互的记忆星云可视化面板**，可选叠加 **Hindsight HTTP API** 做语义增强。核心引擎永远可独立运行——**不联网、不烧钱、不依赖任何数据库或 LLM**。

[![license](https://img.shields.io/badge/license-MIT-green)](#license)
[![zero-dependency](https://img.shields.io/badge/dependencies-0-blue)](#)

<!-- 这里放一张记忆星云面板的截图或 GIF（见下方「截图」小节） -->
<!-- ![Nebula Memory 面板](docs/screenshot.gif) -->

---

## 为什么是它

市面上的 Agent 记忆框架（[Mem0](https://github.com/mem0ai/mem0)、[Zep](https://github.com/getzep/zep)、腾讯 [TencentDB Agent Memory](https://github.com/Tencent/TencentDB-Agent-Memory) 等）普遍**很重**——要 Postgres / MongoDB / 向量库、要云端 LLM、要部署脚本、每次对话都在烧钱、数据要上云。

**Nebula Memory 走相反的路线**：

| | 重型框架（Mem0/Zep/腾讯） | Nebula Memory |
|---|---|---|
| 依赖 | 数据库 + 向量库 + LLM | **零依赖（纯 Node.js）** |
| 部署 | 多步、要配置 | **一条命令 / 一个 import** |
| 成本 | 每次对话烧钱 | **零成本（纯本地）** |
| 隐私 | 数据上云 | **数据不出本机** |
| 体积 | 几十 MB 起步 | **~160 KB** |
| 可视化 | 通常没有 | **记忆星云面板（3D 星图 + 召回轨迹）** |

一句话：**重型框架是「企业记忆中台」，Nebula Memory 是「个人开发者的零依赖记忆」**。

---

## 特性

- 🔌 **零依赖**：纯 Node.js + JSONL 文件，没有 npm 依赖、没有数据库、没有向量库
- 🏠 **本地优先**：记忆存在你自己的机器上，不联网、不上云、不泄露
- 🧠 **四臂召回**：词法（TF-IDF）· 激活（FSRS 遗忘曲线）· 图扩散（2 跳）· 画像，本地就能做语义相关的记忆检索
- 🎨 **可视化面板**：记忆星云 3D 星图、数据链、召回轨迹、SSE 实时刷新
- ⚡ **快**：冷启动 ~2.9s，召回延迟压到本地保底
- 🧩 **可叠加增强**：可选接 Hindsight HTTP API 做 LLM 语义检索（不装也完全能用）
- 📌 **置顶永固**：`importance=1.0` 的关键事实（API 密钥、称呼偏好）永不受时间衰减

---

## Quick Start（5 行跑通）

```bash
git clone https://github.com/yb-zhai/agent-memory.git
```

```javascript
import { NebulaMemory } from './agent-memory/memory/index.mjs'

const memory = new NebulaMemory({ dir: './my-memory' })
await memory.remember('老板喜欢喝冰美式')
await memory.remember('这个项目的 API 密钥是 sk-xxx', { importance: 1.0 })  // 置顶，永不遗忘
const context = await memory.recall('老板喝什么？')   // → 命中「冰美式」
```

> 完全不需要配置 Postgres、不需要 API Key、不需要联网。跑完上面这段，你的 Agent 就有了记忆。
>
> **引擎与模型无关**：`NebulaMemory` 是纯 Node.js 模块，任何 Agent（Claude / GPT / 文心 / 通义 / 自研模型）都能用——把它召回的记忆塞进 prompt 即可。

### 想用语义增强？

本地四臂已经能解决大部分记忆召回。如果你想要更强的语义检索，可以叠加 **Hindsight HTTP API**（可选），见 [Hindsight 叠加](#hindsight-叠加可选)。

---

## 截图

<!-- TODO: 放一张记忆星云面板的截图或 GIF，这是最打动人的部分 -->
<!-- 建议录制：输入一句话 → 面板上节点瞬间点亮 → 召回卡片出现 -->

---

## 安装 / 接入方式

Nebula Memory 有三种用法，按需选择：

### 1. 作为库（Node.js，任何模型可用）

```bash
git clone https://github.com/yb-zhai/agent-memory.git
```

```javascript
import { NebulaMemory } from './agent-memory/memory/index.mjs'
const memory = new NebulaMemory({ dir: './memory' })
await memory.init()
await memory.remember('...')
await memory.recall('...')
```

> 引擎是纯 Node.js、零依赖、与模型无关——把它召回的记忆塞进任意模型的 prompt 即可。

### 2. 作为独立 HTTP 服务

```bash
node server.js
```

启动后监听 `127.0.0.1:8898`，暴露 REST API（`/recall`、`/remember`、`/state`、`/graph` 等）和 SSE 实时推流。任何语言（Python / JS / 其他）都能用 `requests` / `fetch` 调用。

### 3. 作为 DSH 插件（可视化面板）

如果你用 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek)（DSH），可以把它作为插件安装，获得完整的「记忆星云」可视化面板。见 [安装到 DSH](#安装到-dsh)。

---

## API 一览

| 方法 | 作用 |
|---|---|
| `memory.remember(input)` | 写入一条记忆 |
| `memory.recall(query)` | 四臂召回 |
| `memory.observe(input)` | 观察一条（记录但不主动召回） |
| `memory.forget(id)` | 删除一条 |
| `memory.stats()` | 统计（节点/边数量） |
| `memory.consolidate()` | 巩固（相似片段合并、衰减） |

---

## 架构

```
┌──────────────────────────────────────────┐
│            Nebula Memory 引擎              │
│  （零依赖 JSONL · 四臂召回 · FSRS 动力学） │
├──────────────────────────────────────────┤
│  ├─ 本地四臂：词法 / 激活 / 图扩散 / 画像  │
│  └─ 可选叠加：Hindsight HTTP API（语义）   │
└──────────────────────────────────────────┘
```

核心引擎**永远可独立运行**；Hindsight 只是「可选的增强」，不是「必需的前置」。探测不到 Hindsight 就自动降级纯本地，不报错、不伪造数据。

---

## Hindsight 叠加（可选）

本地四臂是零依赖的兜底。如果你想要 LLM 语义检索增强，可以接一个 Hindsight HTTP API：

- 探测到 `127.0.0.1:8888` 的 Hindsight 且健康 → 自动叠加其语义召回；
- 没装 / 连不上 → 自动降级纯本地，功能不受影响；
- 每 30 秒重探测一次，运行时自动 `local` ↔ `hybrid` 切换。

> **Hindsight 不是必需的**。只想用本地记忆，跳过这一节即可。

---

## 安装到 DSH

（保留给 DSH 用户 —— 详细步骤见原文档，或 `install.ps1`）

```powershell
# 解压发行包后，在插件目录执行
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

安装器提供**事务式升级**：升级前备份记忆 + SHA-256 校验，失败自动回滚，不丢数据。

---

## 数据与隐私

- **本地 JSONL**：`nodes.jsonl` / `edges.jsonl` / `index.json` / `trace.jsonl`，全在你自己的机器上；
- **不上云、不联网**：纯本地模式零网络请求；
- **密钥加密**：API Key 用 Windows DPAPI 加密存储，绝不写入日志或明文导出；
- **不收集数据**：没有埋点、没有遥测。

详见 [SECURITY.md](SECURITY.md)。

---

## 许可

[MIT License](LICENSE) © 2026 yb-zhai

---

## 致谢

- 记忆引擎内核源自 [NebulaMemory](https://github.com/deepseek-ai/DeepSeek)（DSH 挂件侧），经重构独立为通用记忆引擎。
