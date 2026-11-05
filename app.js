// CONFIGURACION Y ESTADO
const PB_URL = 'https://martiperpocketbase.duckdns.org';
const pb = new PocketBase(PB_URL);

let suscripciones = [];
let currentSub = null;
let currentCurrency = localStorage.getItem('suscripciones_currency') || '€';
let currentTheme = localStorage.getItem('suscripciones_theme') || 'auto';
let searchQuery = '';
let selectedCategoryFilter = 'all';
let selectedPresetLogo = null;
let logoRemoved = false; // el usuario ha pulsado "Quitar" logo al editar
let lastAuthRefresh = 0;
let lastTabView = 'view-home';      // pestaña a la que volver desde ajustes / formulario
let detailsReturnView = 'view-home'; // vista desde la que se abrió el detalle

// Nombre visible y color de cada categoría (los valores guardados siguen en mayúsculas)
const CATEGORY_INFO = {
    'MULTIMEDIA': { label: 'Multimedia', color: 'var(--cat-multimedia)' },
    'MÚSICA': { label: 'Música', color: 'var(--cat-musica)' },
    'HERRAMIENTAS': { label: 'Herramientas', color: 'var(--cat-herramientas)' },
    'SALUD Y FITNESS': { label: 'Salud', color: 'var(--cat-salud)' },
    'GENERAL': { label: 'General', color: 'var(--cat-general)' }
};
const CYCLE_LABEL = { mensual: 'al mes', trimestral: 'cada 3 meses', semestral: 'cada 6 meses', anual: 'al año' };

// Logos predefinidos disponibles localmente
const PRESET_LOGOS = [
    { name: 'Netflix', file: 'logos/netflix.png' },
    { name: 'Disney+', file: 'logos/disney+.png' },
    { name: 'HBO Max', file: 'logos/hbomax.png' },
    { name: 'YouTube', file: 'logos/youtube.png' },
    { name: 'ChatGPT', file: 'logos/chatgpt.png' },
    { name: 'Gemini', file: 'logos/gemini.png' },
    { name: 'Bitwarden', file: 'logos/bitwarden.png' },
    { name: 'NordVPN', file: 'logos/nordvpn.png' },
    { name: 'Photoshop', file: 'logos/photoshop.png' },
    { name: 'Infuse', file: 'logos/infuse.png' },
    { name: 'El País', file: 'logos/elpais.png' },
    { name: 'Telegram', file: 'logos/telegram.png' },
    { name: 'IPTV', file: 'logos/iptv.png' },
    { name: 'Parcel', file: 'logos/parcel.png' },
    { name: 'Retouch', file: 'logos/retouch.png' },
    { name: 'TinyMediaManager', file: 'logos/tinymediamanager.png' },
    { name: 'Claude', file: 'logos/claude.png' }
];

// UTILIDADES: escapar texto antes de meterlo en HTML (nombres con apóstrofos, comillas, < >...)
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getInitial(sub) {
    return (((sub && sub.nombre) || '').trim().charAt(0) || '?').toUpperCase();
}

// Si un logo no carga, se sustituye por la inicial del servicio
function logoFallback(img) {
    const parent = img.parentElement;
    if (parent) parent.textContent = img.dataset.initial || '?';
}

// HTML del logo (imagen o inicial) listo para insertar en un avatar
function logoImgHtml(sub) {
    const url = getSubscriptionLogoUrl(sub);
    const initial = escapeHtml(getInitial(sub));
    if (!url) return `<span>${initial}</span>`;
    const cors = /^https?:/.test(url) ? ' crossorigin="anonymous"' : '';
    return `<img src="${escapeHtml(url)}"${cors} alt="" data-initial="${initial}" onerror="logoFallback(this)">`;
}

// GESTIÓN DEL TEMA (Dark / Light / Auto)
function applyTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        meta.setAttribute('content', isDark ? '#111215' : '#f2f3f5');
    }
}

function updateTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('suscripciones_theme', theme);
    applyTheme(theme);
}

// INICIO APP
window.addEventListener('DOMContentLoaded', async () => {
    // Aplicar tema guardado
    applyTheme(currentTheme);
    const themeSelect = document.getElementById('settings-theme');
    if (themeSelect) themeSelect.value = currentTheme;

    // Escuchar cambios de preferencia del sistema si está en 'auto'
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (currentTheme === 'auto') applyTheme('auto');
        });
    }

    renderPresetLogos();
    lucide.createIcons();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    }

    // Initial UI state
    document.getElementById('currency-symbol-add').textContent = currentCurrency;
    document.getElementById('settings-currency').value = currentCurrency;

    // Soporte offline: cargar caché local primero si existe
    const cachedSubs = localStorage.getItem('suscripciones_cache');
    if (cachedSubs) {
        try {
            suscripciones = JSON.parse(cachedSubs);
            renderHome();
        } catch (e) {
            console.warn('Error leyendo caché offline de suscripciones', e);
        }
    }

    if (pb.authStore.isValid) {
        showView('view-home');
        if (await refreshSession()) await loadSuscripciones();
    } else {
        showView('auth-container');
    }

    // Al volver a la app tras un rato, renovar la sesión (como mucho una vez por hora)
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || !pb.authStore.token) return;
        if (pb.authStore.isValid && Date.now() - lastAuthRefresh < 60 * 60 * 1000) return;
        if (await refreshSession()) loadSuscripciones();
    });
});

