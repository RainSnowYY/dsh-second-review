/**
 * 二次评审插件的单元测试（不装 DSH、不调模型、不联网）
 *
 * 跑法：
 *   node --test "DeepSeek 记录中心\SEC插件项目\probe-plugin\test"
 *
 * 只测"纯逻辑"：解析、主次判定、路径闸、黑名单、按轮次截断、只读工具表。
 * 为什么要有：2026-11-09 那次把"黑名单拦不拦得住"只能靠模型自觉，没法自证；
 * 这几条跑过之后，至少这几处逻辑是机器验过的。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'second-review-test-'))
const ROOT = fs.realpathSync(tmp)
fs.mkdirSync(path.join(ROOT, '记忆卡'), { recursive: true })
fs.mkdirSync(path.join(ROOT, '子目录'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'AGENTS.md'), '规则')
fs.writeFileSync(path.join(ROOT, 'AGENTS.md.off'), '规则')
fs.writeFileSync(path.join(ROOT, '记忆卡', '00-核心记忆卡.md'), '私人的')
fs.writeFileSync(path.join(ROOT, '普通文档.md'), '公开的')

const mod = await import(new URL('../index.js', import.meta.url).href)
const { parseReview, sanitizeReview, blockedPath, clipTranscript, transcriptOf, toolsFor, runTool, saveReview, shouldNudge, streamWithRetry, verifyUserQuotes, sameModel, turnOf, usageOfTurn, turnTouched, usageOfFinish, sumUsage, pickProModel, resolveReviewModel, cmpVersion, READ_TOOLS, WRITE_TOOL } = mod

test.after(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {}
})

/* ---------------- 解析 ---------------- */

test('新格式：pass 就是通过，没有任何条目', () => {
  const r = parseReview('{"verdict":"pass","note":"没毛病"}')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.major.length, 0)
  assert.equal(r.minor.length, 0)
  assert.equal(r.note, '没毛病')
  assert.equal(r.parseFailed, false)
})

test('新格式：大问题、小问题分开，verdict 跟着大问题走', () => {
  const raw = JSON.stringify({
    major: [{ category: '风险提示', point: '删了回不来' }],
    minor: [{ category: '补充', point: '漏了个格式' }],
  })
  const r = parseReview(raw)
  assert.equal(r.verdict, 'major')
  assert.equal(r.major.length, 1)
  assert.equal(r.minor.length, 1)
})

test('新格式：只有小问题 → verdict 是 minor', () => {
  const r = parseReview('{"major":[],"minor":[{"category":"补充","point":"措辞"}]}')
  assert.equal(r.verdict, 'minor')
})

test('新格式：模型嘴上说 pass、却塞了大问题 → 以大问题为准', () => {
  const r = parseReview('{"verdict":"pass","major":[{"category":"质疑","point":"数字是编的"}]}')
  assert.equal(r.verdict, 'major')
})

test('新格式：多余的空条目和坏条目被丢掉', () => {
  const r = parseReview('{"major":[null,{"point":123},{"category":"补充"}],"minor":[]}')
  assert.equal(r.major.length, 0)
  assert.equal(r.verdict, 'pass')
})

test('新格式：最多留 3 条', () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ category: '补充', point: '第 ' + n + ' 条' }))
  const r = parseReview(JSON.stringify({ major: items }))
  assert.equal(r.major.length, 3)
})

test('七类之外的一律归到「风险提示」', () => {
  const r = parseReview('{"major":[{"category":"我觉得","point":"x"}]}')
  assert.equal(r.major[0].category, '风险提示')
})

test('旧格式 items 也认：severity 3 是大问题，1~2 是小问题', () => {
  const raw = JSON.stringify({
    items: [
      { category: '风险提示', point: '必须改', severity: 3 },
      { category: '补充', point: '可改可不改', severity: 1 },
    ],
  })
  const r = parseReview(raw)
  assert.equal(r.verdict, 'major')
  assert.equal(r.major.length, 1)
  assert.equal(r.minor.length, 1)
  assert.equal(r.major[0].point, '必须改')
})

test('旧格式 items：中间夹一条坏的，后面的 severity 不能错位（1.0.1 / 小K #1）', () => {
  const raw = JSON.stringify({
    items: [
      { point: '第一条是大问题', severity: 3 },
      { nope: '缺 point，normItem 会返回 null' },
      { point: '第三条是小问题', severity: 1 },
    ],
  })
  const r = parseReview(raw)
  assert.equal(r.parseFailed, false)
  assert.equal(r.major.length, 1)
  assert.equal(r.major[0].point, '第一条是大问题', '大问题不能被挤到小问题里去')
  assert.equal(r.minor.length, 1)
  assert.equal(r.minor[0].point, '第三条是小问题')
})

test('不是 JSON（模型跑题了）→ parseFailed，服务端会再催一次', () => {
  assert.equal(parseReview('我觉得这段挺好的，没什么问题。').parseFailed, true)
  assert.equal(parseReview('').parseFailed, true)
  assert.equal(parseReview('{"major":').parseFailed, true)
})

