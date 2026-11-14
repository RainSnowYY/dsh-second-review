/**
 * 副输入框「只在主对话页出现」测试（1.5.2）：`node test\composer.mount.test.mjs`
 *
 * 背景：1.5.1 把副框挂在 shell.overlay（全局插槽）。锚不到主输入框时
 * （插件页 / 设置页），它仍按静态位置画出来，整块内容露在页面中间 ——
 * 2026-11-14 他截图报的那个 bug。
 *
 * 这条测试守两件事：
 *   ① 没有主框几何（pos = null）→ ComposerOverlay 返回空，一个节点都不画；
 *   ② 有几何时，牌容器首帧是 visibility:hidden —— 几何量写进来之前不许露面，
 *      免得在静态位置上闪一下没位置的牌。
 *
 * 不靠浏览器：沿用 client.smoke.mjs 那套极小 React 桩（不写磁盘上的文件）。
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(here, '..', 'client.js')
const code = fs.readFileSync(file, 'utf8')

let factory = null
const comps = {}

let stateQueue = []
class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
}
const ReactStub = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => [stateQueue.length ? stateQueue.shift() : v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  Component,
}

const sandbox = {
  window: { __ModuleLoader__: { load: (o) => (factory = o.factory) } },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }),
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  sessionStorage: { getItem: () => null, setItem: () => {} },
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: file })
if (!factory) throw new Error('没有拿到 factory（__ModuleLoader__.load 没被调用）')

const registered = []
const slots = {
  inject: (name, cb) => cb(),
  register: (meta, component) => {
    registered.push(meta.name + '#' + meta.id)
    if (component) comps[meta.name] = component
  },
}
factory((n) => {
  if (n === 'react') return ReactStub
  throw new Error('意外的 require：' + n)
}).apply({ get: (k) => (k === 'slots' ? slots : null) })

let pass = 0
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  pass++
}

function walk(el, out = []) {
  if (!el || typeof el !== 'object') return out
  out.push(el)
  ;(el.kids || []).forEach((k) => walk(k, out))
  return out
}

const overlay = comps['shell.overlay']
assert(overlay, 'shell.overlay 没注册上（副框入口不见了）')
const wrap = overlay({})
const node = walk(wrap).find((n) => typeof n.type === 'function' && n.type.name === 'ComposerOverlay')
assert(node, '找不到 ComposerOverlay 节点')

/* ① 没有主输入框几何：一个节点都不许画 */
stateQueue = []
const bare = node.type({})
assert(bare == null, '没有主框几何时仍然画出了东西（就是插件页中间那块牌）：' + JSON.stringify(bare && bare.type))

/* ② 有几何：要画牌边，但首帧必须藏着等 applyFrame 写位置 */
const POS = { left: 120, top: 800, width: 760, height: 120, bottom: 88, edge: 20 }
stateQueue = ['builtin', '', 0, POS, true, '', false, null, [], [], '']
const tree = node.type({})
assert(tree && tree.type === 'div', '有几何时没画牌容器')
assert(tree.props['data-sec-card'] === '', '牌容器少了 data-sec-card 标记')
assert(tree.props.style.position === 'fixed', '牌容器应脱离文档流')
assert(tree.props.style.visibility === 'hidden', '牌容器首帧必须藏着（否则在静态位置闪一下）')

const text = walk(tree)
  .flatMap((n) => (n.kids || []).filter((k) => typeof k === 'string'))
  .join(' / ')
assert(text.indexOf('点击输入指令') >= 0, '牌边小字没画出来：' + text.slice(0, 80))

/* ③ 源码里的三道闸都在（结构性回归） */
assert(code.indexOf('if (!pos) return null') >= 0, '少了「锚不到主框就不渲染」那道闸')
assert(code.indexOf("card.style.visibility = 'visible'") >= 0, 'applyFrame 没把牌放出来')
assert(code.indexOf("document.addEventListener('pointerdown', afterNav, true)") >= 0, '换页后没有尽快重量的钩子')

console.log('✓ 副框跨页：' + pass + ' 项断言全过')
console.log('OK：无几何不渲染 / 有几何首帧藏 / 几何到位才露面 / 换页尽快收')
