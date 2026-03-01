// CONFIGURACION Y ESTADO
const PB_URL = 'https://martiperpocketbase.duckdns.org';
const pb = new PocketBase(PB_URL);

let suscripciones = [];
let currentSub = null;
let currentCurrency = localStorage.getItem('suscripciones_currency') || '$';

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

    // Trigger resize or specific loaders
    if (viewId === 'view-home' && pb.authStore.isValid) loadSuscripciones();
}

function showAdd() {
    currentSub = null;
    document.getElementById('add-modal-title').textContent = 'NUEVA SUSCRIPCIÓN';
    document.getElementById('add-name').value = '';
    document.getElementById('add-amount').value = '';
    document.getElementById('add-date').value = getTodayDateString();
    document.getElementById('add-logo').value = '';
    updateLogoPreview();
    setCycle('mensual');
    showView('view-add');
}

document.getElementById('add-logo').addEventListener('input', updateLogoPreview);
document.getElementById('add-name').addEventListener('input', updateLogoPreview);

function updateLogoPreview() {
    const url = document.getElementById('add-logo').value.trim();
    const preview = document.getElementById('preview-logo');
    const name = document.getElementById('add-name').value.trim();

    if (url) {
        preview.innerHTML = `<img src="${url}" onerror="this.outerHTML='${name ? name.charAt(0).toUpperCase() : '?'}'">`;
    } else {
        preview.textContent = name ? name.charAt(0).toUpperCase() : 'N';
    }
}

function autoBuscarLogo() {
    const name = document.getElementById('add-name').value.trim();
    if (!name) return alert("Escribe primero el nombre del servicio");

    let domain = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (domain === 'adobecc' || domain === 'adobe') domain = 'adobe';
    if (domain === 'icloud') domain = 'apple';

    const url = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}.com&size=128`;
    document.getElementById('add-logo').value = url;
    updateLogoPreview();
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
        else if (ciclo === 'anual') d.setFullYear(d.getFullYear() + 1);
        else if (ciclo === 'semanal') d.setDate(d.getDate() + 7);
        else break;
    }
    return d;
}

function getPrevBill(nextBillDate, ciclo) {
    let d = new Date(nextBillDate);
    if (ciclo === 'mensual') d.setMonth(d.getMonth() - 1);
    else if (ciclo === 'anual') d.setFullYear(d.getFullYear() - 1);
    else if (ciclo === 'semanal') d.setDate(d.getDate() - 7);
    return d;
}

function calculateMonthlyCost(cantidad, ciclo) {
    if (ciclo === 'mensual') return cantidad;
    if (ciclo === 'anual') return cantidad / 12;
    if (ciclo === 'semanal') return cantidad * 4.3333; // Avg weeks in month
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

    const twoWeeks = new Date(today);
    twoWeeks.setDate(today.getDate() + 14);

    const groups = {
        'esta-semana': { label: 'ESTA SEMANA', total: 0, items: [] },
        'proxima-semana': { label: 'PRÓXIMA SEMANA', total: 0, items: [] },
        'mas-tarde': { label: 'MÁS TARDE', total: 0, items: [] }
    };

    suscripciones.forEach(sub => {
        let cantidad = parseFloat(sub.cantidad || 0);
        totalMensual += calculateMonthlyCost(cantidad, sub.ciclo);

        let nextBill = getNextBill(sub.primeraFactura || sub.created, sub.ciclo || 'mensual');
        sub._nextBill = nextBill;

        if (nextBill <= oneWeek) {
            groups['esta-semana'].items.push(sub);
            groups['esta-semana'].total += cantidad;
        } else if (nextBill <= twoWeeks) {
            groups['proxima-semana'].items.push(sub);
            groups['proxima-semana'].total += cantidad;
        } else {
            groups['mas-tarde'].items.push(sub);
            groups['mas-tarde'].total += cantidad;
        }
    });

    document.getElementById('total-monthly-spend').textContent = `-${currentCurrency}${formatCurrency(totalMensual)}`;

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
                <span class="right">TOTAL ${currentCurrency}${formatCurrency(group.total)}</span>
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

            let logoHtml = `<div class="sub-dot ${dotClass}"></div>`;
            if (sub.logoUrl) {
                logoHtml = `
                    <div class="sub-logo-small">
                        <img src="${sub.logoUrl}" onerror="this.outerHTML=''">
                    </div>
                `;
            }

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
                    <div class="sub-price">${currentCurrency}${formatCurrency(sub.cantidad)}</div>
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

    const logoContainer = document.getElementById('det-logo');
    if (currentSub.logoUrl) {
        logoContainer.innerHTML = `<img src="${currentSub.logoUrl}" onerror="this.outerHTML='${currentSub.nombre.charAt(0).toUpperCase()}'">`;
    } else {
        logoContainer.textContent = currentSub.nombre.charAt(0).toUpperCase();
    }
    document.getElementById('det-title').textContent = currentSub.nombre.toUpperCase();
    document.getElementById('det-price-val').textContent = `${currentCurrency}${formatCurrency(currentSub.cantidad)}`;

    let cycleSuffix = "/mes";
    if (currentSub.ciclo === 'anual') cycleSuffix = "/año";
    if (currentSub.ciclo === 'semanal') cycleSuffix = "/sem";
    document.getElementById('det-price-cyc').textContent = cycleSuffix;

    const annualCost = currentSub.ciclo === 'anual' ? currentSub.cantidad :
        currentSub.ciclo === 'mensual' ? currentSub.cantidad * 12 :
            currentSub.cantidad * 52;

    document.getElementById('det-annual').textContent = `${currentCurrency}${formatCurrency(annualCost)}`;

    document.getElementById('det-next').textContent = nextBill.toLocaleString('es-ES', { month: 'short', year: '2-digit' }).replace('.', ' ');
    document.getElementById('det-prev').textContent = prevBill.toLocaleString('es-ES', { month: 'short', year: '2-digit' }).replace('.', ' ');

    document.getElementById('det-cat').textContent = cat;

    showView('view-details');
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

    const data = {
        nombre: name,
        cantidad: amount,
        ciclo: activeCycle,
        primeraFactura: date + " 12:00:00.000Z", // Append time for PB format
        logoUrl: document.getElementById('add-logo').value.trim(),
        user: pb.authStore.model.id
    };

    const btn = document.getElementById('btn-save');
    btn.textContent = "Guardando...";
    btn.disabled = true;

    try {
        if (currentSub) {
            await pb.collection('suscripciones').update(currentSub.id, data);
            showToast("Suscripción actualizada");
        } else {
            await pb.collection('suscripciones').create(data);
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
    document.getElementById('add-logo').value = currentSub.logoUrl || "";
    updateLogoPreview();
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

async function deleteAllData() {
    if (!confirm("Esto borrará permanentemente todas tus suscripciones. ¿ESTÁS SEGURO?")) return;
    if (!confirm("Esta acción no se puede deshacer. Última advertencia.")) return;

    try {
        for (const sub of suscripciones) {
            await pb.collection('suscripciones').delete(sub.id);
        }
        showToast("Todo eliminado");
        await loadSuscripciones();
    } catch (err) {
        alert("Error borrando datos: " + err.message);
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; }, 3000);
}
