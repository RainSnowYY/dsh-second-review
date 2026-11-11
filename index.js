/**
 * dsh-second-review — 独立的副模型评审插件（原探针 dsh-second-review-probe，1.0.0 起改名）
 *
 * 评审员 = 插件自己跑的循环：llm.stream + 手写工具 + 两级输出。
 * 不碰 agent 通道（那条会 TRANSPORT）。
 *
 * 端点（2026-11-09 / 0.4.0 起：会花钱、会改状态的接口一律 POST）：
 *   GET  /ping       连通
 *   GET  /models     模型清单
 *   POST /ask        直调一次（调试用）
 *   GET  /config     读配置
 *   POST /config     改配置
 *   GET  /progress   评审进度
 *   GET  /swap?sessionId=   读这个会话的主刀状态
 *   POST /swap       开／关这个会话的主刀
 *   POST /review     评审（body: {sessionId, seq, job, mock}；探针：{demo:true, text, reply, root}）
 *
 * 0.4.0 加固（GPT 2026-11-09 对 0.3.2 源码包的评审）：
 *   1. 写文件默认关：工具表里不递 write_file，执行层再加一道门；他手动打开
 *      「允许副模型改文件」才给（2026-11-09 他选的 B）。
 *   2. 工作区不再放在全局变量里：每次评审自带一个 root，并发评审不会串。
 *   3. 评审绑定到"用户点的那一轮"：前端传 seq，只读这一轮及以前的记录。
 *   4. 私人目录黑名单按真实路径判断（符号链接绕不过去），且不跟随符号链接。
 *   5. 主刀状态按会话分开存，不再一份 saved 全插件共用。
 *   6. /review、/ask 只收 POST + JSON：别的网页没法用 <img>/链接蹭一次付费评审。
 *
 * 0.5.0（2026-11-09 傍晚，他补的评审标准）：
 *   副模型不准磨洋工：先锚定这一轮主话题；只报"会让用户吃亏"的；每条必须有 impact；
 *   越权／擅自／语气／路径拼写这类一律不写；代码里还有第二道过滤（sanitizeReview）。
 *   工具不设次数上限——他说磨洋工是"看不该看的、说不该说的"，不是限次数。
 *
 * 0.6.0（2026-11-09 晚，M3 可靠性 + 发布前告知）：
 *   ① 首次花钱前先告知（noticeAck），没点过"知道了"不调模型；
 *   ② 「让主模型读」用这张卡自己那份 md，不再一律读 最新.md；
 *   ③ 45 秒预算在流中途也生效；超时且没评出东西 → 明确报超时，不冒充通过；
 *   ④ 去重缓存按轮次分开（A 会话不顶掉 B 会话）；
 *   ⑤ 落盘文件名带毫秒，防止同一秒内互相覆盖。
 *
 * 0.6.1（2026-11-09 晚，他报"看到思考过程、最后没评成"）：
 *   provider 偶发断流 → 自动重试一次（只对 finish.kind==='error'，超时／正常不重试）；
 *   错误原因不再截到 70 字，卡片上最多 200 字，悬停可看全文。
 *
 * 0.7.0（2026-11-09 晚，方案 B ＝ 外观玻璃化）：
 *   ① 前端卡片／设置页换成玻璃，读壁纸插件公开在 body 上的 --we-* 变量，读不到退回中性色；
 *   ② 设置页分四段（模型／评审模式／权限／关于），/config 带 version 出去；
 *   ③ 思考流保留（他执意要），字幕行底下加一条细线进度条；
 *   ④ /progress 多给 budget（45 秒）和 phase —— 那条线走真实时间，不画假百分比。
 *
 * 0.7.1（2026-11-09 22:2x，他指的三处手感问题）：
 *   ① `<select>` 和 `<input type=checkbox>` 不吃外面 label 的 cursor → 自己写 pointer；
 *   ② 下拉关闭态去原生外观、自绘箭头、玻璃底、悬停变亮（弹出列表仍是系统的，改不动）；
 *   ③ 勾选项整行做 hover 底色 + 方块染成强调色。
 *   ⚠️ 顺手修掉一个真 bug：`section(no, title, children)` 只收一个子节点，
 *      「测试模式」和「关于」的第二段其实一直没画出来 —— 改成 `...children`。
 *
 * 0.8.0（2026-11-09 晚，他定的"可以给别人用"那一版）：
 *   ① 署名：/review 多返回 reviewer{provider, model, role}，卡片底部和落盘 md
 *      （头部一行 + 文末一行）都写清"谁评的、什么角色"；主刀互换时角色标"原主模型"；
 *   ② README 重写：定位成"主执行者 + 独立监督者"，补双模型工作流，删掉探针时期的口语。
 *
 * 0.9.0（2026-11-09 深夜，他带 😤 报"小问花 45 秒没评出来，直接显示没调通"）：
 *   ① **拆掉 45 秒总时长闸**：默认不设上限（budgetSec 默认 0），设置页可选 3 分钟／5 分钟／45 秒；
 *   ② 换成两道"确实卡住才响"的闸：**空闲闸**（连续 N 秒一个字节都没有，默认 120 秒，可关）
 *      和**卡上的「停止」**（POST /cancel，流里每块之间看一眼）；
 *   ③ 被打断／停止时**保留已经说出来的内容**：留着当 partial 回给前端，解析不出 JSON 也先试一次
 *      补救调用（最多 30 秒），不再一律报"没调通"；超时／取消／断流三种原因分开说；
 *   ④ /progress 多给 budget（0＝不设）、idleFor／idleMs／cancelled。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-second-review'

export const inject = ['webServer']

/* 模型↔工具最多来回几轮（不是"工具能调几次"：一轮里可以并行几个工具）。
   他 2026-11-09 说"工具不要给限制"——指的是别把人数砍成 2 次那种抠法；
   但完全不封顶会死循环，所以留一个"轮数"上限。
   ⚠️ 0.9.0 起：**总时长不再是硬闸**（他 2026-11-09 深夜被 45 秒坑了一次：
   思考出来了、钱花了、结果被截断）。现在只留两道"确实卡住了才响"的闸：
     ① 空闲闸：连续 N 秒一个字节都没有才收手（默认 120 秒，可在设置里改/关）；
     ② 取消：卡上有个「停止」，点了立刻收手。
   总时长上限默认 0（＝不设），需要的人可以在设置里选。 */
const MAX_STEPS = 8
const MAX_CHARS = 60000
const LEGACY_BUDGET_MS = 45000

/* 版本号（0.7.0 起）：/config 会带出去，设置页「关于」直接显示，不用去翻 package.json */
const VERSION = '1.3.5'

/* ---------------- 配置（副模型 + 自动评审 + 主刀） ---------------- */

const DEFAULT_CONFIG = {
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  auto: false,
  mock: false,
  /* 副模型能不能改文件：默认关（2026-11-09 他选的 B）。
     关着的时候工具表里根本没有 write_file，模型连"想调"都无从下手；
     只有他手动在设置页打开，才会把这一项加进去。 */
  allowWrite: false,
  /* 第一次花钱前的那段告知，用户点过"知道了"才变 true（0.6.0）。 */
  noticeAck: false,
  /* 0.9.0：总时长上限（秒）。0 ＝ 不设（默认）。他 2026-11-09 深夜要求"删掉这个限制"。 */
  budgetSec: 0,
  /* 0.9.0：空闲多久没有任何新内容就收手（秒）。0 ＝ 不设。
     ⚠️ 0.9.1 起默认改回 0：小问那种"闷头想很久、不边想边吐字"的模型会被 120 秒误判成卡死，
     他 2026-11-10 凌晨就是这么被掐了一次。要判的人自己去设置里开。 */
  idleSec: 0,
  /* 1.1.0：引文核验。助手回复里每一条"你的原话"，都要能在会话记录里找到出处。
     这是 2026-11-10 小问那场事故的补丁（`记录中心\小问的bug.md`）：
     她把一条自己编出来的用户消息当成用户说的，还照着它删了信、改了记忆。
     纯本地字符串比对 —— 不调模型、不花钱、不拖慢评审。 */
  checkQuotes: true,
}

const CONFIG_FILE = path.join(os.homedir(), '.dsh', 'dsh-second-review', 'config.json')

/* 去重：同一会话、同一轮、同样内容，30 分钟内只评一次（重新生成不再重复花钱）。
   按 key 分开存，别让 A 会话的缓存把 B 会话的顶掉（0.6.0）。 */
const DEDUPE_MS = 30 * 60 * 1000
const REVIEW_CACHE_MAX = 20
const REVIEW_CACHE = new Map()

function cacheGet(key) {
  const hit = REVIEW_CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > DEDUPE_MS) {
    REVIEW_CACHE.delete(key)
    return null
  }
  return hit.payload
}

