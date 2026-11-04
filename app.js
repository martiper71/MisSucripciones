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
        meta.setAttribute('content', isDark ? '#090d16' : '#f8fafc');
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
    document.getElementById('btn-clear-logo').style.display = 'inline-block';

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
            document.getElementById('btn-clear-logo').style.display = 'inline-block';
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
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    // Update Bottom Nav active state
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (viewId === 'view-home') {
        const navHome = document.getElementById('nav-home');
        const navHomeStats = document.getElementById('nav-home-stats');
        if (navHome) navHome.classList.add('active');
        if (navHomeStats) navHomeStats.classList.add('active');
    } else if (viewId === 'view-stats') {
        const navStats = document.getElementById('nav-stats');
        const navStatsStats = document.getElementById('nav-stats-stats');
        if (navStats) navStats.classList.add('active');
        if (navStatsStats) navStatsStats.classList.add('active');
    }

    if (viewId === 'view-home' && pb.authStore.isValid) {
        loadSuscripciones();
    }
    if (viewId === 'view-stats') {
        renderStats();
    }
    lucide.createIcons();
}

function showAdd() {
    currentSub = null;
    selectedPresetLogo = null;
    document.getElementById('add-modal-title').textContent = 'NUEVA SUSCRIPCIÓN';
    document.getElementById('add-name').value = '';
    document.getElementById('add-amount').value = '';
    document.getElementById('add-date').value = getTodayDateString();
    document.getElementById('add-category').value = 'AUTO';

    clearSelectedLogo();
    logoRemoved = false;
    setCycle('mensual');
    showView('view-add');
}

