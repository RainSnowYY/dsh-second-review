/**
 * 副输入框「抽牌」动画层测试（1.5.1）：`node test\composer.anim.test.mjs`
 *
 * 不靠浏览器：把 client.js 里的纯几何函数 secCardGeometry 抽出来直接喂数，
 * 验证交接词 §3 的硬判据：
 *   ① 牌边宽度回旧版（主框宽-46、左右各留 23，他 11-14 真机后拍板）；
 *   ② 展开只盖主框上半（牌底＝主框实际顶＋半高），下半可点；
 *   ③ 占位把对话顶开，牌顶不越过对话区底＋8px；
 *   ④ 占位与牌展开同一段动画（同一 q），联动不跳；
 *   ⑤ 可打断：中途反向从当前帧出发，连续不瞬移；
 *   ⑥ 内容晚淡入（第一帧不读压扁的字）；
 *   ⑦ 两种宿主布局（主框被顶下去 / 主框不动）都只盖上半、不沉地下。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(here, '..', 'client.js')
const code = fs.readFileSync(file, 'utf8')

/* 抽出纯函数段（从 secEaseOutQuint 到 ComposerOverlay 之前） */
const start = code.indexOf('const secEaseOutQuint')
const end = code.indexOf('function ComposerOverlay')
if (start < 0 || end < 0 || end <= start) throw new Error('找不到抽牌几何函数段 —— client.js 结构变了')
const seg = code.slice(start, end)
const factory = new Function(seg + '\nreturn { secCardGeometry, secEaseOutQuint, secEaseOutCubic, secClamp01, secLerp }')
const { secCardGeometry, secEaseOutQuint, secClamp01 } = factory()

let pass = 0
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  pass++
}
const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps

/* 主框矩形：宽 800、高 120，顶在视口 y=700 */
const pos = { left: 100, top: 700, width: 800, height: 120, bottom: 208, edge: 80 }
const panelH = 260

/* ① 牌边几何（p=0） */
const g0 = secCardGeometry(pos, panelH, 0, false)
assert(g0.sheetH === 60, '牌边高应为主框一半：' + g0.sheetH)
assert(g0.W === 800 - 46, '牌边宽应回旧版（主框宽-46）：' + g0.W)
assert(near(g0.left, 100 + 23), '牌边左缘应距主框左 23：' + g0.left)
assert(near(g0.left + g0.W, 100 + 800 - 23), '牌边右缘应距主框右 23：' + (g0.left + g0.W))
assert(g0.drop === 8, '牌边应 tucked 进主框底下 8px：' + g0.drop)
assert(g0.H === g0.sheetH + 8, '牌边完整形状高＝可见高＋tuck：' + g0.H)
assert(g0.top + g0.drop - g0.H === 700 - 60, '牌边可见顶应贴在主框顶上方：' + (g0.top + g0.drop - g0.H))
assert(g0.clip === 8, '重叠区应被裁掉 8px（只看见主框）：' + g0.clip)
assert(g0.top + g0.drop - g0.clip === 700, '裁切后底边应恰好贴合主框顶：' + (g0.top + g0.drop - g0.clip))
assert(g0.contentOp === 0, '牌边态内容必须不可见')
assert(g0.labelOp === 1, '牌边态小字必须可见')

/* ②③ 展开几何（p=1）：占位目标 sOpen，牌底沉半高 */
const g1 = secCardGeometry(pos, panelH, 1, false, g0.sheetH, undefined, 1)
const sOpen = Math.max(g0.sheetH, Math.round(panelH - 120 / 2 + 8))
assert(g1.sOpen === sOpen, '展开占位目标算错：' + g1.sOpen)
assert(near(g1.space, sOpen), '展开占位高度应到 sOpen：' + g1.space)
assert(near(g1.drop, 60), '展开应只沉半高：' + g1.drop)
assert(g1.contentOp === 1, '展开态内容必须完全可见')
assert(g1.labelOp === 0, '展开态牌边小字必须淡出')

/* ⑦ 布局 A：主框被占位顶下去 (sOpen-sheetH) */
const topA = 700 + (sOpen - g0.sheetH)
const gA = secCardGeometry(pos, panelH, 1, false, g0.sheetH, sOpen, 1, topA)
const bottomA = gA.top + gA.drop
assert(near(bottomA, topA + 60), '布局A：牌底应停在主框中线：' + bottomA)
const cardTopA = bottomA - gA.H
const convBottomA = topA - sOpen
assert(near(cardTopA, convBottomA + 8), '布局A：牌顶应＝对话区底＋8，不盖对话：' + cardTopA)
assert(bottomA < topA + 120, '布局A：主框下半必须露出来')

