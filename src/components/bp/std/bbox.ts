// ============ PID 内建图元——符号内容真实边界表（Task 65 自动生成，勿手改单条） ============
// 由 agent-browser getBBox 实测 126 符号渲染内容边界（排除 text 标注，clamp 到设计空间内），
// 坐标为各符号设计空间 (0,0)-(sw,sh) 内的值。用途：连线锚点按内容边界（而非设计空间包围盒）计算，
// 消除符号留白导致的「连线端点悬空在空白处」。缺失符号回退设计空间全框（stdContentBoxOf）。
export interface StdBBox { x: number; y: number; w: number; h: number; sw: number; sh: number }

export const STD_SYMBOL_BBOX: Record<string, StdBBox> = {
  'el-dcp': { x: 8, y: 10, w: 40, h: 24, sw: 56, sh: 44 }, // 干粉灭火
  'el-ex-mark': { x: 9, y: 12, w: 34, h: 34, sw: 52, sh: 56 }, // 防爆等级
  'el-eyewash': { x: 10, y: 4, w: 36, h: 54, sw: 56, sh: 64 }, // 洗眼器
  'el-flame-det': { x: 10, y: 8, w: 36, h: 38, sw: 56, sh: 56 }, // 火焰检测器
  'el-foam': { x: 8, y: 10, w: 40, h: 24, sw: 56, sh: 44 }, // 泡沫灭火
  'el-gas-det': { x: 10, y: 8.5, w: 36, h: 35.5, sw: 56, sh: 56 }, // 可燃气体检测器
  'el-ground': { x: 8, y: 4, w: 24, h: 32, sw: 40, sh: 44 }, // 接地
  'el-heater': { x: 8, y: 10, w: 40, h: 30, sw: 56, sh: 44 }, // 电加热器
  'el-hydrant': { x: 12, y: 14, w: 32, h: 34, sw: 56, sh: 56 }, // 消火栓
  'el-ip-mark': { x: 8, y: 8, w: 40, h: 24, sw: 56, sh: 40 }, // 防护等级
  'el-mcc': { x: 6, y: 8, w: 44, h: 30, sw: 56, sh: 40 }, // MCC 控制中心
  'el-motor': { x: 10, y: 9, w: 35, h: 33, sw: 48, sh: 48 }, // 电机
  'el-ups': { x: 6, y: 8, w: 44, h: 30, sw: 56, sh: 40 }, // UPS 电源
  'el-vfd': { x: 8, y: 8, w: 40, h: 32, sw: 56, sh: 44 }, // 变频器
  'el-warning': { x: 5, y: 7, w: 38, h: 32, sw: 48, sh: 48 }, // 安全警示
  'eq-3phase-sep': { x: 2, y: 8, w: 86, h: 46, sw: 92, sh: 60 }, // 三相分离器
  'eq-airfin': { x: 8, y: 7, w: 72, h: 51, sw: 88, sh: 64 }, // 空冷器
  'eq-belt-conveyor': { x: 8, y: 20.6, w: 80, h: 31.4, sw: 96, sh: 56 }, // 皮带输送机
  'eq-bhe': { x: 8, y: 6, w: 80, h: 41, sw: 96, sh: 48 }, // 管壳式换热器
  'eq-blower': { x: 15, y: 2, w: 31, h: 48, sw: 60, sh: 56 }, // 鼓风机
  'eq-bucket-lift': { x: 16, y: 9, w: 40, h: 70, sw: 64, sh: 88 }, // 斗式提升机
  'eq-buffer-drum': { x: 16, y: 3, w: 32, h: 61, sw: 56, sh: 72 }, // 缓冲罐
  'eq-centrifuge': { x: 20, y: 2, w: 16, h: 66, sw: 56, sh: 80 }, // 离心机
  'eq-compressor': { x: 2, y: 10, w: 60, h: 28, sw: 64, sh: 48 }, // 压缩机
  'eq-condenser': { x: 2, y: 6, w: 92, h: 36, sw: 96, sh: 48 }, // 冷凝器
  'eq-cooler': { x: 2, y: 7, w: 60, h: 26, sw: 64, sh: 40 }, // 冷却器
  'eq-crusher': { x: 14, y: 5, w: 43, h: 63, sw: 64, sh: 80 }, // 破碎机
  'eq-cyclone': { x: 16, y: 3.8, w: 36, h: 72.2, sw: 56, sh: 84 }, // 旋风分离器
  'eq-dryer': { x: 10, y: 7.8, w: 68, h: 43.7, sw: 88, sh: 56 }, // 干燥器
  'eq-fan': { x: 12, y: 12, w: 28, h: 28, sw: 52, sh: 52 }, // 风机
  'eq-feeder': { x: 12, y: 5, w: 32, h: 63, sw: 56, sh: 80 }, // 给料器
  'eq-filter': { x: 18, y: 2, w: 20, h: 70, sw: 56, sh: 80 }, // 过滤器
  'eq-fixed-bed': { x: 12, y: 0.5, w: 24, h: 94.5, sw: 48, sh: 96 }, // 固定床反应器
  'eq-fluid-bed': { x: 12, y: 0.5, w: 24, h: 94.5, sw: 48, sh: 96 }, // 流化床反应器
  'eq-furnace': { x: 6, y: 2, w: 52, h: 76, sw: 64, sh: 88 }, // 加热炉
  'eq-gasholder': { x: 7, y: 8, w: 50, h: 68, sw: 64, sh: 84 }, // 气柜
  'eq-htank': { x: 8, y: 4, w: 68, h: 42, sw: 84, sh: 52 }, // 卧式储罐
  'eq-membrane': { x: 20, y: 2, w: 30, h: 74, sw: 56, sh: 80 }, // 膜组件
  'eq-mill': { x: 16, y: 10, w: 57, h: 44, sw: 88, sh: 60 }, // 磨机
  'eq-packed-col': { x: 14, y: 0.5, w: 20, h: 93.5, sw: 48, sh: 96 }, // 填料塔
  'eq-phe': { x: 9, y: 4, w: 30, h: 64, sw: 48, sh: 72 }, // 板式换热器
  'eq-pump-c': { x: 2, y: 2, w: 44, h: 42, sw: 56, sh: 56 }, // 离心泵
  'eq-pump-g': { x: 2, y: 16, w: 52, h: 32, sw: 56, sh: 52 }, // 齿轮泵
  'eq-pump-r': { x: 2, y: 14, w: 44, h: 42, sw: 48, sh: 60 }, // 往复泵
  'eq-pvessel': { x: 10, y: 5, w: 64, h: 38, sw: 84, sh: 48 }, // 压力容器
  'eq-reboiler': { x: 2, y: 14, w: 78, h: 36, sw: 84, sh: 60 }, // 再沸器
  'eq-reflux-drum': { x: 10, y: 7, w: 68, h: 33, sw: 80, sh: 44 }, // 回流罐
  'eq-screener': { x: 14, y: 8, w: 68, h: 40, sw: 88, sh: 56 }, // 筛分机
  'eq-screw-conveyor': { x: 10, y: 12, w: 82, h: 18, sw: 96, sh: 40 }, // 螺旋输送机
  'eq-scrubber': { x: 14, y: 3, w: 28, h: 91, sw: 48, sh: 96 }, // 洗涤塔
  'eq-sphere': { x: 12, y: 2, w: 40, h: 62, sw: 64, sh: 72 }, // 球罐
  'eq-stirred-re': { x: 12, y: 1, w: 32, h: 83, sw: 56, sh: 88 }, // 搅拌反应釜
  'eq-tray-col': { x: 14, y: 0.5, w: 20, h: 93.5, sw: 48, sh: 96 }, // 板式塔
  'eq-vacuum-pump': { x: 2, y: 2, w: 44, h: 42, sw: 56, sh: 52 }, // 真空泵
  'eq-vtank': { x: 10, y: 8, w: 44, h: 64, sw: 64, sh: 80 }, // 立式储罐
  'in-dcs': { x: 4, y: 4, w: 24, h: 24, sw: 32, sh: 32 }, // DCS 功能
  'in-fi': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 流量指示 FI
  'in-field': { x: 4, y: 4, w: 24, h: 24, sw: 32, sh: 32 }, // 现场仪表
  'in-ft': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 流量变送 FT
  'in-li': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 液位指示 LI
  'in-lt': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 液位变送 LT
  'in-panel': { x: 4, y: 4, w: 24, h: 24, sw: 32, sh: 32 }, // 盘装仪表
  'in-pi': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 压力指示 PI
  'in-pt': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 压力变送 PT
  'in-sig-bus': { x: 4, y: 3, w: 64, h: 13, sw: 72, sh: 26 }, // 总线
  'in-sig-capillary': { x: 4, y: 6, w: 64, h: 12, sw: 72, sh: 20 }, // 毛细管
  'in-sig-electric': { x: 4, y: 9, w: 64, h: 1, sw: 72, sh: 18 }, // 电信号
  'in-sig-pneumatic': { x: 4, y: 4, w: 64, h: 8, sw: 72, sh: 20 }, // 气信号
  'in-sig-soft': { x: 4, y: 6.5, w: 64, h: 7, sw: 72, sh: 20 }, // 数据链
  'in-sis': { x: 3.4, y: 3.4, w: 29.1, h: 29.1, sw: 36, sh: 36 }, // SIS 系统
  'in-ti': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 温度指示 TI
  'in-tic': { x: 5, y: 3, w: 26, h: 37, sw: 36, sh: 44 }, // 温度调节 TIC
  'pp-blind': { x: 4, y: 6, w: 56, h: 28, sw: 64, sh: 40 }, // 盲板
  'pp-cap': { x: 4, y: 6, w: 50, h: 28, sw: 64, sh: 40 }, // 管帽
  'pp-cross': { x: 10, y: 10, w: 44, h: 44, sw: 64, sh: 64 }, // 四通
  'pp-elbow': { x: 17, y: 10, w: 37, h: 41, sw: 64, sh: 64 }, // 弯头
  'pp-expansion': { x: 4, y: 13, w: 64, h: 22, sw: 72, sh: 48 }, // 补偿器
  'pp-flame-arrest': { x: 4, y: 8, w: 64, h: 24, sw: 72, sh: 40 }, // 阻火器
  'pp-flange': { x: 4, y: 6, w: 56, h: 20, sw: 64, sh: 32 }, // 法兰
  'pp-flow-arrow': { x: 4, y: 6, w: 64, h: 16, sw: 72, sh: 28 }, // 流向箭头
  'pp-line-hose': { x: 4, y: 7.5, w: 60, h: 9, sw: 72, sh: 22 }, // 软管
  'pp-line-insul': { x: 4, y: 8, w: 64, h: 10, sw: 72, sh: 26 }, // 保温管
  'pp-line-jacket': { x: 6, y: 5, w: 60, h: 16, sw: 72, sh: 26 }, // 夹套管
  'pp-line-proc': { x: 4, y: 12, w: 64, h: 1, sw: 72, sh: 22 }, // 工艺主管线
  'pp-line-tag': { x: 6, y: 8, w: 84, h: 20, sw: 96, sh: 36 }, // 管道编号
  'pp-line-trace': { x: 4, y: 8, w: 64, h: 10, sw: 72, sh: 26 }, // 伴热管
  'pp-line-utility': { x: 4, y: 12, w: 64, h: 1, sw: 72, sh: 22 }, // 公用工程管线
  'pp-mixer': { x: 4, y: 6, w: 64, h: 24, sw: 72, sh: 36 }, // 静态混合器
  'pp-reducer': { x: 2, y: 10, w: 60, h: 24, sw: 64, sh: 44 }, // 异径管
  'pp-ro': { x: 4, y: 13, w: 56, h: 22, sw: 64, sh: 40 }, // 限流孔板
  'pp-sample': { x: 4, y: 11.6, w: 56, h: 43.4, sw: 64, sh: 56 }, // 取样口
  'pp-sightglass': { x: 4, y: 8, w: 64, h: 20, sw: 72, sh: 36 }, // 视镜
  'pp-spectacle': { x: 2, y: 13, w: 68, h: 18, sw: 72, sh: 44 }, // 8字盲板
  'pp-tee': { x: 8, y: 10, w: 48, h: 28, sw: 64, sh: 48 }, // 三通
  'pp-thread': { x: 4, y: 8, w: 56, h: 16, sw: 64, sh: 32 }, // 螺纹连接
  'pp-vent': { x: 25.5, y: 4, w: 13, h: 56, sw: 64, sh: 60 }, // 放空/排凝
  'pp-weld': { x: 4, y: 13, w: 56, h: 6, sw: 64, sh: 32 }, // 焊接连接
  'pp-y-strainer': { x: 4, y: 11.6, w: 64, h: 34.4, sw: 72, sh: 48 }, // Y型过滤器
  'vl-act-diaphragm': { x: 7, y: 32, w: 30, h: 12, sw: 44, sh: 52 }, // 气动薄膜机构
  'vl-act-handwheel': { x: 10, y: 26.8, w: 24, h: 17.2, sw: 44, sh: 52 }, // 手轮机构
  'vl-act-lever': { x: 10, y: 29.2, w: 24, h: 14.8, sw: 44, sh: 52 }, // 弹簧杠杆
  'vl-act-motor': { x: 10, y: 26, w: 24, h: 18, sw: 44, sh: 52 }, // 电动机构
  'vl-act-piston': { x: 10, y: 22, w: 24, h: 22, sw: 44, sh: 52 }, // 活塞机构
  'vl-act-solenoid': { x: 10, y: 28, w: 24, h: 16, sw: 44, sh: 52 }, // 电磁线圈
  'vl-ball': { x: 2, y: 10.5, w: 60, h: 19, sw: 64, sh: 36 }, // 球阀
  'vl-breather': { x: 10, y: 12, w: 36, h: 46, sw: 56, sh: 64 }, // 呼吸阀
  'vl-butterfly': { x: 2, y: 8, w: 60, h: 16, sw: 64, sh: 32 }, // 蝶阀
  'vl-check-lift': { x: 2, y: 14, w: 60, h: 18.7, sw: 64, sh: 40 }, // 升降式止回阀
  'vl-check-swing': { x: 2, y: 12, w: 60, h: 26, sw: 64, sh: 40 }, // 旋启式止回阀
  'vl-check-wafer': { x: 2, y: 7, w: 60, h: 15, sw: 64, sh: 32 }, // 对夹式止回阀
  'vl-control-motor': { x: 2, y: 10.5, w: 60, h: 37, sw: 64, sh: 56 }, // 电动调节阀
  'vl-control-pneu': { x: 2, y: 16.5, w: 60, h: 31, sw: 64, sh: 56 }, // 气动调节阀
  'vl-control-self': { x: 2, y: 16.5, w: 60, h: 31, sw: 64, sh: 62 }, // 自力式调节阀
  'vl-diaphragm': { x: 2, y: 14, w: 60, h: 16, sw: 64, sh: 44 }, // 隔膜阀
  'vl-diverter': { x: 18, y: 14, w: 37.2, h: 38, sw: 64, sh: 56 }, // 换向阀
  'vl-four-way': { x: 2, y: 2, w: 60, h: 60, sw: 64, sh: 64 }, // 四通阀
  'vl-gate': { x: 2, y: 10.5, w: 60, h: 19, sw: 64, sh: 36 }, // 闸阀
  'vl-globe': { x: 2, y: 10.5, w: 60, h: 19, sw: 64, sh: 36 }, // 截止阀
  'vl-needle': { x: 2, y: 3, w: 60, h: 26.5, sw: 64, sh: 36 }, // 针型阀
  'vl-plug': { x: 2, y: 5, w: 60, h: 24.5, sw: 64, sh: 36 }, // 旋塞阀
  'vl-prv': { x: 4, y: 10, w: 48, h: 34, sw: 56, sh: 60 }, // 泄压阀
  'vl-reducing': { x: 4, y: 0.5, w: 48, h: 57.5, sw: 56, sh: 64 }, // 减压阀
  'vl-rupture': { x: 4, y: 10, w: 56, h: 20, sw: 64, sh: 40 }, // 爆破片
  'vl-safety': { x: 4, y: 1.5, w: 44, h: 44.5, sw: 52, sh: 64 }, // 安全阀
  'vl-three-way': { x: 2, y: 2, w: 60, h: 42, sw: 64, sh: 52 }, // 三通阀
  'vl-trap': { x: 4, y: 0.5, w: 48, h: 56.5, sw: 56, sh: 64 }, // 疏水阀
}