function showCanceledList() {
    const container = document.getElementById('canceled-list-container');
    container.innerHTML = '';

    const canceledSubs = suscripciones.filter(s => s.estado === 'cancelada');

    if (canceledSubs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i data-lucide="archive"></i></div>
                <h4>Sin cancelaciones</h4>
                <p>No tienes suscripciones canceladas en tu historial.</p>
            </div>
        `;
        showView('view-canceled');
        lucide.createIcons();
        return;
    }

    // Ordenar por nombre
    canceledSubs.sort((a, b) => a.nombre.localeCompare(b.nombre));

    const grid = document.createElement('div');
    grid.className = 'subs-grid';

    canceledSubs.forEach(sub => {
        const cat = getEffectiveCategory(sub);

        const logoHtml = `
            <div class="sub-logo-avatar" style="opacity: 0.5; filter: grayscale(1);">
                ${logoImgHtml(sub)}
            </div>
        `;

        const itemHtml = `
            <div class="sub-item" onclick="openDetails('${sub.id}')" style="opacity: 0.75;">
                ${logoHtml}
                <div class="sub-info">
                    <strong style="text-decoration: line-through;">${escapeHtml(sub.nombre)}</strong>
                    <div class="sub-meta">
                        <span class="sub-cat-tag">${escapeHtml(cat)}</span>
                        <span>CANCELADA</span>
                    </div>
                </div>
                <div class="sub-price-block">
                    <span class="sub-price-val" style="color: var(--text-tertiary); text-decoration: line-through;">${formatCurrency(sub.cantidad)}${currentCurrency}</span>
                    <span class="sub-price-cycle">${sub.ciclo}</span>
                </div>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', itemHtml);
    });

    container.appendChild(grid);
    showView('view-canceled');
    lucide.createIcons();
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
        btn.textContent = "Accediendo...";
        await pb.collection('users').authWithPassword(email, pass);
        lastAuthRefresh = Date.now();
        btn.disabled = false;
        btn.textContent = "Iniciar sesión";
        showView('view-home');
        await loadSuscripciones();
    } catch (e) {
        appAlert("Error de inicio de sesión: " + e.message);
        btn.disabled = false;
        btn.textContent = "Iniciar sesión";
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

// RENDERIZADO PRINCIPAL (DISEÑO MODERNO DE TARJETAS)
function renderHome() {
    let totalMensual = 0;
    let closestSub = null;
    let closestTime = Infinity;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const oneWeek = new Date(today);
    oneWeek.setDate(today.getDate() + 7);

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const groups = {
        'esta-semana': { label: 'Esta Semana', total: 0, items: [] },
        'este-mes': { label: 'Próximos este Mes', total: 0, items: [] },
        'mas-tarde': { label: 'Más Adelante', total: 0, items: [] }
    };

    let activeCount = 0;

    suscripciones.forEach(sub => {
        if (sub.estado === 'cancelada') return;

        activeCount++;
        let cantidad = parseFloat(sub.cantidad || 0);
        totalMensual += calculateMonthlyCost(cantidad, sub.ciclo);

        let nextBill = getNextBill(sub.primeraFactura || sub.created, sub.ciclo || 'mensual');
        sub._nextBill = nextBill;

        if (nextBill >= today && nextBill < closestTime) {
            closestTime = nextBill;
            closestSub = sub;
        }

        // Filtro por búsqueda de texto
        if (searchQuery && !sub.nombre.toLowerCase().includes(searchQuery)) {
            return;
        }

        // Filtro por categoría seleccionada
        const subCat = getEffectiveCategory(sub);
        if (selectedCategoryFilter !== 'all' && subCat !== selectedCategoryFilter) {
            return;
        }

        if (nextBill <= oneWeek) {
            groups['esta-semana'].items.push(sub);
            groups['esta-semana'].total += cantidad;
        } else if (nextBill <= endOfMonth) {
            groups['este-mes'].items.push(sub);
            groups['este-mes'].total += cantidad;
        } else {
            groups['mas-tarde'].items.push(sub);
            groups['mas-tarde'].total += cantidad;
        }
    });

    // Actualizar Hero card
    document.getElementById('total-monthly-spend').textContent = `${formatCurrency(totalMensual)}${currentCurrency}`;
    const badgeActive = document.getElementById('hero-badge-active');
    if (badgeActive) badgeActive.textContent = `${activeCount} ACTIVAS`;

    const annualProjection = document.getElementById('home-annual-projection');
    if (annualProjection) annualProjection.textContent = `${formatCurrency(totalMensual * 12)}${currentCurrency}`;

    const nextChargeInfo = document.getElementById('home-next-charge-info');
    if (nextChargeInfo) {
        if (closestSub && closestSub._nextBill) {
            const day = closestSub._nextBill.getDate().toString().padStart(2, '0');
            const month = closestSub._nextBill.toLocaleString('es-ES', { month: 'short' });
            nextChargeInfo.textContent = `${closestSub.nombre} (${day} ${month})`;
        } else {
            nextChargeInfo.textContent = 'Ninguno';
        }
    }

    const container = document.getElementById('subs-list-container');
    container.innerHTML = '';

    let totalRendered = 0;

    Object.keys(groups).forEach(key => {
        const group = groups[key];
        if (group.items.length === 0) return;

        totalRendered += group.items.length;
        group.items.sort((a, b) => a._nextBill - b._nextBill);

        const section = document.createElement('div');
        section.className = 'group-section';

        const headerHtml = `
            <div class="group-header">
                <span>${group.label}</span>
                <span class="right">${formatCurrency(group.total)}${currentCurrency}</span>
            </div>
        `;
        section.insertAdjacentHTML('beforeend', headerHtml);

        const grid = document.createElement('div');
        grid.className = 'subs-grid';

        group.items.forEach(sub => {
            const dateObj = sub._nextBill;
            const day = dateObj.getDate().toString().padStart(2, '0');
            const month = dateObj.toLocaleString('es-ES', { month: 'short' }).toUpperCase();

            const cat = getEffectiveCategory(sub);

            const logoHtml = `
                <div class="sub-logo-avatar">
                    ${logoImgHtml(sub)}
                </div>
            `;

            const itemHtml = `
                <div class="sub-item" onclick="openDetails('${sub.id}')">
                    <div class="sub-date-badge">
                        <strong>${day}</strong>
                        <span>${month}</span>
                    </div>
                    ${logoHtml}
                    <div class="sub-info">
                        <strong>${escapeHtml(sub.nombre)}</strong>
                        <div class="sub-meta">
                            <span class="sub-cat-tag">${escapeHtml(cat)}</span>
                            <span>• ${sub.ciclo}</span>
                        </div>
                    </div>
                    <div class="sub-price-block">
                        <span class="sub-price-val">${formatCurrency(sub.cantidad)}${currentCurrency}</span>
                        <span class="sub-price-cycle">/${sub.ciclo === 'mensual' ? 'mes' : sub.ciclo === 'anual' ? 'año' : sub.ciclo === 'trimestral' ? 'trim' : 'sem'}</span>
                    </div>
                </div>
            `;
            grid.insertAdjacentHTML('beforeend', itemHtml);
        });

        section.appendChild(grid);
        container.appendChild(section);
    });

    if (totalRendered === 0) {
        if (searchQuery || selectedCategoryFilter !== 'all') {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="search"></i></div>
                    <h4>Sin resultados</h4>
                    <p>No hay suscripciones que coincidan con la búsqueda o filtro actual.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="sparkles"></i></div>
                    <h4>Tu lista está vacía</h4>
                    <p>Toca el botón flotante (+) para añadir tu primera suscripción.</p>
                </div>
            `;
        }
    }

    lucide.createIcons();
}

function openDetails(id) {
    currentSub = suscripciones.find(s => s.id === id);
    if (!currentSub) return;

    const cat = getEffectiveCategory(currentSub);
    const { next: nextBill, prev: prevBill } = getBillingDates(currentSub.primeraFactura || currentSub.created, currentSub.ciclo || 'mensual');
    document.getElementById('det-logo').innerHTML = logoImgHtml(currentSub);

    document.getElementById('det-title').textContent = currentSub.nombre;
    document.getElementById('det-price-val').textContent = `${formatCurrency(currentSub.cantidad)}${currentCurrency}`;

    let cycleSuffix = "/mes";
    if (currentSub.ciclo === 'trimestral') cycleSuffix = "/trim";
    if (currentSub.ciclo === 'semestral') cycleSuffix = "/sem";
    if (currentSub.ciclo === 'anual') cycleSuffix = "/año";
    document.getElementById('det-price-cyc').textContent = cycleSuffix;

    const annualCost = currentSub.ciclo === 'anual' ? currentSub.cantidad :
        currentSub.ciclo === 'mensual' ? currentSub.cantidad * 12 :
            currentSub.ciclo === 'trimestral' ? currentSub.cantidad * 4 :
                currentSub.cantidad * 2;

    document.getElementById('det-annual').textContent = `${formatCurrency(annualCost)}${currentCurrency}`;
    document.getElementById('det-next').textContent = nextBill.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('det-prev').textContent = prevBill ? prevBill.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    const startDate = parsePbDate(currentSub.primeraFactura || currentSub.created);
    document.getElementById('det-cat').textContent = startDate ? startDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    const cancelBtn = document.getElementById('btn-cancel-sub');
    const statusPill = document.getElementById('det-status');
    const reactivateBtn = document.getElementById('btn-reactivate-sub');

    if (currentSub.estado === 'cancelada') {
        cancelBtn.style.display = 'none';
        if (reactivateBtn) reactivateBtn.style.display = 'flex';
        statusPill.innerHTML = '<div class="dot red-dot"></div> CANCELADA';
        statusPill.className = 'status-pill canceled-pill';
    } else {
        cancelBtn.style.display = 'flex';
        if (reactivateBtn) reactivateBtn.style.display = 'none';
        statusPill.innerHTML = '<div class="dot green-dot"></div> ACTIVA';
        statusPill.className = 'status-pill active-pill';
    }

    showView('view-details');
    lucide.createIcons();
}

async function cancelCurrentSub() {
    if (!currentSub) return;
    if (!await appConfirm(`¿Quieres marcar como cancelada la suscripción a ${currentSub.nombre}? Se archivará en tu historial.`, { okText: 'Cancelar suscripción', cancelText: 'Volver' })) return;

    try {
        await pb.collection('suscripciones').update(currentSub.id, { estado: 'cancelada' });
        showToast("Suscripción cancelada correctamente");
        await loadSuscripciones();
        showView('view-home');
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
        showView('view-home');
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
    const cat = document.getElementById('add-category').value;

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
            showToast("Suscripción añadida con éxito");
        }

        await loadSuscripciones();
        showView('view-home');
    } catch (err) {
        appAlert("Error guardando datos: " + err.message);
    } finally {
        btn.textContent = "Guardar";
        btn.disabled = false;
    }
}

function editCurrentSub() {
    if (!currentSub) return;
    document.getElementById('add-modal-title').textContent = 'EDITAR SUSCRIPCIÓN';
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
        document.getElementById('btn-clear-logo').style.display = 'inline-block';
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
        document.getElementById('btn-clear-logo').style.display = 'none';
    }

    logoRemoved = false;
    setCycle(currentSub.ciclo || 'mensual');
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
        showView('view-home');
    } catch (err) {
        appAlert("Error eliminando: " + err.message);
    }
}

// ESTADÍSTICAS Y DESGLOSE POR CATEGORÍA
function renderStats() {
    const activeSubs = suscripciones.filter(s => s.estado !== 'cancelada');

    if (activeSubs.length === 0) {
        document.getElementById('stats-total-monthly').textContent = `0,00${currentCurrency}`;
        document.getElementById('stats-total-annual').textContent = `0,00${currentCurrency}`;
        document.getElementById('stats-sub-count').textContent = suscripciones.length;
        document.getElementById('stats-active-count').textContent = '0';
        document.getElementById('stats-canceled-count').textContent = suscripciones.length;
        document.getElementById('stats-categories-container').innerHTML = '<p class="hint">No hay suscripciones activas.</p>';
        document.getElementById('stats-cheapest-sub').innerHTML = '';
        document.getElementById('stats-top-sub').innerHTML = '';
        document.getElementById('stats-oldest-sub').innerHTML = '';
        document.getElementById('stats-newest-sub').innerHTML = '';
        return;
    }

    let totalMonthly = 0;
    let topSub = activeSubs[0];
    let topMonthlyVal = 0;
    let cheapestSub = activeSubs[0];
    let cheapestMonthlyVal = Infinity;
    const catTotals = {};

    activeSubs.forEach(sub => {
        const monthlyCost = calculateMonthlyCost(sub.cantidad, sub.ciclo);
        totalMonthly += monthlyCost;

        const cat = getEffectiveCategory(sub);
        catTotals[cat] = (catTotals[cat] || 0) + monthlyCost;

        if (monthlyCost > topMonthlyVal) {
            topMonthlyVal = monthlyCost;
            topSub = sub;
        }
        if (monthlyCost < cheapestMonthlyVal) {
            cheapestMonthlyVal = monthlyCost;
            cheapestSub = sub;
        }
    });

    const totalAnnual = totalMonthly * 12;

    document.getElementById('stats-total-monthly').textContent = `${formatCurrency(totalMonthly)}${currentCurrency}`;
    document.getElementById('stats-total-annual').textContent = `${formatCurrency(totalAnnual)}${currentCurrency}`;
    document.getElementById('stats-sub-count').textContent = suscripciones.length;
    document.getElementById('stats-active-count').textContent = activeSubs.length;
    document.getElementById('stats-canceled-count').textContent = suscripciones.length - activeSubs.length;

    // Render desgloses por categoría con barras elegantes
    const catContainer = document.getElementById('stats-categories-container');
    if (catContainer) {
        catContainer.innerHTML = '';
        const sortedCats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);

        sortedCats.forEach(cat => {
            const amount = catTotals[cat];
            const pct = totalMonthly > 0 ? Math.round((amount / totalMonthly) * 100) : 0;
            const catHtml = `
                <div class="category-bar-item">
                    <div class="cat-header">
                        <strong>${escapeHtml(cat)}</strong>
                        <span>${formatCurrency(amount)}${currentCurrency}/mes (${pct}%)</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
            catContainer.insertAdjacentHTML('beforeend', catHtml);
        });
    }

    renderSubCard('stats-cheapest-sub', cheapestSub, `${formatCurrency(calculateMonthlyCost(cheapestSub.cantidad, cheapestSub.ciclo))}${currentCurrency} / mes`);
    renderSubCard('stats-top-sub', topSub, `${formatCurrency(calculateMonthlyCost(topSub.cantidad, topSub.ciclo))}${currentCurrency} / mes`);

    const startOf = s => parsePbDate(s.primeraFactura || s.created) || new Date();
    const sortedByDate = [...activeSubs].sort((a, b) => startOf(a) - startOf(b));
    const oldestSub = sortedByDate[0];
    const newestSub = sortedByDate[sortedByDate.length - 1];

    const oldestDate = startOf(oldestSub).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    const newestDate = startOf(newestSub).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

    renderSubCard('stats-oldest-sub', oldestSub, `Desde: ${oldestDate}`);
    renderSubCard('stats-newest-sub', newestSub, `Desde: ${newestDate}`);

    lucide.createIcons();
}

function renderSubCard(containerId, sub, footerText) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!sub) {
        container.innerHTML = '<p style="color: var(--text-tertiary); font-size: 13px; padding: 10px;">No hay datos</p>';
        return;
    }


    container.innerHTML = `
        <div class="top-sub-card">
            <div class="sub-logo-avatar">
                ${logoImgHtml(sub)}
            </div>
            <div class="sub-info">
                <strong>${escapeHtml(sub.nombre)}</strong>
                <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${footerText}</span>
            </div>
        </div>
    `;
}

// SETUP Y AJUSTES
function updateCurrency() {
    currentCurrency = document.getElementById('settings-currency').value;
    localStorage.setItem('suscripciones_currency', currentCurrency);
    document.getElementById('currency-symbol-add').textContent = currentCurrency;
    renderHome();
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
function appConfirm(message, { okText = 'Aceptar', cancelText = 'Cancelar', danger = false } = {}) {
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
