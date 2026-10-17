# 项目简介

- 一款互动式小说播放器。拥有多结局，剧情内容基于游戏《魔法少女的魔女裁判》

# 具体要求

- 剧情编写需要设定不同选项来导向不同结局，根据具体剧情设计小说播放器，暂不引入绘制图片，后续改进可考虑引入原作图片资源。

---

# 现状：md 剧情 + logic.yaml 逻辑 → 编译 → 引擎 → NVL 播放器

作者用 Markdown 按原有习惯写剧情（`story/chapters/chNN.md`），选项效果与路由写在与正文分离的
sidecar（`chNN.logic.yaml`）；编译脚本把它们合并成 `public/story/story.json`，
纯函数引擎按规则推进，播放器以小说视窗（NVL）方式显示。**新增章节只改 `story/`，不改代码。**

## 数据流

```
story/chapters/*.md + *.logic.yaml + story/vars.yaml
      │  npm run story:build    编译（scripts/build-story.ts）
      │  npm run story:check    校验（scripts/check-story.ts）
      ▼
public/story/story.json           播放器只读的编译产物
      │
      ▼
src/engine/   纯 TS 引擎：step(state, input) → { state, events }
      │
      ▼
src/player/   NVL 播放器（打字机 / 选项 / 回响 / 存读档 / 回退）
```

- 条件表达式不用 `eval`：编译成 JSON 语法树，由引擎解释执行。
- 纯静态网站：无后端，运行时不调用任何 AI 接口。

## 运行

```bash
npm install
npm run dev          # 开发预览（默认 http://localhost:5173）
npm run story:build  # 编译剧情：md + logic.yaml → public/story/story.json
npm run story:check  # 校验剧情：id 唯一 / 引用存在 / 路由完备性 / 全路径模拟
npm test             # 单元测试（表达式、变量、引擎、校验、内容冒烟）
npm run typecheck    # 类型检查
npm run build        # 生产构建到 dist/
```

## 目录

```
story/
  Chapter.md        总纲（只读）
  setting/          世界观、机制、角色卡（只读）
  chapters/         chNN.md（正文）+ chNN.logic.yaml（选项效果 / 路由 / 结局）
  vars.yaml         全局变量
  assets.yaml       素材清单（素材本体不入库）
scripts/
  build-story.ts    编译 + 校验入口
  check-story.ts    校验规则（纯函数，可单测）
src/
  engine/           纯逻辑引擎（无 DOM / React）
  player/           NVL 播放器界面
tests/              vitest
docs/               写作格式规范、大纲、第四章逻辑笔记
```

## 写作与接入新章节

1. 按 `docs/写作格式规范.md` 写 `story/chapters/chNN.md`；
2. 在同目录写 `chNN.logic.yaml`（选项效果、路由、结局）；新变量登记进 `story/vars.yaml`；
3. `npm run story:build` 编译，`npm run story:check` 校验通过后 `npm run dev` 游玩。

> 素材（背景、立绘、音乐）通过 `assets.yaml` 引用，本体目录 `assets/` 不入库（见 AGENTS.md）。
> 演出指令（立绘 / 背景 / 音乐）为后续里程碑（M7）。
