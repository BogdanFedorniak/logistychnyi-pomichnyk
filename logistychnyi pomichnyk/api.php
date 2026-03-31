<?php
/**
 * РІО-ТРАНС — api.php (повна версія з Orders, Drivers, Trucks)
 */
ob_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { ob_end_clean(); exit; }

set_error_handler(function($errno,$errstr,$errfile,$errline){
    ob_end_clean(); http_response_code(500);
    echo json_encode(['error'=>"PHP Error [{$errno}]: {$errstr} in {$errfile}:{$errline}"],JSON_UNESCAPED_UNICODE); exit;
});
set_exception_handler(function($e){
    ob_end_clean(); http_response_code(500);
    echo json_encode(['error'=>'Exception: '.$e->getMessage()],JSON_UNESCAPED_UNICODE); exit;
});

require_once 'db.php';
$action = $_GET['action'] ?? '';

function jsonOk($data){ ob_end_clean(); echo json_encode($data,JSON_UNESCAPED_UNICODE); exit; }
function jsonErr($msg){ ob_end_clean(); http_response_code(400); echo json_encode(['error'=>$msg],JSON_UNESCAPED_UNICODE); exit; }
function bodyJson(){ return json_decode(file_get_contents('php://input'),true)??[]; }

switch($action){

/* ============================================================ ТАРИФИ */
case 'get_tariffs':
    jsonOk($pdo->query("SELECT * FROM tariffs ORDER BY from_city,to_city")->fetchAll(PDO::FETCH_ASSOC));

case 'add_tariff':
    $d=bodyJson(); $from=trim($d['from_city']??''); $to=trim($d['to_city']??'');
    $dist=(float)($d['distance_km']??0); $rate=(float)($d['base_rate']??0);
    $desc=trim($d['description']??'');
    if(!$from||!$to||$dist<=0||$rate<=0) jsonErr('Заповніть усі обов\'язкові поля');
    $c=getCityCoords();
    $pdo->prepare("INSERT INTO tariffs(from_city,to_city,distance_km,base_rate,description,lat_from,lng_from,lat_to,lng_to)VALUES(?,?,?,?,?,?,?,?,?)")
        ->execute([$from,$to,$dist,$rate,$desc?:null,$c[$from]['lat']??null,$c[$from]['lng']??null,$c[$to]['lat']??null,$c[$to]['lng']??null]);
    jsonOk(['success'=>true,'id'=>(int)$pdo->lastInsertId()]);

case 'update_tariff':
    $d=bodyJson(); $id=(int)($d['id']??0); $from=trim($d['from_city']??''); $to=trim($d['to_city']??'');
    $dist=(float)($d['distance_km']??0); $rate=(float)($d['base_rate']??0); $desc=trim($d['description']??'');
    if(!$id||!$from||!$to||$dist<=0||$rate<=0) jsonErr('Некоректні дані');
    $c=getCityCoords();
    $pdo->prepare("UPDATE tariffs SET from_city=?,to_city=?,distance_km=?,base_rate=?,description=?,lat_from=?,lng_from=?,lat_to=?,lng_to=? WHERE id=?")
        ->execute([$from,$to,$dist,$rate,$desc?:null,$c[$from]['lat']??null,$c[$from]['lng']??null,$c[$to]['lat']??null,$c[$to]['lng']??null,$id]);
    jsonOk(['success'=>true]);

case 'delete_tariff':
    $d=bodyJson(); $id=(int)($d['id']??0); if(!$id) jsonErr('ID не вказано');
    $pdo->prepare("DELETE FROM tariffs WHERE id=?")->execute([$id]);
    jsonOk(['success'=>true]);

/* ========================================================= РОЗРАХУНОК */
case 'calculate':
    if($_SERVER['REQUEST_METHOD']!=='POST') jsonErr('Метод не підтримується');
    $d=bodyJson(); $from=trim($d['from_city']??''); $to=trim($d['to_city']??'');
    $weight=(int)($d['weight']??0); $volume=(float)($d['volume']??0);
    $cargo_type=$d['cargo_type']??'Звичайний';
    $insurance=!empty($d['insurance'])?1:0; $escort=!empty($d['escort'])?1:0;
    if(!$from||!$to) jsonErr('Не вказано маршрут');
    if($weight<=0) jsonErr('Некоректна вага');
    if($volume<=0) jsonErr('Некоректний об\'єм');

    $stmt=$pdo->prepare("SELECT * FROM tariffs WHERE from_city=? AND to_city=? LIMIT 1");
    $stmt->execute([$from,$to]); $tariff=$stmt->fetch(PDO::FETCH_ASSOC);
    if(!$tariff){ $s2=$pdo->prepare("SELECT * FROM tariffs WHERE from_city=? LIMIT 1"); $s2->execute([$from]); $tariff=$s2->fetch(PDO::FETCH_ASSOC); }
    if(!$tariff) jsonErr("Тариф для маршруту «{$from} → {$to}» не знайдено.");

    $coef=match($cargo_type){'ADR'=>1.30,'Великогабаритний'=>1.25,default=>1.00};
    $dist_km=(float)$tariff['distance_km']; $b_rate=(float)$tariff['base_rate'];
    $cost=($dist_km*$b_rate+($weight/1000)*70)*$coef;
    $days=match(true){$dist_km>900=>5,$dist_km>500=>3,default=>2};
    $final=$cost*($insurance?1.02:1)*($escort?1.05:1);

    $pdo->prepare("INSERT INTO calculations(route,weight_kg,volume_m3,cargo_type,total_cost,days,insurance,escort)VALUES(?,?,?,?,?,?,?,?)")
        ->execute(["{$from} → {$to}",$weight,$volume,$cargo_type,round($final,2),$days,$insurance,$escort]);

    jsonOk(['success'=>true,'route'=>"{$from} → {$to}",'cost'=>round($cost,0),'final_cost'=>round($final,0),'days'=>$days,
        'from_city'=>$from,'to_city'=>$to,'lat_from'=>$tariff['lat_from']??null,'lng_from'=>$tariff['lng_from']??null,
        'lat_to'=>$tariff['lat_to']??null,'lng_to'=>$tariff['lng_to']??null]);

/* =========================================================== ІСТОРІЯ */
case 'get_history':
    jsonOk($pdo->query("SELECT * FROM calculations ORDER BY calculation_date DESC LIMIT 200")->fetchAll(PDO::FETCH_ASSOC));

case 'delete_history':
    $d=bodyJson(); $id=(int)($d['id']??0); if(!$id) jsonErr('ID не вказано');
    $pdo->prepare("DELETE FROM calculations WHERE id=?")->execute([$id]);
    jsonOk(['success'=>true]);

case 'clear_history':
    $pdo->query("DELETE FROM calculations"); jsonOk(['success'=>true]);

/* ============================================================= ВОДІЇ */
case 'get_drivers':
    $rows=$pdo->query("SELECT d.*,t.plate as truck_plate,t.model as truck_model
        FROM drivers d LEFT JOIN trucks t ON t.driver_id=d.id ORDER BY d.full_name")->fetchAll(PDO::FETCH_ASSOC);
    jsonOk($rows);

case 'add_driver':
    $d=bodyJson();
    $name=trim($d['full_name']??''); $phone=trim($d['phone']??'');
    $cat=trim($d['license_cat']??'CE'); $adr=!empty($d['adr_cert'])?1:0;
    $hired=trim($d['hired_date']??''); $notes=trim($d['notes']??'');
    if(!$name||!$phone) jsonErr('Вкажіть ПІБ та телефон');
    $pdo->prepare("INSERT INTO drivers(full_name,phone,license_cat,adr_cert,hired_date,notes)VALUES(?,?,?,?,?,?)")
        ->execute([$name,$phone,$cat,$adr,$hired?:null,$notes?:null]);
    jsonOk(['success'=>true,'id'=>(int)$pdo->lastInsertId()]);

case 'update_driver':
    $d=bodyJson(); $id=(int)($d['id']??0);
    $name=trim($d['full_name']??''); $phone=trim($d['phone']??'');
    $cat=trim($d['license_cat']??'CE'); $status=trim($d['status']??'active');
    $adr=!empty($d['adr_cert'])?1:0; $hired=trim($d['hired_date']??''); $notes=trim($d['notes']??'');
    if(!$id||!$name||!$phone) jsonErr('Некоректні дані');
    $pdo->prepare("UPDATE drivers SET full_name=?,phone=?,license_cat=?,status=?,adr_cert=?,hired_date=?,notes=? WHERE id=?")
        ->execute([$name,$phone,$cat,$status,$adr,$hired?:null,$notes?:null,$id]);
    jsonOk(['success'=>true]);

case 'delete_driver':
    $d=bodyJson(); $id=(int)($d['id']??0); if(!$id) jsonErr('ID не вказано');
    $pdo->prepare("UPDATE trucks SET driver_id=NULL WHERE driver_id=?")->execute([$id]);
    $pdo->prepare("DELETE FROM drivers WHERE id=?")->execute([$id]);
    jsonOk(['success'=>true]);

/* ============================================================== ФУРИ */
case 'get_trucks':
    $rows=$pdo->query("SELECT t.*,d.full_name as driver_name
        FROM trucks t LEFT JOIN drivers d ON d.id=t.driver_id ORDER BY t.plate")->fetchAll(PDO::FETCH_ASSOC);
    jsonOk($rows);

case 'add_truck':
    $d=bodyJson();
    $plate=trim($d['plate']??''); $model=trim($d['model']??'');
    $year=(int)($d['year']??0); $cap=(int)($d['capacity_kg']??20000);
    $vol=(float)($d['volume_m3']??86.0); $drv=$d['driver_id']?(int)$d['driver_id']:null;
    $notes=trim($d['notes']??'');
    if(!$plate) jsonErr('Вкажіть держ. номер');
    $pdo->prepare("INSERT INTO trucks(plate,model,year,capacity_kg,volume_m3,driver_id,notes)VALUES(?,?,?,?,?,?,?)")
        ->execute([$plate,$model?:null,$year?:null,$cap,$vol,$drv,$notes?:null]);
    jsonOk(['success'=>true,'id'=>(int)$pdo->lastInsertId()]);

case 'update_truck':
    $d=bodyJson(); $id=(int)($d['id']??0);
    $plate=trim($d['plate']??''); $model=trim($d['model']??'');
    $year=(int)($d['year']??0); $cap=(int)($d['capacity_kg']??20000);
    $vol=(float)($d['volume_m3']??86.0); $status=trim($d['status']??'available');
    $drv=$d['driver_id']?(int)$d['driver_id']:null; $notes=trim($d['notes']??'');
    if(!$id||!$plate) jsonErr('Некоректні дані');
    if($drv) $pdo->prepare("UPDATE trucks SET driver_id=NULL WHERE driver_id=? AND id!=?")->execute([$drv,$id]);
    $pdo->prepare("UPDATE trucks SET plate=?,model=?,year=?,capacity_kg=?,volume_m3=?,status=?,driver_id=?,notes=? WHERE id=?")
        ->execute([$plate,$model?:null,$year?:null,$cap,$vol,$status,$drv,$notes?:null,$id]);
    jsonOk(['success'=>true]);

case 'delete_truck':
    $d=bodyJson(); $id=(int)($d['id']??0); if(!$id) jsonErr('ID не вказано');
    $pdo->prepare("DELETE FROM trucks WHERE id=?")->execute([$id]);
    jsonOk(['success'=>true]);

/* ========================================================= ЗАМОВЛЕННЯ */
case 'get_orders':
    $rows=$pdo->query("SELECT o.*,d.full_name as driver_name,t.plate as truck_plate,t.model as truck_model
        FROM orders o LEFT JOIN drivers d ON d.id=o.driver_id LEFT JOIN trucks t ON t.id=o.truck_id
        ORDER BY o.created_at DESC LIMIT 300")->fetchAll(PDO::FETCH_ASSOC);
    jsonOk($rows);

case 'add_order':
    $d=bodyJson();
    $client=trim($d['client_name']??''); $phone=trim($d['client_phone']??'');
    $email=trim($d['client_email']??''); $route=trim($d['route']??'');
    $ctype=trim($d['cargo_type']??'Звичайний');
    $wkg=(int)($d['weight_kg']??0); $vm3=(float)($d['volume_m3']??0);
    $cost=(float)($d['total_cost']??0);
    $pickup=trim($d['pickup_date']??''); $deliv=trim($d['delivery_date']??'');
    $drv=$d['driver_id']?(int)$d['driver_id']:null; $trk=$d['truck_id']?(int)$d['truck_id']:null;
    $notes=trim($d['notes']??'');
    if(!$client||!$route) jsonErr('Вкажіть клієнта та маршрут');
    $pdo->prepare("INSERT INTO orders(client_name,client_phone,client_email,route,cargo_type,weight_kg,volume_m3,total_cost,driver_id,truck_id,pickup_date,delivery_date,notes)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        ->execute([$client,$phone?:null,$email?:null,$route,$ctype,$wkg,$vm3,$cost,$drv,$trk,$pickup?:null,$deliv?:null,$notes?:null]);
    if($trk) $pdo->prepare("UPDATE trucks SET status='on_route' WHERE id=?")->execute([$trk]);
    jsonOk(['success'=>true,'id'=>(int)$pdo->lastInsertId()]);

case 'update_order':
    $d=bodyJson(); $id=(int)($d['id']??0);
    $client=trim($d['client_name']??''); $phone=trim($d['client_phone']??'');
    $email=trim($d['client_email']??''); $route=trim($d['route']??'');
    $ctype=trim($d['cargo_type']??'Звичайний'); $status=trim($d['status']??'new');
    $wkg=(int)($d['weight_kg']??0); $vm3=(float)($d['volume_m3']??0); $cost=(float)($d['total_cost']??0);
    $pickup=trim($d['pickup_date']??''); $deliv=trim($d['delivery_date']??'');
    $drv=$d['driver_id']?(int)$d['driver_id']:null; $trk=$d['truck_id']?(int)$d['truck_id']:null;
    $notes=trim($d['notes']??'');
    if(!$id||!$client||!$route) jsonErr('Некоректні дані');
    $old=$pdo->prepare("SELECT truck_id FROM orders WHERE id=?"); $old->execute([$id]);
    $oldRow=$old->fetch(PDO::FETCH_ASSOC); $oldTruck=(int)($oldRow['truck_id']??0);
    $pdo->prepare("UPDATE orders SET client_name=?,client_phone=?,client_email=?,route=?,cargo_type=?,weight_kg=?,volume_m3=?,total_cost=?,status=?,driver_id=?,truck_id=?,pickup_date=?,delivery_date=?,notes=? WHERE id=?")
        ->execute([$client,$phone?:null,$email?:null,$route,$ctype,$wkg,$vm3,$cost,$status,$drv,$trk,$pickup?:null,$deliv?:null,$notes?:null,$id]);
    if($oldTruck&&$oldTruck!==$trk) $pdo->prepare("UPDATE trucks SET status='available' WHERE id=?")->execute([$oldTruck]);
    if($trk){ $ts=in_array($status,['in_transit','confirmed'])?'on_route':'available'; $pdo->prepare("UPDATE trucks SET status=? WHERE id=?")->execute([$ts,$trk]); }
    jsonOk(['success'=>true]);

case 'delete_order':
    $d=bodyJson(); $id=(int)($d['id']??0); if(!$id) jsonErr('ID не вказано');
    $row=$pdo->prepare("SELECT truck_id FROM orders WHERE id=?"); $row->execute([$id]);
    $r=$row->fetch(PDO::FETCH_ASSOC);
    if($r&&$r['truck_id']) $pdo->prepare("UPDATE trucks SET status='available' WHERE id=?")->execute([$r['truck_id']]);
    $pdo->prepare("DELETE FROM orders WHERE id=?")->execute([$id]);
    jsonOk(['success'=>true]);

/* =========================================================== ДАШБОРД */
case 'get_dashboard':
    $stats=[];
    $stats['total_calculations']=(int)$pdo->query("SELECT COUNT(*) FROM calculations")->fetchColumn();
    $stats['avg_cost']=(float)($pdo->query("SELECT ROUND(AVG(total_cost),0) FROM calculations")->fetchColumn()??0);
    $stats['avg_days']=(float)($pdo->query("SELECT ROUND(AVG(days),1) FROM calculations")->fetchColumn()??0);
    $max=$pdo->query("SELECT route,total_cost FROM calculations ORDER BY total_cost DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    $stats['max_route']=$max?$max['route'].' ('.$max['total_cost'].' €)':'—';
    $stats['total_orders']=(int)$pdo->query("SELECT COUNT(*) FROM orders")->fetchColumn();
    $stats['active_drivers']=(int)$pdo->query("SELECT COUNT(*) FROM drivers WHERE status='active'")->fetchColumn();
    $stats['available_trucks']=(int)$pdo->query("SELECT COUNT(*) FROM trucks WHERE status='available'")->fetchColumn();
    $stats['orders_revenue']=(float)($pdo->query("SELECT ROUND(SUM(total_cost),0) FROM orders WHERE status NOT IN ('cancelled')")->fetchColumn()??0);

    $rows=$pdo->query("SELECT route,ROUND(AVG(total_cost),0) as avg_cost FROM calculations GROUP BY route ORDER BY avg_cost DESC LIMIT 8")->fetchAll(PDO::FETCH_ASSOC);
    $stats['routes_chart']=['labels'=>array_column($rows,'route'),'values'=>array_map('floatval',array_column($rows,'avg_cost'))];

    $rows2=$pdo->query("SELECT cargo_type,COUNT(*) as cnt FROM calculations GROUP BY cargo_type")->fetchAll(PDO::FETCH_ASSOC);
    $stats['cargo_chart']=['labels'=>array_column($rows2,'cargo_type'),'values'=>array_map('intval',array_column($rows2,'cnt'))];

    $rows4=$pdo->query("SELECT status,COUNT(*) as cnt FROM orders GROUP BY status")->fetchAll(PDO::FETCH_ASSOC);
    $sLbls=['new'=>'Нові','confirmed'=>'Підтверджені','in_transit'=>'В дорозі','delivered'=>'Доставлені','cancelled'=>'Скасовані'];
    $stats['orders_chart']=['labels'=>array_map(fn($r)=>$sLbls[$r['status']]??$r['status'],$rows4),'values'=>array_map('intval',array_column($rows4,'cnt'))];

    $rows3=$pdo->query("SELECT DATE(calculation_date) as day,COUNT(*) as cnt FROM calculations WHERE calculation_date>=DATE_SUB(NOW(),INTERVAL 14 DAY) GROUP BY day ORDER BY day ASC")->fetchAll(PDO::FETCH_ASSOC);
    $timeline=[];
    for($i=13;$i>=0;$i--){$day=date('Y-m-d',strtotime("-{$i} days"));$timeline[$day]=0;}
    foreach($rows3 as $r){if(isset($timeline[$r['day']]))$timeline[$r['day']]=(int)$r['cnt'];}
    $stats['timeline_chart']=['labels'=>array_map(fn($d)=>date('d.m',strtotime($d)),array_keys($timeline)),'values'=>array_values($timeline)];
    jsonOk($stats);

default:
    jsonErr('Невідома дія: '.htmlspecialchars($action));
}

function getCityCoords():array{
    return [
        'Київ'=>['lat'=>50.4501,'lng'=>30.5234],'Харків'=>['lat'=>49.9935,'lng'=>36.2304],
        'Львів'=>['lat'=>49.8397,'lng'=>24.0297],'Одеса'=>['lat'=>46.4825,'lng'=>30.7233],
        'Дніпро'=>['lat'=>48.4647,'lng'=>35.0462],'Калуш'=>['lat'=>48.9000,'lng'=>24.3667],
        'Варшава (Польща)'=>['lat'=>52.2297,'lng'=>21.0122],'Берлін (Німеччина)'=>['lat'=>52.5200,'lng'=>13.4050],
        'Краків (Польща)'=>['lat'=>50.0647,'lng'=>19.9450],'Вроцлав (Польща)'=>['lat'=>51.1079,'lng'=>17.0385],
        'Гданськ (Польща)'=>['lat'=>54.3520,'lng'=>18.6466],'Познань (Польща)'=>['lat'=>52.4064,'lng'=>16.9252],
        'Прага (Чехія)'=>['lat'=>50.0755,'lng'=>14.4378],'Відень (Австрія)'=>['lat'=>48.2082,'lng'=>16.3738],
        'Братислава (Словаччина)'=>['lat'=>48.1482,'lng'=>17.1067],'Будапешт (Угорщина)'=>['lat'=>47.4979,'lng'=>19.0402],
        'Мюнхен (Німеччина)'=>['lat'=>48.1351,'lng'=>11.5820],'Гамбург (Німеччина)'=>['lat'=>53.5753,'lng'=>10.0153],
        'Дрезден (Німеччина)'=>['lat'=>51.0504,'lng'=>13.7373],'Бухарест (Румунія)'=>['lat'=>44.4268,'lng'=>26.1025],
        'Рига (Латвія)'=>['lat'=>56.9460,'lng'=>24.1059],'Вільнюс (Литва)'=>['lat'=>54.6872,'lng'=>25.2797],
        'Варшава'=>['lat'=>52.2297,'lng'=>21.0122],'Берлін'=>['lat'=>52.5200,'lng'=>13.4050],
        'Краків'=>['lat'=>50.0647,'lng'=>19.9450],'Прага'=>['lat'=>50.0755,'lng'=>14.4378],
        'Мюнхен'=>['lat'=>48.1351,'lng'=>11.5820],'Відень'=>['lat'=>48.2082,'lng'=>16.3738],
    ];
}