import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const wrs = await db.workRequest.findMany({ select: { id: true, code: true, title: true, unitId: true, pipelineId: true, location: true }, take: 30 })
  console.log(JSON.stringify(wrs, null, 0).replace(/},/g, '},\n'))
  await db.$disconnect()
}
main()
