import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const wrs = await db.workRequest.findMany({ where: { OR: [{ title: { contains: '实验' } }, { location: { contains: '实验' } }] } })
  console.log(JSON.stringify(wrs.map(w => ({ id: w.id, code: w.code, title: w.title, unitId: w.unitId, pipelineId: w.pipelineId, pipelineName: w.pipelineName, location: w.location, medium: w.medium, reason: w.reason?.slice(0,80) })), null, 1))
  const p301 = await db.isoPointMaster.findFirst({ where: { code: 'IP-PL301-01' }, include: { pipeline: true } })
  console.log('IP-PL301-01:', JSON.stringify(p301 && { id: p301.id, code: p301.code, name: p301.name, pipelineId: p301.pipelineId, pipeline: p301.pipeline }, null, 1))
  await db.$disconnect()
}
main()
