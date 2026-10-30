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
    { name: 'TinyMediaManager', file: 'logos/tinymediamanager.png' }
];

// GESTIÓN DEL TEMA (Dark / Light / Auto)
function applyTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
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
        await loadSuscripciones();
    } else {
        showView('auth-container');
    }
});

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
    document.getElementById(viewId).classList.add('active');

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
    setCycle('mensual');
    showView('view-add');
}

function showCanceledList() {
    const container = document.getElementById('canceled-list-container');
    container.innerHTML = '';

    const canceledSubs = suscripciones.filter(s => s.estado === 'cancelada');

    if (canceledSubs.length === 0) {
        container.innerHTML = '<p class="hint" style="text-align: center; margin-top: 40px; padding: 20px;">No tienes suscripciones canceladas en tu historial.</p>';
        showView('view-canceled');
        return;
    }

    // Ordenar por nombre
    canceledSubs.sort((a, b) => a.nombre.localeCompare(b.nombre));

    canceledSubs.forEach(sub => {
        const cat = getEffectiveCategory(sub);
        const logoPath = getSubscriptionLogoUrl(sub);

        const logoHtml = `
            <div class="logo-wrapper">
                <div class="sub-logo-small" style="background: var(--hover); color: var(--text-color); filter: grayscale(1); opacity: 0.6;">
                    ${logoPath ?
                `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='var(--accent)'; this.parentElement.style.color='var(--accent-contrast)'">` :
                `<span>${sub.nombre.charAt(0).toUpperCase()}</span>`}
                </div>
            </div>
        `;

        const itemHtml = `
            <div class="sub-item" onclick="openDetails('${sub.id}')" style="opacity: 0.8;">
                <div class="sub-date" style="display: none;"></div>
                ${logoHtml}
                <div class="sub-info" style="margin-left: 0;">
                    <strong style="color: var(--text-muted);">${sub.nombre}</strong>
                    <span style="color: var(--text-muted);">${cat} • CANCELADA</span>
                </div>
                <div class="sub-price" style="color: var(--text-muted); text-decoration: line-through;">${formatCurrency(sub.cantidad)}${currentCurrency}</div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
    });

    showView('view-canceled');
    lucide.createIcons();
}

// OBTENER URL DEL LOGO (Soporta logo de PocketBase o local de carpeta logos)
function getSubscriptionLogoUrl(sub) {
    if (!sub) return '';
    if (sub.logo) {
        // Si sub.logo ya es una ruta relativa local
        if (sub.logo.startsWith('logos/')) return sub.logo;
        return `${PB_URL}/api/files/${sub.collectionId}/${sub.id}/${sub.logo}`;
    }
    // Si no tiene logo en PocketBase, intentar asociar por nombre con un logo predefinido
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

    if (!email || !pass) return alert("Hacen falta datos");

    try {
        btn.disabled = true;
        btn.textContent = "Entrando...";
        await pb.collection('users').authWithPassword(email, pass);
        showView('view-home');
        await loadSuscripciones();
    } catch (e) {
        alert("Error de inicio de sesión: " + e.message);
        btn.disabled = false;
        btn.textContent = "Entrar";
    }
}

// LOGICA DE DATOS
async function loadSuscripciones() {
    try {
        if (!pb.authStore.isValid) return;

        const records = await pb.collection('suscripciones').getFullList({
            sort: '-created',
        });

        suscripciones = records;
        // Guardar copia offline
        try {
            localStorage.setItem('suscripciones_cache', JSON.stringify(records));
        } catch (e) {
            console.warn('Error guardando en caché offline', e);
        }
        renderHome();
    } catch (err) {
        console.error("Error cargando suscripciones:", err);
        if (err.status === 404) {
            console.warn("Colección 'suscripciones' no encontrada.");
        }
    }
}

