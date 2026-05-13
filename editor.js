'use strict';

/* ═══════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════ */
const NODE_W = 128, NODE_H = 38
const NS = 'http://www.w3.org/2000/svg'

/* ═══════════════════════════════════════
   THEME
═══════════════════════════════════════ */
let isDark = (localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')) === 'dark'
applyTheme()
document.getElementById('btn-theme').addEventListener('click', () => {
    isDark = !isDark
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
    applyTheme()
    render()
})
function applyTheme() {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    document.getElementById('i-sun').style.display  = isDark ? 'block' : 'none'
    document.getElementById('i-moon').style.display = isDark ? 'none'  : 'block'
}

function C() {
    return isDark ? {
        bg: '#0b0b09', regionFill:'rgba(30,42,36,.5)', regionStroke:'#2a8a8a',
        regionLabel:'#c44d8a', edgeStroke:'#5a6e5a', arrow:'#5a6e5a',
        nodeFill:'#1e2820', nodeStroke:'#3a6a4a', nodeText:'#c8ecd4',
        noFill:'#2a2218', noStroke:'#6a5a3a', noText:'#c8b890',
        selStroke:'#f59e0b', hoverFill:'#283828',
        flavour:'#2a8a8a', muted:'#a09c92',
    } : {
        bg:'#edecea', regionFill:'rgba(200,235,220,.3)', regionStroke:'#1a8080',
        regionLabel:'#b0206a', edgeStroke:'#7aaa8a', arrow:'#7aaa8a',
        nodeFill:'#eaf7ef', nodeStroke:'#4a9a6a', nodeText:'#1a3a22',
        noFill:'#fdf5e6', noStroke:'#a08050', noText:'#5a4020',
        selStroke:'#f59e0b', hoverFill:'#d8f3dc',
        flavour:'#1a8080', muted:'#47443d',
    }
}

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let state = {
    tagRegions: {},
    nodeTypes: {},      // id → { label, color }
    nodes: []           // each has _pos:{x,y} in editor
}
let undoStack = [], redoStack = []
let selected = null    // { type:'node'|'edge', id, edgeFrom, edgeTo }
let mode = 'move'      // 'move' | 'connect'
let connectFrom = null // node id when in connect mode, after first click
let pan = { x:0, y:0 }, zoom = 1
let dragNode = null, dragOffX = 0, dragOffY = 0
let draggingCanvas = false, dragCanvasStart = { x:0, y:0 }, panStart = { x:0, y:0 }

/* ═══════════════════════════════════════
   UNDO / REDO
═══════════════════════════════════════ */
function snapshot() {
    return JSON.parse(JSON.stringify(state))
}
function pushUndo() {
    undoStack.push(snapshot())
    if (undoStack.length > 60) undoStack.shift()
    redoStack = []
    updateUndoButtons()
}
function undo() {
    if (!undoStack.length) return
    redoStack.push(snapshot())
    state = undoStack.pop()
    selected = null
    render(); renderPanel(); updateUndoButtons()
}
function redo() {
    if (!redoStack.length) return
    undoStack.push(snapshot())
    state = redoStack.pop()
    selected = null
    render(); renderPanel(); updateUndoButtons()
}
function updateUndoButtons() {
    document.getElementById('btn-undo').disabled = !undoStack.length
    document.getElementById('btn-redo').disabled = !redoStack.length
}

/* ═══════════════════════════════════════
   AUTO-LAYOUT (Sugiyama-style)
═══════════════════════════════════════ */
function autoLayout() {
    const nodes = state.nodes
    const SPACING_X = 160, SPACING_Y = 100, PAD = 60

    const outEdges = {}, inEdges = {}
    nodes.forEach(n => { outEdges[n.id] = []; inEdges[n.id] = [] })
    nodes.forEach(n => {
        for (const dep of (n.depends_on || [])) {
            if (outEdges[dep]) outEdges[dep].push(n.id)
            if (inEdges[n.id] !== undefined) inEdges[n.id].push(dep)
        }
    })

    // Topological sort (Kahn)
    const inDeg = {}
    nodes.forEach(n => inDeg[n.id] = inEdges[n.id].length)
    const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
    const topo = []
    while (queue.length) {
        const id = queue.shift(); topo.push(id)
        for (const s of outEdges[id]) { if (--inDeg[s] === 0) queue.push(s) }
    }
    // Any remaining (cycles) just append
    nodes.forEach(n => { if (!topo.includes(n.id)) topo.push(n.id) })

    // Layer assignment
    const layer = {}
    nodes.forEach(n => layer[n.id] = 0)
    for (const id of topo) {
        for (const s of outEdges[id]) layer[s] = Math.max(layer[s] || 0, (layer[id] || 0) + 1)
    }

    const numLayers = Math.max(...Object.values(layer)) + 1
    const layers = Array.from({ length: numLayers }, () => [])
    for (const n of nodes) layers[layer[n.id]].push(n.id)

    // Barycenter ordering
    const pos = {}
    layers.forEach((l, i) => l.forEach((id, j) => pos[id] = j))
    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0
    for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i < layers.length; i++) {
            layers[i].sort((a,b) => avg(inEdges[a].map(p=>pos[p]??0)) - avg(inEdges[b].map(p=>pos[p]??0)))
            layers[i].forEach((id,j) => pos[id] = j)
        }
        for (let i = layers.length-2; i >= 0; i--) {
            layers[i].sort((a,b) => avg(outEdges[a].map(s=>pos[s]??0)) - avg(outEdges[b].map(s=>pos[s]??0)))
            layers[i].forEach((id,j) => pos[id] = j)
        }
    }

    // Assign coords
    const maxInLayer = Math.max(...layers.map(l=>l.length))
    const totalW = maxInLayer * SPACING_X
    const nodeById = {}
    nodes.forEach(n => nodeById[n.id] = n)
    for (let l = 0; l < layers.length; l++) {
        const row = layers[l]
        const rowW = (row.length - 1) * SPACING_X
        const startX = totalW/2 - rowW/2 + PAD
        row.forEach((id, i) => {
            const n = nodeById[id]
            if (n) n._pos = { x: startX + i * SPACING_X, y: PAD + l * SPACING_Y }
        })
    }

    resetView()
}

