// 盲板管理系统 - 管线主数据/隔离点主数据/PID 组态 演示数据脚本（Task 23-a）
// 独立于 prisma/seed.ts 运行；幂等设计，可重复执行：
//   cd /home/z/my-project && bun prisma/seed-pid.ts
// - Pipeline 按 code upsert
// - IsoPointMaster 按 code upsert（并为存量业务隔离点回填 code/name/masterPointId/masterCode）
// - PidDiagram 按 name upsert（存在则更新 content/unitId）
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/** 管线主数据演示（覆盖业务隔离点涉及的原油/汽油/柴油/渣油/油气/氢气/酸性水介质） */
const PIPELINES = [
  { code: 'PL-101', name: '常压原油线', unitCode: 'CY-01', medium: '原油', pressure: '1.0MPa', material: '20#', spec: 'DN400', remark: '常压塔进料/原油换热网络' },
  { code: 'PL-102', name: '常压塔顶汽油线', unitCode: 'CY-01', medium: '汽油', pressure: '0.30MPa', material: '20#', spec: 'DN250', remark: '常压塔顶馏出线' },
  { code: 'PL-103', name: '常压柴油汽提线', unitCode: 'CY-01', medium: '柴油', pressure: '1.20MPa', material: '20#', spec: 'DN150', remark: '柴油汽提塔底泵出口线' },
  { code: 'PL-118', name: '减粘渣油线', unitCode: 'CY-01', medium: '渣油', pressure: '1.60MPa', material: 'Cr5Mo', spec: 'DN200', remark: '减粘裂化渣油换热网络' },
  { code: 'PL-201', name: '催化反再油气线', unitCode: 'CH-02', medium: '油气/干气', pressure: '0.25MPa', material: 'Q345R', spec: 'DN500', remark: '反应器-再生器系统油气干线' },
  { code: 'PL-302', name: '酸性水汽提塔顶回流线', unitCode: 'JQ-03', medium: '酸性水/酸性气', pressure: '0.20MPa', material: '20#', spec: 'DN80', remark: '酸性水汽提塔顶回流管线' },
  { code: 'PL-305', name: '加氢裂化循环氢线', unitCode: 'JQ-03', medium: '氢气', pressure: '12.0MPa', material: 'TP316', spec: 'DN150', remark: '循环氢压缩机-反应器回路' },
  { code: 'PL-401', name: '重整汽油出装置线', unitCode: 'CZ-04', medium: '汽油', pressure: '1.60MPa', material: '20#', spec: 'DN150', remark: '重整生成油出装置线' },
] as const

/** 存量业务隔离点 → 隔离点主数据 编码映射（按 location 精确匹配回填） */
const POINT_SEEDS = [
  { location: 'E101入口法兰(管廊三层)', code: 'IP-E101-01', name: 'E101入口法兰', pipelineCode: 'PL-101' },
  { location: 'E101出口跨线法兰', code: 'IP-E101-02', name: 'E101出口跨线', pipelineCode: 'PL-101' },
  { location: 'R201待生线立管法兰', code: 'IP-R201-01', name: 'R201待生线立管', pipelineCode: 'PL-201' },
  { location: 'R201溢流管根部法兰', code: 'IP-R201-02', name: 'R201溢流管根部', pipelineCode: 'PL-201' },
  { location: '待生滑阀后法兰', code: 'IP-R201-03', name: '待生滑阀后', pipelineCode: 'PL-201' },
  { location: 'R301入口法兰', code: 'IP-R301-01', name: 'R301入口', pipelineCode: 'PL-305' },
  { location: 'E401管程入口法兰', code: 'IP-E401-01', name: 'E401管程入口', pipelineCode: 'PL-401' },
  { location: 'E401壳程出口法兰', code: 'IP-E401-02', name: 'E401壳程出口', pipelineCode: 'PL-401' },
  { location: 'T302塔顶回流线法兰', code: 'IP-T302-01', name: 'T302塔顶回流线', pipelineCode: 'PL-302' },
  { location: 'E105管程入口', code: 'IP-E105-01', name: 'E105管程入口', pipelineCode: 'PL-118' },
  { location: 'E106壳程出口', code: 'IP-E106-01', name: 'E106壳程出口', pipelineCode: 'PL-118' },
  { location: 'P102出口阀后法兰', code: 'IP-P102-01', name: 'P102出口阀后', pipelineCode: 'PL-103' },
] as const