function cacheSet(key, payload) {
  REVIEW_CACHE.set(key, { at: Date.now(), payload })
  while (REVIEW_CACHE.size > REVIEW_CACHE_MAX) {
    const oldest = [...REVIEW_CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (!oldest) break
    REVIEW_CACHE.delete(oldest[0])
  }
}

function hashOf(text) {
  const s = String(text || '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const j = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...(j && typeof j === 'object' ? j : {}) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...(patch || {}) }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/* 主刀状态：一份 map，key 是会话 id —— 每个会话各存各的，互不覆盖。
   旧版（0.3.x）是单份 {on, saved, sessionId}，这里顺手兼容读一次。 */
function readSwaps(cfg) {
  const map = cfg && cfg.swaps && typeof cfg.swaps === 'object' ? { ...cfg.swaps } : {}
  const legacy = cfg && cfg.swap
  if (legacy && legacy.on && legacy.sessionId && legacy.saved && !map[legacy.sessionId]) {
    map[legacy.sessionId] = { saved: legacy.saved, at: Date.now() }
  }
  return map
}

function sendJson(res, status, body) {
  let payload
  try {
    payload = JSON.stringify(body)
  } catch {
    payload = JSON.stringify({ ok: false, error: 'serialize-failed' })
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/* 统一的错误出口：请求体不合法是 400，其余是 500（以前一律 500，看不出是谁的错） */
function sendErr(res, error, extra) {
  const status = Number(error && error.statusCode) || 500
  const body = { ok: false, error: String((error && error.message) || error), ...(extra || {}) }
  return sendJson(res, status, body)
}

/* 会花钱的接口只认 JSON：跨站表单发不出 application/json，
   所以这道门是"别的网页蹭不到"的关键，比只看 method 有用。 */
function requireJson(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '只接受 POST+JSON' })
    return false
  }
  const type = String((req.headers && req.headers['content-type']) || '').toLowerCase()
  if (!type.startsWith('application/json')) {
    sendJson(res, 415, { ok: false, error: '只接受 POST+JSON（content-type 必须是 application/json）' })
    return false
  }
  return true
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 200000) {
        req.destroy()
        reject(new Error('body too large'))
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        // 非法 JSON 不许再当空 body 继续跑：/ask 会拿默认参数白调一次模型
        const err = new Error('请求体不是合法 JSON')
        err.statusCode = 400
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function rootOf(session) {
  try {
    const entries = Object.values((session && session.log) || {})
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e && e.type === 'working-directory/change' && e.data && typeof e.data.directory === 'string') return e.data.directory
    }
    if (session && session.header && typeof session.header.cwd === 'string') return session.header.cwd
  } catch {}
  return process.cwd()
}

/* 工作区只在"这一次评审"里存在。以前这里是全局变量 ROOT，两个会话同时评就会互相串。 */
function makeRoot(dir) {
  let root = String(dir || process.cwd())
  try {
    root = realOf(root)
  } catch {}
  return root
}

/* Windows 上 junction（目录联接）用普通的 realpathSync 解不开，必须用 native 版
   —— 不然"工作区里放个链接指向记忆卡"就绕过去了。非 Windows 下 native 同样可用。 */
function realOf(p) {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return fs.realpathSync(p)
  }
}

function insideRoot(rootDir, p) {
  try {
    const base = realOf(rootDir)
    const real = realOf(p)
    return real === base || real.startsWith(base + path.sep)
  } catch {
    return false
  }
}

function safePath(rootDir, input) {
  const abs = path.isAbsolute(input) ? input : path.join(rootDir, input)
  const norm = path.normalize(abs)
  return { abs: norm, allowed: insideRoot(rootDir, norm) }
}

/* 写新文件时目标还不存在，realpath 会失败；这时看它所在的目录在不在工作区里。 */
function safeWritePath(rootDir, input) {
  const abs = path.isAbsolute(input) ? input : path.join(rootDir, input)
  const norm = path.normalize(abs)
  return { abs: norm, allowed: insideRoot(rootDir, nearestExisting(path.dirname(norm))) }
}

/* 新建多级目录时，父目录可能还不存在：一路往上找最近一个真实存在的目录。 */
function nearestExisting(dir) {
  let cur = dir
  for (let i = 0; i < 64; i++) {
    try {
      if (fs.existsSync(cur)) return cur
    } catch {}
    const up = path.dirname(cur)
    if (up === cur) return cur
    cur = up
  }
  return cur
}

function truncate(text, n = 4000) {
  const s = String(text)
  return s.length > n ? s.slice(0, n) + `\n…（截断，共 ${s.length} 字）` : s
}

/* 长对话：超了就只留最后一段（近的更要紧），并在开头标一句"早期已截断" */
export function clipTranscript(text, limit = MAX_CHARS) {
  const s = String(text || '')
  if (s.length <= limit) return { text: s, truncated: false }
  /* 1.0.1（小K 审出来）：提示放**开头**，而且要和正文一起算进 limit。
     以前是 `s.slice(-limit) + 提示` —— 两个毛病：
       ① 模型读到的最后一句是"（早期内容已截断）"，会被当成对话的一部分；
       ② 总长 = limit + 提示长度，正好卡在 context 上限的模型会被 provider 直接拒掉。 */
  const note = '（早期内容已截断）\n'
  const cut = Math.max(0, limit - note.length)
  return { text: note + s.slice(-cut), truncated: true }
}

/* 不许副模型碰的东西（他原始需求：副模型默认不读 AGENTS.md、不读工作区里的私人记录）。
   工具是开的，但这两个口子固定关着——评审一段对话，用不着看他的人。 */
const BLOCK_FILE_NAMES = ['agents.md', 'agents.md.off']
const BLOCK_DIR_NAMES = ['记忆卡', '.dsh']

/* 判断"这个文件是不是私人的"。
   一定要按真实路径判断：工作区里放一个指向 记忆卡 的符号链接，只看名字是拦不住的。
   指向工作区外面的链接也一并拦掉（保守）。 */
export function blockedPath(rootDir, abs) {
  let base = String(rootDir || process.cwd())
  try {
    base = realOf(base)
  } catch {}
  let target = String(abs || '')
  try {
    target = realOf(target)
  } catch {}
  const rel = path.relative(base, target)
  if (!rel) return false
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return true
  const parts = String(rel).split(/[\\/]+/).filter(Boolean)
  return parts.some((p) => {
    const low = p.toLowerCase()
    return BLOCK_FILE_NAMES.includes(low) || BLOCK_DIR_NAMES.includes(p)
  })
}

/* ---------------- 工具 ---------------- */

/* 读工具：任何时候都有。
   写工具单独放在下面，只有他手动打开「允许副模型改文件」时才会递给模型。 */
export const READ_TOOLS = [
  {
    name: 'read_file',
    description: '读取工作区内的一个文本文件。可选起始行与行数。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区的路径或绝对路径' },
        start: { type: 'number', description: '起始行，从 1 开始' },
        lines: { type: 'number', description: '最多读多少行，默认 200' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: '列出一个目录下的文件与子目录。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区的路径' } },
      required: ['path'],
    },
  },
  {
    name: 'find_files',
    description: '按文件名片段在工作区内找文件，返回路径列表。',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, limit: { type: 'number' } },
      required: ['pattern'],
    },
  },
  {
    name: 'search_text',
    description: '在工作区内按关键词搜索文本，返回命中的文件与行。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
]

/* 写工具：默认不递。开了「允许副模型改文件」才给。
   即使递了，执行层也要再查一次开关——两道门，不靠提示词。 */
export const WRITE_TOOL = {
  name: 'write_file',
  description: '把内容写入工作区内的一个文件（覆盖或新建）。只能写工作区内。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的路径' },
      content: { type: 'string', description: '要写入的完整内容' },
    },
    required: ['path', 'content'],
  },
}

export function toolsFor(allowWrite) {
  return allowWrite ? [...READ_TOOLS, WRITE_TOOL] : READ_TOOLS
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function walk(rootDir, dir, out, depth = 0) {
  if (depth > 6 || out.length > 20000) return
  let items
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const it of items) {
    if (it.name.startsWith('.') && it.name !== '.dsh') continue
    const p = path.join(dir, it.name)
    if (it.isSymbolicLink()) continue
    if (blockedPath(rootDir, p)) continue
    if (it.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build'].includes(it.name)) continue
      walk(rootDir, p, out, depth + 1)
    } else {
      out.push(p)
    }
  }
}