// LOGICA DE FECHAS Y CALCULOS
function getTodayDateString() {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

function getNextBill(primeraFacturaStr, ciclo) {
    let d = new Date(primeraFacturaStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (d < today) {
        if (ciclo === 'mensual') d.setMonth(d.getMonth() + 1);
        else if (ciclo === 'trimestral') d.setMonth(d.getMonth() + 3);
        else if (ciclo === 'semestral') d.setMonth(d.getMonth() + 6);
        else if (ciclo === 'anual') d.setFullYear(d.getFullYear() + 1);
        else break;
    }
    return d;
}

function getPrevBill(nextBillDate, ciclo) {
    let d = new Date(nextBillDate);
    if (ciclo === 'mensual') d.setMonth(d.getMonth() - 1);
    else if (ciclo === 'trimestral') d.setMonth(d.getMonth() - 3);
    else if (ciclo === 'semestral') d.setMonth(d.getMonth() - 6);
    else if (ciclo === 'anual') d.setFullYear(d.getFullYear() - 1);
    return d;
}

function calculateMonthlyCost(cantidad, ciclo) {
    if (ciclo === 'mensual') return cantidad;
    if (ciclo === 'trimestral') return cantidad / 3;
    if (ciclo === 'semestral') return cantidad / 6;
    if (ciclo === 'anual') return cantidad / 12;
    return cantidad;
}

function formatCurrency(num) {
    return (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCategoryGuess(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('netflix') || n.includes('hbo') || n.includes('disney') || n.includes('prime') || n.includes('youtube') || n.includes('apple') || n.includes('infuse') || n.includes('iptv') || n.includes('tinymedia')) return "MULTIMEDIA";
    if (n.includes('spotify') || n.includes('apple music') || n.includes('tidal') || n.includes('deezer') || n.includes('amazon music')) return "MÚSICA";
    if (n.includes('gym') || n.includes('equinox') || n.includes('fitness') || n.includes('strava')) return "SALUD Y FITNESS";
    if (n.includes('icloud') || n.includes('google') || n.includes('dropbox') || n.includes('aws') || n.includes('heroku') || n.includes('adobe') || n.includes('photoshop') || n.includes('chatgpt') || n.includes('gemini') || n.includes('bitwarden') || n.includes('nordvpn') || n.includes('retouch') || n.includes('parcel')) return "HERRAMIENTAS";
    return "GENERAL";
}

// RENDERIZADO PRINCIPAL
function renderHome() {
    let totalMensual = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const oneWeek = new Date(today);
    oneWeek.setDate(today.getDate() + 7);

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const groups = {
        'esta-semana': { label: 'ESTA SEMANA', total: 0, items: [] },
        'este-mes': { label: 'ESTE MES', total: 0, items: [] },
        'mas-tarde': { label: 'MÁS TARDE', total: 0, items: [] }
    };

    suscripciones.forEach(sub => {
        // Only count and show active subscriptions
        if (sub.estado === 'cancelada') return;

        let cantidad = parseFloat(sub.cantidad || 0);
        totalMensual += calculateMonthlyCost(cantidad, sub.ciclo);

        let nextBill = getNextBill(sub.primeraFactura || sub.created, sub.ciclo || 'mensual');
        sub._nextBill = nextBill;

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

    document.getElementById('total-monthly-spend').textContent = `-${formatCurrency(totalMensual)}${currentCurrency}`;

    const container = document.getElementById('subs-list-container');
    container.innerHTML = '';

    let totalRendered = 0;

    Object.keys(groups).forEach(key => {
        const group = groups[key];
        if (group.items.length === 0) return;

        totalRendered += group.items.length;
        group.items.sort((a, b) => a._nextBill - b._nextBill);

        const headerHtml = `
            <div class="group-header">
                <span>${group.label}</span>
                <span class="right">TOTAL ${formatCurrency(group.total)}${currentCurrency}</span>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', headerHtml);

        group.items.forEach(sub => {
            const dateObj = sub._nextBill;
            const day = dateObj.getDate().toString().padStart(2, '0');
            const month = dateObj.toLocaleString('es-ES', { month: 'short' }).toUpperCase();

            const cat = getEffectiveCategory(sub);
            const logoPath = getSubscriptionLogoUrl(sub);

            const logoHtml = `
                <div class="logo-wrapper">
                    <div class="sub-logo-small" style="background: var(--hover); color: var(--text-color)">
                        ${logoPath ?
                    `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='var(--accent)'; this.parentElement.style.color='var(--accent-contrast)'">` :
                    `<span>${sub.nombre.charAt(0).toUpperCase()}</span>`}
                    </div>
                </div>
            `;

            const itemHtml = `
                <div class="sub-item" onclick="openDetails('${sub.id}')">
                    <div class="sub-date">
                        <strong>${day}</strong>
                        <span>${month}</span>
                    </div>
                    ${logoHtml}
                    <div class="sub-info">
                        <strong>${sub.nombre}</strong>
                        <span>${cat} • ${sub.ciclo.toUpperCase()}</span>
                    </div>
                    <div class="sub-price">${formatCurrency(sub.cantidad)}${currentCurrency}</div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHtml);
        });
    });

    if (totalRendered === 0) {
        if (searchQuery || selectedCategoryFilter !== 'all') {
            container.innerHTML = '<p class="hint" style="text-align: center; margin-top: 40px; padding: 20px;">No se encontraron suscripciones con este filtro.</p>';
        } else if (suscripciones.filter(s => s.estado !== 'cancelada').length === 0) {
            container.innerHTML = '<p class="hint" style="text-align: center; margin-top: 40px; padding: 20px;">No tienes suscripciones activas. Pulsa el botón + para añadir una.</p>';
        }
    }
}

function openDetails(id) {
    currentSub = suscripciones.find(s => s.id === id);
    if (!currentSub) return;

    const cat = getEffectiveCategory(currentSub);
    const nextBill = currentSub._nextBill || getNextBill(currentSub.primeraFactura, currentSub.ciclo);
    const prevBill = getPrevBill(nextBill, currentSub.ciclo);

    const logoPath = getSubscriptionLogoUrl(currentSub);
    const logoContainer = document.getElementById('det-logo');
    logoContainer.style.background = 'transparent';

    if (logoPath) {
        logoContainer.innerHTML = `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${currentSub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='var(--accent)'; this.parentElement.style.color='var(--accent-contrast)'">`;
        logoContainer.style.background = 'var(--hover)';
        logoContainer.style.color = 'var(--text-color)';
    } else {
        logoContainer.textContent = currentSub.nombre.charAt(0).toUpperCase();
        logoContainer.style.background = 'var(--accent)';
        logoContainer.style.color = 'var(--accent-contrast)';
    }

    document.getElementById('det-title').textContent = currentSub.nombre.toUpperCase();
    document.getElementById('det-price-val').textContent = `${formatCurrency(currentSub.cantidad)}${currentCurrency}`;

    let cycleSuffix = "/mes";
    if (currentSub.ciclo === 'trimestral') cycleSuffix = "/trim";
    if (currentSub.ciclo === 'semestral') cycleSuffix = "/sem";
    if (currentSub.ciclo === 'anual') cycleSuffix = "/año";
    document.getElementById('det-price-cyc').textContent = cycleSuffix;

    const annualCost = currentSub.ciclo === 'anual' ? currentSub.cantidad :
        currentSub.ciclo === 'mensual' ? currentSub.cantidad * 12 :
            currentSub.ciclo === 'trimestral' ? currentSub.cantidad * 4 :
                currentSub.cantidad * 2; // For semestral

    document.getElementById('det-annual').textContent = `${formatCurrency(annualCost)}${currentCurrency}`;
    document.getElementById('det-next').textContent = nextBill.toLocaleString('es-ES', { month: 'short', year: '2-digit' }).replace('.', ' ');
    document.getElementById('det-prev').textContent = prevBill.toLocaleString('es-ES', { month: 'short', year: '2-digit' }).replace('.', ' ');

    const startDate = new Date(currentSub.primeraFactura);
    document.getElementById('det-cat').textContent = startDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');

    const cancelBtn = document.getElementById('btn-cancel-sub');
    const statusPill = document.getElementById('det-status');

    if (currentSub.estado === 'cancelada') {
        cancelBtn.style.display = 'none';
        statusPill.innerHTML = '<div class="dot red-dot"></div> CANCELADA';
        statusPill.className = 'status-pill canceled-pill';
    } else {
        cancelBtn.style.display = 'flex';
        cancelBtn.innerHTML = 'CANCELAR SUSCRIPCIÓN <i data-lucide="x-circle"></i>';
        statusPill.innerHTML = '<div class="dot green-dot"></div> ACTIVA';
        statusPill.className = 'status-pill active-pill';
    }
    lucide.createIcons();

    showView('view-details');
}

async function cancelCurrentSub() {
    if (!currentSub) return;
    if (!confirm(`¿Estás seguro de que quieres cancelar la suscripción a ${currentSub.nombre}? Ya no aparecerá en tus próximos pagos.`)) return;

    try {
        await pb.collection('suscripciones').update(currentSub.id, { estado: 'cancelada' });
        showToast("Suscripción cancelada");
        await loadSuscripciones();
        showView('view-home');
    } catch (err) {
        alert("Error al cancelar: " + err.message);
    }
}

let activeCycle = 'mensual';
function setCycle(cycle) {
    activeCycle = cycle;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.querySelector(`.tab[data-cycle="${cycle}"]`);
    if (tabEl) tabEl.classList.add('active');
}

// Convertir una ruta local en File/Blob para guardarlo en PocketBase si es necesario
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
        return alert("Por favor completa los campos correctamente");
    }

    const formData = new FormData();
    formData.append('nombre', name);
    formData.append('cantidad', amount);
    formData.append('ciclo', activeCycle);
    formData.append('primeraFactura', date + " 12:00:00.000Z");
    formData.append('user', pb.authStore.model.id);
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
            console.warn("No se pudo adjuntar el logo predefinido como archivo:", e);
        }
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

        await loadSuscripciones();
        showView('view-home');
    } catch (err) {
        alert("Error guardando datos: " + err.message);
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
    document.getElementById('add-date').value = (currentSub.primeraFactura || "").split(" ")[0] || getTodayDateString();

    const catSelect = document.getElementById('add-category');
    if (catSelect) {
        catSelect.value = currentSub.categoria || 'AUTO';
    }

    selectedPresetLogo = null;
    document.querySelectorAll('.preset-logo-item').forEach(el => el.classList.remove('selected'));

    const preview = document.getElementById('logo-preview-img');
    const logoUrl = getSubscriptionLogoUrl(currentSub);
    if (logoUrl) {
        preview.innerHTML = `<img src="${logoUrl}">`;
        document.getElementById('btn-clear-logo').style.display = 'inline-block';
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
        document.getElementById('btn-clear-logo').style.display = 'none';
        lucide.createIcons();
    }

    setCycle(currentSub.ciclo || 'mensual');
    showView('view-add');
}

