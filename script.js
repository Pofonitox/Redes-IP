/* ==========================================================================
   Simulador de red doméstica · Lógica
   Secciones: datos · utilidades · análisis · vista · registro · acciones
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     1. Datos
     ------------------------------------------------------------------------ */
  const TYPES = {
    pc:        { label: 'PC',        wifi: false },
    impresora: { label: 'Impresora', wifi: false },
    laptop:    { label: 'Laptop',    wifi: true },
    celular:   { label: 'Celular',   wifi: true },
    tablet:    { label: 'Tablet',    wifi: true },
    tv:        { label: 'Smart TV',  wifi: true }
  };

  const MODE = { dhcp: 'DHCP', static: 'Estática', reserva: 'Reserva DHCP' };

  /** Escenarios de ejemplo: "antes" (desordenada) y "después" (ordenada). */
  const createSamples = () => ({
    antes: {
      cfg: { base: '192.168.0', gw: 1, start: 50, end: 150, sec: 'Abierta' },
      devices: [
        { id: 1, name: 'PC de escritorio', type: 'pc',        mode: 'static', ip: '192.168.0.50', mac: '3C:52:82:1A:07:C4' },
        { id: 2, name: 'Impresora HP',     type: 'impresora', mode: 'static', ip: '192.168.0.50', mac: '3C:2A:F4:90:55:1E' },
        { id: 3, name: 'Laptop de mamá',   type: 'laptop',    mode: 'dhcp',   ip: '',             mac: 'A4:5E:60:C2:11:9B' },
        { id: 4, name: 'Celular de Luis',  type: 'celular',   mode: 'dhcp',   ip: '',             mac: 'F0:18:98:3D:6A:20' },
        { id: 5, name: 'Tablet',           type: 'tablet',    mode: 'dhcp',   ip: '',             mac: 'DC:A6:32:7B:E4:08' },
        { id: 6, name: 'Smart TV sala',    type: 'tv',        mode: 'static', ip: '192.168.0.60', mac: 'B8:27:EB:44:D1:6F' }
      ]
    },
    despues: {
      cfg: { base: '192.168.10', gw: 1, start: 21, end: 200, sec: 'WPA2' },
      devices: [
        { id: 1, name: 'PC de escritorio', type: 'pc',        mode: 'static',  ip: '192.168.10.2', mac: '3C:52:82:1A:07:C4' },
        { id: 2, name: 'Impresora HP',     type: 'impresora', mode: 'reserva', ip: '192.168.10.5', mac: '3C:2A:F4:90:55:1E' },
        { id: 3, name: 'Laptop de mamá',   type: 'laptop',    mode: 'dhcp',    ip: '',             mac: 'A4:5E:60:C2:11:9B' },
        { id: 4, name: 'Celular de Luis',  type: 'celular',   mode: 'dhcp',    ip: '',             mac: 'F0:18:98:3D:6A:20' },
        { id: 5, name: 'Tablet',           type: 'tablet',    mode: 'dhcp',    ip: '',             mac: 'DC:A6:32:7B:E4:08' },
        { id: 6, name: 'Smart TV sala',    type: 'tv',        mode: 'reserva', ip: '192.168.10.6', mac: 'B8:27:EB:44:D1:6F' }
      ]
    }
  });

  const scenarios = createSamples();
  let active = 'antes';   // escenario visible
  let nextId = 100;       // id para dispositivos nuevos
  let busy = false;       // evita lanzar dos animaciones del registro a la vez

  const current = () => scenarios[active];

  /* ------------------------------------------------------------------------
     2. Utilidades
     ------------------------------------------------------------------------ */
  const $ = (selector) => document.querySelector(selector);

  const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);

  /** Valida una IPv4: cuatro números de 0 a 255. */
  function isValidIp(ip) {
    const parts = String(ip).trim().split('.');
    return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  }

  /** Hash determinista (FNV-1a) normalizado entre 0 y 1. Da valores estables a la simulación. */
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /** Convierte un número en un byte hexadecimal de dos cifras (para generar MAC). */
  const toHexByte = (n) => ('0' + (n & 255).toString(16)).slice(-2).toUpperCase();

  /** Muestra un mensaje bajo el formulario. tone: 'bad' | 'ok' | 'muted'. */
  function say(text, tone = 'bad') {
    const el = $('#f-msg');
    el.style.color = `var(--${tone})`;
    el.textContent = text;
  }

  /* ------------------------------------------------------------------------
     3. Análisis de la red
     ------------------------------------------------------------------------ */

  /** Asigna IP a cada equipo y detecta problemas (issues: 'e' = error, 'w' = advertencia). */
  function analyze(scenario) {
    const { cfg, devices } = scenario;
    const gatewayIp = `${cfg.base}.${cfg.gw}`;

    // El DHCP no entrega la IP del router ni las reservadas.
    const reserved = { [gatewayIp]: true };
    devices.forEach((d) => { if (d.mode === 'reserva') reserved[d.ip] = true; });

    let next = cfg.start;
    const rows = devices.map((d) => {
      let ip = d.ip;
      if (d.mode === 'dhcp') {
        while (next <= cfg.end && reserved[`${cfg.base}.${next}`]) next++;
        ip = next <= cfg.end ? `${cfg.base}.${next++}` : null;
      }
      return { d, ip, issues: [] };
    });

    // Cuenta cuántos equipos comparten cada IP.
    const count = {};
    rows.forEach((r) => { if (r.ip) count[r.ip] = (count[r.ip] || 0) + 1; });

    rows.forEach((r) => {
      const { d, ip } = r;
      if (!ip) { r.issues.push({ level: 'e', text: 'Pool DHCP agotado' }); return; }
      if (!isValidIp(ip)) { r.issues.push({ level: 'e', text: 'IP inválida' }); return; }

      const last = Number(ip.split('.')[3]);
      const inSubnet = ip.startsWith(`${cfg.base}.`);

      if (!inSubnet) r.issues.push({ level: 'e', text: 'Fuera de la subred' });
      else if (last === 0 || last === 255) r.issues.push({ level: 'e', text: 'Dirección de red o broadcast' });

      if (ip === gatewayIp) r.issues.push({ level: 'e', text: 'Usa la IP del router' });

      if (count[ip] > 1) {
        const others = rows.filter((o) => o !== r && o.ip === ip).map((o) => o.d.name);
        r.issues.push({ level: 'e', text: `IP duplicada con ${others.join(', ')}` });
      }

      if (d.mode === 'static' && inSubnet && last >= cfg.start && last <= cfg.end) {
        r.issues.push({ level: 'w', text: 'Estática dentro del pool DHCP' });
      }
    });

    return rows;
  }

  const hasError = (row) => row.issues.some((i) => i.level === 'e');

  /** Estadísticas simuladas de ping (4 paquetes) para un equipo. */
  function pingStats(row) {
    const err = hasError(row);
    const warn = row.issues.length > 0 && !err;
    const h = hash(row.d.name + (row.ip || 'x'));
    const type = TYPES[row.d.type];

    let lost = 0;
    if (!row.ip) lost = 4;
    else if (err) lost = h < 0.5 ? 1 : 2;

    const base = (type.wifi ? 4 + h * 6 : 1 + h * 1.5) * (err ? 4 + h * 2 : warn ? 1.3 : 1);
    return {
      sent: 4,
      lost,
      lat: lost === 4 ? null : Math.round(base * 10) / 10,
      err,
      warn
    };
  }

  /** Métricas globales de un escenario. */
  function metrics(key) {
    const scenario = scenarios[key];
    const rows = analyze(scenario);
    const stats = rows.map(pingStats);

    const conflicts = stats.filter((s) => s.err).length;
    const warns = stats.filter((s) => s.warn).length;
    const okCount = rows.length - conflicts - warns;

    const latencies = stats.filter((s) => s.lat !== null).map((s) => s.lat);
    const lat = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    const sent = stats.length * 4;
    const lost = stats.reduce((sum, s) => sum + s.lost, 0);

    return {
      rows,
      st: stats,
      total: rows.length,
      conflicts,
      warns,
      okPct: rows.length ? Math.round((okCount * 100) / rows.length) : 0,
      lat,
      loss: sent ? (lost * 100) / sent : 0,
      dhcpCount: rows.filter((r) => r.d.mode === 'dhcp').length,
      pool: scenario.cfg.end - scenario.cfg.start + 1,
      sec: scenario.cfg.sec
    };
  }

  /* ------------------------------------------------------------------------
     4. Vista
     ------------------------------------------------------------------------ */
  const formatLatency = (v) => (v === null ? '—' : `${v.toFixed(1)} ms`);

  function renderTypes() {
    $('#f-type').innerHTML = Object.entries(TYPES)
      .map(([key, t]) => `<option value="${key}">${t.label}</option>`)
      .join('');
  }

  function renderRows(m) {
    $('#dev-count').textContent = `${m.total} equipos`;

    const html = m.rows.map((r, i) => {
      const { d } = r;
      const err = hasError(r);
      const warn = r.issues.length > 0 && !err;
      const type = TYPES[d.type];

      const pill = err ? '<span class="pill bad">Conflicto</span>'
        : warn ? '<span class="pill warn">Revisar</span>'
        : '<span class="pill ok">Correcto</span>';

      const issues = r.issues.length
        ? `<ul class="issues">${r.issues.map((x) => `<li>${escapeHtml(x.text)}</li>`).join('')}</ul>`
        : '';

      const requestBtn = d.mode === 'dhcp'
        ? `<button type="button" class="link" data-act="dora" data-i="${i}">Pedir IP</button>`
        : '';

      return `<tr class="${err ? 'row-bad' : ''}">
        <td><span class="dn">${escapeHtml(d.name)}</span><span class="dt">${type.label} · ${type.wifi ? 'Wi-Fi' : 'Cable'}</span></td>
        <td>${MODE[d.mode]}</td>
        <td class="mono">${r.ip || '—'}</td>
        <td class="mono mac">${d.mac}</td>
        <td>${pill}${issues}</td>
        <td class="act">${requestBtn}<button type="button" class="link danger" data-act="del" data-i="${i}" aria-label="Quitar ${escapeHtml(d.name)}">Quitar</button></td>
      </tr>`;
    }).join('');

    $('#rows').innerHTML = html ||
      '<tr><td colspan="6" class="note">No hay dispositivos. Agrega el primero con el formulario de abajo.</td></tr>';
  }

  function renderConfig() {
    const c = current().cfg;
    $('#c-base').value = c.base;
    $('#c-gw').value = c.gw;
    $('#c-start').value = c.start;
    $('#c-end').value = c.end;
    $('#c-sec').value = c.sec;

    $('#facts').innerHTML =
      '<dt>Máscara</dt><dd>255.255.255.0 (/24)</dd>' +
      '<dt>Clase</dt><dd>C</dd>' +
      `<dt>Router</dt><dd>${c.base}.${c.gw}</dd>` +
      `<dt>Broadcast</dt><dd>${c.base}.255</dd>` +
      `<dt>Pool DHCP</dt><dd>.${c.start} a .${c.end}</dd>` +
      '<dt>Hosts útiles</dt><dd>254</dd>';
  }

  const metricCard = (value, label, cls = '') =>
    `<div class="metric ${cls}"><b>${value}</b><span>${label}</span></div>`;

  function renderMetrics(m) {
    $('#met-sc').textContent = active === 'antes' ? 'Escenario: antes' : 'Escenario: después';
    $('#metrics').innerHTML =
      metricCard(m.conflicts, 'Conflictos de IP', m.conflicts ? 'bad' : 'ok') +
      metricCard(m.warns, 'Advertencias', m.warns ? 'warn' : 'ok') +
      metricCard(formatLatency(m.lat), 'Latencia promedio') +
      metricCard(`${m.loss.toFixed(0)}%`, 'Paquetes perdidos', m.loss ? 'bad' : 'ok') +
      metricCard(`${m.okPct}%`, 'Equipos sin problemas', m.okPct < 100 ? 'warn' : 'ok') +
      metricCard(`${m.dhcpCount}/${m.pool}`, 'Uso del pool DHCP');
  }

  /** Filas de la tabla comparativa: [métrica, antes, después, {t: texto, c: clase}]. */
  function comparisonData() {
    const a = metrics('antes');
    const b = metrics('despues');

    const delta = (x, y, format, lowerIsBetter) => {
      const diff = y - x;
      if (Math.abs(diff) < 0.05) return { t: 'Sin cambio', c: 'delta-flat' };
      const good = lowerIsBetter ? diff < 0 : diff > 0;
      return { t: (diff > 0 ? '+' : '−') + format(Math.abs(diff)), c: good ? 'delta-good' : 'delta-flat' };
    };

    const latencyDelta = (a.lat !== null && b.lat !== null)
      ? delta(a.lat, b.lat, (v) => `${v.toFixed(1)} ms`, true)
      : { t: '—', c: 'delta-flat' };

    const points = (v) => `${v.toFixed(0)} pts`;

    return [
      ['Conflictos de IP', a.conflicts, b.conflicts, delta(a.conflicts, b.conflicts, String, true)],
      ['Advertencias', a.warns, b.warns, delta(a.warns, b.warns, String, true)],
      ['Equipos sin problemas', `${a.okPct}%`, `${b.okPct}%`, delta(a.okPct, b.okPct, points, false)],
      ['Latencia promedio', formatLatency(a.lat), formatLatency(b.lat), latencyDelta],
      ['Paquetes perdidos', `${a.loss.toFixed(0)}%`, `${b.loss.toFixed(0)}%`, delta(a.loss, b.loss, points, true)],
      ['Seguridad Wi-Fi', a.sec, b.sec, {
        t: a.sec === b.sec ? 'Sin cambio' : 'Protegida',
        c: a.sec === b.sec ? 'delta-flat' : 'delta-good'
      }]
    ];
  }

  function renderComparison() {
    $('#cmp').innerHTML = comparisonData().map(([name, before, after, change]) =>
      `<tr><td>${name}</td><td class="num">${before}</td><td class="num">${after}</td><td class="num ${change.c}">${change.t}</td></tr>`
    ).join('');
  }

  function render() {
    const m = metrics(active);
    renderRows(m);
    renderConfig();
    renderMetrics(m);
    renderComparison();
    $('#sc-antes').setAttribute('aria-pressed', String(active === 'antes'));
    $('#sc-despues').setAttribute('aria-pressed', String(active === 'despues'));
  }

  /* ------------------------------------------------------------------------
     5. Registro de pruebas
     ------------------------------------------------------------------------ */
  function log(text, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    const box = $('#log');
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /** Escribe las líneas una a una con una pausa entre cada una. */
  function queue(lines, gap, onDone) {
    let i = 0;
    (function step() {
      if (i >= lines.length) { if (onDone) onDone(); return; }
      log(lines[i][0], lines[i][1]);
      i++;
      setTimeout(step, gap);
    })();
  }

  /** Simula el intercambio DHCP Discover → Offer → Request → Ack. */
  function runDora(row) {
    if (busy) return;
    busy = true;

    const { cfg } = current();
    const gateway = `${cfg.base}.${cfg.gw}`;
    const { d } = row;
    const ssid = cfg.sec === 'WPA2' ? 'HogarRedes' : 'WiFi-abierta';

    const lines = [
      [`— ${d.name} (${d.mac}) se une a "${ssid}"`, 't-dim'],
      [`DHCP Discover  ${d.name} → 255.255.255.255 (broadcast)`, '']
    ];

    if (row.ip) {
      lines.push([`DHCP Offer     ${gateway} → ${d.name}: ofrece ${row.ip} (máscara 255.255.255.0, gateway ${gateway})`, '']);
      lines.push([`DHCP Request   ${d.name} → ${gateway}: solicita ${row.ip}`, '']);
      lines.push([`DHCP Ack       ${gateway} → ${d.name}: concede ${row.ip}`, 't-ok']);
      if (hasError(row)) {
        const reasons = row.issues.map((x) => x.text).join('; ');
        lines.push([`Aviso: ${reasons}. El servidor no sabía que otro equipo ya usaba esa dirección.`, 't-bad']);
      }
    } else {
      lines.push(['DHCP NAK       No quedan direcciones libres en el pool.', 't-bad']);
    }

    queue(lines, 320, () => { busy = false; });
  }

  /** Simula un ping de 4 paquetes desde cada equipo hacia el router. */
  function runPing() {
    if (busy) return;
    busy = true;
    $('#btn-ping').disabled = true;

    const m = metrics(active);
    const { cfg } = current();
    const gateway = `${cfg.base}.${cfg.gw}`;

    const lines = [[`— Prueba de conectividad hacia ${gateway} (${active === 'antes' ? 'antes' : 'después'})`, 't-dim']];

    m.rows.forEach((r, i) => {
      const s = m.st[i];
      const received = s.sent - s.lost;
      const cls = s.err ? 't-bad' : s.warn ? 't-warn' : 't-ok';
      const latency = s.lat === null ? '' : `, promedio ${s.lat.toFixed(1)} ms`;
      lines.push([`ping desde ${r.d.name} (${r.ip || 'sin IP'})`, '']);
      lines.push([`   ${s.sent} enviados, ${received} recibidos, ${(s.lost * 100) / s.sent}% perdidos${latency}`, cls]);
    });

    lines.push([`Resumen: ${m.conflicts} conflictos, ${m.loss.toFixed(0)}% de pérdida, latencia promedio ${formatLatency(m.lat)}`, 't-dim']);

    queue(lines, 160, () => { busy = false; $('#btn-ping').disabled = false; });
  }

  /* ------------------------------------------------------------------------
     6. Copiar al portapapeles
     ------------------------------------------------------------------------ */
  function copyText(text, okMessage) {
    const done = (ok) => say(ok ? okMessage : 'No se pudo copiar. Selecciona la tabla y cópiala a mano.', ok ? 'ok' : 'bad');

    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* sin permiso */ }
      document.body.removeChild(area);
      done(ok);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), fallback);
    } else {
      fallback();
    }
  }

  function addressingTableText() {
    const m = metrics(active);
    const c = current().cfg;
    const lines = [
      `Escenario\t${active === 'antes' ? 'Antes' : 'Después'}`,
      `Red\t${c.base}.0/24`,
      'Máscara\t255.255.255.0',
      `Puerta de enlace\t${c.base}.${c.gw}`,
      `Pool DHCP\t${c.base}.${c.start} - ${c.base}.${c.end}`,
      '',
      'Dispositivo\tTipo\tModo\tIP\tMAC\tEstado'
    ];
    m.rows.forEach((r) => {
      const status = hasError(r) ? 'Conflicto' : r.issues.length ? 'Revisar' : 'Correcto';
      lines.push([r.d.name, TYPES[r.d.type].label, MODE[r.d.mode], r.ip || '-', r.d.mac, status].join('\t'));
    });
    return lines.join('\n');
  }

  function comparisonText() {
    const rows = comparisonData().map(([name, before, after, change]) => [name, before, after, change.t].join('\t'));
    return ['Métrica\tAntes\tDespués\tCambio', ...rows].join('\n');
  }

  /* ------------------------------------------------------------------------
     7. Acciones del usuario
     ------------------------------------------------------------------------ */

  /** Si el formulario está en modo estático/reserva, deja el prefijo de la red actual en el campo IP. */
  function syncIpField() {
    const input = $('#f-ip');
    const isDhcp = $('#f-mode').value === 'dhcp';
    input.disabled = isDhcp;
    input.value = isDhcp ? '' : `${current().cfg.base}.`;
  }

  function setScenario(key) {
    active = key;
    say('', 'muted');
    syncIpField();
    render();
  }

  function handleAddDevice(event) {
    event.preventDefault();

    const name = $('#f-name').value.trim();
    const mode = $('#f-mode').value;
    const ip = $('#f-ip').value.trim();
    const base = current().cfg.base;

    if (!name) { say('Escribe un nombre para identificar el equipo.'); return; }
    if (mode !== 'dhcp' && !isValidIp(ip)) {
      say(`Escribe una IP válida con cuatro números entre 0 y 255, por ejemplo ${base}.7.`);
      return;
    }

    const id = nextId++;
    const mac = ['A4', '5E', '60',
      toHexByte(id * 37 + hash(name) * 255),
      toHexByte(id * 91 + 7),
      toHexByte(id * 13 + 101)].join(':');

    current().devices.push({ id, name, type: $('#f-type').value, mode, ip: mode === 'dhcp' ? '' : ip, mac });

    $('#f-name').value = '';
    $('#f-ip').value = mode === 'dhcp' ? '' : `${base}.`;
    say(`${name} agregado.`, 'muted');
    render();

    if (mode === 'dhcp') {
      const rows = analyze(current());
      runDora(rows[rows.length - 1]);
    }
  }

  function handleTableClick(event) {
    const button = event.target.closest('button[data-act]');
    if (!button) return;

    const index = Number(button.dataset.i);
    if (button.dataset.act === 'del') {
      current().devices.splice(index, 1);
      render();
    } else {
      runDora(analyze(current())[index]);
    }
  }

  function handleConfigChange() {
    const c = current().cfg;
    const base = $('#c-base').value.trim();
    const gw = Number($('#c-gw').value);
    const start = Number($('#c-start').value);
    const end = Number($('#c-end').value);

    if (!isValidIp(`${base}.1`) || base.split('.').length !== 3) {
      say('La red debe tener tres octetos, por ejemplo 192.168.10.');
      renderConfig();
      return;
    }
    if (!(gw >= 1 && gw <= 254 && start >= 1 && end <= 254 && start <= end)) {
      say('El pool debe ir de 1 a 254 y el inicio no puede superar al fin.');
      renderConfig();
      return;
    }

    Object.assign(c, { base, gw, start, end, sec: $('#c-sec').value });
    say('', 'muted');
    syncIpField();
    render();
  }

  function resetScenario() {
    scenarios[active] = createSamples()[active];
    say('', 'muted');
    syncIpField();
    render();
  }

  /* ------------------------------------------------------------------------
     8. Eventos e inicio
     ------------------------------------------------------------------------ */
  $('#sc-antes').addEventListener('click', () => setScenario('antes'));
  $('#sc-despues').addEventListener('click', () => setScenario('despues'));
  $('#f-mode').addEventListener('change', syncIpField);
  $('#add-form').addEventListener('submit', handleAddDevice);
  $('#rows').addEventListener('click', handleTableClick);
  ['#c-base', '#c-gw', '#c-start', '#c-end', '#c-sec'].forEach((sel) => $(sel).addEventListener('change', handleConfigChange));
  $('#btn-ping').addEventListener('click', runPing);
  $('#btn-clear').addEventListener('click', () => { $('#log').innerHTML = ''; });
  $('#btn-reset').addEventListener('click', resetScenario);
  $('#btn-copy').addEventListener('click', () => copyText(addressingTableText(), 'Tabla copiada. Pégala en Word o Excel.'));
  $('#btn-copy-cmp').addEventListener('click', () => copyText(comparisonText(), 'Comparación copiada. Pégala en Word o Excel.'));

  renderTypes();
  render();
  log('Listo. Elige el escenario, agrega equipos o pulsa "Probar conectividad".', 't-dim');
  log('Prueba: en "Antes" hay tres equipos con la misma IP; pasa a "Después" y compara.', 't-dim');
})();