export function runTool(rootDir, name, args, allowWrite) {
  try {
    if (name === 'read_file') {
      const { abs, allowed } = safePath(rootDir, String(args.path || ''))
      if (!allowed) return { text: '拒绝：路径不在工作区内。', isError: true }
      if (isSymlink(abs)) return { text: '拒绝：这是符号链接，副模型不跟随。', isError: true }
      if (blockedPath(rootDir, abs)) return { text: '拒绝：这个文件是私人的（AGENTS.md／记忆卡），副模型不读。', isError: true }
      const raw = fs.readFileSync(abs, 'utf8')
      const lines = raw.split('\n')
      const start = Math.max(1, Number(args.start) || 1)
      const count = Math.min(400, Math.max(1, Number(args.lines) || 200))
      const slice = lines.slice(start - 1, start - 1 + count)
      return { text: `文件：${path.relative(rootDir, abs)}\n` + truncate(slice.join('\n')), isError: false }
    }
    if (name === 'list_dir') {
      const { abs, allowed } = safePath(rootDir, String(args.path || '.'))
      if (!allowed) return { text: '拒绝：路径不在工作区内。', isError: true }
      const items = fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((d) => !d.isSymbolicLink() && !blockedPath(rootDir, path.join(abs, d.name)))
      return { text: items.map((d) => (d.isDirectory() ? '[DIR] ' : '      ') + d.name).join('\n').slice(0, 6000), isError: false }
    }
    if (name === 'find_files') {
      const pattern = String(args.pattern || '').toLowerCase()
      const all = []
      walk(rootDir, rootDir, all)
      const hit = all.filter((p) => p.toLowerCase().includes(pattern)).slice(0, Number(args.limit) || 30)
      return { text: hit.map((p) => path.relative(rootDir, p)).join('\n') || '没找到。', isError: false }
    }
    if (name === 'search_text') {
      const query = String(args.query || '')
      const all = []
      walk(rootDir, rootDir, all)
      const hits = []
      for (const p of all) {
        if (hits.length >= (Number(args.limit) || 20)) break
        let text
        try {
          const stat = fs.statSync(p)
          if (stat.size > 512 * 1024) continue
          text = fs.readFileSync(p, 'utf8')
        } catch {
          continue
        }
        const idx = text.toLowerCase().indexOf(query.toLowerCase())
        if (idx >= 0) {
          const line = text.slice(0, idx).split('\n').length
          hits.push(`${path.relative(rootDir, p)}:${line}  ${truncate(text.slice(Math.max(0, idx - 80), idx + 160), 300)}`)
        }
      }
      return { text: hits.join('\n\n') || '没搜到。', isError: false }
    }
    if (name === 'write_file') {
      // 第二道门：就算模型不知道从哪儿摸到了这个名字，开关没开也执行不了
      if (allowWrite !== true) {
        return { text: '拒绝：这次评审没有开写权限（设置页「允许副模型改文件」是关的）。', isError: true }
      }
      const raw = String(args.path || '')
      const { abs, allowed } = safeWritePath(rootDir, raw)
      if (!allowed) return { text: '拒绝：只能写工作区内的文件。', isError: true }
      if (isSymlink(abs)) return { text: '拒绝：这是符号链接，副模型不跟随。', isError: true }
      const content = String(args.content ?? '')
      if (content.length > 200000) return { text: '拒绝：内容超过 20 万字。', isError: true }
      const dir = path.dirname(abs)
      if (!insideRoot(rootDir, nearestExisting(dir))) return { text: '拒绝：目标目录不在工作区内。', isError: true }
      // 2026-11-09 GPT 第三轮实测出的绕过：新文件本身 realpath 解不开，
      // 只看 `alias/new.md` 的表面路径会漏掉"alias 是通向 记忆卡 的目录联接"。
      // 写之前必须解出**最近一个存在的父目录**的真实路径，再拿真实目标判黑名单。
      const existing = nearestExisting(dir)
      let realBase = existing
      try {
        realBase = realOf(existing)
      } catch {}
      const realTarget = path.join(realBase, path.relative(existing, abs))
      if (blockedPath(rootDir, realTarget) || blockedPath(rootDir, abs)) {
        return { text: '拒绝：这个文件是私人的（AGENTS.md／记忆卡），副模型不许改。', isError: true }
      }
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
      return { text: `已写入 ${path.relative(rootDir, abs)}（${content.length} 字）`, isError: false }
    }
  } catch (error) {
    return { text: '执行出错：' + String((error && error.message) || error), isError: true }
  }
  return { text: '未知工具：' + name, isError: true }
}

/* ---------------- 流装配 ---------------- */

/* 评审过程的实时进度：前端能看到"它在想什么"，不至于以为卡死了。
   只放在内存里，最多留 30 条，进程一重启就没了 —— 不是记录，是"看得见它在动"。 */
const JOBS = new Map()

function newJob(id) {
  /* 1.0.1（小K 审出来）：进度条读的 budget／idleMs 以前是每次去 readConfig()，
     用户在评审进行中去设置页改「最长等待」，这张卡的进度条会当场跳变，
     而真正的 deadline 早在 review 开始就算死了 —— 显示的和实际跑的对不上。
     这里把它们**在开跑时快照进 job**，progress 只报快照值。 */
  const cfg = readConfig()
  const job = {
    at: Date.now(),
    lastAt: Date.now(),
    reasoning: '',
    text: '',
    steps: 0,
    done: false,
    cancelled: false,
    budgetMs: Math.max(0, Number(cfg.budgetSec) || 0) * 1000,
    idleMs: Math.max(0, Number(cfg.idleSec) || 0) * 1000,
  }
  JOBS.set(id, job)
  if (JOBS.size > 30) {
    const old = [...JOBS.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, JOBS.size - 30)
    for (const [k] of old) JOBS.delete(k)
  }
  return job
}

const TIMEOUT = Symbol('timeout')

/* 取下一块数据，但最多等 ms 毫秒。
   ⚠️ 关键：模型不吐字时 `for await` 会永远挂着，原来的写法只在"收到块之后"查时间，
   所以卡死的时候 45 秒闸根本不会响。（GPT 第三轮 4.3，2026-11-09） */
function nextWithTimeout(iter, ms) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(TIMEOUT)
    }, Math.max(1, ms))
    if (typeof timer.unref === 'function') timer.unref()
    Promise.resolve()
      .then(() => iter.next())
      .then(
        (v) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(e)
        },
      )
  })
}

async function streamOnce(llm, messages, tools, cfg, onDelta, deadline, opts) {
  const parts = new Map()
  let finish = null
  let replayState = null
  let text = ''

  // deadline: 绝对时间点；Infinity／0 ＝ 不设总时长（0.9.0 默认就这么跑）
  const limit = Number(deadline) > 0 ? Number(deadline) : Number.POSITIVE_INFINITY
  // 空闲闸：连续这么久一个字节都没有才算"真的卡住了"
  const idleMs = opts && Number(opts.idleMs) > 0 ? Number(opts.idleMs) : 0
  const shouldStop = opts && typeof opts.shouldStop === 'function' ? opts.shouldStop : null
  let lastAt = Date.now()

  const stream = llm.stream({ provider: cfg.provider, model: cfg.model, messages, tools })
  const iter = stream && typeof stream[Symbol.asyncIterator] === 'function' ? stream[Symbol.asyncIterator]() : null
  if (!iter) return { text, calls: [], finish: { kind: 'error', message: 'llm.stream 不可迭代' }, replayState: null }

  while (true) {
    if (shouldStop && shouldStop()) {
      finish = { kind: 'cancel' }
      try {
        if (typeof iter.return === 'function') await iter.return()
      } catch {}
      break
    }
    const now = Date.now()
    if (now >= limit) {
      finish = { kind: 'timeout' }
      try {
        if (typeof iter.return === 'function') await iter.return()
      } catch {}
      break
    }
    let wait = limit - now
    if (idleMs) wait = Math.min(wait, lastAt + idleMs - now)
    if (wait <= 0) {
      finish = { kind: now >= limit ? 'timeout' : 'idle' }
      try {
        if (typeof iter.return === 'function') await iter.return()
      } catch {}
      break
    }
    // 有"停止"可用时把等待切成 1 秒一片：否则一个永远不返回的 next() 会让停止按钮失灵
    const slice = shouldStop ? Math.min(wait, 1000) : wait
    let step
    try {
      // 两个闸都不设（总时长 0 + 空闲 0）时就是"一直等它"——别拿 Infinity 去 setTimeout
      // （Node 会把超大延迟当成 1ms，反而立刻收手）
      step = slice === Number.POSITIVE_INFINITY ? await iter.next() : await nextWithTimeout(iter, slice)
    } catch (error) {
      finish = { kind: 'error', message: String((error && error.message) || error) }
      break
    }
    if (step === TIMEOUT) {
      const after = Date.now()
      const pastDeadline = after >= limit
      const pastIdle = idleMs > 0 && after - lastAt >= idleMs
      if (!pastDeadline && !pastIdle) continue // 这一片只是到点了，回去再看一眼要不要停
      finish = { kind: pastDeadline ? 'timeout' : 'idle' }
      try {
        if (typeof iter.return === 'function') await iter.return()
      } catch {}
      break
    }
    if (!step || step.done) break
    const chunk = step.value
    // 来了东西就记账：空闲闸看的是"最后一次有动静"的时间
    lastAt = Date.now()
    const type = chunk && chunk.type
    if (type === 'block-start') {
      if (!parts.has(chunk.index)) parts.set(chunk.index, { kind: chunk.blockType || 'text', text: '', id: '', name: '', args: '' })
    } else if (type === 'text-delta') {
      if (!parts.has(chunk.index)) parts.set(chunk.index, { kind: 'text', text: '', id: '', name: '', args: '' })
      parts.get(chunk.index).text += chunk.text || ''
      text += chunk.text || ''
      if (onDelta) onDelta('text', chunk.text || '')
    } else if (type === 'reasoning-delta') {
      if (onDelta) onDelta('reasoning', chunk.text || '')
    } else if (type === 'tool-call-delta') {
      if (!parts.has(chunk.index)) parts.set(chunk.index, { kind: 'tool-call', text: '', id: '', name: '', args: '' })
      const p = parts.get(chunk.index)
      if (chunk.id) p.id = chunk.id
      if (chunk.name) p.name = chunk.name
      p.args += chunk.argumentsDelta || ''
    } else if (type === 'finish') {
      finish = chunk.reason
      replayState = chunk.replayState || null
    }
  }

  const calls = [...parts.values()].filter((p) => p.kind === 'tool-call' && p.name)
  return { text, calls, finish, replayState }
}

/* 失败重试一次：流式评审偶尔会在 provider 侧断掉（主模型刚跑完、限流、网络抖），
   一次重试通常就过。只对 finish.kind === 'error' 重试；超时和正常结束不重试。 */
export async function streamWithRetry(llm, messages, tools, cfg, onDelta, deadline, opts) {
  const first = await streamOnce(llm, messages, tools, cfg, onDelta, deadline, opts)
  // 只对"真的断了"重试一次；超时／空闲收手／取消都不重试（那会把等待又拉长一遍）
  const limit = Number(deadline) > 0 ? Number(deadline) : Number.POSITIVE_INFINITY
  if (first.finish && first.finish.kind === 'error' && Date.now() + 2000 < limit) {
    if (onDelta) onDelta('reset', '')
    await new Promise((resolve) => setTimeout(resolve, 600))
    const again = await streamOnce(llm, messages, tools, cfg, onDelta, deadline, opts)
    return { ...again, retried: true, firstError: first.finish }
  }
  return first
}