test('JSON 前后裹了废话也能捞出来', () => {
  const r = parseReview('好的，结论如下：\n{"verdict":"pass"}\n以上。')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.parseFailed, false)
})

/* ---------------- 工具表：只读 ---------------- */

test('写文件默认拿不到；只有手动开了才递（2026-11-09 他选的 B）', () => {
  const off = toolsFor(false).map((t) => t.name)
  assert.deepEqual(off.sort(), ['find_files', 'list_dir', 'read_file', 'search_text'].sort())
  assert.equal(off.includes('write_file'), false)

  const on = toolsFor(true).map((t) => t.name)
  assert.equal(on.includes('write_file'), true)

  assert.equal(WRITE_TOOL.name, 'write_file')
  assert.equal(READ_TOOLS.some((t) => t.name === 'write_file'), false, '读工具里不该混进写')
})

test('执行层的第二道门：开关关着时，write_file 就算被调用也拒绝', () => {
  const target = path.join(ROOT, '被写.md')
  const denied = runTool(ROOT, 'write_file', { path: '被写.md', content: 'x' }, false)
  assert.equal(denied.isError, true)
  assert.equal(fs.existsSync(target), false, '拒绝之后不该落一个文件')

  const ok = runTool(ROOT, 'write_file', { path: '被写.md', content: '明白' }, true)
  assert.equal(ok.isError, false)
  assert.equal(fs.readFileSync(target, 'utf8'), '明白')

  // 就算开了写，私人文件照样不许改
  const privateFile = runTool(ROOT, 'write_file', { path: '记忆卡/00-核心记忆卡.md', content: '篡改' }, true)
  assert.equal(privateFile.isError, true)
  assert.equal(fs.readFileSync(path.join(ROOT, '记忆卡', '00-核心记忆卡.md'), 'utf8'), '私人的')

  fs.rmSync(target, { force: true })
})

/* ---------------- 1.5.3：大文件 / 原子写（第二轮评审的 P2） ---------------- */

test('read_file 先看大小：超过 4MB 直接拒，不整份读进内存', () => {
  const big = path.join(ROOT, '大日志.log')
  fs.writeFileSync(big, 'x'.repeat(4 * 1024 * 1024 + 16), 'utf8')
  const r = runTool(ROOT, 'read_file', { path: '大日志.log' }, false)
  assert.equal(r.isError, true)
  assert.ok(String(r.text).includes('4 MB'), '要说清是大小上限：' + r.text)
  fs.rmSync(big, { force: true })
})

test('read_file 拒二进制（不去把 NUL 解码成一堆乱码）', () => {
  const bin = path.join(ROOT, '图片.png')
  fs.writeFileSync(bin, Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47, 0x00, 0x01, 0x02]))
  const r = runTool(ROOT, 'read_file', { path: '图片.png' }, false)
  assert.equal(r.isError, true)
  assert.ok(String(r.text).includes('二进制'), '要说清是二进制：' + r.text)
  fs.rmSync(bin, { force: true })
})

test('write_file 是原子写：写成功没有残留临时文件，内容读回来一模一样', () => {
  const rel = '原子写.md'
  const abs = path.join(ROOT, rel)
  const body = '第一行\n第二行\n'.repeat(50)
  const r = runTool(ROOT, 'write_file', { path: rel, content: body }, true)
  assert.equal(r.isError, false)
  assert.equal(fs.readFileSync(abs, 'utf8'), body)
  const left = fs.readdirSync(ROOT).filter((n) => n.startsWith('.sec-write-'))
  assert.equal(left.length, 0, '不该留下临时文件：' + left.join(','))
  fs.rmSync(abs, { force: true })
})

/* ---------------- 1.5.4：更新检查的版本比较 ---------------- */

test('cmpVersion：x.y.z 三段数字比大小', () => {
  assert.equal(cmpVersion('1.5.4', '1.5.3'), 1, '新版 > 旧版')
  assert.equal(cmpVersion('1.5.3', '1.5.4'), -1, '旧版 < 新版')
  assert.equal(cmpVersion('1.5.4', '1.5.4'), 0, '一样就是 0')
  assert.equal(cmpVersion('1.6.0', '1.5.99'), 1, '次版本优先')
  assert.equal(cmpVersion('2.0.0', '1.99.99'), 1, '主版本优先')
  assert.equal(cmpVersion('1.5.4-beta.1', '1.5.3'), 1, '预发布后缀不参与比较')
  assert.equal(cmpVersion('1.5.10', '1.5.9'), 1, '按数字比，不是按字符串比')
  assert.equal(cmpVersion('', '1.5.4'), -1, '空版本当 0.0.0')
})

/* ---------------- 黑名单 ---------------- */

test('AGENTS.md 和它的禁用版都不许碰', () => {
  assert.equal(blockedPath(ROOT, path.join(ROOT, 'AGENTS.md')), true)
  assert.equal(blockedPath(ROOT, path.join(ROOT, 'AGENTS.md.off')), true)
})

