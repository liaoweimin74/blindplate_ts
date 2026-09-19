import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const pipes = await db.pipeline.findMany({ where: { code: { in: ['PL-305', 'PL-301', 'PL-304'] } }, select: { id: true, code: true, name: true, unitId: true, startEquipmentId: true, endEquipmentId: true } })
  console.log('管线:', JSON.stringify(pipes))
  const eqT301 = await db.equipment.findUnique({ where: { id: 23 }, select: { id: true, code: true, name: true, unitId: true } })
  console.log('T-301:', JSON.stringify(eqT301))
  // 谁绑定了 T-301
  const bound = await db.pipeline.findMany({ where: { OR: [{ startEquipmentId: 23 }, { endEquipmentId: 23 }] }, select: { id: true, code: true, unitId: true, startEquipmentId: true, endEquipmentId: true } })
  console.log('绑定T-301的管线:', JSON.stringify(bound))
  // PL-305 上的点位
  const p305 = pipes.find(p => p.code === 'PL-305')
  if (p305) {
    const pts = await db.isoPointMaster.findMany({ where: { pipelineId: p305.id }, select: { id: true, code: true, name: true } })
    console.log('PL-305点位:', JSON.stringify(pts))
  }
  await db.$disconnect()
}
main()
