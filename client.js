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

    /* ---------------- 思考中的碎碎念（1.3.6） ----------------
       ↓↓↓ 文案填这里：一行一句，随便加、随便删，随机轮着放 ↓↓↓
       他 2026-11-11 亲手写的九句，就按这个顺序存，每次随机挑一句、不连着重复。 */
    const THINK_LINES = [
      '嗯……帮你理一理',
      '正在认真评审，稍等哦',
      '让我沉下来想一想',
      '试着从这边看看',
      '搬个小板凳坐下来想',
      '嗯……这个说法稳妥吗',
      '让我多问自己一个为什么',
      '补一块砖，站得更稳',
      '调调焦距，看得更清',
    ]

    /* ---------------- 重点提示词预设（1.4.0） ----------------
       他 2026-11-13 的原话：「就一个二次评审按钮 你不知道她会评什么
       有时候自己输入真的会有感觉」。所以评审卡上放输入框 ＋ 三个预设，
       只决定"重点往哪看"，不改变系统提示词里的任何硬约束。 */
    const FOCUS_PRESETS = [
      { key: 'safety', label: '安全风险', text: '重点看：会不会删错东西、丢数据、白花钱，有没有安全或权限上的坑。' },
      { key: 'logic', label: '逻辑漏洞', text: '重点看：论证有没有漏洞、结论站不站得住、有没有被它自己的话带偏。' },
      { key: 'usable', label: '可用性', text: '重点看：给出的方案能不能直接照着做，有没有漏掉关键步骤或前置条件。' },
    ]

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

    /* 1.3.6：弹窗要"非黑即白" —— 跟着现在的皮肤判个明暗，不猜也不写死深色 */
    const isDarkUI = () => {
      try {
        const bg = getComputedStyle(document.body).backgroundColor || ''
        const m = bg.match(/\d+(\.\d+)?/g)
        if (!m || m.length < 3) return true
        const r = Number(m[0])
        const g = Number(m[1])
        const b = Number(m[2])
        return 0.299 * r + 0.587 * g + 0.114 * b < 128
      } catch {
        return true
      }
    }
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

    const settings = { value: null, pending: null, resolved: '' }

    function loadSettings(force) {
      if (!force && settings.value) return Promise.resolve(settings.value)
      if (!force && settings.pending) return settings.pending
      settings.pending = fetch(API + '/config')
        .then((r) => r.json())
        .then((j) => {
          settings.value = (j && j.ok && j.config) || { auto: false }
          // 1.3.6：自动 Pro 档时，后端会告诉我们最终落到哪个模型（卡片和弹窗都要显示它）
          settings.resolved = (j && j.ok && j.resolvedModel) || ''
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

    /* ---------------- 评审重点提示词（1.4.0） ----------------
       "记住上次写的"是全局一份，不是每个会话各存一份；所有评审卡共用这一个值。
       useFocus 返回 [当前值, 设置函数]，设置时同步写进 focusShared 并通知所有卡。 */
    const focusShared = { value: '', touched: false, listeners: new Set() }

    function useFocus() {
      const [focus, setFocusState] = useState(focusShared.value)
      useEffect(() => {
        const l = () => setFocusState(focusShared.value)
        focusShared.listeners.add(l)
        return () => focusShared.listeners.delete(l)
      }, [])
      const setFocus = (v) => {
        focusShared.value = String(v == null ? '' : v)
        focusShared.touched = true
        focusShared.listeners.forEach((l) => l())
      }
      return [focus, setFocus]
    }

    /* ---------------- 1.5.0：评审模式（builtin/custom）全局共享 ---------------- */
    const modeShared = { value: 'builtin', touched: false, listeners: new Set() }

    function useMode() {
      const [mode, setModeState] = useState(modeShared.value)
      useEffect(() => {
        const l = () => setModeState(modeShared.value)
        modeShared.listeners.add(l)
        return () => modeShared.listeners.delete(l)
      }, [])
      const setMode = (v) => {
        modeShared.value = v === 'custom' ? 'custom' : 'builtin'
        modeShared.touched = true
        modeShared.listeners.forEach((l) => l())
      }
      return [mode, setMode]
    }

    /* ---------------- 1.5.0：副输入框（浮条）的全局状态 ----------------
       评审卡点「二次评审」→ openComposer 拉起副框（评审用途），记下"提交时要评哪条"；
       用户手动点浮条入口 → openLeadComposer 拉起（主刀用途）。
       副框回车 → 调 submitFn（评审）或走 leadShared（主刀），再关掉。 */
    const composerShared = { open: false, purpose: 'review', target: null, submitFn: null, listeners: new Set() }
    const emitComposer = () => composerShared.listeners.forEach((l) => l())
    function openComposer(target, submitFn) {
      composerShared.open = true
      composerShared.purpose = 'review'
      composerShared.target = target
      composerShared.submitFn = submitFn
      emitComposer()
    }
    function openLeadComposer() {
      composerShared.open = true
      composerShared.purpose = 'lead'
      composerShared.target = null
      composerShared.submitFn = null
      emitComposer()
    }
    function closeComposer() {
      composerShared.open = false
      composerShared.target = null
      composerShared.submitFn = null
      emitComposer()
    }
    function useComposer() {
      const [, force] = useState(0)
      useEffect(() => {
        const l = () => force((n) => n + 1)
        composerShared.listeners.add(l)
        return () => composerShared.listeners.delete(l)
      }, [])
      return composerShared
    }

    /* ---------------- 1.5.0：副模型主刀（让副模型直接答）的桥接 ----------------
       shell.overlay 拿不到 sessionId 和 inputActions，但 turnTail 有。
       所以副框只负责"收集内容 + 广播"，真正切模型 / 发消息由当前会话的 turnTail 执行：
         requestLead(text) —— 副框回车：一次性主刀（切副模型 → 发内容 → 稍后切回主模型）
       activeSid 由 turnTail 挂载时更新（最后渲染的回复所属会话 ≈ 当前会话）。 */
    const leadShared = { activeSid: '', request: null, listeners: new Set() }
    const emitLead = () => leadShared.listeners.forEach((l) => l())
    function requestLead(text) {
      leadShared.request = { text: String(text || ''), at: Date.now() }
      emitLead()
    }
    function useLead() {
      const [, force] = useState(0)
      useEffect(() => {
        const l = () => force((n) => n + 1)
        leadShared.listeners.add(l)
        return () => leadShared.listeners.delete(l)
      }, [])
      return leadShared
    }

    /* 写回 config（fire-and-forget），focus / mode 共用一个口子 */
    function saveConfig(patch) {
      fetch(API + '/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch || {}),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) settings.value = j.config
        })
        .catch(() => {})
    }

    const swap = { bySession: {}, pending: {}, main: {} }

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
          if (j && j.ok) {
            swap.bySession[k] = !!j.on
            // 1.3.6：顺手把"这个会话现在的主模型"留住 —— 点评审前要拿它比是否重合
            if (j.current && typeof j.current === 'object') swap.main[k] = { provider: String(j.current.provider || ''), model: String(j.current.model || '') }
          }
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

      // 碎碎念：正在评的时候才轮播；停了／到点了就不逗他（他 2026-11-11 要的"轻松一点"）
      const [quipIdx, setQuipIdx] = useState(0)
      const quipOn = !!(entry && entry.state === 'loading')
      useEffect(() => {
        if (!quipOn) return undefined
        const t = setInterval(() => {
          setQuipIdx((i) => {
            if (THINK_LINES.length < 2) return 0
            let n = i
            while (n === i) n = Math.floor(Math.random() * THINK_LINES.length)
            return n
          })
        }, 3200)
        return () => clearInterval(t)
      }, [quipOn])

      useEffect(() => {
        let alive = true
        loadSwap(sessionId).then((v) => {
          if (alive) setSwapOn(!!v)
        })
        return () => {
          alive = false
        }
      }, [sessionId])

      // 1.5.0：主刀不再"点开关直接切模型"，改成"点按钮拉起副输入框、写完回车才主刀"。
      // 手动拉起才激活主刀；副框缩着 / 被二次评审拉起的都不算。
      const swapChip = () =>
        React.createElement(
          Btn,
          {
            tier: 'sec',
            onClick: () => openLeadComposer(),
            active: swapOn,
            title: '点开副输入框，写一句让副模型直接回答（答完自动回主模型）',
          },
          '副模型主刀' + (swapOn ? '：进行中' : ''),
        )

      /* ---------------- 1.5.0：主刀桥接（副框广播 → 当前会话的 turnTail 执行） ----------------
         shell.overlay 拿不到 sessionId / inputActions，这里接住副框发来的 requestLead：
         一次性主刀 —— 切到副模型 → 把内容填进主输入框发出去（副模型答这一轮）→ 稍后切回主模型。
         只让 activeSid 匹配的那一个会话执行；处理时立刻把请求置空，避免同会话多条回复重复发。 */
      const lead = useLead()
      useEffect(() => {
        leadShared.activeSid = sidKey
      }, [sidKey])

      useEffect(() => {
        if (lead.request && sidKey === leadShared.activeSid) {
          const text = lead.request.text
          lead.request = null
          if (text) {
            const swapTo = (on) =>
              fetch(API + '/swap', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId, on }),
              })
                .then((r) => r.json())
                .then((j) => {
                  if (j && j.ok) {
                    swap.bySession[sidKey] = !!j.on
                    setSwapOn(!!j.on)
                  }
                })
                .catch(() => {})
            // 一次性主刀：切到副模型 → 发出去（副模型答这一轮）→ 稍后切回主模型（下一轮回主模型）
            swapTo(true).then(() => {
              try {
                if (inputActions && typeof inputActions.setDraft === 'function' && typeof inputActions.submit === 'function') {
                  inputActions.setDraft(text)
                  inputActions.submit()
                }
              } catch (e) {}
              setTimeout(() => swapTo(false), 800)
            })
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [lead.request])

      /* 1.3.6：这张卡这次花了多少 —— 全从日志和返回里算，不为显示数字多调一次模型。
         复核＝副模型那次（要它真给了用量才显示）；本轮＝主模型这一轮的账（日志里本来就有）。 */
      const fmtTok = (n) => {
        const v = Number(n) || 0
        if (!v) return '0'
        return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(v)
      }
      const usageChip = (u) => {
        if (!u || typeof u !== 'object') return null
        const r = u.review
        const t = u.turn
        const parts = []
        if (r && (r.input || r.output)) parts.push('复核 ' + fmtTok(r.input) + '进/' + fmtTok(r.output) + '出')
        if (t && (t.input || t.output)) parts.push('本轮 ' + fmtTok(t.input) + '进/' + fmtTok(t.output) + '出')
        if (!parts.length) return null
        const cache = []
        if (r && r.cacheRead) cache.push('复核缓存读 ' + fmtTok(r.cacheRead))
        if (t && t.cacheRead) cache.push('本轮缓存读 ' + fmtTok(t.cacheRead))
        return React.createElement(
          'span',
          {
            style: { opacity: 0.5, fontSize: FS.min, whiteSpace: 'nowrap' },
            title: '这些数字是从会话日志和调用回执里算的，没有为显示它们多调一次模型' + (cache.length ? '；' + cache.join('，') : ''),
          },
          parts.join(' · '),
        )
      }
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
          if (alive) setReviewerName(v && (v.resolved || v.model) ? String(v.resolved || v.model) : '')
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
        // 1.5.0：带上模式 + "重点看哪儿"提示词（都读全局共享值，避免自动评审拿到过期闭包）
        const url = API + '/review'
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId || '', seq: seq, job, mock: kind === 'mock', auto: kind === 'auto', mode: modeShared.value, focus: focusShared.value || '' }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok) {
              // 1.3.6：闸门跳过 —— 没花钱，也别装成评过了
              if (json.skipped) {
                setEntry({
                  state: 'skipped',
                  major: [],
                  minor: [],
                  note: String(json.reason || '自动评审跳过了这一轮'),
                  auto: kind === 'auto',
                })
                return
              }
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
                // 1.4.0：这次实际用了哪段"重点看哪儿"提示词（空 = 没指定）
                focus: json.focusPrompt || '',
                // 1.5.0：这次走的是哪种模式（builtin / custom），底栏写出来
                reviewMode: json.reviewMode || 'builtin',
                // 正在跑的是哪一版（改了没生效时一眼看出来）
                version: json.version || '',
                elapsedMs: Number(json.elapsedMs) || 0,
                auto: kind === 'auto',
                truncated: !!json.truncated,
                timedOut: !!json.timedOut,
                mock: !!json.mock,
                steps: Array.isArray(json.steps) ? json.steps : [],
                // 1.3.6：这一次的账（主模型那轮 + 复核自己），拿不到就是 null
                usage: json.usage || null,
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
        startReview(entry && entry.mock ? 'mock' : 'manual')
        inFlight.delete(key)
      }

      /* ---------------- 1.3.6：主副重合 → 点之前拦一下 ----------------
         重合的判断：这个会话的当前主模型（/swap 顺手带回来的）和副模型是同一个。
         只拦"用户自己点评审"这一刻；自动评审照旧在卡片上标出来，不弹窗打扰。 */
      const [fix, setFix] = useState(null)
      const [fixNoMore, setFixNoMore] = useState(false)
      const [fixProviders, setFixProviders] = useState([])
      const [fixModels, setFixModels] = useState([])
      const fixProvider = fix ? String(fix.provider || '') : ''
      useEffect(() => {
        if (!fix) return undefined
        let alive = true
        fetch(API + '/models')
          .then((r) => r.json())
          .then((j) => {
            if (alive && j && j.ok) setFixProviders(j.providers || [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [!!fix])
      useEffect(() => {
        if (!fix || !fixProvider) return undefined
        let alive = true
        fetch(API + '/models?provider=' + encodeURIComponent(fixProvider))
          .then((r) => r.json())
          .then((j) => {
            if (alive && j && j.ok) setFixModels(j.models || [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [fixProvider])

      const modelIdOf = (m) => String((m && typeof m === 'object' ? m.model || m.id : m) || '').trim().toLowerCase()
      const sameAsMain = () => {
        const main = swap.main[sidKey]
        const s = settings.value
        if (!main || !s || s.hideSameSourceModal) return false
        // 自动 Pro 档时，比的是后端最终会用的那个模型（settings.resolved），不是配置里那个旧 id
        const sub = s.modelAuto ? settings.resolved : s.model
        return !!modelIdOf(main) && modelIdOf(main) === modelIdOf(sub)
      }
      const startReview = (kind) => {
        const acked = !!(settings.value && settings.value.noticeAck)
        if (kind !== 'mock' && acked && sameAsMain()) {
          const s = settings.value
          setFix({
            provider: String(s.provider || ''),
            model: String(s.modelAuto ? settings.resolved || s.model || '' : s.model || ''),
            kind,
          })
          setFixNoMore(false)
          return
        }
        run(kind)
      }
      const closeFix = (save) => {
        const patch = { hideSameSourceModal: !!fixNoMore }
        if (save && fix) {
          patch.provider = fix.provider
          patch.model = fix.model
          patch.modelAuto = false
        }
        fetch(API + '/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              settings.value = j.config
              if (j.config && j.config.model) setReviewerName(String(j.config.model))
            }
          })
          .catch(() => {})
        const kind = fix && fix.kind
        setFix(null)
        if (save && kind) run(kind)
      }
      const fixOptions = (list, fallbackId) => {
        const arr = (list && list.length ? list : [{ id: fallbackId || '', name: fallbackId || '' }])
          .map((p) => (typeof p === 'string' ? { id: p, name: p } : { id: String((p && p.id) || ''), name: String((p && p.name) || (p && p.id) || '') }))
          .filter((p) => p.id)
        return arr.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.name === p.id ? p.id : p.name + '（' + p.id + '）'))
      }
      const fixModal = () => {
        if (!fix) return null
        const dark = isDarkUI()
        const bg = dark ? '#151515' : '#fdfdfd'
        const fg = dark ? '#f3f3f3' : '#111'
        const sub = dark ? 'rgba(243,243,243,0.62)' : 'rgba(17,17,17,0.6)'
        const line = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)'
        const inputBg = dark ? '#1f1f1f' : '#fff'
        const selectStyle = {
          width: '100%',
          padding: '7px 8px',
          borderRadius: 8,
          border: '1px solid ' + line,
          background: inputBg,
          color: fg,
          fontSize: FS.small,
          marginTop: 6,
        }
        return React.createElement(
          'div',
          {
            // 把整页压暗，只留这一个窗是亮的
            style: {
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.58)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 16,
            },
            onClick: (e) => {
              if (e && e.target === e.currentTarget) closeFix(false)
            },
          },
          React.createElement(
            'div',
            {
              style: {
                width: 420,
                maxWidth: '100%',
                background: bg,
                color: fg,
                border: '1px solid ' + line,
                borderRadius: 12,
                padding: '18px 18px 14px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
                fontSize: FS.body,
                lineHeight: 1.7,
              },
            },
            React.createElement('div', { style: { fontWeight: 600, fontSize: '1.05em', marginBottom: 4 } }, '当前主副模型重合'),
            React.createElement(
              'div',
              { style: { color: sub, fontSize: FS.small, marginBottom: 12 } },
              '副模型和主模型是同一个（' +
                String((swap.main[sidKey] && swap.main[sidKey].model) || fix.model || '') +
                '），等于让同一双眼睛检查自己 —— 复核效果不佳。换一个再评。',
            ),
            React.createElement('div', { style: { color: sub, fontSize: FS.min, marginBottom: 2 } }, '服务商'),
            React.createElement(
              'select',
              {
                value: fix.provider || '',
                style: selectStyle,
                onChange: (e) => setFix({ ...fix, provider: e.target.value, model: '' }),
              },
              ...fixOptions(fixProviders, fix.provider),
            ),
            React.createElement('div', { style: { color: sub, fontSize: FS.min, margin: '10px 0 2px' } }, '副模型'),
            React.createElement(
              'select',
              {
                value: fix.model || '',
                style: selectStyle,
                onChange: (e) => setFix({ ...fix, model: e.target.value }),
              },
              fix.model ? null : React.createElement('option', { key: '__none', value: '' }, '（选一个）'),
              ...fixOptions(fixModels, ''),
            ),
            React.createElement(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, color: sub, fontSize: FS.min, cursor: 'pointer' } },
              React.createElement('input', {
                type: 'checkbox',
                checked: !!fixNoMore,
                style: { accentColor: ACCENT },
                onChange: (e) => setFixNoMore(!!e.target.checked),
              }),
              '不再提示',
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 } },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => closeFix(false),
                  style: {
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: 'transparent',
                    color: fg,
                    border: '1px solid ' + line,
                    fontSize: FS.small,
                    cursor: 'pointer',
                  },
                },
                '取消',
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => closeFix(true),
                  style: {
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: ACCENT,
                    color: '#fff',
                    border: '1px solid transparent',
                    fontSize: FS.small,
                    fontWeight: 600,
                    cursor: 'pointer',
                  },
                },
                '保存并评审',
              ),
            ),
          ),
        )
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
          // 碎碎念：一句一行地换，像有人在旁边用大白话垫着（到点／卡住／停止时不出现）
          !over && !stalling && !stopping
            ? React.createElement(
                'div',
                {
                  style: {
                    marginTop: 6,
                    fontSize: FS.min,
                    opacity: 0.45,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                '· ' + THINK_LINES[quipIdx % THINK_LINES.length],
              )
            : null,
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

      // 1.3.6：闸门跳过（没花钱，也别装成评过了）
      if (state === 'skipped') {
        return React.createElement(
          'div',
          {
            key: 'skipped',
            ref: grow,
            style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: FS.min, opacity: 0.6 },
          },
          React.createElement('span', { style: { opacity: 0.9 } }, '自动评审跳过：' + String((entry && entry.note) || '这一轮没动过手').slice(0, 80)),
          React.createElement(Btn, { tier: 'lite', onClick: () => run('manual'), title: '这一轮还是评一次（会调用副模型、花钱）' }, '还是评一下'),
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
          entry && entry.focus
            ? React.createElement(
                'div',
                { ref: reveal(40), style: { opacity: 0.6, fontSize: FS.min, marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                '这次重点看：' + entry.focus,
              )
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
                  entry && entry.reviewMode === 'custom' ? React.createElement('span', null, '· 自定义模式') : null,
                )
              : null,
            usageChip(entry && entry.usage),
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
          fixModal(),
        )
      }

      // 未评：一个实心主操作，其余退成细边。点「二次评审」拉起副输入框，写完回车才真正评审（1.5.0）
      return React.createElement(
        'div',
        { style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: FS.body } },
        React.createElement(
          Btn,
          { tier: 'pri', onClick: () => openComposer({ sessionId, seq }, () => startReview('manual')), title: '让 ' + (reviewerName || '副模型') + ' 挑一遍这一轮的毛病' },
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
        fixModal(),
      )
    }

    /* ---------------- 1.5.1：副输入框「抽牌」动画层 ----------------
       他 2026-11-14 要的：副框像一张牌从主框下面被抽出来、展开；在对话区占真实位置；
       只盖主框上半，下半留出来点得回主框；开合不跳两下；扑克牌的层次和质感，丝滑优雅。
       做法（交接词 §3 重做动画层，不在 1.5.0 上叠 overlay）：
         · 单一 rAF 驱动器：占位高度、牌的高度/位移/圆角/阴影、内容淡入、扫光，全由同一个
           进度值 p 算出 —— 同一段动画、同一个节奏，主框随占位联动，天然不跳；
         · 测量只一次：开合起点冻结主框矩形与面板自然高度，动画期间不量自己变形后的位置；
         · 可打断：动画中途再点，从当前 p 平滑反向，不瞬移；
         · 牌边不消失：同一个容器从牌边大小长到面板大小，视觉上同一张牌；
         · 评审/主刀逻辑一行不改，只动外层容器和动画。 */
    const SEC_STYLE_ID = 'second-review-composer-style'
    function ensureComposerStyle() {
      if (typeof document === 'undefined' || document.getElementById(SEC_STYLE_ID)) return
      const st = document.createElement('style')
      st.id = SEC_STYLE_ID
      st.textContent = [
        '[data-sec-card] textarea:focus{border-color:color-mix(in srgb, var(--we-accent, #3b82f6) 55%, transparent)!important;box-shadow:0 0 0 3px color-mix(in srgb, var(--we-accent, #3b82f6) 14%, transparent)}',
        /* 内容淡入交给合成器过渡：rAF 只负责"点火"一次，收尾不再逐帧写，消除末尾顿挫。
           只在展开方向启用过渡；收起时关掉，跟手缩回不拖影 */
        '[data-sec-card][data-sec-dir="open"] [data-sec-content]{transition:opacity .26s cubic-bezier(.33,1,.68,1)}',
        /* 展开时悬停主框露出的下半：手指＋浮出一行提示小字（1.5.1 交互细节，他点的） */
        '[data-sec-half-hover]{cursor:pointer!important}',
        '[data-sec-half-hover] *{cursor:pointer!important}',
        '[data-sec-card] ::-webkit-scrollbar{width:8px;height:8px}',
        '[data-sec-card] ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:4px}',
        '[data-sec-card] ::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.55)}',
        '[data-sec-card] ::-webkit-scrollbar-track{background:transparent}',
      ].join('\n')
      document.head.appendChild(st)
    }

    /* 缓动：抽牌用"快起慢落"的五次方出缓动，优雅不弹跳；悬停小动作用三次方 */
    const secEaseOutQuint = (t) => 1 - Math.pow(1 - t, 5)
    const secEaseOutCubic = (t) => 1 - Math.pow(1 - t, 3)
    const secClamp01 = (t) => Math.max(0, Math.min(1, t))
    const secLerp = (a, b, t) => a + (b - a) * t

    /* 纯几何：给定主框矩形 / 面板自然高 / 进度 p(0=牌边,1=展开)，算出这一帧的所有量。
       抽出来当纯函数，动画测试直接喂数验证，不靠浏览器。
       占位联动：a=动画起点时占位块的实际高度，b=目标占位高度，q=本段动画进度（与 p 同源）。
       牌底相对主框**实际顶边**下沉 drop：收起 0、展开半高 —— 只盖上半由此保证。
       主框实际顶边由 applyFrame 每帧读布局真值（主框不被我们变形，读它不算量自己），
       所以"主框被顶下去"和"对话被压缩、主框不动"两种宿主布局都正确，不会沉到地下。
       展开目标占位 b=panelH-cardH/2+8：牌顶恰好停在对话区底＋8px，不盖对话文字。 */
    function secCardGeometry(pos, panelH, p, hover, a, b, q, cardTop) {
      const cardH = pos ? pos.height : 76
      const sheetH = Math.max(18, Math.round(cardH * 0.5))
      const sOpen = Math.max(sheetH, Math.round(panelH - cardH / 2 + 8))
      const a0 = a == null ? sheetH : a
      const b0 = b == null ? sOpen : b
      const q0 = q == null ? p : q
      const S = secLerp(a0, b0, q0)
      /* 宽度回旧版（他 11-14 真机后拍板）：跟主框一样长、左右各留 23，收起/展开同宽 */
      const W = pos ? Math.max(160, Math.round(pos.width - 46)) : 220
      const left = pos ? pos.left + 23 : 30
      /* 牌边是完整牌面：向下多画 tuck=8px（大于悬停上抽量 6），再用 clip-path 裁掉
         伸进主框的部分——重叠区不绘制，任何宿主层级下都"只看见主框"；悬停上抽时
         底边仍贴合主框顶，不露裂缝。展开初段裁切随 p 释放，牌像从主框后面升上来。
         占位按可见高 sheetH 算，tuck 不影响版面。 */
      const tuck = 8
      const H = secLerp(sheetH + tuck, panelH, p)
      const top = cardTop == null ? (pos && pos.top != null ? pos.top : 700) : cardTop
      /* 牌底沉到主框实际顶边之下多少：收起＝tuck（裁掉不可见）、展开＝半高；面板太矮时少沉一点，
         保证牌顶不越过对话区底＋8（不盖对话优先）；悬停上抽 6px 只在牌边态 */
      const dropFull = Math.min(cardH / 2, Math.max(0, panelH - sheetH - 8))
      const drop = secLerp(tuck, dropFull, p) - (hover ? 6 * (1 - p) : 0)
      const clip = Math.max(0, drop) * (1 - secClamp01(p / 0.15))
      const radius = secLerp(14, 16, p)
      const contentOp = p >= 1 ? 1 : secClamp01((p - 0.55) / 0.45)
      const labelOp = p <= 0 ? 1 : secClamp01(1 - p / 0.3)
      const shineX = secLerp(-130, 260, secClamp01((p - 0.12) / 0.8))
      /* 扫光用正弦包络：起止都平滑归零，不在收尾处突然切断（消除末尾顿挫） */
      const shineOp = 0.9 * Math.sin(Math.PI * secClamp01((p - 0.12) / 0.88))
      const lift = p * 26
      const shadow =
        '0 ' + (8 + lift) + 'px ' + (18 + lift * 1.6) + 'px rgba(0,0,0,' + (0.3 + 0.18 * p) + '), ' +
        '0 1px 0 rgba(255,255,255,' + (0.1 + 0.06 * p) + ') inset'
      return { sheetH, sOpen, space: S, W, left, H, top, drop, clip, radius, contentOp, labelOp, shineX, shineOp, shadow }
    }

    function ComposerOverlay() {
      const [mode, setMode] = useMode()
      const [focus, setFocus] = useFocus()
      const comp = useComposer()
      const [pos, setPos] = useState(null)
      const [dark] = useState(isDarkUI())
      const [leadText, setLeadText] = useState('')
      const [entryHover, setEntryHover] = useState(false)
      const cardRef = React.useRef(null)
      const contentRef = React.useRef(null)
      const labelRef = React.useRef(null)
      const shineRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const spaceRef = React.useRef(null)
      const animRef = React.useRef(null)
      const geoRef = React.useRef(null)
      const hoverRef = React.useRef(false)
      const hoverAnimRef = React.useRef(0)
      const contentOnRef = React.useRef(false)
      /* 副框里的模型条（1.5.1）：复用设置页 01 段的两个下拉，选择即保存 */
      const [mcfg, setMcfg] = useState(null)
      const [mproviders, setMproviders] = useState([])
      const [mmodels, setMmodels] = useState([])
      const [mresolved, setMresolved] = useState('')

      /* 拉起副框时：点副框外任意处 / 点回主输入框 / 按 Esc 都收起来 */
      useEffect(() => {
        if (!comp.open) return
        const onFocusIn = (e) => {
          const t = e.target
          if (t && t.closest && t.closest('[data-composer-card]')) closeComposer()
        }
        const onKey = (e) => {
          if (e.key === 'Escape') closeComposer()
        }
        /* 点外部收起用 pointerdown 不用 click：原生下拉的系统弹层不派发 document 的
           click，pointerdown 才收得到；副框内部与主框本身不算外部（主框另有归路）。 */
        const onPointerDown = (e) => {
          const t = e.target
          if (!t || !t.closest) return
          if (t.closest('[data-sec-card]') || t.closest('[data-composer-card]') || t.closest('[data-sec-half-tip]')) return
          closeComposer()
        }
        document.addEventListener('focusin', onFocusIn, true)
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('focusin', onFocusIn, true)
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [comp.open])

      /* 展开时主框露出的下半：指针变手指＋浮出一行「点击切回主输入框」。
         只在自己的元素上加属性/临时 fixed 小条，不搬动 React 管理的节点。 */
      useEffect(() => {
        if (!comp.open) return
        const host = document.querySelector('[data-composer-card]')
        if (!host) return
        host.setAttribute('data-sec-half-hover', '')
        const tip = document.createElement('div')
        tip.setAttribute('data-sec-half-tip', '')
        tip.textContent = '点击切回主输入框'
        const d = isDarkUI()
        tip.style.cssText =
          /* 必须高于主框所在的层叠上下文，否则会被主框背景整块挡住（实测过）；
             不靠层级防遮挡——落位被夹在主框露出的下半带里，见 place() */
          'position:fixed;z-index:9991;pointer-events:none;white-space:nowrap;' +
          'padding:4px 10px;border-radius:8px;font-size:12px;line-height:1.4;' +
          'letter-spacing:.02em;opacity:0;transform:translateY(3px);' +
          'transition:opacity .16s ease,transform .16s cubic-bezier(.33,1,.68,1);' +
          'color:' + (d ? '#f3f3f3' : '#151515') + ';' +
          'background:' + (d ? 'rgba(28,29,34,0.96)' : 'rgba(252,252,253,0.98)') + ';' +
          'border:1px solid ' + (d ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)') + ';' +
          'box-shadow:0 8px 22px rgba(0,0,0,' + (d ? '0.42' : '0.16') + ');' +
          'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
        /* 挂到副框同一个父节点：与牌共享层叠上下文，z 序才可比；
           父节点由 React 管，只在末尾追加自己的临时节点，不搬动它的子节点。 */
        const mount = (cardRef.current && cardRef.current.parentElement) || document.body
        mount.appendChild(tip)
        let shown = false
        let raf = 0
        let last = null
        /* 每帧按**实时**矩形重新夹取：占位撑开/滚动/缩放导致布局后移时自愈，
           不会留在旧坐标上爬到面板上去（一次性算位实测会错位）。 */
        const layout = () => {
          if (!last) return
          const r = host.getBoundingClientRect()
          const w = tip.offsetWidth || 132
          const h = tip.offsetHeight || 26
          const panelBottom = cardRef.current ? cardRef.current.getBoundingClientRect().bottom : r.top + r.height / 2
          const bandTop = Math.max(r.top + r.height / 2, panelBottom) + 4
          const bandBottom = r.bottom - 4
          let y = last.y + 18
          if (bandBottom - bandTop >= h) y = Math.max(bandTop, Math.min(y, bandBottom - h))
          else y = Math.min(r.bottom + 6, window.innerHeight - h - 8)
          const x = Math.max(r.left + 4, Math.min(last.x + 14, Math.min(r.right - w - 4, window.innerWidth - w - 10)))
          tip.style.left = x + 'px'
          tip.style.top = Math.max(8, y) + 'px'
        }
        const loop = () => {
          if (!shown) { raf = 0; return }
          layout()
          raf = requestAnimationFrame(loop)
        }
        const hide = () => {
          shown = false
          last = null
          if (raf) { cancelAnimationFrame(raf); raf = 0 }
          tip.style.opacity = '0'
          tip.style.transform = 'translateY(3px)'
        }
        const place = (e) => {
          const r = host.getBoundingClientRect()
          /* 只在露出的下半区提示：上半被副框盖着，不该抢它的悬停 */
          if (e.clientY < r.top + r.height / 2 - 1) { if (shown) hide(); return }
          last = { x: e.clientX, y: e.clientY }
          layout()
          if (!shown) {
            shown = true
            tip.style.opacity = '1'
            tip.style.transform = 'translateY(0)'
            if (!raf) raf = requestAnimationFrame(loop)
          }
        }
        host.addEventListener('pointermove', place)
        host.addEventListener('pointerleave', hide)
        host.addEventListener('pointerdown', hide)
        return () => {
          host.removeEventListener('pointermove', place)
          host.removeEventListener('pointerleave', hide)
          host.removeEventListener('pointerdown', hide)
          if (raf) cancelAnimationFrame(raf)
          host.removeAttribute('data-sec-half-hover')
          tip.remove()
        }
      }, [comp.open])

      /* 拉起就聚焦到副框的输入区，直接能打字 */
      useEffect(() => {
        if (!comp.open) return
        const t = setTimeout(() => {
          try {
            if (inputRef.current) inputRef.current.focus()
          } catch {}
        }, 60)
        return () => clearTimeout(t)
      }, [comp.open])

      useEffect(() => {
        ensureComposerStyle()
      }, [])

      // 挂载时：从 config 读上次的模式 + 提示词（用户没动过才灌，别覆盖他正在写的）
      useEffect(() => {
        loadSettings().then((v) => {
          if (!v) return
          if (!modeShared.touched && typeof v.reviewMode === 'string') {
            modeShared.value = v.reviewMode === 'custom' ? 'custom' : 'builtin'
            modeShared.listeners.forEach((l) => l())
          }
          if (!focusShared.touched && typeof v.focusPrompt === 'string' && v.focusPrompt) {
            focusShared.value = v.focusPrompt
            focusShared.listeners.forEach((l) => l())
          }
        })
      }, [])

      /* 锚定 [data-composer-card]。动画期间冻结测量（不量自己变形后的位置）；
         位置真变了（窗口缩放等）才重算，且只更新几何基准，不打断动画。
         锚不到主输入框（插件页 / 设置页 / 页面切换中）就整块收掉：副框只在主对话页存在，
         否则它会在 overlay 插槽里按静态位置画出来——2026-11-14 他截图的那个 bug。 */
      useEffect(() => {
        const hide = () => {
          if (animRef.current) animRef.current.running = false
          if (composerShared.open) closeComposer()
          setPos(null)
        }
        const recalc = () => {
          const el = document.querySelector('[data-composer-card]')
          if (!el) { hide(); return }
          if (animRef.current && animRef.current.running) return
          const r = el.getBoundingClientRect()
          if (r.width < 10 || r.height < 10) { hide(); return }
          const next = { left: r.left, top: r.top, width: r.width, height: r.height, bottom: window.innerHeight - r.top + 8, edge: window.innerHeight - r.bottom }
          setPos((p) =>
            p &&
            Math.abs(p.left - next.left) < 0.5 &&
            Math.abs((p.top || 0) - next.top) < 0.5 &&
            Math.abs(p.width - next.width) < 0.5 &&
            Math.abs((p.height || 0) - next.height) < 0.5 &&
            Math.abs(p.bottom - next.bottom) < 0.5 &&
            Math.abs((p.edge || 0) - next.edge) < 0.5
              ? p
              : next,
          )
        }
        recalc()
        /* 页面切换（点侧栏 / 换会话）时尽快收掉，不等下一个心跳；
           点击后 80ms 再量——那一刻 React 已经换完页。 */
        let nav = 0
        const afterNav = () => {
          if (nav) return
          nav = setTimeout(() => { nav = 0; recalc() }, 80)
        }
        window.addEventListener('resize', recalc)
        window.addEventListener('scroll', recalc, true)
        document.addEventListener('pointerdown', afterNav, true)
        const t = setInterval(recalc, 250)
        return () => {
          window.removeEventListener('resize', recalc)
          window.removeEventListener('scroll', recalc, true)
          document.removeEventListener('pointerdown', afterNav, true)
          if (nav) clearTimeout(nav)
          clearInterval(t)
        }
      }, [])

      /* 占位块：插在主框前面，只插一次、只由动画驱动器写高度。
         宿主容器不是纵向 flex/grid 就不插，退回悬浮（宁可不占位，也不能把版面弄乱）。 */
      useEffect(() => {
        if (typeof document === 'undefined' || !pos) return
        const card = document.querySelector('[data-composer-card]')
        const parent = card && card.parentElement
        if (!parent) return
        const cs = getComputedStyle(parent)
        const column = (cs.display.includes('flex') && String(cs.flexDirection).startsWith('column')) || cs.display.includes('grid')
        if (!column) return
        const space = document.createElement('div')
        space.setAttribute('data-sec-space', '')
        space.style.cssText = 'height:0px;pointer-events:none;flex:0 0 auto;overflow:hidden;'
        try {
          parent.insertBefore(space, card)
        } catch {
          return
        }
        spaceRef.current = space
        return () => {
          space.remove()
          spaceRef.current = null
        }
      }, [pos])

      /* 把一帧的几何量写进 DOM（牌容器 / 内容 / 牌边小字 / 扫光 / 占位）。
         单驱动器调用，无竞争；内容层在不可见时不吃点击（牌边态要点得到）。 */
      const applyFrame = (g, p) => {
        /* 先写占位，再读主框布局真值（它不被我们变形）：同一帧内联动，无滞后 */
        if (spaceRef.current) spaceRef.current.style.height = Math.round(g.space) + 'px'
        const card = cardRef.current
        if (card) {
          /* 首帧由样式表藏着，等几何量写进来才露面 —— 否则会在静态位置闪一下没位置的牌 */
          card.style.visibility = 'visible'
          const host = document.querySelector('[data-composer-card]')
          const top = host ? host.getBoundingClientRect().top : g.top
          card.style.left = g.left + 'px'
          card.style.width = g.W + 'px'
          card.style.height = g.H + 'px'
          card.style.top = top + g.drop - g.H + 'px'
          /* 收起时牌在主框下一层＋重叠区裁掉：只看见主框；拉起才升上来 */
          card.style.zIndex = p > 0.02 ? 9990 : 9989
          card.style.clipPath = g.clip > 0.5 ? 'inset(0px 0px ' + g.clip + 'px 0px)' : 'none'
          card.style.borderRadius = g.radius + 'px ' + g.radius + 'px ' + (p > 0.5 ? g.radius : 0) + 'px ' + (p > 0.5 ? g.radius : 0) + 'px'
          card.style.boxShadow = g.shadow
        }
        if (contentRef.current) {
          /* 淡入只点火一次，之后由 CSS 过渡跑完；反向/瞬移才直接写值 */
          const el = contentRef.current
          if (g.contentOp >= 1) {
            if (!contentOnRef.current) {
              contentOnRef.current = true
              el.style.opacity = '1'
            }
          } else {
            contentOnRef.current = false
            el.style.opacity = String(g.contentOp)
          }
          el.style.pointerEvents = g.contentOp > 0.5 ? 'auto' : 'none'
        }
        if (labelRef.current) labelRef.current.style.opacity = g.labelOp * (hoverRef.current ? 0.95 : 0.72)
        if (shineRef.current) {
          shineRef.current.style.opacity = g.shineOp
          shineRef.current.style.transform = 'translateX(' + g.shineX + '%) skewX(-18deg)'
        }
      }

      /* 单一动画驱动器：从当前 p 平滑走到目标（0/1），可中途反向。
         起点冻结：面板自然高（量一次）、占位起点 a、占位目标 b；全程纯函数算帧。 */
      const startAnim = (target) => {
        const reduce = quietMotion()
        const from = animRef.current ? animRef.current.p : 0
        /* 方向标在容器上：展开才启用内容淡入过渡，收起跟手不拖影 */
        if (cardRef.current) cardRef.current.setAttribute('data-sec-dir', target === 1 ? 'open' : 'close')
        const panelH0 = geoRef.current ? geoRef.current.panelH : 240
        const a = spaceRef.current ? parseFloat(spaceRef.current.style.height) || 0 : 0
        if (reduce || Math.abs(target - from) < 0.001) {
          const gImm = secCardGeometry(pos, panelH0, target, false)
          applyFrame(secCardGeometry(pos, panelH0, target, false, a, target === 1 ? gImm.sOpen : gImm.sheetH, 1), target)
          animRef.current = { p: target, running: false }
          return
        }
        /* 量一次面板自然高度：内容层临时改回文档流读高，读完立刻恢复绝对定位 */
        let panelH = panelH0
        const content = contentRef.current
        if (content && target === 1) {
          const prevPos = content.style.position
          const prevInset = content.style.inset
          const prevOverflow = content.style.overflow
          content.style.position = 'relative'
          content.style.inset = 'auto'
          content.style.overflow = 'visible'
          panelH = Math.min(Math.max(content.scrollHeight + 2, 150), Math.round(window.innerHeight * 0.64))
          content.style.position = prevPos
          content.style.inset = prevInset
          content.style.overflow = prevOverflow
        }
        geoRef.current = { panelH }
        const g0 = secCardGeometry(pos, panelH, from, false)
        const b = target === 1 ? g0.sOpen : g0.sheetH
        const dur = target === 1 ? 460 : 380
        const t0 = performance.now()
        const state = { p: from, running: true }
        animRef.current = state
        const tick = (now) => {
          if (animRef.current !== state) return
          const t = secClamp01((now - t0) / dur)
          const q = secEaseOutQuint(t)
          const p = secLerp(from, target, q)
          state.p = p
          applyFrame(secCardGeometry(pos, panelH, p, hoverRef.current && p < 0.05, a, b, q), p)
          if (t < 1) requestAnimationFrame(tick)
          else state.running = false
        }
        requestAnimationFrame(tick)
      }

      /* 开合状态变化 → 驱动动画。挂载时先把牌边摆好（p=0）。 */
      useEffect(() => {
        if (!pos) return
        if (!animRef.current) {
          geoRef.current = { panelH: 240 }
          applyFrame(secCardGeometry(pos, 240, 0, false), 0)
          animRef.current = { p: 0, running: false }
        }
        startAnim(comp.open ? 1 : 0)
      }, [comp.open, pos])

      /* 悬停上抽：牌边态鼠标进出，6px 小位移也走缓动，不瞬移。
         主驱动器在跑时不插手，避免两个驱动器写同一帧。 */
      useEffect(() => {
        if (comp.open || !pos) return
        if (animRef.current && animRef.current.running) return
        const from = hoverAnimRef.current
        const to = entryHover ? 1 : 0
        if (Math.abs(to - from) < 0.001) return
        const paint = (h) => {
          const a = spaceRef.current ? parseFloat(spaceRef.current.style.height) || 0 : 0
          const gH = secCardGeometry(pos, geoRef.current ? geoRef.current.panelH : 240, 0, h)
          applyFrame(secCardGeometry(pos, geoRef.current ? geoRef.current.panelH : 240, 0, h, a, gH.sheetH, 1), 0)
        }
        if (quietMotion()) {
          hoverAnimRef.current = to
          paint(to)
          return
        }
        const t0 = performance.now()
        const tick = (now) => {
          if (animRef.current && animRef.current.running) return
          const t = secClamp01((now - t0) / 180)
          const h = secLerp(from, to, secEaseOutCubic(t))
          hoverAnimRef.current = h
          paint(h)
          if (t < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }, [entryHover, comp.open, pos])

      /* 卸载时停驱动器 */
      useEffect(() => () => { if (animRef.current) animRef.current.running = false }, [])

      /* 模型条数据：拉起时读配置＋供应商清单；供应商变化时拉模型清单（alive flag 防竞态） */
      useEffect(() => {
        if (!comp.open) return
        let alive = true
        loadSettings(true).then((v) => {
          if (!alive) return
          setMcfg(v || {})
          setMresolved(settings.resolved || '')
        })
        fetch(API + '/models')
          .then((r) => r.json())
          .then((j) => { if (alive && j && j.ok) setMproviders(j.providers || []) })
          .catch(() => {})
        return () => { alive = false }
      }, [comp.open])
      const mprovider = mcfg && mcfg.provider
      useEffect(() => {
        if (!comp.open || !mprovider) return
        let alive = true
        fetch(API + '/models?provider=' + encodeURIComponent(mprovider))
          .then((r) => r.json())
          .then((j) => { if (alive && j && j.ok) setMmodels(j.models || []) })
          .catch(() => { if (alive) setMmodels([]) })
        return () => { alive = false }
      }, [comp.open, mprovider])
      /* 选择即保存（副框里没有"保存"按钮，不能让他选了不生效） */
      const saveModelPatch = (patch) => {
        setMcfg((c) => ({ ...(c || {}), ...patch }))
        fetch(API + '/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              settings.value = j.config
              setMcfg(j.config)
              setMresolved(j.resolvedModel || '')
            }
          })
          .catch(() => {})
      }

      /* 副框只在主对话页存在：锚不到主输入框就整块不渲染（插件页 / 设置页 / 切换中）。
         只藏不卸载，回对话页量到几何就自己回来。 */
      if (!pos) return null

      const custom = mode === 'custom'
      const isLead = comp.purpose === 'lead'
      const empty = custom && !focus.trim()
      const leadEmpty = isLead && !leadText.trim()

      const submit = () => {
        if (isLead) {
          if (leadEmpty) return
          requestLead(leadText) // 切到副模型 + 把内容发出去（副模型答）
          setLeadText('')
          closeComposer()
          return
        }
        if (empty) return
        const fn = comp.submitFn
        closeComposer()
        if (fn) fn()
      }
      const changeMode = (m) => {
        setMode(m)
        saveConfig({ reviewMode: m })
      }
      const changeFocus = (v) => {
        setFocus(v)
        saveConfig({ focusPrompt: v })
      }

      const fg = dark ? '#f3f3f3' : '#151515'
      const sub = dark ? 'rgba(243,243,243,0.55)' : 'rgba(17,17,17,0.55)'
      const line = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'
      const accent = 'var(--we-accent, #3b82f6)'

      /* 扑克牌牌面：有厚度的纸，深/浅两套；顶部一道高光、底部一条纸边 */
      const cardFace = dark
        ? 'linear-gradient(157deg, #2e3037 0%, #1d1e23 52%, #131417 100%)'
        : 'linear-gradient(157deg, #ffffff 0%, #f3f4f7 55%, #e7e9ee 100%)'
      const cardEdge = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)'

      const modeBtn = (m, label) =>
        React.createElement(
          Chip,
          {
            onClick: () => changeMode(m),
            active: mode === m,
            title: m === 'builtin' ? '使用插件内置评审规则，附加提示词仅用于指定复核重点' : '自定义提示词作为最高评审准则（必填）',
            style: { fontSize: FS.min, fontWeight: mode === m ? 600 : 400 },
          },
          label,
        )

      /* 模型条选项归一化（/models 给对象，不能当文字渲染，0.6.2 的教训） */
      const mProviderOptions = (mproviders.length ? mproviders : [{ id: (mcfg && mcfg.provider) || '', name: (mcfg && mcfg.provider) || '' }])
        .map((p) => (typeof p === 'string' ? { id: p, name: p } : { id: String((p && p.id) || ''), name: String((p && p.name) || (p && p.id) || '') }))
        .filter((p) => p.id)
      const mModelOptions = mmodels
        .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: String((m && m.id) || ''), name: String((m && m.name) || (m && m.id) || '') }))
        .filter((m) => m.id)
      const mCurrentName = mcfg && mcfg.modelAuto === false ? (mcfg.model || '未选') : (mresolved || 'Pro 档')

      /* 同一个容器＝同一张牌：牌边态是它的缩略，展开态是它的完整。
         初始样式由 applyFrame 在挂载时写入；这里只给静态的牌面质感。 */
      return React.createElement(
        'div',
        {
          ref: cardRef,
          'data-sec-card': '',
          /* 点击只在牌边态生效；展开态不挂 onClick（DSH 里裸容器 onClick 会吞掉内部按钮的点击，× 关不掉就是这么来的） */
          onClick: comp.open ? undefined : () => openLeadComposer(),
          onMouseEnter: () => { hoverRef.current = true; setEntryHover(true) },
          onMouseLeave: () => { hoverRef.current = false; setEntryHover(false) },
          title: comp.open ? undefined : '拉起副输入框，输入内容后由副模型作答',
          style: {
            position: 'fixed',
            zIndex: 9989,
            /* 量到主框几何之前不露面（见 applyFrame）；副框只在主对话页存在 */
            visibility: 'hidden',
            boxSizing: 'border-box',
            background: cardFace,
            border: '1px solid ' + cardEdge,
            color: fg,
            overflow: 'hidden',
            cursor: comp.open ? 'default' : 'pointer',
            userSelect: 'none',
            willChange: 'height, bottom',
            maxHeight: '64vh',
          },
        },
        /* 牌顶一道纸边高光：扑克牌的厚度感 */
        React.createElement('div', {
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: dark
              ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))'
              : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.9), rgba(255,255,255,0))',
            pointerEvents: 'none',
          },
        }),
        /* 牌边小字（收起态可见，展开淡出） */
        React.createElement(
          'div',
          {
            ref: labelRef,
            style: {
              position: 'absolute',
              left: 14,
              right: 14,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              fontSize: FS.min,
              lineHeight: 1.2,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pointerEvents: 'none',
            },
          },
          '点击输入指令，Enter 交由副模型作答',
        ),
        /* 牌面扫光（展开时一次性掠过） */
        React.createElement('div', {
          ref: shineRef,
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '42%',
            height: '100%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.10), rgba(255,255,255,0))',
            opacity: 0,
            pointerEvents: 'none',
          },
        }),
        /* 完整面板内容（晚淡入，第一帧不读压扁的字） */
        React.createElement(
          'div',
          {
            ref: contentRef,
            'data-sec-content': '',
            /* 内容层自己挡冒泡：内部交互不传到牌容器，× / 模式 / 预设才点得动 */
            onClick: (e) => e.stopPropagation(),
            style: {
              position: 'absolute',
              inset: 0,
              boxSizing: 'border-box',
              padding: '12px 14px',
              opacity: 0,
              overflow: 'auto',
              fontSize: FS.body,
            },
          },
          // 顶部：标题行 + 关闭
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
            React.createElement('span', { style: { fontSize: FS.min, opacity: 0.5, marginRight: 2 } }, isLead ? '副模型作答' : '独立复核'),
            /* 占位撑开，× 钉在右上角 */
            React.createElement('span', { style: { flex: 1, minWidth: 6 } }),
            isLead
              ? React.createElement('span', { style: { fontSize: FS.min, opacity: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, '发送后切换至副模型，作答完成自动切回主模型')
              : React.createElement(
                  React.Fragment,
                  null,
                  modeBtn('builtin', '评审模式'),
                  modeBtn('custom', '提示词自定义'),
                ),
            React.createElement(
              Chip,
              {
                onClick: (e) => {
                  if (e && e.stopPropagation) e.stopPropagation()
                  closeComposer()
                },
                title: '收起副输入框（Esc）',
                style: { fontSize: FS.min, opacity: 0.6 },
              },
              '×',
            ),
          ),
          // 输入框
          React.createElement('textarea', {
            ref: inputRef,
            value: isLead ? leadText : focus,
            rows: 2,
            placeholder: isLead ? '输入任务或问题，Enter 发送至副模型' : custom ? '输入自定义评审准则（必填，作为最高评审准则）' : '指定复核重点（可选）',
            onChange: (e) => (isLead ? setLeadText(e.target.value) : changeFocus(e.target.value)),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            },
            style: {
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid ' + line,
              background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              color: fg,
              fontSize: FS.small,
              lineHeight: 1.6,
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              minHeight: 42,
            },
          }),
          // 模型条（1.5.1，他真机后加的）：独立一条，两个下拉＝设置页 01 段同款，选择即保存；
          // 右侧展示当前实际使用的副模型（他画的那两个框的位置）
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 } },
            React.createElement('span', { style: { fontSize: FS.min, opacity: 0.55, flex: 'none' } }, '副模型'),
            React.createElement(
              Select,
              {
                value: (mcfg && mcfg.provider) || '',
                onChange: (e) => saveModelPatch({ provider: e.target.value, model: '', modelAuto: true }),
              },
              ...mProviderOptions.map((p) =>
                React.createElement('option', { key: p.id, value: p.id }, p.name === p.id ? p.id : p.name + '（' + p.id + '）'),
              ),
            ),
            React.createElement(
              Select,
              {
                value: mcfg && mcfg.modelAuto === false ? mcfg.model || '' : '__auto__',
                onChange: (e) => {
                  const v = e.target.value
                  if (v === '__auto__') saveModelPatch({ modelAuto: true })
                  else saveModelPatch({ model: v, modelAuto: false })
                },
              },
              React.createElement('option', { key: '__auto__', value: '__auto__' }, '自动：Pro 档'),
              mcfg && mcfg.modelAuto === false && mcfg.model ? null : React.createElement('option', { key: '__none', value: '' }, '（手动选一个）'),
              ...mModelOptions.map((m) =>
                React.createElement('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id),
              ),
            ),
            React.createElement(
              'span',
              { style: { fontSize: FS.min, opacity: 0.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }, title: '当前副模型：' + mCurrentName },
              '当前：' + mCurrentName,
            ),
          ),
          // 预设（仅评审态）＋发送：独立一条，发送按钮靠右，不被模型条挤到换行
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 } },
            ...(isLead
              ? []
              : FOCUS_PRESETS.map((p) =>
                  React.createElement(
                    Chip,
                    { key: p.key, onClick: () => changeFocus(p.text), title: p.text, style: { fontSize: FS.min } },
                    p.label,
                  ),
                )),
            React.createElement('span', { style: { flex: 1, minWidth: 6 } }),
            empty || leadEmpty
              ? React.createElement('span', { style: { fontSize: FS.min, color: sub, opacity: 0.8 } }, isLead ? '请输入内容后发送' : '自定义模式需先输入评审准则')
              : null,
            React.createElement(
              Chip,
              {
                onClick: submit,
                disabled: empty || leadEmpty,
                title: isLead
                  ? '切换至副模型并发送当前内容'
                  : empty
                    ? '自定义模式需先输入评审准则'
                    : custom
                      ? '按自定义准则复核本轮（调用副模型）'
                      : '复核本轮（调用副模型）',
                solid: true,
                style: {
                  height: 30,
                  padding: '0 14px',
                  fontSize: FS.small,
                  fontWeight: 600,
                  background: empty || leadEmpty ? undefined : 'color-mix(in srgb, ' + accent + ' 18%, transparent)',
                  borderColor: empty || leadEmpty ? line : 'color-mix(in srgb, ' + accent + ' 55%, transparent)',
                },
              },
              isLead ? '发送至副模型' : empty ? '待输入' : custom ? '按此准则复核' : '开始复核',
            ),
          ),
        ),
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
        String(c.autoMode || 'every'),
        c.modelAuto !== false,
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
      /* 1.5.4：更新提示。npm 是拉取式的，装过的人不会自动拿到新版——
         这里主动问一次宿主（宿主去问 registry），只在「关于」里说一句，不弹窗、不打扰。 */
      const [upd, setUpd] = useState(null)
      const [updBusy, setUpdBusy] = useState(false)
      const checkUpd = (force) => {
        setUpdBusy(true)
        fetch(API + '/update' + (force ? '?force=1' : ''))
          .then((r) => r.json())
          .then((j) => setUpd(j || { ok: false }))
          .catch((e) => setUpd({ ok: false, error: String((e && e.message) || e) }))
          .finally(() => setUpdBusy(false))
      }
      useEffect(() => {
        checkUpd(false)
      }, [])

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
              autoMode: cfg.autoMode === 'actions' ? 'actions' : 'every',
              modelAuto: cfg.modelAuto !== false,
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

      /* 1.3.6：预设只改开关，绝不偷偷换模型 —— 最终决定权在用户手上（他 2026-11-11 的原话） */
      const applyPreset = (p) => {
        if (!cfg) return
        if (p === 'light') setCfg({ ...cfg, auto: true, autoMode: 'actions', mock: false })
        else if (p === 'delivery') setCfg({ ...cfg, auto: false, autoMode: 'every', mock: false })
        else if (p === 'peek') setCfg({ ...cfg, auto: false, autoMode: 'every', mock: true })
        setNote(p === 'peek' ? '已切到「只看不评」：接下来评的是假数据、不花钱' : '已套用预设 —— 点下面的保存才生效')
      }

      return React.createElement(
        'div',
        { style: { padding: '4px 0', maxWidth: 620 } },

        // 1.3.6：三个预设摆最上面，装完不用读文档也能选
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' } },
          React.createElement('span', { style: { opacity: 0.7, minWidth: 88 } }, '预设'),
          React.createElement(Btn, { tier: 'sec', onClick: () => applyPreset('light'), title: '日常：不每条都评，只有它动过手（写文件、跑命令、发消息）才自动评' }, '日常轻量'),
          React.createElement(Btn, { tier: 'sec', onClick: () => applyPreset('delivery'), title: '关键交付：不自动评，你点哪一轮评哪一轮' }, '关键交付'),
          React.createElement(Btn, { tier: 'lite', onClick: () => applyPreset('peek'), title: '先看看卡片长什么样：假数据、不花钱、不留记录' }, '只看不评'),
          React.createElement('span', { style: { opacity: 0.45, fontSize: FS.min } }, '只改开关，模型还是你自己选'),
        ),

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
                  onChange: (e) => setCfg({ ...cfg, provider: e.target.value, model: '', modelAuto: true }),
                },
                ...providerOptions.map((p) =>
                  React.createElement('option', { key: p.id, value: p.id }, p.name === p.id ? p.id : p.name + '（' + p.id + '）'),
                ),
              ),
              React.createElement(
                Select,
                {
                  // 1.3.6：默认「自动 Pro 档」—— 不存具体 id，DSH 升了版本它自己跟着走
                  value: cfg.modelAuto === false ? cfg.model || '' : '__auto__',
                  onChange: (e) => {
                    const v = e.target.value
                    if (v === '__auto__') setCfg({ ...cfg, modelAuto: true })
                    else setCfg({ ...cfg, model: v, modelAuto: false })
                  },
                },
                React.createElement('option', { key: '__auto__', value: '__auto__' }, '自动：Pro 档'),
                cfg.modelAuto === false && cfg.model ? null : React.createElement('option', { key: '__none', value: '' }, '（手动选一个）'),
                ...models
                  .map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: String((m && m.id) || ''), name: String((m && m.name) || (m && m.id) || '') }))
                  .filter((m) => m.id)
                  .map((m) => React.createElement('option', { key: m.id, value: m.id }, (m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id))),
              ),
            ),
          ),
          React.createElement('div', { style: { opacity: 0.55, fontSize: FS.min, marginTop: 6 } }, '评审由这个模型来做；「副模型主刀」打开时，下一轮答复也换成它。'),
          // 1.3.6：默认 Pro 档、自动跟随；手动选了别的就按你选的来
          React.createElement(
            'div',
            { style: { opacity: 0.5, fontSize: FS.min, marginTop: 2 } },
            cfg.modelAuto === false
              ? '当前是手动指定：' + String(cfg.model || '未选') + '。想省事可以切回「自动：Pro 档」，DSH 升级后它自己跟着换。'
              : '默认走 Pro 档（' + String((models.find((m) => /pro/i.test(String((m && m.id) || m))) || {}).id || '按你的 provider 实际清单') + '），DSH 出了新一代 Pro 会自动跟着换；主模型如果也是它，这次复核等于自评。',
          ),
        ),

        section(
          '02',
          '评审模式',
          React.createElement(Check, {
            checked: cfg.auto,
            onChange: (e) => setCfg({ ...cfg, auto: e.target.checked }),
            title: '自动评审',
            desc: '会调用副模型，产生费用；评到哪一步由下面那行决定',
            style: { marginBottom: 2 },
          }),
          // 1.3.6：闸门 —— 用户决定"每条都评"还是"只有动过手才评"
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 4px' } },
            React.createElement('span', { style: { opacity: 0.7, minWidth: 88 } }, '自动评审范围'),
            React.createElement(
              'span',
              { style: { marginLeft: 'auto' } },
              React.createElement(
                Select,
                {
                  value: cfg.autoMode === 'actions' ? 'actions' : 'every',
                  onChange: (e) => setCfg({ ...cfg, autoMode: e.target.value }),
                },
                React.createElement('option', { key: 'every', value: 'every' }, '每条回复都评（默认）'),
                React.createElement('option', { key: 'actions', value: 'actions' }, '只有动过手的那一轮才评'),
              ),
            ),
          ),
          React.createElement(
            'div',
            { style: { opacity: 0.5, fontSize: FS.min, marginBottom: 6 } },
            '「动过手」＝写文件、跑命令、发消息，或这一轮工作区有改动；纯聊天、纯只读的问答不评。判断全在本地，不花钱。',
          ),
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
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
                fontSize: FS.small,
              },
            },
            React.createElement('span', { style: { opacity: 0.6 } }, '更新'),
            upd && upd.hasUpdate
              ? React.createElement(
                  'span',
                  { style: { color: ACCENT, fontWeight: 600 } },
                  '有新版本 v' + upd.latest + '（现在 v' + upd.current + '）',
                )
              : React.createElement(
                  'span',
                  { style: { opacity: 0.55 } },
                  updBusy
                    ? '在查…'
                    : upd && upd.latest
                      ? '已是最新（v' + upd.current + '）'
                      : upd && upd.error
                        ? '查不到（' + String(upd.error).slice(0, 40) + '）'
                        : '还没查',
                ),
            React.createElement(
              Chip,
              { onClick: () => checkUpd(true), title: '去 npm 问一次最新版本（不装、不改东西）', style: { height: 24, fontSize: FS.min } },
              updBusy ? '查询中' : '检查更新',
            ),
            upd && upd.hasUpdate
              ? React.createElement(
                  'span',
                  { style: { opacity: 0.5, fontSize: FS.min } },
                  '装新版：插件页对它点「更新」，或者在终端 npm i dsh-second-review@latest',
                )
              : null,
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

        // 1.5.0：副输入框浮条，挂在 shell.overlay（吸在 [data-composer-card] 上方）。
        guard('shell.overlay', () => {
          slots.register({ name: 'shell.overlay', id: 'second-review-composer', order: 50 }, () =>
            React.createElement(PageBoundary, null, React.createElement(ComposerOverlay)),
          )
        })
      },
    }
  },
})
