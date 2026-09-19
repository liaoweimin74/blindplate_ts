import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const eqs = await db.equipment.findMany({ where: { OR: [{ name: { contains: '分馏' } }, { code: { contains: '301' } }] }, select: { id: true, code: true, name: true, unitId: true } })
  console.log('相关设备:', JSON.stringify(eqs))
  const pipes = await db.pipeline.findMany({ where: { unitId: 10 }, select: { id: true, code: true, name: true, startEquipmentId: true, endEquipmentId: true } })
  console.log('unit10管线绑定:', JSON.stringify(pipes))
  const pts = await db.isoPointMaster.findMany({ where: { pipeline: { unitId: 10 } }, select: { id: true, code: true, name: true, pipelineId: true }, orderBy: { pipelineId: 'asc' } })
  console.log('unit10点位:', JSON.stringify(pts))
  await db.$disconnect()
}
main()