function hexToRgbE(hex) {
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
    return `${r},${g},${b}`
}

/* ═══════════════════════════════════════
   RENDER (SVG)
═══════════════════════════════════════ */
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    return `${r},${g},${b}`
}
const svg      = document.getElementById('graph-svg')
const layerR   = document.getElementById('layer-regions')
const layerE   = document.getElementById('layer-edges')
const layerN   = document.getElementById('layer-nodes')
const rootG    = document.getElementById('root')

function svgEl(tag, attrs={}) {
    const e = document.createElementNS(NS, tag)
    for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v)
    return e
}

function rectIntersect(ox,oy,rx,ry,hw,hh) {
    const dx=rx-ox, dy=ry-oy
    if (Math.hypot(dx,dy)<1) return [rx,ry]
    const M=5, cands=[]
    const tryT=(t,px,py)=>{ if(t>.001&&Math.abs(px-rx)<=hw+M+.5&&Math.abs(py-ry)<=hh+M+.5) cands.push([t,px,py]) }
    if (Math.abs(dx)>.001) {
        const t1=(rx-hw-M-ox)/dx; tryT(t1,ox+t1*dx,oy+t1*dy)
        const t2=(rx+hw+M-ox)/dx; tryT(t2,ox+t2*dx,oy+t2*dy)
    }
    if (Math.abs(dy)>.001) {
        const t3=(ry-hh-M-oy)/dy; tryT(t3,ox+t3*dx,oy+t3*dy)
        const t4=(ry+hh+M-oy)/dy; tryT(t4,ox+t4*dx,oy+t4*dy)
    }
    cands.sort((a,b)=>a[0]-b[0])
    return cands.length ? [cands[0][1],cands[0][2]] : [rx,ry]
}

function render() {
    const c = C()
    document.getElementById('arr-path').setAttribute('fill', c.arrow)

    // Clear layers
    ;[layerR, layerE, layerN].forEach(l => { while(l.firstChild) l.removeChild(l.firstChild) })

    const nodeById = {}
    state.nodes.forEach(n => nodeById[n.id] = n)

    // ── Region boxes ──
    const PADS = [0, 22, 40, 58, 76]
    const regionEntries = Object.entries(state.tagRegions)
        .sort((a,b) => (b[1].draw_order||1) - (a[1].draw_order||1))
    for (const [tagId, tagDef] of regionEntries) {
        const tagged = state.nodes.filter(n => (n.tags||[]).includes(tagId) && n._pos)
        if (!tagged.length) continue
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
        for (const n of tagged) {
            minX=Math.min(minX,n._pos.x-NODE_W/2); minY=Math.min(minY,n._pos.y-NODE_H/2)
            maxX=Math.max(maxX,n._pos.x+NODE_W/2); maxY=Math.max(maxY,n._pos.y+NODE_H/2)
        }
        const order = tagDef.draw_order || 1
        const pad   = PADS[Math.min(order, PADS.length-1)]
        const rx=minX-pad, ry=minY-pad, rw=(maxX-minX)+pad*2, rh=(maxY-minY)+pad*2

        const tagColor = tagDef.color || c.regionStroke
        layerR.appendChild(svgEl('rect', {
            x:rx, y:ry, width:rw, height:rh, rx:8, ry:8,
            fill: isDark ? `rgba(${hexToRgb(tagColor)},0.18)` : `rgba(${hexToRgb(tagColor)},0.10)`,
            stroke: tagColor, 'stroke-width':'1.8',
            'stroke-dasharray': order>2 ? '7,3' : 'none'
        }))
        // Label: top-right corner, just inside the box
        layerR.appendChild(svgEl('text', {
            x: rx+rw-10, y: ry+16,
            'text-anchor':'end',
            fill: tagColor,
            'font-family':'ui-monospace,monospace',
            'font-size':'12', 'font-weight':'700',
            'pointer-events':'none'
        })).textContent = tagDef.label
    }

    // ── Edges ──
    state.nodes.forEach(tgtNode => {
        const tp = tgtNode._pos; if (!tp) return
        ;(tgtNode.depends_on||[]).forEach(srcId => {
            const srcNode = nodeById[srcId]; if (!srcNode?._pos) return
            const sp = srcNode._pos
            const [x1,y1] = rectIntersect(tp.x,tp.y, sp.x,sp.y, NODE_W/2, NODE_H/2)
            const [x2,y2] = rectIntersect(sp.x,sp.y, tp.x,tp.y, NODE_W/2, NODE_H/2)
            const mx=(x1+x2)/2, my=(y1+y2)/2
            const len=Math.hypot(x2-x1,y2-y1)||1
            const nx=-(y2-y1)/len*10, ny=(x2-x1)/len*10
            const edgeId = `edge::${srcId}::${tgtNode.id}`
            const isSel  = selected?.type==='edge' && selected.id===edgeId

            // Transparent wide hit area
            const hit = svgEl('path', {
                d:`M${x1},${y1} Q${mx+nx},${my+ny} ${x2},${y2}`,
                fill:'none', stroke:'transparent', 'stroke-width':'12',
                'data-edge':edgeId, 'data-from':srcId, 'data-to':tgtNode.id,
                class:'edge-hit', style:'cursor:pointer'
            })
            // Visible line
            const line = svgEl('path', {
                d:`M${x1},${y1} Q${mx+nx},${my+ny} ${x2},${y2}`,
                fill:'none',
                stroke: isSel ? '#f59e0b' : c.edgeStroke,
                'stroke-width': isSel ? '2.2' : '1.4',
                'marker-end': isSel ? 'url(#arr-sel)' : 'url(#arr)',
                'pointer-events':'none'
            })
            layerE.appendChild(hit)
            layerE.appendChild(line)
        })
    })

    // ── Nodes ──
    state.nodes.forEach(node => {
        const p = node._pos; if (!p) return
        const hasLink = !!node.eprint
        const isSel   = selected?.type==='node' && selected.id===node.id
        const c = C()

        const g = svgEl('g', { class:'node-g', 'data-id':node.id, style:'cursor:pointer' })

        g.appendChild(svgEl('rect', {
            x:p.x-NODE_W/2, y:p.y-NODE_H/2, width:NODE_W, height:NODE_H, rx:5,
            fill: hasLink ? c.nodeFill : c.noFill,
            stroke: isSel ? c.selStroke : (hasLink ? c.nodeStroke : c.noStroke),
            'stroke-width': isSel ? '2.5' : '1.5',
            'stroke-dasharray': node._uncertain ? '4,2' : 'none'
        }))

        if (node._uncertain) {
            const t = svgEl('text', {
                x:p.x+NODE_W/2-5, y:p.y-NODE_H/2+9,
                'text-anchor':'end', fill:c.muted,
                'font-family':'ui-monospace,monospace','font-size':'8','pointer-events':'none'
            })
            t.textContent = '?'; g.appendChild(t)
        }

        const lines = node.name.split('\\n')
        if (lines.length===1) {
            const t = svgEl('text', {
                x:p.x, y:p.y, 'text-anchor':'middle','dominant-baseline':'middle',
                fill: c.nodeText,
                'font-family':'ui-monospace,monospace','font-size':'11','font-weight':'600','pointer-events':'none'
            })
            t.textContent = lines[0]; g.appendChild(t)
        } else {
            lines.forEach((line,i) => {
                const t = svgEl('text', {
                    x:p.x, y:p.y+(i-(lines.length-1)/2)*13,
                    'text-anchor':'middle','dominant-baseline':'middle',
                    fill: c.nodeText,
                    'font-family':'ui-monospace,monospace','font-size':'10','font-weight':'600','pointer-events':'none'
                })
                t.textContent = line; g.appendChild(t)
            })
        }

        if (node.flavours?.length) {
            const t = svgEl('text', {
                x:p.x, y:p.y+NODE_H/2+11, 'text-anchor':'middle',
                fill:c.flavour,'font-family':'ui-monospace,monospace','font-size':'8','pointer-events':'none'
            })
            t.textContent = node.flavours.join(' · '); g.appendChild(t)
        }

        // Connect-mode source highlight ring
        if (mode==='connect' && connectFrom===node.id) {
            g.appendChild(svgEl('rect',{
                x:p.x-NODE_W/2-4,y:p.y-NODE_H/2-4,width:NODE_W+8,height:NODE_H+8,rx:8,
                fill:'none',stroke:'#5cc98a','stroke-width':'2','stroke-dasharray':'5,3','pointer-events':'none'
            }))
        }

        layerN.appendChild(g)
    })

    applyTransform()
}

