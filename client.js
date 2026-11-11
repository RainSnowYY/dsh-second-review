/**
 * dsh-second-review — 客户端（原探针 dsh-second-review-probe，1.0.0 起改名）
 *
 * v3（2026-11-08 深夜）：
 *  - 评审挂在每一轮回复下面的 turnTail 里，样式跟正文一致
 *  - 设置页：副模型 + 自动评审开关（注册在「插件 → 二次评审 → 配置」）
 *  - 自动评审：回复到达后自动评一次；页面刷新时不会把历史轮次全部重评
 *  - 「发给主模型」已摘除（它会把会话搞死，见 02 §三）
 */

window.__ModuleLoader__.load({
  id: 'dsh-second-review',
  factory(require) {
    const React = require('react')
    const { useState, useEffect } = React
    const API = '/plugins/dsh-second-review'

    const CAT_COLOR = {
      补充: '#3b82f6',
      合理性: '#8b5cf6',
      可行性: '#10b981',
      容错率: '#f59e0b',
      质疑: '#ef4444',
      代价: '#ec4899',
      风险提示: '#f97316',
    }

    /* 字号（2026-11-08 22:57 他亲口要求）：
       卡片里最小的字，也不能比主正文再小超过"1 号"——
       正文是 1em，0.9em 就当"小一号"，这是全程下限，任何地方不许再往下走。
       用 em 而不是 px，他自己调了系统/界面字号，卡片跟着一起变。 */
    const FS = { body: '1em', small: '0.95em', min: '0.9em' }

    /* ---------------- 玻璃（方案 B：搬「开关」，不搬代码） ----------------
       壁纸插件 dsh-plugin-wallpaper-engine 把玻璃参数写成 <body> 上的 CSS 变量，
       body 下面所有元素都能读到。我们只读这几个：
         --we-glass-color  玻璃釉色      --we-glass-alpha  玻璃透明度
         --we-blur         模糊半径      --we-accent       它的强调色
       读不到（它没装／装的是别家皮肤）就退回中性灰 + 自己的一点模糊 —— 朴素但不坏。
       三条共存铁律（SEC 项目卡 §3.9）：
         ① 不注入 <style>、不改别人类名、不碰 z-index，只给自己元素写内联样式；
         ② 一律写成 var(--we-x, 兜底)；
         ③ 不把 --we-* 当公开接口：哪天人家改名，我们就退回兜底，不会坏。
       ⚠️ --we-ink／--we-ui-radius／--we-ease 这几个只在它自己的 .we-picker 里定义，
          body 上读不到，所以这里的圆角和文字色都用自己的值，别去读它们。 */

    const R = 10 // "角圆润的方形"（他 2026-11-09 说的）—— 不是胶囊，也不是直角
    const ACCENT = 'var(--we-accent, #3b82f6)'
    const HAIRLINE = 'rgba(128,128,128,0.24)'
    const HAIRLINE_SOFT = 'rgba(128,128,128,0.16)'
    const INK_SOFT = 'rgba(128,128,128,0.18)'

    /* 玻璃底：把釉色按它自己的透明度掺进去。color-mix 在 Electron 里可用（它自己也在用）。 */
    const glassFill = (scale) =>
      'color-mix(in srgb, var(--we-glass-color, rgba(128,128,128,1)) calc(var(--we-glass-alpha, 0.12) * ' +
      (scale || 100) +
      '%), transparent)'

    const glassCard = {
      borderRadius: 12,
      border: '1px solid ' + HAIRLINE_SOFT,
      background: glassFill(100),
      backdropFilter: 'blur(calc(var(--we-blur, 12px) * 0.55))',
      WebkitBackdropFilter: 'blur(calc(var(--we-blur, 12px) * 0.55))',
      fontSize: FS.body,
      lineHeight: 1.65,
    }

    /* 2026-11-09 实测：用 linkStyle 画的"裸 <button>"在 DSH 回复区里点不动
       （鼠标是文本光标、onClick 不触发），换成 Chip 立刻就点得动。
       所以这里一律不走裸按钮 —— 别再为了"低调"改回去。 */

    /* 小按钮：圆角方形、细边、悬停才亮。
       solid = 主操作（略实一点点），不传 = 次操作（透明细边）。 */

    const chipStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 26,
      padding: '0 12px',
      borderRadius: R,
      border: '1px solid ' + HAIRLINE,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: FS.small,
      lineHeight: '24px',
      cursor: 'pointer',
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    }

    function Chip({ onClick, children, dim, title, style, solid, disabled, hoverStyle }) {
      const [hover, setHover] = useState(false)
      const fixed = style || {}
      const off = !!disabled
      return React.createElement(
        'button',
        {
          type: 'button',
          title: title || '',
          onClick: off ? undefined : onClick,
          disabled: off,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            ...chipStyle,
            ...fixed,
            cursor: off ? 'default' : 'pointer',
            // fixed.opacity 优先：三档按钮里的主按钮要"满血"（不然实心色被 0.84 冲淡）
            opacity: fixed.opacity != null ? fixed.opacity : off ? 0.4 : dim ? 0.5 : hover && !dim ? 1 : 0.84,
            background:
              fixed.background ||
              (hover && !dim && !off
                ? 'color-mix(in srgb, currentColor 9%, transparent)'
                : solid && !dim
                  ? glassFill(170)
                  : 'transparent'),
            borderColor: fixed.borderColor || (solid && !dim ? 'rgba(128,128,128,0.34)' : HAIRLINE),
            transition: 'opacity .15s ease, background .15s ease, border-color .15s ease, box-shadow .15s ease',
            ...(hover && !off && hoverStyle ? hoverStyle : null),
          },
        },
        children,
      )
    }

    /* ---------------- 三档按钮（2026-11-10 晚，按 GPT 那份参考的"秩序"重排） ----------------
       主 pri：实心强调色 32px —— **同一屏只许一个**，它自己会站出来；
       次 sec：细边 28px —— 重评、让主模型读、副模型主刀、先看效果；
       轻 lite：无边框 24px —— 依据、它查过 N 处、收起这类"点开看"。
       高度/圆角/字号只在这里定，调用处别再各写各的（GPT 提的"圆角统一、别一个按钮一个样"）。 */
    const BTN_TIER = {
      pri: { height: 32, padding: '0 16px', fontSize: '0.93em', fontWeight: 600 },
      sec: { height: 28, padding: '0 12px', fontSize: '0.9em' },
      lite: { height: 24, padding: '0 8px', fontSize: '0.88em' },
    }

    // 玻璃底：把强调色按比例掺进去 —— 不写死颜色，宿主换肤（壁纸插件的 --we-accent）跟着走
    const accentGlass = (pct) => 'color-mix(in srgb, ' + ACCENT + ' ' + pct + '%, transparent)'

    function Btn({ tier, onClick, children, title, disabled, active, style }) {
      const t = BTN_TIER[tier] || BTN_TIER.sec
      const pri = tier === 'pri'
      return React.createElement(
        Chip,
        {
          onClick,
          title,
          disabled,
          // 悬停只提亮一层，不换颜色（玻璃不该"跳色"）
          hoverStyle: pri
            ? { background: accentGlass(32), borderColor: 'color-mix(in srgb, ' + ACCENT + ' 82%, transparent)' }
            : active
              ? { background: accentGlass(20) }
              : { background: 'color-mix(in srgb, currentColor 8%, transparent)' },
          style: {
            borderRadius: R,
            ...t,
            opacity: disabled ? 0.45 : pri ? 1 : undefined,
            // 2026-11-10 晚：他把主按钮形容成"鲜艳的粉色挺好看"，但要玻璃质感
            // → 主按钮改成强调色玻璃：淡色釉 + 细亮边 + 顶部一道高光，不再是实心色块
            background: pri ? accentGlass(20) : active ? accentGlass(12) : 'transparent',
            borderColor: pri ? 'color-mix(in srgb, ' + ACCENT + ' 60%, transparent)' : active ? ACCENT : HAIRLINE,
            color: 'inherit',
            backdropFilter: pri ? 'blur(6px)' : undefined,
            WebkitBackdropFilter: pri ? 'blur(6px)' : undefined,
            boxShadow: pri ? 'inset 0 1px 0 rgba(255,255,255,0.22)' : undefined,
            ...(style || {}),
          },
        },
        children,
      )
    }


    /* ---------------- 过渡（2026-11-10 21:4x，他的原话：别一帧不到就变一个样） ----------------
       不注入 <style>、不引库 —— 用 Web Animations API 直接给元素排时间轴：
         reveal(delay)：淡入 + 上移 4px，只跑一次（用 __srIn 记账，重渲染不会重播）
         grow：卡片从 0 高度长出来，跑完把高度交回布局
         Collapse：展开/收起走 grid 行高，内容常驻、只收高度
       尊重系统的"减少动态效果"。 */
    const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)'

    function quietMotion() {
      try {
        return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch {
        return false
      }
    }

    function reveal(delay, dy) {
      return (el) => {
        if (!el || el.__srIn || quietMotion() || typeof el.animate !== 'function') return
        el.__srIn = true
        el.animate(
          [
            { opacity: 0, transform: 'translateY(' + (dy == null ? 4 : dy) + 'px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 280, delay: delay || 0, easing: EASE_OUT, fill: 'both' },
        )
      }
    }

    function grow(el) {
      if (!el || el.__srGrow || quietMotion() || typeof el.animate !== 'function') return
      el.__srGrow = true
      const h = el.offsetHeight
      if (!h) return
      const a = el.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], {
        duration: 240,
        easing: EASE_OUT,
        fill: 'both',
      })
      a.onfinish = () => {
        el.style.height = ''
        try {
          a.cancel()
        } catch {}
      }
    }

    function Collapse({ open, children }) {
      return React.createElement(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateRows: open ? '1fr' : '0fr',
            transition: 'grid-template-rows .22s ' + EASE_OUT,
            overflow: 'hidden',
          },
        },
        React.createElement('div', { style: { minHeight: 0, opacity: open ? 1 : 0, transition: 'opacity .2s ease' } }, children),
      )
    }


    /* ---------------- 设置页的两个控件（原生控件的"手"和悬停，自己补） ----------------
       2026-11-09 他报：模型那两个方块和勾选框，鼠标放上去不变手指；点了下拉"很粗糙"。
       → 手：`<select>` 和 `<input type=checkbox>` **不吃**外面 label 的 cursor，必须自己写；
       → 粗糙：原生下拉的**弹出列表**是系统画的，插件改不动（真要圆润得自绘，下一轮）；
         能改的是**关闭状态那个框**：去原生外观、自己画箭头、玻璃底、悬停变亮。
       ⚠️ 别为了好看把 select 换成 div —— 键盘和系统菜单会一起丢。 */

    function Select({ value, onChange, children, width }) {
      const [hover, setHover] = useState(false)
      return React.createElement(
        'span',
        { style: { position: 'relative', display: 'inline-flex', alignItems: 'center', maxWidth: '100%' } },
        React.createElement(
          'select',
          {
            value,
            onChange,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: {
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              cursor: 'pointer',
              color: 'inherit',
              font: 'inherit',
              fontSize: FS.small,
              lineHeight: '20px',
              background: hover ? glassFill(210) : glassFill(120),
              border: '1px solid ' + (hover ? 'rgba(128,128,128,0.42)' : HAIRLINE),
              borderRadius: R,
              padding: '6px 30px 6px 11px',
              width: width || 'auto',
              maxWidth: 240,
              minWidth: 0,
              outline: 'none',
              transition: 'background .15s ease, border-color .15s ease',
            },
          },
          children,
        ),
        React.createElement(
          'span',
          {
            style: {
              position: 'absolute',
              right: 12,
              pointerEvents: 'none',
              opacity: hover ? 0.9 : 0.55,
              fontSize: 9,
              lineHeight: 1,
              transform: hover ? 'translateY(1px)' : 'none',
              transition: 'opacity .15s ease, transform .15s ease',
            },
          },
          '▼',
        ),
      )
    }

    function Check({ checked, onChange, title, desc, style }) {
      const [hover, setHover] = useState(false)
      return React.createElement(
        'label',
        {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            cursor: 'pointer',
            padding: '7px 9px',
            margin: '0 -9px',
            borderRadius: R,
            background: hover ? 'color-mix(in srgb, currentColor 6%, transparent)' : 'transparent',
            transition: 'background .15s ease',
            ...(style || {}),
          },
        },
        React.createElement('input', {
          type: 'checkbox',
          checked: !!checked,
          onChange,
          style: {
            marginTop: 3,
            cursor: 'pointer',
            accentColor: ACCENT,
            width: 15,
            height: 15,
            flex: 'none',
          },
        }),
        React.createElement(
          'span',
          { style: { minWidth: 0 } },
          title,
          desc ? React.createElement('div', { style: { opacity: 0.55, fontSize: FS.min, marginTop: 2 } }, desc) : null,
        ),
      )
    }

    /* 细线进度条：横贯的那一条，2px。
       有两种画法（0.9.0）：
         · 设了「最长等待」→ 走真实时间比例（elapsed / budget），到点转琥珀；
         · 不设上限 → 不编百分比，改成一段光块从左扫到右，只表示"它还活着"。
       两种都不假造进度。 */
    function ThinBar({ ratio, over, indeterminate, phase, warn, title }) {
      if (indeterminate) {
        // 光块位置由 elapsed 推出来（每 0.7 秒来一次进度），不注入 @keyframes
        const pos = ((Number(phase) || 0) % 2200) / 2200
        const left = pos * 72
        return React.createElement(
          'div',
          {
            title: title || '',
            style: { marginTop: 9, height: 2, borderRadius: 2, background: INK_SOFT, overflow: 'hidden', position: 'relative' },
          },
          React.createElement('div', {
            style: {
              position: 'absolute',
              left: left.toFixed(2) + '%',
              width: '28%',
              height: '100%',
              borderRadius: 2,
              background: warn ? '#f59e0b' : 'currentColor',
              opacity: warn ? 0.95 : 0.5,
              transition: 'left .25s linear, background .3s ease',
            },
          }),
        )
      }
      const pct = Math.max(0, Math.min(100, (Number(ratio) || 0) * 100))
      return React.createElement(
        'div',
        {
          title: title || '',
          style: { marginTop: 9, height: 2, borderRadius: 2, background: INK_SOFT, overflow: 'hidden' },
        },
        React.createElement('div', {
          style: {
            height: '100%',
            width: pct.toFixed(2) + '%',
            borderRadius: 2,
            background: over ? '#f59e0b' : 'currentColor',
            opacity: over ? 0.95 : 0.5,
            transition: 'width .25s linear, background .3s ease',
          },
        }),
      )
    }

    // 一枚小盾牌勾，14px，跟着文字颜色走
    function Mark({ size }) {
      const s = size || 13
      return React.createElement(
        'svg',
        {
          width: s,
          height: s,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flex: 'none', opacity: 0.85 },
        },
        React.createElement('path', { d: 'M12 3.2 19 6v6.1c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-2.8z' }),
        React.createElement('path', { d: 'M8.8 12.4l2.2 2.2 4.2-4.7' }),
      )
    }

    /* ---------------- 设置（模块级，整页共用一份） ---------------- */

    const settings = { value: null, pending: null }

    function loadSettings(force) {
      if (!force && settings.value) return Promise.resolve(settings.value)
      if (!force && settings.pending) return settings.pending
      settings.pending = fetch(API + '/config')
        .then((r) => r.json())
        .then((j) => {
          settings.value = (j && j.ok && j.config) || { auto: false }
          return settings.value
        })
        .catch(() => {
          settings.value = { auto: false }
          return settings.value
        })
        .then((v) => {
          settings.pending = null
          return v
        })
      return settings.pending
    }

    /* ---------------- 副模型主刀（每个会话各存各的，互不覆盖） ---------------- */

    const swap = { bySession: {}, pending: {} }

    /* 同一会话里所有卡片共用一份"主刀开没开"，不然 A 卡开了 B 卡还显示关 */
    const swapShared = { value: {}, listeners: new Set() }

    function useSwap(sidKey) {
      const [on, setOn] = useState(!!swapShared.value[sidKey])
      useEffect(() => {
        const l = () => setOn(!!swapShared.value[sidKey])
        swapShared.listeners.add(l)
        l()
        return () => {
          swapShared.listeners.delete(l)
        }
      }, [sidKey])
      return [
        on,
        (v) => {
          swapShared.value[sidKey] = !!v
          swapShared.listeners.forEach((l) => l())
        },
      ]
    }

    function loadSwap(sessionId) {
      const k = String(sessionId || '')
      if (Object.prototype.hasOwnProperty.call(swap.bySession, k)) return Promise.resolve(swap.bySession[k])
      if (swap.pending[k]) return swap.pending[k]
      swap.pending[k] = fetch(API + '/swap?sessionId=' + encodeURIComponent(k))
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) swap.bySession[k] = !!j.on
          return !!swap.bySession[k]
        })
        .catch(() => !!swap.bySession[k])
        .then((v) => {
          delete swap.pending[k]
          return v
        })
      return swap.pending[k]
    }

    /* ---------------- 每轮回复下面的评审块 ---------------- */
    const store = {
      data: {},
      listeners: new Set(),
      get(k) {
        return this.data[k]
      },
      set(k, v) {
        this.data[k] = v
        this.listeners.forEach((l) => l())
      },
    }

    function useEntry(key) {
      const [, force] = useState(0)
      useEffect(() => {
        const l = () => force((n) => n + 1)
        store.listeners.add(l)
        return () => store.listeners.delete(l)
      }, [])
      return [store.get(key), (v) => store.set(key, v)]
    }

    // 页面打开的那一刻起的 5 秒内挂上的轮次算"历史"，不自动评（避免刷新一次就全评一遍）
    const bootAt = Date.now()
    const AUTO_WINDOW_MS = 5000
    const inFlight = new Set()
    const running = new Set()
    const initErrors = []

    function alreadyAutoReviewed(sessionId, seq) {
      try {
        return sessionStorage.getItem('sr-auto:' + sessionId + ':' + seq) === '1'
      } catch {
        return false
      }
    }

    function markAutoReviewed(sessionId, seq) {
      try {
        sessionStorage.setItem('sr-auto:' + sessionId + ':' + seq, '1')
      } catch {}
    }

    function Item({ it, delay }) {
      const [open, setOpen] = useState(false)
      const color = CAT_COLOR[it.category] || '#888'
      // "影响／建议"这种标签对齐成一列，比"影响：……"挤在一行里更像认真做过的界面
      const label = (text) =>
        React.createElement('span', { style: { opacity: 0.5, marginRight: 7, flex: 'none', fontSize: FS.small } }, text)
      return React.createElement(
        'div',
        { ref: reveal(delay || 0), style: { marginBottom: 14, fontSize: FS.body, lineHeight: 1.7 } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
          React.createElement(
            'span',
            {
              style: {
                flex: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                height: 19,
                padding: '0 7px',
                borderRadius: 5,
                fontSize: FS.min,
                lineHeight: '19px',
                color,
                border: '1px solid ' + color,
                opacity: 0.85,
              },
            },
            it.category,
          ),
          React.createElement('span', { style: { flex: 1, minWidth: 0, fontWeight: 500 } }, it.point),
        ),
        it.impact
          ? React.createElement(
              'div',
              { style: { display: 'flex', marginTop: 5, fontSize: FS.small, lineHeight: 1.6, opacity: 0.85 } },
              label('影响'),
              React.createElement('span', null, it.impact),
            )
          : null,
        it.suggestion
          ? React.createElement(
              'div',
              { style: { display: 'flex', marginTop: 2, fontSize: FS.small, lineHeight: 1.6, opacity: 0.7 } },
              label('建议'),
              React.createElement('span', null, it.suggestion),
            )
          : null,
        it.evidence
          ? React.createElement(
              'div',
              { style: { marginTop: 5 } },
              React.createElement(Btn, { tier: 'lite', onClick: () => setOpen(!open), title: '看这条依据的原文' }, open ? '收起依据' : '依据'),
              React.createElement(
                Collapse,
                { open },
                React.createElement('div', { style: { opacity: 0.6, fontSize: FS.small, marginTop: 5, lineHeight: 1.6 } }, it.evidence),
              ),
            )
          : null,
      )
    }

    /* 评审时查过什么（P0-9 改口径后的"可观测"）：默认只报一行，点开看明细 */
    function Steps({ steps }) {
      const [open, setOpen] = useState(false)
      if (!steps || !steps.length) return null
      const tools = [...new Set(steps.map((s) => s.tool))]
      return React.createElement(
        'div',
        { style: { marginBottom: 10, fontSize: FS.min, opacity: 0.72 } },
        React.createElement(
          Btn,
          { tier: 'lite', onClick: () => setOpen(!open), title: '看它查了哪些地方' },
          '它查过 ' + steps.length + ' 处（' + tools.join('、') + '）' + (open ? '，收起' : ''),
        ),
        React.createElement(
          Collapse,
          { open },
          React.createElement(
            'div',
            { style: { marginTop: 4, lineHeight: 1.6 } },
            ...steps.map((s, i) =>
              React.createElement(
                'div',
                { key: i },
                s.tool + ' ' + JSON.stringify(s.args || {}) + ' → ' + (s.ok ? '成功' : '失败'),
              ),
            ),
          ),
        ),
      )
    }

    /* 引文核验（1.1.0）：机器查"它有没有编出你的话"，不靠模型。
       来路：`记录中心\小问的bug.md` —— 小问幻觉出一条用户责骂消息，还照着行动了。
       这里只标红提示，不改结论：查不到出处 ≠ 一定是编的（也可能它改写太多）。 */
    function Provenance({ pv }) {
      if (!pv || !pv.checked) return null
      const missing = Array.isArray(pv.missing) ? pv.missing : []
      if (!missing.length) {
        return React.createElement(
          'div',
          { style: { opacity: 0.5, fontSize: FS.min, marginBottom: 8 } },
          '引文核验：' + pv.checked + ' 句「你的话」都有出处',
        )
      }
      return React.createElement(
        'div',
        {
          style: {
            marginBottom: 10,
            padding: '7px 10px',
            borderRadius: R,
            border: '1px solid rgba(239,68,68,0.45)',
            background: 'color-mix(in srgb, #ef4444 8%, transparent)',
            fontSize: FS.small,
            lineHeight: 1.6,
          },
        },
        React.createElement(
          'div',
          { style: { color: '#ef4444', marginBottom: 4 } },
          '⚠ 引文核验：有 ' + missing.length + ' 句「你的话」在会话记录里找不到出处 —— 先别照它改方向',
        ),
        ...missing.map((q, i) => React.createElement('div', { key: 'q' + i, style: { opacity: 0.75, fontSize: FS.min } }, '「' + q + '」')),
        React.createElement(
          'div',
          { style: { opacity: 0.55, fontSize: FS.min, marginTop: 4 } },
          '机器只核它明确引成「你说的」那几句（这次 ' + pv.checked + ' 句）；查不到 ≠ 一定是编的，但也别直接当真。',
        ),
      )
    }

    /* 小问题：默认收起。它们是"确实存在但不影响用"的，摊开会把他拖回抛光 */
    function MinorGroup({ items }) {
      const [open, setOpen] = useState(false)
      if (!items || !items.length) return null
      return React.createElement(
        'div',
        { style: { marginBottom: 6 } },
        React.createElement(
          Btn,
          { tier: 'lite', onClick: () => setOpen(!open), title: open ? '收起' : '点开看这几条小问题' },
          '一针见血 ' + items.length + ' 条' + (open ? '，收起' : '（点开看）'),
        ),
        React.createElement(
          Collapse,
          { open },
          React.createElement(
            'div',
            { style: { marginTop: 8, opacity: 0.85 } },
            ...items.map((it, i) => React.createElement(Item, { key: 'm' + i, it, delay: i * 40 })),
          ),
        ),
      )
    }

    function TurnTail(props) {
      const { seq, sessionId, inputActions } = props || {}
      // 卡片的 key 必须带会话：两个会话的第 3 轮不是同一张卡
      const key = String(sessionId || '') + ':' + String(seq)
      const sidKey = String(sessionId || '')
      const [entry, setEntry] = useEntry(key)
      const [auto, setAuto] = useState(false)
      // 当前副模型是谁：卡片这排要写出来，悬停提示也要带上（他 2026-11-10 晚要求）
      const [reviewerName, setReviewerName] = useState(settings.value && settings.value.model ? String(settings.value.model) : '')
      const [nudge, setNudge] = useState('')
      const [showThink, setShowThink] = useState(false)
      // 主刀开关是"会话级"的，但一张会话里有很多张卡：以前每张卡各存一份 useState，
      // 在一张卡上开了，别的卡上的开关还显示"关"（GPT 4.6 第 4 条）。改成共用一份。
      const [swapOn, setSwapOn] = useSwap(sidKey)

      useEffect(() => {
        let alive = true
        loadSwap(sessionId).then((v) => {
          if (alive) setSwapOn(!!v)
        })
        return () => {
          alive = false
        }
      }, [sessionId])

      // 开：下一轮由副模型来答（改的是会话的模型选择，不动消息归属）；关：换回原来的
      const toggleSwap = () => {
        const next = !swapOn
        setSwapOn(next)
        fetch(API + '/swap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, on: next }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              swap.bySession[sidKey] = !!j.on
              setSwapOn(!!j.on)
            } else {
              setSwapOn(!next)
            }
          })
          .catch(() => setSwapOn(!next))
      }

      const swapChip = () =>
        React.createElement(
          Btn,
          {
            tier: 'sec',
            onClick: toggleSwap,
            active: swapOn,
            title: '打开后：下一轮由副模型来答；再点「二次评审」时，由原来的主模型来评。不改消息归属。',
          },
          '副模型主刀' + (swapOn ? '：开' : ''),
        )
      const state = entry && entry.state
      const major = (entry && entry.major) || []
      const minor = (entry && entry.minor) || []
      const unclear = !!entry && entry.verdict === 'unclear'
      const passed = !!entry && entry.verdict === 'pass' && major.length === 0 && minor.length === 0
      const omitted = entry && entry.omitted
      const omittedTotal = omitted ? Number(omitted.major || 0) + Number(omitted.minor || 0) : 0

      useEffect(() => {
        let alive = true
        loadSettings().then((v) => {
          if (alive) setAuto(!!(v && v.auto))
          if (alive) setReviewerName(v && v.model ? String(v.model) : '')
        })
        return () => {
          alive = false
        }
      }, [])

      const run = (kind, force) => {
        // 第一次花钱前先把话说清楚（他 2026-11-09 提的：别人装完第一次点就直接花他的钱）
        const acked = !!(settings.value && settings.value.noticeAck)
        if (kind !== 'mock' && !force && !acked) {
          if (!settings.value) {
            loadSettings().then(() => run(kind, force))
            return
          }
          setEntry({ state: 'notice', pendingKind: kind })
          return
        }
        // 同一张卡不许同时评两次（双点会付两次钱）
        if (kind !== 'mock') {
          if (running.has(key)) return
          running.add(key)
        }
        const job = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        // 再评时不要把整张卡片拆掉：一塌一长，页面会跳一下（2026-11-09 他报的"整屏闪一下"）
        const cur = store.get(key)
        const keep = cur && cur.state === 'done' ? cur : null
        setEntry({
          ...(keep || { major: [], minor: [] }),
          state: 'loading',
          refreshing: !!keep,
          auto: kind === 'auto',
          job,
          startedAt: Date.now(),
          progress: null,
        })
        // 只评"用户点的这一轮及以前"：把 seq 一起送过去，后端只读到这里为止。
        // 用 POST：评审是要花钱的，不能让别的网页拿 <img>／链接蹭一下。
        const url = API + '/review'
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId || '', seq: seq, job, mock: kind === 'mock' }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok) {
              if (json.verdict === 'error') {
                setEntry({
                  state: 'error',
                  major: [],
                  minor: [],
                  note: String(json.note || '副模型没调通'),
                  // 它已经说出来的那段（如果有）——别让这笔钱白花
                  partial: String(json.partial || ''),
                  reasoning: String(json.reasoning || ''),
                  reviewer: json.reviewer || null,
                  provenance: json.provenance || null,
                })
                return
              }
              setEntry({
                state: 'done',
                topic: json.topic || '',
                verdict: json.verdict || ((json.major || []).length ? 'major' : (json.minor || []).length ? 'minor' : 'pass'),
                note: json.note || '',
                major: Array.isArray(json.major) ? json.major : json.items || [],
                minor: Array.isArray(json.minor) ? json.minor : [],
                omitted: json.omitted || null,
                saved: json.saved || '',
                // 是谁评的（他 2026-11-09 晚要的：换过副模型时得分得清）
                reviewer: json.reviewer || null,
                // 1.1.0：引文核验（机器查的）
                provenance: json.provenance || null,
                // 正在跑的是哪一版（改了没生效时一眼看出来）
                version: json.version || '',
                elapsedMs: Number(json.elapsedMs) || 0,
                auto: kind === 'auto',
                truncated: !!json.truncated,
                timedOut: !!json.timedOut,
                mock: !!json.mock,
                steps: Array.isArray(json.steps) ? json.steps : [],
              })
            } else {
              setEntry({ state: 'error', major: [], minor: [], note: String((json && json.error) || '未知原因') })
            }
          })
          .catch((e) => setEntry({ state: 'error', major: [], minor: [], note: String((e && e.message) || e) }))
          .finally(() => running.delete(key))
      }

      // 「知道了」：记住这次确认，然后真的开始评
      const ackAndRun = () => {
        const cur = store.get(key)
        const pending = (cur && cur.pendingKind) || 'manual'
        fetch(API + '/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ noticeAck: true }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) settings.value = j.config
          })
          .catch(() => {})
        if (settings.value) settings.value = { ...settings.value, noticeAck: true }
        run(pending, true)
      }

      // 评审跑着的时候，每 0.7 秒问一次"它在想什么"（他 11-09 说的：什么都看不到会以为卡了）
      const jobId = entry && entry.state === 'loading' ? entry.job : ''

      /* 0.9.2：只靠 0.7 秒一次的轮询来画秒数和进度条，只要有一两次请求慢/失败，
         就会"卡住几秒、然后一下跳到 50 秒"（他 2026-11-10 报的）。
         这里加一个 200ms 的本地小表针：**秒数用本地时间接着走**，
         服务器每次回包只负责"对表"（把 elapsed 校准回来），动画就不会断。 */
      const [, tickNow] = useState(0)
      useEffect(() => {
        if (!jobId) return
        const t = setInterval(() => tickNow((n) => (n + 1) % 1000000), 200)
        return () => clearInterval(t)
      }, [jobId])

      useEffect(() => {
        if (!jobId) return
        let alive = true
        const tick = () => {
          fetch(API + '/progress?job=' + encodeURIComponent(jobId))
            .then((r) => r.json())
            .then((j) => {
              if (!alive || !j || !j.ok || j.missing) return
              const cur = store.get(key)
              if (cur && cur.state === 'loading') setEntry({ ...cur, progress: j, progressAt: Date.now() })
            })
            .catch(() => {})
        }
        tick()
        const timer = setInterval(tick, 700)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [jobId, key])

      // 自动评审：只评"页面加载之后才来的"新回复，且同一条只评一次
      useEffect(() => {
        if (!auto || state || !sessionId) return
        if (Date.now() - bootAt < AUTO_WINDOW_MS) return
        if (inFlight.has(key)) return
        if (alreadyAutoReviewed(sessionId, seq)) return
        inFlight.add(key)
        markAutoReviewed(sessionId, seq)
        run('auto')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [auto, state, sessionId, seq, key])

      // 手动再评：允许一次。上次是假数据就继续用假数据（别让人点一下"重评"就悄悄花了钱）
      const rerun = () => {
        inFlight.add(key)
        run(entry && entry.mock ? 'mock' : 'manual')
        inFlight.delete(key)
      }

      // 停止这次评审（0.9.0）：不设总时长之后，"能随时喊停"就是新的保险丝。
      // 只给服务端发一个标志，流那边每一块之间看一眼就收手；已经花掉的调用收不回来。
      const stop = () => {
        const cur = store.get(key)
        const job = cur && cur.job
        if (!job) return
        setEntry({ ...cur, stopping: true })
        fetch(API + '/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job: job }),
        }).catch(() => {})
      }

      // 让主模型读这份评审：优先用界面自己的输入框（setDraft + submit = 等同于你自己发一条），      // 那条路走不通时才退到复制剪贴板。绝不再从 host 往会话里塞消息（2026-11-08 那次就是这么崩的）。
      const sendToMain = () => {
        // 每张卡都存了自己那份带时间戳的 md；别再一律读「最新.md」——那可能是别的轮的
        // 1.0.1（小K 审出来）：落盘失败时 entry.saved 是「保存失败：…」，
        // 以前会被原样当成路径塞进输入框，主模型被叫去读一个不存在的文件——白花一次调用。
        const saved = entry && entry.saved != null ? String(entry.saved) : ''
        if (/^保存失败/.test(saved)) {
          setNudge('nosave')
          return
        }
        const target = saved || '二次评审\\最新.md'
        const text =
          '请读取工作区里的「' + target + '」——那是刚刚对这一轮回复的二次评审，读完直接回应它指出的问题，不用复述文件内容。'
        try {
          if (inputActions && typeof inputActions.setDraft === 'function' && typeof inputActions.submit === 'function') {
            inputActions.setDraft(text)
            inputActions.submit()
            setNudge('sent')
            return
          }
        } catch (e) {}
        try {
          navigator.clipboard.writeText(text).then(
            () => setNudge('copied'),
            () => setNudge('failed'),
          )
        } catch (e) {
          setNudge('failed')
        }
      }

      if (state === 'notice') {
        const c = settings.value || {}
        const who = (c.provider || '副模型') + ' / ' + (c.model || '默认模型')
        return React.createElement(
          'div',
          {
            key: 'notice',
            ref: grow,
            style: {
              ...glassCard,
              marginTop: 10,
              padding: '13px 16px',
              borderLeft: '2px solid ' + ACCENT,
            },
          },
          React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, '第一次用，先说清楚'),
          React.createElement(
            'div',
            { style: { opacity: 0.85, marginBottom: 4 } },
            '点下去会把「这一轮及以前的对话」发给副模型（' + who + '），按它的价格计费。',
          ),
          React.createElement('div', { style: { opacity: 0.85, marginBottom: 10 } }, '评审结果只写成卡片和工作区里的 md，不改你的对话。'),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            React.createElement(Btn, { tier: 'pri', onClick: ackAndRun, title: '记住这次确认，之后不再问' }, '知道了，评这一次'),
            React.createElement(Btn, { tier: 'sec', onClick: () => run('mock'), title: '不调模型、不花钱、不留记录' }, '先用假数据看看（不花钱）'),
          ),
        )
      }

      if (state === 'loading' && !(entry && entry.refreshing)) {
        const p = entry && entry.progress
        // 0.9.0：budget 0 ＝ 不设上限（他要求的默认），这时不画百分比
        const budget = Math.max(0, Number((p && p.budget) || 0))
        // 0.9.2：秒数＝服务器上次报的 elapsed ＋ 之后本地走过的时间（不再等下一次轮询）
        const baseElapsed = Number((p && p.elapsed) || 0)
        const sincePoll = entry && entry.progressAt ? Math.max(0, Date.now() - entry.progressAt) : 0
        const elapsed = baseElapsed + sincePoll
        const secs = Math.max(0, Math.round(elapsed / 1000))
        const ratio = budget > 0 ? elapsed / budget : 0
        const over = budget > 0 && elapsed >= budget
        // 空闲闸：只提示"好像卡住了"，真正的收手在服务端
        const idleMs = Number((p && p.idleMs) || 0)
        const idleFor = Number((p && p.idleFor) || 0) + sincePoll
        const stalling = idleMs > 0 && idleFor > Math.max(15000, idleMs * 0.5)
        const idleLeft = idleMs > 0 ? Math.max(0, Math.ceil((idleMs - idleFor) / 1000)) : 0
        const stopping = entry && entry.stopping
        const think = String((p && p.reasoning) || '').trim()
        const rows = think ? think.split('\n').filter((l) => l.trim()) : []
        const lastLine = rows.length ? rows[rows.length - 1].trim().slice(-90) : ''
        const hint = lastLine || (p && p.text ? '正在写结论…' : '')
        // 阶段只换一句话，不画假进度（他执意要留思考流，那句字幕就是它）
        const stage = stopping
          ? '正在停…'
          : over
            ? '到点了，在收尾…'
            : stalling
              ? '好像没动静了，' + idleLeft + ' 秒后自动收手'
              : p && p.text
                ? '正在写结论'
                : p && p.steps
                  ? '查了 ' + p.steps + ' 处'
                  : ''
        return React.createElement(
          'div',
          { key: 'loading', ref: grow, style: { ...glassCard, marginTop: 8, padding: '11px 16px 12px' } },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            React.createElement(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', fontSize: FS.small, opacity: 0.85 } },
              React.createElement(Mark, { size: 14 }),
              (entry && entry.auto ? '自动评审中' : '评审中') + (secs ? ' ' + secs + 's' : ''),
            ),
            stage
              ? React.createElement(
                  'span',
                  { style: { flex: 'none', fontSize: FS.min, opacity: 0.55, color: over || stalling ? '#f59e0b' : 'inherit' } },
                  stage,
                )
              : null,
            hint
              ? React.createElement(
                  Btn,
                  {
                    tier: 'lite',
                    onClick: () => setShowThink(!showThink),
                    title: '看完整的思考过程',
                    // 字幕行：撑到一行宽就截断（省略号），别把整行顶成两行
                    style: {
                      maxWidth: 460,
                      minWidth: 0,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                    },
                  },
                  React.createElement(
                    'span',
                    { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    (showThink ? '▾ ' : '▸ ') + (hint.length > 46 ? hint.slice(0, 46) + '…' : hint),
                  ),
                )
              : null,
            React.createElement(
              Btn,
              {
                tier: 'lite',
                onClick: stop,
                title: '立刻停止这次评审（已经花掉的调用收不回来，但不会继续等、也不会继续花）',
                style: { marginLeft: 'auto' },
              },
              stopping ? '停止中…' : '停止',
            ),
          ),
          // 思考字幕那一行底下的细线
          React.createElement(ThinBar, {
            ratio: ratio,
            over: over,
            indeterminate: !budget,
            phase: elapsed,
            warn: stalling || over,
            title: budget
              ? '已等 ' + secs + ' 秒，上限 ' + Math.round(budget / 1000) + ' 秒（真实时间，不是猜的）'
              : '已等 ' + secs + ' 秒，不设上限（这条线只表示它还活着）',
          }),
          think
            ? React.createElement(
                Collapse,
                { open: showThink },
                React.createElement(
                  'div',
                  {
                    style: {
                      marginTop: 8,
                      padding: '7px 10px',
                      borderRadius: R,
                      border: '1px solid ' + HAIRLINE_SOFT,
                      background: glassFill(70),
                      opacity: 0.72,
                      fontSize: FS.small,
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 240,
                      overflowY: 'auto',
                    },
                  },
                  think,
                ),
              )
            : null,
        )
      }

      if (state === 'error') {
        const partial = String((entry && entry.partial) || '')
        return React.createElement(
          'div',
          { key: 'error', ref: grow, style: { ...glassCard, marginTop: 8, padding: '13px 16px 12px', borderLeft: '2px solid rgba(245,158,11,0.55)' } },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            React.createElement(Btn, { tier: 'pri', onClick: rerun, title: '再试一次' }, React.createElement(Mark, null), '二次评审'),
            React.createElement(
              'span',
              { style: { opacity: 0.7, fontSize: FS.small, wordBreak: 'break-word' }, title: String((entry && entry.note) || '') },
              '没评成：' + String((entry && entry.note) || '').slice(0, 200),
            ),
          ),
          React.createElement(Provenance, { pv: entry && entry.provenance }),
          partial
            ? React.createElement(
                'div',
                { style: { marginTop: 8 } },
                React.createElement(
                  Btn,
                  {
                    tier: 'lite',
                    onClick: () => setShowThink(!showThink),
                    title: '它被打断之前已经说出来的内容',
                  },
                  (showThink ? '▾ ' : '▸ ') + '看它已经说了什么（' + partial.length + ' 字）',
                ),
                React.createElement(
                  Collapse,
                  { open: showThink },
                  React.createElement(
                    'div',
                    {
                      style: {
                        marginTop: 6,
                        padding: '7px 10px',
                        borderRadius: R,
                        border: '1px solid ' + HAIRLINE_SOFT,
                        background: glassFill(70),
                        opacity: 0.75,
                        fontSize: FS.small,
                        lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 260,
                        overflowY: 'auto',
                      },
                    },
                    partial,
                  ),
                ),
              )
            : null,
        )
      }

      if (state === 'done' || (state === 'loading' && entry && entry.refreshing)) {
        // 主次：一剑封喉直接摊开；一针见血默认收起，别拿吹毛求疵占他的注意力（他 11-09 的要求）
        const head = unclear
          ? '没评成：它说不清这一轮在评什么'
          : passed
            ? '评审通过'
            : major.length
              ? '一剑封喉 ' + major.length + ' 条' + (minor.length ? ' · 一针见血 ' + minor.length + ' 条' : '')
              : '一针见血 ' + minor.length + ' 条'
        const edge = unclear
          ? 'rgba(245,158,11,0.55)'
          : passed
            ? 'rgba(16,185,129,0.5)'
            : major.length
              ? 'rgba(239,68,68,0.5)'
              : 'rgba(128,128,128,0.22)'
        const rv = (entry && entry.reviewer) || null
        const reviewerName = rv && rv.model ? String(rv.model) : ''
        const reviewerProvider = rv && rv.provider ? String(rv.provider) : ''
        const reviewerRole = rv && rv.role ? String(rv.role) : ''
        // 花了多久（服务器算的，不会随着卡片挂着继续涨）
        const spentMs = Number((entry && entry.elapsedMs) || 0)
        const spentText = spentMs
          ? spentMs >= 60000
            ? Math.floor(spentMs / 60000) + ' 分 ' + Math.round((spentMs % 60000) / 1000) + ' 秒'
            : Math.round(spentMs / 1000) + ' 秒'
          : ''
        return React.createElement(
          'div',
          {
            key: 'done',
            ref: grow,
            style: {
              ...glassCard,
              marginTop: 12,
              padding: '13px 16px 11px',
              borderLeft: '2px solid ' + edge,
            },
          },
          React.createElement(
            'div',
            { ref: reveal(0), style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' } },
            React.createElement(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', fontSize: FS.small, opacity: 0.7 } },
              React.createElement(Mark, { size: 14 }),
              '二次评审',
            ),
            // 结论标签：一眼就知道这次是哪种（通过／一剑封喉／没评成）
            React.createElement(
              'span',
              {
                style: {
                  fontSize: FS.min,
                  lineHeight: '20px',
                  padding: '0 8px',
                  borderRadius: 6,
                  border: '1px solid ' + edge,
                  color: unclear ? '#f59e0b' : passed ? '#10b981' : major.length ? '#ef4444' : 'inherit',
                  opacity: 0.95,
                  whiteSpace: 'nowrap',
                },
              },
              head,
            ),
            entry && entry.truncated
              ? React.createElement('span', { style: { opacity: 0.65, fontSize: FS.min } }, '（早期已截断）')
              : null,
            entry && entry.mock
              ? React.createElement(Btn, { tier: 'lite', onClick: rerun, title: '这是假数据（不花钱）。点一下换一组再看一遍' }, '假数据 · 再测一次')
              : null,
            // 右侧操作：一屏只留一个实心按钮，这些是"次操作"
            React.createElement('span', { style: { flex: 1, minWidth: 8 } }),
            state === 'loading'
              ? React.createElement(Btn, { tier: 'lite', disabled: true }, '重评中…')
              : entry && entry.mock
                ? null
                : React.createElement(
                    Btn,
                    { tier: 'sec', onClick: rerun, title: '再评一次（' + (reviewerName || '副模型') + '，会调用模型、花钱）' },
                    '重评',
                  ),
            entry && entry.mock
              ? null
              : React.createElement(
                  Btn,
                  { tier: 'sec', onClick: sendToMain, title: '以你的名义发一句，让主模型去读这份评审' },
                  nudge === 'sent'
                    ? '已发给主模型'
                    : nudge === 'copied'
                      ? '已复制，粘贴发送'
                      : nudge === 'failed'
                        ? '复制失败'
                        : nudge === 'nosave'
                          ? '这次没存下来，不能读'
                          : '让主模型读',
                ),
          ),
          entry && entry.topic
            ? React.createElement('div', { ref: reveal(40), style: { opacity: 0.6, fontSize: FS.min, marginBottom: 8 } }, '评的是：' + entry.topic)
            : null,
          React.createElement(Provenance, { pv: entry && entry.provenance }),
          React.createElement(Steps, { steps: (entry && entry.steps) || [] }),
          omittedTotal > 0
            ? React.createElement(
                'div',
                { ref: reveal(50), style: { opacity: 0.6, fontSize: FS.min, marginBottom: 8 } },
                '另有 ' + omittedTotal + ' 条同类被省略（大问题最多留 2 条、小问题最多留 1 条）',
              )
            : null,
          unclear
            ? React.createElement(
                'div',
                { ref: reveal(60), style: { fontSize: '1.02em', lineHeight: 1.6, margin: '1px 0 8px', color: '#f59e0b', opacity: 0.95 } },
                (entry && entry.note) || '这次不算通过，也不算没问题——它没能说清这一轮在评什么。换一轮或再评一次试试。',
              )
            : null,
          passed
            ? React.createElement(
                'div',
                { ref: reveal(60), style: { fontSize: '1.02em', lineHeight: 1.6, margin: '1px 0 8px', opacity: 0.85 } },
                (entry && entry.note) || '没发现必须改的地方。',
              )
            : null,
          major.length
            ? React.createElement(
                'div',
                { style: { marginBottom: 10 } },
                React.createElement(
                  'div',
                  { style: { fontSize: FS.min, color: '#ef4444', opacity: 0.9, marginBottom: 6 } },
                  '一剑封喉 · 不改不行',
                ),
                ...major.map((it, i) => React.createElement(Item, { key: 'M' + i, it, delay: 90 + i * 60 })),
              )
            : null,
          minor.length ? React.createElement(MinorGroup, { items: minor }) : null,
          // 底栏：署名 + 用时 + 版本（左），主刀开关（右）—— 操作和"这是谁评的"分开摆
          React.createElement(
            'div',
            {
              ref: reveal(200),
              style: {
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid ' + HAIRLINE_SOFT,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: FS.min,
              },
            },
            reviewerName
              ? React.createElement(
                  'span',
                  { title: reviewerProvider ? reviewerProvider + ' / ' + reviewerName : reviewerName, style: { display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', opacity: 0.55 } },
                  React.createElement('span', null, '署名'),
                  React.createElement('span', { style: { fontWeight: 600 } }, reviewerName),
                  reviewerProvider ? React.createElement('span', null, '（' + reviewerProvider + '）') : null,
                  reviewerRole ? React.createElement('span', null, '· ' + reviewerRole) : null,
                  spentText ? React.createElement('span', null, '· 用了 ' + spentText) : null,
                  entry && entry.version ? React.createElement('span', null, '· v' + entry.version) : null,
                )
              : null,
            // 1.3.5：副模型和主模型是同一个 → 这次复核基本等于自评，先说清楚（他 2026-11-11 要的）
            entry && entry.sameSource
              ? React.createElement(
                  'span',
                  {
                    title:
                      '主模型和副模型是同一个模型' +
                      (entry.main && entry.main.model ? '（' + String(entry.main.model) + '）' : '') +
                      '，独立视角接近于零。换一个不同来源、或至少不同档位的副模型才有用。',
                    style: { color: '#f59e0b', fontSize: FS.min, whiteSpace: 'nowrap', opacity: 0.95 },
                  },
                  '与主模型相同 · 自评',
                )
              : null,
            React.createElement('span', { style: { flex: 1, minWidth: 8 } }),
            swapChip(),
          ),
        )
      }

      // 未评：这一排就是"明面"——一个实心主操作，其余全部退成细边
      return React.createElement(
        'div',
        { style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: FS.body } },
        React.createElement(
          Btn,
          { tier: 'pri', onClick: () => run('manual'), title: '让 ' + (reviewerName || '副模型') + ' 挑一遍这一轮的毛病' },
          React.createElement(Mark, { size: 14 }),
          '二次评审',
        ),
        React.createElement(
          Btn,
          { tier: 'sec', onClick: () => run('mock'), title: '用假数据看一遍卡片长什么样：不调模型、不花钱、不留记录' },
          '先看效果（不花钱）',
        ),
        swapChip(),
        // 当前副模型：他 2026-11-10 晚说"这总得说清楚"
        reviewerName
          ? React.createElement('span', { style: { opacity: 0.45, fontSize: FS.min, whiteSpace: 'nowrap' } }, '当前副模型：' + reviewerName)
          : null,
        initErrors.length
          ? React.createElement(
              'span',
              { style: { color: '#ef4444', opacity: 0.8, fontSize: FS.min } },
              '（设置页没挂上：' + initErrors.join('；') + '）',
            )
          : null,
      )
    }

    /* ---------------- 设置页（插件 → 二次评审 → 配置） ---------------- */

    const labelStyle = { opacity: 0.7, minWidth: 88 }

    /* 设置页的一段：01 模型 / 02 评审模式 / 03 权限 / 04 关于。
       写成普通函数而不是组件 —— 在 render 里定义组件类型会让子元素每次重渲染都重挂载
       （下拉框会掉焦点）。 */
    const sectionTitle = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      margin: '0 0 8px',
    }
    function section(no, title, ...children) {
      return React.createElement(
        'div',
        { style: { marginBottom: 16 } },
        React.createElement(
          'div',
          { style: sectionTitle },
          React.createElement('span', { style: { fontSize: FS.min, opacity: 0.45, fontVariantNumeric: 'tabular-nums' } }, no),
          React.createElement('span', { style: { fontSize: FS.small, opacity: 0.8, letterSpacing: '0.06em' } }, title),
          React.createElement('span', { style: { flex: 1, height: 1, background: HAIRLINE_SOFT } }),
        ),
        React.createElement('div', { style: { ...glassCard, padding: '12px 14px' } }, ...children),
      )
    }

    /* 出错了也不要变成"整页空白"：DSH 会把崩掉的条目整条摘掉，页面上只剩一片白。
       这里自己兜一层，把错误原文摊出来 —— 2026-11-09 那次整页空白就是这么找不到原因的。 */
    class PageBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }

      static getDerivedStateFromError(err) {
        return { err: err }
      }

      render() {
        if (this.state.err) {
          return React.createElement(
            'div',
            { style: { padding: '8px 0', color: '#ef4444', fontSize: FS.body, lineHeight: 1.7 } },
            React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, '这张设置页出错了（不是你的操作问题）'),
            React.createElement(
              'div',
              { style: { opacity: 0.85, fontSize: FS.small, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
              String((this.state.err && this.state.err.message) || this.state.err),
            ),
            React.createElement('div', { style: { opacity: 0.6, fontSize: FS.min, marginTop: 8 } }, '把这段字发给小D就行。'),
          )
        }
        return this.props.children
      }
    }

    /* 判断"有没有改动没保存"：只比对真正会写进 config.json 的那几项。
       他 2026-11-10 晚的原话：很多用户没这个意识、甚至看不到保存按钮 ——
       所以这条提示要跟着改动出现，按钮要显眼，还得钉在视野里。 */
    function cfgFingerprint(c) {
      if (!c) return ''
      return JSON.stringify([
        String(c.provider || ''),
        String(c.model || ''),
        !!c.auto,
        !!c.mock,
        !!c.allowWrite,
        Number(c.budgetSec) || 0,
        Number(c.idleSec) || 0,
        c.checkQuotes !== false,
      ])
    }

    function ConfigPage({ view }) {
      const [cfg, setCfg] = useState(null)
      const [providers, setProviders] = useState([])
      const [models, setModels] = useState([])
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [ver, setVer] = useState('')

      useEffect(() => {
        fetch(API + '/config')
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              setCfg(j.config)
              // 记一份"盘上现在是啥"，用来判断有没有改动没保存
              settings.value = j.config
            } else setNote('读不到配置：' + ((j && j.error) || '未知'))
            // 版本号由宿主带出来（0.7.0 起）—— 「关于」显示的就是正在跑的那份后端
            if (j && j.version) setVer(String(j.version))
          })
          .catch((e) => setNote('读不到配置：' + String((e && e.message) || e)))
        fetch(API + '/models')
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) setProviders(j.providers || [])
          })
          .catch(() => {})
      }, [])

      const provider = cfg && cfg.provider
      useEffect(() => {
        if (!provider) return
        // 1.0.1（小K 审出来）：快速切 provider 时旧回包会盖掉新列表
        // （选的是 B，模型下拉里却是 A 的模型）→ 加 alive flag，和 TurnTail 里一个写法
        let alive = true
        fetch(API + '/models?provider=' + encodeURIComponent(provider))
          .then((r) => r.json())
          .then((j) => {
            if (alive && j && j.ok) setModels(j.models || [])
          })
          .catch(() => {
            if (alive) setModels([])
          })
        return () => {
          alive = false
        }
      }, [provider])

      const save = async () => {
        if (!cfg) return
        setBusy(true)
        setNote('')
        try {
          const r = await fetch(API + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              provider: cfg.provider,
              model: cfg.model,
              auto: !!cfg.auto,
              mock: !!cfg.mock,
              allowWrite: !!cfg.allowWrite,
              budgetSec: Number(cfg.budgetSec) || 0,
              idleSec: Number(cfg.idleSec) || 0,
              checkQuotes: cfg.checkQuotes !== false,
            }),
          })
          const j = await r.json()
          if (j && j.ok) {
            setCfg(j.config)
            settings.value = j.config
            setNote('已保存')
          } else {
            setNote('没保存成：' + ((j && j.error) || '未知'))
          }
        } catch (e) {
          setNote('没保存成：' + String((e && e.message) || e))
        }
        setBusy(false)
      }

      if (!cfg) return React.createElement('div', { style: { opacity: 0.7 } }, note || '读取配置中…')

      // /models 给的是 [{ id, name }] 对象，不是字符串。原来直接把对象当文字渲染 →
      // React error #31（Objects are not valid as a React child）→ 整条条目被摘掉 → 设置页整页空白。
      const providerOptions = (providers.length ? providers : [{ id: cfg.provider || '', name: cfg.provider || '' }])
        .map((p) => (typeof p === 'string' ? { id: p, name: p } : { id: String((p && p.id) || ''), name: String((p && p.name) || (p && p.id) || '') }))
        .filter((p) => p.id)

      // 有没有改动没保存（他 2026-11-10 晚：很多用户没这个意识）
      const dirty = !!cfg && !!settings.value && cfgFingerprint(cfg) !== cfgFingerprint(settings.value)
      const failedSave = /^没保存成/.test(note)
      const hintText = failedSave
        ? note
        : dirty
          ? '有改动还没保存 —— 不点保存，上面的改动不会生效'
          : note || '改动不会自动保存'
      const hintColor = failedSave ? '#ef4444' : dirty ? '#f59e0b' : 'inherit'

      return React.createElement(
        'div',
        { style: { padding: '4px 0', maxWidth: 620 } },

        section(
          '01',
          '模型',
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement('span', { style: labelStyle }, '副模型'),
            // 控件推到右边：左边是"项"，右边是"值"，像一张设置表而不是一串表单
            React.createElement(
              'span',
              { style: { display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' } },
              React.createElement(
                Select,
                {
                  value: cfg.provider || '',
                  onChange: (e) => setCfg({ ...cfg, provider: e.target.value, model: '' }),
                },
                ...providerOptions.map((p) =>
                  React.createElement('option', { key: p.id, value: p.id }, p.name === p.id ? p.id : p.name + '（' + p.id + '）'),
                ),
              ),
              React.createElement(
                Select,
                {
                  value: cfg.model || '',
                  onChange: (e) => setCfg({ ...cfg, model: e.target.value }),
                },
                cfg.model ? null : React.createElement('option', { key: '__none', value: '' }, '（选一个）'),
                ...models
                  .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: String((m && m.id) || ''), name: String((m && m.name) || (m && m.id) || '') }))
                  .filter((m) => m.id)
                  .map((m) => React.createElement('option', { key: m.id, value: m.id }, (m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id))),
              ),
            ),
          ),
          React.createElement('div', { style: { opacity: 0.55, fontSize: FS.min, marginTop: 6 } }, '评审由这个模型来做；「副模型主刀」打开时，下一轮答复也换成它。'),
          // 1.3.5：默认值本身就同源 —— 这里先说一句，别等花了钱才发现是自评
          React.createElement('div', { style: { opacity: 0.5, fontSize: FS.min, marginTop: 2 } }, '默认是 deepseek-flash；主模型如果也是它，这次复核等于自评 —— 换不同来源、或至少不同档位才有用。'),
        ),

        section(
          '02',
          '评审模式',
          React.createElement(Check, {
            checked: cfg.auto,
            onChange: (e) => setCfg({ ...cfg, auto: e.target.checked }),
            title: '每条回复结束后自动评一次',
            desc: '会调用副模型，产生费用',
            style: { marginBottom: 2 },
          }),
          React.createElement(Check, {
            checked: cfg.mock,
            onChange: (e) => setCfg({ ...cfg, mock: e.target.checked }),
            title: '测试模式：用假数据',
            desc: '不调用模型、不花钱、不落盘 —— 只验界面和流程时打开',
            style: { marginBottom: 2 },
          }),
          // 1.1.0：引文核验（小问那场的补丁）。纯本地比对，不调模型、不花钱
          React.createElement(Check, {
            checked: cfg.checkQuotes !== false,
            onChange: (e) => setCfg({ ...cfg, checkQuotes: e.target.checked }),
            title: '核对引文：助手引用的「你的话」要有出处',
            desc: '在会话记录里找不到出处的，卡上标红；机器比对，不调模型、不花钱',
            style: { marginBottom: 10 },
          }),
          // 0.9.0：45 秒那道总时长闸被他骂掉了，改成"你自己选 + 能随时喊停"
          React.createElement(
            'div',
            { style: { borderTop: '1px solid ' + HAIRLINE_SOFT, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              React.createElement('span', { style: { opacity: 0.7, minWidth: 88 } }, '最长等待'),
              React.createElement(
                'span',
                { style: { marginLeft: 'auto' } },
                React.createElement(
                  Select,
                  {
                    value: String(Number(cfg.budgetSec) || 0),
                    onChange: (e) => setCfg({ ...cfg, budgetSec: Number(e.target.value) || 0 }),
                  },
                  ...[
                    ['0', '不设上限（默认）'],
                    ['180', '3 分钟'],
                    ['300', '5 分钟'],
                    ['45', '45 秒（旧版）'],
                  ].map(([v, t]) => React.createElement('option', { key: v, value: v }, t)),
                ),
              ),
            ),
            React.createElement(
              'div',
              { style: { opacity: 0.5, fontSize: FS.min, marginTop: 4 } },
              '不设上限时，卡上那条线不显示百分比，只表示"它还活着"；随时可以点「停止」',
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 } },
              React.createElement('span', { style: { opacity: 0.7, minWidth: 88 } }, '没动静就收手'),
              React.createElement(
                'span',
                { style: { marginLeft: 'auto' } },
                React.createElement(
                  Select,
                  {
                    value: String(Number(cfg.idleSec) || 0),
                    onChange: (e) => setCfg({ ...cfg, idleSec: Number(e.target.value) || 0 }),
                  },
                  ...[
                    ['0', '永不收手（默认）'],
                    ['120', '2 分钟没一点新字'],
                    ['300', '5 分钟'],
                    ['600', '10 分钟'],
                  ].map(([v, t]) => React.createElement('option', { key: v, value: v }, t)),
                ),
              ),
            ),
            React.createElement(
              'div',
              { style: { opacity: 0.5, fontSize: FS.min, marginTop: 4 } },
              '这是"确认它真的不动了"，不是限它想多久——慢但一直在吐字的，永远不会碰到它。',
            ),
          ),
        ),

        section(
          '03',
          '权限',
          React.createElement(Check, {
            checked: cfg.allowWrite,
            onChange: (e) => setCfg({ ...cfg, allowWrite: e.target.checked }),
            title: '允许副模型改文件',
            desc: '默认关：关着时它连 write_file 这个工具都拿不到；工作区外的路径一律拦。',
          }),
        ),

        section(
          '04',
          '关于',
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
            React.createElement('span', { style: { fontWeight: 600 } }, '二次评审'),
            React.createElement('span', { style: { opacity: 0.5, fontSize: FS.min } }, 'v' + (ver || '1.3.4')),
            React.createElement('span', { style: { opacity: 0.45, fontSize: FS.min } }, '看不到版本号 = 页面还是旧的，重开一次 DSH 窗口'),
          ),
          React.createElement(
            'div',
            { style: { opacity: 0.6, fontSize: FS.small, lineHeight: 1.8 } },
            '评审只写卡片，不改消息、不动会话记录；结果另存一份在 工作区\\二次评审\\。',
            React.createElement('br'),
            '外观会跟着「壁纸插件」的玻璃走；没装就退回中性色，朴素但不坏。',
          ),
        ),

        /* 保存条（2026-11-10 晚）：以前按钮夹在 03 和 04 中间，小、淡、滚两屏就看不见了。
           现在挪到最底下钉住（sticky），按钮按"有没有改动"换脸色，旁边一行字说清"不点不生效"。 */
        React.createElement(
          'div',
          {
            style: {
              position: 'sticky',
              bottom: 0,
              zIndex: 1,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: 4,
              padding: '10px 2px 12px',
              borderTop: '1px solid ' + HAIRLINE_SOFT,
              background: glassFill(240),
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            },
          },
          React.createElement(
            Chip,
            {
              onClick: save,
              disabled: busy || !cfg.model,
              title: !cfg.model ? '先选一个模型' : dirty ? '把改动写进配置' : '保存到配置',
              style: {
                height: 32,
                minWidth: 124,
                justifyContent: 'center',
                padding: '0 18px',
                fontSize: FS.small,
                fontWeight: 600,
                // 有改动时也是"强调色玻璃"，不是实心色块（他 2026-11-10 晚定的质感）
                background: dirty ? accentGlass(26) : glassFill(200),
                borderColor: dirty ? 'color-mix(in srgb, ' + ACCENT + ' 62%, transparent)' : HAIRLINE,
                color: 'inherit',
                boxShadow: dirty ? 'inset 0 1px 0 rgba(255,255,255,0.22)' : 'none',
              },
            },
            busy ? '保存中…' : dirty ? '保存改动' : '保存',
          ),
          React.createElement(
            'span',
            { style: { fontSize: FS.min, color: hintColor, opacity: failedSave || dirty ? 0.95 : 0.55 } },
            hintText,
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots) return

        slots.inject('conversation.chat.turnTail', () =>
          slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: 'second-review-tail',
              order: 30,
              inject: (sessionId) => ({ sessionId }),
            },
            TurnTail,
          ),
        )

        // 设置页：在「插件」页加一个自己的标签页（列表页第一排标签：已安装 / 二次评审）。
        // 试过 plugins.bundle.config 和 plugins.detail.section，前者认不出键、后者拿到的 subject 形状对不上，
        // 标签页这条路不依赖任何 subject，最稳。
        const guard = (slotName, factory) => {
          try {
            slots.inject(slotName, () => {
              try {
                factory()
              } catch (e) {
                initErrors.push(slotName + '：' + String((e && e.message) || e))
              }
            })
          } catch (e) {
            initErrors.push(slotName + '（inject）：' + String((e && e.message) || e))
          }
        }

        guard('plugins.tab', () => {
          slots.register(
            { name: 'plugins.tab', id: 'second-review-tab', label: '二次评审', order: 40 },
            (props) =>
              React.createElement(
                PageBoundary,
                null,
                React.createElement(
                  'div',
                  { style: { padding: '8px 0' } },
                  React.createElement('div', { style: { fontSize: '1.05em', marginBottom: 12 } }, '二次评审 · 设置'),
                  React.createElement(ConfigPage, { view: 'page', ...(props || {}) }),
                ),
              ),
          )
        })
      },
    }
  },
})