/* ---------------- 评审 ---------------- */

/* 测试模式用的假数据：不调模型、不花钱、不落盘。
   内容是照他 2026-11-09 补的标准写的：一条一剑封喉、一条一针见血，都带"影响"。 */
const MOCK_REVIEW = {
  topic: '【测试】用户让助手删 E 盘旧截图，看这个方案会不会让他吃亏。',
  verdict: 'major',
  note: '测试数据：一条一剑封喉，一条一针见血。',
  major: [
    {
      category: '风险提示',
      point: '【测试】删除操作没说明能不能恢复，删错了就回不来。',
      evidence: '助手说「我会删除 E:\\旧截图 下所有 png 和 jpg 文件」。',
      impact: '删错了没有后悔药，用户会直接丢文件。',
      suggestion: '点一下「依据」，看它能不能展开。',
    },
    {
      category: '质疑',
      point: '【测试】「大约 2.3GB」这个数字没有任何来源。',
      evidence: '助手说「大约 2.3GB」。',
      impact: '用户会按这个数判断腾出了多少空间，结果对不上。',
      suggestion: '先量一下再报数。',
    },
  ],
  minor: [
    {
      category: '补充',
      point: '【测试】没说 png／jpg 之外的截图格式怎么处理。',
      evidence: '',
      impact: '其他格式的截图不会被删，用户可能误以为清干净了。',
      suggestion: '',
    },
  ],
}

function systemPrompt(allowWrite) {
  return `你是独立评审员。你看的是一段"用户与 AI 助手"的对话，只评**这一轮**主回复。

第一步：用一句话说清"这一轮用户到底要解决什么"（topic）。
说不出 topic，或这一轮没有交付物可评：**不要硬找**，把 topic 留空、verdict 写 "unclear"。
（"unclear"＝你没看懂在评什么，不等于"没问题"。这一档会原样显示给用户看。）

只评一件事：这段主回复对**当前这个话题**的交付，用户能不能直接用、会不会因此吃亏。
不是评代码风格，不是评流程，不是评助手的态度，更不是挑毛病凑数。
和当前话题无关的发现，一律不写，哪怕它本身是对的。

三档，只选一档：
1. pass：这一轮没有会让用户吃亏的地方。大多数轮次都该是这个。
2. major（一剑封喉）：照它做会出事——删错东西、丢数据、白花钱、返工、被误导、方案从根上不成立。
   一条就够，最多两条。
3. minor（一针见血）：不致命，但说中了这一轮的关键遗漏，用户知道了能少走一步。
   最多一条；说不出一针见血的那种，就写 pass。

每条必须有三样，缺一样就不许写：
- point：具体到这句话／这个方案／这个数字，不许空泛。
- evidence：对话里的原句，或你读到的文件＋摘句。
- impact：照它做，用户会付出什么**具体代价**。写不出代价，说明这条不重要，删掉。

绝对不要写（写了等于没评）：
- 文件路径、文件名、拼写、标点、排版、措辞、语气、礼貌；
- "是否越权""是否擅自行动""应该先问用户""流程不规范""没有说明下一步"；
- 和这一轮主话题无关的任何"顺便提醒"；
- 复述主回复、夸奖、总结。

语气：客观、中立，像同事提意见；不夸，也不为了显得严格而硬挑。用户可能看不懂术语，说人话。

${
  allowWrite === true
    ? '你可以读，也可以写：但只有当你确信"不改会造成实际损失"时才写，并且必须在 suggestion 里写明改了什么、改在哪。'
    : '你只能读，不能改：工具里没有任何写文件的能力，也不要建议"我帮你改好了"。'
}
工具按需要读，但只读和这一轮主话题直接相关的：对话里点到具体文件、而你必须核实，才去读；
别为了"看看有什么"翻目录，也别去读和这个话题无关的东西。没读到就写没读到，不许编。
AGENTS.md 和 记忆卡 是用户的私人记录：不要读（工具也会拒绝）。
看完就收尾，只输出 JSON。

{"topic":"这一轮在解决什么（一句话）","verdict":"pass|major|minor|unclear","note":"可选，一句话结论","major":[{"category":"...","point":"...","evidence":"...","impact":"...","suggestion":"可选"}],"minor":[...]}

verdict 跟着 major/minor 走：两档都空、且 topic 说得清 → pass；topic 说不出 → unclear。
超出上限的条目不用自己删（代码会保留最要紧的，并注明"另有 N 条被省略"）。
category 只能是这七个：补充 / 合理性 / 可行性 / 容错率 / 质疑 / 代价 / 风险提示。`
}


function collectText(node, out, depth = 0) {
  if (!node || depth > 6) return
  if (typeof node === 'string') return
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out, depth + 1)
    return
  }
  if (typeof node === 'object') {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    else for (const v of Object.values(node)) collectText(v, out, depth + 1)
  }
}

/* 把会话记录转成"用户／助手"两列。
   beforeSeq：只取 seq 小于等于它的记录 —— 也就是"用户点的那一轮"为止。
   （turnTail 的 seq 是这一轮最后一个节点的 seq，见 dsh-client-ui-chat 的渲染代码。） */
export function transcriptOf(session, beforeSeq) {
  const log = (session && session.log) || {}
  const list = Object.entries(log).map(([key, entry]) => ({ key, entry }))
  const seqOf = (x) => {
    const s = Number(x.entry && x.entry.seq)
    return Number.isFinite(s) ? s : Number(x.key)
  }
  list.sort((a, b) => seqOf(a) - seqOf(b))
  const limit = beforeSeq === null || beforeSeq === undefined || beforeSeq === '' ? null : Number(beforeSeq)
  const rows = []
  for (const { key, entry } of list) {
    const e = entry
    if (!e || typeof e !== 'object') continue
    if (limit !== null && Number.isFinite(limit)) {
      // 记录没写 seq 时不能当成"永远算数"：退回用它自己的 key（日志行就是 seq）
      const raw = Number(e.seq)
      const s = Number.isFinite(raw) ? raw : Number(key)
      if (Number.isFinite(s) && s > limit) continue
    }
    const type = e.type
    if (type !== 'user/message' && type !== 'assistant/message') continue
    const out = []
    collectText(e.data, out)
    const text = out.join('\n').trim()
    if (text) rows.push({ role: type === 'user/message' ? '用户' : '助手', text })
  }
  return rows
}

/* ---------------- 引文核验（1.1.0，1.3.1 收紧） ----------------
   来路：`记录中心\小问的bug.md`（2026-11-10）。小问幻觉出一条用户责骂消息并照着行动，
   她的补法是机器能做的 —— "助手回复里引用的每一条用户原话，去事件流里核有没有 kind=user 的存根"。
   这里就是那条检查：纯本地字符串比对，不调模型、不花钱、不增加评审时间。

   只查两件事同时成立的那种引文（1.3.1 收紧）：
     ① 它出现在**这一轮被评的那条回复**里（最后一条用户消息之后的助手消息）；
     ② 归属词**紧挨着**引号 —— 「你说「…」」「你刚才说「…」」「你的原话是「…」」。
   为什么要收紧：2026-11-10 20:53 第一次真跑，老规则（前后 40 字里出现"你说"就算）
   把 5 句"术语引号"全报成编造（「引文核验」「核对引文」「你会说的话」…），
   还把整段旧会话的引号都算进来 —— 误报比漏报更毁信任，所以宁可窄。
   容差：允许引歪一两个字（标点、漏字），用 3 字一组的覆盖率 ≥ 0.8 认；抓的是"根本没这句"。
   ⚠️ 这是"安全带"不是"判决书"：查不到出处 ≠ 一定是编的（也可能它改写得太多），
      所以它只标红提示，不改 verdict、不删评审条目。 */
