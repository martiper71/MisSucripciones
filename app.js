// CONFIGURACION Y ESTADO
const PB_URL = 'https://martiperpocketbase.duckdns.org';
const pb = new PocketBase(PB_URL);

let suscripciones = [];
let currentSub = null;
let currentCurrency = localStorage.getItem('suscripciones_currency') || '€';

// INICIO APP
window.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    }

    // Initial UI state
    document.getElementById('currency-symbol-add').textContent = currentCurrency;
    document.getElementById('settings-currency').value = currentCurrency;

    if (pb.authStore.isValid) {
        showView('view-home');
        await loadSuscripciones();
    } else {
        showView('auth-container');
    }
});

// NAVEGACIÓN
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    // Update Bottom Nav active state
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (viewId === 'view-home') {
        document.getElementById('nav-home').classList.add('active');
        document.getElementById('nav-home-stats').classList.add('active');
    } else if (viewId === 'view-stats') {
        document.getElementById('nav-stats').classList.add('active');
        document.getElementById('nav-stats-stats').classList.add('active');
    }

    // Trigger resize or specific loaders
    if (viewId === 'view-home' && pb.authStore.isValid) {
        loadSuscripciones();
    }
    if (viewId === 'view-stats') {
        renderStats();
    }
}

function showAdd() {
    currentSub = null;
    document.getElementById('add-modal-title').textContent = 'NUEVA SUSCRIPCIÓN';
    document.getElementById('add-name').value = '';
    document.getElementById('add-amount').value = '';
    document.getElementById('add-date').value = getTodayDateString();

    // Reset logo upload
    document.getElementById('logo-file-input').value = '';
    document.getElementById('logo-preview-img').innerHTML = '<i data-lucide="image"></i>';
    lucide.createIcons();

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
        const cat = getCategoryGuess(sub.nombre);
        let logoPath = '';
        if (sub.logo) {
            logoPath = `${PB_URL}/api/files/${sub.collectionId}/${sub.id}/${sub.logo}`;
        }

        const logoHtml = `
            <div class="logo-wrapper">
                <div class="sub-logo-small" style="background: #f4f4f4; color: #000; filter: grayscale(1); opacity: 0.6;">
                    ${logoPath ?
                `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='#000'; this.parentElement.style.color='#fff'">` :
                `<span>${sub.nombre.charAt(0).toUpperCase()}</span>`}
                </div>
            </div>
        `;

        const itemHtml = `
            <div class="sub-item" onclick="openDetails('${sub.id}')" style="opacity: 0.8;">
                <div class="sub-date" style="display: none;"></div>
                ${logoHtml}
                <div class="sub-info" style="margin-left: 0;">
                    <strong style="color: #666;">${sub.nombre}</strong>
                    <span style="color: #999;">${cat} • CANCELADA</span>
                </div>
                <div class="sub-price" style="color: #999; text-decoration: line-through;">${formatCurrency(sub.cantidad)}${currentCurrency}</div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
    });

    showView('view-canceled');
    lucide.createIcons();
}

