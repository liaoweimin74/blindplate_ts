# Task 19-a 子代理(后端数据与API) - 工作记录

## 任务
管线/隔离点主数据/PID组态图的数据模型与 API：Prisma 三张新表 + IsolationPoint.masterPointId 字段、6 组 CRUD/实时状态 API、isolation-schemes 点位行透传 masterPointId、幂等种子脚本。

## 改动文件
1. `prisma/schema.prisma`（追加）
   - `Pipeline`（code unique/name/unitId/medium/spec/designPressure/designTemp/fromTo/remark/createdAt）
   - `IsoPointMaster`（code unique/name/pipelineId/unitId/location/spec/blindSpec/blindType/remark/createdAt）
   - `PidDiagram`（name/unitId/content 默认 "[]"/createdAt/updatedAt）
   - `IsolationPoint` 追加 `masterPointId Int?`（裸外键无 relation，注释指向 blindPlateId 惯例）
2. `src/lib/bp-server-utils.ts`（AUDIT_ENTITY_MAP 追加三条：PIPELINE:'管线管理' / ISO_POINT_MASTER:'隔离点主数据' / PID_DIAGRAM:'PID组态图'，供审计展示中文）
3. `src/app/api/pipelines/route.ts`（新建）
   - GET：orderBy id asc；?unitId= 精确、?q= contains 匹配 code/name/medium；批量 in 查 Unit 手动关联返回 unitName
   - POST：code/name 必填；code 重复 409「管线编号已存在」；extractActor + logAudit(entity:'PIPELINE', entityId:String(id))；detail「创建管线「name」」
4. `src/app/api/pipelines/[id]/route.ts`（新建）
   - PUT：部分更新（code 改变时查重 409、name 必填、其余可空字段置 null）；审计 UPDATE
   - DELETE：先 count IsoPointMaster.pipelineId，>0 返回 409「该管线下存在隔离点位，无法删除」；操作者经 query __actorId/__actorName（units/[id] 惯例）；审计 DELETE
5. `src/app/api/iso-point-masters/route.ts`（新建）
   - GET：?pipelineId=/?unitId=/?q=（code/name/location contains）；并行批量 in 查 Pipeline+Unit 关联 pipelineName/unitName
   - POST：code/name 必填、code 重复 409「点位编号已存在」；审计 CREATE entity:'ISO_POINT_MASTER'
6. `src/app/api/iso-point-masters/[id]/route.ts`（新建）
   - PUT：部分更新（code 查重 409）；审计 UPDATE
   - DELETE：不强制业务引用校验——先 `isolationPoint.updateMany({where:{masterPointId:id}, data:{masterPointId:null}})` 解绑（返回解绑条数拼进审计 detail），再删；审计 DELETE
7. `src/app/api/pid-diagrams/route.ts`（新建）
   - GET：列表轻量化，返回 {id,name,unitId,unitName,shapeCount,updatedAt,createdAt}，shapeCount=JSON.parse(content) 数组长度（parse 失败/非数组算 0）；不返回 content
   - POST：{name,unitId?,content?}，content 缺省 '[]'；提供时校验 parse+isArray 否则 400；审计 CREATE entity:'PID_DIAGRAM'（entityCode 用 name）
8. `src/app/api/pid-diagrams/[id]/route.ts`（新建）
   - GET：完整返回 content 原样字符串 + unitName；404「组态图不存在」
   - PUT：name/unitId 部分更新；content 仅提供时覆盖（parse+isArray 校验，非法 400）；审计 UPDATE
   - DELETE：操作者经 query 传递；审计 DELETE