async function deleteCurrentSub() {
    if (!currentSub) return;
    if (!confirm(`¿Eliminar la suscripción a ${currentSub.nombre}?`)) return;

    try {
        await pb.collection('suscripciones').delete(currentSub.id);
        showToast("Suscripción eliminada");
        await loadSuscripciones();
        showView('view-home');
    } catch (err) {
        alert("Error eliminando: " + err.message);
    }
}

// ESTADÍSTICAS Y DESGLOSE POR CATEGORÍA
function renderStats() {
    const activeSubs = suscripciones.filter(s => s.estado !== 'cancelada');

    if (activeSubs.length === 0) {
        document.getElementById('stats-total-monthly').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-total-annual').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-sub-count').textContent = suscripciones.length;
        document.getElementById('stats-active-count').textContent = '0';
        document.getElementById('stats-canceled-count').textContent = suscripciones.length;
        document.getElementById('stats-categories-container').innerHTML = '<p class="hint">No hay suscripciones activas</p>';
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

    // Render desgloses por categoría con barras de porcentaje
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
                        <strong>${cat}</strong>
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

    // Suscripción más barata y más cara
    renderSubCard('stats-cheapest-sub', cheapestSub, `${formatCurrency(calculateMonthlyCost(cheapestSub.cantidad, cheapestSub.ciclo))}${currentCurrency} al mes`);
    renderSubCard('stats-top-sub', topSub, `${formatCurrency(calculateMonthlyCost(topSub.cantidad, topSub.ciclo))}${currentCurrency} al mes`);

    // Más antigua y más reciente
    const sortedByDate = [...activeSubs].sort((a, b) => new Date(a.primeraFactura) - new Date(b.primeraFactura));
    const oldestSub = sortedByDate[0];
    const newestSub = sortedByDate[sortedByDate.length - 1];

    const oldestDate = new Date(oldestSub.primeraFactura).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');
    const newestDate = new Date(newestSub.primeraFactura).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');

    renderSubCard('stats-oldest-sub', oldestSub, `Primer pago: ${oldestDate}`);
    renderSubCard('stats-newest-sub', newestSub, `Primer pago: ${newestDate}`);
}

function renderSubCard(containerId, sub, footerText) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!sub) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; padding: 10px;">No hay datos</p>';
        return;
    }

    const logoPath = getSubscriptionLogoUrl(sub);

    container.innerHTML = `
        <div class="top-sub-card">
            <div class="sub-logo-small" style="background: var(--hover); color: var(--text-color)">
                ${logoPath ?
            `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='var(--accent)'; this.parentElement.style.color='var(--accent-contrast)'">` :
            sub.nombre.charAt(0).toUpperCase()}
            </div>
            <div class="sub-info">
                <strong>${sub.nombre}</strong>
                <span>${footerText}</span>
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

function exportData() {
    if (suscripciones.length === 0) return alert("No hay datos para exportar");
    let csv = "Nombre,Cantidad,Ciclo,Categoria,Estado,Primera Factura\n";
    suscripciones.forEach(s => {
        csv += `"${s.nombre}",${s.cantidad},${s.ciclo},"${getEffectiveCategory(s)}","${s.estado || 'activa'}",${(s.primeraFactura || '').split(' ')[0]}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suscripciones_export_${getTodayDateString()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

async function logout() {
    if (!confirm("¿Cerrar sesión?")) return;
    pb.authStore.clear();
    location.reload();
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; }, 3000);
}
