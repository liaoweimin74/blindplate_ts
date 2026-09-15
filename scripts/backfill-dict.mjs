/**
 * Task 95：字典实际值补录（幂等，可重复执行）
 * 扫描业务表实际使用的值 → 不在字典中的回填插入；清理测试脏值 TEST-M（若未被业务引用）
 * 用法：bunx tsx scripts/backfill-dict.mjs
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const isBlank = (v) => v == null || String(v).trim() === ''
const plainDn = (v) => /^DN\d+$/i.test(String(v).trim())

const sources = {
  MEDIUM: [() => db.pipeline.findMany({ select: { medium: true }, distinct: ['medium'] }).then(rs => rs.map(r => r.medium)),
           () => db.isolationPoint.findMany({ select: { medium: true }, distinct: ['medium'] }).then(rs => rs.map(r => r.medium))],
  PRESSURE: [() => db.pipeline.findMany({ select: { pressure: true }, distinct: ['pressure'] }).then(rs => rs.map(r => r.pressure)),
             () => db.isolationPoint.findMany({ select: { pressure: true }, distinct: ['pressure'] }).then(rs => rs.map(r => r.pressure))],
  MATERIAL: [() => db.pipeline.findMany({ select: { material: true }, distinct: ['material'] }).then(rs => rs.map(r => r.material)),
             () => db.blindPlate.findMany({ select: { material: true }, distinct: ['material'] }).then(rs => rs.map(r => r.material))],
  BLIND_SPEC: [() => db.isolationPoint.findMany({ select: { blindSpec: true }, distinct: ['blindSpec'] }).then(rs => rs.map(r => r.blindSpec)),
               () => db.blindPlate.findMany({ select: { spec: true }, distinct: ['spec'] }).then(rs => rs.map(r => r.spec)),
               () => db.pipeline.findMany({ select: { spec: true }, distinct: ['spec'] }).then(rs => rs.map(r => r.spec).filter(plainDn))],
  BLIND_TYPE: [() => db.isolationPoint.findMany({ select: { blindType: true }, distinct: ['blindType'] }).then(rs => rs.map(r => r.blindType)),
               () => db.blindPlate.findMany({ select: { type: true }, distinct: ['type'] }).then(rs => rs.map(r => r.type))],
}

const added = []
let removedTest = 0
for (const [category, fns] of Object.entries(sources)) {
  const existing = new Set((await db.dict.findMany({ where: { category } })).map(d => d.value))
  const maxOrder = (await db.dict.findMany({ where: { category }, orderBy: { order: 'desc' }, take: 1 }))[0]?.order ?? 0
  let order = maxOrder
  const candidates = new Set()
  for (const fn of fns) {
    for (const v of await fn()) {
      if (isBlank(v)) continue
      const s = String(v).trim()
      if (s.length > 24 || /^TEST/i.test(s)) continue // 跳过超长与测试值
      if (/^[-—_]+$/.test(s) || s === '未知' || s === '无') continue // 跳过占位/脏值
      if (category === 'PRESSURE' && /^\d+\.\d+0MPa$/.test(s)) continue // 跳过尾零变体（0.30MPa→0.3MPa）
      candidates.add(s)
    }
  }
  for (const value of [...candidates].sort()) {
    if (existing.has(value)) continue
    order += 1
    await db.dict.create({ data: { category, value, label: value, order } })
    added.push(`${category}:${value}`)
  }
}

// 清理测试脏值（未被业务引用才删）
const usedTest = await db.pipeline.count({ where: { medium: 'TEST-M' } }) + await db.isolationPoint.count({ where: { medium: 'TEST-M' } })
if (!usedTest) {
  const r = await db.dict.deleteMany({ where: { value: 'TEST-M' } })
  removedTest = r.count
} else {
  console.log('TEST-M 仍被业务引用，保留')
}

console.log(`补录 ${added.length} 项:`, added.join(', ') || '（无）')
console.log(`清理 TEST-M 字典项: ${removedTest} 条`)
await db.$disconnect()
