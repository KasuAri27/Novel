# AGENTS.md — Novel 项目工程约束

> 给 AI 编码助手看的。作者**不需要 AI 写剧情**，只需要 AI 做工程。
> 作者也要能看懂这份文档和 AI 写出的代码，所以：**保持简单，少抽象，关键处写中文注释。**

## 0. 一句话版本

作者用 md 写剧情 → 脚本自动编译成 `story.json` → 引擎按规则推进 → 播放器显示成游戏。
**新增章节只改 `story/` 目录，不改代码。**

---

## 1. 硬性约束（必须遵守）

1. **不得修改 `story/` 下任何 md 的正文文字。** 发现错别字或矛盾，只报告，不要改。
2. **剧情、设定层面的问题只报告，不擅自决定。** 见第 11 节。
3. **纯静态网站**：没有后端；运行时不调用任何 AI 接口；仓库里不放 API Key。
4. **不提交原作素材**（图片、音频、原文）。素材只通过 `assets.yaml` 引用，素材目录加入 `.gitignore`。
5. **条件表达式禁止使用 `eval` / `new Function`。** 必须先编译成 JSON 语法树，再由引擎解释执行。
6. **引擎（`src/engine/`）必须是纯 TypeScript**，不能出现 `document`、`window`、React 等，这样才能单元测试。
7. **依赖尽量少**：只用 `unified/remark`（解析 md）、`yaml`、`zod`（校验）、`vitest`（测试）。要加新依赖，先说明理由。
8. **每次只做一个里程碑**（第 10 节）。做完必须通过 `npm run story:check` 和 `npm test`，再汇报。
9. **代码要简单**：函数短、命名直白、不做过度设计。

---

## 2. 数据流

```
story/*.md   +   story/*.logic.yaml   +   story/vars.yaml
          │
          │  npm run story:build   （scripts/build-story.ts）
          ▼
public/story/story.json   （按章拆分，播放时按需加载）
          │
          ▼
src/engine/   纯逻辑：step(state, input) → { state, events }
          │
          │  events（说话、选项、换背景……）
          ▼
src/player/   界面：文字、选项、背景、立绘
```

**引擎和播放器必须分开。** 以后想换渲染方式（Phaser、Godot 等），只重写播放器，引擎和数据不动。

---

## 3. 目录结构

```
story/
  Chapter.md              总纲（只读，供参考）
  setting/                世界观、机制、角色卡（只读）
  chapters/
    ch01.md  ch01.logic.yaml
    ch02.md  ch02.logic.yaml
    ...
  vars.yaml               全局变量表
  assets.yaml             素材清单（背景、立绘、音乐）
scripts/
  build-story.ts          md + yaml → story.json
  check-story.ts          校验（npm run story:check）
src/
  engine/                 纯逻辑，无 DOM
  player/                 界面
tests/
```

---

## 4. md 写作格式（解析器必须兼容**现有写法**）

> 完整写作规范见 **`docs/写作格式规范.md`**：新增章节照它写，即可被 `scripts/build-story.ts` 自动解析。

作者不想改写作习惯，所以解析器要认现有格式：

| 内容 | 现有写法 | 处理方式 |
|---|---|---|
| 章标题 | `# 第四章　…` | 章名 |
| 小节 | `## S1　标题`、`### S-D1　标题` | 一个节点 |
| 路线分段 | `## ❖ 平行分支二：〔…〕` | 路线标题，只用来分组 |
| 说话人 | `### 角色名`、`### 旁白` | 一段对白/旁白（`###` 后是小节编号时才是节点，见下） |
| 选择块 | `**【选择 E18｜标题】**` | 一个选择，编号 `E18` |
| 选择提示 | 紧随其后的斜体行 `*…你决定——*` | 选择的提示语 |
| 选项 | `*A　选项文字*`（A/B/C，A 后面是全角空格） | 选项 |
| 选项回响 | `**【分支走向展现（E18）】**`（旧写法 `### 分支走向展现（E18）`）下的 `**若选择 A（…）：**`（旧写法 `#### 若选择 A（…）：`） | 对应选项的回响文字 |
| 汇合 | `**【汇合收束】**` | 回响结束，回到主线 |
| 分隔线 | `---`、`***` | 忽略 |

**注意几个容易漏的情况：**