const QUOTE_RE = /[「『“"]([^」』”"]{2,120})[」』”"]/g
const ATTR_TAIL_RE = /(你|用户)[^，。；！？,.;!?]{0,6}?(说|讲|要求|让我|叫我|原话|改口|强调|明确)[过了的是]{0,2}[：:，,、\s]*$/

function attributedToUser(text, index) {
  return ATTR_TAIL_RE.test(text.slice(Math.max(0, index - 18), index))
}

function normQuote(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：,.!?;:“”‘’"'「」『』（）()【】\[\]…—－\-·]/g, '')
    .toLowerCase()
}

function quotedCoverage(q, corpus) {
  if (!q) return 0
  if (corpus.indexOf(q) >= 0) return 1
  if (q.length < 6) return 0 // 太短的引文只认一字不差
  const seen = new Set()
  let total = 0
  let hit = 0
  for (let i = 0; i + 3 <= q.length; i++) {
    const g = q.slice(i, i + 3)
    if (seen.has(g)) continue
    seen.add(g)
    total++
    if (corpus.indexOf(g) >= 0) hit++
  }
  return total ? hit / total : 0
}

export function verifyUserQuotes(rows) {
  const list = []
  for (const r of rows || []) {
    if (!r || typeof r.text !== 'string' || !r.text) continue
    if (r.role === '用户' || r.role === '助手') list.push(r)
  }
  // 只核"这一轮被评的那条回复"：最后一条用户消息之后的助手消息。
  // 以前扫整段会话，旧回复里的引号也会被算进来（2026-11-10 20:53 那 5 条误报的一半来源）。
  let lastUser = -1
  for (let i = 0; i < list.length; i++) if (list[i].role === '用户') lastUser = i
  const userTexts = list.slice(0, lastUser + 1).filter((r) => r.role === '用户').map((r) => r.text)
  const assistantTexts = list.slice(lastUser + 1).filter((r) => r.role === '助手').map((r) => r.text)
  const result = { checked: 0, found: 0, missing: [], userCount: userTexts.length }
  if (!userTexts.length || !assistantTexts.length) return result
  const corpus = userTexts.map(normQuote).join('\n')
  const seen = new Set()
  for (const text of assistantTexts) {
    const re = new RegExp(QUOTE_RE.source, 'g')
    let m
    while ((m = re.exec(text)) !== null) {
      const raw = String(m[1] || '').trim()
      if (raw.length < 4) continue
      if (!/[\u4e00-\u9fa5]/.test(raw)) continue // 只核中文原话：英文短语多是文件名/代码
      if (!attributedToUser(text, m.index)) continue
      const q = normQuote(raw)
      if (!q || q.length < 4 || seen.has(q)) continue
      seen.add(q)
      result.checked++
      const parts = raw
        .split(/…+|\.\.\.+/)
        .map((x) => normQuote(x))
        .filter((x) => x.length >= 3)
      const ok =
        parts.length > 1 ? parts.every((p) => quotedCoverage(p, corpus) >= 0.8) : quotedCoverage(q, corpus) >= 0.8
      if (ok) result.found++
      else if (result.missing.length < 5) result.missing.push(raw.slice(0, 120))
    }
  }
  return result
}

/* 1.3.5：主模型和副模型是不是"同一个"。
   只判完全相同这一层：同一个 model 换个 provider，还是同一双眼睛；
   不同 provider 的模型命名各异，硬猜"同源"会误报（小问 2026-11-10 的判断，我认同）。
   只用来提示，不用来拦截：只有一个 Key 的人照样允许重选。 */
export function sameModel(a, b) {
  const pick = (x) => String((x && typeof x === 'object' ? x.model : x) || '').trim().toLowerCase()
  const am = pick(a)
  const bm = pick(b)
  return !!am && am === bm
}

export function saveReview(rootDir, review, steps, meta) {
  try {
    const dir = path.join(rootDir, '二次评审')
    fs.mkdirSync(dir, { recursive: true })
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp =
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      '-' +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds()) +
      '-' +
      String(now.getMilliseconds()).padStart(3, '0')
    // 署名：哪家 provider、哪个模型、什么角色（副模型 / 原主模型）
    const rv = meta && meta.reviewer ? meta.reviewer : null
    const rvModel = rv && rv.model ? String(rv.model) : String((meta && meta.model) || '未知')
    const rvProvider = rv && rv.provider ? String(rv.provider) : ''
    const rvRole = rv && rv.role ? String(rv.role) : ''
    const signLine = rvModel + (rvProvider ? '（' + rvProvider + '）' : '') + (rvRole ? ' · ' + rvRole : '')
    const lines = []
    lines.push('# 二次评审')
    lines.push('')
    lines.push('- 时间：' + now.toLocaleString('zh-CN'))
    lines.push('- 会话：' + (meta.sessionId || '未知'))
    lines.push('- 评到第几轮：' + (meta.seq === null || meta.seq === undefined ? '整段会话' : 'seq ' + meta.seq + '（含）以前'))
    lines.push('- 署名：' + signLine)
    lines.push(
      '- 结论：' +
        (review.verdict === 'pass'
          ? '通过，没发现必须改的'
          : review.verdict === 'unclear'
            ? '没评成：它说不清这一轮在评什么'
            : review.verdict === 'major'
              ? '有大问题'
              : review.verdict === 'error'
                ? '没评成：它没给出能读的结论格式'
                : '只有小问题') +
        '（大 ' + review.major.length + ' 条 / 小 ' + review.minor.length + ' 条）',
    )
    const omitted = review.omitted || {}
    const omittedTotal = (omitted.major || 0) + (omitted.minor || 0)
    if (omittedTotal > 0) {
      lines.push('- 另有 ' + omittedTotal + ' 条同类被省略（大问题最多留 2 条、小问题最多留 1 条）')
    }
    if (review.topic) lines.push('- 评的是：' + review.topic)
    if (review.note) lines.push('- 一句话：' + review.note)
    // 引文核验（1.1.0）：机器查的，不靠模型 —— 来路见 记录中心\小问的bug.md
    const pv = meta && meta.provenance
    if (pv && pv.checked > 0) {
      lines.push('')
      lines.push('## 引文核验（机器核对）')
      lines.push('')
      if (!(pv.missing && pv.missing.length)) {
        lines.push('- 它引用了 ' + pv.checked + ' 句「你的话」，全部在会话记录里找到了出处。')
      } else {
        lines.push('- ⚠ 有 ' + pv.missing.length + ' 句在会话记录里找不到出处 —— 先别照它改方向：')
        for (const q of pv.missing) lines.push('  - 「' + q + '」')
      }
      lines.push('')
    }
    lines.push('')
    const writeGroup = (title, list) => {
      if (!list.length) return
      lines.push('## ' + title)
      lines.push('')
      list.forEach((it, i) => {
        lines.push(`### ${i + 1}. [${it.category}] ${it.point}`)
        lines.push('')
        if (it.evidence) lines.push('依据：' + it.evidence)
        if (it.impact) lines.push('影响：' + it.impact)
        if (it.suggestion) lines.push('建议：' + it.suggestion)
        lines.push('')
      })
    }
    writeGroup('大问题（不改不行）', review.major)
    writeGroup('小问题（确实存在，但不影响用）', review.minor)
    if (!review.major.length && !review.minor.length) {
      lines.push(review.verdict === 'unclear' ? '它说不清这一轮在评什么，所以这次不算通过、也不算有问题。' : '这次没发现必须改的地方。')
      lines.push('')
    }
    if (steps.length) {
      lines.push('## 评审时查过的东西')
      lines.push('')
      for (const s of steps) lines.push(`- ${s.tool} ${JSON.stringify(s.args)} → ${s.ok ? '成功' : '失败'}`)
      lines.push('')
    }
    // 文末署名：换过副模型时，一眼就知道这份是哪个模型评的
    lines.push('---')
    lines.push('')
    lines.push('> 本评审由 **' + rvModel + '**' + (rvProvider ? '（' + rvProvider + '）' : '') + (rvRole ? ' 生成 · ' + rvRole : ' 生成') + ' · ' + now.toLocaleString('zh-CN'))
    lines.push('')
    const body = lines.join('\n')
    const file = path.join(dir, stamp + '.md')
    fs.writeFileSync(file, body, 'utf8')
    fs.writeFileSync(path.join(dir, '最新.md'), body, 'utf8')
    return path.relative(rootDir, file)
  } catch (error) {
    return '保存失败：' + String((error && error.message) || error)
  }
}

const ALLOWED_CATS = ['补充', '合理性', '可行性', '容错率', '质疑', '代价', '风险提示']

function normItem(it) {
  if (!it || typeof it.point !== 'string') return null
  return {
    category: ALLOWED_CATS.includes(it.category) ? it.category : '风险提示',
    point: String(it.point).slice(0, 140),
    evidence: String(it.evidence || '').slice(0, 300),
    impact: String(it.impact || '').slice(0, 160),
    suggestion: it.suggestion ? String(it.suggestion).slice(0, 200) : '',
  }
}

/* 新格式：{verdict, note, major[], minor[]}
   旧格式 {items[]} 也认（severity 3 = 大问题，1~2 = 小问题），免得旧记录看不了 */
/* 解析失败时要不要再补救一次（0.9.1）。
   ⚠️ 这里**不许**再看"正文多长"：0.9.0 那条 `length >= 40` 就是 bug ——
   越认真的模型越容易在最后一轮还在调工具、一个字没吐，正文为空反而被跳过补救。 */
export function shouldNudge(parsed, cancelled) {
  return !!(parsed && parsed.parseFailed) && !cancelled
}

export function parseReview(raw) {
  const text = String(raw || '')

  /* 0.9.1：以前只做"第一个 { 到最后一个 }"，模型一旦在正文里贴了代码（满屏花括号），
     截出来就是一段没法解析的垃圾 → 整轮白跑。现在按"像不像一份评审"挨个试：
       ① 原样整段；
       ② ```json / ``` 围栏里的；
       ③ 逐个平衡花括号片段，**从后往前**试（模型习惯把结论放最后）。 */
  const looksReview = (o) =>
    o && typeof o === 'object' && (Array.isArray(o.major) || Array.isArray(o.minor) || Array.isArray(o.items) || typeof o.verdict === 'string')

  const tryJson = (s) => {
    try {
      return JSON.parse(String(s || '').trim())
    } catch {
      return null
    }
  }

  const candidates = [text]
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g
  let m
  while ((m = fence.exec(text))) candidates.push(m[1])

  const spans = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) {
          spans.push(text.slice(i, j + 1))
          i = j
          break
        }
      }
    }
    if (spans.length > 60) break
  }
  for (let k = spans.length - 1; k >= 0; k--) candidates.push(spans[k])

  const shapeOf = (json) => {
    const pick = (list) => (Array.isArray(list) ? list : []).map(normItem).filter(Boolean).slice(0, 3)
    if (Array.isArray(json.major) || Array.isArray(json.minor) || typeof json.verdict === 'string') {
      const major = pick(json.major)
      const minor = pick(json.minor)
      let verdict = major.length ? 'major' : minor.length ? 'minor' : 'pass'
      if (json.verdict === 'pass' && !major.length) verdict = 'pass'
      if (json.verdict === 'unclear' && !major.length && !minor.length) verdict = 'unclear'
      if (json.verdict === 'error') verdict = 'error'
      return {
        topic: String(json.topic || '').slice(0, 120),
        verdict,
        note: String(json.note || '').slice(0, 160),
        major,
        minor,
        parseFailed: false,
      }
    }
    if (Array.isArray(json.items)) {
      /* 1.0.1（小K 审出来）：以前是 `json.items.map(normItem).filter(Boolean)` 之后
         再用**过滤后的索引**去取 `json.items[i].severity` —— 只要中间有一条 normItem
         返回 null（比如某条 point 不是字符串），后面所有条目的 severity 全部错位，
         本该是大问题的被降级成小问题。改成遍历原始数组时把 severity 一起带上。 */
      const shapedItems = []
      for (const it of json.items) {
        const norm = normItem(it)
        if (!norm) continue
        shapedItems.push({ norm, severity: Number((it && it.severity) || 0) })
      }
      const major = shapedItems.filter((x) => x.severity >= 3).map((x) => x.norm).slice(0, 3)
      const minor = shapedItems.filter((x) => x.severity < 3).map((x) => x.norm).slice(0, 3)
      return { topic: '', verdict: major.length ? 'major' : minor.length ? 'minor' : 'pass', note: '', major, minor, parseFailed: false }
    }
    return null
  }

  for (const c of candidates) {
    const json = tryJson(c)
    if (!json || !looksReview(json)) continue
    const shaped = shapeOf(json)
    if (shaped) return shaped
  }

  return { topic: '', verdict: 'error', note: '', major: [], minor: [], parseFailed: true }
}

