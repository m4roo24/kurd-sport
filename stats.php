<?php
// Kurd Sport - visitor stats for the Owner Panel
// Upload to the SAME folder as index.html. Counts are exact and reads never increment.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$dir  = __DIR__;
$mapf = $dir . '/stats-online.json';  // visitorID => lastSeen unix time
$cntf = $dir . '/stats-counts.json';  // today_* / total counters
$now  = time();

/* ---------- heartbeat: a visitor is alive (called every 60s by each browser) ---------- */
if (isset($_GET['hb'])) {
    $id = substr(preg_replace('/[^A-Za-z0-9]/', '', $_GET['hb']), 0, 40);
    if ($id !== '') {
        $fp = fopen($mapf, 'c+');
        if ($fp) {
            flock($fp, LOCK_EX);
            $map = json_decode((string)stream_get_contents($fp), true);
            if (!is_array($map)) $map = array();
            $map[$id] = $now;
            foreach ($map as $k => $t) { if ($now - $t > 300) unset($map[$k]); } // drop people gone >5 min
            ftruncate($fp, 0); rewind($fp);
            fwrite($fp, json_encode($map)); fflush($fp);
            flock($fp, LOCK_UN); fclose($fp);
        }
    }
    // reply with how many are online right now
    $map = array();
    if (file_exists($mapf)) { $m = json_decode(file_get_contents($mapf), true); if (is_array($m)) $map = $m; }
    $online = 0;
    foreach ($map as $k => $t) { if ($now - $t <= 120) $online++; } // seen in last 2 min
    echo json_encode(array('online' => $online));
    exit;
}

/* ---------- daily / total visit events (once per visitor per day) ---------- */
$cnt = array();
if (file_exists($cntf)) { $c = json_decode(file_get_contents($cntf), true); if (is_array($c)) $cnt = $c; }

if (isset($_GET['event'])) {
    $e = ($_GET['event'] === 'total') ? 'total' : 'today_' . date('Y_n_j');
    $cnt[$e] = isset($cnt[$e]) ? $cnt[$e] + 1 : 1;
    file_put_contents($cntf, json_encode($cnt), LOCK_EX);
    echo json_encode(array('count' => $cnt[$e]));
    exit;
}

/* ---------- owner read: shows stats, NEVER increments anything ---------- */
if (isset($_GET['stats'])) {
    $map = array();
    if (file_exists($mapf)) { $m = json_decode(file_get_contents($mapf), true); if (is_array($m)) $map = $m; }
    $online = 0;
    foreach ($map as $k => $t) { if ($now - $t <= 120) $online++; }
    $todayKey = 'today_' . date('Y_n_j');
    echo json_encode(array(
        'online' => $online,
        'today'  => isset($cnt[$todayKey]) ? $cnt[$todayKey] : 0,
        'total'  => isset($cnt['total']) ? $cnt['total'] : 0
    ));
    exit;
}

echo json_encode(array('error' => 'no action'));
