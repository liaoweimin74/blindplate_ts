/**
 * 盲板管理系统 - 种子数据脚本
 * 运行: bun run prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()

function daysAgo(n: number, h = 9, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, m, 0, 0)
  return d
}
function daysLater(n: number, h = 17, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(h, m, 0, 0)
  return d
}

async function main() {
  console.log('🧹 清空旧数据...')
  await db.approvalRecord.deleteMany()
  await db.acceptance.deleteMany()
  await db.workTask.deleteMany()
  await db.workTicket.deleteMany()
  await db.disposalConfirmation.deleteMany()
  await db.disposalStep.deleteMany()
  await db.disposalScheme.deleteMany()
  await db.isolationPoint.deleteMany()
  await db.isolationScheme.deleteMany()
  await db.jsaStep.deleteMany()
  await db.jsaAnalysis.deleteMany()
  await db.siteSurvey.deleteMany()
  await db.workRequest.deleteMany()
  await db.changeRecord.deleteMany()
  await db.inventoryItem.deleteMany()
  await db.blindPlate.deleteMany()
  await db.dict.deleteMany()
  await db.unit.deleteMany()
  await db.user.deleteMany()

  // ============ 用户 ============
  console.log('👤 创建用户...')
  await db.user.createMany({
    data: [
      { username: 'admin', name: '系统管理员', role: 'ADMIN', department: '信息中心', phone: '13800000001' },
      { username: 'liuzr', name: '刘主任', role: 'MANAGER', department: '生产技术部', phone: '13800000002' },
      { username: 'zhangg', name: '张工', role: 'ENGINEER', department: '一车间工艺组', phone: '13800000003' },
      { username: 'cheny', name: '陈工', role: 'ENGINEER', department: '二车间工艺组', phone: '13800000004' },
      { username: 'lizr', name: '李主任', role: 'REVIEWER', department: '安全环保部', phone: '13800000005' },
      { username: 'wangbz', name: '王班长', role: 'OPERATOR', department: '检修一班', phone: '13800000006' },
      { username: 'zhaogs', name: '赵师傅', role: 'OPERATOR', department: '检修一班', phone: '13800000007' },
      { username: 'sunjh', name: '孙监护', role: 'GUARDIAN', department: '安全环保部', phone: '13800000008' },
      { username: 'zhouys', name: '周验收', role: 'ACCEPTOR', department: '生产技术部', phone: '13800000009' },
    ],
  })

  // 密码 scrypt 哈希化（演示密码仍为 123456，存储不再为明文）
  console.log('🔐 哈希化用户密码...')
  const seedUsers = await db.user.findMany({ select: { id: true } })
  await Promise.all(
    seedUsers.map((u) => db.user.update({ where: { id: u.id }, data: { password: hashPassword('123456') } })),
  )

  // ============ 装置 ============
  console.log('🏭 创建装置...')
  const units = await Promise.all(
    [
      { code: 'CY-01', name: '常减压蒸馏装置', manager: '张工', phone: '13800000003' },
      { code: 'CH-02', name: '催化裂化装置', manager: '陈工', phone: '13800000004' },
      { code: 'JQ-03', name: '加氢精制装置', manager: '张工', phone: '13800000003' },
      { code: 'CZ-04', name: '连续重整装置', manager: '陈工', phone: '13800000004' },
    ].map((u) => db.unit.create({ data: u }))
  )

  // ============ 字典 ============
  console.log('📖 创建字典...')
  const dictData: { category: string; value: string; label: string; order: number }[] = []
  ;['DN15', 'DN20', 'DN25', 'DN40', 'DN50', 'DN80', 'DN100', 'DN150', 'DN200', 'DN250', 'DN300', 'DN350', 'DN400', 'DN500'].forEach(
    (v, i) => dictData.push({ category: 'BLIND_SPEC', value: v, label: v, order: i })
  )
  ;['八字盲板', '插板', '垫环', '盲法兰'].forEach((v, i) =>
    dictData.push({ category: 'BLIND_TYPE', value: v, label: v, order: i })
  )
  ;['Q235B', 'Q345R', '304', '316L', '20#'].forEach((v, i) =>
    dictData.push({ category: 'MATERIAL', value: v, label: v, order: i })
  )
  ;['PN1.0', 'PN1.6', 'PN2.5', 'PN4.0', 'PN6.3'].forEach((v, i) =>
    dictData.push({ category: 'PRESSURE', value: v, label: v, order: i })
  )
  ;['原油', '蜡油', '渣油', '汽油', '柴油', '液化气', '干气', '氢气', '蒸汽', '氮气', '循环水', '酸性水'].forEach((v, i) =>
    dictData.push({ category: 'MEDIUM', value: v, label: v, order: i })
  )
  await db.dict.createMany({ data: dictData })

  // ============ 盲板台账 + 库存 ============
  console.log('🔧 创建盲板台账与库存...')
  const specs = ['DN50', 'DN80', 'DN100', 'DN150', 'DN200', 'DN250', 'DN300']
  const types = ['八字盲板', '插板', '垫环']
  const materials = ['Q235B', '304', '316L']
  let seq = 1
  const plates: { code: string; spec: string; type: string; material: string; thickness: number; pressureRating: string; status: string; location?: string; unitId?: number }[] = []
  for (let i = 0; i < 46; i++) {
    const spec = specs[i % specs.length]
    const type = types[i % types.length]
    const material = materials[i % materials.length]
    const pn = ['PN1.0', 'PN1.6', 'PN2.5', 'PN4.0'][i % 4]
    // 前6块已安装, 2块预留, 1块报废, 其余在库
    let status = 'IN_STOCK'
    let location: string | undefined = `盲板库-A区-${String((i % 8) + 1)}排${String((i % 5) + 1)}架`
    let unitId: number | undefined
    if (i < 6) {
      status = 'INSTALLED'
      const u = units[i % units.length]
      location = `${u.name}-E${101 + i}管线法兰处`
      unitId = u.id
    } else if (i < 8) {
      status = 'RESERVED'
      location = '已预留待领用'
    } else if (i === 8) {
      status = 'SCRAPPED'
      location = '报废区'
    }
    plates.push({
      code: `MB-${spec}-${String(seq++).padStart(4, '0')}`,
      spec,
      type,
      material,
      thickness: spec === 'DN300' ? 12 : spec === 'DN250' ? 10 : 8,
      pressureRating: pn,
      status,
      location,
      unitId,
    })
  }
  const createdPlates = await Promise.all(plates.map((p) => db.blindPlate.create({ data: p })))

  // 库存汇总 (在库盲板按规格类型材质聚合)
  const stockMap = new Map<string, { spec: string; type: string; material: string; quantity: number }>()
  plates
    .filter((p) => p.status === 'IN_STOCK')
    .forEach((p) => {
      const key = `${p.spec}|${p.type}|${p.material}`
      const cur = stockMap.get(key)
      if (cur) cur.quantity++
      else stockMap.set(key, { spec: p.spec, type: p.type, material: p.material, quantity: 1 })
    })
  // 补充部分虚拟库存
  ;[
    { spec: 'DN350', type: '八字盲板', material: 'Q235B', quantity: 0, minQuantity: 2 },
    { spec: 'DN400', type: '插板', material: '316L', quantity: 1, minQuantity: 2 },
  ].forEach((x) => stockMap.set(`${x.spec}|${x.type}|${x.material}`, x))
  await db.inventoryItem.createMany({
    data: Array.from(stockMap.values()).map((x) => ({ ...x, minQuantity: 2 })),
  })

  // 变动记录
  await db.changeRecord.createMany({
    data: createdPlates.slice(0, 6).map((p, i) => ({
      blindPlateId: p.id,
      blindCode: p.code,
      action: 'INSTALL',
      workCode: `WR-20250${i + 1}-00${i + 1}`,
      location: p.location,
      fromStatus: 'IN_STOCK',
      toStatus: 'INSTALLED',
      operator: '王班长',
      note: '按作业票安装到位',
      createdAt: daysAgo(30 - i * 3),
    })),
  })

  // ============ 作业需求样例 (覆盖各状态) ============
  console.log('📋 创建作业需求样例...')
  const engineer = await db.user.findFirst({ where: { role: 'ENGINEER' } })
  const applicant = await db.user.findFirst({ where: { role: 'MANAGER' } })

  async function createRequest(data: {
    seq: number
    title: string
    workType: string
    unitIdx: number
    location: string
    medium: string
    status: string
    days: number
  }) {
    return db.workRequest.create({
      data: {
        code: `WR-202506-${String(data.seq).padStart(3, '0')}`,
        title: data.title,
        workType: data.workType,
        unitId: units[data.unitIdx].id,
        location: data.location,
        pipelineName: `${data.medium}管线`,
        medium: data.medium,
        pressure: '1.6MPa',
        temperature: '180℃',
        reason: '装置检修需要，按计划进行盲板抽堵作业以实现可靠隔离',
        urgency: 'MEDIUM',
        plannedStart: daysLater(2),
        plannedEnd: daysLater(3),
        applicantId: applicant!.id,
        applicantName: applicant!.name,
        status: data.status,
        createdAt: daysAgo(data.days),
      },
    })
  }

  const r1 = await createRequest({ seq: 1, title: 'E101原油管线检修隔离', workType: 'ADD', unitIdx: 0, location: '常压塔进料线 E101入口法兰', medium: '原油', status: 'COMPLETED', days: 25 })
  const r2 = await createRequest({ seq: 2, title: '再生器旋风分离器检修隔离', workType: 'BOTH', unitIdx: 1, location: '再生器R201待生线', medium: '干气', status: 'IN_PROGRESS', days: 18 })
  const r3 = await createRequest({ seq: 3, title: '加氢反应器R301入口隔离', workType: 'ADD', unitIdx: 2, location: '反应器R301入口法兰', medium: '氢气', status: 'PENDING_CONFIRM', days: 12 })
  const r4 = await createRequest({ seq: 4, title: '重整进料换热器检修', workType: 'BOTH', unitIdx: 3, location: 'E401管程入口', medium: '汽油', status: 'ISOLATION_PENDING_REVIEW', days: 8 })
  const r5 = await createRequest({ seq: 5, title: '酸性水汽提塔顶回流线抽盲板', workType: 'REMOVE', unitIdx: 2, location: 'T302塔顶回流线', medium: '酸性水', status: 'DISPOSAL_PENDING_REVIEW', days: 6 })
  const r6 = await createRequest({ seq: 6, title: '柴油汽提塔底泵出口隔离', workType: 'ADD', unitIdx: 0, location: 'P102出口法兰', medium: '柴油', status: 'JSA_DONE', days: 4 })
  const r7 = await createRequest({ seq: 7, title: '液化气脱硫抽提塔检修隔离', workType: 'BOTH', unitIdx: 1, location: 'T501底部出料线', medium: '液化气', status: 'SURVEYED', days: 3 })
  const r8 = await createRequest({ seq: 8, title: '蒸汽伴热管线临时盲板加装', workType: 'ADD', unitIdx: 3, location: 'MS-204伴热站', medium: '蒸汽', status: 'PENDING_SURVEY', days: 2 })
  const r9 = await createRequest({ seq: 9, title: '循环水泵出口检修隔离', workType: 'ADD', unitIdx: 0, location: 'P501出口阀后法兰', medium: '循环水', status: 'DRAFT', days: 1 })
  const r10 = await createRequest({ seq: 10, title: '渣油换热网络抽堵盲板', workType: 'BOTH', unitIdx: 0, location: 'E105/E106管束', medium: '渣油', status: 'PENDING_ACCEPTANCE', days: 9 })

  // ============ 勘察 / JSA / 方案等关联数据 ============
  console.log('📝 创建勘察/JSA/方案数据...')
  await db.siteSurvey.create({
    data: {
      workRequestId: r1.id,
      surveyor: '张工',
      surveyDate: daysAgo(23),
      siteCondition: 'E101入口法兰位于管廊三层，平台稳固，照明良好，周围无动火交叉作业，具备作业条件',
      pipelineVerify: '介质原油、压力1.6MPa、温度180℃，与需求单一致',
      hazardPoints: '高处作业(3.5m)；残留原油可能滴落；相邻管线保温层高温',
      isSafe: true,
      suggestion: '作业时设置警戒区，铺设接油盘，佩戴防化手套',
    },
  })
  const jsa1 = await db.jsaAnalysis.create({
    data: {
      workRequestId: r1.id,
      leader: '张工',
      members: '王班长,赵师傅,孙监护',
      analysisDate: daysAgo(22),
      riskLevel: 'MEDIUM',
      residualRisk: '残液泄漏风险通过接油盘+蒸汽吹扫控制；安排专人监护',
    },
  })
  await db.jsaStep.createMany({
    data: [
      { jsaId: jsa1.id, seq: 1, step: '办理作业票并确认工艺处置完成', hazard: '未确认即作业导致介质喷溅', measure: '核对处置确认单，双人复核' },
      { jsaId: jsa1.id, seq: 2, step: '搭设作业平台并系挂安全带', hazard: '高处坠落', measure: '平台验收合格，安全带高挂低用' },
      { jsaId: jsa1.id, seq: 3, step: '拆卸法兰螺栓抽出垫环', hazard: '残压残液伤人', measure: '先松对角螺栓泄压，铺设接油盘' },
      { jsaId: jsa1.id, seq: 4, step: '加装八字盲板并对称紧固', hazard: '盲板装反/紧固不均泄漏', measure: '核对方向与规格，力矩扳手对称紧固' },
      { jsaId: jsa1.id, seq: 5, step: '试压查漏并登记台账', hazard: '漏装导致后置作业风险', measure: '肥皂水查漏，台账双人复核' },
    ],
  })
  const iso1 = await db.isolationScheme.create({
    data: {
      workRequestId: r1.id,
      code: 'GL-202506-001',
      preparedBy: '张工',
      preparedAt: daysAgo(21),
      status: 'APPROVED',
      comment: '隔离点设置合理，同意执行',
      reviewedBy: '李主任',
      reviewedAt: daysAgo(20),
    },
  })
  const p1 = createdPlates[0]
  await db.isolationPoint.createMany({
    data: [
      { schemeId: iso1.id, seq: 1, location: 'E101入口法兰(管廊三层)', medium: '原油', pressure: '1.6MPa', temperature: '180℃', blindSpec: 'DN150', blindType: '八字盲板', action: 'ADD', blindPlateId: p1.id, done: true, doneAt: daysAgo(15), operator: '王班长' },
      { schemeId: iso1.id, seq: 2, location: 'E101出口跨线法兰', medium: '原油', pressure: '1.6MPa', temperature: '160℃', blindSpec: 'DN80', blindType: '插板', action: 'ADD', blindPlateId: createdPlates[1].id, done: true, doneAt: daysAgo(15), operator: '赵师傅' },
    ],
  })
  const gy1 = await db.disposalScheme.create({
    data: {
      workRequestId: r1.id,
      code: 'GY-202506-001',
      preparedBy: '张工',
      preparedAt: daysAgo(20),
      status: 'APPROVED',
      comment: '处置步骤完整，同意',
      reviewedBy: '李主任',
      reviewedAt: daysAgo(19),
    },
  })
  await db.disposalStep.createMany({
    data: [
      { schemeId: gy1.id, seq: 1, method: 'VENT', detail: 'E101入口线泄压至0.05MPa', standard: '压力表读数≤0.05MPa', completed: true },
      { schemeId: gy1.id, seq: 2, method: 'DRAIN', detail: '打开低点导凝排净存油', standard: '导凝口无油流出', completed: true },
      { schemeId: gy1.id, seq: 3, method: 'PURGE', detail: '1.0MPa蒸汽吹扫2小时', standard: '出口无油汽', completed: true },
      { schemeId: gy1.id, seq: 4, method: 'GAS_TEST', detail: '可燃气体检测', standard: 'LEL<0.5%', completed: true },
    ],
  })
  await db.disposalConfirmation.create({
    data: {
      workRequestId: r1.id,
      confirmer: '张工',
      confirmedAt: daysAgo(18),
      stepsConfirmed: true,
      flammableResult: 'LEL 0.0%',
      oxygenResult: '20.9%',
      toxicResult: 'H2S 未检出',
      analysisQualified: true,
      result: 'QUALIFIED',
      remarks: '具备作业条件',
    },
  })
  const t1 = await db.workTicket.create({
    data: {
      code: 'BP-202506-001',
      workRequestId: r1.id,
      plannedStart: daysAgo(15, 8),
      plannedEnd: daysAgo(15, 17),
      guardian: '孙监护',
      workers: '王班长,赵师傅',
      issuer: '刘主任',
      safetyMeasures: '1.作业人员佩戴防化手套、护目镜\n2.高处作业系挂安全带\n3.现场设置警戒区并配备灭火器2具\n4.作业前确认可燃气体检测合格\n5.专人监护,严禁交叉作业',
      status: 'CLOSED',
      approvedBy: '李主任',
      approvedAt: daysAgo(16),
      startedAt: daysAgo(15, 8, 30),
      finishedAt: daysAgo(15, 16),
      closedAt: daysAgo(14),
    },
  })
  const task1 = await db.workTask.create({
    data: {
      code: 'TSK-202506-001',
      workRequestId: r1.id,
      ticketId: t1.id,
      assignee: '王班长',
      planStart: daysAgo(15, 8),
      planEnd: daysAgo(15, 17),
      status: 'DONE',
      actualStart: daysAgo(15, 8, 30),
      actualEnd: daysAgo(15, 16),
    },
  })
  await db.acceptance.create({
    data: {
      workRequestId: r1.id,
      acceptor: '周验收',
      acceptedAt: daysAgo(14),
      leakCheck: true,
      restoreCheck: true,
      ledgerCheck: true,
      conclusion: 'PASS',
      remarks: '盲板安装到位，查漏合格，台账已更新',
    },
  })

  // r2 作业中
  const iso2 = await db.isolationScheme.create({
    data: {
      workRequestId: r2.id,
      code: 'GL-202506-002',
      preparedBy: '陈工',
      preparedAt: daysAgo(15),
      status: 'APPROVED',
      comment: '同意，注意再生器高温风险',
      reviewedBy: '李主任',
      reviewedAt: daysAgo(14),
    },
  })
  await db.isolationPoint.createMany({
    data: [
      { schemeId: iso2.id, seq: 1, location: 'R201待生线立管法兰', medium: '干气', pressure: '0.25MPa', temperature: '480℃', blindSpec: 'DN300', blindType: '盲法兰', action: 'ADD', blindPlateId: createdPlates[2].id, done: true, doneAt: daysAgo(10), operator: '王班长' },
      { schemeId: iso2.id, seq: 2, location: 'R201溢流管根部法兰', medium: '干气', pressure: '0.25MPa', temperature: '460℃', blindSpec: 'DN200', blindType: '八字盲板', action: 'ADD', blindPlateId: createdPlates[3].id, done: false },
      { schemeId: iso2.id, seq: 3, location: '待生滑阀后法兰', medium: '干气', pressure: '0.3MPa', temperature: '450℃', blindSpec: 'DN100', blindType: '插板', action: 'REMOVE', blindPlateId: createdPlates[4].id, done: false },
    ],
  })
  const gy2 = await db.disposalScheme.create({
    data: { workRequestId: r2.id, code: 'GY-202506-002', preparedBy: '陈工', preparedAt: daysAgo(14), status: 'APPROVED', comment: '同意', reviewedBy: '李主任', reviewedAt: daysAgo(13) },
  })
  await db.disposalStep.createMany({
    data: [
      { schemeId: gy2.id, seq: 1, method: 'VENT', detail: 'R201待生线泄压', standard: '压力归零', completed: true },
      { schemeId: gy2.id, seq: 2, method: 'STEAM', detail: '蒸汽蒸煮12小时', standard: '温度降至60℃以下', completed: true },
      { schemeId: gy2.id, seq: 3, method: 'GAS_TEST', detail: '可燃与有毒气体检测', standard: 'LEL<0.5%,H2S<10ppm', completed: true },
    ],
  })
  await db.disposalConfirmation.create({
    data: {
      workRequestId: r2.id, confirmer: '陈工', confirmedAt: daysAgo(12), stepsConfirmed: true,
      flammableResult: 'LEL 0.2%', oxygenResult: '20.8%', toxicResult: 'H2S 2ppm',
      analysisQualified: true, result: 'QUALIFIED',
    },
  })
  const t2 = await db.workTicket.create({
    data: {
      code: 'BP-202506-002', workRequestId: r2.id, plannedStart: daysAgo(11, 8), plannedEnd: daysLater(1, 17),
      guardian: '孙监护', workers: '王班长,赵师傅', issuer: '刘主任',
      safetyMeasures: '1.高温管线作业穿戴隔热服\n2.可燃气体检测合格后作业\n3.设置警戒区,专人监护\n4.配备灭火器与蒸汽带',
      status: 'IN_PROGRESS', approvedBy: '李主任', approvedAt: daysAgo(12), startedAt: daysAgo(11, 8, 30),
    },
  })
  await db.workTask.create({
    data: {
      code: 'TSK-202506-002', workRequestId: r2.id, ticketId: t2.id, assignee: '王班长',
      planStart: daysAgo(11, 8), planEnd: daysLater(1, 17), status: 'IN_PROGRESS', actualStart: daysAgo(11, 8, 30),
    },
  })

  // r3 处置已确认待开票
  const iso3 = await db.isolationScheme.create({
    data: { workRequestId: r3.id, code: 'GL-202506-003', preparedBy: '张工', preparedAt: daysAgo(9), status: 'APPROVED', comment: '氢气管线隔离，务必双人确认', reviewedBy: '李主任', reviewedAt: daysAgo(8) },
  })
  await db.isolationPoint.createMany({
    data: [
      { schemeId: iso3.id, seq: 1, location: 'R301入口法兰', medium: '氢气', pressure: '8.0MPa', temperature: '320℃', blindSpec: 'DN150', blindType: '插板', action: 'ADD', blindPlateId: createdPlates[5].id, done: false },
    ],
  })
  const gy3 = await db.disposalScheme.create({
    data: { workRequestId: r3.id, code: 'GY-202506-003', preparedBy: '张工', preparedAt: daysAgo(8), status: 'APPROVED', comment: '同意', reviewedBy: '李主任', reviewedAt: daysAgo(7) },
  })
  await db.disposalStep.createMany({
    data: [
      { schemeId: gy3.id, seq: 1, method: 'ISOLATE', detail: '关闭R301入口双阀并挂盲板隔离牌', standard: '双阀关闭到位', completed: true },
      { schemeId: gy3.id, seq: 2, method: 'REPLACE', detail: '氮气置换氢气至取样检测合格', standard: '氢含量<0.4%', completed: true },
      { schemeId: gy3.id, seq: 3, method: 'GAS_TEST', detail: '可燃气体复测', standard: 'LEL<0.5%', completed: true },
    ],
  })
  await db.disposalConfirmation.create({
    data: {
      workRequestId: r3.id, confirmer: '张工', confirmedAt: daysAgo(6), stepsConfirmed: true,
      flammableResult: 'LEL 0.0%', oxygenResult: '21.0%', toxicResult: '未检出',
      analysisQualified: true, result: 'QUALIFIED', remarks: '氮气置换合格，具备开票条件',
    },
  })

  // r4 隔离方案待审核
  const iso4 = await db.isolationScheme.create({
    data: { workRequestId: r4.id, code: 'GL-202506-004', preparedBy: '陈工', preparedAt: daysAgo(3), status: 'PENDING_REVIEW' },
  })
  await db.isolationPoint.createMany({
    data: [
      { schemeId: iso4.id, seq: 1, location: 'E401管程入口法兰', medium: '汽油', pressure: '1.0MPa', temperature: '120℃', blindSpec: 'DN250', blindType: '八字盲板', action: 'ADD', blindPlateId: createdPlates[6].id, done: false },
      { schemeId: iso4.id, seq: 2, location: 'E401壳程出口法兰', medium: '汽油', pressure: '1.0MPa', temperature: '90℃', blindSpec: 'DN150', blindType: '八字盲板', action: 'REMOVE', blindPlateId: createdPlates[7].id, done: false },
    ],
  })

  // r5 工艺处置方案待审核
  const iso5 = await db.isolationScheme.create({
    data: { workRequestId: r5.id, code: 'GL-202506-005', preparedBy: '张工', preparedAt: daysAgo(4), status: 'APPROVED', comment: '同意', reviewedBy: '李主任', reviewedAt: daysAgo(3) },
  })
  await db.isolationPoint.create({
    data: { schemeId: iso5.id, seq: 1, location: 'T302塔顶回流线法兰', medium: '酸性水', pressure: '0.4MPa', temperature: '80℃', blindSpec: 'DN100', blindType: '垫环', action: 'REMOVE', blindPlateId: createdPlates[8].id, done: false },
  })
  const gy5 = await db.disposalScheme.create({
    data: { workRequestId: r5.id, code: 'GY-202506-005', preparedBy: '张工', preparedAt: daysAgo(2), status: 'PENDING_REVIEW' },
  })
  await db.disposalStep.createMany({
    data: [
      { schemeId: gy5.id, seq: 1, method: 'DRAIN', detail: 'T302顶回流线低点排凝', standard: '无液体排出', completed: false },
      { schemeId: gy5.id, seq: 2, method: 'PURGE', detail: '氮气吹扫30分钟', standard: '出口无异味', completed: false },
      { schemeId: gy5.id, seq: 3, method: 'GAS_TEST', detail: '有毒气体(H2S)检测', standard: 'H2S<10ppm', completed: false },
    ],
  })

  // r10 待验收
  const iso10 = await db.isolationScheme.create({
    data: { workRequestId: r10.id, code: 'GL-202506-010', preparedBy: '张工', preparedAt: daysAgo(7), status: 'APPROVED', comment: '同意', reviewedBy: '李主任', reviewedAt: daysAgo(6) },
  })
  await db.isolationPoint.createMany({
    data: [
      { schemeId: iso10.id, seq: 1, location: 'E105管程入口', medium: '渣油', pressure: '2.1MPa', temperature: '260℃', blindSpec: 'DN200', blindType: '八字盲板', action: 'ADD', blindPlateId: createdPlates[9].id, done: true, doneAt: daysAgo(2), operator: '王班长' },
      { schemeId: iso10.id, seq: 2, location: 'E106壳程出口', medium: '渣油', pressure: '2.1MPa', temperature: '240℃', blindSpec: 'DN150', blindType: '插板', action: 'REMOVE', blindPlateId: createdPlates[10].id, done: true, doneAt: daysAgo(2), operator: '赵师傅' },
    ],
  })
  const gy10 = await db.disposalScheme.create({
    data: { workRequestId: r10.id, code: 'GY-202506-010', preparedBy: '张工', preparedAt: daysAgo(6), status: 'APPROVED', comment: '同意', reviewedBy: '李主任', reviewedAt: daysAgo(5) },
  })
  await db.disposalStep.createMany({
    data: [
      { schemeId: gy10.id, seq: 1, method: 'VENT', detail: 'E105/E106泄压', standard: '压力归零', completed: true },
      { schemeId: gy10.id, seq: 2, method: 'PURGE', detail: '蒸汽吹扫4小时', standard: '见白汽', completed: true },
      { schemeId: gy10.id, seq: 3, method: 'GAS_TEST', detail: '可燃气体检测', standard: 'LEL<0.5%', completed: true },
    ],
  })
  await db.disposalConfirmation.create({
    data: {
      workRequestId: r10.id, confirmer: '张工', confirmedAt: daysAgo(4), stepsConfirmed: true,
      flammableResult: 'LEL 0.1%', oxygenResult: '20.9%', toxicResult: '未检出',
      analysisQualified: true, result: 'QUALIFIED',
    },
  })
  const t10 = await db.workTicket.create({
    data: {
      code: 'BP-202506-010', workRequestId: r10.id, plannedStart: daysAgo(3, 8), plannedEnd: daysAgo(2, 17),
      guardian: '孙监护', workers: '王班长,赵师傅', issuer: '刘主任',
      safetyMeasures: '1.高温渣油管线防烫伤\n2.接油盘+防渗膜铺设\n3.可燃气体检测合格\n4.专人监护',
      status: 'FINISHED', approvedBy: '李主任', approvedAt: daysAgo(4), startedAt: daysAgo(3, 8, 30), finishedAt: daysAgo(2, 15),
    },
  })
  await db.workTask.create({
    data: {
      code: 'TSK-202506-010', workRequestId: r10.id, ticketId: t10.id, assignee: '王班长',
      planStart: daysAgo(3, 8), planEnd: daysAgo(2, 17), status: 'DONE', actualStart: daysAgo(3, 8, 30), actualEnd: daysAgo(2, 15),
    },
  })

  // r7 已勘察待JSA
  await db.siteSurvey.create({
    data: {
      workRequestId: r7.id, surveyor: '陈工', surveyDate: daysAgo(2),
      siteCondition: 'T501底部出料线位于框架二层，空间狭小，需局部搭设脚手架',
      pipelineVerify: '介质液化气、压力1.8MPa、常温，与需求一致',
      hazardPoints: '液化气残留；空间受限；动火交叉风险',
      isSafe: true, suggestion: '建议白天低负荷时段作业，加强通风检测',
    },
  })

  // 审批留痕
  await db.approvalRecord.createMany({
    data: [
      { bizType: 'ISOLATION', bizId: iso1.id, bizCode: iso1.code, action: 'APPROVE', operator: '李主任', comment: '隔离点设置合理，同意执行', createdAt: daysAgo(20) },
      { bizType: 'DISPOSAL', bizId: gy1.id, bizCode: gy1.code, action: 'APPROVE', operator: '李主任', comment: '处置步骤完整，同意', createdAt: daysAgo(19) },
      { bizType: 'ISOLATION', bizId: iso2.id, bizCode: iso2.code, action: 'APPROVE', operator: '李主任', comment: '同意，注意再生器高温风险', createdAt: daysAgo(14) },
      { bizType: 'TICKET', bizId: t1.id, bizCode: t1.code, action: 'APPROVE', operator: '李主任', comment: '同意，按票执行', createdAt: daysAgo(16) },
      { bizType: 'TICKET', bizId: t2.id, bizCode: t2.code, action: 'APPROVE', operator: '李主任', comment: '同意', createdAt: daysAgo(12) },
    ],
  })

  console.log('✅ 种子数据完成!')
  console.log(`   用户: 9 | 装置: ${units.length} | 盲板: ${createdPlates.length} | 需求: 10`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
