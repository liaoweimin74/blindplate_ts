import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num } from '@/lib/bp-server-utils'
import {
  collectRequestPipelineIds,
  findPipelineTicketConflicts,
} from '@/lib/bp-pipeline-occupancy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pipeline-occupancy?workRequestId=N
 *          → 该需求涉及管线的「生效作业票」占用情况（排除自身，供详情页/开票对话框警示）
 * GET /api/pipeline-occupancy?pipelineId=N[&excludeRequestId=N]
 *          → 单条管线的占用情况（供方案编辑等场景按管线即时查询）
 * 响应：{ pipelineIds: number[], conflicts: PipelineTicketConflict[], pipelines }
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const wid = num(sp.get('workRequestId') ?? '')
    const pid = num(sp.get('pipelineId') ?? '')
    const excludeRaw = sp.get('excludeRequestId')
    const excludeId = excludeRaw !== null ? num(excludeRaw) : null

    let pipelineIds: number[] = []
    if (wid !== null) {
      pipelineIds = await collectRequestPipelineIds(wid)
    } else if (pid !== null) {
      pipelineIds = [pid]
    } else {
      return jsonError('缺少 workRequestId 或 pipelineId 参数')
    }

    const conflicts = await findPipelineTicketConflicts(
      pipelineIds,
      excludeId ?? (wid !== null ? wid : undefined)
    )
    // 无冲突时附带管线标签（前端可展示「涉及管线」）；有冲突时冲突行内已含管线信息
    const pipelines =
      pipelineIds.length && !conflicts.length
        ? await db.pipeline.findMany({
            where: { id: { in: pipelineIds } },
            select: { id: true, code: true, name: true },
          })
        : []
    return NextResponse.json({
      pipelineIds,
      conflicts,
      pipelines,
    })
  } catch (e) {
    console.error('[GET /api/pipeline-occupancy]', e)
    return jsonError(e instanceof Error ? e.message : '查询管线占用失败', 500)
  }
}