test('记忆卡整个目录都不许碰（含里面的每一份）', () => {
  assert.equal(blockedPath(ROOT, path.join(ROOT, '记忆卡')), true)
  assert.equal(blockedPath(ROOT, path.join(ROOT, '记忆卡', '00-核心记忆卡.md')), true)
})

test('子目录里的 AGENTS.md 也不许碰', () => {
  assert.equal(blockedPath(ROOT, path.join(ROOT, '子目录', 'AGENTS.md')), true)
})

test('普通文档照常放行', () => {
  assert.equal(blockedPath(ROOT, path.join(ROOT, '普通文档.md')), false)
  assert.equal(blockedPath(ROOT, path.join(ROOT, '子目录', '随便.md')), false)
})

test('名字像但不是：AGENTS.md.bak、记忆卡说明.md 不拦（宁可放行普通文件）', () => {
  assert.equal(blockedPath(ROOT, path.join(ROOT, 'AGENTS.md.bak')), false)
  assert.equal(blockedPath(ROOT, path.join(ROOT, '记忆卡说明.md')), false)
})

test('换个工作区，判断跟着换（根不是全局的）', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'second-review-other-'))
  try {
    fs.mkdirSync(path.join(other, '记忆卡'), { recursive: true })
    fs.writeFileSync(path.join(other, 'AGENTS.md'), '另一个工作区的规则')
    fs.writeFileSync(path.join(other, '公开.md'), 'ok')
    // 子目录里的 AGENTS.md 在 A 工作区是私人的；但换成 other 根时，同一个绝对路径就该被拦 …
    // 反过来：other 里的 AGENTS.md 用 other 当根要拦，用 ROOT 当根则属于工作区外，也拦。
    assert.equal(blockedPath(other, path.join(other, 'AGENTS.md')), true)
    assert.equal(blockedPath(other, path.join(other, '公开.md')), false)
    assert.equal(blockedPath(ROOT, path.join(other, '公开.md')), true, '工作区外的路径一律拦')
  } finally {
    fs.rmSync(other, { recursive: true, force: true })
  }
})

test('符号链接指向记忆卡 → 按真实路径拦住（GPT 指出的绕过）', (t) => {
  const link = path.join(ROOT, '看起来是普通目录')
  try {
    fs.symlinkSync(path.join(ROOT, '记忆卡'), link, 'junction')
  } catch {
    t.skip('这台机器不让建符号链接／junction（需要管理员或开发者模式）')
    return
  }
  try {
    assert.equal(blockedPath(ROOT, path.join(link, '00-核心记忆卡.md')), true)
    // 也拦指向工作区外的链接
    const outLink = path.join(ROOT, 'out-link')
    try {
      fs.symlinkSync(os.tmpdir(), outLink, 'junction')
      assert.equal(blockedPath(ROOT, path.join(outLink, 'anything.md')), true)
    } catch {}
  } finally {
    try {
      fs.rmSync(link, { recursive: true, force: true })
    } catch {}
  }
})

test('通过目录联接**新建**文件 → 也拦住，且一个字节都没落进记忆卡', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-link-write-'))
  const priv = path.join(root, '记忆卡')
  fs.mkdirSync(priv, { recursive: true })
  fs.writeFileSync(path.join(priv, '00-核心记忆卡.md'), 'PRIVATE', 'utf8')
  const link = path.join(root, 'alias')
  try {
    fs.symlinkSync(priv, link, 'junction')
  } catch {
    fs.rmSync(root, { recursive: true, force: true })
    t.skip('这台机器不让建 junction')
    return
  }
  try {
    const r = runTool(root, 'write_file', { path: 'alias/new.md', content: 'x' }, true)
    assert.equal(r.isError, true, '通过联接写新文件必须拒绝')
    assert.equal(fs.existsSync(path.join(priv, 'new.md')), false, '不许真的写进记忆卡')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

/* ---------------- 按轮次截断 ---------------- */
test('评审只读到你点的那一轮：后面的记录不进上下文', () => {
  const session = {
    log: {
      '13': { seq: 13, type: 'assistant/message', data: { content: [{ type: 'text', text: '第二答' }] } },
      '10': { seq: 10, type: 'user/message', data: { content: [{ type: 'text', text: '第一问' }] } },
      '12': { seq: 12, type: 'user/message', data: { content: [{ type: 'text', text: '第二问' }] } },
      '11': { seq: 11, type: 'assistant/message', data: { content: [{ type: 'text', text: '第一答' }] } },
    },
  }
  const upTo11 = transcriptOf(session, 11)
  assert.equal(upTo11.length, 2)
  assert.equal(upTo11[0].text, '第一问')
  assert.equal(upTo11[1].text, '第一答')
  assert.equal(upTo11.some((r) => r.text.includes('第二')), false)

  const all = transcriptOf(session, null)
  assert.equal(all.length, 4)
  assert.equal(all[3].text, '第二答')
})

test('按轮次截断：给的 seq 在这一轮之前 → 不会把后面的内容混进来', () => {
  const session = {
    log: {
      a: { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '早' }] } },
      b: { seq: 2, type: 'assistant/message', data: { content: [{ type: 'text', text: '早答' }] } },
      c: { seq: 3, type: 'user/message', data: { content: [{ type: 'text', text: '晚' }] } },
    },
  }
  assert.deepEqual(
    transcriptOf(session, 2).map((r) => r.text),
    ['早', '早答'],
  )
})

