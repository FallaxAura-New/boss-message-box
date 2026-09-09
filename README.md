# 张导请回答

一个用于收集、整理和处理观众留言的 Web 应用。项目包含面向观众的提交与查询页面，以及供内部人员使用的 Studio 工作台。

## 开发环境

项目使用 Node.js、pnpm 和 Cloudflare Workers。建议使用仓库 `.nvmrc` 指定的 Node.js 版本。

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm run admin:password --username zd --local
pnpm dev
```

本地配置请从 `.dev.vars.example` 开始，并为需要的密钥填写仅用于开发的值。`.dev.vars` 和任何真实凭据都不应提交到 Git。

首次使用需为管理员设置密码；命令会在终端中隐藏输入。登录后可在 Studio 的「修改密码」中更换密码，更换后所有旧会话失效。

## 常用命令

```bash
pnpm dev                 # 启动本地开发服务器
pnpm run typecheck       # TypeScript 检查
pnpm run lint            # 代码规范检查
pnpm test                # 运行测试
pnpm run check           # 执行完整检查与生产构建
pnpm run check:visual    # 执行响应式界面检查
pnpm run db:migrate:local
pnpm run db:migrate:remote
pnpm run deploy
```

在应用远程数据库迁移前，请先备份数据并审阅尚未应用的迁移文件。生产环境变量和 Secrets 应通过 Cloudflare 配置，不要写入源码。

## 项目结构

```text
src/                  前端应用
worker/               Worker API 与服务端逻辑
migrations/           D1 数据库迁移
tests/unit/            单元测试
tests/worker/          Worker 与 D1 集成测试
scripts/               项目检查脚本
public/                静态资源
```

视觉与交互调整应遵循 `DESIGN_SYSTEM.md`。新增功能时请保持公开端与 Studio 的职责边界，并在提交前运行 `pnpm run check`。

## 部署

项目通过 Cloudflare Workers 运行，并使用 D1、R2、Images 等绑定。具体资源名称、绑定和非敏感运行变量以 `wrangler.jsonc` 为准；Secret 名称与本地开发占位项以 `.dev.vars.example` 为准。

部署前至少确认：

- 远程数据库已备份，待应用的迁移已经审阅；
- Cloudflare 资源与 `wrangler.jsonc` 中的绑定一致；
- 运行时 Secrets 已配置且未进入 Git；
- `pnpm run check` 完整通过。

随后按当前部署流程发布代码。管理员凭据、生产数据处理规则及其他内部运维信息不在 README 中维护。

`0005` 迁移保留现有账号和留言，但会禁用仍使用旧初始密码的账号。需要时使用 `pnpm run admin:password --username <账号> --remote` 设置新密码。已自行更换密码的账号不受此迁移影响。

### 留言导出与小店绑定手机号

- 用户提交页可选填“张导小店绑定手机号”，不限制国家或号码格式。普通 Studio 详情直接显示，直播模式不显示；旧留言显示“未填写”。
- 发布此版本前需要应用 `0006_feedback_shop_phone.sql`，新增可空列，不修改已有留言内容。数据库迁移与代码发布应配套执行；本地测试通过不代表已应用远程迁移。
- 普通 Studio 列表的“导出留言”支持当前分类与主题的所有页，或全部留言（含已过滤）；可选 Excel `.xlsx` 和 Markdown `.md`。
- Excel 将留言、全部回复、图片链接分别整理，手机号按文本保留 `+` 和前导零；MD 适合阅读与知识库整理。两种格式均包含小店手机号，图片仅为登录后可访问的链接，不包含图片文件。
- 导出固定最新记录的上界并分批读取；导出过程中被修改的状态和回复以各批读取时为准。失败不会下载不完整结果，可取消或重试。

短信入口由 `OTP_ENABLED` 控制，当前默认关闭。AI 筛选异步执行，失败时保留留言，并通过定时任务有限重试；Studio 也支持人工重试。`AI_THINKING` 仅用于支持该参数的提供方。服务端整次上传的资源保护上限为 32 MiB。