/** 演示 PID 组态图（催化裂化反再系统） */
const PID_NAME = '催化裂化反再系统 PID 示意'
const PID_CONTENT = {
  shapes: [
    { id: 's1', type: 'reactor', x: 120, y: 140, w: 110, h: 180, label: 'R201 反应器' },
    { id: 's2', type: 'exchanger', x: 420, y: 150, w: 130, h: 90, label: 'E101 换热器' },
    { id: 's3', type: 'column', x: 700, y: 110, w: 95, h: 220, label: 'T201 塔器' },
    { id: 's4', type: 'pump', x: 430, y: 420, w: 80, h: 70, label: 'P101 泵' },
    { id: 's5', type: 'tank', x: 720, y: 400, w: 120, h: 100, label: 'V102 回流罐' },
  ],
  connections: [
    { id: 'c1', fromShape: 's1', fromAnchor: 'right', toShape: 's2', toAnchor: 'left' },
    { id: 'c2', fromShape: 's2', fromAnchor: 'right', toShape: 's3', toAnchor: 'left' },
    { id: 'c3', fromShape: 's4', fromAnchor: 'top', toShape: 's2', toAnchor: 'bottom' },
    { id: 'c4', fromShape: 's3', fromAnchor: 'bottom', toShape: 's5', toAnchor: 'top' },
  ],
  marks: [
    { id: 'm1', code: 'IP-E101-01', name: 'E101 循环水入口', x: 360, y: 120 },
    { id: 'm2', code: 'IP-R201-01', name: 'R201 底部出料', x: 130, y: 340 },
  ],
}

async function main() {
  console.log('== seed-pid 开始 ==')

  // 1. 管线主数据（upsert by code）
  const pipelineMap = new Map<string, number>()
  for (const p of PIPELINES) {
    const unit = await db.unit.findUnique({ where: { code: p.unitCode } })
    if (!unit) throw new Error(`演示管线 ${p.code} 关联的装置 ${p.unitCode} 不存在，请先执行 prisma/seed.ts`)
    const row = await db.pipeline.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, unitId: unit.id, medium: p.medium, pressure: p.pressure, material: p.material, spec: p.spec, remark: p.remark },
      update: { name: p.name, unitId: unit.id, medium: p.medium, pressure: p.pressure, material: p.material, spec: p.spec, remark: p.remark },
    })
    pipelineMap.set(row.code, row.id)
  }
  console.log(`Pipeline: ${pipelineMap.size} 条（upsert by code）`)

  // 2. 隔离点主数据（为存量业务隔离点每个 distinct code 建立；upsert by code，幂等）
  const masterMap = new Map<string, number>()
  for (const s of POINT_SEEDS) {
    const pipelineId = pipelineMap.get(s.pipelineCode) ?? null
    const row = await db.isoPointMaster.upsert({
      where: { code: s.code },
      create: { code: s.code, name: s.name, pipelineId, location: s.location, remark: '由业务隔离点回填生成（seed-pid）' },
      update: { name: s.name, pipelineId, location: s.location },
    })
    masterMap.set(row.code, row.id)
  }
  console.log(`IsoPointMaster: ${masterMap.size} 条（upsert by code）`)

  // 3. 存量业务隔离点回填 code/name/masterPointId/masterCode（仅写入缺失/不一致的行，幂等）
  const points = await db.isolationPoint.findMany({ select: { id: true, location: true, code: true, name: true, masterPointId: true, masterCode: true } })
  let backfilled = 0
  for (const pt of points) {
    const seed = POINT_SEEDS.find((s) => s.location === pt.location)
    if (!seed) continue // 非演示范围内的点位跳过（新点位由方案编制端选择主数据写入 masterCode）
    const masterId = masterMap.get(seed.code) ?? null
    if (pt.code === seed.code && pt.name === seed.name && pt.masterPointId === masterId && pt.masterCode === seed.code) continue
    await db.isolationPoint.update({
      where: { id: pt.id },
      data: { code: seed.code, name: seed.name, masterPointId: masterId, masterCode: seed.code },
    })
    backfilled++
  }
  console.log(`IsolationPoint 回填: ${backfilled} 行（共 ${points.length} 行）`)

  // 4. 演示 PID 组态图（按 name upsert；mark 命中主数据时补充 masterPointId）
  const marks = PID_CONTENT.marks.map((m) => {
    const masterId = masterMap.get(m.code)
    return masterId ? { ...m, masterPointId: masterId } : m
  })
  const contentJson = JSON.stringify({ shapes: PID_CONTENT.shapes, connections: PID_CONTENT.connections, marks }, null, 2)
  const unit = await db.unit.findUnique({ where: { code: 'CH-02' } })
  const existing = await db.pidDiagram.findFirst({ where: { name: PID_NAME } })
  if (existing) {
    await db.pidDiagram.update({ where: { id: existing.id }, data: { content: contentJson, unitId: unit?.id ?? null } })
    console.log(`PidDiagram: 更新「${PID_NAME}」(id=${existing.id})`)
  } else {
    const created = await db.pidDiagram.create({
      data: { name: PID_NAME, unitId: unit?.id ?? null, content: contentJson, createdBy: '系统管理员' },
    })
    console.log(`PidDiagram: 创建「${PID_NAME}」(id=${created.id})`)
  }

  console.log('== seed-pid 完成 ==')
}

main()
  .catch((e) => {
    console.error('[seed-pid] 失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
