import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const pts = await db.isolationPoint.findMany({ where: { OR: [{ code: { contains: 'E105' } }, { masterCode: { contains: 'E105' } }] }, select: { id: true, code: true, name: true, action: true, done: true, doneAt: true, operator: true, blindPlateId: true, schemeId: true, seq: true } })
console.log('== IsolationPoint E105* ==', JSON.stringify(pts, null, 1))
const masters = await db.isoPointMaster.findMany({ where: { code: { contains: 'E105' } }, select: { id: true, code: true, name: true, status: true, kind: true, currentBlind: true } }).catch(e => console.log('isoPointMaster err', e.message))
console.log('== IsoPointMaster ==', JSON.stringify(masters, null, 1))
const plates = await db.blindPlate.findMany({ where: { code: { contains: 'E105' } } })
console.log('== BlindPlate E105 ==', JSON.stringify(plates, null, 1))
await db.$disconnect()