/* 他 2026-11-09 补的标准：副模型不准磨洋工。
   提示词是第一道；这里是第二道，专治"说了等于没说"的条目：
   - 说不出具体代价（没有 impact）的 minor → 删；
   - "越权／擅自／应该先问／语气／礼貌"这类与交付无关的 → 删；
   - 格式类 nitpick（路径／文件名／拼写…）且没有依据的 → 删；
   - 同一句话不重复；minor 最多 1 条，major 最多 2 条；全删光就是 pass。 */
const META_NOISE = [
  /越权|擅自|未经(允许|询问|确认)|没(有)?先问|应该先问|该先问/,
  /礼貌|语气|态度|口吻|客套|措辞/,
  /复述|重复一遍|没有说明下一步|下一步没/,
]
const FORMAT_NOISE = [/路径|文件名|命名|拼写|错别字|错字|标点|排版|缩进|空格|换行|格式/]
const HARM_WORDS = /删|覆盖|丢|改|发出去|花钱|费用|数据|文件|回不来|恢复/

function metaNoise(text) {
  return META_NOISE.some((re) => re.test(String(text || '')))
}

function minorNoise(it) {
  const point = String(it.point || '')
  const impact = String(it.impact || '')
  if (!impact.trim()) return true
  if (metaNoise(point + ' ' + impact)) return true
  if (!String(it.evidence || '').trim() && FORMAT_NOISE.some((re) => re.test(point))) return true
  return false
}

