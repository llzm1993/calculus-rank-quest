# 将微积分晋级发布到 GitHub Pages

账号版使用 **GitHub Pages 托管网页 + Supabase Auth 注册登录 + Supabase PostgreSQL 保存进度**。学生注册并验证邮箱后登录；云端按账号保存段位、关卡、星星、经验和答题存档，换设备登录可以继续。教师账号可以查看学生的昵称、段位、通关数量和最近学习时间。

本目录已备好部署文件。只有配置了你的真实 GitHub 仓库、Supabase 项目并成功运行工作流后，网站才算上线；本地文件和示例配置并不代表服务已经部署。

## llzm1993 的部署计划

使用你的 GitHub 账号 [llzm1993](https://github.com/llzm1993)，建议将本游戏单独放在 `llzm1993/calculus-quest` 仓库，默认分支为 `main`。预期上线地址为 `https://llzm1993.github.io/calculus-quest/`；Supabase 的 Site URL 和 Redirect URLs 也需要填写这个完整地址。

**当前状态：尚未创建该仓库，尚未部署上线，也尚未连接真实 Supabase 服务。** 以上是待执行的计划地址。准备好 GitHub 登录授权与 Supabase 项目后，按下方步骤完成数据库、邮件发送、公开变量和 Pages 工作流配置。

如果通过发布源码 ZIP 导入，请将压缩包里的文件直接放到仓库根目录，并确认 `.github/workflows/pages.yml` 和 `.gitignore` 一并保留。压缩包不含本地 `config.js`、离线生成页面、学生存档或依赖目录；安装依赖和生成正式配置由工作流完成。

## 1. 准备自己的 GitHub 仓库

新建一个专门的仓库，例如 `calculus-quest`，默认分支设为 `main`。把本目录中的项目源文件放在**仓库根目录**，包含隐藏的 `.github/workflows/pages.yml`，不要再套一层“微积分晋级”目录。已有仓库请先合并并保留原有文件。

使用 GitHub Free 时，GitHub Pages 通常需要公开仓库。将仓库设为公开前，确认里面只有准备公开的游戏源码和题目，不含学生资料、数据库密码或服务端密钥。其他套餐的可用性以 [GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 为准。

在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。预期地址为：

```text
https://你的GitHub用户名.github.io/calculus-quest/
```

如果仓库名为 `用户名.github.io` 或使用自定义域名，后面的 Supabase 地址配置要改成网站实际地址。

## 2. 创建 Supabase 项目并安装数据库

在自己的 [Supabase Dashboard](https://supabase.com/dashboard) 新建项目。数据库密码保存在你自己的密码管理器中，不要放进网页或提交到 GitHub。

在项目 **SQL Editor** 中执行 `supabase/schema.sql` 全部内容。这个文件建立进度表、教师授权表、进度保存接口和行级权限（RLS）。不要在网页里执行 SQL。随后可在 SQL Editor 执行 `supabase/verify.sql`，检查数据库权限和跨账号隔离；查看脚本头部的说明后再运行。

在项目的 **Connect** 或 **Settings → API Keys** 找到以下两项：

| GitHub 变量名 | 要填写的值 |
| --- | --- |
| `SUPABASE_URL` | 项目 URL，例如 `https://项目编号.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | 以 `sb_publishable_` 开头的公开密钥 |

公开密钥用于浏览器，真正的数据权限来自登录身份和 RLS。构建也兼容旧版 `anon` JWT，但新项目优先使用 publishable key。**不要填 `sb_secret_`、`service_role`、数据库密码或用户 access token**；这些不是网页公开配置。[Supabase 密钥说明](https://supabase.com/docs/guides/getting-started/api-keys)

## 3. 配置邮箱注册和回跳地址

在 Supabase **Authentication → Sign In / Providers → Email** 启用邮箱注册，并开启邮箱确认。保持匿名登录关闭。学生使用邮箱和密码注册，点击收到的验证链接后登录游戏。

在 **Authentication → URL Configuration** 中设置：

- **Site URL**：网站实际根地址，例如 `https://你的GitHub用户名.github.io/calculus-quest/`。
- **Redirect URLs**：加入同一个完整地址，保留仓库路径 `/calculus-quest/` 和结尾 `/`。不要只填 `https://用户名.github.io/`。
- 本地调试时另外添加 `http://127.0.0.1:4188/`；如果使用其他端口，添加其准确地址。

邮箱验证和找回密码都依赖这项配置。每次改仓库名或绑定域名后，同时更新 Site URL 与 Redirect URLs。[回跳地址配置说明](https://supabase.com/docs/guides/auth/redirect-urls)

**正式给学生使用前必须配置自己的 SMTP。** Supabase 默认发信服务只适合测试，目前仅向项目团队成员的邮箱发信，默认限额也很低（文档当前为每小时 2 封，可能调整）。未配置 SMTP 时，普通学生可能无法收到验证或重置密码邮件。到 **Authentication → SMTP Settings** 配置自己的发信服务，并设置合适的 Auth 邮件速率限制；SMTP 密码只保存在 Supabase，不进入 GitHub。[官方 SMTP 配置说明](https://supabase.com/docs/guides/auth/auth-smtp)

## 4. 添加变量并发布

在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新增上面的两个 Repository variables。请用 **Variables**，因为现有工作流读取 `vars.SUPABASE_URL` 和 `vars.SUPABASE_PUBLISHABLE_KEY`。

将代码推送到 `main`，或打开 **Actions → Publish calculus game → Run workflow** 并选择 `main`。工作流会安装锁定依赖、运行测试、校验配置、构建并发布。没有配置或填了私密密钥时，构建失败，不会发布一个可跳过登录的游客版本。

部署成功后，**Settings → Pages** 显示正式链接。第一次上线请完成一次真实验收：

1. 注册一个测试学生账号，收到邮件并验证，登录后答完至少一关。
2. 刷新页面，再换另一个浏览器登录同一账号，核对进度恢复。
3. 退出登录，确认游戏入口需要登录；用第二个账号确认看不到第一个账号的存档。
4. 授予下文的教师权限，确认教师能看到测试学生的学习层次。
5. 测试找回密码邮件，确认链接回到正确的 GitHub Pages 仓库路径。

## 5. 给自己开通教师查看权限

先在游戏里注册你自己的教师账号并验证邮箱。在 Supabase **Authentication → Users** 找到**你本人邮箱对应的 User UID**。在 SQL Editor 执行：

```sql
insert into public.calculus_teachers (user_id)
values ('在这里替换为你本人账号的完整 UUID')
on conflict (user_id) do nothing;
```

必须由项目管理者在 SQL Editor 授予；不能通过网页表单、自填昵称或注册元数据成为教师。退出游戏重新登录后检查教师入口。不要误填学生的 UID。需要撤销时，在 SQL Editor 执行：

```sql
delete from public.calculus_teachers
where user_id = '要撤销权限的完整 UUID';
```

教师列表不公开学生邮箱。SQL 管理者仍拥有数据库管理权，应只将该权限授予需要管理教学数据的人。

## 本地运行与构建

使用 Node.js 22 LTS 或更新的受支持 LTS 版本；工作流固定 Node.js 22 系列。[Node.js 支持周期](https://nodejs.org/en/about/previous-releases)

```powershell
npm ci --ignore-scripts
npm test
Copy-Item config.example.js config.js
# 用编辑器在 config.js 填写你的项目 URL 和 publishable key
npm start
```

打开 `http://127.0.0.1:4188/`。`config.js` 被 Git 忽略，防止误提交本地配置。发布构建完全由环境变量生成配置，不会读取该文件：

```powershell
$env:SUPABASE_URL = 'https://你的项目编号.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = '你的 sb_publishable_ 公开密钥'
npm run build
```

`dist/` 只包含 `index.html`、`styles.css`、`curriculum.js`、`engine.js`、`app.js`、`accounts.js`、`cloud.js`、`cloud-sync.js`、生成的 `config.js` 和 `vendor/supabase.js`。工作流只上传这个目录，离线单文件、截图、SQL、测试、依赖目录和说明文档均不会进入 Pages 发布包。

浏览器客户端是 npm 官方包 `@supabase/supabase-js@2.118.0` 的 `dist/umd/supabase.js`，随网站本地加载，不依赖运行时 CDN；副本保留 MIT 许可，另存于 `vendor/LICENSE.supabase`。来源：[官方 npm 包](https://www.npmjs.com/package/@supabase/supabase-js/v/2.118.0)。依赖版本和完整性摘要记录在 `package-lock.json`。数据库权限测试使用开发依赖 `@electric-sql/pglite`，不发送到浏览器。

## 权限边界与常见问题

GitHub Pages 是静态托管，网页代码和题目可以下载；登录页面控制正常使用流程，Supabase 的身份验证和 RLS 保护每个学生的云端数据。即使有人修改自己的网页，也不能因此获得其他学生的数据或教师权限。课堂进度由浏览器提交，适合学习记录，不应当作防作弊考试成绩。如果需要题目保密或可信考试成绩，需要另行建立服务端判题系统。

- **“尚未配置账号服务”**：本地 `config.js` 没填好，或打开了未部署的源码。GitHub 部署请检查两个变量名和值，重新运行工作流。
- **注册失败或收不到邮件**：检查 SMTP、邮箱确认与 Auth 速率限制，查看 Supabase 的 Auth 日志。
- **验证链接进入 404 或错的网站**：检查 Site URL / Redirect URLs 是否包含准确的 `/仓库名/` 路径。
- **能登录但无法保存**：确认完整执行 `supabase/schema.sql`，再在 Dashboard 查看数据库错误；不要靠关闭 RLS 来处理。
- **没有教师入口**：确认授予的是当前登录账号的 UID，退出后重新登录。
- **网页仍显示旧内容**：检查最新 Actions 是否成功，再强制刷新浏览器。构建失败时线上会保留上一次成功的版本。