- 有些选择标题**没有加粗**（例如第三章 E15–E17 写成 `【选择 E15｜…】`），解析时加粗和不加粗都要认。
- **`###` 的两种含义**：后面接小节编号（`S1`、`S-D1`…）的是**节点**；否则是**说话人**（第一章全部对白都这样标注）。判定规则：`### X` 中 `X` 的第一个词形如 `S<编号>` 即节点。
- **所有以 `>` 开头的引用块一律当作开发注记，不进入播放文本。** 其中包含路由条件、加分说明，这些信息要迁移到 `logic.yaml`，迁移由作者确认。
- 现有数量，用来验收：**共 19 个选择（E01–E19），57 个选项**（第一章 6 个、第二章 6 个、第三章 5 个、第四章 2 个）。

**节点编号规则**：`ch{两位章号}_{小节编号}`，例如 `ch04_S-D1`。选择编号沿用 `E01`…（全局唯一）。

---

## 5. logic.yaml 与 vars.yaml

逻辑和正文分开放。每章一个 `chNN.logic.yaml`，用编号和 md 对上。

```yaml
# ch04.logic.yaml （示例，具体数值由作者填写）
choices:
  E18:
    A: { effects: [{ var: hiro.trust, add: 1 }] }
    B: { effects: [{ var: meruru.trust, add: 1 }] }
    C: { effects: [] }

routes:
  ch04_route:
    rules:                       # 按顺序判断，先匹配先生效
      - when: "hiro.explore >= 2 && meruru.explore >= 2 && reia.explore >= 2"
        goto: ch04_S-D1
      - when: "reia.explore < 2"
        goto: ch04_S-A1
    else: ch04_S-D1
```

```yaml
# vars.yaml （示例）
hiro.trust:   { min: 0, max: 5, init: 0 }
hiro.explore: { min: 0, max: 3, init: 0 }
```

**条件语法（只支持这些）**：变量名、数字、`>= <= > < == !=`、`&& || !`、括号。
变量名用英文小写加点号（`角色.指标`），具体角色代号由作者在 `vars.yaml` 里定，AI 不要自己发明。

---

## 6. story.json 的数据结构

```ts
type Story = { version: 1; start: string; vars: VarDefs; facts: FactDefs; nodes: Record<string, Node>; chapters: ChapterMeta[] }

type ChapterMeta = { n: number; title: string; file: string; nodes: string[] }

type Node = { id: string; chapter: number; title: string; blocks: Block[]; next: Next }

type Block = { type: 'text'; speaker?: string; text: string }   // 一段文字；speaker 是说话人（旁白为 '旁白'，旧写法缺省）

type Next =
  | { kind: 'goto'; to: string }                                   // 直接跳转
  | { kind: 'choice'; id: string; prompt: string; options: Option[] }
  | { kind: 'route'; rules: { when: Expr; to: string }[]; else: string }
  | { kind: 'ending'; id: string }

type Option = { key: string; text: string; echo: Block[]; effects: Effect[]; to?: string }

// 效果：单值变量加减/置值；二元关系档位增减；注入信息差（谁由此知道了什么）
type Effect =
  | { var: string; add?: number; set?: number }
  | { rel: [string, string]; add: number }
  | { know: string; fact: string }

type FactDefs = Record<string, { label?: string }>   // 事实声明；信息差不量化、不写进 vars.yaml，仅供剧情推进
type Expr = object   // 条件的 JSON 语法树，由编译脚本生成
```

> 编译现状（M6）：`npm run story:build` 由 `scripts/build-story.ts` 把 md + logic.yaml 编译成
> `public/story/story.json`（校验在 `scripts/check-story.ts`，`npm run story:check`）。
> 选项的 `effects` 来自 logic.yaml；路由（`route`）按 logic.yaml 的判定顺序执行，先匹配先生效。
> 汇合收束文字**并入每个选项 `echo` 的尾部**。M1–M6 均已完成；M7（立绘、背景、音乐等演出指令）未做。

---

## 7. 引擎规则

- 唯一入口：`step(state, input) → { state, events }`，**纯函数**，不修改传入的 state。
- 状态：`{ nodeId, cursor, vars, facts, rels, history }`。`history` 记录每次选择 `{ choiceId, key }`；
  `facts` / `rels` 承接选项的 know / rel 效果，不参与条件判断（表达式只认 vars）。
