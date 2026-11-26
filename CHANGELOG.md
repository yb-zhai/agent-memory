# Changelog

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。
版本变更由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导，按以下三类呈现对使用者有影响的变更：

- **Added** — 向下兼容的新功能（升 Minor）
- **Fixed** — 向下兼容的缺陷修复（升 Patch）
- **Changed / Breaking Changes** — 行为变化或不兼容的接口变更（升 Major）

Docs / Chore / Test / Build / CI 类提交也会列出，便于追溯改动来源。


## [2.0.3](https://github.com/yb-zhai/agent-memory/compare/v2.0.2...v2.0.3) (2026-11-26)

### Fixed

* worker 状态灯补「已关」态，不再把关闭中的 worker 显示成待机 ([19711a0](https://github.com/yb-zhai/agent-memory/commit/19711a0cd50e0aeb4a5089f3406bf41e841957f9))

### Docs

* 版本表里的 DSH 插件版本更新到 2.0.2 ([671ba4b](https://github.com/yb-zhai/agent-memory/commit/671ba4b3b5ea7b69a1aa5cdd567263edcd290aaf))
* 补 tag 固定版本的安装写法（已实测） ([8201e26](https://github.com/yb-zhai/agent-memory/commit/8201e26d9e5cdca0f62deab67f037df1cca671b2)), references [yb-zhai/agent-memory#v2](https://github.com/yb-zhai/agent-memory/issues/v2)
* 区分「插件市场」与「发现」两个入口，修正搜不到的表述 ([f3bee38](https://github.com/yb-zhai/agent-memory/commit/f3bee385b6e7d4783bda0bf667a166048caa291e))
* **contributing:** 发版必须同步 README 版本表 ([4422c80](https://github.com/yb-zhai/agent-memory/commit/4422c80d6c3d32edd803cdfcbc8c9a524c1eed4f))

### Chore

* **release:** 发版前检查 README 版本表是否与 package.json 一致 ([da9c522](https://github.com/yb-zhai/agent-memory/commit/da9c5222d830586dd46d46a24a6e31077b60e270))

## [2.0.2](https://github.com/yb-zhai/agent-memory/compare/v2.0.1...v2.0.2) (2026-11-25)

### Fixed

* worker 调度入口按部署能力显示，不再对用户误呈现 ([1b9c3fe](https://github.com/yb-zhai/agent-memory/commit/1b9c3fe2da06ceede950f9aa11a8555553cec670))

## [2.0.1](https://github.com/yb-zhai/agent-memory/compare/v2.0.0...v2.0.1) (2026-11-25)

### Fixed

* 面板检测改为只读，不再把 key 落盘 ([d1e1259](https://github.com/yb-zhai/agent-memory/commit/d1e1259f6c73dad5b5f1a3a75cd1e7911a3dfba0))

### Changed

* 许可回到标准 MIT，署名要求改为 README 约定 ([e380dbd](https://github.com/yb-zhai/agent-memory/commit/e380dbd80f95c56cb446a9d50e9ee2facdcf61b0))

### Docs

* 补 NOTICE.md，package.json 补 license/author，README 扩充许可章节 ([9cb7b14](https://github.com/yb-zhai/agent-memory/commit/9cb7b145bca214e70d6816e3b32d60c894dbc5a9))
* 澄清插件对 Hindsight 是只读的，不产生 retain 费用 ([90c669c](https://github.com/yb-zhai/agent-memory/commit/90c669c4313be7618d249c204f2d8d096225298b))
* 二创要求写明确 —— 署名 + 仓库链接 + 注明修改 ([d43196c](https://github.com/yb-zhai/agent-memory/commit/d43196ccba02538e8d414626ff23b11b8814bb76))
* 更新顶部面板动画到 v2.0.0 实测画面 ([78df649](https://github.com/yb-zhai/agent-memory/commit/78df649b879cb771abecb807a40297e658a0e827))
* 加入 66 秒安装教程视频 ([68b363b](https://github.com/yb-zhai/agent-memory/commit/68b363b1595706ef898b5c4ef2cad1eefa9c1c38))
* 视频入口改用播放器样式缩略图 ([180be17](https://github.com/yb-zhai/agent-memory/commit/180be170856f8952e51345424cd530b74a858506))
* 新增 AGENTS.md，让新会话自动带上项目约定 ([c9f9685](https://github.com/yb-zhai/agent-memory/commit/c9f96852b34eafa37a605ba1612d3737be7de45b))
* 许可改为 MIT + 附加署名条款（自定义许可） ([ab1a4be](https://github.com/yb-zhai/agent-memory/commit/ab1a4be53b14e1145015be687b37b8f3b7512b38))
* 许可章节改成 dsh-pet 的项目符号格式 ([6aefb7f](https://github.com/yb-zhai/agent-memory/commit/6aefb7fff233ae7e58bcf944bc9a681627d780c4))
* 在 README 与 CONTRIBUTING 补充钩子安装提示 ([9972b86](https://github.com/yb-zhai/agent-memory/commit/9972b86ef6ecfd40f262d319fa493e447d84bb03))
* 自检条目补上附注 tag 要用 ^{commit} 解引用 ([924a651](https://github.com/yb-zhai/agent-memory/commit/924a65122fe1afecd4c36b22c5cc7fee13158d4b))
* **chart:** 成本图补上价格免责声明 ([b0e7f24](https://github.com/yb-zhai/agent-memory/commit/b0e7f24dc7d8305a3f590dfdb78f83748fdd3a16))
* **contributing:** 补 autocrlf 行尾自检条目 ([f375ffe](https://github.com/yb-zhai/agent-memory/commit/f375ffe2c341b7b96831e5184e98ba393a593e7b))
* **install:** 注释里写明不能只拷文件夹安装 ([d128034](https://github.com/yb-zhai/agent-memory/commit/d128034eeff3b519a9730f6889414660f271ce6d))
* README 加两行许可摘要，照常见开源项目格式 ([048fcc7](https://github.com/yb-zhai/agent-memory/commit/048fcc7f7c57b57c1d174f49b41a939e0fd30db4))
* **readme:** 「上面三步装完」改为「整体安装完」 ([20befee](https://github.com/yb-zhai/agent-memory/commit/20befeef70046f3c379a3a418c261d651019deb2))
* **readme:** 安装命令改成 dsh plugin add github:... ([6ab8888](https://github.com/yb-zhai/agent-memory/commit/6ab888884256c64689268cd51000a99cd6e0c468))
* **readme:** 版本说明扩到四条，集成包补全内容说明 ([91c23db](https://github.com/yb-zhai/agent-memory/commit/91c23dbc6ba654c78282caad8bc23dc7520deee5))
* **readme:** 版本说明前置到开头，并区分两个维度 ([e7d4c22](https://github.com/yb-zhai/agent-memory/commit/e7d4c22ca808af378f7bfec402770f79f3442843))
* **readme:** 补上 install.ps1 这条带面板的装法 ([fbeab81](https://github.com/yb-zhai/agent-memory/commit/fbeab81c5a6dc03cc16ff57ecf971654f23470f4))
* **readme:** 集成包章节加小播放器标签 ([e60658b](https://github.com/yb-zhai/agent-memory/commit/e60658bc77af5fbb8af428c7df45119090e4f7b5))
* **readme:** 教程视频链接移到「DSH 集成包」章节 ([7a4117b](https://github.com/yb-zhai/agent-memory/commit/7a4117bff9c828350aa2fa1a0b76f2e3c642a838))
* **readme:** 修正接入方式表的错误与误导 ([f342181](https://github.com/yb-zhai/agent-memory/commit/f342181a349e40b7e6d81b5db63b9f1fb8502315))
* **readme:** Quick Start 前置，集成包补写两部分说明 ([fb0898e](https://github.com/yb-zhai/agent-memory/commit/fb0898e046767f51a5a3c10f7a53212cb723e9f0))

### Test

* 新增编码自检脚本，CONTRIBUTING 补 *.ps1 必须带 BOM ([7e4b38c](https://github.com/yb-zhai/agent-memory/commit/7e4b38c553ea5d7be4be16c24de3a7694612891b))

### CI

* 编码检查接入 pre-commit / CI / 发版前 ([7185023](https://github.com/yb-zhai/agent-memory/commit/71850231be598d7dc4cc0c1a09aff9097e654c40))

# Changelog

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。
版本变更由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导，按以下三类呈现对使用者有影响的变更：

- **Added** — 向下兼容的新功能（升 Minor）
- **Fixed** — 向下兼容的缺陷修复（升 Patch）
- **Changed / Breaking Changes** — 行为变化或不兼容的接口变更（升 Major）

Docs / Chore / Test / Build / CI 类提交也会列出，便于追溯改动来源。


## [2.0.0](https://github.com/yb-zhai/agent-memory/compare/v1.5.0...v2.0.0) (2026-11-25)

### ⚠ BREAKING CHANGES

* 包标识改名为 dsh-nebula-memory（避开市场重名）

### Added

* 包标识改名为 dsh-nebula-memory（避开市场重名） ([7ce5416](https://github.com/yb-zhai/agent-memory/commit/7ce5416375f4efd38e0b1a8bf123f20ec3e61809))
* 面板显示 RRF 融合过程，并区分全库量与单次召回量 ([ee4d014](https://github.com/yb-zhai/agent-memory/commit/ee4d014ee1d8d7aa126ba562db19b5f6aae8de56))
* 面板增加「检测 Hindsight」三步向导按钮 ([6126a13](https://github.com/yb-zhai/agent-memory/commit/6126a13bb78965f5b6e8c24d15bbc2e124cf374b))
* 增加 /hindsight-probe 三步探测端点 ([6551348](https://github.com/yb-zhai/agent-memory/commit/65513482474e6d63b7df49586da15ce1e352ed11))
* 增加 check:hindsight 相关的 npm 脚本 ([58f897e](https://github.com/yb-zhai/agent-memory/commit/58f897eaa998cd48b2833058ccf2abece130771c))
* 增加 Hindsight 上游 API 兼容性检查脚本 ([e9102ed](https://github.com/yb-zhai/agent-memory/commit/e9102ed517a2d80d0c4b68a32c8655d3a78060c1))

### Fixed

* 环境变量为空时回退读取配置文件的 hindsightDir ([a8fff9f](https://github.com/yb-zhai/agent-memory/commit/a8fff9f448a3c834f5b60bd5a46936bc11608767))
* **server:** 星图取样改为「时间等距 + 补邻居」，修复上一版只剩近期记忆且断连 ([cc87e6b](https://github.com/yb-zhai/agent-memory/commit/cc87e6b62bdfbdf0218530b63c0298e43b6bf057))
* **server:** 召回种子文本恒为空，面板拿不到种子正文 ([8904a72](https://github.com/yb-zhai/agent-memory/commit/8904a72964c2981fa870d5606f0a0d09fa389a14))
* **server:** graphNodes 配置项从未生效，星图节点无上限导致面板卡死 ([5c7b9c5](https://github.com/yb-zhai/agent-memory/commit/5c7b9c5cd209921626b05956e4db608e90068220))
* **stats:** 双引擎下召回统计口径修正，补本地计数并消除重复计数 ([3bb0c43](https://github.com/yb-zhai/agent-memory/commit/3bb0c431747d4566e9008024f7dc318e3feaf665))

### Changed

* 压缩 demo.gif 从 1320KB 到 761KB（-42%） ([d43ffa7](https://github.com/yb-zhai/agent-memory/commit/d43ffa7c4cbab402cfc54203e93c3097cd5787c0))

### Docs

* 按双引擎定位重写 README，新增 DSH 集成包章节 ([b7e268b](https://github.com/yb-zhai/agent-memory/commit/b7e268b64533ad743aa85f38c5ed5b14581bbde4))
* 补充 check:hindsight 兼容性检查的用法说明 ([b5286d9](https://github.com/yb-zhai/agent-memory/commit/b5286d9c08fa98e597b4736a2bd9f103093d6a5e))
* 补降级行为说明，并修正配套资源归属与体积表述 ([8a647fc](https://github.com/yb-zhai/agent-memory/commit/8a647fc5a6925fd5b6c99daa0465f09be8235320))
* 对比表的体积行改为定性描述，去掉不准的 ~160 KB ([a44b53c](https://github.com/yb-zhai/agent-memory/commit/a44b53c88ca7915ca9077b2285542777869853dd))
* 改为双引擎平级架构的措辞，并说清「未开源」指本机配套资源 ([3090723](https://github.com/yb-zhai/agent-memory/commit/309072303d8fa037b4ec02cb1ec846833660dce4))
* 回退体积表改动并重写体积段 ([243b424](https://github.com/yb-zhai/agent-memory/commit/243b4241e906389d4a5e2721161d999c80e894e0))
* 删掉体积段里关于自研代码量的表述 ([b3b7731](https://github.com/yb-zhai/agent-memory/commit/b3b7731d04574c63c68ce1d46639a49bfb369e75))
* 体积表按性质分项并补合计，修正 reranker 归属 ([7360ada](https://github.com/yb-zhai/agent-memory/commit/7360adacb6ff5bdf31dbb82b5ada9fc02f153c7b))
* 体积表改为默认配置口径，避免误导成默认就要 3.7 GB ([7cdffca](https://github.com/yb-zhai/agent-memory/commit/7cdffca6d867ea8386097a1fb8b8b442f2f965fe))
* 修复 2 处失效的文档内锚点 ([6da91cd](https://github.com/yb-zhai/agent-memory/commit/6da91cd7ff40d9bc4d8727e4b8cba59a27ebb516))
* 修正 Hindsight 章节，说明它是第三方开源项目并给出自助安装指引 ([4a01783](https://github.com/yb-zhai/agent-memory/commit/4a017834e07caad2aca6434834b45af62ef90efa))
* 修正 Hindsight 章节措辞，明确「未开源」指未打包而非闭源 ([b1ee9c9](https://github.com/yb-zhai/agent-memory/commit/b1ee9c997fa4d19978602cbc6e0eb8347266e0f7))
* 修正「Hindsight 后续跟进」的说法，避免误以为语义增强不可用 ([2f375ee](https://github.com/yb-zhai/agent-memory/commit/2f375eed1cfc33d4a3aa4ae1858f39c61a7c53a8))
* 在 CONTRACT 上方注明与业务代码的对应位置 ([054664b](https://github.com/yb-zhai/agent-memory/commit/054664b5b7aa5127150cd6b12fc3c51ab4b5a6b3))

### Chore

* 把本机 bank 名与模型名换成通用占位符 ([227e623](https://github.com/yb-zhai/agent-memory/commit/227e623ead0bf0c7e317d161b038037436ee9a7a))
* 发布包排除基准测试的结果数据文件 ([7d3e9e3](https://github.com/yb-zhai/agent-memory/commit/7d3e9e3ddfdebc4874a03a00afb6ff6922355512))
* 更新宣传图（去掉包名文字），精简市场截图清单 ([eeaf28c](https://github.com/yb-zhai/agent-memory/commit/eeaf28c9498588bd8111b175484c47312d9472cb))
* 加入市场截图声明与宣传图 ([2e965ab](https://github.com/yb-zhai/agent-memory/commit/2e965ab415a1af8e584498c5a6c0d6181873ddd6))
* 生成 PNG 图标，为插件市场上架做准备 ([a882733](https://github.com/yb-zhai/agent-memory/commit/a882733256b43062101402b0eadf480c1d75ca24))

### CI

* 在 PR 上验证 Hindsight 兼容性检查器自身的可靠性 ([40ee021](https://github.com/yb-zhai/agent-memory/commit/40ee02104ca27c12d2d16e5636ca304efe0d6f11))

## [1.5.0](https://github.com/yb-zhai/agent-memory/compare/v1.4.1...v1.5.0) (2026-11-24)

### Added

* **release:** 发版前检查提交前缀，拦截「开关当新功能」的误用 ([7e3cd67](https://github.com/yb-zhai/agent-memory/commit/7e3cd674df25dbf12ff6fbae042cf0362e92a51a))

### Docs

* 补充规则 —— 仓库内部工具类改动用 chore: 前缀，不升 Minor ([74f7eed](https://github.com/yb-zhai/agent-memory/commit/74f7eedd3a98bba504666569f185a8fc2fafc49e))
* CONTRIBUTING 补充例外规则 —— 给已有功能加开关算 Patch ([ae541cf](https://github.com/yb-zhai/agent-memory/commit/ae541cf104b2e8e1323a0b05debbcb213e293f6c))

## [1.4.1](https://github.com/yb-zhai/agent-memory/compare/v1.4.0...v1.4.1) (2026-11-24)

### Added

* **memory:** 内容清洗增加开关，用户可自行关闭 ([9a32558](https://github.com/yb-zhai/agent-memory/commit/9a32558164f3c3a2a6a231a196996f271f22501d))

### Fixed

* **memory:** 写入入口增加内容清洗，防止思考过程与工具原始输出污染记忆库 ([955d3dc](https://github.com/yb-zhai/agent-memory/commit/955d3dced3a4a351bdbfed8bec22f45e77e310fa))

## [1.4.0](https://github.com/yb-zhai/agent-memory/compare/v1.3.13...v1.4.0) (2026-11-24)

### Added

* **release:** 引入 SemVer 2.0.0 规范与自动化发版工具链 ([c9e7c93](https://github.com/yb-zhai/agent-memory/commit/c9e7c9342c8c1b83450ca28f3c51775f7bb1d279))

# Changelog

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。
版本变更由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导：

- **Added** — 向下兼容的新功能（升 Minor）
- **Fixed** — 向下兼容的缺陷修复（升 Patch）
- **Breaking Changes** — 不兼容的接口变更（升 Major）

> 从 1.3.14 起，以下条目由 `npm run release` 自动生成，不再手工维护。
> 1.3.13 及更早版本为回溯整理。

## [1.3.13] - 2026-11-24

### Added

- **install:** 安装器自更新 —— 在动任何文件之前检查脚本自身是否落后于仓库，`-SelfUpdate` 可自动拉取并用新版重新执行；工作区脏、分叉、非 git 目录或连不上远程时一律跳过，绝不覆盖用户改动。

### Fixed

- 旧版用户无法用上新校验的问题：`install.ps1` 此前不会自更新，停在旧版的用户无论下载多新的包都跑旧安装器。

> **注意**：自更新逻辑需要脚本本身更新过一次才生效。1.3.12 及更早的用户请先手动 `git pull` 一次。

## [1.3.12] - 2026-11-24

### Added

- **install:** 升级前校验包内版本号自洽，版本不一致时在**修改任何文件之前**中止安装，并给出可操作的处理办法。

### Fixed

- **memory:** 启动时清理残留的原子写临时文件（`index.json.tmp-<pid>-<hex>`）。只删属于本进程或所属进程已退出的，多实例并存时保留其他进程正在写的文件。
- 引擎层告警此前被静默丢弃：`lib/engine.mjs` 构造本地引擎时未注入日志函数，导致 `_log()` 全部空操作。现已接上。

## [1.3.11] - 2026-11-24

### Fixed

- **memory:** 画像摘要重复写入 —— `refreshSummary` 在内容未变时仍无条件 `_rewriteNode`，而服务每 1.5 秒 tick 一次，**运行一天可累积数万行**。现改为内容未变即跳过，并给摘要刷新加 5 分钟节流。该缺陷自首版起即存在。

## [1.3.10] - 2026-11-23

### Added

- **memory:** 查询扩展三路补偿 + 召回效果实测报告与评测工具链。
- **memory:** 错别字词表修正，支持 `user-dict.json` 外置词表。

### Fixed

- **server:** 端口冲突时不再递增换端口，杜绝多实例并存。
- 长文本分块 + 超级节点度数上限。

## [1.3.9] - 2026-11-23

### Fixed

- 长文本分块 + 超级节点度数上限。

## [1.3.8] - 2026-11-21

首个公开版本：零依赖本地 JSONL 记忆引擎（四臂召回）+ 可视化面板 + 可选 Hindsight 语义增强。