/* ═══════════════════════════════════════
   PAN / ZOOM
═══════════════════════════════════════ */
function applyTransform() {
    rootG.setAttribute('transform', `translate(${pan.x},${pan.y}) scale(${zoom})`)
}
function resetView() {
    pan = {x:40,y:40}; zoom = 1; applyTransform()
}
function svgCoord(clientX, clientY) {
    const rect = svg.getBoundingClientRect()
    return {
        x: (clientX - rect.left  - pan.x) / zoom,
        y: (clientY - rect.top   - pan.y) / zoom
    }
}
function nodeAt(clientX, clientY) {
    const {x,y} = svgCoord(clientX, clientY)
    return state.nodes.find(n => n._pos &&
        Math.abs(n._pos.x - x) <= NODE_W/2 &&
        Math.abs(n._pos.y - y) <= NODE_H/2)
}

/* ═══════════════════════════════════════
   MOUSE EVENTS
═══════════════════════════════════════ */
const previewLine = document.getElementById('connect-preview')

svg.addEventListener('mousedown', e => {
    const nodeEl = e.target.closest('.node-g')
    const edgeEl = e.target.closest('.edge-hit')

    if (mode === 'connect') {
        if (!nodeEl) return
        const id = nodeEl.dataset.id
        if (!connectFrom) {
            connectFrom = id
            setStatus(`Connecting from <strong>${id}</strong> — click target node`)
            render()
        } else {
            if (id !== connectFrom) {
                // Add edge if not already there
                const tgt = state.nodes.find(n => n.id===id)
                if (tgt && !tgt.depends_on.includes(connectFrom)) {
                    pushUndo()
                    tgt.depends_on = [...(tgt.depends_on||[]), connectFrom]
                }
            }
            connectFrom = null
            previewLine.setAttribute('opacity','0')
            render(); renderPanel()
        }
        return
    }

    // Move mode
    if (nodeEl) {
        const id = nodeEl.dataset.id
        selected = { type:'node', id }
        const n = state.nodes.find(n=>n.id===id)
        const {x,y} = svgCoord(e.clientX, e.clientY)
        dragNode = n
        dragOffX = x - n._pos.x
        dragOffY = y - n._pos.y
        svg.classList.add('dragging-node')
        render(); renderPanel()
        e.stopPropagation()
    } else if (edgeEl) {
        selected = { type:'edge', id:edgeEl.dataset.edge, edgeFrom:edgeEl.dataset.from, edgeTo:edgeEl.dataset.to }
        render(); renderPanel()
    } else {
        // Drag canvas
        selected = null
        draggingCanvas = true
        dragCanvasStart = { x:e.clientX, y:e.clientY }
        panStart = { x:pan.x, y:pan.y }
        svg.classList.add('dragging-canvas')
        renderPanel()
    }
})