9. `src/app/api/pid-diagrams/[id]/status/route.ts`（新建，核心实时状态）
   - 404 校验 → 解析 content（失败按空数组）→ 收集 type==='isoPoint' 且 masterPointId 非空的 shape（num() 归一 + 去重 + 按图中出现顺序）
   - 无绑定 → 直接返回 { points: [], generatedAt }
   - 批量查询防 N+1：①IsoPointMaster in 查主数据（pointName/location/spec/blindSpec）②isolationPoint.findMany({where:{masterPointId:{in}},include:{scheme:true}}) 按 masterPointId 分组 ③每组取 scheme.preparedAt 最新一条判态 ④requestIds/blindPlateIds/workTicket 三组批量 in 查（Map 关联 bizCode/blindCode/ticketCode）
   - 状态机：无业务点=idle「常通 · 无作业」；done+ADD=blinded「盲板已装（盲）」；done+REMOVE=opened「盲板已拆（通）」；!done+方案 APPROVED=working「作业执行中」；其余（编制中/待审）=planned「已计划待执行」
10. `src/app/api/isolation-schemes/route.ts`（POST points create 透传 `masterPointId: num(p.masterPointId)`）
11. `src/app/api/isolation-schemes/[id]/route.ts`（PUT points 整体替换时同样透传）——两处均为单行增量，其余逻辑零改动
12. `scripts/seed-pid-data.ts`（新建，bun 运行）

## 关键决策
- 状态 API 的「最新方案」排序键用 `scheme.preparedAt`（IsolationScheme 无 createdAt 字段，preparedAt @default(now()) 即创建时间；契约中 scheme.createdAt 在该模型上不存在，属等价替换）+ point.id 兜底
- DELETE 类审计 actor 从 query `__actorId/__actorName` 取（units/[id] 既有惯例，DELETE 无 body）；POST/PUT 用 extractActor(body)
- pid-diagrams POST 的 content 前置校验（parse+数组）与 PUT 一致，防脏数据入库
- 种子幂等策略：pidDiagram/isoPointMaster/pipeline 三表 deleteMany 全清后重建（任务书明确允许），不动其余任何表；autoincrement id 会随重跑递增（内容一致），主数据一律按 code 关联不依赖 id
- 种子 location 与既有业务隔离点文字对齐：IP-E101-01=「E101入口管线 DN100 法兰」(WR-202609-001)、IP-R201-01=「R201待生线立管法兰」(WR-202506-002)、IP-R301-01=「反应器R301入口法兰」(WR-202506-003)、IP-E401-01=「E401管程入口」(WR-202506-004)；unitId 按 Unit 表名称实时取（催化裂化=2/加氢精制=4/连续重整=1/常减压蒸馏=3）
- 组态图 18 图元：tank T101/pump P101/exchanger E101+E401/vessel V101/column R201 各 1-2、pipe×6（2-4 顶点折线带 label「E101 原油进料」等）、valve×3（切断阀/调节阀/待生滑阀）、isoPoint×3（masterPointId 绑 IP-E101-01/IP-R201-01/IP-E401-01 种子 id，label 用点位名）

## 验证结果
- `bun run db:push` 成功（SQLite custom.db 同步 + Prisma Client 生成）
- 种子脚本两遍运行成功，输出一致（6 管线/10 点位/1 图/18 图元/3 绑定）；第二遍后图 id=2、绑定 id=11/13/17（自增重建正常现象）
- `bunx tsc --noEmit | grep '^src/'` 输出为空（0 错误；修复过一轮 status 路由的 scheme.createdAt→preparedAt 与 Promise.all 联合类型推断问题）
- `bun run lint` 0 error
- 数据断言（Prisma 直查）：Pipeline=6 ✓ IsoPointMaster=10 ✓ PidDiagram=1 且 content 可解析（18 图元、3 个 isoPoint 带 masterPointId）✓ 既有 IsolationPoint 13 行 masterPointId 全 null ✓
- 未启动/重启 dev server（主控管理）；dev.log 无编译错误

## 遗留/交接
- 全部业务隔离点 masterPointId 现为 null → status API 当前对 3 个种子点返回全 idle「常通 · 无作业」；运行时链路演示需经隔离方案编辑器（19-b/主控接线后）带 masterPointId 创建/更新方案
- 种子重跑 id 自增递增（deleteMany+create 固有）；任何外部引用请按 code（PL-*/IP-*）定位，勿硬编码 id
- API 鉴权中间件专项（全站既有缺口）本轮未涉及