/* ---------------- 长对话 ---------------- */

test('长对话：没超上限就一个字不动', () => {
  const r = clipTranscript('短对话', 100)
  assert.equal(r.truncated, false)
  assert.equal(r.text, '短对话')
})

test('长对话：超了就只留最后一段，并标「早期已截断」', () => {
  const long = 'A'.repeat(500) + '尾巴在这里'
  const r = clipTranscript(long, 100)
  assert.equal(r.truncated, true)
  // 1.0.1（小K #2）：提示必须在开头——放末尾会被模型当成对话正文的一部分
  assert.ok(r.text.startsWith('（早期内容已截断）'), '提示要在开头')
  // 而且要连提示一起算进 limit，不然总长会超，卡在 context 上限的模型会被直接拒
  assert.ok(r.text.length <= 100, '总长度不能超过 limit')
  assert.ok(r.text.includes('尾巴在这里'), '留的应该是最近的那一段')
})

test('长对话：开头被丢掉，不会把最老的塞进上下文', () => {
  const long = '开头很重要' + 'B'.repeat(500)
  const r = clipTranscript(long, 100)
  assert.equal(r.text.includes('开头很重要'), false)
})

/* ---------------- 他 2026-11-09 补的评审标准：不准磨洋工 ---------------- */

test('评审先说清"评的是哪一轮"', () => {
  const r = parseReview('{"topic":"修 0.4.0 的写文件开关","verdict":"pass"}')
  assert.equal(r.topic, '修 0.4.0 的写文件开关')
})

test('说不出一针见血（没有 impact）的小问题 → 丢掉，整轮变通过', () => {
  const r = sanitizeReview(
    parseReview(JSON.stringify({ topic: '测噪音过滤', minor: [{ category: '补充', point: '措辞可以更好' }] })),
  )
  assert.equal(r.minor.length, 0)
  assert.equal(r.verdict, 'pass')
})

test('带 impact 的小问题留下，但最多一条', () => {
  const r = sanitizeReview(
    parseReview(
      JSON.stringify({
        minor: [
          { category: '补充', point: 'a', impact: '会多花一次钱' },
          { category: '补充', point: 'b', impact: '会白跑一趟' },
        ],
      }),
    ),
  )
  assert.equal(r.minor.length, 1)
  assert.equal(r.verdict, 'minor')
})

test('"越权／擅自／应该先问"这种评语不写（minor 直接丢；major 没说到实际损害也丢）', () => {
  const r = sanitizeReview(
    parseReview(
      JSON.stringify({
        topic: '测噪音过滤',
        minor: [{ category: '质疑', point: '助手越权了，应该先问用户', impact: '不符合流程' }],
        major: [{ category: '质疑', point: '助手擅自继续，没有先确认', impact: '流程不规范' }],
      }),
    ),
  )
  assert.equal(r.major.length, 0)
  assert.equal(r.minor.length, 0)
  assert.equal(r.verdict, 'pass')
})

test('"擅自删了文件"这种真损害要留（不能一刀切）', () => {
  const r = sanitizeReview(
    parseReview(JSON.stringify({ major: [{ category: '风险提示', point: '助手擅自删除了整个目录', impact: '文件找不回来' }] })),
  )
  assert.equal(r.major.length, 1)
  assert.equal(r.verdict, 'major')
})

test('路径／拼写类 nitpick：没依据就丢，有依据才留', () => {
  const noEvidence = sanitizeReview(
    parseReview(JSON.stringify({ minor: [{ category: '补充', point: '文件名的大小写写错了', impact: '看着不规范' }] })),
  )
  assert.equal(noEvidence.minor.length, 0)

  const withEvidence = sanitizeReview(
    parseReview(
      JSON.stringify({
        minor: [
          {
            category: '补充',
            point: '配置里的文件名写成了旧名',
            evidence: '助手写的是 config.old，实际叫 config.json',
            impact: '按它改会找不到文件',
          },
        ],
      }),
    ),
  )
  assert.equal(withEvidence.minor.length, 1)
})

test('大问题最多两条，同一句不重复', () => {
  const r = sanitizeReview(
    parseReview(
      JSON.stringify({
        major: [
          { point: '删了回不来', impact: '丢数据' },
          { point: '删了回不来', impact: '丢数据' },
          { point: '数字没来源', impact: '判断错' },
          { point: '第三件事', impact: '返工' },
        ],
      }),
    ),
  )
  assert.equal(r.major.length, 2)
})

