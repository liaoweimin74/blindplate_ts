// 盲板管理系统 API 全流程冒烟测试（针对运行中的 dev server，验证后可删除）
const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
const failures = []

function check(cond, msg) {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    failures.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

async function main() {
  // ===== 基础模块 =====
  console.log('\n== 基础模块 ==')
  let r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' })
  check(r.status === 200 && r.data.username === 'admin' && !('password' in r.data), '登录成功且不含密码')
  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })
  check(r.status === 401, '错误密码返回 401')
  r = await api('GET', '/api/users')
  check(r.status === 200 && Array.isArray(r.data) && r.data.length > 0 && !('password' in r.data[0]), '用户列表（无密码）')
  r = await api('GET', '/api/units')
  const units = r.data
  check(r.status === 200 && units.length > 0, `装置列表 ${units.length} 条`)
  r = await api('GET', '/api/dicts?category=BLIND_SPEC')
  check(r.status === 200 && r.data.length > 0 && r.data.every(d => d.category === 'BLIND_SPEC'), '字典按分类过滤')
  const specs = r.data.map(d => d.value)
  r = await api('GET', '/api/dicts')
  check(r.status === 200 && r.data.length > specs.length, '字典全量')

  // 用户 CRUD
  r = await api('POST', '/api/users', { username: 'smoke_tester', name: '冒烟测试员', role: 'OPERATOR' })
  check(r.status === 201 && r.data.id, '创建用户')
  const uid = r.data.id
  r = await api('POST', '/api/users', { username: 'smoke_tester', name: '重复', role: 'OPERATOR' })
  check(r.status === 409, '重复用户名返回 409')
  r = await api('PUT', `/api/users/${uid}`, { department: '设备科', phone: '13800000000' })
  check(r.status === 200 && r.data.department === '设备科', '更新用户')
  r = await api('DELETE', `/api/users/${uid}`)
  check(r.status === 200 && r.data.ok, '删除用户')

  // 装置 CRUD
  r = await api('POST', '/api/units', { code: 'SMOKE', name: '冒烟装置' })
  check(r.status === 201 && r.data.id, '创建装置')
  const smokeUnitId = r.data.id
  r = await api('PUT', `/api/units/${smokeUnitId}`, { manager: '张三' })
  check(r.status === 200 && r.data.manager === '张三', '更新装置')
  r = await api('DELETE', `/api/units/${smokeUnitId}`)
  check(r.status === 200, '删除装置')

  // ===== 盲板台账 =====
  console.log('\n== 盲板台账 ==')
  r = await api('GET', '/api/blind-plates?status=IN_STOCK')
  const inStockPlates = r.data
  check(r.status === 200 && inStockPlates.length > 0, `在库盲板 ${inStockPlates.length} 块`)
  r = await api('GET', '/api/blind-plates?keyword=' + encodeURIComponent(inStockPlates[0].code.slice(-4)))
  check(r.status === 200 && r.data.some(p => p.code === inStockPlates[0].code), 'keyword 模糊搜索盲板')
  r = await api('POST', '/api/blind-plates', { spec: 'DN80', type: '八字盲板', material: '304', thickness: 3, pressureRating: 'PN2.5', location: '一号库房A区' })
  check(r.status === 201 && r.data.code.startsWith('MB-DN80-'), `创建盲板 ${r.data.code}`)
  const newPlateId = r.data.id
  r = await api('GET', '/api/inventory')
  const invBefore = r.data.find(i => i.spec === 'DN80' && i.material === '304')
  check(r.status === 200 && invBefore && invBefore.quantity >= 1, '创建盲板后库存同步 +1')
  r = await api('POST', `/api/inventory/${invBefore.id}/adjust`, { delta: -1 })
  check(r.status === 200, '库存调整 -1')
  r = await api('POST', `/api/inventory/${invBefore.id}/adjust`, { delta: 1 })
  check(r.status === 200, '库存调整 +1')
  r = await api('POST', `/api/inventory/${invBefore.id}/adjust`, { delta: -999 })
  check(r.status === 400, '库存调整为负返回 400')
  r = await api('PUT', `/api/blind-plates/${newPlateId}`, { location: '二号库房B区' })
  check(r.status === 200 && r.data.location === '二号库房B区', '更新盲板')
  r = await api('GET', '/api/change-records?limit=5')
  check(r.status === 200 && Array.isArray(r.data) && r.data.length <= 5, '变动记录 limit=5')

  // ===== 作业需求全流程 =====
  console.log('\n== 作业需求全流程 ==')
  const unit = units[0]
  const applicant = (await api('GET', '/api/users')).data.find(u => u.role === 'ENGINEER') ?? (await api('GET', '/api/users')).data[0]
  r = await api('POST', '/api/work-requests', {
    title: '冒烟测试-反应釜出料管线加装盲板', workType: 'ADD', unitId: unit.id,
    location: 'E-101 出料管线法兰', pipelineName: '出料管线', medium: '粗汽油', pressure: '1.6MPa', temperature: '80℃',
    reason: '检修隔离', urgency: 'HIGH', plannedStart: '2026-01-10T08:00:00.000Z', plannedEnd: '2026-01-10T18:00:00.000Z',
    applicantId: applicant.id, applicantName: applicant.name,
  })
  check(r.status === 201 && /^WR-\d{6}-\d{3}$/.test(r.data.code), `创建需求 ${r.data.code || JSON.stringify(r.data)}`)
  const wrId = r.data.id
  const wrCode = r.data.code
  r = await api('GET', `/api/work-requests?keyword=${wrCode.slice(-3)}&unitId=${unit.id}`)
  check(r.status === 200 && r.data.some(x => x.id === wrId) && r.data.find(x => x.id === wrId).unit?.id === unit.id, '需求列表过滤+含unit')
  r = await api('POST', `/api/work-requests/${wrId}/submit`)
  check(r.status === 200 && r.data.status === 'PENDING_SURVEY', 'submit → PENDING_SURVEY')
  r = await api('POST', `/api/work-requests/${wrId}/submit`)
  check(r.status === 400, '重复 submit 返回 400')

  r = await api('POST', `/api/work-requests/${wrId}/survey`, {
    surveyor: applicant.name, surveyDate: new Date().toISOString(),
    siteCondition: '现场具备作业条件，管线内介质已切换', hazardPoints: '高处作业', isSafe: true, suggestion: '注意系挂安全带',
  })
  check(r.status === 200 && r.data.request.status === 'SURVEYED', '勘察 → SURVEYED')

  r = await api('POST', `/api/work-requests/${wrId}/jsa`, {
    leader: applicant.name, members: '李四,王五', analysisDate: new Date().toISOString(),
    riskLevel: 'MEDIUM', residualRisk: '残余中毒风险',
    steps: [
      { step: '办理作业票', hazard: '手续不全', measure: '逐项确认' },
      { step: '加装盲板', hazard: '物料喷溅', measure: '佩戴防护面罩' },
    ],
  })
  check(r.status === 200 && r.data.request.status === 'JSA_DONE' && r.data.jsa.steps.length === 2, 'JSA → JSA_DONE（2步骤）')
  r = await api('POST', `/api/work-requests/${wrId}/jsa`, {
    leader: applicant.name, analysisDate: new Date().toISOString(), riskLevel: 'LOW',
    steps: [{ step: '步骤一', hazard: '危害一', measure: '措施一' }],
  })
  check(r.status === 200 && r.data.jsa.steps.length === 1, 'JSA upsert 重建步骤')

  // 隔离方案
  r = await api('POST', '/api/isolation-schemes', {
    workRequestId: wrId, preparedBy: applicant.name,
    points: [{ location: 'E-101 出料法兰', medium: '粗汽油', pressure: '1.6MPa', blindSpec: 'DN80', blindType: '八字盲板', action: 'ADD' }],
  })
  check(r.status === 201 && /^GL-\d{6}-\d{3}$/.test(r.data.scheme.code) && r.data.request.status === 'ISOLATION_PREPARING', `隔离方案 ${r.data.scheme?.code || JSON.stringify(r.data)}`)
  const isoSchemeId = r.data.scheme.id
  r = await api('GET', `/api/isolation-schemes?workRequestId=${wrId}`)
  check(r.status === 200 && r.data.points?.length === 1, '查询隔离方案含 points')
  r = await api('PUT', `/api/isolation-schemes/${isoSchemeId}`, {
    preparedBy: applicant.name,
    points: [
      { location: 'E-101 出料法兰', medium: '粗汽油', blindSpec: 'DN80', blindType: '八字盲板', action: 'ADD' },
      { location: '备用口法兰', blindSpec: 'DN50', blindType: '插板', action: 'REMOVE' },
    ],
  })
  check(r.status === 200 && r.data.points.length === 2, '编辑方案替换 points（2点）')
  r = await api('POST', `/api/isolation-schemes/${isoSchemeId}/submit`)
  check(r.status === 200 && r.data.request.status === 'ISOLATION_PENDING_REVIEW', '方案提交 → ISOLATION_PENDING_REVIEW')
  r = await api('POST', `/api/isolation-schemes/${isoSchemeId}/review`, { approve: false, comment: '盲板规格需复核', reviewer: '安全总监' })
  check(r.status === 200 && r.data.request.status === 'ISOLATION_REJECTED', '驳回 → ISOLATION_REJECTED')
  r = await api('PUT', `/api/isolation-schemes/${isoSchemeId}`, {
    preparedBy: applicant.name,
    points: [
      { location: 'E-101 出料法兰', medium: '粗汽油', blindSpec: 'DN80', blindType: '八字盲板', action: 'ADD' },
      { location: '备用口法兰', blindSpec: 'DN50', blindType: '插板', action: 'REMOVE' },
    ],
  })
  check(r.status === 200 && r.data.points.length === 2, '驳回后可编辑（保留 ADD+REMOVE 两点）')
  // points 整体替换后 id 全部重建，需重新获取
  r = await api('GET', `/api/isolation-schemes?workRequestId=${wrId}`)
  const addPointId = r.data.points.find(p => p.action === 'ADD').id
  const removePointId = r.data.points.find(p => p.action === 'REMOVE').id
  r = await api('POST', `/api/isolation-schemes/${isoSchemeId}/submit`)
  check(r.status === 200, '重新提交')
  r = await api('POST', `/api/isolation-schemes/${isoSchemeId}/review`, { approve: true, comment: '同意', reviewer: '安全总监' })
  check(r.status === 200 && r.data.request.status === 'DISPOSAL_PREPARING', '批准 → DISPOSAL_PREPARING')

  // 处置方案
  r = await api('POST', '/api/disposal-schemes', {
    workRequestId: wrId, preparedBy: applicant.name,
    steps: [
      { method: 'DRAIN', detail: '排净管线存料', standard: '无残液' },
      { method: 'PURGE', detail: '氮气吹扫置换', standard: '可燃气体低于LEL 10%' },
    ],
  })
  check(r.status === 201 && /^GY-\d{6}-\d{3}$/.test(r.data.scheme.code) && r.data.request.status === 'DISPOSAL_PREPARING', `处置方案 ${r.data.scheme?.code || JSON.stringify(r.data)}`)
  const disSchemeId = r.data.scheme.id
  r = await api('POST', `/api/disposal-schemes/${disSchemeId}/submit`)
  check(r.status === 200 && r.data.request.status === 'DISPOSAL_PENDING_REVIEW', '处置方案提交')
  r = await api('POST', `/api/disposal-schemes/${disSchemeId}/review`, { approve: true, comment: '同意', reviewer: '工艺主管' })
  check(r.status === 200 && r.data.request.status === 'PENDING_CONFIRM', '处置批准 → PENDING_CONFIRM')

  // 处置确认
  r = await api('POST', '/api/disposal-confirmations', {
    workRequestId: wrId, confirmer: '工艺工程师甲', stepsConfirmed: true,
    flammableResult: '0.5%LEL', oxygenResult: '20.9%', toxicResult: '未检出', analysisQualified: true,
    remarks: '', result: 'UNQUALIFIED',
  })
  check(r.status === 400, '不合格确认返回 400')
  r = await api('GET', `/api/work-requests/${wrId}`)
  check(r.status === 200 && r.data.status === 'PENDING_CONFIRM', '不合格后需求保持 PENDING_CONFIRM')
  r = await api('POST', '/api/disposal-confirmations', {
    workRequestId: wrId, confirmer: '工艺工程师甲', stepsConfirmed: true,
    flammableResult: '0%LEL', oxygenResult: '20.9%', toxicResult: '未检出', analysisQualified: true,
    remarks: '复测合格', result: 'QUALIFIED',
  })
  check(r.status === 201 && r.data.request.status === 'CONFIRMED', '合格确认 → CONFIRMED')

  // 作业票
  r = await api('POST', '/api/work-tickets', {
    workRequestId: wrId, plannedStart: '2026-01-10T08:00:00.000Z', plannedEnd: '2026-01-10T18:00:00.000Z',
    guardian: '监护员甲', workers: '操作工乙,操作工丙', issuer: '车间主任', safetyMeasures: '1.佩戴防护用具\n2.设置警戒区',
  })
  check(r.status === 201 && /^BP-\d{6}-\d{3}$/.test(r.data.ticket.code) && /^TSK-\d{6}-\d{3}$/.test(r.data.task.code) && r.data.request.status === 'TICKET_ISSUED', `开票 ${r.data.ticket?.code} + 任务 ${r.data.task?.code}`)
  const ticketId = r.data.ticket.id
  r = await api('PUT', `/api/work-tickets/${ticketId}`, { safetyMeasures: '1.佩戴防护用具\n2.设置警戒区\n3.专人监护' })
  check(r.status === 200 && r.data.safetyMeasures.includes('专人监护'), '编辑作业票（DRAFT）')
  r = await api('POST', `/api/work-tickets/${ticketId}/issue`, { issuer: '车间主任' })
  check(r.status === 200 && r.data.status === 'PENDING_REVIEW', '签发 → PENDING_REVIEW')
  r = await api('POST', `/api/work-tickets/${ticketId}/review`, { approve: true, comment: '同意', reviewer: '安全科长' })
  check(r.status === 200 && r.data.request.status === 'TICKET_APPROVED', '票批准 → TICKET_APPROVED')

  // 预留盲板
  const freePlate = (await api('GET', '/api/blind-plates?status=IN_STOCK&spec=DN80')).data.find(p => p.id !== newPlateId)
  r = await api('POST', `/api/isolation-points/${addPointId}/reserve`, { blindPlateId: freePlate.id, operator: '库管员' })
  check(r.status === 200 && r.data.blindPlate.status === 'RESERVED' && r.data.blindPlate.location === '已预留待领用', '预留盲板 → RESERVED')
  r = await api('GET', '/api/change-records?limit=3')
  check(r.status === 200 && r.data[0].action === 'RESERVE' && r.data[0].workCode !== null, 'RESERVE 变动记录含方案编号')

  // 开始作业
  r = await api('POST', `/api/work-tickets/${ticketId}/start`)
  check(r.status === 200 && r.data.ticket.status === 'IN_PROGRESS' && r.data.request.status === 'IN_PROGRESS' && r.data.task.status === 'IN_PROGRESS', 'start → IN_PROGRESS（票/需求/任务）')

  // 执行隔离点
  r = await api('POST', `/api/isolation-points/${addPointId}/execute`, { operator: '操作工乙' })
  check(r.status === 200 && r.data.point.done && r.data.blindPlate.status === 'INSTALLED' && r.data.blindPlate.unitId === unit.id, '执行 ADD 点 → 盲板 INSTALLED')
  r = await api('POST', `/api/isolation-points/${addPointId}/execute`, { operator: '操作工乙' })
  check(r.status === 400, '重复执行返回 400')
  // REMOVE 点未预留（拆已装盲板），执行时传入 blindPlateId 绑定
  r = await api('POST', `/api/isolation-points/${removePointId}/execute`, { operator: '操作工丙', blindPlateId: newPlateId })
  check(r.status === 200 && r.data.blindPlate.status === 'IN_STOCK' && r.data.blindPlate.location === '盲板库', '执行 REMOVE 点 → 盲板回库 IN_STOCK')
  r = await api('GET', '/api/change-records?limit=5')
  const actions = r.data.map(c => c.action)
  check(actions.includes('INSTALL') && actions.includes('REMOVE'), 'INSTALL/REMOVE 变动记录')

  // 完工/验收
  r = await api('POST', `/api/work-tickets/${ticketId}/finish`)
  check(r.status === 200 && r.data.ticket.status === 'FINISHED' && r.data.task.status === 'DONE' && r.data.request.status === 'PENDING_ACCEPTANCE', 'finish → FINISHED/任务DONE/需求PENDING_ACCEPTANCE')
  r = await api('POST', '/api/acceptances', { workRequestId: wrId, acceptor: '验收员', leakCheck: true, restoreCheck: false, ledgerCheck: true, problems: '现场标识未恢复' })
  check(r.status === 201 && r.data.acceptance.conclusion === 'RECTIFY' && r.data.request.status === 'PENDING_ACCEPTANCE', '验收不通过 → RECTIFY')
  r = await api('POST', '/api/acceptances', { workRequestId: wrId, acceptor: '验收员', leakCheck: true, restoreCheck: true, ledgerCheck: true, remarks: '整改完成复验通过' })
  check(r.status === 201 && r.data.acceptance.conclusion === 'PASS' && r.data.request.status === 'COMPLETED', '验收通过 → COMPLETED')
  r = await api('POST', `/api/work-tickets/${ticketId}/close`)
  check(r.status === 200 && r.data.ticket.status === 'CLOSED' && r.data.request.status === 'COMPLETED', 'close → CLOSED/COMPLETED')
  r = await api('POST', `/api/work-requests/${wrId}/cancel`)
  check(r.status === 400, '终态取消返回 400')

  // 详情与统计
  r = await api('GET', `/api/work-requests/${wrId}`)
  const d = r.data
  check(
    r.status === 200 && d.unit && d.survey && d.jsa?.steps?.length >= 1 && d.isolationScheme?.points?.length >= 1 &&
    d.disposalScheme?.steps?.length >= 1 && d.disposalConfirmation && d.ticket && d.task && d.acceptance &&
    Array.isArray(d.approvals) && d.approvals.length >= 6 &&
    d.approvals.every((a, i) => i === 0 || new Date(d.approvals[i-1].createdAt) >= new Date(a.createdAt)),
    `需求详情全量组装（approvals ${d.approvals?.length ?? 0} 条，倒序）`
  )
  r = await api('GET', '/api/work-tasks?assignee=操作工乙')
  check(r.status === 200 && r.data.some(t => t.ticketId === ticketId) && r.data.find(t => t.ticketId === ticketId)?.ticket?.code && r.data.find(t => t.ticketId === ticketId)?.workRequest?.code, '任务列表过滤+关联票/需求')
  r = await api('GET', '/api/work-tasks?status=DONE')
  check(r.status === 200 && r.data.every(t => t.status === 'DONE'), '任务状态过滤')
  r = await api('GET', '/api/work-tickets?workRequestId=' + wrId)
  check(r.status === 200 && r.data.length === 1 && r.data[0].workRequest?.id === wrId, '作业票按需求查询')
  r = await api('GET', '/api/acceptances?workRequestId=' + wrId)
  check(r.status === 200 && r.data?.conclusion === 'PASS', '验收记录查询')
  r = await api('GET', '/api/stats/overview')
  check(
    r.status === 200 && Array.isArray(r.data.statusCount) && Array.isArray(r.data.plateStatus) &&
    Array.isArray(r.data.unitRanking) && r.data.monthly?.length === 6 && Array.isArray(r.data.inventoryAlerts) &&
    typeof r.data.todoCount?.pendingSurvey === 'number',
    `统计总览（月度 ${r.data.monthly?.map(m => m.month).join(',')}）`
  )
  console.log('  stats todoCount:', JSON.stringify(r.data.todoCount))

  console.log(`\n测试数据：需求 ${wrCode}(id=${wrId})、盲板 id=${newPlateId}、票 id=${ticketId}`)
  console.log(`\n===== 结果: ${passed} 通过, ${failed} 失败 =====`)
  if (failures.length) {
    console.log('失败项:')
    failures.forEach(f => console.log('  ✗ ' + f))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e)
  process.exit(1)
})