export function sanitizeReview(review) {
  const src = review || {}
  // 回来的是"去重后的全部"＋"被截掉的条数"：条数封顶还要留着，但不能悄悄丢
  const dedupe = (list, max) => {
    const seen = new Set()
    const out = []
    for (const it of Array.isArray(list) ? list : []) {
      const key = String((it && it.point) || '').replace(/\s+/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(it)
    }
    return { items: out.slice(0, max), dropped: Math.max(0, out.length - max) }
  }
  const majorRes = dedupe(
    (src.major || []).filter((it) => !(metaNoise(it.point) && !HARM_WORDS.test(String(it.point || '')))),
    2,
  )
  const minorRes = dedupe((src.minor || []).filter((it) => !minorNoise(it)), 1)
  const major = majorRes.items
  const minor = minorRes.items
  const topic = String(src.topic || '').trim()
  // 解析失败要保留 error，不能被过滤成"通过"
  let verdict = src.verdict === 'error' ? 'error' : major.length ? 'major' : minor.length ? 'minor' : 'pass'
  // 说不出这一轮在评什么 → 那是"没看懂"，不是"没问题"，别让它冒充通过
  if (verdict === 'pass' && !topic && !src.parseFailed) verdict = 'unclear'
  return {
    topic,
    verdict,
    note: String(src.note || ''),
    major,
    minor,
    omitted: { major: majorRes.dropped, minor: minorRes.dropped },
    parseFailed: !!src.parseFailed,
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const ping = async (req, res) => sendJson(res, 200, { ok: true, at: new Date().toISOString() })

    const models = async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const provider = url.searchParams.get('provider')
        const llm = scope.get('llm')
        if (!llm) return sendJson(res, 503, { ok: false, error: 'llm service missing' })
        if (!provider) return sendJson(res, 200, { ok: true, providers: await llm.listProviders() })
        return sendJson(res, 200, { ok: true, models: await llm.listModels(provider) })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    const ask = async (req, res) => {
      try {
        if (!requireJson(req, res)) return
        const body = await readBody(req)
        const text = typeof body.text === 'string' && body.text ? body.text : '只回四个字：探针通了。'
        const llm = scope.get('llm')
        const started = Date.now()
        const r = await streamOnce(llm, [{ role: 'user', content: [{ type: 'text', text }] }], [], readConfig())
        return sendJson(res, 200, { ok: true, ms: Date.now() - started, text: r.text, finish: r.finish && r.finish.kind })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    const config = async (req, res) => {
      try {
        if (req.method === 'POST') {
          if (!requireJson(req, res)) return
          const body = await readBody(req)
          const patch = {}
          if (body && typeof body.provider === 'string') patch.provider = body.provider
          if (body && typeof body.model === 'string') patch.model = body.model
          if (body && typeof body.auto === 'boolean') patch.auto = body.auto
          if (body && typeof body.mock === 'boolean') patch.mock = body.mock
          if (body && typeof body.allowWrite === 'boolean') patch.allowWrite = body.allowWrite
          if (body && typeof body.noticeAck === 'boolean') patch.noticeAck = body.noticeAck
          // 0.9.0：两个闸都能从设置页改，夹到合理区间（0 ＝ 不设）
          if (body && Number.isFinite(Number(body.budgetSec))) patch.budgetSec = Math.max(0, Math.min(1800, Math.round(Number(body.budgetSec))))
          if (body && Number.isFinite(Number(body.idleSec))) patch.idleSec = Math.max(0, Math.min(1800, Math.round(Number(body.idleSec))))
          // 1.1.0：引文核验的开关（默认开，纯本地比对，不花钱）
          if (body && typeof body.checkQuotes === 'boolean') patch.checkQuotes = body.checkQuotes
          return sendJson(res, 200, { ok: true, config: writeConfig(patch), file: CONFIG_FILE, version: VERSION })
        }
        return sendJson(res, 200, { ok: true, config: readConfig(), file: CONFIG_FILE, version: VERSION })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    // 评审进度：前端每 0.7 秒来问一次"它在想什么"，免得看着像卡死
    const progress = async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const j = JOBS.get(String(url.searchParams.get('job') || ''))
        if (!j) return sendJson(res, 200, { ok: true, missing: true })
        return sendJson(res, 200, {
          ok: true,
          reasoning: j.reasoning,
          text: j.text,
          steps: j.steps,
          elapsed: Date.now() - j.at,
          // 0.9.0：默认不设总时长（budget = 0）→ 前端画"不确定进度"（流动的细线），不编百分比
          // 1.0.1：用 job 开跑时的快照，不读全局配置（否则设置页一改，正跑的卡会跳）
          budget: Number(j.budgetMs) || 0,
          // 空闲闸：多久没动静了 / 多久算卡住（毫秒；0＝不判）
          idleFor: Date.now() - (j.lastAt || j.at),
          idleMs: Number(j.idleMs) || 0,
          cancelled: !!j.cancelled,
          // 阶段只用来换一句话，不用来画假进度：想 → 查 → 写结论
          phase: j.done ? 'done' : j.text ? 'writing' : j.steps ? 'checking' : 'thinking',
          done: j.done,
        })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    // 停止这一次评审（0.9.0）。总时长不再设硬闸之后，"能随时喊停"就是新的保险丝；
    // 只动内存里那个 job 的标志位，流那边每个块之间看一眼，下一块就收手。
    const cancel = async (req, res) => {
      try {
        if (!requireJson(req, res)) return
        const body = await readBody(req)
        const id = String((body && body.job) || '').slice(0, 64)
        const j = id ? JOBS.get(id) : null
        if (!j) return sendJson(res, 200, { ok: true, missing: true })
        j.cancelled = true
        return sendJson(res, 200, { ok: true, cancelled: true })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    /* 1.3.5：这个会话"现在的主模型"是谁。
       走 DSH 自己的 agent.model.current()（副模型主刀也用它）；
       读不到就返回 null —— 卡片上不显示提示，绝不为了一句提示去猜。 */
    const currentMain = (sid) => {
      try {
        const agents = scope.get('agents')
        const live = agents && typeof agents.list === 'function' ? agents.list() : []
        const normId = (v) => String(v || '').replace(/^session-/, '')
        const hit = (Array.isArray(live) ? live : []).find((a) => {
          try {
            return a && (normId(a.id) === normId(sid) || (a.session && normId(a.session.id) === normId(sid)))
          } catch {
            return false
          }
        })
        const cur = hit && hit.model && typeof hit.model.current === 'function' ? hit.model.current() : null
        if (!cur) return null
        return { provider: String(cur.provider || ''), model: String(cur.model || '') }
      } catch {
        return null
      }
    }

    // 副模型主刀：把这一轮"谁在答"换成副模型（走 DSH 官方的 agent.model.select，不碰消息归属）
    // 状态按会话分开存：A 会话开了主刀，不会把 B 会话的"原来的模型"覆盖掉。
    const swap = async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const agents = scope.get('agents')
        const live = agents && typeof agents.list === 'function' ? agents.list() : []
        const norm = (v) => String(v || '').replace(/^session-/, '')
        const findAgent = (sid) =>
          (Array.isArray(live) ? live : []).find((a) => {
            try {
              return a && (norm(a.id) === norm(sid) || (a.session && norm(a.session.id) === norm(sid)))
            } catch {
              return false
            }
          })

        const cfg = readConfig()
        const map = readSwaps(cfg)

        if (req.method !== 'POST') {
          const sid = String(url.searchParams.get('sessionId') || '')
          const entry = map[sid]
          const hit = findAgent(sid)
          return sendJson(res, 200, {
            ok: true,
            on: !!entry,
            saved: (entry && entry.saved) || null,
            exec: cfg.provider + ' / ' + cfg.model,
            current: hit && hit.model && hit.model.current ? hit.model.current() || null : null,
          })
        }

        if (!requireJson(req, res)) return
        const body = await readBody(req)
        const sid = String(body.sessionId || '')
        if (!sid) return sendJson(res, 400, { ok: false, error: 'sessionId required' })
        const hit = findAgent(sid)
        if (!hit || !hit.model || typeof hit.model.select !== 'function') {
          return sendJson(res, 404, { ok: false, error: 'agent not found' })
        }

        if (body.on === true) {
          const cur = hit.model.current() || null
          hit.model.select({ provider: cfg.provider, model: cfg.model })
          map[sid] = { saved: cur, at: Date.now() }
          writeConfig({ swaps: map, swap: undefined })
          return sendJson(res, 200, { ok: true, on: true, saved: cur, now: hit.model.current() })
        }

        const entry = map[sid]
        if (entry && entry.saved && entry.saved.provider && entry.saved.model) {
          hit.model.select({ provider: entry.saved.provider, model: entry.saved.model })
        }
        delete map[sid]
        writeConfig({ swaps: map, swap: undefined })
        return sendJson(res, 200, { ok: true, on: false, restored: (entry && entry.saved) || null, now: hit.model.current() })
      } catch (error) {
        return sendErr(res, error)
      }
    }

    const review = async (req, res) => {
      try {
        // 只收 POST+JSON：GET／表单都能被别的网页蹭，content-type 这道门才是关键
        if (!requireJson(req, res)) return
        const url = new URL(req.url || '/', 'http://localhost')
        const body = await readBody(req)
        // 不再从 URL 查询参数兜底：sessionId 只能走 body（查询参数能被 <img>/链接带上）
        const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null
        const demo = body.demo === true
        const anchor = body.seq === undefined || body.seq === null || body.seq === '' ? null : Number(body.seq)
        const sessions = scope.get('sessions')
        const llm = scope.get('llm')
        if (!llm) return sendJson(res, 503, { ok: false, error: 'llm service missing' })

        let rows = []
        const cfg = readConfig()

        // 进度：前端带着 job=来的，就边跑边往里写"想什么"（只进内存，不进记录）
        const jobId = String(body.job || url.searchParams.get('job') || '').slice(0, 64)
        const job = jobId && /^[A-Za-z0-9_-]{6,64}$/.test(jobId) ? newJob(jobId) : null
        const onDelta = job
          ? (kind, t) => {
              if (kind === 'reset') {
                job.reasoning = ''
                job.text = ''
                return
              }
              if (!t) return
              if (kind === 'reasoning') job.reasoning = (job.reasoning + t).slice(-8000)
              else job.text = (job.text + t).slice(-8000)
            }
          : undefined

        if (cfg.mock || body.mock === true) {
          return sendJson(res, 200, {
            ok: true,
            mock: true,
            ...MOCK_REVIEW,
            saved: '',
            // 假数据也要有署名，不然分不清"谁评的"和"这是假的"
            reviewer: { provider: '', model: '假数据', role: '测试模式（不花钱、不调模型）' },
            steps: [],
            rows: 0,
            truncated: false,
            timedOut: false,
          })
        }

        // 副模型主刀开着的时候，会话里回答问题的是副模型，
        // 那这份评审就该由"原来的主模型"来当 —— 这才是他说的"互换"。
        // 只认这个会话自己存的那份，别的会话开了主刀不影响这里。
        const sidKey = String(sessionId || '')
        const entry = sidKey ? readSwaps(cfg)[sidKey] : null
        const reviewCfg =
          !demo && entry && entry.saved && entry.saved.provider && entry.saved.model
            ? { ...cfg, provider: entry.saved.provider, model: entry.saved.model }
            : cfg

        let rootDir = null
        if (demo) {
          // 探针用：POST {demo:true, text, reply, root}
          // 可以自己编一段对话、指定一个"工作区"，逼出工具调用；
          // 不碰任何真实会话、也不落盘（demo 分支不 saveReview）。
          const probeRoot = typeof body.root === 'string' && body.root ? body.root : process.cwd()
          rootDir = makeRoot(probeRoot)
          const probeUser = typeof body.text === 'string' ? body.text : ''
          rows = probeUser
            ? [
                { role: '用户', text: probeUser },
                { role: '助手', text: typeof body.reply === 'string' && body.reply ? body.reply : '（好的，已经处理完了。）' },
              ]
            : [
                { role: '用户', text: '把 E 盘的旧截图全部删掉，腾点空间。' },
                { role: '助手', text: '好的，我会删除 E:\\旧截图 下所有 png 和 jpg 文件，大约 2.3GB。' },
              ]
        } else {
          const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
          if (!session) {
            const agents = scope.get('agents')
            const live = agents && typeof agents.list === 'function' ? agents.list() : []
            const norm = (v) => String(v || '').replace(/^session-/, '')
            const hit = (Array.isArray(live) ? live : []).find((a) => {
              try {
                return a && (norm(a.id) === norm(sessionId) || (a.session && norm(a.session.id) === norm(sessionId)))
              } catch {
                return false
              }
            })
            if (hit && hit.session) {
              rootDir = makeRoot(rootOf(hit.session))
              rows = transcriptOf(hit.session, anchor)
            } else {
              return sendJson(res, 404, {
                ok: false,
                error: 'session not found: ' + String(sessionId),
                live: (Array.isArray(live) ? live : []).map((a) => a && a.id).slice(0, 10),
              })
            }
          } else {
            rootDir = makeRoot(rootOf(session))
            rows = transcriptOf(session, anchor)
          }
        }

        if (rows.length === 0) return sendJson(res, 200, { ok: true, empty: true, verdict: 'pass', note: '这一轮还没有对话内容', major: [], minor: [], steps: 0 })

        // 引文核验（1.1.0）：在动模型之前先把"有没有编出来的用户原话"查一遍 —— 纯本地，零成本
        const provenance = cfg.checkQuotes === false || demo ? null : verifyUserQuotes(rows)

        let transcript = rows.map((r) => `【${r.role}】${r.text}`).join('\n\n')
        const clipped = clipTranscript(transcript)
        transcript = clipped.text
        const truncated = clipped.truncated

        const dedupeKey = String(sessionId || '') + '|' + String(anchor === null ? '' : anchor) + '|' + rows.length + '|' + hashOf(String(transcript).slice(-400))
        const cachedPayload = demo ? null : cacheGet(dedupeKey)
        if (cachedPayload) {
          return sendJson(res, 200, { ...cachedPayload, cached: true })
        }

        const messages = [{ role: 'user', content: [{ type: 'text', text: `${systemPrompt(cfg.allowWrite === true)}\n\n=== 对话 ===\n${transcript}` }] }]
        const tools = toolsFor(cfg.allowWrite === true)
        const allowWrite = cfg.allowWrite === true
        const steps = []
        const finishes = []
        let finalText = ''
        let budget = 0
        let timedOut = false
        let idled = false
        let cancelled = false
        const startedAt = Date.now()

        /* 0.9.0：总时长默认不设（他 2026-11-09 深夜要求删掉 45 秒那道闸）。
           两个数都是设置页里他自己选的：
             budgetSec ＝ 0 → 不限时长
             idleSec   ＝ 0 → 不判空闲；> 0 → 连续这么久没有任何新内容才收手 */
        const budgetSec = Number(cfg.budgetSec) > 0 ? Number(cfg.budgetSec) : 0
        const idleSec = Number(cfg.idleSec) > 0 ? Number(cfg.idleSec) : 0
        const deadlineAt = budgetSec ? startedAt + budgetSec * 1000 : 0
        const stopOpts = {
          idleMs: idleSec ? idleSec * 1000 : 0,
          shouldStop: () => !!(job && job.cancelled),
        }

        for (let i = 0; i < MAX_STEPS; i++) {
          if (budgetSec && Date.now() - startedAt > budgetSec * 1000) {
            timedOut = true
            finishes.push({ step: i, kind: 'timeout', ms: Date.now() - startedAt })
            break
          }
          if (job && job.cancelled) {
            cancelled = true
            break
          }
          // 工具不设次数上限（他 2026-11-09 明确说过：磨洋工是"看不该看的、说不该说的"，不是限次数）
          const r = await streamWithRetry(llm, messages, tools, reviewCfg, onDelta, deadlineAt, stopOpts)
          finishes.push({
            step: i,
            kind: r.finish && r.finish.kind,
            reason: r.finish ? JSON.stringify(r.finish).slice(0, 300) : null,
            message: r.finish && r.finish.failure && r.finish.failure.message ? String(r.finish.failure.message).slice(0, 200) : null,
            text: r.text.length,
            calls: r.calls.length,
            retried: !!r.retried,
          })
          if (r.finish && r.finish.kind === 'timeout') timedOut = true
          if (r.finish && r.finish.kind === 'idle') idled = true
          if (r.finish && r.finish.kind === 'cancel') cancelled = true
          // 被闸打断时，它已经吐出来的那段话不能丢 —— 这正是他昨天最气的地方
          if (timedOut || idled || cancelled) {
            finalText = r.text || finalText
            break
          }
          if (r.calls.length === 0) {
            finalText = r.text
            break
          }
          const blocks = []
          if (r.text) blocks.push({ type: 'text', text: r.text })
          for (const c of r.calls) blocks.push({ type: 'tool-call', id: c.id, name: c.name, arguments: c.args })
          messages.push({
            role: 'assistant',
            id: randomUUID(),
            source: { kind: 'assistant', provider: reviewCfg.provider, model: reviewCfg.model },
            ...(r.replayState ? { replayState: r.replayState } : {}),
            content: blocks,
          })

          for (const c of r.calls) {
            let args = {}
            try {
              args = JSON.parse(c.args || '{}')
            } catch {}
            const result = runTool(rootDir, c.name, args, allowWrite)
            steps.push({ tool: c.name, args, ok: !result.isError, preview: truncate(result.text, 300) })
            if (job) job.steps = steps.length
            budget += result.text.length
            messages.push({
              role: 'tool',
              id: randomUUID(),
              source: { kind: 'tool', callId: c.id },
              toolCallId: c.id,
              content: [{ type: 'text', text: truncate(result.text, 4000) }],
              isError: !!result.isError,
            })
          }
          if (budget > MAX_CHARS) break
          if (i === MAX_STEPS - 1) finalText = r.text
        }

        const parsed0 = parseReview(finalText)
        let finalParsed = parsed0
        /* 解析不出 JSON 时，让它"停手、只吐 JSON"再试一次（最多两次）。
           ⚠️ 0.9.1 修的真 bug：以前这里还要求"正文至少 40 字"才算数 ——
           可越是认真的模型，越容易在最后一轮**还在调工具**、一个字都没吐，
           于是正文为空 → 补救被跳过 → 直接弹"没评成"。他和小问都撞在这一点上。
           现在：只要解析失败就补救，不看有没有正文；用 streamWithRetry 扛一次断流；
           两次都失败就把已经说出来的东西留着（partial），不再只给一句空话。 */
        const partialText = String(finalText || '').trim()
        if (shouldNudge(parsed0, cancelled)) {
          for (let attempt = 0; attempt < 2 && finalParsed.parseFailed; attempt++) {
            const nudge = [
              ...messages,
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text:
                      attempt === 0
                        ? '停。不要再调用任何工具，现在就只输出那个 JSON（topic／verdict／major／minor／note），前后不要写别的字。'
                        : '只输出一行 JSON，不要解释、不要代码块、不要任何多余的字。格式：{"topic":"…","verdict":"pass|major|unclear","major":[…],"minor":[…],"note":"…"}',
                  },
                ],
              },
            ]
            // 补救这一下：不设总时长时给足 90 秒（以前只有 30 秒，慢模型根本来不及），
            // 有总上限时不超过剩余时间；别让"补救"再变成第二次干等
            const remain = deadlineAt ? Math.max(5000, deadlineAt - Date.now()) : 90000
            const forced = await streamWithRetry(llm, nudge, [], reviewCfg, onDelta, Date.now() + Math.min(90000, remain), stopOpts)
            if (forced && forced.text) {
              finalText = forced.text
              finalParsed = parseReview(finalText)
            }
          }
        }
        const parsed = sanitizeReview(finalParsed)
        const hasSomething = parsed.major.length + parsed.minor.length > 0

        // 模型没调通（key 没了／模型名不对／网络断）时，流不会抛错，只会以 kind:"error" 收尾。
        // 这种情况绝不能当成"通过"或"小问题 0 条"糊过去——要老实说没评成。
        const last = finishes[finishes.length - 1]
        const failed = !hasSomething && last && last.kind === 'error'
        // 失败时把**正在跑的插件版本**带上（0.9.0）：他遇到过一次"改了没生效"，
        // 卡上直接写版本，就能立刻看出页面/宿主是不是旧的。
        const failNote = failed
          ? '副模型没调通' + (last && last.retried ? '（已自动重试一次）' : '') + '：' + String(last.message || '原因不明').slice(0, 240)
          : ''
        // 被闸打断且啥也没评出来：不能显示成"通过"，要说清楚是哪种没评完
        const cutEmpty = !failed && !hasSomething && (timedOut || idled || cancelled)
        const cutNote = !cutEmpty
          ? ''
          : cancelled
            ? '你点了停止，这次没评完。'
            : idled
              ? '它 ' + idleSec + ' 秒一个字节都没吐（不是慢，是真不动了），自动收手。可在设置里改成「永不收手」。'
              : '评审到点了（' + budgetSec + ' 秒上限），这次没评完。'
        // 有部分输出但没成结果：把"它已经说了什么"一起带回去，别让人只看到一句失败
        const partial = !hasSomething && partialText.length ? truncate(partialText, 1200) : ''
        // 说清了"它到底怎么了"：格式没对上 ≠ 没评 / 没调通
        const parseFailNote = parsed.parseFailed
          ? '它评了，但最后没给出能读的结论格式（内容已经留着，点开看它说了什么）'
          : ''

        // 每次都落盘：以前只有"评出东西"才存，结果"这次通过"卡上的「让主模型读」
        // 会退回去读上一轮的 最新.md —— 主模型读到的是别人的评审（GPT 第三轮 4.4）。
        // demo 探针仍然不落盘。
        // 落盘时把"是谁评的"写进去（他 2026-11-09 晚要的：评审结果和文档都要有署名）。
        // 主刀开着的时候，评的人其实是"原来的主模型" → 角色要标清楚，别让人以为是副模型评的。
        const swapped = !demo && !!(entry && entry.saved && entry.saved.provider && entry.saved.model)
        const reviewer = {
          provider: String(reviewCfg.provider || ''),
          model: String(reviewCfg.model || ''),
          role: swapped ? '原主模型（副模型主刀时互换）' : '副模型',
        }
        /* 1.3.5：这一评是"换了个脑子"，还是"同一双眼睛又看了一遍"？
           主模型从 DSH 的 agent.model.current() 现取；读不到就是 null，卡片上不提示 —— 不猜。 */
        const main = demo ? null : currentMain(sessionId)
        const sameSource = !!(main && sameModel(main, reviewer))
        const saved = demo
          ? ''
          : saveReview(rootDir, parsed, steps, { sessionId, seq: anchor, model: reviewCfg.provider + ' / ' + reviewCfg.model, reviewer, provenance })
        const payload = {
          ok: true,
          topic: parsed.topic,
          verdict: failed || cutEmpty || parsed.parseFailed ? 'error' : parsed.verdict,
          // 一句话说清"到底怎么了"：到点 / 你点了停止 / 没动静 / 格式没对上 / 没调通
          note:
            (failed ? failNote : cutNote || parseFailNote || parsed.note) +
            (failed || cutEmpty || parsed.parseFailed ? '（插件 v' + VERSION + '）' : ''),
          major: parsed.major,
          minor: parsed.minor,
          omitted: parsed.omitted,
          items: [...parsed.major, ...parsed.minor],
          saved,
          reviewer,
          // 1.3.5：主模型是谁、和副模型是不是同一个（同一个＝这次复核基本是自评）
          main,
          sameSource,
          // 1.1.0：引文核验结果（机器查的，不靠模型）。checked=0 就是这一轮它没引你的话
          provenance,
          // 这张卡是哪个版本画出来的（0.9.0 加）—— 他遇到过一次"改了没生效"
          version: VERSION,
          // 这一轮到底花了多久（0.9.1）：5 分钟那种，卡上得看得见
          elapsedMs: Date.now() - startedAt,
          parseFailed: parsed.parseFailed,
          truncated,
          timedOut,
          cancelled,
          // 它已经说出来的那段（没成结果时才有）—— 卡片上可以点开看，不再白花这笔钱
          partial,
          reasoning: job ? truncate(String(job.reasoning || ''), 4000) : '',
          seq: anchor,
          raw: truncate(finalText, 2000),
          steps,
          finishes,
          rows: rows.length,
        }
        if (!demo) cacheSet(dedupeKey, payload)
        if (job) job.done = true
        return sendJson(res, 200, payload)
      } catch (error) {
        // 出错时前端那边 fetch 一回来就停止轮询了，不用在这里收尾
        return sendErr(res, error, { code: error && error.code })
      }
    }

    for (const [p, h] of [
      ['/plugins/dsh-second-review/ping', ping],
      ['/plugins/dsh-second-review/models', models],
      ['/plugins/dsh-second-review/ask', ask],
      ['/plugins/dsh-second-review/config', config],
      ['/plugins/dsh-second-review/progress', progress],
      ['/plugins/dsh-second-review/cancel', cancel],
      ['/plugins/dsh-second-review/swap', swap],
      ['/plugins/dsh-second-review/review', review],
    ]) {
      scope.effect(() => scope.webServer.register({ kind: 'exact', path: p, handler: h }), 'dsh-second-review: ' + p)
    }
  })
}
