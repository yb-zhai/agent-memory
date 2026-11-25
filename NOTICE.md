# 许可与第三方声明 / NOTICE

本项目（Nebula Memory / 记忆星云，包名 `dsh-nebula-memory`）以 **MIT** 许可发布。
分发本程序或其修改版时，请保留 [LICENSE](LICENSE) 与本文件。

---

## 许可摘要

| 部分 | 许可 | 说明 |
|---|---|---|
| **全部源代码**（`server.js`、`lib/`、`memory/`、`panel.html`、`index.js` 等） | **MIT** | 见 [LICENSE](LICENSE)。可自由使用、修改、分发、商用 |
| **文档与图片**（`docs/` 下除下列声明外的全部、`assets/icon.*`） | **MIT** | 随项目一同授权 |
| **Hindsight**（可选的双引擎后端） | **MIT**（上游） | 独立项目，**不随本仓库分发**，见第 1 节 |
| **模型权重**（embedding / reranker） | 各自上游许可 | 由 Hindsight 自行下载，**本仓库不分发**，见第 1 节 |

### 一句话总结

**本项目零运行时依赖**（`package.json` 的 `dependencies` 为空），
所以「本项目 + MIT」这个组合是完整的 —— 没有从别处继承来的代码需要单独声明。

唯一的例外是**可选的** Hindsight 后端：它由使用者自己安装，许可归上游。

---

## 二次创作与分发须知

修改、再分发或商用本项目时，你需要做到：

1. **保留 `LICENSE`** —— MIT 要求在所有副本或实质部分中保留版权声明
   （`Copyright (c) 2026 yb-zhai`）与许可声明。
2. **保留本文件 `NOTICE.md`** —— 它说明了 Hindsight 与本项目的关系，
   删掉后容易让下游误以为 Hindsight 也是本项目的一部分。
3. **署名作者与出处** —— 公开渠道发布二次创作时，请注明本项目仓库地址与作者 yb-zhai。
4. **不要改得更严** —— 基于 MIT 代码的再分发，许可不得比 MIT 更严格。
5. **不要声称本项目的作者背书** —— 二创是独立的，MIT 不授予商标或署名混淆的权利。

---

## 1. 可选后端：Hindsight

本项目可以对接 [Hindsight](https://github.com/vectorize-io/hindsight) 做语义增强
（README 中称为「引擎 B」或「双引擎叠加层」）。

- **许可**：MIT（遵循其上游声明）
- **是否随本仓库分发**：**否**。本项目只通过 HTTP API 对接，代码里没有包含它的任何部分
- **谁安装**：使用者自己按 README 的指引安装（`pip install hindsight-all` 或 Docker）
- **模型权重**：Hindsight 首次启动会自动下载 embedding / reranker 模型
  （如 `intfloat/multilingual-e5-small`、`hindsight-ai/hs-rerank-1`），
  **本仓库不包含、也不分发这些权重**，其许可与使用条款归各模型上游

> 不安装 Hindsight 时，本项目的全部功能（本地四臂召回 + 面板）正常工作，不受影响。

## 2. 开发依赖（不进入产物）

以下仅用于开发和发布流程，不会出现在最终产物中：

- **release-it** — MIT
- **@release-it/conventional-changelog** — MIT

## 3. 素材来源

`docs/` 与 `assets/` 下的全部图片、动图、视频均由本项目自行制作：

| 素材 | 生成方式 |
|---|---|
| `docs/architecture-overview.png` | 由 `docs/architecture-source.html` 渲染 |
| `docs/demo.gif` | 录制本项目自身的面板界面 |
| `docs/tutorial-install.mp4`、`docs/tutorial-thumb.png`、`docs/cover-douyin.png` | 本项目自行制作 |
| `docs/hindsight-cost.png` | 本项目整理上游公开定价信息后绘制 |
| `docs/*.png`（其余图表） | 本项目实测数据绘制 |
| `assets/icon.*` | 本项目自绘 |

均随项目以 MIT 授权，不含任何第三方素材。

> 其中 `docs/hindsight-cost.png` 里的价格数据来自各家官方定价页（抓取日期标注在图内），
> **数据本身不属于任何一方**，仅供参考；价格随时间变化，以官网为准。

---

## 联系

如对以上署名或许可有疑问，请开 issue 或联系项目维护者。
