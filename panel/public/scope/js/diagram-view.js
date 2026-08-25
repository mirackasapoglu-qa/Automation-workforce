// Diyagram görünümü: SVG bağlantı çizgileri + zoom/pan.
import { state } from './state.js';
import { ICON, statusClass } from './constants.js';
import { effectiveStatus, treeHasProgress, isStale, nodeMatchesQuery } from './data.js';
import { buildTypeChip, buildStatusChip, buildNameInput, buildActionButtons } from './chips.js';
import { attachDrawerOpener } from './drawer.js';

export function computeDiagramLayout(rootNodes) {
  const NODE_W = 210, NODE_H = 104, GAP_X = 30, GAP_Y = 66;
  let cursorX = 0;
  const nodesPos = [];
  function place(node, depth) {
    let x;
    if (!node.children.length) {
      x = cursorX;
      cursorX += NODE_W + GAP_X;
    } else {
      const childXs = node.children.map(c => place(c, depth + 1));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }
    nodesPos.push({ node, x, y: depth * (NODE_H + GAP_Y) });
    return x;
  }
  rootNodes.forEach(n => place(n, 0));
  const width = Math.max(cursorX - GAP_X, NODE_W);
  const maxY = nodesPos.reduce((m, p) => Math.max(m, p.y), 0);
  return { nodesPos, width, height: maxY + NODE_H, NODE_W, NODE_H };
}

// `visibleIds`: arama aktifken hangi node'ların öne çıkarılacağını belirten set (bkz.
// computeSearchVisibleIds). Diyagramın konumları tüm ağaca göre hesaplandığı için eşleşmeyen
// node'lar kaldırılmaz, sadece soluklaştırılır (layout'u bozmadan).
export function renderDiagram(visibleIds) {
  if (!state.tree.length) {
    state.diagramLayoutCache = null;
    const wrap = document.createElement('div');
    wrap.className = 'diagram-wrap';
    const empty = document.createElement('div');
    empty.className = 'diagram-scroll';
    empty.innerHTML = '<div class="board-col-empty">Henüz modül eklenmedi</div>';
    wrap.appendChild(empty);
    return wrap;
  }

  const layout = computeDiagramLayout(state.tree);
  const posMap = new Map();
  layout.nodesPos.forEach(p => posMap.set(p.node.id, p));

  const diagramWrap = document.createElement('div');
  diagramWrap.className = 'diagram-wrap' + (treeHasProgress(state.tree) ? ' tree-has-progress' : '');

  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'diagram-scroll';

  const sizer = document.createElement('div');
  sizer.className = 'diagram-sizer';

  const PAD = 24;
  const canvas = document.createElement('div');
  canvas.className = 'diagram-canvas';
  canvas.style.width = (layout.width + PAD * 2) + 'px';
  canvas.style.height = (layout.height + PAD * 2) + 'px';
  state.diagramLayoutCache = { width: layout.width + PAD * 2, height: layout.height + PAD * 2 };

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'diagram-lines');
  svg.setAttribute('width', layout.width + PAD * 2);
  svg.setAttribute('height', layout.height + PAD * 2);

  const defs = document.createElementNS(svgNS, 'defs');
  const marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', 'flow-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowHead = document.createElementNS(svgNS, 'path');
  arrowHead.setAttribute('d', 'M0 0 L10 5 L0 10 Z');
  arrowHead.setAttribute('fill', '#a78bfa');
  marker.appendChild(arrowHead);
  defs.appendChild(marker);
  svg.appendChild(defs);

  (function walkEdges(nodes) {
    nodes.forEach(n => {
      const p = posMap.get(n.id);
      n.children.forEach(c => {
        const cp = posMap.get(c.id);
        const x1 = p.x + layout.NODE_W / 2 + PAD, y1 = p.y + layout.NODE_H + PAD;
        const x2 = cp.x + layout.NODE_W / 2 + PAD, y2 = cp.y + PAD;
        const midY = (y1 + y2) / 2;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
        path.setAttribute('class', 'diagram-edge');
        svg.appendChild(path);
      });
      walkEdges(n.children);
    });
  })(state.tree);

  (function walkLinkEdges(nodes) {
    nodes.forEach(n => {
      n.linkTos.forEach(targetId => {
        const p = posMap.get(n.id);
        const t = posMap.get(targetId);
        if (p && t) {
          const sCenterY = p.y + PAD + layout.NODE_H / 2;
          const tCenterY = t.y + PAD + layout.NODE_H / 2;
          const sLeft = p.x + PAD, sRight = p.x + PAD + layout.NODE_W;
          const tLeft = t.x + PAD, tRight = t.x + PAD + layout.NODE_W;
          let x1, x2;
          if (tLeft >= sRight) { x1 = sRight; x2 = tLeft; }
          else if (tRight <= sLeft) { x1 = sLeft; x2 = tRight; }
          else { x1 = p.x + PAD + layout.NODE_W / 2; x2 = t.x + PAD + layout.NODE_W / 2; }
          const dx = Math.max(Math.abs(x2 - x1) * 0.5, 44);
          const bend = x2 >= x1 ? dx : -dx;
          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', `M ${x1} ${sCenterY} C ${x1 + bend} ${sCenterY}, ${x2 - bend} ${tCenterY}, ${x2} ${tCenterY}`);
          path.setAttribute('class', 'diagram-link-edge');
          path.setAttribute('marker-end', 'url(#flow-arrow)');
          svg.appendChild(path);
        }
      });
      walkLinkEdges(n.children);
    });
  })(state.tree);

  canvas.appendChild(svg);

  layout.nodesPos.forEach(p => {
    const card = renderDiagramNode(p.node, visibleIds);
    card.style.left = (p.x + PAD) + 'px';
    card.style.top = (p.y + PAD) + 'px';
    card.style.width = layout.NODE_W + 'px';
    canvas.appendChild(card);
  });

  sizer.appendChild(canvas);
  scrollWrap.appendChild(sizer);
  scrollWrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = scrollWrap.getBoundingClientRect();
    const offsetX = e.clientX - rect.left + scrollWrap.scrollLeft;
    const offsetY = e.clientY - rect.top + scrollWrap.scrollTop;
    const oldScale = state.currentDiagramScale;
    const dy = Math.max(Math.min(e.deltaY, 120), -120);
    const factor = Math.min(Math.max(Math.exp(-dy * 0.005), 1 / 1.15), 1.15);
    const newScale = Math.min(Math.max(oldScale * factor, 0.1), 2.5);
    state.diagramZoom = newScale;
    applyDiagramZoom();
    const ratio = newScale / oldScale;
    scrollWrap.scrollLeft = offsetX * ratio - (e.clientX - rect.left);
    scrollWrap.scrollTop = offsetY * ratio - (e.clientY - rect.top);
  }, { passive: false });
  diagramWrap.appendChild(scrollWrap);
  diagramWrap.appendChild(buildZoomBar());
  return diagramWrap;
}