// SESIÓN: renovar el token para que no caduque mientras usas la app
async function refreshSession() {
    if (!pb.authStore.token) {
        handleSessionExpired(false);
        return false;
    }
    try {
        await pb.collection('users').authRefresh();
        lastAuthRefresh = Date.now();
        return true;
    } catch (err) {
        if (err && [401, 403, 404].includes(err.status)) {
            handleSessionExpired(true);
            return false;
        }
        // Sin conexión u otro error de red: seguimos con los datos en caché
        console.warn('No se pudo renovar la sesión (¿sin conexión?)', err);
        return pb.authStore.isValid;
    }
}

function handleSessionExpired(showMessage = true) {
    pb.authStore.clear();
    suscripciones = [];
    showView('auth-container');
    if (showMessage) showToast('Tu sesión ha caducado. Vuelve a iniciar sesión.');
}

function getCurrentUserId() {
    const u = pb.authStore.record || pb.authStore.model;
    return u ? u.id : '';
}

// LOGOS PREDEFINIDOS
function renderPresetLogos() {
    const container = document.getElementById('preset-logos-container');
    if (!container) return;
    container.innerHTML = '';

    PRESET_LOGOS.forEach(preset => {
        const item = document.createElement('div');
        item.className = 'preset-logo-item';
        item.title = preset.name;
        item.innerHTML = `<img src="${preset.file}" alt="${preset.name}" loading="lazy">`;
        item.onclick = () => selectPresetLogo(preset, item);
        container.appendChild(item);
    });
}

