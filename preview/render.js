/**
 * 极简 WXML 渲染器 —— 只为预览与截图,不是运行时。
 * 支持:wx:if / wx:elif / wx:else / wx:for(item/index/wx:for-item)/ {{ }} 表达式 /
 *      class、style、src、placeholder、value、checked 的插值 / view、text、image、input、
 *      button、scroll-view、navigator、switch、slider、picker、canvas、block、textarea
 * 不支持:事件、组件生命周期、模板引用。
 */
(function () {
  const TAG = { view: 'div', text: 'span', block: 'x-block', image: 'img', input: 'input', button: 'button',
    'scroll-view': 'div', navigator: 'a', switch: 'label', slider: 'input', picker: 'div', canvas: 'div',
    textarea: 'textarea', form: 'form' }

  function evalExpr(expr, scope) {
    const keys = Object.keys(scope)
    try { return new Function(...keys, `return (${expr})`)(...keys.map(k => scope[k])) }
    catch (e) { return '' }
  }
  function interp(str, scope) {
    if (str == null) return ''
    return String(str).replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
      const v = evalExpr(e.trim(), scope)
      return v == null ? '' : v
    })
  }
  function truthy(attr, scope) { return Boolean(evalExpr(attr.replace(/^\{\{|\}\}$/g, ''), scope)) }

  function renderNodes(nodes, scope, out) {
    let skipElse = false
    for (const node of nodes) {
      if (node.nodeType === 3) {                       // text
        const t = interp(node.nodeValue, scope)
        if (t.trim()) out.appendChild(document.createTextNode(t))
        continue
      }
      if (node.nodeType !== 1) continue
      const el = node
      if (el.hasAttribute('wx:if')) {
        skipElse = truthy(el.getAttribute('wx:if'), scope)
        if (!skipElse) continue
      } else if (el.hasAttribute('wx:elif')) {
        if (skipElse) continue
        skipElse = truthy(el.getAttribute('wx:elif'), scope)
        if (!skipElse) continue
      } else if (el.hasAttribute('wx:else')) {
        if (skipElse) continue
        skipElse = true
      } else {
        skipElse = false
      }
      if (el.hasAttribute('wx:for')) {
        const list = evalExpr(el.getAttribute('wx:for').replace(/^\{\{|\}\}$/g, ''), scope) || []
        const itemName = el.getAttribute('wx:for-item') || 'item'
        const idxName = el.getAttribute('wx:for-index') || 'index'
        const arr = Array.isArray(list) ? list : Object.values(list)
        arr.forEach((item, index) => {
          const clone = el.cloneNode(true)
          clone.removeAttribute('wx:for'); clone.removeAttribute('wx:for-item'); clone.removeAttribute('wx:for-index'); clone.removeAttribute('wx:key')
          renderNodes([clone], { ...scope, [itemName]: item, [idxName]: index }, out)
        })
        continue
      }
      renderOne(el, scope, out)
    }
  }

  function renderOne(el, scope, out) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'block') { renderNodes([...el.childNodes], scope, out); return }
    // 自定义组件:属性(kebab → camel)求值后作为组件作用域,内部状态取 MOCK_COMPONENTS
    if (window.COMPONENTS && window.COMPONENTS[tag]) {
      const props = {}
      for (const a of [...el.attributes]) {
        if (/^(bind|catch|wx:)/.test(a.name)) continue
        const key = a.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        props[key] = /^\{\{[\s\S]*\}\}$/.test(a.value.trim()) ? evalExpr(a.value.trim().slice(2, -2), scope) : a.value
      }
      const inner = (window.MOCK_COMPONENTS && window.MOCK_COMPONENTS[tag]) || {}
      renderNodes([...new DOMParser().parseFromString('<root xmlns:wx="wx" xmlns:bind="bind" xmlns:catch="catch">' + xmlify(window.COMPONENTS[tag].wxml) + '</root>', 'text/xml').documentElement.childNodes], { ...inner, ...props }, out)
      return
    }
    const h = document.createElement(TAG[tag] || 'div')
    h.setAttribute('data-wx', tag)
    for (const a of [...el.attributes]) {
      if (/^(wx:|bind|catch|data-|open-type|hover)/.test(a.name)) continue
      const v = interp(a.value, scope)
      if (a.name === 'class') h.className = v
      else if (a.name === 'style') h.setAttribute('style', v)
      else if (tag === 'image' && a.name === 'src') h.src = v || ''
      else if (tag === 'image' && a.name === 'mode') h.style.objectFit = 'cover'
      else if (tag === 'switch' && a.name === 'checked') h.dataset.checked = String(evalExpr(a.value.replace(/^\{\{|\}\}$/g, ''), scope))
      else if (tag === 'slider' && a.name === 'value') h.value = v
      else h.setAttribute(a.name, v)
    }
    if (tag === 'switch') { h.className += ' wx-switch' + (h.dataset.checked === 'true' ? ' on' : ''); h.innerHTML = '<i></i>' }
    if (tag === 'slider') { h.type = 'range'; h.className += ' wx-slider' }
    if (tag === 'scroll-view') h.style.overflowY = 'auto'
    if (tag === 'input' || tag === 'textarea') h.readOnly = true
    if (tag !== 'input' && tag !== 'image' && tag !== 'switch' && tag !== 'slider') renderNodes([...el.childNodes], scope, h)
    out.appendChild(h)
  }

  /**
   * WXML 允许无值的布尔属性(wx:else、scroll-y、show-value…),XML 不允许 —— 补上 ="true"。
   * 必须按引号扫描标签:属性值里的 {{ a ? 'x' : '' }} 含空格与等号,粗暴正则会把它改坏。
   */
  function xmlify(src) {
    let out = '', i = 0
    while (i < src.length) {
      const lt = src.indexOf('<', i)
      if (lt < 0) { out += src.slice(i); break }
      out += src.slice(i, lt)
      let j = lt + 1, q = null
      while (j < src.length) {
        const c = src[j]
        if (q) { if (c === q) q = null }
        else if (c === '"' || c === "'") q = c
        else if (c === '>') break
        j++
      }
      out += fixTag(src.slice(lt, j + 1))
      i = j + 1
    }
    return out.replace(/<!--[\s\S]*?-->/g, '').replace(/&(?![a-z#]+;)/g, '&amp;')
  }
  function fixTag(tag) {
    if (/^<[\/!?]/.test(tag)) return tag
    const m = /^<([\w-]+)([\s\S]*?)(\/?)>$/.exec(tag)
    if (!m) return tag
    const [, name, rest, close] = m
    const attrs = []
    const re = /\s*([^\s=\/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>\/]+))?/g
    let a
    while ((a = re.exec(rest))) {
      if (!a[1]) break
      attrs.push(a[2] ? `${a[1]}=${a[2]}` : `${a[1]}="true"`)
    }
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${close ? ' /' : ''}>`
  }

  window.renderWxml = function (wxml, data, mount) {
    const doc = new DOMParser().parseFromString('<root xmlns:wx="wx" xmlns:bind="bind" xmlns:catch="catch">' + xmlify(wxml) + '</root>', 'text/xml')
    const err = doc.querySelector('parsererror')
    if (err) { mount.textContent = 'WXML 解析失败: ' + err.textContent.slice(0, 200); return }
    mount.innerHTML = ''
    renderNodes([...doc.documentElement.childNodes], data, mount)
  }

  /** rpx → px(375px 宽的机型:1rpx = 0.5px);page 选择器 → .page */
  window.convertWxss = function (css) {
    return css.replace(/(\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) * 0.5) + 'px').replace(/(^|[\s,}])page\b/g, '$1.page')
  }
})()
