# 盲板管理系统 - 开发工作日志

## 项目概述
石化厂盲板管理系统（盲板抽堵作业全流程管理）：作业需求 → 现场勘察 → JSA分析 → 隔离方案编制/审核 → 工艺处置方案编制/审核 → 工艺处置确认 → 开作业票 → 作业执行 → 作业验收。

## 技术栈（沙箱适配）
- 框架: Next.js 16 App Router + TypeScript（仅单页路由 /，API 走 /api/*）
- 数据库: Prisma + SQLite（schema 兼容 MySQL，生产切 provider=mysql）
- UI: Tailwind CSS 4 + shadcn/ui + lucide-react + recharts
- 前端形态: 单页应用(SPA)，侧边栏模块导航 + 内置移动端模拟器

## 📌 当前状态索引区（每轮 agent 先读这里 + 尾部最新 2~3 节即可，勿全文读取）
- **最新进展**：Task 99 已完成（票务双页 PID 定位 + 验收 doSubmit 真 bug 修复），本地/远程 main 同步于 447e128
- **需求基线 1~17 原文**：本文件下方 Task 98 节【最高机密·永不许再丢，勿删勿移】
- **关键纪律速查**：teal/emerald 主色、AI=violet、严禁 indigo/blue｜每完成一个功能块立即 git commit｜push 仅凭用户「push」指令（token 每次从 .env 现取+脱敏）｜E2E 注入数据必还原｜bunx tsx 脚本必须放项目根｜lint 基线=PPT 脚本 5 错误、src/ 零错误
- **遗留决策项**：T101/T-101 双编码、PRESSURE PN/MPa 口径、私有化 Qwen 网关（待用户定夺）
- **完整历史（Task 1 ~ 97-R-PUSH）**：见 worklog-archive.md（本仓库同目录）

- GITHUB_TOKEN 已恢复写入 .env；未竟事项不变：Task 92 八项需求待用户回忆清单、Task 93/94/95 待重建、QrSignSheet 人证核验 E2E 待补跑

---
Task ID: 98
Agent: 主会话(Z.ai Code)
Task: 用户回忆提供完整需求清单 1~17（Task 92 八项需求在其中）——持久化基线 + 逐项重建未完成项

## 【最高机密·需求基线 v1（用户 2026-09-16 原话，永不许再丢）】

> 1.盲板状态查看页面应该和PID组态页面一样有左下角的悬浮工具栏，去掉悬浮工具栏右边的说明文字。
> 2.之前盲板状态的图例不见了，让它重新显示在画布的右下角。
> 3.PID组态中选择某个图元后点击悬浮工具栏上的自定义图元应该以此图元为基础进行修改，但是目前选择的图元没有复制到新建图元的编辑页面里。
> 4.更换图元时弹出的页面里还有之前已经废弃的设备图元分组（下面还有6个图元），这个分组以及之下的6个图元应该彻底删除。
> 5.应用在浏览器中的页签title中显示智谱的Z图标，应该替换成主界面的石化盲板管理BPMS v1.0的应用图标。
> 6.PID图纸导入时，原图应该跳出窗口显示原始尺寸原图，可以放大缩小。
> 7.PID组态图上选择图元后可以编辑绑定的基础数据。
> 8.加装盲板（IP-E105-03E105至T102法兰）作业完成盲板状态显示盲板拆除已拆，这个状态不对。
> 9.管线编辑时数据项如果数据字典中有这个字典分类就应该从数据字段中取。
> 10.移动端现场勘察时选择隔离的方式应该是扫码加入，如果没有隔离点上没有码可以选择打印二维码标签。
> 11.移动端各有隔离点数据的页面也可以选择查看以所选隔离点为中心的放大PID图。
> 12.移动端现场交底、开工时、确认作业完工、作业验收时需要扫码核对隔离点位置，如果不对需要提醒用户，不允许施工。
> 13.PID组态的操作指引已经过时，和界面不一致，请重新编写。
> 14.查看盲板状态时右下角的图例左边的空白去掉，并且单行显示。
> 15.开作业票时需要对每个作业人员进行验资，上传作业人员身份证及相关作业资质照片，审核时需要显示作业票详细信息及每个作业人员的相关照片。
> 16.开作业票、作业票审核、开工确认也应支持移动端，也需要扫码核对隔离点二维码。
> 17.现场交底时需要核验作业人员是否和作业票上的人证相符，并拍照留痕。

## 需求 → 状态映射（Task 98 开工时盘点）

- 需求 13~17：✅ Task 97-R 已重建已上云（14d358d→65fee2e→843e8dc），勿重做
- 需求 10 前半（勘察扫码加入）：✅ Task 97-R 已重建（IsoScanSheet）；后半（打印二维码标签）❌待做
- 需求 12 部分（交底扫码 QrSignSheet/开工扫码 gate）：✅已建；完工确认/作业验收扫码 ❌待做
- 需求 1/2/3/4/5/6/7/8/9/11：❌ 全部待做（Task 92 八项≈需求1~8，需求9≈Task 94/95，需求7 含 Task 93 隔离点标志主数据编辑）

Work Log:
- 【基线持久化】需求 1~17 全文写入本节（上），映射盘点如上；立即 git commit 防丢失；本轮逐项重建，每完成一块 commit

---
Task ID: 98-COMPLETE
Agent: 主会话(Z.ai Code)
Task: 需求 1~12 逐项重建完成 + push 上云 + E2E 验证收尾

Work Log:
- 【push 先行（用户指令）】清理 qa98-db.mjs 临时脚本后推送：843e8dc→da47568 共 16 提交上云（token 现取+sed 脱敏+ls-remote 三方验证），远程 main=da47568，需求基线与全部重建代码进入远程安全区
- 需求1~4（f1c1f31）：pid-config/pid-locate 删工具栏说明文字+Move 死导入；图例右下角浮层保留；SymbolPart.stdId 修复 std 实例转自定义图元空白；更换图元对话框删 equip 分组
- 需求8（91fe1e1）：resolvePidPointState 增点位级 pointAction/pointDone——COMPLETED 按 ADD→盲板已装/REMOVE→盲板已拆分色（修复加装完工误标已拆）；IN_PROGRESS 已执行分色、未执行→作业执行中；pid-diagrams status 与 work-requests point-status 两调用方接线
- 需求5（85da1b7）：favicon 替换 BPMS v1.0 emerald 工厂图标（icon.svg+侧栏同款），移除智谱 Z 外链
- 需求6（606da80）：PID 导入原图查看器（原始尺寸弹窗+放大缩小）
- 需求7（af23cf2）：PID 组态属性面板就地编辑绑定主数据（含 Task 93 隔离点标志）
- 需求9（f98ed95）：管线编辑字典化 DictCombobox + 字典实际值补录（Task 94/95 收口）；5a3bc98 a11y 补全
- 需求10（6c52936）：移动端隔离点二维码标签打印 QrLabelPrint（field-ops 三处接线）；4bbc765/2c5d02a lint 修复
- 需求11（ada32c9）：LocateCtx+PidLocateDialog——移动端各隔离点页一键查看以该点为中心的放大 PID 图
- 需求12（d04e340）：完工确认/作业验收扫码核对 gate（交底/开工已有，四环节齐备）；da47568 hotfix 补 createContext 导入
- 【E2E 验证】dev server 重启（孤儿化）→admin 登录→icon.svg 200+BPMS 图标内容✅；盲板状态页截图：左下工具栏无说明文字✅右下六态单行图例✅PID 渲染正常✅；需求8 代码审查✅；移动端预览任务详情/现场 Tab 交互✅；lint 通过基线（PPT 脚本 5 错误，src/ 零错误）

Stage Summary:
- 需求 1~17 全部完成并上云（13~17 于 97-R，1~12 于本 Task，远程 main=da47568）
- 验证等级：需求1/2/5/14 浏览器截图实证；需求8 代码审查实证（用户已清数据无法复现原场景）；需求10/11/12 代码接线+页面交互抽查；需求6/7/9 专项提交+lint 通过
- 遗留：QrSignSheet 人证核验全链路 E2E 补跑（低优先）；巡检 cron 已重建基线 da47568

---
Task ID: 98-PUSH
Agent: 主会话(Z.ai Code)
Task: 用户「推送仓库」——Task 98-COMPLETE 收尾提交上云

Work Log:
- 【推送前核验】.env token 现取非空（93 位 PAT 在库）；待推增量 da47568..HEAD = 2 提交（97b925a worklog 交接文档 + 66cf633 平台快照，仅 db/custom.db 二进制与 worklog.md 23 行）；敏感串严格扫描（github_pat/ghp_/x-access-token）零命中
- 【推送】URL 方式 push 成功 da47568..66cf633 main -> main（输出 sed 脱敏）
- 【三方验证】fetch+update-ref 补 tracking ref（此前 origin/main 陈旧在 843e8dc）；本地 origin/main = 远程 ls-remote refs/heads/main = 66cf633；git status -sb 零偏差
- 【收尾】本节 push 记录追加 worklog 并即时 commit + 二次推送上云；巡检 cron 已于本轮先前操作重建为 387805（基线 97b925a，每 15 分钟，priority 10）

Stage Summary:
- 远程 main = 本地 main = 66cf633：需求 1~17 全量基线（worklog Task 98 节）+ Task 98-COMPLETE 交接 + 全部重建代码均已在远程安全区
- 下轮巡检候选不变：QrSignSheet 人证核验 E2E 补跑、需求8 六态判定 E2E 实证、后端扫码强校验、库存周转图表等

---
Task ID: 99
Agent: 主会话(Z.ai Code)
Task: 用户新需求——移动端「开作业票」「作业票审批」也支持查看以所选隔离点为中心的放大 PID 图（需求 11 扩展到票务两页）

Work Log:
- 【接线模式】复用 field-ops 需求11 同款 LocateCtx(createContext)+Provider+PidLocateDialog 单例模式；ticket-mobile.tsx 新增模块级 LocateCtx/TicketLocateBtn（有编码才显示；嵌入 label/卡片传 stop 防外层点击）+ useTicketLocate() 共用 hook（locateState 携带 preferUnitId，本装置图优先命中）
- 【开票页】TicketNewPage 点位选择行（label+Checkbox）尾缀 TicketLocateBtn（stop 模式防误勾选），preferUnitId=所选需求 unit.id；Provider 包裹 PageShell+弹窗
- 【审批页】TicketReviewPage 双分支（详情/列表）各自 Provider 包裹：①列表卡由 <button> 改 div role=button+tabIndex+onKeyDown（避免按钮嵌套 button 破坏 HTML 语义），点位行嵌入 PID 按钮（stop 防触发卡片进详情）；②详情票面信息标题行 ml-auto 嵌 PID 按钮
- 【顺手修复·真 bug】tsc 暴露 field-ops.tsx AcceptPage doSubmit 引用 `pass` 越界（需求12 拆分 submit/doSubmit 时 const pass 留在 submit 作用域）→ 验收提交必 ReferenceError 被 catch 吞成「验收提交失败」toast；修复：doSubmit 内自行计算 `const pass = leak && restore && ledger`（state 组件级可直接读）；另修 ticket-mobile 预存类型松弛（ticketed set pointId null 过滤改 flatMap）
- 【验证】tsc src/ 零错误；ESLint 基线（PPT 脚本 5 错误，src/ 零）；E2E agent-browser 注入 WR-QA99-TEST(unit10)+方案点位 IP-PL301-01(masterPointId 29↔图23挂标)+待批票 BP-QA99-TEST：①开票页点行 PID→弹窗命中「QA催化分馏系统 PID·QA试验装置 1/1 已挂标」amber 光环定位（截图）；②审批列表卡 PID→弹窗打开且不跳详情（stopPropagation 实证）；③详情票面头部 PID→弹窗定位（截图，背景可见审核意见区）；注入数据已删还原（ticket/scheme/req 各1）、临时脚本已清、dev.log 无运行时错误
- 【commit】da7c8f0 feat(mobile)+fix 验收 doSubmit；待用户「push」指令

Stage Summary:
- 需求 11 覆盖面扩展完成：现场端（field-ops 各页）+ 票务端（开票/审批移动双页）全部有隔离点数据的页面均可一键 PID 放大定位
- 意外收获：修复作业验收提交必败 bug（doSubmit pass 作用域）——该路径上次 E2E 未覆盖，本轮 tsc 全量检查暴露
- 遗留：验收页扫码 gate 全流程 E2E 仍建议下轮补跑；本地领先远程 1 提交（da7c8f0）待 push

---
Task ID: 99-PUSH
Agent: 主会话(Z.ai Code)
Task: 用户「push」——Task 99 提交上云（token 第 3 次被平台抹除→用户重供 PAT）

Work Log:
- 【token 缺失】push 前现取 .env GITHUB_TOKEN 为空（平台重置第 3 次抹除）；按纪律直接向用户索取，未重复全盘排查
- 【新 PAT 入库】93 位 PAT 追加 .env（rg 确认 1 处），GET /user 鉴权 = liaoweimin74 本人
- 【推送前核验】工作区发现 8 文件「修改」均为权限位变化（平台快照恢复 644→755，0 行内容差异），git checkout 还原干净；待推 3 提交（da7c8f0 功能 / bdd3249 worklog / d2513ec 平台快照 db）；敏感串扫描零命中
- 【推送】33cb84b..d2513ec main -> main 成功（输出 sed 脱敏）；三方验证：fetch+update-ref 后本地 origin/main = 远程 ls-remote = d2513ec，status 零偏差
- 【收尾】本节记录追加 worklog 即时 commit + 二次推送

Stage Summary:
- 远程 main = 本地 main（Task 99-PUSH 记录提交后以实际 HEAD 为准）：需求 11 扩展（票务双页 PID 定位）+ 验收 doSubmit 真 bug 修复全部上云
- 运维事实固化：GITHUB_TOKEN 已 3 次被平台抹除——今后 push 遇缺失直接要 PAT

---
Task ID: 99-ARCHIVE
Agent: 主会话(Z.ai Code)
Task: 用户问询 worklog 体积是否影响开发/调试性能 → 分析 + 归档瘦身

Work Log:
- 【影响分析】运行时零影响（worklog 不参与构建）；git 毫秒级（delta 压缩，每轮仅追加 15~25 行）；真实成本=agent 上下文 token（全文读 3121 行 ≈ 5~8 万 token 会挤占 LLM 窗口）
- 【归档拆分】worklog.md 3121 行 → 主文件 126 行（原头部 + 新增「当前状态索引区」：最新进展/基线指针/纪律速查/遗留决策/归档指针 + Task 98 需求基线【最高机密·勿删勿移】+ Task 98-COMPLETE~99-PUSH 全文）；worklog-archive.md 3005 行承接 Task 1~97-R-PUSH 全部 162 个历史节，内容零删改
- 【守恒验证】126+3005=3131=原 3121+新增头 10 行；Task 98 基线节/Task 99-PUSH/归档首尾节均 rg 实证在位
- 【读取纪律】此后每轮 agent 只读：索引区 + 尾部最新 2~3 节（tail）+ 按需 rg 检索，勿全文读取

Stage Summary:
- 主 worklog 瘦身 96%（3121→126 行），历史全文安全移入 worklog-archive.md（同仓库同保护级别）
- 「需求 1~17 基线」仍留主文件 Task 98 节原位；cron payload 中相关指针描述继续有效

---
Task ID: 99-PUSH2
Agent: 主会话(Z.ai Code)
Task: 用户「push」——归档瘦身提交上云 + 敏感扫描命中研判事件

Work Log:
- 【推送】84b20c2（worklog 归档瘦身）上云成功 447e128..84b20c2
- 【扫描命中研判】归档使历史 worklog 全文进入 diff → 扫描器命中 3 行：①Task 91 时代旧 token 指纹（前12+省略+后6，非完整 93 位，不可复用且该 token 已失效）②③github_pat_xxx/… 纯占位符；实证完整 token（新旧均）从未入库（rg 零命中）；且这些指纹行在 Task 91/97 时代早已存在于远程历史 blob，本次搬运未引入新泄露
- 【清洗】worklog-archive.md 中旧指纹行已 sed 脱敏为「github_pat_[旧token指纹已清洗]」（历史 blob 中的指纹仍在；如需彻底清除须 rewrite history+撤销旧 PAT，因 token 已失效风险极低，默认不执行）
- 【流程缺陷修正】本轮扫描与 push 误串同一命令（echo 后无条件继续 push）——今后敏感扫描必须独立调用，命中时停下人工研判，严禁与 push 同条命令串联
- 【三方验证】ls-remote refs/heads/main = 本地 HEAD（本节提交后以最终推送为准）

Stage Summary:
- 归档瘦身版本上云完成；敏感命中为历史指纹文字而非完整 token，无实质泄露；文件层已清洗
- 流程加固：扫描/push 分离执行写入手册（cron payload 后续轮次同步）