/* ⑦ 布局 B：对话被压缩、主框不动 */
const topB = 700
const gB = secCardGeometry(pos, panelH, 1, false, g0.sheetH, sOpen, 1, topB)
const bottomB = gB.top + gB.drop
assert(near(bottomB, topB + 60), '布局B：牌底应停在主框中线：' + bottomB)
assert(bottomB < topB + 120, '布局B：主框下半必须露出来')
assert(bottomB < 900, '布局B：牌不能沉到视口外（地下）')

/* ④ 中途帧：占位与牌用同一个 q，联动 */
for (const t of [0.2, 0.5, 0.8]) {
  const q = secEaseOutQuint(t)
  const g = secCardGeometry(pos, panelH, q, false, g0.sheetH, sOpen, q)
  const S = g0.sheetH + (sOpen - g0.sheetH) * q
  assert(near(g.space, S), 't=' + t + ' 占位应随 q 联动：' + g.space)
  assert(near(g.drop, 8 + (60 - 8) * q), 't=' + t + ' 下沉量应从 tuck 插值到半高：' + g.drop)
  assert(near(g.H, 68 + (panelH - 68) * q), 't=' + t + ' 牌高应从完整牌边插值到面板高：' + g.H)
}

/* ⑤ 可打断：从 p=0.6 反向收，起点连续 */
const qMid = secEaseOutQuint(0.6)
const gMid = secCardGeometry(pos, panelH, qMid, false, g0.sheetH, sOpen, qMid)
const gBack = secCardGeometry(pos, panelH, qMid, false, gMid.space, g0.sheetH, 0)
assert(near(gBack.H, gMid.H) && near(gBack.drop, gMid.drop) && near(gBack.space, gMid.space), '反向起点必须与当前帧一致（不瞬移）')

/* ⑥ 内容晚淡入 */
assert(secCardGeometry(pos, panelH, 0.3, false).contentOp === 0, 'p=0.3 内容不该可见')
assert(secCardGeometry(pos, panelH, 0.55, false).contentOp === 0, 'p=0.55 内容应刚开始淡入')
assert(secCardGeometry(pos, panelH, 0.8, false).contentOp > 0.5, 'p=0.8 内容应过半可见')

/* 悬停上抽只在牌边态 */
const gh = secCardGeometry(pos, panelH, 0, true)
assert(near(gh.drop, 8 - 6), '悬停应在 tuck 基础上上抽 6px：' + gh.drop)
assert(near(gh.top + gh.drop - gh.clip, 700), '悬停时裁切底边仍贴合主框顶（不露缝）：' + (gh.top + gh.drop - gh.clip))
const gh1 = secCardGeometry(pos, panelH, 1, true)
assert(near(gh1.drop, 60), '展开态悬停不该再上抽')

/* ⑧ 矮面板：不盖对话优先，下沉量自动收 */
const shortH = 100
const gS = secCardGeometry(pos, shortH, 1, false, g0.sheetH, undefined, 1, 700)
assert(gS.sOpen === g0.sheetH, '矮面板占位不应小于牌边：' + gS.sOpen)
assert(near(gS.drop, shortH - g0.sheetH - 8), '矮面板下沉量应收：' + gS.drop)
const topS = gS.top + gS.drop - gS.H
assert(topS <= 700 - g0.sheetH + 8 + 0.6, '矮面板牌顶不得越过对话底＋8（不盖对话）：' + topS)
assert(gS.drop < 60, '矮面板不该沉满半高：' + gS.drop)

/* 缓动单调、端点正确 */
assert(secEaseOutQuint(0) === 0 && secEaseOutQuint(1) === 1, '缓动端点错')
let prev = -1
for (let i = 0; i <= 20; i++) {
  const v = secEaseOutQuint(i / 20)
  assert(v >= prev, '缓动必须单调')
  prev = v
}
assert(secClamp01(-1) === 0 && secClamp01(2) === 1, 'clamp 错')

console.log('✓ 抽牌动画几何 ' + pass + ' 项断言全过')
console.log('OK：牌边留白 / 只盖上半 / 不盖对话 / 占位联动 / 可打断 / 晚淡入 / 悬停 / 缓动 / 双布局')