test('被条数上限挤掉的要报数，不能悄悄丢', () => {
  const r = sanitizeReview(
    parseReview(
      JSON.stringify({
        topic: '测封顶',
        major: [
          { point: '甲', impact: '丢数据' },
          { point: '乙', impact: '返工' },
          { point: '丙', impact: '白花钱' },
        ],
        minor: [
          { point: '丁', impact: '少走一步' },
          { point: '戊', impact: '少走两步' },
        ],
      }),
    ),
  )
  assert.equal(r.major.length, 2)
  assert.equal(r.minor.length, 1)
  assert.deepEqual(r.omitted, { major: 1, minor: 1 })
})

test('说不出这一轮在评什么 → unclear，不冒充通过', () => {
  const r = sanitizeReview(parseReview(JSON.stringify({ verdict: 'pass' })))
  assert.equal(r.verdict, 'unclear')

  const named = sanitizeReview(parseReview(JSON.stringify({ topic: '装插件', verdict: 'pass' })))
  assert.equal(named.verdict, 'pass')
})

test('解析失败不能被过滤成"通过"（要保留 error）', () => {
  const r = sanitizeReview(parseReview('我觉得这段挺好的。'))
  assert.equal(r.verdict, 'error')
  assert.equal(r.parseFailed, true)
})

test('模型一直不吐字 → 到点也必须收手（硬超时，不是只在收到块时查）', async () => {
  const llm = {
    stream: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true }) }),
    }),
  }
  const t0 = Date.now()
  const r = await streamWithRetry(llm, [], [], { provider: 'p', model: 'm' }, undefined, t0 + 150)
  const spent = Date.now() - t0
  assert.equal(r.finish && r.finish.kind, 'timeout')
  assert.ok(spent < 3000, '不该一直挂着（实际 ' + spent + 'ms）')
})

/* ---- 0.9.0：45 秒总时长闸拆掉之后的三条底线 ---- */

test('不设总时长（deadline=0）时，慢但一直在吐字的不许被打断', async () => {
  // 每块之间隔 80ms，总共吐 6 块 ≈ 480ms：旧版 45 秒闸不会碰它，但"deadline=0 被当成 45 秒"会
  const llm = {
    stream: () => ({
      [Symbol.asyncIterator]: () => {
        let i = 0
        return {
          next: async () => {
            await new Promise((r) => setTimeout(r, 80))
            i++
            if (i > 6) return { done: true }
            return { done: false, value: { type: 'text-delta', index: 0, text: 'x' } }
          },
          return: async () => ({ done: true }),
        }
      },
    }),
  }
  const r = await streamWithRetry(llm, [], [], { provider: 'p', model: 'm' }, undefined, 0)
  assert.equal(r.text, 'xxxxxx', '慢但没卡住，就该把话听完')
  assert.notEqual(r.finish && r.finish.kind, 'timeout')
})

test('空闲闸：连续没动静才收手，已经吐出来的字保留', async () => {
  // 先吐 2 块，然后永远不动 —— 空闲闸 120ms 应该收手，且 text 里那两个字还在
  const llm = {
    stream: () => ({
      [Symbol.asyncIterator]: () => {
        let i = 0
        return {
          next: async () => {
            i++
            if (i <= 2) return { done: false, value: { type: 'text-delta', index: 0, text: '话' } }
            return new Promise(() => {})
          },
          return: async () => ({ done: true }),
        }
      },
    }),
  }
  const t0 = Date.now()
  const r = await streamWithRetry(llm, [], [], { provider: 'p', model: 'm' }, undefined, 0, { idleMs: 120 })
  assert.equal(r.finish && r.finish.kind, 'idle')
  assert.equal(r.text, '话话', '被打断时已经说出来的那段不能丢')
  assert.ok(Date.now() - t0 < 3000)
})

test('点了停止 → 立刻收手，kind=cancel，已有的字保留', async () => {
  let stop = false
  const llm = {
    stream: () => ({
      [Symbol.asyncIterator]: () => {
        let i = 0
        return {
          next: async () => {
            i++
            if (i === 3) stop = true // 第三块之后用户点了停止
            return { done: false, value: { type: 'text-delta', index: 0, text: '中' } }
          },
          return: async () => ({ done: true }),
        }
      },
    }),
  }
  const r = await streamWithRetry(llm, [], [], { provider: 'p', model: 'm' }, undefined, 0, { shouldStop: () => stop })
  assert.equal(r.finish && r.finish.kind, 'cancel')
  assert.equal(r.text, '中中中')
})

/* ---- 0.9.1：解析要经得起"正文里贴了代码" ---- */

test('结论包在 ```json 围栏里也认得出来', () => {
  const r = parseReview('它先说了一堆话。\n\n```json\n{"topic":"这一轮在改闸","verdict":"pass","major":[],"minor":[]}\n```\n')
  assert.equal(r.parseFailed, false)
  assert.equal(r.topic, '这一轮在改闸')
  assert.equal(r.verdict, 'pass')
})