window.addEventListener('mousemove', e => {
    if (dragNode) {
        const {x,y} = svgCoord(e.clientX, e.clientY)
        dragNode._pos = { x: x-dragOffX, y: y-dragOffY }
        render()
        return
    }
    if (draggingCanvas) {
        pan.x = panStart.x + (e.clientX - dragCanvasStart.x)
        pan.y = panStart.y + (e.clientY - dragCanvasStart.y)
        applyTransform()
        return
    }
    // Connect preview line
    if (mode==='connect' && connectFrom) {
        const srcNode = state.nodes.find(n=>n.id===connectFrom)
        if (srcNode?._pos) {
            const {x,y} = svgCoord(e.clientX, e.clientY)
            const sx = srcNode._pos.x*zoom+pan.x, sy = srcNode._pos.y*zoom+pan.y
            const rect = svg.getBoundingClientRect()
            const ex = e.clientX - rect.left, ey = e.clientY - rect.top
            previewLine.setAttribute('x1', sx)
            previewLine.setAttribute('y1', sy)
            previewLine.setAttribute('x2', ex)
            previewLine.setAttribute('y2', ey)
            previewLine.setAttribute('opacity', '1')
        }
    }
})

window.addEventListener('mouseup', e => {
    if (dragNode) {
        pushUndo()
        dragNode = null
        svg.classList.remove('dragging-node')
    }
    if (draggingCanvas) {
        draggingCanvas = false
        svg.classList.remove('dragging-canvas')
    }
})

svg.addEventListener('wheel', e => {
    e.preventDefault()
    const rect = svg.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1/1.1
    const newZoom = Math.max(.15, Math.min(5, zoom*factor))
    pan.x = cx - (cx - pan.x) * (newZoom/zoom)
    pan.y = cy - (cy - pan.y) * (newZoom/zoom)
    zoom = newZoom
    applyTransform()
}, { passive:false })

/* ── Touch events ── */
let touchStartDist = null
svg.addEventListener('touchstart', e => {
    if (e.touches.length===2) {
        touchStartDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY)
    }
}, { passive:true })
svg.addEventListener('touchmove', e => {
    if (e.touches.length===2 && touchStartDist) {
        const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY)
        const mx=(e.touches[0].clientX+e.touches[1].clientX)/2, my=(e.touches[0].clientY+e.touches[1].clientY)/2
        const rect=svg.getBoundingClientRect(), cx=mx-rect.left, cy=my-rect.top
        const factor=d/touchStartDist
        const newZoom=Math.max(.15,Math.min(5,zoom*factor))
        pan.x=cx-(cx-pan.x)*(newZoom/zoom); pan.y=cy-(cy-pan.y)*(newZoom/zoom)
        zoom=newZoom; touchStartDist=d; applyTransform()
    }
}, { passive:true })

/* ═══════════════════════════════════════
   KEYBOARD
═══════════════════════════════════════ */
document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return
    if ((e.key==='Delete'||e.key==='Backspace') && selected) deleteSelected()
    if (e.key==='Escape') {
        connectFrom = null; previewLine.setAttribute('opacity','0')
        selected = null; render(); renderPanel()
    }
    if (e.key==='m'||e.key==='M') setMode('move')
    if (e.key==='c'||e.key==='C') setMode('connect')
    if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); undo() }
    if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='Z'))) { e.preventDefault(); redo() }
})

/* ═══════════════════════════════════════
   MODE SWITCHING
═══════════════════════════════════════ */
function setMode(m) {
    mode = m
    connectFrom = null
    previewLine.setAttribute('opacity','0')
    document.getElementById('btn-move').classList.toggle('active', m==='move')
    document.getElementById('btn-connect').classList.toggle('active', m==='connect')
    svg.className.baseVal = `mode-${m}`
    setStatus(m==='connect' ? 'Click a <strong>source</strong> node to begin connecting' : '')
    render()
}
document.getElementById('btn-move').addEventListener('click', ()=>setMode('move'))
document.getElementById('btn-connect').addEventListener('click', ()=>setMode('connect'))

/* ═══════════════════════════════════════
   DELETE SELECTED
═══════════════════════════════════════ */
function deleteSelected() {
    if (!selected) return
    pushUndo()
    if (selected.type==='node') {
        const id = selected.id
        state.nodes = state.nodes.filter(n=>n.id!==id)
        state.nodes.forEach(n => { n.depends_on=(n.depends_on||[]).filter(d=>d!==id) })
    } else if (selected.type==='edge') {
        const tgt = state.nodes.find(n=>n.id===selected.edgeTo)
        if (tgt) tgt.depends_on=(tgt.depends_on||[]).filter(d=>d!==selected.edgeFrom)
    }
    selected=null; render(); renderPanel()
}

/* ═══════════════════════════════════════
   STATUS BAR
═══════════════════════════════════════ */
function setStatus(msg) {
    document.getElementById('status-info').innerHTML = msg||''
}

/* ═══════════════════════════════════════
   SIDE PANEL
═══════════════════════════════════════ */
function renderPanel() {
    const panel = document.getElementById('panel-content')
    panel.innerHTML = ''

    if (selected?.type==='node') {
        renderNodePanel(panel)
    } else if (selected?.type==='edge') {
        renderEdgePanel(panel)
    } else {
        renderGlobalPanel(panel)
    }
}