export function buildZoomBar() {
  const bar = document.createElement('div');
  bar.className = 'diagram-zoom-bar';

  const outBtn = document.createElement('button');
  outBtn.type = 'button';
  outBtn.className = 'zoom-btn';
  outBtn.textContent = '−';
  outBtn.title = 'Uzaklaştır';
  outBtn.onclick = () => { state.diagramZoom = Math.max(state.currentDiagramScale - 0.15, 0.1); applyDiagramZoom(); };
  bar.appendChild(outBtn);

  const label = document.createElement('span');
  label.className = 'zoom-label';
  label.textContent = '100%';
  bar.appendChild(label);

  const inBtn = document.createElement('button');
  inBtn.type = 'button';
  inBtn.className = 'zoom-btn';
  inBtn.textContent = '+';
  inBtn.title = 'Yakınlaştır';
  inBtn.onclick = () => { state.diagramZoom = Math.min(state.currentDiagramScale + 0.15, 2.5); applyDiagramZoom(); };
  bar.appendChild(inBtn);

  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'zoom-fit';
  fitBtn.title = 'Tüm akışı sığdır';
  fitBtn.innerHTML = ICON.fit;
  fitBtn.onclick = () => { state.diagramZoom = null; applyDiagramZoom(); };
  bar.appendChild(fitBtn);

  return bar;
}

export function applyDiagramZoom() {
  const scroller = state.root.querySelector('.diagram-scroll');
  const sizerEl = state.root.querySelector('.diagram-sizer');
  const canvasEl = state.root.querySelector('.diagram-canvas');
  const label = state.root.querySelector('.zoom-label');
  if (!scroller || !sizerEl || !canvasEl || !state.diagramLayoutCache) return;

  const { width, height } = state.diagramLayoutCache;
  let scale = state.diagramZoom;
  let isFit = scale == null;
  if (isFit) {
    const cw = scroller.clientWidth - 8;
    const ch = scroller.clientHeight - 8;
    scale = Math.min(cw / width, ch / height, 2);
    scale = Math.max(scale, 0.1);
  }
  state.currentDiagramScale = scale;

  sizerEl.style.width = (width * scale) + 'px';
  sizerEl.style.height = (height * scale) + 'px';
  canvasEl.style.transform = `scale(${scale})`;
  if (label) label.textContent = Math.round(scale * 100) + '%';
  if (isFit) { scroller.scrollLeft = 0; scroller.scrollTop = 0; }
}

export function renderDiagramNode(node, visibleIds) {
  const q = state.searchQuery.trim().toLowerCase();
  const isHit = q && nodeMatchesQuery(node, q);
  const isDimmed = visibleIds && !visibleIds.has(node.id);
  const card = document.createElement('div');
  card.className = 'diag-card status-' + statusClass(effectiveStatus(node)) + (!node.children.length && isStale(node) ? ' is-stale' : '') + (isHit ? ' search-hit' : '') + (isDimmed ? ' diag-dim' : '');
  card.setAttribute('data-node-id', node.id);
  if (node.notes.length) card.title = node.notes[node.notes.length - 1].text;
  attachDrawerOpener(card, node);

  const top = document.createElement('div');
  top.className = 'diag-top-row';
  top.appendChild(buildTypeChip(node));
  top.appendChild(buildStatusChip(node));
  card.appendChild(top);

  card.appendChild(buildNameInput(node, 'Ad', 'diag-name-input'));
  card.appendChild(buildActionButtons(node));

  return card;
}