async function selectPresetLogo(preset, itemEl) {
    document.querySelectorAll('.preset-logo-item').forEach(el => el.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');

    selectedPresetLogo = preset.file;
    logoRemoved = false;

    // Previsualizar
    const preview = document.getElementById('logo-preview-img');
    preview.innerHTML = `<img src="${preset.file}">`;
    document.getElementById('btn-clear-logo').style.display = 'inline-flex';

    // Limpiar input de archivo para que no colisionen
    document.getElementById('logo-file-input').value = '';

    // Si el nombre está vacío o coincide con el preset, sugerirlo
    const nameInput = document.getElementById('add-name');
    if (!nameInput.value.trim()) {
        nameInput.value = preset.name;
    }
}

function clearSelectedLogo() {
    selectedPresetLogo = null;
    logoRemoved = true;
    document.getElementById('logo-file-input').value = '';
    document.querySelectorAll('.preset-logo-item').forEach(el => el.classList.remove('selected'));
    const preview = document.getElementById('logo-preview-img');
    preview.innerHTML = '<i data-lucide="image"></i>';
    document.getElementById('btn-clear-logo').style.display = 'none';
    lucide.createIcons();
}

function previewSelectedFile() {
    const file = document.getElementById('logo-file-input').files[0];
    const preview = document.getElementById('logo-preview-img');

    // Desmarcar logo predefinido si se sube archivo
    selectedPresetLogo = null;
    document.querySelectorAll('.preset-logo-item').forEach(el => el.classList.remove('selected'));

    if (file) {
        logoRemoved = false;
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<img src="${e.target.result}">`;
            document.getElementById('btn-clear-logo').style.display = 'inline-flex';
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
        document.getElementById('btn-clear-logo').style.display = 'none';
        lucide.createIcons();
    }
}

// BÚSQUEDA Y FILTRADO EN PANTALLA PRINCIPAL
function handleSearch(val) {
    searchQuery = (val || '').trim().toLowerCase();
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) {
        clearBtn.style.display = searchQuery ? 'flex' : 'none';
    }
    renderHome();
}

function clearSearch() {
    const input = document.getElementById('home-search-input');
    if (input) input.value = '';
    searchQuery = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    renderHome();
}

function filterByCategory(cat) {
    selectedCategoryFilter = cat;
    document.querySelectorAll('#home-category-pills .pill').forEach(p => {
        if (p.getAttribute('data-cat') === cat) {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });
    renderHome();
}

// NAVEGACIÓN
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === viewId));
    document.body.dataset.view = viewId;

    if (viewId === 'view-home' || viewId === 'view-stats') lastTabView = viewId;
    document.querySelectorAll('.tabbar .nav-item').forEach(el => {
        const on = (el.id === 'nav-home' && viewId === 'view-home') || (el.id === 'nav-stats' && viewId === 'view-stats');
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });

    window.scrollTo(0, 0);

    if (viewId === 'view-home' && pb.authStore.isValid) {
        loadSuscripciones();
    }
    if (viewId === 'view-stats') {
        renderStats();
    }
    lucide.createIcons();
}

function closeSettings() {
    showView(lastTabView || 'view-home');
}

function cancelEdit() {
    if (currentSub) openDetails(currentSub.id);
    else showView(lastTabView || 'view-home');
}

function closeDetails() {
    showView(detailsReturnView || 'view-home');
}

function showAdd() {
    currentSub = null;
    selectedPresetLogo = null;
    document.getElementById('add-modal-title').textContent = 'Nueva suscripción';
    document.getElementById('add-name').value = '';
    document.getElementById('add-amount').value = '';
    document.getElementById('add-date').value = getTodayDateString();

    const catEl = document.getElementById('add-category');
    if (catEl) catEl.value = 'AUTO';

    clearSelectedLogo();
    logoRemoved = false;
    setCycle('mensual');
    sizeAmountInput();
    showView('view-add');
}

function showCanceledList() {
    const container = document.getElementById('canceled-list-container');
    const canceled = suscripciones
        .filter(s => s.estado === 'cancelada')
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    if (!canceled.length) {
        container.innerHTML = emptyHtml('archive', 'Ninguna cancelada', 'Cuando canceles una suscripción la verás aquí, por si quieres reactivarla.');
    } else {
        const rows = canceled.map(sub => subRowHtml(sub, {
            when: 'Cancelada · ' + catInfo(getEffectiveCategory(sub)).label,
            extraClass: 'is-canceled'
        })).join('');
        container.innerHTML = `<ul class="list list-subs">${rows}</ul>`;
    }
    showView('view-canceled');
}

// OBTENER URL DEL LOGO (Soporta logo de PocketBase o local de carpeta logos)
function getSubscriptionLogoUrl(sub) {
    if (!sub) return '';
    if (sub.logo) {
        if (sub.logo.startsWith('logos/')) return sub.logo;
        return `${PB_URL}/api/files/${sub.collectionId}/${sub.id}/${sub.logo}`;
    }
    const matched = PRESET_LOGOS.find(p => sub.nombre && sub.nombre.toLowerCase().includes(p.name.toLowerCase()));
    if (matched) return matched.file;
    return '';
}

// OBTENER CATEGORÍA EFECTIVA (Manual si existe, sino estimada)
function getEffectiveCategory(sub) {
    if (sub.categoria && sub.categoria !== 'AUTO') {
        return sub.categoria;
    }
    return getCategoryGuess(sub.nombre || '');
}

// AUTH
async function login() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const btn = document.getElementById('btn-login');

    if (!email || !pass) return appAlert("Por favor completa tu correo y contraseña");

    try {
        btn.disabled = true;
        btn.textContent = "Entrando…";
        await pb.collection('users').authWithPassword(email, pass);
        lastAuthRefresh = Date.now();
        btn.disabled = false;
        btn.textContent = "Entrar";
        showView('view-home');
        await loadSuscripciones();
    } catch (e) {
        appAlert("Error de inicio de sesión: " + e.message);
        btn.disabled = false;
        btn.textContent = "Entrar";
    }
}

// LOGICA DE DATOS
async function loadSuscripciones() {
    try {
        if (!pb.authStore.isValid) {
            if (pb.authStore.token) handleSessionExpired(true);
            return;
        }

        const records = await pb.collection('suscripciones').getFullList({
            sort: '-created',
        });

        suscripciones = records;
        try {
            localStorage.setItem('suscripciones_cache', JSON.stringify(records));
        } catch (e) {
            console.warn('Error guardando en caché offline', e);
        }
        renderHome();
    } catch (err) {
        if (err && err.isAbort) return; // petición duplicada cancelada por el SDK
        if (err && (err.status === 401 || err.status === 403)) {
            handleSessionExpired(true);
            return;
        }
        console.error("Error cargando suscripciones:", err);
    }
}

// LOGICA DE FECHAS Y CALCULOS
const CYCLE_MONTHS = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };

// Fecha local en formato YYYY-MM-DD (sin el desfase de UTC de toISOString)
function toDateInputString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getTodayDateString() {
    return toDateInputString(new Date());
}

// Convierte una fecha de PocketBase ("2026-01-15 12:00:00.000Z") en fecha local a medianoche.
// Evita el fallo de Safari con el espacio y los desfases de zona horaria.
function parsePbDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(String(value).replace(' ', 'T'));
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Suma meses respetando el día original: 31 ene -> 28/29 feb -> 31 mar (sin arrastrar desfases)
function addMonthsClamped(base, months) {
    const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(base.getDate(), lastDay));
    return target;
}

// Próximo cobro (hoy incluido) y cobro anterior, calculados siempre desde la fecha inicial
function getBillingDates(startValue, ciclo) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parsePbDate(startValue) || today;
    const step = CYCLE_MONTHS[ciclo] || 1;

    if (start >= today) return { next: start, prev: null };

    const monthsElapsed = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    let n = Math.max(0, Math.floor(monthsElapsed / step) - 1);
    let next = addMonthsClamped(start, n * step);
    while (next < today) {
        n++;
        next = addMonthsClamped(start, n * step);
    }
    const prev = n > 0 ? addMonthsClamped(start, (n - 1) * step) : null;
    return { next, prev };
}

function getNextBill(startValue, ciclo) {
    return getBillingDates(startValue, ciclo).next;
}

function calculateMonthlyCost(cantidad, ciclo) {
    if (ciclo === 'mensual') return cantidad;
    if (ciclo === 'trimestral') return cantidad / 3;
    if (ciclo === 'semestral') return cantidad / 6;
    if (ciclo === 'anual') return cantidad / 12;
    return cantidad;
}

function formatCurrency(num) {
    return (num || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCategoryGuess(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('netflix') || n.includes('hbo') || n.includes('disney') || n.includes('prime') || n.includes('youtube') || n.includes('apple') || n.includes('infuse') || n.includes('iptv') || n.includes('tinymedia')) return "MULTIMEDIA";
    if (n.includes('spotify') || n.includes('apple music') || n.includes('tidal') || n.includes('deezer') || n.includes('amazon music')) return "MÚSICA";
    if (n.includes('gym') || n.includes('equinox') || n.includes('fitness') || n.includes('strava')) return "SALUD Y FITNESS";
    if (n.includes('icloud') || n.includes('google') || n.includes('dropbox') || n.includes('aws') || n.includes('heroku') || n.includes('adobe') || n.includes('photoshop') || n.includes('chatgpt') || n.includes('gemini') || n.includes('bitwarden') || n.includes('nordvpn') || n.includes('retouch') || n.includes('parcel') || n.includes('claude')) return "HERRAMIENTAS";
    return "GENERAL";
}

// PRESENTACIÓN: importes, fechas relativas y categorías
function money(num) {
    const v = formatCurrency(num);
    return currentCurrency === '$' ? `$${v}` : `${v} €`;
}

function catInfo(cat) {
    return CATEGORY_INFO[cat] || CATEGORY_INFO.GENERAL;
}

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
}

// "Hoy", "Mañana", "En 4 días" o "Jue 12 nov"
function relativeDay(date) {
    const diff = daysBetween(startOfToday(), date);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff > 1 && diff < 7) return `En ${diff} días`;
    const s = date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    return capitalize(s.replace(/[.,]/g, ''));
}

// "hoy", "mañana", "en 4 días" o "el 12 de noviembre"
function relativePhrase(date) {
    const diff = daysBetween(startOfToday(), date);
    if (diff === 0) return 'hoy';
    if (diff === 1) return 'mañana';
    if (diff > 1 && diff < 7) return `en ${diff} días`;
    return 'el ' + date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

function shortDate(d) {
    return d ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '') : '—';
}

function monthYear(d) {
    return d ? d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) : '—';
}

// Todos los cobros de una suscripción entre dos fechas (ambas incluidas)
function getChargesInRange(sub, from, to) {
    const start = parsePbDate(sub.primeraFactura || sub.created);
    if (!start) return [];
    const step = CYCLE_MONTHS[sub.ciclo] || 1;
    let n = 0;
    if (start < from) {
        const monthsElapsed = (from.getFullYear() - start.getFullYear()) * 12 + (from.getMonth() - start.getMonth());
        n = Math.max(0, Math.floor(monthsElapsed / step) - 1);
        while (addMonthsClamped(start, n * step) < from) n++;
    }
    const out = [];
    let d = addMonthsClamped(start, n * step);
    while (d <= to) {
        out.push(d);
        n++;
        d = addMonthsClamped(start, n * step);
    }
    return out;
}

function subRowHtml(sub, { when, soon = false, extraClass = '' } = {}) {
    const amount = parseFloat(sub.cantidad) || 0;
    return `
        <li>
            <button class="row sub-row ${extraClass}" onclick="openDetails('${escapeHtml(sub.id)}')">
                <span class="logo">${logoImgHtml(sub)}</span>
                <span class="row-main">
                    <span class="sub-name">${escapeHtml(sub.nombre)}</span>
                    <span class="sub-when${soon ? ' soon' : ''}">${escapeHtml(when)}</span>
                </span>
                <span class="sub-price">
                    <span class="sub-amount">${money(amount)}</span>
                    <span class="sub-cycle">${CYCLE_LABEL[sub.ciclo] || 'al mes'}</span>
                </span>
            </button>
        </li>`;
}

function emptyHtml(icon, title, text, action) {
    return `
        <div class="empty">
            <div class="empty-icon"><i data-lucide="${icon}"></i></div>
            <h3>${title}</h3>
            <p>${text}</p>
            ${action || ''}
        </div>`;
}

// El importe grande del formulario crece con lo que se escribe
function sizeAmountInput() {
    const input = document.getElementById('add-amount');
    if (!input) return;
    const len = (input.value || input.placeholder || '').length;
    input.style.width = Math.max(2.4, len * 0.62 + 0.4) + 'em';
}

// RENDERIZADO PRINCIPAL
function renderHome() {
    const today = startOfToday();
    const horizonEnd = new Date(today);
    horizonEnd.setDate(today.getDate() + 29);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 6);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const active = suscripciones.filter(s => s.estado !== 'cancelada');
    const perDay = new Array(30).fill(0);
    let totalMensual = 0;
    let horizonTotal = 0;
    let horizonCount = 0;
    let closest = null;

    active.forEach(sub => {
        const cantidad = parseFloat(sub.cantidad) || 0;
        totalMensual += calculateMonthlyCost(cantidad, sub.ciclo);
        sub._nextBill = getNextBill(sub.primeraFactura || sub.created, sub.ciclo || 'mensual');
        if (!closest || sub._nextBill < closest._nextBill) closest = sub;
        getChargesInRange(sub, today, horizonEnd).forEach(d => {
            const i = daysBetween(today, d);
            if (i >= 0 && i < 30) {
                perDay[i] += cantidad;
                horizonTotal += cantidad;
                horizonCount++;
            }
        });
    });

    // --- Horizonte de 30 días (si los elementos existen en el DOM) ---
    const horizonTotalEl = document.getElementById('horizon-total');
    if (horizonTotalEl) horizonTotalEl.textContent = money(horizonTotal);

    const nextEl = document.getElementById('horizon-next');
    if (nextEl) {
        if (!active.length) {
            nextEl.textContent = 'Añade tu primera suscripción para ver aquí tus cobros.';
        } else if (!horizonCount) {
            nextEl.textContent = `Nada que pagar. El próximo cobro es ${closest.nombre}, ${relativePhrase(closest._nextBill)}.`;
        } else {
            const plural = horizonCount === 1 ? 'cobro' : 'cobros';
            nextEl.textContent = `${horizonCount} ${plural}. El próximo, ${closest.nombre} ${relativePhrase(closest._nextBill)}.`;
        }
    }

    const monthlyEl = document.getElementById('total-monthly-spend');
    if (monthlyEl) monthlyEl.textContent = money(totalMensual);

    const annualEl = document.getElementById('home-annual-projection');
    if (annualEl) annualEl.textContent = money(totalMensual * 12);

    const badgeActiveEl = document.getElementById('hero-badge-active');
    if (badgeActiveEl) badgeActiveEl.textContent = active.length;

    // --- Lista agrupada ---
    const groups = [
        { label: 'Esta semana', until: weekEnd, items: [], total: 0 },
        { label: 'Este mes', until: monthEnd, items: [], total: 0 },
        { label: 'Más adelante', until: null, items: [], total: 0 }
    ];

    active.forEach(sub => {
        if (searchQuery && !sub.nombre.toLowerCase().includes(searchQuery)) return;
        const group = groups.find(g => !g.until || sub._nextBill <= g.until);
        group.items.push(sub);
        group.total += parseFloat(sub.cantidad) || 0;
    });

    const container = document.getElementById('subs-list-container');
    const html = groups.filter(g => g.items.length).map(g => {
        g.items.sort((a, b) => a._nextBill - b._nextBill);
        const rows = g.items.map(sub => subRowHtml(sub, {
            when: relativeDay(sub._nextBill),
            soon: daysBetween(today, sub._nextBill) <= 1
        })).join('');
        return `
            <h2 class="section-title"><span>${g.label}</span><span class="num">${money(g.total)}</span></h2>
            <ul class="list list-subs">${rows}</ul>`;
    }).join('');

    if (html) {
        container.innerHTML = html;
    } else if (active.length) {
        container.innerHTML = emptyHtml('search', 'Nada coincide',
            'Prueba con otro nombre o quita el filtro de categoría.',
            '<button class="btn btn-soft" onclick="clearFilters()">Quitar filtros</button>');
    } else {
        container.innerHTML = emptyHtml('sparkles', 'Empieza por la primera',
            'Apunta un servicio que pagues cada mes o cada año y verás aquí cuándo toca cada cobro.',
            '<button class="btn btn-primary" onclick="showAdd()">Añadir suscripción</button>');
    }

    lucide.createIcons();
}

function clearFilters() {
    clearSearch();
    filterByCategory('all');
}

function openDetails(id) {
    currentSub = suscripciones.find(s => s.id === id);
    if (!currentSub) return;

    const current = document.querySelector('.view.active');
    if (current && current.id !== 'view-details' && current.id !== 'view-add') {
        detailsReturnView = current.id;
    }

    const sub = currentSub;
    const cantidad = parseFloat(sub.cantidad) || 0;
    const canceled = sub.estado === 'cancelada';
    const { next, prev } = getBillingDates(sub.primeraFactura || sub.created, sub.ciclo || 'mensual');
    const start = parsePbDate(sub.primeraFactura || sub.created);

    document.getElementById('det-logo').innerHTML = logoImgHtml(sub);
    document.getElementById('det-title').textContent = sub.nombre;
    document.getElementById('det-price-val').textContent = money(cantidad);
    document.getElementById('det-price-cyc').textContent = CYCLE_LABEL[sub.ciclo] || 'al mes';
    document.getElementById('det-status').textContent = canceled ? 'Cancelada' : '';

    const callout = document.getElementById('det-next-callout');
    if (canceled) {
        callout.textContent = '';
    } else {
        const diff = daysBetween(startOfToday(), next);
        let when;
        if (diff === 0) when = 'Hoy';
        else if (diff === 1) when = 'Mañana';
        else {
            when = 'El ' + next.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
            if (diff < 31) when += ` (en ${diff} días)`;
        }
        callout.innerHTML = `${escapeHtml(when)} se cobran <strong>${money(cantidad)}</strong>.`;
    }

    document.getElementById('det-next').textContent = canceled ? '—' : shortDate(next);
    document.getElementById('det-prev').textContent = shortDate(prev);
    document.getElementById('det-annual').textContent = money(calculateMonthlyCost(cantidad, sub.ciclo) * 12);
    const detCatEl = document.getElementById('det-category');
    if (detCatEl) detCatEl.textContent = catInfo(getEffectiveCategory(sub)).label;
    document.getElementById('det-cat').textContent = shortDate(start);

    document.getElementById('btn-cancel-sub').style.display = canceled ? 'none' : 'flex';
    document.getElementById('btn-reactivate-sub').style.display = canceled ? 'flex' : 'none';

    showView('view-details');
}

async function cancelCurrentSub() {
    if (!currentSub) return;
    if (!await appConfirm(`¿Quieres marcar como cancelada la suscripción a ${currentSub.nombre}? Se archivará en tu historial.`, { okText: 'Cancelar suscripción', cancelText: 'Volver' })) return;

    try {
        await pb.collection('suscripciones').update(currentSub.id, { estado: 'cancelada' });
        showToast("Suscripción cancelada");
        await loadSuscripciones();
        openDetails(currentSub.id);
    } catch (err) {
        appAlert("Error al cancelar: " + err.message);
    }
}

async function reactivateCurrentSub() {
    if (!currentSub) return;
    if (!await appConfirm(`¿Quieres reactivar la suscripción a ${currentSub.nombre}? Volverá a contar en tus gastos.`, { okText: 'Reactivar' })) return;

    try {
        await pb.collection('suscripciones').update(currentSub.id, { estado: 'activa' });
        showToast("Suscripción reactivada");
        await loadSuscripciones();
        openDetails(currentSub.id);
    } catch (err) {
        appAlert("Error al reactivar: " + err.message);
    }
}

let activeCycle = 'mensual';
function setCycle(cycle) {
    activeCycle = cycle;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.querySelector(`.tab[data-cycle="${cycle}"]`);
    if (tabEl) tabEl.classList.add('active');
}

async function fetchPresetAsFile(presetPath, filename) {
    const res = await fetch(presetPath);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
}

async function saveSubscription() {
    const name = document.getElementById('add-name').value.trim();
    const amount = parseFloat(document.getElementById('add-amount').value);
    const date = document.getElementById('add-date').value;
    const catEl = document.getElementById('add-category');
    const cat = catEl ? catEl.value : '';

    if (!name || isNaN(amount) || amount < 0 || !date) {
        return appAlert("Por favor completa los campos correctamente");
    }

    const formData = new FormData();
    formData.append('nombre', name);
    formData.append('cantidad', amount);
    formData.append('ciclo', activeCycle);
    formData.append('primeraFactura', date + " 12:00:00.000Z");
    formData.append('user', getCurrentUserId());
    if (cat) formData.append('categoria', cat);

    if (!currentSub) {
        formData.append('estado', 'activa');
    }

    const logoFile = document.getElementById('logo-file-input').files[0];
    if (logoFile) {
        formData.append('logo', logoFile);
    } else if (selectedPresetLogo) {
        try {
            const fileName = selectedPresetLogo.split('/').pop();
            const fileObj = await fetchPresetAsFile(selectedPresetLogo, fileName);
            formData.append('logo', fileObj);
        } catch (e) {
            console.warn("No se pudo adjuntar el logo predefinido:", e);
        }
    } else if (currentSub && logoRemoved && currentSub.logo) {
        // El usuario ha pulsado "Quitar": borrar el logo guardado en PocketBase
        formData.append('logo', '');
    }

    const btn = document.getElementById('btn-save');
    btn.textContent = "Guardando...";
    btn.disabled = true;

    try {
        if (currentSub) {
            await pb.collection('suscripciones').update(currentSub.id, formData);
            showToast("Suscripción actualizada");
        } else {
            await pb.collection('suscripciones').create(formData);
            showToast("Suscripción añadida");
        }

        const editedId = currentSub ? currentSub.id : null;
        await loadSuscripciones();
        if (editedId) openDetails(editedId);
        else showView('view-home');
    } catch (err) {
        appAlert("Error guardando datos: " + err.message);
    } finally {
        btn.textContent = "Guardar";
        btn.disabled = false;
    }
}

function editCurrentSub() {
    if (!currentSub) return;
    document.getElementById('add-modal-title').textContent = 'Editar suscripción';
    document.getElementById('add-name').value = currentSub.nombre;
    document.getElementById('add-amount').value = currentSub.cantidad;
    const editStart = parsePbDate(currentSub.primeraFactura || currentSub.created);
    document.getElementById('add-date').value = editStart ? toDateInputString(editStart) : getTodayDateString();

    const catSelect = document.getElementById('add-category');
    if (catSelect) {
        catSelect.value = currentSub.categoria || 'AUTO';
    }

    selectedPresetLogo = null;
    document.querySelectorAll('.preset-logo-item').forEach(el => el.classList.remove('selected'));

    const preview = document.getElementById('logo-preview-img');
    const logoUrl = getSubscriptionLogoUrl(currentSub);
    if (logoUrl) {
        preview.innerHTML = `<img src="${escapeHtml(logoUrl)}">`;
        document.getElementById('btn-clear-logo').style.display = 'inline-flex';
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
        document.getElementById('btn-clear-logo').style.display = 'none';
    }

    logoRemoved = false;
    setCycle(currentSub.ciclo || 'mensual');
    sizeAmountInput();
    showView('view-add');
    lucide.createIcons();
}

async function deleteCurrentSub() {
    if (!currentSub) return;
    if (!await appConfirm(`¿Estás seguro de eliminar definitivamente la suscripción a ${currentSub.nombre}? Esta acción no se puede deshacer.`, { okText: 'Eliminar', danger: true })) return;

    try {
        await pb.collection('suscripciones').delete(currentSub.id);
        showToast("Suscripción eliminada");
        await loadSuscripciones();
        showView(lastTabView || 'view-home');
    } catch (err) {
        appAlert("Error eliminando: " + err.message);
    }
}

// ESTADÍSTICAS Y DESGLOSE POR CATEGORÍA
function renderStats() {
    const active = suscripciones.filter(s => s.estado !== 'cancelada');
    const canceledCount = suscripciones.length - active.length;
    document.getElementById('stats-canceled-count').textContent = canceledCount;

    const main = document.getElementById('stats-total-monthly');
    const subline = document.getElementById('stats-total-annual');
    const bar = document.getElementById('stats-stack-bar');
    const legend = document.getElementById('stats-categories-container');
    const ranking = document.getElementById('stats-ranking');
    const facts = document.getElementById('stats-facts');

    if (!active.length) {
        main.textContent = `${money(0)} al mes`;
        subline.textContent = 'Todavía no tienes suscripciones activas.';
        bar.innerHTML = '';
        legend.innerHTML = '<li class="hint">Sin datos todavía.</li>';
        ranking.innerHTML = '<li class="row"><span class="row-main hint">Sin datos todavía.</span></li>';
        facts.innerHTML = '<li class="row"><span class="row-main hint">Sin datos todavía.</span></li>';
        lucide.createIcons();
        return;
    }

    const monthlyOf = s => calculateMonthlyCost(parseFloat(s.cantidad) || 0, s.ciclo);
    const totalMonthly = active.reduce((acc, s) => acc + monthlyOf(s), 0);
    const n = active.length;

    main.textContent = `${money(totalMonthly)} al mes`;
    subline.textContent = `Son ${money(totalMonthly * 12)} al año en ${n} ${n === 1 ? 'suscripción activa' : 'suscripciones activas'}.`;

    // Por categoría
    const catTotals = {};
    active.forEach(s => {
        const c = getEffectiveCategory(s);
        catTotals[c] = (catTotals[c] || 0) + monthlyOf(s);
    });
    const cats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    bar.innerHTML = cats.map(c => `<span style="flex-grow:${catTotals[c]}; background:${catInfo(c).color}"></span>`).join('');
    legend.innerHTML = cats.map(c => {
        const pct = Math.round(catTotals[c] / totalMonthly * 100);
        return `<li>
            <span class="cat-dot" data-cat="${escapeHtml(c)}"></span>
            <span class="legend-name">${catInfo(c).label}</span>
            <span class="legend-amount">${money(catTotals[c])}</span>
            <span class="legend-pct">${pct}%</span>
        </li>`;
    }).join('');

    // Ranking por coste mensual
    const sorted = [...active].sort((a, b) => monthlyOf(b) - monthlyOf(a));
    const top = monthlyOf(sorted[0]) || 1;
    ranking.className = 'list list-rank';
    ranking.innerHTML = sorted.slice(0, 6).map(s => {
        const m = monthlyOf(s);
        const color = catInfo(getEffectiveCategory(s)).color;
        return `<li>
            <button class="row sub-row" onclick="openDetails('${escapeHtml(s.id)}')">
                <span class="logo logo-sm">${logoImgHtml(s)}</span>
                <span class="row-main">
                    <span class="sub-name">${escapeHtml(s.nombre)}</span>
                    <span class="rank-bar"><span style="width:${Math.max(4, m / top * 100)}%; background:${color}"></span></span>
                </span>
                <span class="sub-price">
                    <span class="sub-amount">${money(m)}</span>
                    <span class="sub-cycle">al mes</span>
                </span>
            </button>
        </li>`;
    }).join('');

    // Curiosidades
    const startOf = s => parsePbDate(s.primeraFactura || s.created) || new Date();
    const byDate = [...active].sort((a, b) => startOf(a) - startOf(b));
    const oldest = byDate[0];
    const newest = byDate[byDate.length - 1];
    const cheapest = sorted[sorted.length - 1];
    const lines = [
        `Te cuestan <strong>${money(totalMonthly * 12 / 365)}</strong> al día.`,
        `La más antigua es <strong>${escapeHtml(oldest.nombre)}</strong>, desde ${monthYear(startOf(oldest))}.`
    ];
    if (newest !== oldest) lines.push(`La más reciente es <strong>${escapeHtml(newest.nombre)}</strong>, desde ${monthYear(startOf(newest))}.`);
    if (cheapest !== sorted[0]) lines.push(`La más barata es <strong>${escapeHtml(cheapest.nombre)}</strong>: ${money(monthlyOf(cheapest))} al mes.`);
    facts.innerHTML = lines.map(l => `<li class="row"><span class="row-main fact">${l}</span></li>`).join('');

    lucide.createIcons();
}



// SETUP Y AJUSTES
function updateCurrency() {
    currentCurrency = document.getElementById('settings-currency').value;
    localStorage.setItem('suscripciones_currency', currentCurrency);
    document.getElementById('currency-symbol-add').textContent = currentCurrency;
    renderHome();
    renderStats();
}

// Celda CSV segura: comillas dobladas y entrecomillado si hace falta
function csvCell(value) {
    const s = String(value ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportData() {
    if (suscripciones.length === 0) return appAlert("No hay datos para exportar");

    // Formato pensado para Excel/Numbers en español: separador ";", coma decimal y BOM UTF-8 (tildes correctas)
    const header = ['Nombre', 'Cantidad', 'Ciclo', 'Categoria', 'Estado', 'Primera Factura'];
    const rows = suscripciones.map(s => {
        const start = parsePbDate(s.primeraFactura);
        return [
            s.nombre,
            Number(s.cantidad || 0).toFixed(2).replace('.', ','),
            s.ciclo,
            getEffectiveCategory(s),
            s.estado || 'activa',
            start ? toDateInputString(start) : ''
        ].map(csvCell).join(';');
    });
    const csv = '﻿' + [header.join(';'), ...rows].join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suscripciones_${getTodayDateString()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

async function logout() {
    if (!await appConfirm("¿Cerrar sesión en Mis Suscripciones?", { okText: 'Cerrar sesión', danger: true })) return;
    pb.authStore.clear();
    location.reload();
}

// DIÁLOGOS PROPIOS (sustituyen a alert/confirm del navegador)
function appConfirm(message, { okText = 'Aceptar', cancelText = 'Volver', danger = false } = {}) {
    return new Promise(resolve => {
        const dlg = document.getElementById('app-dialog');
        const ok = document.getElementById('dialog-ok');
        const cancel = document.getElementById('dialog-cancel');
        if (!dlg) return resolve(cancelText === null ? true : window.confirm(message));

        document.getElementById('dialog-msg').textContent = message;
        ok.textContent = okText;
        ok.classList.toggle('dialog-btn-danger', !!danger);
        cancel.hidden = cancelText === null;
        if (cancelText !== null) cancel.textContent = cancelText;

        const previousFocus = document.activeElement;
        const close = (value) => {
            dlg.classList.remove('open');
            dlg.hidden = true;
            ok.onclick = cancel.onclick = dlg.onclick = null;
            document.removeEventListener('keydown', onKey);
            if (previousFocus && previousFocus.focus) previousFocus.focus();
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(cancelText === null);
        };
        ok.onclick = () => close(true);
        cancel.onclick = () => close(false);
        dlg.onclick = (e) => { if (e.target === dlg) close(cancelText === null); };
        document.addEventListener('keydown', onKey);

        dlg.hidden = false;
        requestAnimationFrame(() => dlg.classList.add('open'));
        ok.focus();
    });
}

function appAlert(message) {
    return appConfirm(message, { okText: 'Entendido', cancelText: null });
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}