function renderGlobalPanel(panel) {
    // Node list
    const sec = div('panel-section')
    sec.innerHTML = `<div class="panel-section-title">Nodes (${state.nodes.length})</div>`
    const addBtn = document.createElement('button')
    addBtn.className='btn btn-primary btn-sm'; addBtn.textContent='+ Add Node'
    addBtn.style.marginBottom='10px'
    addBtn.onclick = () => openAddNodeModal()
    sec.appendChild(addBtn)

    const ul = document.createElement('ul'); ul.className='node-list'
    const sorted = [...state.nodes].sort((a,b)=>a.name.localeCompare(b.name))
    sorted.forEach(n => {
        const li = document.createElement('li')
        li.innerHTML = `<span class="node-list-name">${n.name.replace('\\n',' ')}</span><span class="node-list-id">${n.id}</span>${n._uncertain?'<span class="badge-uncertain">?</span>':''}`
        li.addEventListener('click', ()=>{
            selected={type:'node',id:n.id}; render(); renderPanel()
        })
        ul.appendChild(li)
    })
    sec.appendChild(ul)
    panel.appendChild(sec)

    // Tag list summary
    const sec2 = div('panel-section')
    sec2.innerHTML = `<div class="panel-section-title">Tags / Regions</div>`
    Object.entries(state.tagRegions).forEach(([id,t])=>{
        const row = document.createElement('div'); row.className='tag-row'
        row.innerHTML=`<span class="tag-label-text" style="color:#c44d8a;font-weight:700">${t.label}</span><span class="tag-order-text">order ${t.draw_order}</span>`
        sec2.appendChild(row)
    })
    const tagBtn = document.createElement('button')
    tagBtn.className='btn btn-sm'; tagBtn.textContent='Manage Tags'
    tagBtn.style.marginTop='10px'
    tagBtn.onclick=()=>openTagsModal()
    sec2.appendChild(tagBtn)
    panel.appendChild(sec2)

    // Node types summary
    const sec3 = div('panel-section')
    sec3.innerHTML = `<div class="panel-section-title">Node Types</div>`
    Object.entries(state.nodeTypes||{}).forEach(([id,t])=>{
        const row = document.createElement('div'); row.className='tag-row'
        const swatch = document.createElement('span')
        swatch.style.cssText=`display:inline-block;width:12px;height:12px;border-radius:50%;background:${t.color};margin-right:6px;flex-shrink:0`
        const lbl = document.createElement('span')
        lbl.className='tag-label-text'; lbl.textContent=t.label
        row.appendChild(swatch); row.appendChild(lbl)
        sec3.appendChild(row)
    })
    const typesBtn = document.createElement('button')
    typesBtn.className='btn btn-sm'; typesBtn.textContent='Manage Types'
    typesBtn.style.marginTop='10px'
    typesBtn.onclick=()=>openTypesModal()
    sec3.appendChild(typesBtn)
    panel.appendChild(sec3)
}