test('正文里贴了带花括号的代码，也要挑出真正那份结论', () => {
  const text = [
    '我看了代码：`function f() { return { a: 1 } }` 这里没问题。',
    '另外这段 `{ "foo": "bar" }` 是别的 JSON。',
    '结论：',
    '{"topic":"审这一轮","verdict":"major","major":[{"category":"容错率","point":"会丢内容","impact":"白花钱"}],"minor":[]}',
  ].join('\n')
  const r = parseReview(text)
  assert.equal(r.parseFailed, false)
  assert.equal(r.topic, '审这一轮')
  assert.equal(r.verdict, 'major')
  assert.equal(r.major.length, 1)
})

test('真的一句 JSON 都没有 → 仍然老实报 parseFailed（不编）', () => {
  const r = parseReview('我觉得这个方案还行，主要是注意一下备份就好了。')
  assert.equal(r.parseFailed, true)
  assert.equal(r.verdict, 'error')
})

test('最后一轮只调了工具、一个字没吐 → 也必须去补救（0.9.0 的 bug 就死在这）', () => {
  // 解析失败、正文为空 —— 以前因为"正文不足 40 字"跳过补救，直接报没评成
  const empty = parseReview('')
  assert.equal(empty.parseFailed, true)
  assert.equal(shouldNudge(empty, false), true, '正文为空也要补救')
  // 已经点了停止就不必再花一次钱
  assert.equal(shouldNudge(empty, true), false)
  // 解析成功当然不补救
  const ok = parseReview('{"topic":"x","verdict":"pass","major":[],"minor":[]}')
  assert.equal(shouldNudge(ok, false), false)
})

test('记录没写 seq 时，截断边界也按日志行号算（不许"永远算数"）', () => {
  const session = {
    log: {
      '10': { type: 'user/message', data: { content: [{ type: 'text', text: '第一问' }] } },
      '11': { type: 'assistant/message', data: { content: [{ type: 'text', text: '第一答' }] } },
      '12': { seq: 12, type: 'user/message', data: { content: [{ type: 'text', text: '第二问' }] } },
    },
  }
  const rows = transcriptOf(session, 11)
  assert.equal(rows.length, 2, '没 seq 的 12 也必须被截掉')
})