function previewSelectedFile() {
    const file = document.getElementById('logo-file-input').files[0];
    const preview = document.getElementById('logo-preview-img');

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<img src="${e.target.result}">`;
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
        lucide.createIcons();
    }
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
        renderHome();
    } catch (err) {
        console.error("Error cargando suscripciones:", err);
        if (err.status === 404) {
            // Collection might not exist yet
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
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCategoryGuess(name) {
    const n = name.toLowerCase();
    if (n.includes('netflix') || n.includes('hbo') || n.includes('disney') || n.includes('prime') || n.includes('youtube') || n.includes('apple')) return "MULTIMEDIA";
    if (n.includes('spotify') || n.includes('apple music') || n.includes('tidal')) return "MÚSICA";
    if (n.includes('gym') || n.includes('equinox') || n.includes('fitness')) return "SALUD Y FITNESS";
    if (n.includes('icloud') || n.includes('google') || n.includes('dropbox') || n.includes('aws') || n.includes('heroku') || n.includes('adobe')) return "HERRAMIENTAS";
    return "GENERAL";
}

// RENDERIZADO
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

    Object.keys(groups).forEach(key => {
        const group = groups[key];
        if (group.items.length === 0) return;

        // Sort items closely approaching
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

            // Assign dot color
            let dotClass = 'dot-gray';
            const diffDays = (dateObj - today) / (1000 * 60 * 60 * 24);
            if (diffDays <= 3) dotClass = 'dot-red';
            else if (diffDays <= 7) dotClass = 'dot-orange';

            const cat = getCategoryGuess(sub.nombre);

            let logoPath = '';
            if (sub.logo) {
                logoPath = `${PB_URL}/api/files/${sub.collectionId}/${sub.id}/${sub.logo}`;
            }

            const logoHtml = `
                <div class="logo-wrapper">
                    <div class="sub-logo-small" style="background: #f4f4f4; color: #000">
                        ${logoPath ?
                    `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='#000'; this.parentElement.style.color='#fff'">` :
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
}

function openDetails(id) {
    currentSub = suscripciones.find(s => s.id === id);
    if (!currentSub) return;

    const cat = getCategoryGuess(currentSub.nombre);
    const nextBill = currentSub._nextBill || getNextBill(currentSub.primeraFactura, currentSub.ciclo);
    const prevBill = getPrevBill(nextBill, currentSub.ciclo);

    let logoPath = '';
    if (currentSub.logo) {
        logoPath = `${PB_URL}/api/files/${currentSub.collectionId}/${currentSub.id}/${currentSub.logo}`;
    }

    const logoContainer = document.getElementById('det-logo');
    logoContainer.style.background = 'transparent';

    if (logoPath) {
        logoContainer.innerHTML = `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${currentSub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='#000'; this.parentElement.style.color='#fff'">`;
        logoContainer.style.background = '#f0f0f0';
        logoContainer.style.color = '#000';
    } else {
        logoContainer.textContent = currentSub.nombre.charAt(0).toUpperCase();
        logoContainer.style.background = '#000';
        logoContainer.style.color = '#fff';
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
    document.querySelector(`.tab[data-cycle="${cycle}"]`).classList.add('active');
}

async function saveSubscription() {
    const name = document.getElementById('add-name').value.trim();
    const amount = parseFloat(document.getElementById('add-amount').value);
    const date = document.getElementById('add-date').value;

    if (!name || isNaN(amount) || amount < 0 || !date) {
        return alert("Por favor completa los campos correctamente");
    }

    const formData = new FormData();
    formData.append('nombre', name);
    formData.append('cantidad', amount);
    formData.append('ciclo', activeCycle);
    formData.append('primeraFactura', date + " 12:00:00.000Z");
    formData.append('user', pb.authStore.model.id);
    if (!currentSub) {
        formData.append('estado', 'activa');
    }

    const logoFile = document.getElementById('logo-file-input').files[0];
    if (logoFile) {
        formData.append('logo', logoFile);
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

    const preview = document.getElementById('logo-preview-img');
    if (currentSub.logo) {
        const logoPath = `${PB_URL}/api/files/${currentSub.collectionId}/${currentSub.id}/${currentSub.logo}`;
        preview.innerHTML = `<img src="${logoPath}">`;
    } else {
        preview.innerHTML = '<i data-lucide="image"></i>';
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

function renderStats() {
    if (suscripciones.length === 0) {
        document.getElementById('stats-total-monthly').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-total-annual').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-sub-count').textContent = '0';
        document.getElementById('stats-categories-container').innerHTML = '<p class="hint">No hay datos suficientes</p>';
        document.getElementById('stats-top-sub').innerHTML = '';
        return;
    }

    let totalMonthly = 0;
    let totalAnnual = 0;

    // Solo estadísticas de suscripciones activas
    const activeSubs = suscripciones.filter(s => s.estado !== 'cancelada');

    if (activeSubs.length === 0) {
        document.getElementById('stats-total-monthly').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-total-annual').textContent = `0.00${currentCurrency}`;
        document.getElementById('stats-sub-count').textContent = '0';
        document.getElementById('stats-cheapest-sub').innerHTML = '';
        document.getElementById('stats-top-sub').innerHTML = '';
        document.getElementById('stats-oldest-sub').innerHTML = '';
        document.getElementById('stats-newest-sub').innerHTML = '';
        return;
    }

    let topSub = activeSubs[0];
    let topMonthlyVal = 0;
    let cheapestSub = activeSubs[0];
    let cheapestMonthlyVal = Infinity;

    activeSubs.forEach(sub => {
        const monthlyCost = calculateMonthlyCost(sub.cantidad, sub.ciclo);
        totalMonthly += monthlyCost;

        if (monthlyCost > topMonthlyVal) {
            topMonthlyVal = monthlyCost;
            topSub = sub;
        }
        if (monthlyCost < cheapestMonthlyVal) {
            cheapestMonthlyVal = monthlyCost;
            cheapestSub = sub;
        }
    });

    totalAnnual = totalMonthly * 12;

    document.getElementById('stats-total-monthly').textContent = `${formatCurrency(totalMonthly)}${currentCurrency}`;
    document.getElementById('stats-total-annual').textContent = `${formatCurrency(totalAnnual)}${currentCurrency}`;

    // Contadores detallados
    document.getElementById('stats-sub-count').textContent = suscripciones.length;
    document.getElementById('stats-active-count').textContent = activeSubs.length;
    document.getElementById('stats-canceled-count').textContent = suscripciones.length - activeSubs.length;

    // Find Oldest and Newest (only among active ones)
    const sortedByDate = [...activeSubs].sort((a, b) => new Date(a.primeraFactura) - new Date(b.primeraFactura));
    const oldestSub = sortedByDate[0];
    const newestSub = sortedByDate[sortedByDate.length - 1];

    function renderSubCard(containerId, sub, footerText) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!sub) {
            container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; padding: 10px;">No hay datos</p>';
            return;
        }

        let logoPath = '';
        if (sub.logo) {
            logoPath = `${PB_URL}/api/files/${sub.collectionId}/${sub.id}/${sub.logo}`;
        }

        container.innerHTML = `
            <div class="top-sub-card">
                <div class="sub-logo-small" style="background: #f4f4f4; color: #000">
                    ${logoPath ?
                `<img src="${logoPath}" onerror="this.style.display='none'; this.parentElement.textContent='${sub.nombre.charAt(0).toUpperCase()}'; this.parentElement.style.background='#000'; this.parentElement.style.color='#fff'">` :
                sub.nombre.charAt(0).toUpperCase()}
                </div>
                <div class="sub-info">
                    <strong>${sub.nombre}</strong>
                    <span>${footerText}</span>
                </div>
            </div>
        `;
    }

    renderSubCard('stats-cheapest-sub', cheapestSub, `${formatCurrency(calculateMonthlyCost(cheapestSub.cantidad, cheapestSub.ciclo))}${currentCurrency} al mes`);
    renderSubCard('stats-top-sub', topSub, `${formatCurrency(calculateMonthlyCost(topSub.cantidad, topSub.ciclo))}${currentCurrency} al mes`);

    // Formatear fechas para los otros dos
    const oldestDate = new Date(oldestSub.primeraFactura).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');
    const newestDate = new Date(newestSub.primeraFactura).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');

    renderSubCard('stats-oldest-sub', oldestSub, `Primer pago: ${oldestDate}`);
    renderSubCard('stats-newest-sub', newestSub, `Primer pago: ${newestDate}`);
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
    let csv = "Nombre,Cantidad,Ciclo,Primera Factura\n";
    suscripciones.forEach(s => {
        csv += `"${s.nombre}",${s.cantidad},${s.ciclo},${s.primeraFactura.split(' ')[0]}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
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
