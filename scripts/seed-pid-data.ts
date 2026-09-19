/**
 * Task 19-a 种子数据：管线主数据 / 隔离点位主数据 / PID 组态图
 * 幂等：先清空本批三张新表（Pipeline / IsoPointMaster / PidDiagram），再重建；
 * 不触碰任何既有表（装置/需求/方案/盲板台账等）。
 * 运行：bun scripts/seed-pid-data.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // ① 清空本批主数据（仅三张新表，安全）
  await db.pidDiagram.deleteMany()
  await db.isoPointMaster.deleteMany()
  await db.pipeline.deleteMany()

  // ② 装置（复用库中既有装置，按名称取真实 unitId）
  const units = await db.unit.findMany()
  const unitByName = new Map(units.map((u) => [u.name, u.id]))
  const U = {
    catalytic: unitByName.get('催化裂化装置'),
    hydrogenation: unitByName.get('加氢精制装置'),
    reforming: unitByName.get('连续重整装置'),
    atmospheric: unitByName.get('常减压蒸馏装置'),
  }
  for (const [k, id] of Object.entries(U)) {
    if (id == null) throw new Error(`装置主数据缺失：${k}（请确认 Unit 表包含四大装置）`)
  }

  // ③ 管线主数据 6 条
  const pipelineSeeds = [
    {
      code: 'PL-E101-001', name: 'E101 原油进料管线', unitId: U.catalytic!,
      medium: '原油', spec: 'DN100', designPressure: '1.6MPa', designTemp: '350℃',
      fromTo: 'V101→E101', remark: '催化裂化原料油进料主线',
    },
    {
      code: 'PL-R201-001', name: 'R201 待生立管', unitId: U.catalytic!,
      medium: '烟气', spec: 'DN150', designPressure: '0.3MPa', designTemp: '600℃',
      fromTo: '沉降器→再生器', remark: '待生催化剂输送管线',
    },
    {
      code: 'PL-R301-001', name: 'R301 氢气进料线', unitId: U.hydrogenation!,
      medium: '氢气', spec: 'DN80', designPressure: '8.0MPa', designTemp: '300℃',
      fromTo: '循环氢压缩机→R301', remark: '加氢精制反应进料',
    },
    {
      code: 'PL-E401-001', name: 'E401 管程入口线', unitId: U.reforming!,
      medium: '石脑油', spec: 'DN100', designPressure: '1.0MPa', designTemp: '250℃',
      fromTo: '进料缓冲罐→E401', remark: '连续重整预加氢进料',
    },
    {
      code: 'PL-P101-001', name: 'P101 出口线', unitId: U.atmospheric!,
      medium: '原油', spec: 'DN200', designPressure: '2.5MPa', designTemp: '180℃',
      fromTo: 'P101→常压炉 F101', remark: '常减压原油输送主线',
    },
    {
      code: 'PL-C201-001', name: 'C201 塔顶回流线', unitId: U.catalytic!,
      medium: '汽油', spec: 'DN125', designPressure: '1.0MPa', designTemp: '120℃',
      fromTo: 'C201 塔顶→V202→C201', remark: '分馏塔顶回流',
    },
  ]
  const pipelines: Record<string, number> = {}
  for (const p of pipelineSeeds) {
    const row = await db.pipeline.create({ data: p })
    pipelines[row.code] = row.id
  }

  // ④ 隔离点位主数据 10 个（IP-E101-01 / IP-R201-01 / IP-R301-01 / IP-E401-01 的
  //    location 与既有业务隔离点文字对应，供实时状态 API 关联演示）
  const pointSeeds = [
    {
      code: 'IP-E101-01', name: 'E101 原油进料入口法兰', pipelineId: pipelines['PL-E101-001'], unitId: U.catalytic!,
      location: 'E101入口管线 DN100 法兰', spec: 'DN100', blindSpec: 'DN100', blindType: '八字盲板',
      remark: '与作业需求 WR-202609-001 隔离点对应',
    },
    {
      code: 'IP-E101-02', name: 'E101 导淋口', pipelineId: pipelines['PL-E101-001'], unitId: U.catalytic!,
      location: 'E101 入口管线导淋口', spec: 'DN50', blindSpec: 'DN50', blindType: '插板',
      remark: null,
    },
    {
      code: 'IP-R201-01', name: 'R201 待生线立管法兰', pipelineId: pipelines['PL-R201-001'], unitId: U.catalytic!,
      location: 'R201待生线立管法兰', spec: 'DN150', blindSpec: 'DN150', blindType: '八字盲板',
      remark: '与作业需求 WR-202506-002 隔离点对应',
    },
    {
      code: 'IP-R201-02', name: 'R201 溢流管根部法兰', pipelineId: pipelines['PL-R201-001'], unitId: U.catalytic!,
      location: 'R201溢流管根部法兰', spec: 'DN100', blindSpec: 'DN100', blindType: '8字盲板',
      remark: null,
    },
    {
      code: 'IP-R301-01', name: 'R301 入口法兰', pipelineId: pipelines['PL-R301-001'], unitId: U.hydrogenation!,
      location: '反应器R301入口法兰', spec: 'DN80', blindSpec: 'DN80', blindType: '八字盲板',
      remark: '与作业需求 WR-202506-003 隔离点对应',
    },
    {
      code: 'IP-R301-02', name: 'R301 冷氢线法兰', pipelineId: pipelines['PL-R301-001'], unitId: U.hydrogenation!,
      location: 'R301 冷氢线入口法兰', spec: 'DN50', blindSpec: 'DN50', blindType: '插板',
      remark: null,
    },
    {
      code: 'IP-E401-01', name: 'E401 管程入口', pipelineId: pipelines['PL-E401-001'], unitId: U.reforming!,
      location: 'E401管程入口', spec: 'DN100', blindSpec: 'DN100', blindType: '八字盲板',
      remark: '与作业需求 WR-202506-004 隔离点对应',
    },
    {
      code: 'IP-E401-02', name: 'E401 壳程出口', pipelineId: pipelines['PL-E401-001'], unitId: U.reforming!,
      location: 'E401壳程出口法兰', spec: 'DN100', blindSpec: 'DN100', blindType: '8字盲板',
      remark: null,
    },
    {
      code: 'IP-P101-01', name: 'P101 出口阀后法兰', pipelineId: pipelines['PL-P101-001'], unitId: U.atmospheric!,
      location: 'P101出口阀后法兰', spec: 'DN200', blindSpec: 'DN200', blindType: '8字盲板',
      remark: null,
    },
    {
      code: 'IP-C201-01', name: 'C201 塔顶回流线法兰', pipelineId: pipelines['PL-C201-001'], unitId: U.catalytic!,
      location: 'C201塔顶回流线法兰', spec: 'DN125', blindSpec: 'DN125', blindType: '八字盲板',
      remark: null,
    },
  ]
  const points: Record<string, number> = {}
  for (const p of pointSeeds) {
    const row = await db.isoPointMaster.create({ data: p })
    points[row.code] = row.id
  }

  // ⑤ PID 组态图 1 张：催化裂化反再系统（画布 1200×700）
  //    PidShape 契约：{ id, type, x, y, w?, h?, label?, points?[{x,y}], masterPointId? }
  const shapes = [
    // 图元：设备
    { id: 's1', type: 'tank', x: 60, y: 470, w: 150, h: 130, label: 'T101 原油罐' },
    { id: 's2', type: 'pump', x: 330, y: 500, w: 80, h: 70, label: 'P101' },
    { id: 's3', type: 'exchanger', x: 540, y: 430, w: 150, h: 100, label: 'E101 换热器' },
    { id: 's4', type: 'exchanger', x: 540, y: 280, w: 150, h: 90, label: 'E401 换热器' },
    { id: 's5', type: 'vessel', x: 200, y: 100, w: 140, h: 120, label: 'V101 分液罐' },
    { id: 's6', type: 'column', x: 920, y: 80, w: 170, h: 300, label: '再生器 R201' },
    // 图元：管线（折线 2-4 顶点）
    {
      id: 's7', type: 'pipe', x: 210, y: 535,
      points: [{ x: 210, y: 535 }, { x: 330, y: 535 }], label: '原油出罐',
    },
    {
      id: 's8', type: 'pipe', x: 410, y: 535,
      points: [{ x: 410, y: 535 }, { x: 470, y: 535 }, { x: 470, y: 480 }, { x: 540, y: 480 }],
      label: 'P101 出口',
    },
    {
      id: 's9', type: 'pipe', x: 690, y: 470,
      points: [{ x: 690, y: 470 }, { x: 760, y: 470 }, { x: 760, y: 240 }, { x: 920, y: 240 }],
      label: 'E101 原油进料',
    },
    {
      id: 's10', type: 'pipe', x: 340, y: 160,
      points: [{ x: 340, y: 160 }, { x: 615, y: 160 }, { x: 615, y: 280 }], label: 'V101 分液',
    },
    {
      id: 's11', type: 'pipe', x: 690, y: 320,
      points: [{ x: 690, y: 320 }, { x: 920, y: 320 }], label: 'E401 管程出口',
    },
    {
      id: 's12', type: 'pipe', x: 920, y: 120,
      points: [{ x: 920, y: 120 }, { x: 340, y: 120 }, { x: 340, y: 100 }], label: '再生烟气',
    },
    // 图元：阀门
    { id: 's13', type: 'valve', x: 250, y: 510, w: 50, h: 50, label: '切断阀' },
    { id: 's14', type: 'valve', x: 490, y: 455, w: 50, h: 50, label: '调节阀' },
    { id: 's15', type: 'valve', x: 735, y: 380, w: 50, h: 50, label: '待生滑阀' },
    // 图元：隔离点（绑定隔离点位主数据，实时状态 API 依据）
    {
      id: 's16', type: 'isoPoint', x: 470, y: 390, w: 60, h: 40,
      label: 'E101 原油进料入口法兰', masterPointId: points['IP-E101-01'],
    },
    {
      id: 's17', type: 'isoPoint', x: 850, y: 205, w: 60, h: 40,
      label: 'R201 待生线立管法兰', masterPointId: points['IP-R201-01'],
    },
    {
      id: 's18', type: 'isoPoint', x: 470, y: 245, w: 60, h: 40,
      label: 'E401 管程入口', masterPointId: points['IP-E401-01'],
    },
  ]
  const diagram = await db.pidDiagram.create({
    data: {
      name: '催化裂化反再系统 PID 示意',
      unitId: U.catalytic!,
      content: JSON.stringify(shapes),
    },
  })

  console.log('[seed-pid-data] 完成：')
  console.log(`  - Pipeline         ${pipelineSeeds.length} 条：${pipelineSeeds.map((p) => p.code).join(', ')}`)
  console.log(`  - IsoPointMaster   ${pointSeeds.length} 个：${pointSeeds.map((p) => p.code).join(', ')}`)
  console.log(`  - PidDiagram       1 张：「${diagram.name}」 id=${diagram.id}，图元 ${shapes.length} 个`)
  console.log(
    `  - 组态图隔离点绑定：IP-E101-01→${points['IP-E101-01']}，IP-R201-01→${points['IP-R201-01']}，IP-E401-01→${points['IP-E401-01']}`
  )
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error('[seed-pid-data] 失败：', e)
    await db.$disconnect()
    process.exit(1)
  })