test('写多级新目录：看最近一个已存在的父目录（以前会误拒），越界仍拒', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-mkdir-'))
  try {
    const ok = runTool(root, 'write_file', { path: 'a/b/c.md', content: 'x' }, true)
    assert.equal(ok.isError, false, ok.text)
    assert.ok(fs.existsSync(path.join(root, 'a', 'b', 'c.md')))
    const out = runTool(root, 'write_file', { path: '../escape.md', content: 'x' }, true)
    assert.equal(out.isError, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

/* ---------------- 落盘 ---------------- */

test('落盘 md 写明"评的是"和"影响"，并另存一份 最新.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-save-'))
  try {
    const saved = saveReview(
      dir,
      {
        topic: '看这一轮',
        verdict: 'major',
        note: '一句话',
        major: [{ category: '风险提示', point: '删了回不来', evidence: '原句', impact: '丢文件' }],
        minor: [],
      },
      [],
      { sessionId: 's1', seq: 12, model: 'x / y' },
    )
    assert.ok(saved.endsWith('.md'))
    const text = fs.readFileSync(path.join(dir, saved), 'utf8')
    assert.match(text, /评的是：看这一轮/)
    assert.match(text, /影响：丢文件/)
    assert.match(text, /评到第几轮：seq 12/)
    assert.ok(fs.existsSync(path.join(dir, '二次评审', '最新.md')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('落盘 md 带署名：哪个模型、哪家、什么角色（换副模型时能分清）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-sign-'))
  try {
    const saved = saveReview(
      dir,
      { topic: '看这一轮', verdict: 'pass', note: '', major: [], minor: [] },
      [],
      {
        sessionId: 's1',
        seq: 3,
        model: 'deepseek-account / deepseek-flash',
        reviewer: { provider: 'deepseek-account', model: 'deepseek-flash', role: '副模型' },
      },
    )
    const text = fs.readFileSync(path.join(dir, saved), 'utf8')
    // 头部一行、文末一行，两处都要有
    assert.match(text, /- 署名：deepseek-flash（deepseek-account） · 副模型/)
    assert.match(text, /> 本评审由 \*\*deepseek-flash\*\*（deepseek-account） 生成 · 副模型/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------- 断流重试 ---------------- */

test('副模型断一次 → 自动重试一次，最后能拿到结果', async () => {
  let calls = 0
  const llm = {
    async *stream() {
      calls++
      if (calls === 1) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
        return
      }
      yield { type: 'text-delta', index: 0, text: '{"verdict":"pass"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const r = await streamWithRetry(llm, [], [], {}, undefined, Date.now() + 10000)
  assert.equal(calls, 2)
  assert.equal(r.retried, true)
  assert.equal(r.finish.kind, 'stop')
  assert.match(r.text, /verdict/)
})

test('正常结束不重试（不多花一次钱）', async () => {
  let calls = 0
  const llm = {
    async *stream() {
      calls++
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const r = await streamWithRetry(llm, [], [], {}, undefined, Date.now() + 10000)
  assert.equal(calls, 1)
  assert.equal(r.retried, undefined)
})

/* ---------------- 引文核验（1.1.0，来路：记录中心\小问的bug.md） ---------------- */

test('引文核验：引的话在会话记录里有出处 → 通过', () => {
  const rows = [
    { role: '用户', text: '把信回了 然后收尾' },
    { role: '助手', text: '你说「把信回了 然后收尾」，我就回了，也收尾了。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 1)
  assert.equal(r.found, 1)
  assert.equal(r.missing.length, 0)
})

test('引文核验：编出来的"你的话" → 当场标出来（小问 15:04 那条）', () => {
  const rows = [
    { role: '用户', text: '把信回了 然后收尾' },
    { role: '助手', text: '你刚才说「我什么时候说让你回信了 我让你收尾」，所以我删了写好的信。' },
    { role: '助手', text: '你说过「把信回了」，我照做。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 2)
  assert.equal(r.found, 1)
  assert.equal(r.missing.length, 1)
  assert.match(r.missing[0], /我什么时候说让你回信了/)
})

test('引文核验：引歪一两个字（漏字／标点）仍算有出处', () => {
  const rows = [
    { role: '用户', text: '把一份需求核对表逐条对一遍，别漏。' },
    { role: '助手', text: '你说过「把需求核对表逐条对一遍别漏」，我已经逐条对完了。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 1)
  assert.equal(r.missing.length, 0, '引歪一两个字不该报警：' + JSON.stringify(r.missing))
})

test('引文核验：引自己／引文件不查（没有"你说"这种归属词）', () => {
  const rows = [
    { role: '用户', text: '看看这个' },
    { role: '助手', text: '文件里写着「不要动记忆卡」，我按这个来的；我说过「马上改」。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 0)
})

test('引文核验：术语引号不算"你说的"（20:53 那 5 条误报的回归）', () => {
  const rows = [
    { role: '用户', text: '做成玻璃质感 动画也可以开始了' },
    {
      role: '助手',
      text: '只查"它说这是你说的"的那种引文：引号前后 40 字里要有「你说／你要求／你刚才／用户说…」，还有「引文核验」这个功能；「核对引文」是设置页那一条，「你会说的话」也不是引文。',
    },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 0, '术语引号不该被核：' + JSON.stringify(r.missing))
})

test('引文核验：只核这一轮那条回复，旧回复里的引号不算', () => {
  const rows = [
    { role: '用户', text: '第一件事' },
    { role: '助手', text: '你说「第一件事」，我做了。' },
    { role: '用户', text: '第二件事' },
    { role: '助手', text: '第二件事也做了。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 0, '旧回复不该被算进来')
})

test('引文核验：紧挨着的归属词都认得（你说过／你刚才说／你的原话是）', () => {
  const rows = [
    { role: '用户', text: '把信回了 然后收尾' },
    { role: '助手', text: '你说过「把信回了」；你刚才说「然后收尾」；你的原话是「把信回了 然后收尾」。' },
  ]
  const r = verifyUserQuotes(rows)
  assert.equal(r.checked, 3)
  assert.equal(r.found, 3)
  assert.equal(r.missing.length, 0, JSON.stringify(r.missing))
})

test('落盘 md 带引文核验一节', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-prov-'))
  try {
    const saved = saveReview(
      dir,
      { topic: '看这一轮', verdict: 'pass', note: '', major: [], minor: [] },
      [],
      { sessionId: 's1', seq: 3, model: 'x / y', provenance: { checked: 2, found: 1, missing: ['我什么时候说让你回信了'], userCount: 5 } },
    )
    const text = fs.readFileSync(path.join(dir, saved), 'utf8')
    assert.match(text, /## 引文核验（机器核对）/)
    assert.match(text, /找不到出处/)
    assert.match(text, /我什么时候说让你回信了/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------- 1.3.5：主副模型是不是同一个 ---------------- */

test('同一个模型：忽略大小写和首尾空格', () => {
  assert.equal(sameModel({ provider: 'deepseek-account', model: 'deepseek-flash' }, { provider: 'deepseek-account', model: ' DeepSeek-Flash ' }), true)
})

test('同一个模型名、provider 不同也算同一个（还是同一双眼睛）', () => {
  assert.equal(sameModel({ provider: 'a', model: 'deepseek-flash' }, { provider: 'b', model: 'deepseek-flash' }), true)
})

test('不同模型不算；缺模型也不算（宁可不说，不许瞎说）', () => {
  assert.equal(sameModel({ provider: 'a', model: 'deepseek-flash' }, { provider: 'a', model: 'deepseek-pro' }), false)
  assert.equal(sameModel({ provider: 'a', model: '' }, { provider: 'a', model: '' }), false)
  assert.equal(sameModel(null, { provider: 'a', model: 'deepseek-flash' }), false)
  assert.equal(sameModel(undefined, undefined), false)
})

test('也吃字符串（别的地方可能只传模型名）', () => {
  assert.equal(sameModel('deepseek-flash', { model: 'deepseek-flash' }), true)
  assert.equal(sameModel('deepseek-flash', 'deepseek-pro'), false)
})

/* ---------------- 1.3.6：账从日志里算（不调模型）＋自动评审闸门 ---------------- */

function fakeSession(extra = {}) {
  return {
    log: {
      1: { type: 'user/message', seq: 1, data: { turn: 1 } },
      2: { type: 'assistant/message', seq: 2, data: { turn: 1, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, totalTokens: 15 } } },
      3: { type: 'tool/call', seq: 3, data: { turn: 1, name: 'read_file', arguments: '{}' } },
      4: { type: 'assistant/message', seq: 4, data: { turn: 1, usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 1, totalTokens: 27 } } },
      ...extra,
    },
  }
}

test('轮次：按被评的那条消息往前找 turn', () => {
  assert.equal(turnOf(fakeSession(), 4), 1)
  assert.equal(turnOf(fakeSession(), 2), 1)
  assert.equal(turnOf({ log: {} }, 4), null)
})

test('这一轮主模型用了多少 token：按 turn 加总，不调模型', () => {
  const u = usageOfTurn(fakeSession(), 4)
  assert.equal(u.input, 30)
  assert.equal(u.output, 12)
  assert.equal(u.cacheRead, 4)
  assert.equal(u.messages, 2)
  assert.equal(usageOfTurn({ log: {} }, 4), null)
})

test('闸门：只读工具不算动手', () => {
  assert.equal(turnTouched(fakeSession(), 4), false)
})

test('闸门：写文件／跑命令／工作区变动都算动手', () => {
  assert.equal(turnTouched(fakeSession({ 3: { type: 'tool/call', seq: 3, data: { turn: 1, name: 'write_file' } } }), 4), true)
  assert.equal(turnTouched(fakeSession({ 3: { type: 'tool/call', seq: 3, data: { turn: 1, name: 'pwsh' } } }), 4), true)
  assert.equal(turnTouched(fakeSession({ 5: { type: 'workspace/changes', seq: 5, data: { turn: 1 } } }), 4), true)
})

test('评审自己的用量：finish 里带就取，几种形状都认，没有就 null（不许估）', () => {
  assert.deepEqual(usageOfFinish({ usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 } }), {
    input: 100,
    output: 20,
    cacheRead: 900,
    cacheWrite: 0,
    total: 120,
  })
  assert.equal(usageOfFinish({ message: { usage: { input_tokens: 5, output_tokens: 6 } } }).total, 11)
  assert.equal(usageOfFinish({ kind: 'completed' }), null)
  assert.equal(usageOfFinish(null), null)
})

test('多步评审的用量按次相加', () => {
  const sum = sumUsage([
    { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
    null,
    { input: 50, output: 5, cacheRead: 30, cacheWrite: 0, total: 55 },
  ])
  assert.equal(sum.input, 150)
  assert.equal(sum.output, 25)
  assert.equal(sum.cacheRead, 30)
  assert.equal(sumUsage([null, undefined]), null)
  assert.equal(sumUsage([]), null)
})

/* ---------------- 1.3.6：默认副模型＝自动 Pro 档 ---------------- */

test('从模型清单里挑 Pro 档', () => {
  const list = [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro', name: 'V4-Pro' }]
  assert.equal(pickProModel(list), 'deepseek-v4-pro')
})

test('出了新一代 Pro，自动选新的（DSH 升级不用改设置）', () => {
  assert.equal(pickProModel(['deepseek-v4-pro', 'deepseek-v4.1-pro']), 'deepseek-v4.1-pro')
  assert.equal(pickProModel([{ id: 'deepseek-v5-pro' }, { id: 'deepseek-v4.1-pro' }]), 'deepseek-v5-pro')
})

test('清单里没有 Pro：不乱选一个便宜的充数', () => {
  assert.equal(pickProModel(['deepseek-flash']), '')
  assert.equal(pickProModel([]), '')
  assert.equal(pickProModel(null), '')
})

test('手动指定模型时不去查清单、也不改人家的选择', async () => {
  let called = 0
  const llm = { listModels: async () => (called++, []) }
  assert.equal(await resolveReviewModel(llm, { provider: 'x', model: 'my-model', modelAuto: false }), 'my-model')
  assert.equal(called, 0)
})

test('自动档但查不到清单：退回配置里的 id，不报错', async () => {
  const llm = { listModels: async () => { throw new Error('offline') } }
  assert.equal(await resolveReviewModel(llm, { provider: 'x', model: 'deepseek-v4-pro', modelAuto: true }), 'deepseek-v4-pro')
})