- 变量变化只发生在选项的 `effects`，并且要夹在 `vars.yaml` 规定的 min/max 之内。
- **存档就是把 state 序列化**：`{ v: 1, storyHash, nodeId, cursor, vars, facts, rels, history }`。
  剧情更新后 `storyHash` 对不上时，提示玩家，并尝试用 `history` 重放恢复。
- 回退上一个选择：用 `history` 去掉最后一项后重放。

**引擎发出的事件：**
`say(text)`、`showChoice(options)`、`showEcho(blocks)`、`setBackground(id)`、`showSprite(id, slot)`、`hideSprite(slot)`、`playBgm(id)`、`stopBgm()`、`chapterTitle(title)`、`ending(id)`。

---

## 8. 校验清单（`npm run story:check`）

发现问题要输出**清楚的中文提示**，带上文件和编号。

- 所有 id 唯一；所有 `goto / to` 指向的节点存在。
- 所有 `logic.yaml` 里用到的变量都在 `vars.yaml` 声明。
- md 里出现的选择编号，`logic.yaml` 必须有；反过来也一样（防止两边不同步）。
- 没有孤立节点，没有走不出去的死胡同。
- 每个结局至少有一条可达路径。
- **路由完备性**：变量取值范围有限，对取值组合穷举，要求每一种组合**恰好命中一条规则**（发现重叠或漏掉就报错）。
- **全路径模拟**：从起点出发，对 `(节点, 变量状态)` 做带记忆的搜索，确认每条路径都能走到结局、没有异常。
- 提示项（WARNING，不算失败）：某章字数和目标差距过大；某选项没有回响文字。

---

## 9. 播放器

**第一阶段：小说视窗模式（NVL）**，只做这些：

- 按段落逐段显示，点击或空格推进；打字机效果可以关闭。
- 选项出现在段落结尾；选完先播回响，再继续主线。
- 自动播放、已读快进。
- 存档读档（localStorage，3 个槽位加自动存档）、回退上一个选择。
- 手机和电脑都能用。

**以后再做（现在不要做）：**

- 说话人名字框、立绘（需要先给对白加说话人标记，可由 AI 离线标注、作者审核）。
- 背景、音乐，素材通过 `assets.yaml` 引用。
- 换渲染器。

---

## 10. 开发里程碑（每次只做一个）

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| M1 | 类型定义、`vars.yaml` 读取与校验、条件表达式解析与解释 | 单元测试通过 |
| M2 | 解析现有 4 章 md，输出 `story.json`（暂不含逻辑） | 19 个选择、57 个选项全部抽出；引用块全部剥离 |
| M3 | 合并 `logic.yaml`（选项效果、路由） | 样例章节能跑通 |
| M4 | `story:check` 全部校验与全路径模拟 | 故意改坏数据时能正确报错 |
| M5 | 引擎 `step`、存档、回退 | 单元测试覆盖选项、路由、存档读档 |
| M6 | 播放器（NVL） | 能从头玩到某个结局 |
| M7 | 演出指令、素材、说话人（以后） | 另行讨论 |

**每个里程碑做完，按这个格式汇报：** 改了哪些文件 / 怎么运行 / 还有什么没解决。

---

## 11. 待作者决定的事项（AI 不得擅自处理）

遇到下面这些，只在汇报或校验里提示，**不要自己改剧情或自己选方案**：

1. **变量命名**：前三章用"信任尺"，第四章用 `explore()`，需要统一，且每个选项具体加几分还没记录在文件里。
2. **第四章路由重叠**：三条案件路线可能同时满足，需要作者定优先级。
3. **与总纲冲突的两处**：
   - 路线四里奈叶香为复仇冷静开枪，与总纲"全部案件均由魔女化驱动"冲突；
   - 路线三"不开庭"，与总纲"有人死亡仍召开审判"冲突。
4. **篇幅**：各章字数与目标（2.0–2.5 万字符）差距较大。

在作者确认之前，涉及这些的地方用占位变量，并在代码里写 `TODO(作者)`。

---

## 12. 术语

- **节点**：一小段剧情（对应一个 `## S…` 小节）。
- **选择 / 选项**：玩家在某处的三选一（A/B/C）。
- **回响**：选了某个选项后立刻播放的一小段文字。
- **路由**：根据变量自动决定下一步去哪，玩家看不到。
- **sidecar**：与 md 配对的 `logic.yaml`，只放逻辑，不放正文。
- **story.json**：编译产物，播放器只读它。
