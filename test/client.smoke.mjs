/**
 * 客户端冒烟（0.7.0 起）：`node test\client.smoke.mjs`
 *
 * 前端没有真 React、也没有 DOM，但绝大多数"点开就白屏"的错都能在这一层挡下来：
 *   ① client.js 模块级代码不炸、两个插槽能注册上；
 *   ② turnTail 的八种状态各渲染出一棵元素树（未评 / 评审中 / 到点 / 一剑封喉 / 通过 /
 *      unclear / 失败 / 首次告知）；
 *   ③ 那条细线进度条的宽度和颜色对不对；
 *   ④ 设置页四段画得出来、关于里有版本号。
 *
 * 做法：把 client.js 读进来，在内存里把内部的 store 露出来（**不改磁盘上的文件**），
 * 然后用一个极小的 React 桩把它跑起来。真渲染还得靠 DSH 重启后人眼看。
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(here, '..', 'client.js')

let code = fs.readFileSync(file, 'utf8')
const marker = 'function useEntry(key) {'
if (code.indexOf(marker) < 0) throw new Error('找不到 useEntry —— client.js 的结构变了，冒烟脚本要跟着改')
code = code.replace(marker, 'try { globalThis.__store = store } catch (e) {}\n    ' + marker)

let factory = null
let loadedId = ''
const comps = {}
const registered = []

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
}
let stateQueue = []
const ReactStub = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => [stateQueue.length ? stateQueue.shift() : v, () => {}],
  useEffect: () => {},
  Component,
}

const sandbox = {
  window: { __ModuleLoader__: { load: (o) => ((loadedId = o.id), (factory = o.factory)) } },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }),
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  sessionStorage: { getItem: () => null, setItem: () => {} },
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: file })
if (!factory) throw new Error('没有拿到 factory（__ModuleLoader__.load 没被调用）')

const slots = {
  inject: (name, cb) => {
    registered.push(name)
    cb()
  },
  register: (meta, component) => {
    if (!meta || !meta.id) throw new Error('插槽没给 id：' + JSON.stringify(meta))
    registered.push(meta.name + '#' + meta.id)
    if (component) comps[meta.name] = component
  },
}
factory((n) => {
  if (n === 'react') return ReactStub
  throw new Error('意外的 require：' + n)
}).apply({ get: (k) => (k === 'slots' ? slots : null) })

const store = sandbox.__store
if (!store) throw new Error('store 没露出来')

/* ---------- 小工具 ---------- */
function walk(el, out = []) {
  if (!el || typeof el !== 'object') return out
  // ThinBar / Provenance 是纯函数组件（不带 hook），展开它们才能查到里面的东西
  if (typeof el.type === 'function' && (el.type.name === 'ThinBar' || el.type.name === 'Provenance')) {
    return walk(el.type(el.props), out)
  }
  out.push(el)
  ;(el.kids || []).forEach((k) => walk(k, out))
  return out
}
function textOf(el) {
  const parts = []
  walk(el).forEach((n) => {
    ;(n.kids || []).forEach((c) => {
      if (typeof c === 'string' || typeof c === 'number') parts.push(String(c))
      else if (c && Array.isArray(c.kids)) c.kids.forEach((d) => (typeof d === 'string' ? parts.push(d) : null))
    })
  })
  return parts.join(' / ')
}
function barOf(el) {
  const bar = walk(el).find((n) => n.props && n.props.style && n.props.style.height === 2)
  return bar && bar.kids && bar.kids[0]
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ---------- 八种状态 ---------- */
const tail = comps['conversation.chat.turnTail']
assert(tail, 'turnTail 没注册上')
const KEY = 's-test:3'

const cases = [
  ['未评', null],
  [
    '评审中 23s',
    { state: 'loading', job: 'j1', progress: { elapsed: 23000, budget: 45000, steps: 2, reasoning: '先看这一轮在解决什么\n字幕最后一行在这里' } },
  ],
  ['评审中 到点', { state: 'loading', job: 'j1', progress: { elapsed: 50000, budget: 45000, steps: 3, reasoning: '还在想' } }],
  ['评审中 不设上限', { state: 'loading', job: 'j1', progress: { elapsed: 20000, budget: 0, steps: 1, reasoning: '慢但一直在吐字' } }],
  [
    '完成 一剑封喉',
    {
      state: 'done',
      verdict: 'major',
      topic: '给卡片换玻璃',
      major: [{ category: '容错率', point: '玻璃变量改名就退回中性色', impact: '突然变素', suggestion: '兜底写死' }],
      minor: [{ category: '合理性', point: '小问题一条', impact: '无', evidence: '原文' }],
      steps: [{ tool: 'read_file', args: { path: 'a' }, ok: true }],
      omitted: { major: 0, minor: 1 },
      // 1.1.0：引文核验（机器查的，不靠模型）
      provenance: { checked: 2, found: 1, missing: ['我什么时候说让你回信了'], userCount: 6 },
      reviewer: { provider: 'deepseek-account', model: 'deepseek-flash', role: '副模型' },
    },
  ],
  ['完成 通过', { state: 'done', verdict: 'pass', note: '没发现必须改的地方。', major: [], minor: [] }],
  ['完成 说不清', { state: 'done', verdict: 'unclear', note: '它说不清这一轮在评什么', major: [], minor: [] }],
  ['失败', { state: 'error', note: 'provider 断流' }],
  ['首次告知', { state: 'notice', pendingKind: 'manual' }],
]

for (const [label, value] of cases) {
  if (value) store.set(KEY, value)
  else delete store.data[KEY]
  const el = tail({ seq: 3, sessionId: 's-test' })
  assert(el && el.type, label + '：没渲染出东西')
  const text = textOf(el)
  assert(text.length > 0, label + '：渲染出来是空的')

  if (label === '评审中 23s') {
    const fill = barOf(el)
    assert(fill, '评审中：找不到那条细线')
    assert(fill.props.style.width === '51.11%', '细线宽度不对：' + fill.props.style.width + '（应为 23000/45000）')
    assert(fill.props.style.background !== '#f59e0b', '还没到点就变琥珀了')
    assert(text.indexOf('字幕最后一行在这里') >= 0, '字幕没露出来')
  }
  if (label === '评审中 到点') {
    const fill = barOf(el)
    assert(fill && fill.props.style.background === '#f59e0b', '到点了线没变琥珀')
    assert(text.indexOf('到点了') >= 0, '到点了没写"到点了，在收尾"')
  }
  if (label === '评审中 不设上限') {
    // 不设总时长：不画百分比，改成一段会走的光块；也不能出现"上限 45 秒"这种话
    const bar = walk(el).find((n) => n.props && n.props.style && n.props.style.height === 2)
    assert(bar, '没找到那条细线')
    const seg = (bar.kids || [])[0]
    assert(seg && seg.props.style.width === '28%', '不设上限时应该是"流动的光块"，不该有百分比宽度')
    assert(typeof seg.props.style.left === 'string', '光块没有位置（不会动）')
    assert(String(bar.props.title || '').indexOf('不设上限') >= 0, '提示里没说"不设上限"')
    assert(text.indexOf('停止') >= 0, '卡上必须有「停止」')
  }
  if (label === '未评') {
    // 未评这一排是"明面"：只许一个实心主按钮，其余退成次操作
    const tiers = walk(el)
      .filter((n) => typeof n.type === 'function' && n.type.name === 'Btn')
      .map((n) => n.props.tier)
    assert(tiers.filter((t) => t === 'pri').length === 1, '未评这排应该正好一个主按钮，实际 ' + JSON.stringify(tiers))
    assert(tiers.filter((t) => t === 'sec').length >= 1, '次按钮没画出来：' + JSON.stringify(tiers))
  }
  if (label === '完成 一剑封喉') {
    assert(text.indexOf('deepseek-flash') >= 0, '卡片上没有署名（模型名）')
    assert(text.indexOf('署名') >= 0, '卡片上没写"署名"两个字')
    assert(text.indexOf('引文核验') >= 0, '卡片上没有引文核验那一行')
    assert(text.indexOf('找不到出处') >= 0, '引文核验没报警')
  }
  console.log('✓ ' + label + ' → ' + text.slice(0, 60))
}

/* ---------- 设置页 ---------- */
const tabEl = comps['plugins.tab']({})
const pageEl = walk(tabEl).find((n) => typeof n.type === 'function' && n.props && n.props.view === 'page')
assert(pageEl, '没找到设置页组件')
const pageText = textOf(pageTree())
assert(pageText.indexOf('01') >= 0 && pageText.indexOf('04') >= 0, '设置页四段没画出来：' + pageText.slice(0, 120))
assert(pageText.indexOf('v0.7.') >= 0, '「关于」里没有版本号')
assert(pageText.indexOf('改动不会自动保存') >= 0, '设置页底部没有保存条／提示')
console.log('✓ 设置页 → ' + pageText.slice(0, 60))

/* ---------- 自己画的控件（下拉 / 勾选）也要能渲染 ---------- */
const own = ['Select', 'Check']
const found = walk(pageTree()).filter((n) => typeof n.type === 'function' && own.indexOf(n.type.name) >= 0)
assert(found.length >= 6, '自绘控件没画出来（应该是两个下拉 + 四个勾选，实际 ' + found.length + '）')
for (const el of found) {
  stateQueue = []
  const out = el.type(el.props)
  assert(out && out.type, el.type.name + ' 渲染失败')
}
console.log('✓ 自绘控件 → ' + found.map((n) => n.type.name).join('、') + '（' + found.length + ' 个）')

// 按 ConfigPage 的 hook 顺序喂一份配置，再把页面渲染一遍
function pageTree() {
  stateQueue = [
    { provider: 'deepseek-account', model: 'deepseek-flash', auto: false, mock: false, allowWrite: false },
    [{ id: 'deepseek-account', name: '账号' }],
    [{ id: 'deepseek-flash', name: 'flash' }],
    '',
    false,
    '0.7.1',
  ]
  return pageEl.type(pageEl.props)
}

console.log('')
console.log('注册到 = ' + registered.join(' | '))
console.log('OK：' + cases.length + ' 个状态 + 设置页')
