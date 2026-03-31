// ============================================================
//  РІО-ТРАНС — app.js (повна версія: Замовлення, Водії, Автопарк)
// ============================================================

/* ===== СТАН ===== */
let currentTariffs   = [];
let currentDrivers   = [];
let currentTrucks    = [];
let currentOrders    = [];
let cargoes          = [];
let historyData      = [];
let ordersData       = [];
let chartRoutes=null, chartCargo=null, chartTimeline=null, chartOrdersStatus=null;
let pendingDeleteId=null, pendingDeleteType=null, lastCalcResult=null;

/* ===== НАВІГАЦІЯ ===== */
function switchTab(tabId, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    if (el) el.classList.add('active');
    const loaders = { tariffs:'loadTariffsTable', history:'loadHistory', dashboard:'loadDashboard',
        calculator:'loadTariffsForSelect', map:'loadMap', orders:'loadOrders',
        drivers:'loadDriversTable', trucks:'loadTrucksTable' };
    if (loaders[tabId]) window[loaders[tabId]]();
    document.getElementById('sidebar').classList.remove('open');
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

/* ===== УТИЛІТИ ===== */
function showToast(msg, type='success') {
    const t = document.getElementById('appToast');
    t.className = `toast align-items-center border-0 toast-${type}`;
    document.getElementById('toastMsg').textContent = msg;
    new bootstrap.Toast(t, { delay: 3500 }).show();
}
function fmt(num) { return Number(num).toLocaleString('uk-UA'); }
function formatDate(str) {
    return new Date(str).toLocaleString('uk-UA', { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' });
}
function formatDateOnly(str) {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('uk-UA', { day:'2-digit',month:'2-digit',year:'numeric' });
}
function badgeHTML(type) {
    const m = {'Звичайний':'badge-normal','ADR':'badge-adr','Великогабаритний':'badge-oversized'};
    return `<span class="badge-type ${m[type]||'badge-normal'}">${type}</span>`;
}
function orderStatusBadge(s) {
    const cfg = {
        new:       {cls:'badge-new',      label:'Нове'},
        confirmed: {cls:'badge-confirmed', label:'Підтверджено'},
        in_transit:{cls:'badge-transit',   label:'В дорозі'},
        delivered: {cls:'badge-delivered', label:'Доставлено'},
        cancelled: {cls:'badge-cancelled', label:'Скасовано'},
    };
    const c = cfg[s] || {cls:'badge-normal', label:s};
    return `<span class="badge-type ${c.cls}">${c.label}</span>`;
}
function driverStatusBadge(s) {
    const cfg = { active:{cls:'badge-delivered',label:'Активний'}, vacation:{cls:'badge-confirmed',label:'Відпустка'},
        sick:{cls:'badge-new',label:'Лікарняний'}, fired:{cls:'badge-cancelled',label:'Звільнений'} };
    const c = cfg[s] || {cls:'badge-normal',label:s};
    return `<span class="badge-type ${c.cls}">${c.label}</span>`;
}
function truckStatusBadge(s) {
    const cfg = { available:{cls:'badge-delivered',label:'Вільна'}, on_route:{cls:'badge-transit',label:'В дорозі'},
        service:{cls:'badge-confirmed',label:'Обслуговування'}, retired:{cls:'badge-cancelled',label:'Списана'} };
    const c = cfg[s] || {cls:'badge-normal',label:s};
    return `<span class="badge-type ${c.cls}">${c.label}</span>`;
}

/* ===== КАЛЬКУЛЯТОР ===== */
async function loadTariffsForSelect() {
    try {
        const data = await apiFetch('get_tariffs');
        currentTariffs = data;
        const sel = document.getElementById('tariffSelect');
        sel.innerHTML = '<option value="">— Оберіть маршрут —</option>';
        data.forEach(t => {
            const o = document.createElement('option');
            o.value = t.id;
            o.textContent = `${t.from_city} → ${t.to_city}  (${fmt(t.distance_km)} км · €${t.base_rate}/км)`;
            sel.appendChild(o);
        });
    } catch(e) { showToast('Помилка завантаження маршрутів', 'error'); }
}

async function calculateCost() {
    const sel = document.getElementById('tariffSelect');
    const tariff = currentTariffs.find(t => t.id == sel.value);
    if (!tariff) { showToast('Оберіть маршрут!', 'error'); return; }
    const weight = parseFloat(document.getElementById('weight').value);
    const volume = parseFloat(document.getElementById('volume').value);
    const cargo_type = document.getElementById('cargoType').value;
    const insurance  = document.getElementById('insurance').checked;
    const escort     = document.getElementById('escort').checked;
    if (!weight || weight <= 0) { showToast('Введіть коректну вагу', 'error'); return; }
    if (!volume || volume <= 0) { showToast('Введіть коректний об\'єм', 'error'); return; }

    const btn = document.getElementById('calcBtn');
    btn.classList.add('loading'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Розрахунок...';
    ['hintPanel','errorPanel','resultPanel'].forEach(id => document.getElementById(id).style.display='none');

    try {
        const result = await apiPost('calculate', { from_city:tariff.from_city, to_city:tariff.to_city, weight, volume, cargo_type, insurance, escort });
        if (result.success) {
            document.getElementById('resRoute').textContent = result.route;
            document.getElementById('resBase').textContent  = `${fmt(result.cost)} €`;
            document.getElementById('resDays').textContent  = `${result.days} днів`;
            document.getElementById('resFinal').textContent = `${fmt(result.final_cost)} €`;
            document.getElementById('resultPanel').style.display = 'block';
            lastCalcResult = { ...result, cargo_type, insurance, escort };
            showToast('Розрахунок виконано!');
        } else {
            document.getElementById('errorMsg').textContent = result.error || 'Невідома помилка';
            document.getElementById('errorPanel').style.display = 'block';
        }
    } catch(e) {
        document.getElementById('errorMsg').textContent = 'Помилка з\'єднання з сервером';
        document.getElementById('errorPanel').style.display = 'block';
    } finally {
        btn.classList.remove('loading'); btn.innerHTML = '<i class="fas fa-bolt"></i> Розрахувати вартість';
    }
}

function saveResultPDF() {
    if (!lastCalcResult) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF(); const r = lastCalcResult;
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.text('RIO-TRANS',20,22);
    doc.setFont('helvetica','normal'); doc.setFontSize(12);
    doc.text('Rozrakhunok vartosti perevezennia',20,32);
    doc.text(`Data: ${new Date().toLocaleString('uk-UA')}`,20,40);
    doc.line(20,44,190,44); doc.setFontSize(11);
    doc.text(`Marshrut:       ${r.route}`,20,54);
    doc.text(`Bazova vartist: ${r.cost} EUR`,20,63);
    doc.text(`Termin:         ${r.days} dniv`,20,72);
    doc.text(`Strakhuvannia:  ${r.insurance?'Tak (+2%)':'Ni'}`,20,81);
    doc.text(`Suprovodzh.:    ${r.escort?'Tak (+5%)':'Ni'}`,20,90);
    doc.setFont('helvetica','bold'); doc.setFontSize(16);
    doc.text(`Final vartist: ${r.final_cost} EUR`,20,104);
    doc.save(`rio-trans-calc-${new Date().toISOString().slice(0,10)}.pdf`);
    showToast('PDF збережено!');
}

function createOrderFromCalc() {
    if (!lastCalcResult) return;
    switchTab('orders', document.querySelector('[onclick*="orders"]'));
    setTimeout(() => {
        openOrderModal();
        document.getElementById('modalOrderRoute').value = lastCalcResult.route;
        document.getElementById('modalOrderCargo').value = lastCalcResult.cargo_type;
        document.getElementById('modalOrderWeight').value = document.getElementById('weight').value;
        document.getElementById('modalOrderVol').value    = document.getElementById('volume').value;
        document.getElementById('modalOrderCost').value   = lastCalcResult.final_cost;
    }, 300);
}

/* ===== ПЛАНУВАЛЬНИК ===== */
function addCargo() {
    const w=parseFloat(document.getElementById('pWeight').value);
    const v=parseFloat(document.getElementById('pVolume').value);
    const n=document.getElementById('pName').value.trim()||`Вантаж ${cargoes.length+1}`;
    if(!w||w<=0||!v||v<=0){showToast('Введіть вагу та об\'єм','error');return;}
    cargoes.push({weight:w,volume:v,name:n});
    document.getElementById('pName').value='';
    renderCargoTable(); updatePlannerResult();
}
function removeCargo(i){cargoes.splice(i,1);renderCargoTable();updatePlannerResult();}
function clearCargoes(){cargoes=[];renderCargoTable();updatePlannerResult();}
function renderCargoTable(){
    const tb=document.getElementById('cargoTbody');
    if(!cargoes.length){tb.innerHTML='<tr><td colspan="5" class="text-center py-4" style="color:var(--text3)">Вантажів ще немає</td></tr>';return;}
    tb.innerHTML=cargoes.map((c,i)=>`<tr><td>${i+1}</td><td>${c.name}</td><td>${fmt(c.weight)} кг</td><td>${c.volume} м³</td><td><button class="btn-tbl btn-tbl-del" onclick="removeCargo(${i})"><i class="fas fa-trash"></i></button></td></tr>`).join('');
}
function updatePlannerResult(){
    const tw=cargoes.reduce((s,c)=>s+c.weight,0), tv=cargoes.reduce((s,c)=>s+c.volume,0);
    const MW=20000,MV=86, wp=Math.min(tw/MW*100,100), vp=Math.min(tv/MV*100,100);
    const oW=tw>MW,oV=tv>MV;
    let st='';
    if(oW||oV){const e=Math.ceil(Math.max(tw/MW,tv/MV));st=`<div style="color:var(--red);font-weight:600;"><i class="fas fa-triangle-exclamation"></i> Перевищення! Потрібно ~${e} фур</div>`;}
    else if(wp>85||vp>85) st=`<div style="color:var(--orange);font-weight:600;"><i class="fas fa-check-circle"></i> FTL — майже повна фура</div>`;
    else if(!cargoes.length) st=`<div style="color:var(--text3)">Додайте вантажі</div>`;
    else st=`<div style="color:var(--green);font-weight:600;"><i class="fas fa-check-circle"></i> LTL — є вільне місце</div>`;
    const el=document.getElementById('plannerResult');
    el.style.display=cargoes.length?'block':'none';
    el.innerHTML=`<div class="panel-title">Підсумок</div>
        <div class="planner-bar-wrap"><div class="planner-bar-label"><span>Вага</span><strong>${fmt(tw)} кг / 20 000 кг (${wp.toFixed(1)}%)</strong></div><div class="planner-bar"><div class="planner-bar-fill ${oW?'bar-over':'bar-weight'}" style="width:${wp}%"></div></div></div>
        <div class="planner-bar-wrap"><div class="planner-bar-label"><span>Об'єм</span><strong>${tv} м³ / 86 м³ (${vp.toFixed(1)}%)</strong></div><div class="planner-bar"><div class="planner-bar-fill ${oV?'bar-over':'bar-volume'}" style="width:${vp}%"></div></div></div>
        <div class="mt-3" style="font-size:14px;">${st}</div>`;
}

/* ===== ТАРИФИ ===== */
async function loadTariffsTable(){
    const wrap=document.getElementById('tariffsTableWrap');
    wrap.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Завантаження...</div>';
    try{
        currentTariffs=await apiFetch('get_tariffs');
        if(!currentTariffs.length){wrap.innerHTML='<div class="loading-state">Тарифів ще немає.</div>';return;}
        wrap.innerHTML=`<table class="custom-table"><thead><tr><th>Маршрут</th><th>Відстань (км)</th><th>Ставка (€/км)</th><th>Орієнт. вартість (€)</th><th>Опис</th><th>Карта</th><th>Дії</th></tr></thead><tbody>
            ${currentTariffs.map(t=>`<tr>
                <td><strong>${t.from_city}</strong> → <strong>${t.to_city}</strong></td>
                <td>${fmt(t.distance_km)}</td><td>${t.base_rate}</td>
                <td>${fmt(Math.round(t.distance_km*t.base_rate))}</td>
                <td style="color:var(--text2);font-size:12px;">${t.description||'—'}</td>
                <td>${(t.lat_from&&t.lat_to)?'<i class="fas fa-check" style="color:var(--green)"></i>':'<i class="fas fa-xmark" style="color:var(--text3)"></i>'}</td>
                <td><div class="action-btns">
                    <button class="btn-tbl btn-tbl-edit" onclick="openTariffModal(${t.id})"><i class="fas fa-pen"></i></button>
                    <button class="btn-tbl btn-tbl-del"  onclick="confirmDelete('tariff',${t.id})"><i class="fas fa-trash"></i></button>
                </div></td></tr>`).join('')}
        </tbody></table>`;
    }catch(e){wrap.innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}
function openTariffModal(id=null){
    const m=new bootstrap.Modal(document.getElementById('tariffModal'));
    document.getElementById('tariffModalTitle').textContent=id?'Редагувати маршрут':'Додати маршрут';
    document.getElementById('modalTariffId').value=id||'';
    if(id){const t=currentTariffs.find(x=>x.id==id);if(t){document.getElementById('modalFrom').value=t.from_city;document.getElementById('modalTo').value=t.to_city;document.getElementById('modalDist').value=t.distance_km;document.getElementById('modalRate').value=t.base_rate;document.getElementById('modalDesc').value=t.description||'';}}
    else ['modalFrom','modalTo','modalDist','modalRate','modalDesc'].forEach(f=>document.getElementById(f).value='');
    m.show();
}
async function saveTariff(){
    const id=document.getElementById('modalTariffId').value;
    const from=document.getElementById('modalFrom').value.trim();
    const to=document.getElementById('modalTo').value.trim();
    const dist=parseFloat(document.getElementById('modalDist').value);
    const rate=parseFloat(document.getElementById('modalRate').value);
    const desc=document.getElementById('modalDesc').value.trim();
    if(!from||!to||!dist||!rate){showToast('Заповніть усі поля!','error');return;}
    try{
        const r=await apiPost(id?'update_tariff':'add_tariff',{id,from_city:from,to_city:to,distance_km:dist,base_rate:rate,description:desc});
        if(r.success){bootstrap.Modal.getInstance(document.getElementById('tariffModal')).hide();showToast(id?'Тариф оновлено!':'Тариф додано!');loadTariffsTable();loadTariffsForSelect();if(leafletMap){mapLayers.forEach(l=>leafletMap.removeLayer(l));mapLayers=[];}}
        else showToast(r.error||'Помилка','error');
    }catch(e){showToast('Помилка з\'єднання','error');}
}

/* ===== ЗАМОВЛЕННЯ ===== */
async function loadOrders(){
    const wrap=document.getElementById('ordersTableWrap');
    wrap.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Завантаження...</div>';
    try{
        ordersData=await apiFetch('get_orders');
        renderOrdersTable(ordersData);
        // Бейдж кількості нових
        const newCnt=ordersData.filter(o=>o.status==='new').length;
        const badge=document.getElementById('badgeOrders');
        if(badge) badge.textContent=newCnt>0?newCnt:'';
    }catch(e){wrap.innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}

function renderOrdersTable(data){
    const wrap=document.getElementById('ordersTableWrap');
    if(!data.length){wrap.innerHTML='<div class="loading-state">Замовлень ще немає. Натисніть «Нове замовлення».</div>';return;}
    wrap.innerHTML=`<table class="custom-table"><thead><tr>
        <th>№</th><th>Дата</th><th>Клієнт</th><th>Маршрут</th><th>Тип</th>
        <th>Вартість</th><th>Відправка</th><th>Доставка</th><th>Статус</th><th>Водій / Фура</th><th>Дії</th>
    </tr></thead><tbody>
    ${data.map(o=>`<tr>
        <td style="color:var(--text3)">${o.id}</td>
        <td style="color:var(--text3);white-space:nowrap;">${formatDate(o.created_at)}</td>
        <td><strong>${o.client_name}</strong>${o.client_phone?`<br><small style="color:var(--text3)">${o.client_phone}</small>`:''}</td>
        <td><strong>${o.route}</strong></td>
        <td>${badgeHTML(o.cargo_type)}</td>
        <td><strong style="color:var(--accent2);">${fmt(o.total_cost)} €</strong></td>
        <td style="color:var(--text3);white-space:nowrap;">${formatDateOnly(o.pickup_date)}</td>
        <td style="color:var(--text3);white-space:nowrap;">${formatDateOnly(o.delivery_date)}</td>
        <td>${orderStatusBadge(o.status)}</td>
        <td style="font-size:12px;color:var(--text2);">
            ${o.driver_name?`<i class="fas fa-id-card"></i> ${o.driver_name}<br>`:''}
            ${o.truck_plate?`<i class="fas fa-truck"></i> ${o.truck_plate}`:'—'}
        </td>
        <td><div class="action-btns">
            <button class="btn-tbl btn-tbl-edit" onclick="openOrderModal(${o.id})" title="Редагувати"><i class="fas fa-pen"></i></button>
            <button class="btn-tbl btn-tbl-del"  onclick="confirmDelete('order',${o.id})" title="Видалити"><i class="fas fa-trash"></i></button>
        </div></td>
    </tr>`).join('')}
    </tbody></table>`;
}

function applyOrdersFilter(){
    const q=document.getElementById('ordersSearch').value.toLowerCase();
    const st=document.getElementById('ordersStatusFilter').value;
    let f=[...ordersData];
    if(q) f=f.filter(o=>o.client_name.toLowerCase().includes(q)||o.route.toLowerCase().includes(q));
    if(st) f=f.filter(o=>o.status===st);
    renderOrdersTable(f);
}
function resetOrdersFilter(){
    document.getElementById('ordersSearch').value='';
    document.getElementById('ordersStatusFilter').value='';
    renderOrdersTable(ordersData);
}

async function openOrderModal(id=null){
    // Завантажити водіїв та фури для селектів
    const [drivers,trucks]=await Promise.all([
        currentDrivers.length?Promise.resolve(currentDrivers):apiFetch('get_drivers'),
        currentTrucks.length?Promise.resolve(currentTrucks):apiFetch('get_trucks'),
    ]);
    currentDrivers=drivers; currentTrucks=trucks;

    const dSel=document.getElementById('modalOrderDriver');
    const tSel=document.getElementById('modalOrderTruck');
    dSel.innerHTML='<option value="">— Без водія —</option>';
    drivers.filter(d=>d.status==='active').forEach(d=>{
        dSel.innerHTML+=`<option value="${d.id}">${d.full_name}${d.adr_cert?' (ADR)':''}</option>`;
    });
    tSel.innerHTML='<option value="">— Без фури —</option>';
    trucks.forEach(t=>{
        tSel.innerHTML+=`<option value="${t.id}">${t.plate} — ${t.model||'?'} [${t.status==='available'?'Вільна':'Зайнята'}]</option>`;
    });

    document.getElementById('orderModalTitle').textContent=id?'Редагувати замовлення':'Нове замовлення';
    document.getElementById('modalOrderId').value=id||'';

    if(id){
        const o=ordersData.find(x=>x.id==id);
        if(o){
            document.getElementById('modalOrderClient').value=o.client_name;
            document.getElementById('modalOrderPhone').value=o.client_phone||'';
            document.getElementById('modalOrderEmail').value=o.client_email||'';
            document.getElementById('modalOrderRoute').value=o.route;
            document.getElementById('modalOrderCargo').value=o.cargo_type;
            document.getElementById('modalOrderStatus').value=o.status;
            document.getElementById('modalOrderWeight').value=o.weight_kg;
            document.getElementById('modalOrderVol').value=o.volume_m3;
            document.getElementById('modalOrderCost').value=o.total_cost;
            document.getElementById('modalOrderPickup').value=o.pickup_date||'';
            document.getElementById('modalOrderDelivery').value=o.delivery_date||'';
            document.getElementById('modalOrderDriver').value=o.driver_id||'';
            document.getElementById('modalOrderTruck').value=o.truck_id||'';
            document.getElementById('modalOrderNotes').value=o.notes||'';
        }
    } else {
        ['modalOrderClient','modalOrderPhone','modalOrderEmail','modalOrderRoute','modalOrderNotes'].forEach(f=>document.getElementById(f).value='');
        document.getElementById('modalOrderCargo').value='Звичайний';
        document.getElementById('modalOrderStatus').value='new';
        document.getElementById('modalOrderWeight').value='0';
        document.getElementById('modalOrderVol').value='0';
        document.getElementById('modalOrderCost').value='0';
        document.getElementById('modalOrderPickup').value='';
        document.getElementById('modalOrderDelivery').value='';
        document.getElementById('modalOrderDriver').value='';
        document.getElementById('modalOrderTruck').value='';
    }
    new bootstrap.Modal(document.getElementById('orderModal')).show();
}

async function saveOrder(){
    const id=document.getElementById('modalOrderId').value;
    const data={
        id, client_name:document.getElementById('modalOrderClient').value.trim(),
        client_phone:document.getElementById('modalOrderPhone').value.trim(),
        client_email:document.getElementById('modalOrderEmail').value.trim(),
        route:document.getElementById('modalOrderRoute').value.trim(),
        cargo_type:document.getElementById('modalOrderCargo').value,
        status:document.getElementById('modalOrderStatus').value,
        weight_kg:parseInt(document.getElementById('modalOrderWeight').value)||0,
        volume_m3:parseFloat(document.getElementById('modalOrderVol').value)||0,
        total_cost:parseFloat(document.getElementById('modalOrderCost').value)||0,
        pickup_date:document.getElementById('modalOrderPickup').value,
        delivery_date:document.getElementById('modalOrderDelivery').value,
        driver_id:document.getElementById('modalOrderDriver').value||null,
        truck_id:document.getElementById('modalOrderTruck').value||null,
        notes:document.getElementById('modalOrderNotes').value.trim(),
    };
    if(!data.client_name||!data.route){showToast('Вкажіть клієнта та маршрут!','error');return;}
    try{
        const r=await apiPost(id?'update_order':'add_order',data);
        if(r.success){bootstrap.Modal.getInstance(document.getElementById('orderModal')).hide();showToast(id?'Замовлення оновлено!':'Замовлення додано!');loadOrders();}
        else showToast(r.error||'Помилка','error');
    }catch(e){showToast('Помилка з\'єднання','error');}
}

/* ===== ВОДІЇ ===== */
async function loadDriversTable(){
    const wrap=document.getElementById('driversTableWrap');
    wrap.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Завантаження...</div>';
    try{
        currentDrivers=await apiFetch('get_drivers');
        if(!currentDrivers.length){wrap.innerHTML='<div class="loading-state">Водіїв ще немає.</div>';return;}
        wrap.innerHTML=`<table class="custom-table"><thead><tr>
            <th>ПІБ</th><th>Телефон</th><th>Категорія</th><th>ADR</th><th>Статус</th>
            <th>Дата найму</th><th>Поточна фура</th><th>Дії</th>
        </tr></thead><tbody>
        ${currentDrivers.map(d=>`<tr>
            <td><strong>${d.full_name}</strong></td>
            <td>${d.phone}</td>
            <td><span class="badge-type badge-normal">${d.license_cat}</span></td>
            <td>${d.adr_cert?'<i class="fas fa-check" style="color:var(--green)"></i>':'<i class="fas fa-xmark" style="color:var(--text3)"></i>'}</td>
            <td>${driverStatusBadge(d.status)}</td>
            <td style="color:var(--text3)">${formatDateOnly(d.hired_date)}</td>
            <td style="font-size:12px;color:var(--text2);">${d.truck_plate?`${d.truck_plate} ${d.truck_model?'— '+d.truck_model:''}` : '—'}</td>
            <td><div class="action-btns">
                <button class="btn-tbl btn-tbl-edit" onclick="openDriverModal(${d.id})"><i class="fas fa-pen"></i></button>
                <button class="btn-tbl btn-tbl-del"  onclick="confirmDelete('driver',${d.id})"><i class="fas fa-trash"></i></button>
            </div></td>
        </tr>`).join('')}
        </tbody></table>`;
    }catch(e){wrap.innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}

function openDriverModal(id=null){
    document.getElementById('driverModalTitle').textContent=id?'Редагувати водія':'Додати водія';
    document.getElementById('modalDriverId').value=id||'';
    if(id){
        const d=currentDrivers.find(x=>x.id==id);
        if(d){
            document.getElementById('modalDriverName').value=d.full_name;
            document.getElementById('modalDriverPhone').value=d.phone;
            document.getElementById('modalDriverCat').value=d.license_cat;
            document.getElementById('modalDriverStatus').value=d.status;
            document.getElementById('modalDriverAdr').checked=!!parseInt(d.adr_cert);
            document.getElementById('modalDriverHired').value=d.hired_date||'';
            document.getElementById('modalDriverNotes').value=d.notes||'';
        }
    } else {
        ['modalDriverName','modalDriverPhone','modalDriverHired','modalDriverNotes'].forEach(f=>document.getElementById(f).value='');
        document.getElementById('modalDriverCat').value='CE';
        document.getElementById('modalDriverStatus').value='active';
        document.getElementById('modalDriverAdr').checked=false;
    }
    new bootstrap.Modal(document.getElementById('driverModal')).show();
}

async function saveDriver(){
    const id=document.getElementById('modalDriverId').value;
    const data={
        id, full_name:document.getElementById('modalDriverName').value.trim(),
        phone:document.getElementById('modalDriverPhone').value.trim(),
        license_cat:document.getElementById('modalDriverCat').value,
        status:document.getElementById('modalDriverStatus').value,
        adr_cert:document.getElementById('modalDriverAdr').checked,
        hired_date:document.getElementById('modalDriverHired').value,
        notes:document.getElementById('modalDriverNotes').value.trim(),
    };
    if(!data.full_name||!data.phone){showToast('Вкажіть ПІБ та телефон!','error');return;}
    try{
        const r=await apiPost(id?'update_driver':'add_driver',data);
        if(r.success){bootstrap.Modal.getInstance(document.getElementById('driverModal')).hide();showToast(id?'Водія оновлено!':'Водія додано!');loadDriversTable();}
        else showToast(r.error||'Помилка','error');
    }catch(e){showToast('Помилка з\'єднання','error');}
}

/* ===== АВТОПАРК ===== */
async function loadTrucksTable(){
    const wrap=document.getElementById('trucksTableWrap');
    wrap.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Завантаження...</div>';
    try{
        currentTrucks=await apiFetch('get_trucks');
        if(!currentTrucks.length){wrap.innerHTML='<div class="loading-state">Авто ще немає.</div>';return;}
        wrap.innerHTML=`<table class="custom-table"><thead><tr>
            <th>Держ. номер</th><th>Модель</th><th>Рік</th>
            <th>Вантажність</th><th>Об'єм</th><th>Статус</th><th>Водій</th><th>Дії</th>
        </tr></thead><tbody>
        ${currentTrucks.map(t=>`<tr>
            <td><strong>${t.plate}</strong></td>
            <td>${t.model||'—'}</td>
            <td>${t.year||'—'}</td>
            <td>${fmt(t.capacity_kg)} кг</td>
            <td>${t.volume_m3} м³</td>
            <td>${truckStatusBadge(t.status)}</td>
            <td style="font-size:12px;color:var(--text2);">${t.driver_name||'—'}</td>
            <td><div class="action-btns">
                <button class="btn-tbl btn-tbl-edit" onclick="openTruckModal(${t.id})"><i class="fas fa-pen"></i></button>
                <button class="btn-tbl btn-tbl-del"  onclick="confirmDelete('truck',${t.id})"><i class="fas fa-trash"></i></button>
            </div></td>
        </tr>`).join('')}
        </tbody></table>`;
    }catch(e){wrap.innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}

async function openTruckModal(id=null){
    if(!currentDrivers.length) currentDrivers=await apiFetch('get_drivers');
    const dSel=document.getElementById('modalTruckDriver');
    dSel.innerHTML='<option value="">— Без водія —</option>';
    currentDrivers.filter(d=>d.status==='active').forEach(d=>{dSel.innerHTML+=`<option value="${d.id}">${d.full_name}</option>`;});

    document.getElementById('truckModalTitle').textContent=id?'Редагувати авто':'Додати авто';
    document.getElementById('modalTruckId').value=id||'';
    if(id){
        const t=currentTrucks.find(x=>x.id==id);
        if(t){
            document.getElementById('modalTruckPlate').value=t.plate;
            document.getElementById('modalTruckModel').value=t.model||'';
            document.getElementById('modalTruckYear').value=t.year||'';
            document.getElementById('modalTruckCap').value=t.capacity_kg;
            document.getElementById('modalTruckVol').value=t.volume_m3;
            document.getElementById('modalTruckStatus').value=t.status;
            document.getElementById('modalTruckDriver').value=t.driver_id||'';
            document.getElementById('modalTruckNotes').value=t.notes||'';
        }
    } else {
        ['modalTruckPlate','modalTruckModel','modalTruckYear','modalTruckNotes'].forEach(f=>document.getElementById(f).value='');
        document.getElementById('modalTruckCap').value='20000';
        document.getElementById('modalTruckVol').value='86';
        document.getElementById('modalTruckStatus').value='available';
        document.getElementById('modalTruckDriver').value='';
    }
    new bootstrap.Modal(document.getElementById('truckModal')).show();
}

async function saveTruck(){
    const id=document.getElementById('modalTruckId').value;
    const data={
        id, plate:document.getElementById('modalTruckPlate').value.trim(),
        model:document.getElementById('modalTruckModel').value.trim(),
        year:parseInt(document.getElementById('modalTruckYear').value)||null,
        capacity_kg:parseInt(document.getElementById('modalTruckCap').value)||20000,
        volume_m3:parseFloat(document.getElementById('modalTruckVol').value)||86,
        status:document.getElementById('modalTruckStatus').value,
        driver_id:document.getElementById('modalTruckDriver').value||null,
        notes:document.getElementById('modalTruckNotes').value.trim(),
    };
    if(!data.plate){showToast('Вкажіть держ. номер!','error');return;}
    try{
        const r=await apiPost(id?'update_truck':'add_truck',data);
        if(r.success){bootstrap.Modal.getInstance(document.getElementById('truckModal')).hide();showToast(id?'Авто оновлено!':'Авто додано!');loadTrucksTable();}
        else showToast(r.error||'Помилка','error');
    }catch(e){showToast('Помилка з\'єднання','error');}
}

/* ===== ІСТОРІЯ ===== */
async function loadHistory(){
    const wrap=document.getElementById('historyTableWrap');
    wrap.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Завантаження...</div>';
    try{
        const data=await apiFetch('get_history');
        historyData=Array.isArray(data)?data:[];
        applyHistoryFilters();
    }catch(e){wrap.innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}

function renderHistoryTable(data){
    const wrap=document.getElementById('historyTableWrap');
    if(!data.length){wrap.innerHTML='<div class="loading-state">Нічого не знайдено</div>';return;}
    wrap.innerHTML=`<table class="custom-table"><thead><tr>
        <th>Дата</th><th>Маршрут</th><th>Вага</th><th>Об'єм</th><th>Тип</th><th>Вартість</th><th>Термін</th><th>Опції</th><th></th>
    </tr></thead><tbody>
    ${data.map(i=>`<tr>
        <td style="color:var(--text3);white-space:nowrap;">${formatDate(i.calculation_date)}</td>
        <td><strong>${i.route}</strong></td>
        <td>${fmt(i.weight_kg)} кг</td><td>${i.volume_m3} м³</td>
        <td>${badgeHTML(i.cargo_type)}</td>
        <td><strong style="color:var(--accent2);">${fmt(i.total_cost)} €</strong></td>
        <td>${i.days} дн.</td>
        <td style="white-space:nowrap;font-size:12px;color:var(--text3);">
            ${i.insurance?'<i class="fas fa-shield-halved" title="Страхування"></i> ':''}
            ${i.escort?'<i class="fas fa-user-shield" title="Супроводження"></i>':''}
        </td>
        <td><button class="btn-tbl btn-tbl-del" onclick="confirmDelete('history',${i.id})"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('')}
    </tbody></table>`;
}

function applyHistoryFilters(){
    let f=[...historyData];
    const q=document.getElementById('historySearch')?.value.toLowerCase();
    const ct=document.getElementById('historyCargoFilter')?.value;
    const df=document.getElementById('historyDateFrom')?.value;
    const dt=document.getElementById('historyDateTo')?.value;
    if(q) f=f.filter(i=>i.route.toLowerCase().includes(q));
    if(ct) f=f.filter(i=>i.cargo_type===ct);
    if(df) f=f.filter(i=>new Date(i.calculation_date)>=new Date(df));
    if(dt){const to=new Date(dt);to.setDate(to.getDate()+1);f=f.filter(i=>new Date(i.calculation_date)<=to);}
    renderHistoryTable(f);
}
function resetHistoryFilters(){
    ['historySearch','historyCargoFilter','historyDateFrom','historyDateTo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    renderHistoryTable(historyData);
}

function exportHistoryExcel(){
    if(!historyData.length){showToast('Немає даних','error');return;}
    const rows=historyData.map(i=>({'Дата':formatDate(i.calculation_date),'Маршрут':i.route,'Вага (кг)':i.weight_kg,"Об'єм (м³)":i.volume_m3,'Тип':i.cargo_type,'Вартість (€)':i.total_cost,'Термін (дні)':i.days,'Страхування':i.insurance?'Так':'Ні','Супроводження':i.escort?'Так':'Ні'}));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Історія');
    XLSX.writeFile(wb,`rio-trans-history-${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Excel збережено!');
}
function exportHistoryPDF(){
    if(!historyData.length){showToast('Немає даних','error');return;}
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});
    doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('RIO-TRANS - History',14,15);
    doc.setFontSize(10);doc.setFont('helvetica','normal');
    const hdr=['Data','Marshrut','Vaha(kg)','Obsyag','Typ','Vartist(EUR)','Dni'];
    const cw=[38,55,22,18,25,28,16];let y=28,x=14;
    doc.setFont('helvetica','bold');hdr.forEach((h,i)=>{doc.text(h,x,y);x+=cw[i];});
    y+=2;doc.line(14,y,280,y);y+=6;doc.setFont('helvetica','normal');
    historyData.forEach(item=>{
        if(y>185){doc.addPage();y=20;}x=14;
        const row=[new Date(item.calculation_date).toLocaleDateString('uk-UA'),item.route,String(item.weight_kg),String(item.volume_m3),item.cargo_type,String(item.total_cost),String(item.days)];
        row.forEach((v,i)=>{doc.text(doc.splitTextToSize(v,cw[i]-2)[0]||'',x,y);x+=cw[i];});y+=8;
    });
    doc.save(`rio-trans-history-${new Date().toISOString().slice(0,10)}.pdf`);
    showToast('PDF збережено!');
}

/* ===== ДАШБОРД ===== */
async function loadDashboard(){
    try{
        const d=await apiFetch('get_dashboard');
        document.getElementById('kpiTotal').textContent=d.total_calculations||'0';
        document.getElementById('kpiOrders').textContent=d.total_orders||'0';
        document.getElementById('kpiDrivers').textContent=d.active_drivers||'0';
        document.getElementById('kpiTrucks').textContent=d.available_trucks||'0';
        document.getElementById('kpiAvgCost').textContent=(d.avg_cost||'0')+' €';
        document.getElementById('kpiRevenue').textContent=fmt(d.orders_revenue||0)+' €';
        document.getElementById('kpiAvgDays').textContent=(d.avg_days||'0')+' дн.';
        document.getElementById('kpiMaxRoute').textContent=d.max_route||'—';
        if(d.routes_chart)  renderChartRoutes(d.routes_chart);
        if(d.cargo_chart)   renderChartCargo(d.cargo_chart);
        if(d.orders_chart)  renderChartOrdersStatus(d.orders_chart);
        if(d.timeline_chart)renderChartTimeline(d.timeline_chart);
    }catch(e){console.error('loadDashboard:',e);}
}

const CD={color:'#94a3b8',grid:'rgba(42,48,80,0.6)',font:"'IBM Plex Sans',sans-serif"};

function renderChartRoutes(data){
    const ctx=document.getElementById('chartRoutes').getContext('2d');
    if(chartRoutes)chartRoutes.destroy();
    chartRoutes=new Chart(ctx,{type:'bar',data:{labels:data.labels,datasets:[{label:'Середня вартість (€)',data:data.values,backgroundColor:'rgba(59,130,246,0.7)',borderColor:'rgba(59,130,246,1)',borderWidth:1,borderRadius:6}]},options:{responsive:true,plugins:{legend:{labels:{color:CD.color,font:{family:CD.font}}}},scales:{x:{ticks:{color:CD.color},grid:{color:CD.grid}},y:{ticks:{color:CD.color},grid:{color:CD.grid}}}}});
}
function renderChartCargo(data){
    const ctx=document.getElementById('chartCargo').getContext('2d');
    if(chartCargo)chartCargo.destroy();
    chartCargo=new Chart(ctx,{type:'doughnut',data:{labels:data.labels,datasets:[{data:data.values,backgroundColor:['rgba(59,130,246,0.8)','rgba(239,68,68,0.8)','rgba(249,115,22,0.8)'],borderColor:'#0f1117',borderWidth:3}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:CD.color,font:{family:CD.font},padding:16}}}}});
}
function renderChartOrdersStatus(data){
    const ctx=document.getElementById('chartOrders').getContext('2d');
    if(chartOrdersStatus)chartOrdersStatus.destroy();
    chartOrdersStatus=new Chart(ctx,{type:'doughnut',data:{labels:data.labels,datasets:[{data:data.values,backgroundColor:['rgba(59,130,246,0.8)','rgba(34,197,94,0.8)','rgba(249,115,22,0.8)','rgba(168,85,247,0.8)','rgba(239,68,68,0.8)'],borderColor:'#0f1117',borderWidth:3}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:CD.color,font:{family:CD.font},padding:12}}}}});
}
function renderChartTimeline(data){
    const ctx=document.getElementById('chartTimeline').getContext('2d');
    if(chartTimeline)chartTimeline.destroy();
    chartTimeline=new Chart(ctx,{type:'line',data:{labels:data.labels,datasets:[{label:'Розрахунків на день',data:data.values,borderColor:'rgba(34,197,94,1)',backgroundColor:'rgba(34,197,94,0.1)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'rgba(34,197,94,1)'}]},options:{responsive:true,plugins:{legend:{labels:{color:CD.color,font:{family:CD.font}}}},scales:{x:{ticks:{color:CD.color},grid:{color:CD.grid}},y:{ticks:{color:CD.color,stepSize:1},grid:{color:CD.grid},beginAtZero:true}}}});
}

/* ===== КАРТА ===== */
let leafletMap=null,mapLayers=[],activePolyline=null,allMapTariffs=[];
const ROUTE_COLORS=['#3b82f6','#22c55e','#f97316','#a855f7','#ef4444','#06b6d4','#f59e0b','#ec4899'];

async function loadMap(){
    if(!leafletMap){
        leafletMap=L.map('routeMap',{zoomControl:true}).setView([50.0,18.0],5);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:18}).addTo(leafletMap);
    }
    try{
        const tariffs=await apiFetch('get_tariffs');
        allMapTariffs=tariffs; renderMapRoutes(tariffs);
    }catch(e){document.getElementById('mapRouteList').innerHTML=`<div class="loading-state" style="color:var(--red)">Помилка: ${e.message}</div>`;}
}

function filterMapRoutes(type,btn){
    document.querySelectorAll('.map-filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    mapLayers.forEach(l=>leafletMap.removeLayer(l));mapLayers=[];activePolyline=null;
    document.getElementById('mapActiveRoute').style.display='none';
    renderMapRoutes(allMapTariffs);
}

function renderMapRoutes(tariffs){
    const listEl=document.getElementById('mapRouteList');listEl.innerHTML='';
    const cityMarkers={};let hasCoords=false;
    tariffs.forEach((t,idx)=>{
        const color=ROUTE_COLORS[idx%ROUTE_COLORS.length];
        const fromCoord=(t.lat_from&&t.lng_from)?[parseFloat(t.lat_from),parseFloat(t.lng_from)]:null;
        const toCoord=(t.lat_to&&t.lng_to)?[parseFloat(t.lat_to),parseFloat(t.lng_to)]:null;
        if(fromCoord&&toCoord){
            hasCoords=true;
            const poly=L.polyline([fromCoord,toCoord],{color,weight:3,opacity:0.75,dashArray:'8 4'}).addTo(leafletMap);
            poly.bindPopup(`<div class="map-popup-title">${t.from_city} → ${t.to_city}</div>
                <div class="map-popup-row"><span>Відстань:</span><strong>${fmt(t.distance_km)} км</strong></div>
                <div class="map-popup-row"><span>Ставка:</span><strong>€${t.base_rate}/км</strong></div>
                <div class="map-popup-row"><span>Вартість:</span><strong>~€${fmt(Math.round(t.distance_km*t.base_rate))}</strong></div>
                ${t.description?`<div style="margin-top:6px;color:#94a3b8;font-size:11px;">${t.description}</div>`:''}
                <button class="map-popup-btn" onclick="goToCalculatorRoute(${t.id})"><i class='fas fa-calculator'></i> Розрахувати</button>`,
                {className:'map-popup',maxWidth:280});
            poly.bindTooltip(`<strong>${t.from_city} → ${t.to_city}</strong><br>${fmt(t.distance_km)} км`,{sticky:true,className:'map-tooltip'});
            const item=document.createElement('div');
            item.className='map-route-item';item.dataset.tariffId=t.id;
            item.innerHTML=`<span class="map-route-dot" style="background:${color}"></span><div class="map-route-info"><strong>${t.from_city} → ${t.to_city}</strong><small>${fmt(t.distance_km)} км · €${t.base_rate}/км</small></div><span class="map-route-cost">~€${fmt(Math.round(t.distance_km*t.base_rate))}</span>`;
            item.addEventListener('click',()=>{highlightRoute(poly,t,color,item);poly.openPopup();leafletMap.fitBounds(poly.getBounds().pad(0.3));});
            poly.on('click',()=>highlightRoute(poly,t,color,listEl.querySelector(`[data-tariff-id="${t.id}"]`)));
            mapLayers.push(poly);listEl.appendChild(item);
            [{city:t.from_city,coord:fromCoord},{city:t.to_city,coord:toCoord}].forEach(({city,coord})=>{
                if(!cityMarkers[city]){
                    const m=L.circleMarker(coord,{radius:7,fillColor:'#e2e8f0',color:'#0f1117',weight:2,opacity:1,fillOpacity:1}).addTo(leafletMap).bindTooltip(city,{permanent:false,className:'map-tooltip'});
                    cityMarkers[city]=m;mapLayers.push(m);
                }
            });
        } else {
            const item=document.createElement('div');
            item.className='map-route-item map-route-no-coord';
            item.innerHTML=`<span class="map-route-dot" style="background:var(--text3)"></span><div class="map-route-info"><strong>${t.from_city} → ${t.to_city}</strong><small style="color:var(--text3)"><i class="fas fa-triangle-exclamation"></i> немає координат</small></div>`;
            listEl.appendChild(item);
        }
    });
    if(!tariffs.length){listEl.innerHTML='<div class="loading-state">Маршрутів ще немає</div>';return;}
    if(mapLayers.length){try{leafletMap.fitBounds(L.featureGroup(mapLayers).getBounds().pad(0.15));}catch(e){}}
}
function highlightRoute(poly,tariff,color,itemEl){
    if(activePolyline)activePolyline.setStyle({weight:3,opacity:0.75});
    document.querySelectorAll('.map-route-item').forEach(i=>i.classList.remove('active'));
    poly.setStyle({weight:6,opacity:1});activePolyline=poly;
    if(itemEl)itemEl.classList.add('active');
    document.getElementById('mapActiveRoute').style.display='block';
    document.getElementById('mapRouteLabel').textContent=`${tariff.from_city} → ${tariff.to_city}  |  ${fmt(tariff.distance_km)} км  |  €${tariff.base_rate}/км`;
}
function goToCalculatorRoute(tariffId){
    switchTab('calculator',document.querySelector('[onclick*="calculator"]'));
    setTimeout(()=>{const s=document.getElementById('tariffSelect');if(s){s.value=tariffId;if(s.options.length<=1)loadTariffsForSelect().then(()=>{s.value=tariffId;});}},200);
}

/* ===== ВИДАЛЕННЯ ===== */
function confirmDelete(type,id){
    pendingDeleteType=type;pendingDeleteId=id;
    new bootstrap.Modal(document.getElementById('confirmModal')).show();
}

document.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('confirmDeleteBtn');
    if(btn){
        btn.addEventListener('click',async()=>{
            if(!pendingDeleteId)return;
            const actionMap={tariff:'delete_tariff',history:'delete_history',order:'delete_order',driver:'delete_driver',truck:'delete_truck'};
            const action=actionMap[pendingDeleteType];
            try{
                const r=await apiPost(action,{id:pendingDeleteId});
                if(r.success){
                    bootstrap.Modal.getInstance(document.getElementById('confirmModal')).hide();
                    showToast('Видалено!');
                    if(pendingDeleteType==='tariff'){loadTariffsTable();loadTariffsForSelect();}
                    else if(pendingDeleteType==='history')loadHistory();
                    else if(pendingDeleteType==='order')loadOrders();
                    else if(pendingDeleteType==='driver')loadDriversTable();
                    else if(pendingDeleteType==='truck')loadTrucksTable();
                }else showToast(r.error||'Помилка','error');
            }catch(e){showToast('Помилка з\'єднання','error');}
            finally{pendingDeleteId=pendingDeleteType=null;}
        });
    }

    // Пошук у реальному часі
    const hs=document.getElementById('historySearch');
    if(hs){let t;hs.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(applyHistoryFilters,300);});}
    const os=document.getElementById('ordersSearch');
    if(os){let t;os.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(applyOrdersFilter,300);});}

    loadTariffsForSelect();
    loadOrders(); // для бейджа
});

/* ===== API ХЕЛПЕРИ ===== */
async function apiFetch(action){
    const r=await fetch(`api.php?action=${action}`);
    const data=await r.json();
    if(data.error)throw new Error(data.error);
    return data;
}
async function apiPost(action,body){
    const r=await fetch(`api.php?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return await r.json();
}

// ===== ТЕМА =====
(function() {
    const btn = document.getElementById('themeToggle');

    const moonSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>`;
    const sunSVG  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`;

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('riotrans_theme', theme);
        if (theme === 'dark') {
            btn.innerHTML = moonSVG;
            btn.style.color = '#94a3b8';
            btn.style.borderColor = 'var(--border)';
        } else {
            btn.innerHTML = sunSVG;
            btn.style.color = '#f97316';
            btn.style.borderColor = 'rgba(249,115,22,0.5)';
        }
    }

    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg2)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'var(--bg3)');

    applyTheme(localStorage.getItem('riotrans_theme') || 'dark');
})();