function renderNodePanel(panel) {
    const node = state.nodes.find(n=>n.id===selected.id)
    if (!node) { renderGlobalPanel(panel); return }

    const sec = div('panel-section')
    sec.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="panel-section-title" style="margin:0">Edit Node</div>
        <button class="btn btn-danger btn-sm" id="pp-delete">Delete</button>
    </div>`

    sec.querySelector('#pp-delete').addEventListener('click', deleteSelected)

    // Fields
    const fields = [
        { label:'ePrint ID', id:'pp-id', val:node.id, hint:'Read-only', readonly:true },
        { label:'Display Name (\\\\n = line break)', id:'pp-name', val:node.name },
        { label:'ePrint URL', id:'pp-eprint', val:node.eprint||'', type:'url' },
        { label:'Flavours (comma-separated)', id:'pp-flavours', val:(node.flavours||[]).join(', ') },
    ]
    fields.forEach(f => {
        const d = div('field')
        d.innerHTML=`<label>${f.label}${f.hint?`<span style="font-weight:400;color:var(--muted)"> — ${f.hint}</span>`:''}</label>
            <input type="${f.type||'text'}" id="${f.id}" value="${escHtml(f.val||'')}" ${f.readonly?'readonly':''} style="${f.readonly?'opacity:.5':''}">`
        sec.appendChild(d)
    })

    // Type selector
    const typeDiv = div('field')
    const typeOpts = Object.entries(state.nodeTypes||{}).map(([id,t]) =>
        `<option value="${id}" ${node.type===id?'selected':''}>${t.label}</option>`
    ).join('')
    typeDiv.innerHTML=`<label>Type</label>
        <select id="pp-type"><option value="">— none —</option>${typeOpts}</select>`
    sec.appendChild(typeDiv)

    // Depends on
    const depDiv = div('field')
    depDiv.innerHTML=`<label>Depends on (comma-separated IDs)</label>
        <textarea id="pp-depends" rows="3">${(node.depends_on||[]).join(', ')}</textarea>`
    sec.appendChild(depDiv)

    // Tags
    const tagDiv = div('field')
    tagDiv.innerHTML=`<label>Tags</label><div class="tag-checks" id="pp-tags"></div>`
    sec.appendChild(tagDiv)

    // Uncertain
    const uncDiv = div('field')
    uncDiv.innerHTML=`<label class="checkbox-row"><input type="checkbox" id="pp-uncertain" ${node._uncertain?'checked':''}> Mark as uncertain</label>`
    sec.appendChild(uncDiv)

    const saveBtn = document.createElement('button')
    saveBtn.className='btn btn-primary'; saveBtn.style.width='100%'; saveBtn.textContent='Save Changes'
    saveBtn.addEventListener('click', () => {
        pushUndo()
        node.name    = document.getElementById('pp-name').value.trim()
        node.eprint  = document.getElementById('pp-eprint').value.trim() || null
        node.flavours = document.getElementById('pp-flavours').value.split(',').map(s=>s.trim()).filter(Boolean)
        node.depends_on = document.getElementById('pp-depends').value.split(',').map(s=>s.trim()).filter(Boolean)
        node._uncertain = document.getElementById('pp-uncertain').checked
        node.type = document.getElementById('pp-type')?.value || null
        node.tags = []
        document.querySelectorAll('#pp-tags .tag-check').forEach(tc => {
            if (tc.classList.contains('checked')) node.tags.push(tc.dataset.tag)
        })
        render(); renderPanel()
    })
    sec.appendChild(saveBtn)
    panel.appendChild(sec)

    // Populate tag checks after DOM is ready
    const tagContainer = sec.querySelector('#pp-tags')
    Object.entries(state.tagRegions).forEach(([tagId, tagDef]) => {
        const tc = document.createElement('div')
        tc.className = 'tag-check' + ((node.tags||[]).includes(tagId) ? ' checked' : '')
        tc.dataset.tag = tagId; tc.textContent = tagDef.label
        tc.addEventListener('click', ()=> tc.classList.toggle('checked'))
        tagContainer.appendChild(tc)
    })

    // Back button
    const backBtn = document.createElement('button')
    backBtn.className='btn btn-sm'; backBtn.textContent='← Back'; backBtn.style.margin='10px 16px 0'
    backBtn.addEventListener('click', ()=>{ selected=null; render(); renderPanel() })
    panel.insertBefore(backBtn, panel.firstChild)
}

function renderEdgePanel(panel) {
    const sec = div('panel-section')
    sec.innerHTML=`<div class="panel-section-title">Edge</div>
        <div class="edge-info">
            <div style="font-size:11px;color:var(--muted)">from</div>
            <div class="edge-arrow">${selected.edgeFrom}</div>
            <div style="font-size:11px;color:var(--muted)">to</div>
            <div class="edge-arrow">${selected.edgeTo}</div>
            <button class="btn btn-danger btn-sm" id="ep-delete" style="margin-top:8px">Delete Edge</button>
        </div>`
    sec.querySelector('#ep-delete').addEventListener('click', deleteSelected)
    panel.appendChild(sec)

    const backBtn = document.createElement('button')
    backBtn.className='btn btn-sm'; backBtn.textContent='← Back'; backBtn.style.margin='10px 16px 0'
    backBtn.addEventListener('click', ()=>{ selected=null; render(); renderPanel() })
    panel.insertBefore(backBtn, panel.firstChild)
}

/* ═══════════════════════════════════════
   MODALS
═══════════════════════════════════════ */
function openAddNodeModal(editId=null) {
    const modal = document.getElementById('modal-node')
    document.getElementById('modal-node-title').textContent = 'Add Node'
    document.getElementById('nf-id').value = ''
    document.getElementById('nf-name').value = ''
    document.getElementById('nf-eprint').value = ''
    document.getElementById('nf-flavours').value = ''
    document.getElementById('nf-depends').value = ''
    document.getElementById('nf-uncertain').checked = false

    // Tag checkboxes
    const tc = document.getElementById('nf-tags'); tc.innerHTML=''
    Object.entries(state.tagRegions).forEach(([tagId,tagDef]) => {
        const el = document.createElement('div')
        el.className='tag-check'; el.dataset.tag=tagId; el.textContent=tagDef.label
        el.addEventListener('click',()=>el.classList.toggle('checked'))
        tc.appendChild(el)
    })

    document.getElementById('nf-submit').onclick = () => {
        const id = document.getElementById('nf-id').value.trim()
        if (!id) { alert('ePrint ID is required'); return }
        if (state.nodes.find(n=>n.id===id)) { alert(`ID "${id}" already exists`); return }
        pushUndo()
        const tags = [...document.querySelectorAll('#nf-tags .tag-check.checked')].map(t=>t.dataset.tag)
        const deps = document.getElementById('nf-depends').value.split(',').map(s=>s.trim()).filter(Boolean)
        const newNode = {
            id,
            name:    document.getElementById('nf-name').value.trim() || id,
            eprint:  document.getElementById('nf-eprint').value.trim() || null,
            tags,
            flavours: document.getElementById('nf-flavours').value.split(',').map(s=>s.trim()).filter(Boolean),
            depends_on: deps,
            _uncertain: document.getElementById('nf-uncertain').checked,
            _pos: { x: 200 + Math.random()*300, y: 200 + Math.random()*200 }
        }
        state.nodes.push(newNode)
        closeModal('modal-node')
        selected = {type:'node', id}
        render(); renderPanel()
    }
    modal.style.display='flex'
}

function openTagsModal() {
    const list = document.getElementById('tags-list'); list.innerHTML=''

    // Sort by draw_order ascending for display
    const entries = Object.entries(state.tagRegions)
        .sort((a,b) => (a[1].draw_order||1) - (b[1].draw_order||1))

    entries.forEach(([tagId, tagDef], idx) => {
        const row = document.createElement('div')
        row.className = 'tag-row'
        row.style.cssText = 'display:grid;grid-template-columns:20px 1fr 90px 70px 36px 36px 32px;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)'

        // Drag handle (visual only)
        const handle = document.createElement('span')
        handle.textContent = '⠿'; handle.style.cssText = 'color:var(--muted);cursor:grab;font-size:14px;text-align:center'
        row.appendChild(handle)

        // Label input
        const labelIn = document.createElement('input')
        labelIn.value = tagDef.label
        labelIn.style.cssText = 'width:100%;padding:4px 7px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;font-family:var(--mono)'
        labelIn.addEventListener('change', () => {
            pushUndo(); tagDef.label = labelIn.value.trim(); render()
        })
        row.appendChild(labelIn)

        // ID (read-only pill)
        const idSpan = document.createElement('span')
        idSpan.textContent = `[${tagId}]`
        idSpan.style.cssText = 'font-size:10px;color:var(--muted);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        row.appendChild(idSpan)

        // Draw order: − value + buttons
        const orderWrap = document.createElement('div')
        orderWrap.style.cssText = 'display:flex;align-items:center;gap:3px'
        const orderLabel = document.createElement('span')
        orderLabel.style.cssText = 'font-size:10px;color:var(--muted);margin-right:2px'
        orderLabel.textContent = 'lvl'
        const btnDec = document.createElement('button')
        btnDec.className='btn btn-icon btn-sm'; btnDec.textContent='−'; btnDec.title='Lower level (outer box)'
        const orderVal = document.createElement('span')
        orderVal.textContent = tagDef.draw_order||1
        orderVal.style.cssText='font-family:var(--mono);font-size:12px;min-width:14px;text-align:center'
        const btnInc = document.createElement('button')
        btnInc.className='btn btn-icon btn-sm'; btnInc.textContent='+'; btnInc.title='Higher level (inner box)'
        btnDec.onclick = () => {
            if ((tagDef.draw_order||1) <= 1) return
            pushUndo(); tagDef.draw_order = (tagDef.draw_order||1) - 1
            orderVal.textContent = tagDef.draw_order; render()
        }
        btnInc.onclick = () => {
            pushUndo(); tagDef.draw_order = (tagDef.draw_order||1) + 1
            orderVal.textContent = tagDef.draw_order; render()
        }
        orderWrap.append(orderLabel, btnDec, orderVal, btnInc)
        row.appendChild(orderWrap)

        // Color picker for region stroke/label
        const colorPicker = document.createElement('input')
        colorPicker.type = 'color'
        colorPicker.value = tagDef.color || '#2a8a8a'
        colorPicker.title = 'Region color'
        colorPicker.style.cssText = 'width:32px;height:28px;padding:1px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:none'
        colorPicker.addEventListener('input', () => {
            tagDef.color = colorPicker.value; render()
        })
        row.appendChild(colorPicker)

        // Move up / down
        const btnUp = document.createElement('button')
        btnUp.className='btn btn-icon btn-sm'; btnUp.textContent='↑'; btnUp.disabled = idx===0
        btnUp.title='Move up'
        btnUp.onclick = () => {
            if (idx===0) return
            pushUndo()
            // swap draw_order with previous
            const prev = entries[idx-1][1]
            const tmp = tagDef.draw_order; tagDef.draw_order = prev.draw_order; prev.draw_order = tmp
            render(); openTagsModal()
        }
        row.appendChild(btnUp)

        // Delete
        const btnDel = document.createElement('button')
        btnDel.className='btn btn-danger btn-icon btn-sm'; btnDel.textContent='✕'
        btnDel.title=`Delete tag "${tagDef.label}"`
        btnDel.onclick = () => {
            if (!confirm(`Delete tag "${tagDef.label}"? Nodes will lose this tag.`)) return
            pushUndo()
            delete state.tagRegions[tagId]
            state.nodes.forEach(n=>{ n.tags=(n.tags||[]).filter(t=>t!==tagId) })
            render(); openTagsModal()
        }
        row.appendChild(btnDel)

        list.appendChild(row)
    })

    document.getElementById('nt-add').onclick = () => {
        const id    = document.getElementById('nt-id').value.trim().replace(/\s+/g,'-')
        const label = document.getElementById('nt-label').value.trim()
        const order = parseInt(document.getElementById('nt-order').value)||2
        if (!id||!label) { alert('ID and label required'); return }
        if (state.tagRegions[id]) { alert(`Tag "${id}" already exists`); return }
        pushUndo()
        state.tagRegions[id] = { label, draw_order: order, color: '#2a8a8a' }
        document.getElementById('nt-id').value=''
        document.getElementById('nt-label').value=''
        render(); openTagsModal()
    }

    document.getElementById('modal-tags').style.display='flex'
}

/* ═══════════════════════════════════════
   NODE TYPES MODAL
═══════════════════════════════════════ */
function openTypesModal() {
    const list = document.getElementById('types-list'); list.innerHTML=''

    const entries = Object.entries(state.nodeTypes||{})
        .sort((a,b) => a[1].label.localeCompare(b[1].label))

    entries.forEach(([typeId, typeDef]) => {
        const row = document.createElement('div')
        row.style.cssText='display:grid;grid-template-columns:1fr 36px 32px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)'

        // Label input
        const labelIn = document.createElement('input')
        labelIn.value = typeDef.label
        labelIn.style.cssText='width:100%;padding:4px 7px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;font-family:var(--mono)'
        labelIn.addEventListener('change', () => {
            pushUndo(); typeDef.label = labelIn.value.trim(); render()
        })
        row.appendChild(labelIn)

        // Color picker
        const cp = document.createElement('input')
        cp.type='color'; cp.value=typeDef.color||'#2a8a8a'; cp.title='Node color'
        cp.style.cssText='width:32px;height:28px;padding:1px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:none'
        cp.addEventListener('input', () => { typeDef.color=cp.value; render() })
        row.appendChild(cp)

        // Delete
        const btnDel = document.createElement('button')
        btnDel.className='btn btn-danger btn-icon btn-sm'; btnDel.textContent='✕'
        btnDel.onclick = () => {
            if (!confirm(`Delete type "${typeDef.label}"?`)) return
            pushUndo()
            delete state.nodeTypes[typeId]
            state.nodes.forEach(n=>{ if(n.type===typeId) n.type=null })
            render(); openTypesModal()
        }
        row.appendChild(btnDel)
        list.appendChild(row)
    })

    document.getElementById('ntype-add').onclick = () => {
        const id    = document.getElementById('ntype-id').value.trim().replace(/\s+/g,'-')
        const label = document.getElementById('ntype-label').value.trim()
        const color = document.getElementById('ntype-color').value
        if (!id||!label) { alert('ID and label required'); return }
        if (state.nodeTypes[id]) { alert(`Type "${id}" already exists`); return }
        pushUndo()
        state.nodeTypes[id] = { label, color }
        document.getElementById('ntype-id').value=''
        document.getElementById('ntype-label').value=''
        render(); openTypesModal()
    }

    document.getElementById('modal-types').style.display='flex'
}

function openExportModal() {
    const updatePreview = () => {
        const inclPos = document.getElementById('exp-positions').checked
        const out = buildExportJSON(inclPos)
        document.getElementById('exp-preview').value = JSON.stringify(out, null, 2)
    }
    document.getElementById('exp-positions').onchange = updatePreview
    updatePreview()
    document.getElementById('modal-export').style.display='flex'
}

function buildExportJSON(includePositions) {
    return {
        _note: "IDs marked with _uncertain require verification.",
        tag_regions: state.tagRegions,
        node_types: state.nodeTypes,
        nodes: state.nodes.map(n => {
            const out = {
                id: n.id, name: n.name, eprint: n.eprint||null,
                tags: n.tags||[], depends_on: n.depends_on||[]
            }
            if (n.type) out.type = n.type
            if (n.flavours?.length) out.flavours = n.flavours
            if (n._uncertain) out._uncertain = true
            if (includePositions && n._pos) out._pos = { x:Math.round(n._pos.x), y:Math.round(n._pos.y) }
            return out
        })
    }
}

document.getElementById('btn-download').addEventListener('click', () => {
    const inclPos = document.getElementById('exp-positions').checked
    const json = JSON.stringify(buildExportJSON(inclPos), null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json],{type:'application/json'}))
    a.download = 'landscape_data.json'
    a.click()
    closeModal('modal-export')
})

function closeModal(id) {
    document.getElementById(id).style.display='none'
}
// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click',e=>{ if(e.target===m) m.style.display='none' })
})

/* ═══════════════════════════════════════
   TOOLBAR BUTTONS
═══════════════════════════════════════ */
document.getElementById('btn-undo').addEventListener('click', undo)
document.getElementById('btn-redo').addEventListener('click', redo)
document.getElementById('btn-autolayout').addEventListener('click', ()=>{ pushUndo(); autoLayout(); render() })
document.getElementById('btn-tags').addEventListener('click', openTagsModal)
document.getElementById('btn-export').addEventListener('click', openExportModal)

document.getElementById('btn-github').addEventListener('click', () => {
    const json = JSON.stringify(buildExportJSON(true), null, 2)
    try { navigator.clipboard.writeText(json) } catch(e) {}
    const url = 'https://github.com/AndHell/isogeny-benchmarks/edit/main/landscape_data.json'
    if (!window.open(url, '_blank')) {
        alert('Pop-up blocked. Please allow pop-ups and try again.\nThe JSON has been copied to your clipboard.')
    } else {
        // Show a brief notice
        const notice = document.createElement('div')
        notice.style.cssText='position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.3)'
        notice.textContent='JSON copied to clipboard — paste it into the GitHub editor'
        document.body.appendChild(notice)
        setTimeout(()=>notice.remove(), 4000)
    }
})

// Load JSON file
document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
        try {
            const loaded = JSON.parse(ev.target.result)
            pushUndo()
            loadData(loaded)
        } catch(err) { alert('Invalid JSON: '+err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
})

/* ═══════════════════════════════════════
   LOAD DATA
═══════════════════════════════════════ */
function loadData(data) {
    state.tagRegions = data.tag_regions || {}
    Object.values(state.tagRegions).forEach(t => { if (!t.color) t.color = '#2a8a8a' })
    state.nodeTypes = data.node_types || {}
    state.nodes = (data.nodes || []).map(n => ({
        ...n,
        depends_on: n.depends_on || [],
        tags: n.tags || [],
        _pos: n._pos || null
    }))
    // Auto-layout any nodes that don't have positions
    const needsLayout = state.nodes.some(n => !n._pos)
    if (needsLayout) autoLayout()
    else resetView()
    selected = null
    render(); renderPanel()
}

/* ═══════════════════════════════════════
   UTILS
═══════════════════════════════════════ */
function div(cls) {
    const d = document.createElement('div')
    d.className = cls; return d
}
function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
updateUndoButtons()
renderPanel()

// Load default data
fetch('landscape_data.json')
    .then(r=>r.json())
    .then(loadData)
    .catch(()=>{
        // Start with empty state if no file
        state = {
            tagRegions: {
                "ordinary":        { label:"Ordinary",        draw_order:1, color:"#2a8a8a" },
                "supersingular":   { label:"Supersingular",   draw_order:2, color:"#2a8a8a" },
                "large-conductor": { label:"Large Conductor", draw_order:3, color:"#d4a027" },
                "hd":              { label:"HD",              draw_order:4, color:"#8a2a8a" }
            },
            nodeTypes: {
                "scheme":         { label:"Scheme",         color:"#2d6a8a" },
                "algorithm":      { label:"Algorithm",      color:"#2a8a5a" },
                "implementation": { label:"Implementation", color:"#8a6a2a" }
            },
            nodes: []
        }
        render(); renderPanel()
    })
