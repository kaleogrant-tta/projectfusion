// ============================================================
//  SELL THROUGH MASTER  —  Code.gs  v4.5  (TIER-2 FUSION)
//  The Travel Agency · Downtown Brooklyn
//
//  v4.5 — VELOCITY NOW COMES FROM PRODUCT PULSE.
//  The DOS Tracker no longer scans/blends the Detailed Sales
//  Breakdown files itself. Instead it reads Product Pulse's
//  ProductWeekly tab and derives a trailing-window daily burn
//  rate into 📦 MASTER_SKU. One source of truth for velocity;
//  no double-ingest. Set CONFIG.PULSE_SPREADSHEET_ID (done).
//  The old file-scan path (processSalesWithHistory_ /
//  processSalesFromArray_ / importSalesBreakdown) is kept but
//  dormant as a one-line rollback.
//
//  v4.3 adds receipt history enrichment.
//  Drop the Inventory Receipt Report in the Drive folder,
//  run "Import Receipt History" once from the menu, and
//  every product in the DOS Tracker and buy list will show:
//    • Vendor  — which distributor/rep to call
//    • Last Recv — days since last received (validate freshness)
//  Stored in 📋 RECEIPT_HISTORY. Re-import whenever you get
//  a new receipt report.
//
//  PRIMARY WORKFLOW: web app → upload 2 files → click Update
//  Velocity auto-merges from Product Pulse for YTD burn rates.
// ============================================================

// ════════════════════════════════════════════════════════════
//  §1  CONFIGURATION
// ════════════════════════════════════════════════════════════

var CONFIG = {
  SPREADSHEET_ID:   '1ATIKkm5tRuNzcqiydJPo6wmR7gtQU5RBCPmfF99u9Vk',
  PARENT_FOLDER_ID: '19wSzCPuRcQdMeFUbpbU_lVempRN0FFf9',
  SUBFOLDER_IDS: {
    '2024': '1XV1AxFHM6QmK4QjywA2KBOAHbModvmqn',
    '2025': '1vd4eZH4FbJ8VPE8kUmsOFNVJAhUFTC4-',
    '2026': '1Ib1TUGylLmUX4864b2okMddTaSnPAXGd'
  },
  META_ROWS: 4,

  // ── TIER-2 FUSION: velocity now comes from Product Pulse, not file scans ──
  // The Google Sheet Product Pulse writes its data tabs into (ProductWeekly,
  // MethodWeekly, etc.). This is the Product Pulse data-sheet ID.
  PULSE_SPREADSHEET_ID:  '1Nz-Pwd2USi_wsBu-WmFS9kVfaxhWk1h2Gq-KKVroPeI',
  PULSE_PRODUCT_TAB:     'ProductWeekly',
  VELOCITY_WINDOW_WEEKS: 8,    // trailing COMPLETE weeks considered; 0 = all history
  // How the per-product daily burn-rate DENOMINATOR is measured:
  //   'available' — days the item was actually on the shelf: from its FIRST sale
  //                 inside the window through the window end. A SKU you only
  //                 started carrying 3 weeks ago divides by ~21 days, not 56.
  //   'calendar'  — flat window length for every product (old behavior).
  VELOCITY_ANCHOR: 'available'
};

// ════════════════════════════════════════════════════════════
//  §2  SHEET NAMES
// ════════════════════════════════════════════════════════════

var S = {
  INVENTORY:   '📋 CURRENT_INVENTORY',
  MASTER:      '📦 MASTER_SKU',
  DOS:         '🎯 DOS_TRACKER',
  RECEIPTS:    '📋 RECEIPT_HISTORY',   // NEW v4.3
  SETTINGS:    '⚙️ SETTINGS',
  PASTE_INV:   '📋 PASTE_INVENTORY',
  PASTE_SALES: '📋 PASTE_SALES',
  RISK:        '🚨 RISK_REPORT',
  DASHBOARD:   '📊 DASHBOARD',
  EXPIRY:      '⚠️ EXPIRY_RISK',      // NEW v4.4
  LAPSED:      '📋 LAPSED_BRANDS',     // OOS items from brands no longer in inventory
  TEMP:        '📥 TEMP_IMPORT',
  LOG:         '📜 IMPORT_LOG'
};

// ════════════════════════════════════════════════════════════
//  §3  EXPORT COLUMN MAPS  (0-indexed — raw Dutchie/Treez)
// ════════════════════════════════════════════════════════════

var CI = {
  LOCATION:0,ROOM:1,ALLOC_STATUS:2,PRODUCT:3,CATEGORY:4,
  QTY:5,PRICE:6,COST:7,WEIGHT:8,PRICING_TIER:9,
  VENDOR:10,PACKAGE_ID:11,BATCH:12,STRAIN:13,BRAND:14,
  EXP_DATE:15,USE_BY:16,AUDIT_DATE:17,EXT_ID:18
};

var DS = {
  LOCATION:0,CATEGORY:1,PRODUCT:2,BRAND:3,WEIGHT:4,
  CUST_TYPE:5,TXN_COUNT:6,QTY_SOLD:7,GROSS:8,DISCOUNT:9,
  LOYALTY:10,NET_SALES:11,COST:12,PROFIT:13,PCT_PROFIT:14,
  AVG_PRICE:15,AVG_PROFIT:16
};

// Receipt Report (Inventory Receipt Report — Detail)  NEW v4.3
var RR = {
  LOCATION:0, SKU:2, PRODUCT:3, CATEGORY:4, BRAND:5,
  PACKAGE_ID:6, EXT_PACKAGE_ID:7, RECEIVE_DATE:8,
  QUANTITY:9, UNIT:10, UNIT_COST:11, TOTAL_COST:12,
  VENDOR:18, ORDER_TITLE:19, ORDER_ID:20, STATUS:21
};

// Inventory Expirations export  NEW v4.4
var EX = {
  SKU:0, PRODUCT:1, PACKAGE:2, ROOM:3,
  QTY:4, UNIT:5, EXP_DATE:6, USE_BY:7
};

// ════════════════════════════════════════════════════════════
//  §4  INTERNAL COLUMN MAPS  (1-indexed)
//
//  RISK_REPORT — 18 columns (unchanged)
//
//  DOS_TRACKER — 18 columns  (v4.3 adds Vendor=17, LastRecv=18)
//  Row 1=Title  Row 2=Timestamp  Row 3=blank  Row 4=Header  Row 5+=Data
//
//   A=1 Priority      B=2 Status        C=3 Product       D=4 Category   E=5 Brand
//   F=6 Current DOS   G=7 Target Min    H=8 Target Max    I=9 Gap to Min
//   J=10 Arrives With K=11 Units to Order L=12 Reorder?   M=13 Burn Rate
//   N=14 Total Qty    O=15 Velocity     P=16 Inv Status
//   Q=17 Vendor       R=18 Last Recv (days)    ← NEW v4.3
// ════════════════════════════════════════════════════════════

var RC = {
  STATUS:1,VELOCITY:2,PRODUCT:3,CATEGORY:4,BRAND:5,
  TOTAL_QTY:6,FLOOR_QTY:7,BACKSTOCK_QTY:8,BURN_RATE:9,
  DAYS_OF_STOCK:10,FLOOR_DAYS:11,DAYS_TO_EXP:12,
  EARLIEST_EXP:13,BATCHES:14,ROOM_BREAKDOWN:15,
  VENDOR:16,COST_UNIT:17,DOLLAR_RISK:18,N:18
};

var DC = {
  PRIORITY:1, STATUS:2, PRODUCT:3, CATEGORY:4, BRAND:5,
  CURRENT_DOS:6, TARGET_MIN:7, TARGET_MAX:8, GAP:9,
  ARRIVES_WITH:10, UNITS_ORDER:11, REORDER:12, BURN_RATE:13,
  TOTAL_QTY:14, VELOCITY:15, INV_STATUS:16,
  VENDOR:17,       // most recent distributor from receipt history
  LAST_RECV:18,    // days since last received
  LAST_ORDER:19,   // qty in most recent order
  N:19, HEADER_ROW:4, DATA_START:5
};

// ════════════════════════════════════════════════════════════
//  §5  STATUS CONSTANTS
// ════════════════════════════════════════════════════════════

var ST = {
  EXPIRED:'❌ EXPIRED',PARTIAL:'⚠️ PARTIAL EXPIRED',
  WASTE:'🔥 WASTE RISK',DEAD:'🛑 DEAD STOCK',
  EXP_SOON:'⚠️ EXPIRING SOON',NO_EXP:'❓ NO EXP DATE',OK:'✅ OK',
  HOT:'🚀 HOT SELLER',SLOW:'🐌 SLOW MOVER',
  DOS_OOS:     '🚫 OUT OF STOCK', // zero units on hand — sort before CRITICAL
  DOS_CRITICAL:'🔴 CRITICAL',
  DOS_ORDER:   '🟠 ORDER NOW',
  DOS_AT:      '🟢 AT TARGET',
  DOS_OVER:    '🟡 OVER TARGET',
  DOS_NONE:    '❓ NO TARGET'
};

var STATUS_SORT={};
STATUS_SORT[ST.EXPIRED]=0;STATUS_SORT[ST.PARTIAL]=1;STATUS_SORT[ST.WASTE]=2;
STATUS_SORT[ST.DEAD]=3;STATUS_SORT[ST.EXP_SOON]=4;STATUS_SORT[ST.NO_EXP]=5;STATUS_SORT[ST.OK]=6;

var STATUS_COLORS={};
STATUS_COLORS[ST.EXPIRED] ={bg:'#fce4ec',fg:'#b71c1c'};STATUS_COLORS[ST.PARTIAL] ={bg:'#fce4ec',fg:'#c62828'};
STATUS_COLORS[ST.WASTE]   ={bg:'#fff3e0',fg:'#e65100'};STATUS_COLORS[ST.DEAD]    ={bg:'#fbe9e7',fg:'#bf360c'};
STATUS_COLORS[ST.EXP_SOON]={bg:'#fffde7',fg:'#f57f17'};STATUS_COLORS[ST.NO_EXP] ={bg:'#f3e5f5',fg:'#6a1b9a'};
STATUS_COLORS[ST.OK]      ={bg:'#e8f5e9',fg:'#2e7d32'};

var FLOOR_ROOMS    ={'sales floor':true};
var BACKSTOCK_ROOMS={'day vault':true,'vault':true,'holding':true,'reward program':true,'move from vault':true};
var DISPLAY_ROOMS  ={'boh display':true,'foh display':true};


// ════════════════════════════════════════════════════════════
//  §6  MENU
// ════════════════════════════════════════════════════════════

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🧰 Sell Through Tools')
    .addItem('⚙️ Initialize Workbook', 'initializeWorkbook')
    .addSeparator()
    .addItem('🔄 Weekly Update (paste sheets)', 'weeklyUpdate')
    .addItem('🧹 Clear Paste Sheets', 'clearPasteSheets')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('⚡ Advanced')
        .addItem('📥 Import Receipt History from Drive', 'importReceiptHistory')
        .addItem('📥 Import Expiry Report from Drive',   'importExpiryReport')
        .addSeparator()
        .addItem('📥 Import Inventory from Drive',   'importCurrentInventory')
        .addItem('📊 Pull Velocity from Product Pulse', 'pullVelocityFromPulse')
        .addSeparator()
        .addItem('🚨 Generate Risk Report',   'generateRiskReport')
        .addItem('🎯 Generate DOS Tracker',   'generateDosTracker')
        .addSeparator()
        .addItem('🔄 Full Pipeline', 'runFullPipeline')
    )
    .addToUi();
}


// ════════════════════════════════════════════════════════════
//  §7  WEB APP
// ════════════════════════════════════════════════════════════

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('DOS Tracker — The Travel Agency DTBK')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * getDashboardData() — read-only pull of DOS_TRACKER data.
 * Returns vendor and lastRecv (days) for each buy-list item (v4.3).
 */
function getDashboardData() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tz  = Session.getScriptTimeZone();
  var out = {
    refreshed:    Utilities.formatDate(new Date(), tz, 'MMM d, yyyy h:mm a'),
    dosGenerated: null, hasDos: false,
    summary: { oos:0, critical:0, order:0, at:0, over:0, noTarget:0 },
    buyList: [], accessoryList: [], overList: [], expiryList: [], categoriesFound: []
  };

  var dosSheet = ss.getSheetByName(S.DOS);
  if (!dosSheet || dosSheet.getLastRow() < DC.DATA_START) return out;

  var tsCell = dosSheet.getRange('A2').getValue();
  if (tsCell) out.dosGenerated = String(tsCell).replace(/^Generated:\s*/i,'').trim();
  out.hasDos = true;

  var data = dosSheet.getDataRange().getValues();

  // Build set of brands that have at least one non-OOS product currently in the tracker.
  // Used to flag whether an OOS product is from an actively-carried brand (real stockout)
  // or a brand where ALL products are missing (likely discontinued / dropped).
  var activeBrands = {};
  for (var ai = DC.DATA_START - 1; ai < data.length; ai++) {
    var aStatus = str_(data[ai][DC.STATUS - 1]);
    var aBrand  = str_(data[ai][DC.BRAND  - 1]);
    if (aBrand && aStatus !== ST.DOS_OOS) activeBrands[aBrand] = true;
  }

  for (var i = DC.DATA_START - 1; i < data.length; i++) {
    var row     = data[i];
    var dStatus = str_(row[DC.STATUS      -1]);
    var product = str_(row[DC.PRODUCT     -1]);
    var brand   = str_(row[DC.BRAND       -1]);
    var cat     = str_(row[DC.CATEGORY    -1]);
    var curDOS  = row[DC.CURRENT_DOS  -1];
    var tMin    = row[DC.TARGET_MIN   -1];
    var tMax    = row[DC.TARGET_MAX   -1];
    var gap     = row[DC.GAP          -1];
    var arrives = row[DC.ARRIVES_WITH -1];
    var units   = row[DC.UNITS_ORDER  -1];
    var burn    = row[DC.BURN_RATE    -1];
    var tQty    = row[DC.TOTAL_QTY    -1];
    var vel     = str_(row[DC.VELOCITY   -1]);
    var reorder = str_(row[DC.REORDER    -1]);
    var prio    = num_(row[DC.PRIORITY   -1]);
    var vendor   = str_(row[DC.VENDOR     -1]);
    var lastRv   = row[DC.LAST_RECV    -1];
    var lastOrd  = row[DC.LAST_ORDER   -1];

    if (!dStatus || !product) continue;

    if      (dStatus===ST.DOS_OOS)      out.summary.oos++;
    else if (dStatus===ST.DOS_CRITICAL) out.summary.critical++;
    else if (dStatus===ST.DOS_ORDER)    out.summary.order++;
    else if (dStatus===ST.DOS_AT)       out.summary.at++;
    else if (dStatus===ST.DOS_OVER)     out.summary.over++;
    else                                out.summary.noTarget++;

    if (reorder==='YES') {
      // OOS items from "brand gone" brands are excluded from the dashboard —
      // they're written to 📋 LAPSED_BRANDS in the spreadsheet instead.
      if (!(dStatus === ST.DOS_OOS && !activeBrands[brand])) {
        // Accessories split into their own list (separate from cannabis buy list)
        var isAccy = cat.toLowerCase().indexOf('accessor') > -1;
        var targetList = isAccy ? out.accessoryList : out.buyList;
        targetList.push({
          priority:    prio,  status:   dStatus,
          product:     product, brand:  brand, category: cat,
          currentDOS:  typeof curDOS  ==='number'?r1_(curDOS) :0,
          targetMin:   typeof tMin    ==='number'?tMin        :null,
          targetMax:   typeof tMax    ==='number'?tMax        :null,
          gap:         typeof gap     ==='number'?r1_(gap)    :null,
          arrivesWith: typeof arrives ==='number'?r1_(arrives):null,
          units:       units ||'',
          burnRate:    typeof burn    ==='number'?r4_(burn)   :0,
          totalQty:    num_(tQty),  velocity: vel,
          vendor:      vendor,
          lastRecv:    typeof lastRv ==='number'?lastRv :null,
          lastOrder:   typeof lastOrd==='number'?lastOrd:null,
          brandActive: activeBrands[brand] === true
        });
      }
    }
    if (dStatus===ST.DOS_OVER) {
      out.overList.push({
        product:product,brand:brand,category:cat,
        currentDOS:typeof curDOS ==='number'?r1_(curDOS):0,
        targetMax: typeof tMax   ==='number'?tMax       :null,
        gap:       typeof gap    ==='number'?r1_(gap)   :null,
        vendor:    vendor,
        lastRecv:  typeof lastRv ==='number'?lastRv :null,
        lastOrder: typeof lastOrd==='number'?lastOrd:null,
        brandActive: activeBrands[brand] === true
      });
    }
  }

  out.buyList.sort(function(a,b){return a.priority-b.priority;});
  out.accessoryList.sort(function(a,b){return a.priority-b.priority;});
  // Cap buyList to prevent payload bloat — filters narrow it further.
  // If the DOS_TRACKER has thousands of OOS rows from an old run,
  // this keeps the initial load fast. Re-run an update to regenerate.
  if (out.buyList.length > 500) {
    out.buyListCapped = true;
    out.buyListTotal  = out.buyList.length;
    out.buyList       = out.buyList.slice(0, 500);
  }
  // Sort most overstocked first. No server-side cap — client paginates.
  out.overList.sort(function(a,b){
    return(typeof b.gap==='number'?b.gap:0)-(typeof a.gap==='number'?a.gap:0);
  });

  // Populate expiryList from ⚠️ EXPIRY_RISK sheet
  // (processExpiryFromArray_ writes here when the user uploads the Expirations file)
  var exSheet = ss.getSheetByName(S.EXPIRY);
  if (exSheet && exSheet.getLastRow() > 1) {
    exSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      var product = str_(r[0]);
      if (!product) return;
      var days = typeof r[4] === 'number' ? r[4] : null;
      out.expiryList.push({
        product:   product,
        room:      str_(r[1]),
        qty:       num_(r[2]),
        expDate:   r[3] instanceof Date ? fmtDateShort_(r[3]) : str_(r[3]),
        daysUntil: days,
        status:    str_(r[5])
      });
    });
  }

  // Surface actual category names when products have no target
  if (out.summary.noTarget>0) {
    var masSheet=ss.getSheetByName(S.MASTER);
    if (masSheet&&masSheet.getLastRow()>1) {
      var catSet={};
      masSheet.getDataRange().getValues().slice(1).forEach(function(r){
        var c=str_(r[1]);if(c)catSet[c]=true;
      });
      out.categoriesFound=Object.keys(catSet).sort();
    }
  }
  return out;
}

/**
 * processUploadedData(invData, salesData)
 * Web-app entry point — must NOT call getUi().
 *
 * TIER-2: salesData is accepted for backward-compat with index.html but is
 * IGNORED — velocity is pulled from Product Pulse via buildMasterFromPulse_().
 */
function processUploadedData(invData, salesData, receiptData, expiryData) {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var invResult  =processInventoryFromArray_(invData,ss);
    var salesResult=buildMasterFromPulse_(ss);   // velocity from Pulse; salesData ignored
    if (!salesResult.ok) return{ok:false,error:salesResult.error};
    // Optional receipt data — process if provided, else keep existing RECEIPT_HISTORY
    var recResult = null;
    if (receiptData && receiptData.length > 5) {
      recResult = processReceiptFromArray(receiptData, ss);
    }
    // Optional expiry data — process if provided, else keep existing EXPIRY_RISK
    var expResult = null;
    if (expiryData && expiryData.length > 5) {
      expResult = processExpiryFromArray_(expiryData, ss);
    }
    var dosResult  =generateDosTrackerCore_(ss);
    if (!dosResult.ok)   return{ok:false,error:dosResult.error};

    logAction_('Upload & Update','Web App',
      invResult.imported+' inv | '+salesResult.weeks+'wk velocity | '+
      salesResult.days+'d | '+dosResult.oos+' OOS | '+dosResult.critical+' crit | '+dosResult.order+' order now');

    return{ok:true,
      summary:{
        invImported:invResult.imported,invSkipped:invResult.skipped,
        salesProducts:salesResult.products,salesDays:salesResult.days,
        salesFiles:salesResult.weeks,
        dateRange:salesResult.fromIso+' – '+salesResult.toIso,
        receiptImported: recResult ? recResult.imported : null,
        expiryImported:  expResult ? expResult.items     : null
      },
      data:getDashboardData()};
  } catch(ex){
    return{ok:false,error:ex.message||String(ex)};
  }
}


// ════════════════════════════════════════════════════════════
//  §8  ON EDIT
// ════════════════════════════════════════════════════════════

function onEdit(e) {
  var sheet=e.source.getActiveSheet();
  if(sheet.getName()!==S.RISK)return;
  var col=e.range.getColumn(),row=e.range.getRow();
  if(row<2)return;
  var watched=[RC.TOTAL_QTY,RC.FLOOR_QTY,RC.BURN_RATE,RC.EARLIEST_EXP];
  var hit=false;for(var w=0;w<watched.length;w++){if(col===watched[w]){hit=true;break;}}
  if(!hit)return;
  var cfg=loadSettings_(e.source.getSheetByName(S.SETTINGS));
  var today=today_();
  var vals=sheet.getRange(row,1,1,RC.N).getValues()[0];
  var tQty=num_(vals[RC.TOTAL_QTY-1]),fQty=num_(vals[RC.FLOOR_QTY-1]),burn=num_(vals[RC.BURN_RATE-1]);
  var cost=num_(vals[RC.COST_UNIT-1]),cat=str_(vals[RC.CATEGORY-1]);
  var expD=parseDate_(vals[RC.EARLIEST_EXP-1]);
  var dte=expD?Math.floor((expD.getTime()-today.getTime())/86400000):null;
  var calc=calcStatus_({totalQty:tQty,floorQty:fQty,burnRate:burn,costPerUnit:cost,daysToExp:dte,category:cat,noExpCats:cfg.noExpCats,expSoonDays:cfg.expSoonDays,hotSellerDays:cfg.hotSellerDays,slowMoverDays:cfg.slowMoverDays});
  sheet.getRange(row,RC.STATUS).setValue(calc.status);
  sheet.getRange(row,RC.VELOCITY).setValue(calc.velocityTag);
  sheet.getRange(row,RC.DAYS_OF_STOCK).setValue(calc.daysOfStock!==null?calc.daysOfStock:'N/A');
  sheet.getRange(row,RC.FLOOR_DAYS).setValue(calc.floorDaysOfStock!==null?calc.floorDaysOfStock:'N/A');
  sheet.getRange(row,RC.DAYS_TO_EXP).setValue(dte!==null?dte:'No data');
  sheet.getRange(row,RC.DOLLAR_RISK).setValue(calc.dollarRisk>0?calc.dollarRisk:'');
  var clr=STATUS_COLORS[calc.status]||{bg:'#ffffff',fg:'#000000'};
  sheet.getRange(row,1,1,RC.N).setBackground(clr.bg);
  sheet.getRange(row,RC.STATUS).setFontColor(clr.fg).setFontWeight('bold');
  applyVelocityColor_(sheet,row,RC.VELOCITY,calc.velocityTag);
}


// ════════════════════════════════════════════════════════════
//  §9  CORE PROCESSING  (no UI — safe from web app)
// ════════════════════════════════════════════════════════════

function processInventoryFromArray_(data2d, ss) {
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  var rows=data2d.slice(CONFIG.META_ROWS),output=[],skipped=0;
  for(var i=1;i<rows.length;i++){
    var r_=rows[i],product=str_(r_[CI.PRODUCT]);if(!product)continue;
    var room=str_(r_[CI.ROOM]),status=str_(r_[CI.ALLOC_STATUS]);
    if(cfg.excludeRooms[room.toLowerCase()]){skipped++;continue;}
    if(cfg.onlyStatus&&status.toLowerCase()!==cfg.onlyStatus.toLowerCase()){skipped++;continue;}
    var pLow=product.toLowerCase(),skip=false;
    for(var k=0;k<cfg.excludeNames.length;k++){if(pLow.indexOf(cfg.excludeNames[k])>-1){skip=true;break;}}
    if(skip){skipped++;continue;}
    output.push([product,str_(r_[CI.CATEGORY]),str_(r_[CI.BRAND]),str_(r_[CI.PACKAGE_ID]),room,
                 num_(r_[CI.QTY]),num_(r_[CI.PRICE]),num_(r_[CI.COST]),str_(r_[CI.VENDOR]),
                 r_[CI.EXP_DATE]||'',str_(r_[CI.BATCH])]);
  }
  var inv=getOrCreate_(ss,S.INVENTORY);clearData_(inv);
  if(output.length){
    inv.getRange(2,1,output.length,11).setValues(output);
    inv.getRange(2,6,output.length,1).setNumberFormat('#,##0');
    inv.getRange(2,7,output.length,2).setNumberFormat('$#,##0.00');
    inv.getRange(2,10,output.length,1).setNumberFormat('yyyy-mm-dd');
  }
  return{imported:output.length,skipped:skipped};
}

/**
 * buildMasterFromPulse_(ss)  — TIER-2 velocity source.
 *
 * Replaces "scan + blend Detailed Sales Breakdown files." Reads Product Pulse's
 * ProductWeekly tab and writes 📦 MASTER_SKU with a trailing-window daily burn
 * rate, in the SAME schema the rest of Sell Through already expects.
 *
 * Window = the most recent CONFIG.VELOCITY_WINDOW_WEEKS complete weeks in
 * ProductWeekly (0 = all weeks). Pulse only ingests complete Mon–Sun weeks.
 *
 * DENOMINATOR (CONFIG.VELOCITY_ANCHOR):
 *   'available' — Σqty ÷ DAYS ON SHELF, where days-on-shelf runs from the
 *                 product's FIRST selling week inside the window through the
 *                 window end. This is the sell-through-aware rate: a SKU first
 *                 stocked partway through the window is measured over the time
 *                 it was actually available, not the full window, so recently
 *                 added items no longer read artificially slow.
 *   'calendar'  — Σqty ÷ (weeks × 7) for every product (old flat behavior).
 *   Avg Price/Unit = Σnet ÷ Σqty.   Avg Profit/Unit = Σprofit ÷ Σqty.
 *
 * NOTE on zero-sale weeks AFTER a product's first sale: they are KEPT in the
 * denominator (conservative — won't inflate the rate or over-order). The
 * "sold out and needs reorder" case is handled separately downstream by the
 * receipt-cadence OOS logic in generateDosTrackerCore_.
 *
 * MASTER_SKU columns (1-indexed), unchanged so generateRiskReport_ /
 * generateDosTrackerCore_ keep reading it as-is:
 *   A Product  B Category  C Brand  D Total Qty Sold  E Lookback Days
 *   F Daily Burn Rate  G Avg Price/Unit  H Avg Profit/Unit  I Last Updated
 */
function buildMasterFromPulse_(ss) {
  if (!CONFIG.PULSE_SPREADSHEET_ID)
    return { ok:false, error:'Set CONFIG.PULSE_SPREADSHEET_ID to the Product Pulse data sheet ID.' };

  var pulse;
  try { pulse = SpreadsheetApp.openById(CONFIG.PULSE_SPREADSHEET_ID); }
  catch(e){ return { ok:false, error:'Cannot open Product Pulse sheet: '+(e.message||e) }; }

  var tab = pulse.getSheetByName(CONFIG.PULSE_PRODUCT_TAB);
  if (!tab || tab.getLastRow() < 2)
    return { ok:false, error:'ProductWeekly is empty in Product Pulse — run its import first.' };

  var vals = tab.getRange(2,1,tab.getLastRow()-1, tab.getLastColumn()).getValues();
  // ProductWeekly cols (0-based): 0 WeekStart 1 WeekEnd 2 CanonicalId 3 Category
  //   4 Product 5 Brand 6 Weight 7 TransactionCount 8 QuantitySold
  //   9 GrossSales 10 Discount 11 NetSales 12 Cost 13 Profit
  var W=0, CAT=3, PROD=4, BRAND=5, QTY=8, NET=11, PROFIT=13;

  // 1) distinct weeks, pick the trailing window
  var weekSet = {};
  for (var i=0;i<vals.length;i++){ var wk=pulseWeekIso_(vals[i][W]); if(wk) weekSet[wk]=true; }
  var allWeeks = Object.keys(weekSet).sort();                 // ascending ISO
  if (!allWeeks.length) return { ok:false, error:'No weeks found in ProductWeekly.' };
  var nWin = CONFIG.VELOCITY_WINDOW_WEEKS|0;
  var win  = (nWin>0 && nWin<allWeeks.length) ? allWeeks.slice(allWeeks.length-nWin) : allWeeks;
  var inWin={}; win.forEach(function(w){inWin[w]=true;});
  var windowDays = win.length * 7;
  var anchor = (CONFIG.VELOCITY_ANCHOR === 'calendar') ? 'calendar' : 'available';
  // position of each window week (0 = oldest) — used to find a product's first sale
  var winIdx = {}; win.forEach(function(w,i){ winIdx[w]=i; });

  // 2) aggregate by product name within the window; track FIRST selling week
  var map={};
  for (var j=0;j<vals.length;j++){
    var r=vals[j];
    var wkIso=pulseWeekIso_(r[W]);
    if(!inWin[wkIso]) continue;
    var prod=str_(r[PROD]); if(!prod||prod==='Total') continue;
    if(!map[prod]) map[prod]={cat:str_(r[CAT]),brand:str_(r[BRAND]),qty:0,net:0,profit:0,firstIdx:null};
    var e=map[prod];
    var q=num_(r[QTY]);
    e.qty+=q; e.net+=num_(r[NET]); e.profit+=num_(r[PROFIT]);
    if(str_(r[CAT]))   e.cat=str_(r[CAT]);
    if(str_(r[BRAND])) e.brand=str_(r[BRAND]);
    if(q>0){ var wi=winIdx[wkIso]; if(e.firstIdx===null||wi<e.firstIdx) e.firstIdx=wi; }
  }

  // 3) write MASTER_SKU (same schema/formatting as the old file-scan path).
  //    Per-product denominator = days the item was actually on the shelf.
  var products=Object.keys(map).sort(), now=new Date(), out=[];
  products.forEach(function(p){
    var e=map[p];
    // 'available': from first selling week through window end.  'calendar': full window.
    var availWeeks = (anchor==='available' && e.firstIdx!==null)
        ? (win.length - e.firstIdx)
        : win.length;
    if (availWeeks < 1) availWeeks = 1;
    var dDays = availWeeks * 7;
    out.push([p, e.cat, e.brand, e.qty, dDays,
              dDays>0 ? r4_(e.qty/dDays) : 0,
              e.qty>0 ? r2_(e.net/e.qty)    : 0,
              e.qty>0 ? r2_(e.profit/e.qty) : 0, now]);
  });
  var mas=getOrCreate_(ss,S.MASTER); clearData_(mas);
  if(out.length){
    mas.getRange(2,1,out.length,9).setValues(out);
    mas.getRange(2,4,out.length,2).setNumberFormat('#,##0');
    mas.getRange(2,6,out.length,1).setNumberFormat('#,##0.0000');
    mas.getRange(2,7,out.length,2).setNumberFormat('$#,##0.00');
    mas.getRange(2,9,out.length,1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  logAction_('Velocity from Pulse', CONFIG.PULSE_PRODUCT_TAB,
    products.length+' products | '+win.length+'-wk window | '+anchor+' denom | '+win[0]+'..'+win[win.length-1]);
  return { ok:true, products:products.length, days:windowDays, weeks:win.length,
           anchor:anchor, fromIso:win[0], toIso:win[win.length-1] };
}

/** WeekStart in ProductWeekly may come back as a Date or a 'yyyy-MM-dd' string. */
function pulseWeekIso_(v){
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v||'').slice(0,10);
}

/** Menu/web entry: pull velocity from Product Pulse into 📦 MASTER_SKU. */
function pullVelocityFromPulse(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var res=buildMasterFromPulse_(ss);
  if(!res.ok){ui.alert('❌',res.error,ui.ButtonSet.OK);return;}
  var denomLine = (res.anchor==='available')
    ? 'Burn rate = units ÷ days on shelf (per product, from first sale in window)'
    : 'Burn rate = units ÷ '+res.days+' days (flat window)';
  ui.alert('✅ Velocity Updated from Product Pulse',
    res.products+' products\n'+res.weeks+'-week window ('+res.fromIso+' → '+res.toIso+')\n'+
    denomLine+'\n\n→ 📦 MASTER_SKU\nRun Generate DOS Tracker to apply.',
    ui.ButtonSet.OK);
}

/**
 * processSalesWithHistory_(uploadedData2D, ss)            DORMANT (pre-tier-2)
 * Combines the uploaded file with ALL Drive historical files.
 * Deduplicates overlapping date ranges, calculates YTD burn rates.
 * Retained as a one-line rollback path — buildMasterFromPulse_ is the live one.
 */
function processSalesWithHistory_(uploadedData2D, ss) {
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  var uploadedDR=extractDateRange_(uploadedData2D);
  if(!uploadedDR.fromDate||!uploadedDR.toDate) return processSalesFromArray_(uploadedData2D,ss);

  var pool=[{name:'Uploaded ('+fmtDateShort_(uploadedDR.fromDate)+' – '+fmtDateShort_(uploadedDR.toDate)+')',
             raw:uploadedData2D,fromDate:uploadedDR.fromDate,toDate:uploadedDR.toDate}];

  var driveFiles=[];
  try{driveFiles=findAllFiles_(cfg.patSales);}catch(ex){Logger.log('Drive scan skipped: '+ex.message);}
  for(var f=0;f<driveFiles.length;f++){
    try{var raw=readDriveFile_(driveFiles[f]),dr=extractDateRange_(raw);
        if(dr.fromDate&&dr.toDate)pool.push({name:driveFiles[f].getName(),raw:raw,fromDate:dr.fromDate,toDate:dr.toDate});}
    catch(ex){Logger.log('Skip '+driveFiles[f].getName()+': '+ex.message);}
  }

  pool.sort(function(a,b){return a.fromDate-b.fromDate;});
  var accepted=[],skippedNames=[];
  for(var i=0;i<pool.length;i++){
    var fi=pool[i],hasOv=false;
    for(var j=0;j<accepted.length;j++){
      if(datesOverlap_(fi.fromDate,fi.toDate,accepted[j].fromDate,accepted[j].toDate)){
        var fd=Math.floor((fi.toDate-fi.fromDate)/86400000)+1,ad=Math.floor((accepted[j].toDate-accepted[j].fromDate)/86400000)+1;
        if(fd>ad){skippedNames.push(accepted[j].name);accepted[j]=fi;}else skippedNames.push(fi.name);
        hasOv=true;break;
      }
    }
    if(!hasOv)accepted.push(fi);
  }

  var totalDays=totalCalendarDays_(accepted.map(function(a){return{from:a.fromDate,to:a.toDate};}));
  var salesMap={},totalRows=0;
  for(var ai=0;ai<accepted.length;ai++){
    var rows=accepted[ai].raw.slice(CONFIG.META_ROWS),hdrIdx=0;
    for(var h=0;h<Math.min(rows.length,3);h++){var s=rows[h].join('|').toLowerCase();if(s.indexOf('product')>-1&&(s.indexOf('quantitysold')>-1||s.indexOf('category')>-1)){hdrIdx=h;break;}}
    for(var ri=hdrIdx+1;ri<rows.length;ri++){
      var r_=rows[ri],product=str_(r_[DS.PRODUCT]),cat=str_(r_[DS.CATEGORY]);
      if(!product||product.toLowerCase()==='total')continue;if(cat.toLowerCase()==='total')continue;
      var qty=Math.abs(num_(r_[DS.QTY_SOLD]));
      if(!salesMap[product])salesMap[product]={qty:0,cat:cat,brand:str_(r_[DS.BRAND]),priceSum:0,profitSum:0,count:0};
      var e_=salesMap[product];e_.qty+=qty;e_.priceSum+=num_(r_[DS.AVG_PRICE]);e_.profitSum+=num_(r_[DS.AVG_PROFIT]);e_.count++;totalRows++;
    }
  }
  if(totalRows===0)return{ok:false,error:'No sales data rows found in any file.'};

  var products=Object.keys(salesMap).sort(),now=new Date(),mRows=[];
  products.forEach(function(p){
    var e_=salesMap[p];
    mRows.push([p,e_.cat,e_.brand,e_.qty,totalDays,r4_(e_.qty/totalDays),
                e_.count>0?r2_(e_.priceSum/e_.count):0,e_.count>0?r2_(e_.profitSum/e_.count):0,now]);
  });
  var mas=getOrCreate_(ss,S.MASTER);clearData_(mas);
  if(mRows.length){
    mas.getRange(2,1,mRows.length,9).setValues(mRows);
    mas.getRange(2,4,mRows.length,2).setNumberFormat('#,##0');
    mas.getRange(2,6,mRows.length,1).setNumberFormat('#,##0.0000');
    mas.getRange(2,7,mRows.length,2).setNumberFormat('$#,##0.00');
    mas.getRange(2,9,mRows.length,1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  var oFrom=accepted[0].fromDate,oTo=accepted[0].toDate;
  accepted.forEach(function(a){if(a.fromDate<oFrom)oFrom=a.fromDate;if(a.toDate>oTo)oTo=a.toDate;});
  if(skippedNames.length)Logger.log('Dedup: skipped '+skippedNames.join(', '));
  logAction_('Sales (upload+Drive)',accepted.length+' files | '+totalDays+'d',products.length+' products');
  return{ok:true,products:products.length,days:totalDays,files:accepted.length,fromDate:oFrom,toDate:oTo};
}

function processSalesFromArray_(data2d,ss){
  var dr=extractDateRange_(data2d);
  if(!dr.fromDate||!dr.toDate)return{ok:false,error:'Could not read date range from the sales export.'};
  var totalDays=Math.max(1,Math.floor((dr.toDate.getTime()-dr.fromDate.getTime())/86400000)+1);
  var rows=data2d.slice(CONFIG.META_ROWS),salesMap={},totalRows=0,hdrIdx=0;
  for(var h=0;h<Math.min(rows.length,3);h++){var s=rows[h].join('|').toLowerCase();if(s.indexOf('product')>-1&&(s.indexOf('quantitysold')>-1||s.indexOf('category')>-1)){hdrIdx=h;break;}}
  for(var i=hdrIdx+1;i<rows.length;i++){
    var r_=rows[i],p=str_(r_[DS.PRODUCT]),c=str_(r_[DS.CATEGORY]);
    if(!p||p.toLowerCase()==='total'||c.toLowerCase()==='total')continue;
    var qty=Math.abs(num_(r_[DS.QTY_SOLD]));
    if(!salesMap[p])salesMap[p]={qty:0,cat:c,brand:str_(r_[DS.BRAND]),priceSum:0,profitSum:0,count:0};
    var e_=salesMap[p];e_.qty+=qty;e_.priceSum+=num_(r_[DS.AVG_PRICE]);e_.profitSum+=num_(r_[DS.AVG_PROFIT]);e_.count++;totalRows++;
  }
  if(totalRows===0)return{ok:false,error:'No sales data rows found.'};
  var products=Object.keys(salesMap).sort(),now=new Date(),mRows=[];
  products.forEach(function(p){var e_=salesMap[p];mRows.push([p,e_.cat,e_.brand,e_.qty,totalDays,r4_(e_.qty/totalDays),e_.count>0?r2_(e_.priceSum/e_.count):0,e_.count>0?r2_(e_.profitSum/e_.count):0,now]);});
  var mas=getOrCreate_(ss,S.MASTER);clearData_(mas);
  if(mRows.length){mas.getRange(2,1,mRows.length,9).setValues(mRows);mas.getRange(2,4,mRows.length,2).setNumberFormat('#,##0');mas.getRange(2,6,mRows.length,1).setNumberFormat('#,##0.0000');mas.getRange(2,7,mRows.length,2).setNumberFormat('$#,##0.00');mas.getRange(2,9,mRows.length,1).setNumberFormat('yyyy-mm-dd hh:mm');}
  return{ok:true,products:products.length,days:totalDays,files:1,fromDate:dr.fromDate,toDate:dr.toDate};
}

/**
 * processReceiptFromArray(data2d, ss)                     NEW v4.3
 *
 * Aggregates an Inventory Receipt Report export into 📋 RECEIPT_HISTORY.
 * One row per product — vendor (most recent distributor), last received
 * date, average order quantity, and YTD totals.
 *
 * Skips sample rows (product name contains *sample*, unit cost = 0).
 * For products ordered from multiple vendors, uses the most recent vendor.
 *
 * RECEIPT_HISTORY columns (1-indexed):
 *   A=1 Product   B=2 Category   C=3 Brand   D=4 Vendor (most recent)
 *   E=5 Last Received Date   F=6 Days Since Received
 *   G=7 Avg Order Qty   H=8 Total Orders   I=9 Total Units YTD
 *   J=10 Avg Unit Cost   K=11 Updated
 */
function processReceiptFromArray(data2d, ss) {
  var rows  = data2d.slice(CONFIG.META_ROWS);  // rows[0] = column header
  var today = today_();

  // Step 1 — aggregate by (product, orderTitle) to get qty per order per product
  // Multiple packages of the same SKU on the same order are separate rows.
  var orderMap = {};
  for (var i = 1; i < rows.length; i++) {
    var r_      = rows[i];
    var product = str_(r_[RR.PRODUCT]);
    if (!product) continue;
    // Skip samples (zero-cost SAMPLE items)
    if (product.toLowerCase().indexOf('*sample*') > -1) continue;
    var unitCost = num_(r_[RR.UNIT_COST]);
    if (unitCost === 0) continue;

    var orderTitle  = str_(r_[RR.ORDER_TITLE]) || 'ORDER';
    var receiveDate = parseDate_(r_[RR.RECEIVE_DATE]);
    var qty         = num_(r_[RR.QUANTITY]);
    if (qty <= 0) continue;

    var key = product + '|||' + orderTitle;
    if (!orderMap[key]) {
      orderMap[key] = {
        product:     product,
        cat:         str_(r_[RR.CATEGORY]),
        brand:       str_(r_[RR.BRAND]),
        vendor:      str_(r_[RR.VENDOR]),
        receiveDate: receiveDate,
        qty:         0,
        cost:        unitCost
      };
    }
    orderMap[key].qty += qty;
    if (receiveDate && (!orderMap[key].receiveDate || receiveDate > orderMap[key].receiveDate)) {
      orderMap[key].receiveDate = receiveDate;
      orderMap[key].vendor = str_(r_[RR.VENDOR]);  // most recent vendor for this order
    }
  }

  // Step 2 — aggregate by product across all orders
  var productMap = {};
  Object.keys(orderMap).forEach(function(key) {
    var o = orderMap[key];
    var p = o.product;
    if (!productMap[p]) {
      productMap[p] = {
        cat:          o.cat,
        brand:        o.brand,
        firstDate:    null,     // earliest receive — enables avgCadence (was never set)
        lastDate:     null,
        vendor:       '',
        lastOrderQty: 0,        // qty from the single most recent order
        orderQtys:    [],
        totalQty:     0,
        costSum:      0,
        costCount:    0
      };
    }
    var pm = productMap[p];
    pm.orderQtys.push(o.qty);
    pm.totalQty += o.qty;
    if (o.cost > 0) { pm.costSum += o.cost; pm.costCount++; }
    if (o.receiveDate) {
      if (!pm.lastDate || o.receiveDate > pm.lastDate) {
        pm.lastDate     = o.receiveDate;
        pm.vendor       = o.vendor;   // vendor from the most recent receipt
        pm.lastOrderQty = o.qty;      // qty of the most recent order (was never set → always 0)
      }
      if (!pm.firstDate || o.receiveDate < pm.firstDate) {
        pm.firstDate = o.receiveDate; // earliest receive — feeds cadence math below
      }
    }
  });

  // Step 3 — write to RECEIPT_HISTORY
  var products = Object.keys(productMap).sort(), now = new Date(), output = [];
  products.forEach(function(p) {
    var pm       = productMap[p];
    var n        = pm.orderQtys.length;
    var avgQty   = n > 0 ? Math.round(pm.orderQtys.reduce(function(a,b){return a+b;},0)/n) : 0;
    var avgCost  = pm.costCount > 0 ? r2_(pm.costSum/pm.costCount) : 0;
    var daysSince = pm.lastDate
      ? Math.floor((today.getTime()-pm.lastDate.getTime())/86400000)
      : null;
    // Cadence = average days between orders, computed from actual date range
    // Requires ≥2 orders and both firstDate + lastDate to be valid
    var avgCadence = null;
    if (n >= 2 && pm.firstDate && pm.lastDate && pm.lastDate > pm.firstDate) {
      var rangeDays = Math.round((pm.lastDate.getTime()-pm.firstDate.getTime())/86400000);
      avgCadence    = Math.max(1, Math.round(rangeDays / (n - 1)));
    }
    output.push([
      p, pm.cat, pm.brand, pm.vendor,
      pm.lastDate||'',
      daysSince!==null?daysSince:'—',
      avgQty, n, pm.totalQty, avgCost,
      pm.lastOrderQty || 0,   // col K
      avgCadence  || '—',     // col L — avg days between orders (cadence)
      now                      // col M
    ]);
  });

  var recSheet = getOrCreate_(ss, S.RECEIPTS);
  clearData_(recSheet);
  if (output.length) {
    recSheet.getRange(2,1,output.length,13).setValues(output);
    recSheet.getRange(2,5,output.length,1).setNumberFormat('yyyy-mm-dd');
    recSheet.getRange(2,6,output.length,1).setNumberFormat('#,##0');
    recSheet.getRange(2,7,output.length,2).setNumberFormat('#,##0');
    recSheet.getRange(2,9,output.length,1).setNumberFormat('#,##0');
    recSheet.getRange(2,10,output.length,1).setNumberFormat('$#,##0.00');
    recSheet.getRange(2,12,output.length,1).setNumberFormat('#,##0');    // avgCadence
    recSheet.getRange(2,13,output.length,1).setNumberFormat('yyyy-mm-dd hh:mm');
  }

  logAction_('Receipt History','Drive',products.length+' products | '+Object.keys(orderMap).length+' orders');
  return { imported: products.length, orders: Object.keys(orderMap).length };
}

/**
 * processExpiryFromArray_(data2d, ss)                     NEW v4.4
 *
 * Aggregates an Inventory Expirations export into ⚠️ EXPIRY_RISK.
 * Each row represents one batch/package expiring in the report window.
 * Products in Quarantine that are expired = confirmed overstock waste.
 *
 * EXPIRY_RISK columns (1-indexed):
 *   A=1 Product   B=2 Room   C=3 Qty   D=4 Expiry Date
 *   E=5 Days Until (negative = already expired)   F=6 Status
 */
function processExpiryFromArray_(data2d, ss) {
  var rows  = data2d.slice(CONFIG.META_ROWS);  // rows[0] = column header
  var today = today_();
  var output = [];

  for (var i = 1; i < rows.length; i++) {
    var r_      = rows[i];
    var product = str_(r_[EX.PRODUCT]);
    if (!product) continue;
    var qty     = num_(r_[EX.QTY]);
    var room    = str_(r_[EX.ROOM]);
    var expDate = parseDate_(r_[EX.EXP_DATE]);
    if (!expDate && r_[EX.USE_BY]) expDate = parseDate_(r_[EX.USE_BY]);

    var daysUntil = expDate
      ? Math.floor((expDate.getTime() - today.getTime()) / 86400000)
      : null;

    var status;
    if      (daysUntil === null)  status = '❓ NO DATE';
    else if (daysUntil <  -30)   status = '❌ EXPIRED (>30d ago)';
    else if (daysUntil <   0)    status = '❌ EXPIRED';
    else if (daysUntil === 0)    status = '🔴 EXPIRES TODAY';
    else if (daysUntil <=  7)    status = '🟠 EXPIRES THIS WEEK';
    else                         status = '⚠️ EXPIRING SOON';

    output.push([product, room, qty, expDate||'', daysUntil!==null?daysUntil:'—', status]);
  }

  // Sort most urgent first (lowest daysUntil, treating null as 9999)
  output.sort(function(a, b) {
    var da = typeof a[4]==='number' ? a[4] : 9999;
    var db = typeof b[4]==='number' ? b[4] : 9999;
    return da - db;
  });

  var exSheet = getOrCreate_(ss, S.EXPIRY);
  clearData_(exSheet);
  if (output.length) {
    exSheet.getRange(2,1,output.length,6).setValues(output);
    exSheet.getRange(2,4,output.length,1).setNumberFormat('yyyy-mm-dd');
  }

  var expired = output.filter(function(r){return r[5].indexOf('EXPIRED')>-1;}).length;
  logAction_('Expiry Risk','',output.length+' items | '+expired+' already expired');
  return { items: output.length, expired: expired };
}

/**
 * generateDosTrackerCore_(ss)
 *
 * v4.2 REORDER POINT LOGIC:
 *   DOS < Lead Time          → 🔴 CRITICAL
 *   Lead Time ≤ DOS < T + L  → 🟠 ORDER NOW
 *   T + L ≤ DOS ≤ Max        → 🟢 AT TARGET
 *   DOS > Max                → 🟡 OVER TARGET
 *
 * v4.3 adds Vendor (col 17) and Last Recv days (col 18) from
 * 📋 RECEIPT_HISTORY when available. No receipt data = blank cells.
 *
 * UNITS TO ORDER = ceil( Target Min × Burn Rate − Total Qty )
 */
function generateDosTrackerCore_(ss) {
  var invSheet    = ss.getSheetByName(S.INVENTORY);
  var masterSheet = ss.getSheetByName(S.MASTER);
  var dosSheet    = getOrCreate_(ss, S.DOS);
  var setSheet    = ss.getSheetByName(S.SETTINGS);
  var riskSheet   = ss.getSheetByName(S.RISK);

  if (!invSheet||invSheet.getLastRow()<2)    return{ok:false,error:'No inventory. Run an update first.'};
  if (!masterSheet||masterSheet.getLastRow()<2) return{ok:false,error:'No burn rates. Run an update first.'};

  var catTargets   = getDOSCategoryTargets_(setSheet);
  var brandTargets = getDOSBrandOverrides_(setSheet);
  var leadTime     = getSetting_(setSheet,'Lead Time',14);
  if (typeof leadTime!=='number'||leadTime<0) leadTime=14;

  var burnMap={};
  masterSheet.getDataRange().getValues().slice(1).forEach(function(r){
    var p=str_(r[0]);if(p)burnMap[p]={rate:num_(r[5]),cat:str_(r[1]),brand:str_(r[2])};
  });

  // v4.3 — load receipt history for vendor + last-received enrichment
  var receiptMap = {};
  var recSheet = ss.getSheetByName(S.RECEIPTS);
  if (recSheet && recSheet.getLastRow() > 1) {
    recSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      var p = str_(r[0]);
      if (p) {
        var rEntry = {
          vendor:       str_(r[3]),
          daysSince:    typeof r[5]  ==='number' ? r[5]  : null,
          totalOrders:  typeof r[7]  ==='number' ? r[7]  : null,  // col H
          lastOrderQty: typeof r[10] ==='number' ? r[10] : null,  // col K
          avgCadence:   typeof r[11] ==='number' ? r[11] : null   // col L — days between orders
        };
        receiptMap[p]                 = rEntry;  // exact name
        receiptMap[normalizeName_(p)] = rEntry;  // normalized name (catches variants)
      }
    });
  }

  var EXCL={};EXCL[ST.EXPIRED]=true;EXCL[ST.PARTIAL]=true;EXCL[ST.DEAD]=true;
  var statusMap={};
  if(riskSheet&&riskSheet.getLastRow()>1){
    riskSheet.getDataRange().getValues().slice(1).forEach(function(r){
      var p=str_(r[RC.PRODUCT-1]);if(p)statusMap[p]={status:str_(r[RC.STATUS-1]),velocity:str_(r[RC.VELOCITY-1])};
    });
  }

  var productMap={};
  invSheet.getDataRange().getValues().slice(1).forEach(function(ri){
    var prod=str_(ri[0]);if(!prod)return;
    var qty=num_(ri[5]);
    if(!productMap[prod])productMap[prod]={totalQty:0,category:str_(ri[1]),brand:str_(ri[2])};
    productMap[prod].totalQty+=qty;
    if(burnMap[prod]){if(burnMap[prod].cat)productMap[prod].category=burnMap[prod].cat;if(burnMap[prod].brand)productMap[prod].brand=burnMap[prod].brand;}
  });

  // OOS detection: products in MASTER_SKU that are NOT in CURRENT_INVENTORY.
  // Dutchie only exports items with stock — a missing product = completely OOS.
  //
  // LOOKBACK THRESHOLD: Only flag as OOS if the product has sold at least
  // 1 unit within the last N days on average. This prevents discontinued /
  // rarely-sold products from polluting the OOS list.
  //   burnRate ≥ 1/N  →  sold at least once per N days on average
  // Configurable via "OOS Lookback (days)" in ⚙️ SETTINGS (default: 7).
  // At 7 days: burnRate >= 1/7 = 0.143/day → must average ≥1 sale/week.
  // At 858 days of history that means ≥123 units sold total — genuine movers only.
  // Raise to 14 (bi-weekly), 30 (monthly), or 60 (every 2 months) to widen scope.
  var oosLookback = getSetting_(setSheet, 'OOS Lookback (days)', 7);
  var oosMinRate  = oosLookback > 0 ? 1 / oosLookback : 0;

  // Auto-write the setting to SETTINGS if the row doesn't exist yet
  // (so users don't need to re-run Initialize Workbook to see/tune it).
  if (setSheet) {
    var settingExists = false;
    var setData = setSheet.getDataRange().getValues();
    for (var si = 0; si < setData.length; si++) {
      if (String(setData[si][0]).toLowerCase().indexOf('oos lookback') > -1) {
        settingExists = true; break;
      }
    }
    if (!settingExists) {
      // Find the Lead Time row and insert OOS Lookback right after it
      var insertRow = -1;
      for (var si2 = 0; si2 < setData.length; si2++) {
        if (String(setData[si2][0]).toLowerCase().indexOf('lead time') > -1) {
          insertRow = si2 + 2; break; // 1-indexed, +1 for next row
        }
      }
      if (insertRow > 0) {
        setSheet.insertRowAfter(insertRow - 1);
        setSheet.getRange(insertRow, 1, 1, 3).setValues([[
          'OOS Lookback (days)', 7,
          'Only flag OOS if burn rate ≥ 1 sale per N days. Lower = fewer, stricter OOS. 7=weekly, 14=bi-weekly, 30=monthly. Default: 7.'
        ]]);
        setSheet.getRange(insertRow, 1, 1, 3).setBackground('#e8f5e9');
      } else {
        setSheet.appendRow([
          'OOS Lookback (days)', 7,
          'Only flag OOS if burn rate ≥ 1 sale per N days. Lower = fewer, stricter OOS. 7=weekly, 14=bi-weekly, 30=monthly. Default: 7.'
        ]);
      }
    }
  }

  // Read the same exclusion list used in processInventoryFromArray_
  // so that samples, display products, etc. are also excluded from OOS.
  var oosExcludeStr = getSetting_(setSheet, 'Exclude Product Names Containing', 'sample');
  var oosExclude = oosExcludeStr.split(',').map(function(k){return k.trim().toLowerCase();}).filter(Boolean);

  // Receipt history cross-reference — the most reliable way to separate
  // "genuinely OOS active product" from "discontinued / dropped SKU."
  //
  // If RECEIPT_HISTORY has data, only flag OOS products that were also
  // received within the last N days. Products not in receipt history (or
  // received more than N days ago) are almost certainly discontinued or
  // intentionally dropped — NOT a replenishment concern.
  //
  // "OOS Receipt Window (days)" in ⚙️ SETTINGS — default 90.
  // Set to 0 to disable the receipt check and use burn rate alone.
  //
  // Graceful fallback: if no receipt data exists (sheet empty or not yet
  // imported), behaves exactly as before — burn rate threshold only.
  var hasReceiptData = Object.keys(receiptMap).length > 0;
  var oosRecvWindow  = hasReceiptData
    ? getSetting_(setSheet, 'OOS Receipt Window (days)', 90)
    : 0;

  // Auto-write the setting if it doesn't exist yet
  if (hasReceiptData && setSheet) {
    var recvSettingExists = false;
    var setDataRv = setSheet.getDataRange().getValues();
    for (var rv = 0; rv < setDataRv.length; rv++) {
      if (String(setDataRv[rv][0]).toLowerCase().indexOf('oos receipt window') > -1) {
        recvSettingExists = true; break;
      }
    }
    if (!recvSettingExists) {
      setSheet.appendRow([
        'OOS Receipt Window (days)', 90,
        'OOS cross-reference: only flag products received within the last N days. ' +
        'Filters out discontinued / dropped SKUs that still have burn rate history. ' +
        'Set to 0 to disable. Default: 90.'
      ]);
    }
  }

  masterSheet.getDataRange().getValues().slice(1).forEach(function(r){
    var p = str_(r[0]);
    if (!p || productMap[p] || !burnMap[p] || burnMap[p].rate < oosMinRate) return;

    // Name exclusion — skip samples, display items, etc.
    var pLow = p.toLowerCase();
    for (var k = 0; k < oosExclude.length; k++) {
      if (pLow.indexOf(oosExclude[k]) > -1) return;
    }

    // ── DISCONTINUED vs OOS DEFINITION ────────────────────────────────────────
    // Sell-through window = lastOrderQty ÷ burnRate (how long the last order lasted).
    // Time OOS = daysSince − sellThroughWindow.
    //
    // Rule: if (timeOOS > sellThroughWindow) → discontinued, not a real stockout.
    //   Equivalent to: daysSince > 2 × sellThroughWindow
    //
    // Example: 50 units received 120d ago, burnRate=1/d → window=50d.
    //   Sold through at day 50, OOS for 70d. 70d > 50d → discontinued.
    //   Same product received 60d ago → OOS for 10d < 50d → genuine OOS. ✓
    //
    // Fallback (no lastOrderQty): dynamic cadence window (cadence × 2).
    // Floor of 7 days prevents extreme short windows on tiny orders.
    var recv = receiptMap[p] || receiptMap[normalizeName_(p)];
    if (!recv || recv.daysSince === null) return;  // no receipt data → exclude

    // ── CADENCE-BASED DISCONTINUED DEFINITION ──────────────────────────────────
    // A product is genuinely OOS (needs reordering) if the time it's been at
    // zero is less than its typical reorder cadence.
    //
    //   timeOOS        = daysSince − sellThruDays
    //   avgCadence     = actual avg days between this product's historical orders
    //   discontinued if: timeOOS > avgCadence
    //
    // Example: ordered every 30 days, 40u last order at 1/day, received 55d ago
    //   sellThru = 40d → timeOOS = 15d → 15 < 30 → genuine OOS ✓
    //
    // Example: same product, received 85d ago
    //   timeOOS = 45d → 45 > 30 → missed a full reorder cycle → DISCONTINUED ✓
    //
    // Fallback (only 1 order, or no cadence data): oosRecvWindow setting (default 90d)
    var sellThruDays = (recv.lastOrderQty && recv.lastOrderQty > 0)
      ? Math.max(7, recv.lastOrderQty / burnMap[p].rate)
      : 0;
    var timeOOS = Math.max(0, recv.daysSince - sellThruDays);

    var effectiveWindow = (recv.avgCadence && recv.avgCadence > 0 && recv.totalOrders >= 2)
      ? recv.avgCadence    // product's actual ordering cadence
      : oosRecvWindow;     // fallback for single-order or missing data

    if (timeOOS > effectiveWindow) return;  // missed a reorder cycle → discontinued

    // Passes all filters → genuinely OOS active product
    productMap[p] = { totalQty:0, category:burnMap[p].cat||'', brand:burnMap[p].brand||'' };
  });

  var items=[];
  Object.keys(productMap).sort().forEach(function(pn){
    var p=productMap[pn],bm=burnMap[pn],burnRate=bm?bm.rate:0;
    if(burnRate===0)return;
    var sm=statusMap[pn];if(sm&&EXCL[sm.status])return;
    var cat=p.category,brand=p.brand;
    var currentDOS  = r1_(p.totalQty/burnRate);
    var arrivesWith = r1_(currentDOS-leadTime);
    var velocity    = sm?sm.velocity:'';
    var invStatus   = sm?sm.status:ST.OK;

    var target=null;
    if(brand&&brandTargets[brand.toLowerCase()])target=brandTargets[brand.toLowerCase()];
    else if(cat&&catTargets[cat.toLowerCase()])  target=catTargets[cat.toLowerCase()];
    var targetMin=target?target.min:null,targetMax=target?target.max:null;
    var gap=targetMin!==null?r1_(currentDOS-targetMin):null;

    var dosStatus;
    if      (p.totalQty === 0)           dosStatus=ST.DOS_OOS;     // no units on hand
    else if (targetMin===null)           dosStatus=ST.DOS_NONE;
    else if (currentDOS<leadTime)        dosStatus=ST.DOS_CRITICAL;
    else if (currentDOS<targetMin+leadTime) dosStatus=ST.DOS_ORDER;
    else if (targetMax!==null&&currentDOS>targetMax) dosStatus=ST.DOS_OVER;
    else                                 dosStatus=ST.DOS_AT;

    var unitsToOrder='';
    if((dosStatus===ST.DOS_OOS||dosStatus===ST.DOS_CRITICAL||dosStatus===ST.DOS_ORDER)&&targetMin!==null)
      unitsToOrder=Math.max(1,Math.ceil(targetMin*burnRate-p.totalQty));

    // v4.3 — enrich from receipt history
    // Try exact name first, then normalized name to catch minor Dutchie variations
    var recv         = receiptMap[pn] || receiptMap[normalizeName_(pn)] || {};
    var vendor       = recv.vendor       || '';
    var daysSince    = recv.daysSince    !== undefined ? recv.daysSince    : null;
    var lastOrderQty = recv.lastOrderQty !== undefined ? recv.lastOrderQty : null;

    items.push({
      dosStatus:dosStatus,product:pn,cat:cat,brand:brand,
      currentDOS:currentDOS,
      targetMin:targetMin!==null?targetMin:'—',
      targetMax:targetMax!==null?targetMax:'—',
      gap:gap!==null?gap:'—',
      arrivesWith:arrivesWith,
      unitsToOrder:unitsToOrder,
      reorder:(dosStatus===ST.DOS_OOS||dosStatus===ST.DOS_CRITICAL||dosStatus===ST.DOS_ORDER)?'YES':'',
      burnRate:r4_(burnRate),totalQty:p.totalQty,
      velocity:velocity,invStatus:invStatus,
      vendor:vendor,
      daysSince:daysSince,
      lastOrderQty:lastOrderQty
    });
  });

  items.sort(function(a,b){
    var rank=function(s){
      if(s===ST.DOS_OOS)     return 0;  // out of stock sorts first
      if(s===ST.DOS_CRITICAL)return 1;if(s===ST.DOS_ORDER)return 2;
      if(s===ST.DOS_AT)return 3;if(s===ST.DOS_OVER)return 4;return 5;};
    var ra=rank(a.dosStatus),rb=rank(b.dosStatus);
    if(ra!==rb)return ra-rb;
    if(ra<=1)return a.currentDOS-b.currentDOS;
    return 0;
  });

  // ── Write DOS_TRACKER ──────────────────────────────────────
  dosSheet.clear();dosSheet.getCharts().forEach(function(c){dosSheet.removeChart(c);});
  dosSheet.getRange('A1').setValue('🎯 DOS TRACKER — Buying Priority ('+leadTime+'-day lead time)').setFontSize(14).setFontWeight('bold');
  dosSheet.getRange('A2').setValue('Generated: '+new Date().toLocaleString()).setFontColor('#666666');

  var headers=[
    'Priority','Status','Product Name','Category','Brand',
    'Current DOS','Target Min','Target Max','Gap to Min',
    'Arrives With','Units to Order','Reorder?','Burn Rate',
    'Total Qty','Velocity','Inv Status',
    'Vendor',            // col 17
    'Last Recv (days)',  // col 18
    'Last Order Qty'    // col 19
  ];
  dosSheet.getRange(DC.HEADER_ROW,1,1,DC.N).setValues([headers])
    .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setFontSize(10);
  dosSheet.setFrozenRows(DC.HEADER_ROW);

  [[DC.PRIORITY,70],[DC.STATUS,140],[DC.PRODUCT,300],[DC.CATEGORY,140],[DC.BRAND,140],
   [DC.CURRENT_DOS,100],[DC.TARGET_MIN,88],[DC.TARGET_MAX,88],[DC.GAP,88],
   [DC.ARRIVES_WITH,110],[DC.UNITS_ORDER,120],[DC.REORDER,88],[DC.BURN_RATE,120],
   [DC.TOTAL_QTY,88],[DC.VELOCITY,130],[DC.INV_STATUS,150],
   [DC.VENDOR,200],[DC.LAST_RECV,130],[DC.LAST_ORDER,120]]
  .forEach(function(p){dosSheet.setColumnWidth(p[0],p[1]);});

  if(items.length>0){
    var rows=items.map(function(item,idx){
      return[idx+1,item.dosStatus,item.product,item.cat,item.brand,
             item.currentDOS,item.targetMin,item.targetMax,item.gap,
             item.arrivesWith,item.unitsToOrder,item.reorder,item.burnRate,
             item.totalQty,item.velocity,item.invStatus,
             item.vendor,
             item.daysSince!==null?item.daysSince:'—',
             item.lastOrderQty!==null?item.lastOrderQty:'—'];
    });
    dosSheet.getRange(DC.DATA_START,1,rows.length,DC.N).setValues(rows);
    dosSheet.getRange(DC.DATA_START,DC.CURRENT_DOS, rows.length,1).setNumberFormat('#,##0.0');
    dosSheet.getRange(DC.DATA_START,DC.GAP,         rows.length,1).setNumberFormat('#,##0.0');
    dosSheet.getRange(DC.DATA_START,DC.ARRIVES_WITH,rows.length,1).setNumberFormat('#,##0.0');
    dosSheet.getRange(DC.DATA_START,DC.BURN_RATE,   rows.length,1).setNumberFormat('#,##0.0000');
    dosSheet.getRange(DC.DATA_START,DC.TOTAL_QTY,   rows.length,1).setNumberFormat('#,##0');

    var dosClrs={};
    dosClrs[ST.DOS_OOS]     ={bg:'#b71c1c',fg:'#ffffff'};  // solid red row — unmissable
    dosClrs[ST.DOS_CRITICAL]={bg:'#fce4ec',fg:'#b71c1c'};
    dosClrs[ST.DOS_ORDER]   ={bg:'#fff3e0',fg:'#e65100'};
    dosClrs[ST.DOS_AT]      ={bg:'#e8f5e9',fg:'#2e7d32'};
    dosClrs[ST.DOS_OVER]    ={bg:'#fffde7',fg:'#f57f17'};
    dosClrs[ST.DOS_NONE]    ={bg:'#f5f5f5',fg:'#757575'};
    for(var ri=0;ri<rows.length;ri++){
      var ds=rows[ri][DC.STATUS-1],clr=dosClrs[ds]||{bg:'#ffffff',fg:'#000000'};
      dosSheet.getRange(DC.DATA_START+ri,1,1,DC.N).setBackground(clr.bg);
      dosSheet.getRange(DC.DATA_START+ri,DC.STATUS).setFontColor(clr.fg).setFontWeight('bold');
      if(rows[ri][DC.UNITS_ORDER-1]!=='')
        dosSheet.getRange(DC.DATA_START+ri,DC.UNITS_ORDER).setFontWeight('bold').setFontColor('#b71c1c');
      var aw=rows[ri][DC.ARRIVES_WITH-1];
      if(typeof aw==='number'&&aw<=0)
        dosSheet.getRange(DC.DATA_START+ri,DC.ARRIVES_WITH).setFontColor('#b71c1c').setFontWeight('bold');
    }
  }

  var oosCnt =items.filter(function(o){return o.dosStatus===ST.DOS_OOS;     }).length;
  // ── Detect and log "brand gone" OOS items ─────────────────────────────────
  // An OOS product whose brand has NO other active products in the tracker is
  // almost certainly from a discontinued or dropped brand — not a real reorder.
  // These are written to 📋 LAPSED_BRANDS for reference and excluded from the
  // dashboard buy list.
  var activeBrandSet = {};
  items.forEach(function(item) {
    if (item.dosStatus !== ST.DOS_OOS && item.brand) activeBrandSet[item.brand] = true;
  });

  var lapsedItems = [], activeItems = [];
  items.forEach(function(item) {
    if (item.dosStatus === ST.DOS_OOS && !activeBrandSet[item.brand]) {
      lapsedItems.push(item);
    } else {
      item.brandActive = activeBrandSet[item.brand] === true;
      activeItems.push(item);
    }
  });
  items = activeItems;  // dashboard-bound tracker only contains active-brand items

  // Write lapsed items to LAPSED_BRANDS sheet
  var lapsedSheet = getOrCreate_(ss, S.LAPSED);
  lapsedSheet.clear();
  lapsedSheet.getRange('A1').setValue('📋 LAPSED BRANDS — OOS products from brands no longer in active inventory')
    .setFontSize(13).setFontWeight('bold');
  lapsedSheet.getRange('A2').setValue('Generated: '+new Date().toLocaleString()).setFontColor('#666666');
  var lHdr = ['Product Name','Category','Brand','Burn Rate','Last Rcvd (days)','Last Order Qty','Vendor','Note'];
  lapsedSheet.getRange(4,1,1,lHdr.length).setValues([lHdr])
    .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  lapsedSheet.setFrozenRows(4);
  lapsedSheet.setColumnWidth(1,300); lapsedSheet.setColumnWidth(3,160); lapsedSheet.setColumnWidth(8,340);
  if (lapsedItems.length) {
    var lRows = lapsedItems.map(function(o) {
      return [o.product, o.cat, o.brand, o.burnRate,
              o.daysSince!==null?o.daysSince:'—',
              o.lastOrderQty!==null?o.lastOrderQty:'—',
              o.vendor,
              'All products from this brand are OOS — likely discontinued or dropped'];
    });
    lapsedSheet.getRange(5,1,lRows.length,lHdr.length).setValues(lRows);
    lapsedSheet.getRange(5,4,lRows.length,1).setNumberFormat('#,##0.0000');
    lapsedSheet.getRange(5,1,lRows.length,lHdr.length).setBackground('#fff8e1');
    lapsedSheet.getRange(5,3,lRows.length,1).setFontColor('#e65100').setFontWeight('bold');
  }

  var critCnt=items.filter(function(o){return o.dosStatus===ST.DOS_CRITICAL;}).length;
  var ordCnt =items.filter(function(o){return o.dosStatus===ST.DOS_ORDER;   }).length;
  var atCnt  =items.filter(function(o){return o.dosStatus===ST.DOS_AT;      }).length;
  var overCnt=items.filter(function(o){return o.dosStatus===ST.DOS_OVER;    }).length;
  var noneCnt=items.filter(function(o){return o.dosStatus===ST.DOS_NONE;    }).length;
  var hasVendor=items.some(function(o){return o.vendor!=='';});

  return{ok:true,totalItems:items.length,
    oos:oosCnt,critical:critCnt,order:ordCnt,at:atCnt,over:overCnt,noTarget:noneCnt,
    leadTime:leadTime,hasVendor:hasVendor,
    lapsed:lapsedItems.length,
    summary:items.length+' products | '+oosCnt+' OOS | '+critCnt+' critical | '+ordCnt+' order now | '+atCnt+' at target'+' | '+lapsedItems.length+' lapsed brands'};
}


// ════════════════════════════════════════════════════════════
//  §10  MENU-FACING FUNCTIONS
// ════════════════════════════════════════════════════════════

function weeklyUpdate(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var pi=ss.getSheetByName(S.PASTE_INV);
  if(!pi||pi.getLastRow()<CONFIG.META_ROWS+2){ui.alert('❌','Paste inventory into 📋 PASTE_INVENTORY first.',ui.ButtonSet.OK);return;}
  var invRes=processInventoryFromArray_(pi.getDataRange().getValues(),ss);
  var salRes=buildMasterFromPulse_(ss);   // velocity now from Product Pulse
  if(!salRes.ok){ui.alert('❌',salRes.error,ui.ButtonSet.OK);return;}
  var dosRes=generateDosTrackerCore_(ss);
  if(!dosRes.ok){ui.alert('❌',dosRes.error,ui.ButtonSet.OK);return;}
  logAction_('Weekly Update (paste)','',invRes.imported+' inv | '+salRes.weeks+'wk | '+salRes.days+'d | '+dosRes.critical+' crit | '+dosRes.order+' order');
  ui.alert('✅ Weekly Update Complete',
    'Inventory: '+invRes.imported+' products\n'+
    'Sales: '+salRes.products+' products | '+salRes.weeks+'-week window\n'+
    '       '+salRes.fromIso+' → '+salRes.toIso+'\n\n'+
    dosRes.summary+'\n(Lead time: '+dosRes.leadTime+' days)\n\n→ Open the dashboard.',ui.ButtonSet.OK);
}

function clearPasteSheets(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  if(ui.alert('Clear paste sheets?','Delete pasted data from both tabs.',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  var pi=ss.getSheetByName(S.PASTE_INV),ps=ss.getSheetByName(S.PASTE_SALES);
  if(pi)pi.clear();if(ps)ps.clear();
}

function generateDosTracker(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var res=generateDosTrackerCore_(ss);
  if(!res.ok){ui.alert('❌',res.error,ui.ButtonSet.OK);return;}
  var msg=res.summary+'\n(Lead time: '+res.leadTime+' days)';
  if(res.lapsed>0)msg+='\n\n'+res.lapsed+' OOS items from inactive brands → 📋 LAPSED_BRANDS';
  if(!res.hasVendor)msg+='\n\nTip: import the Receipt History for vendor info on each product.';
  if(res.noTarget>0)msg+='\n\n'+res.noTarget+' products have no DOS target — check ⚙️ SETTINGS.';
  logAction_('DOS Tracker (menu)','',res.summary);
  ui.alert('✅ DOS Tracker Updated',msg+'\n\n→ 🎯 DOS_TRACKER',ui.ButtonSet.OK);
}

/**
 * importReceiptHistory()                           NEW v4.3
 * Finds the latest "Inventory Receipt" file in the Drive folder,
 * reads it, and writes aggregated vendor/last-received data to
 * 📋 RECEIPT_HISTORY. Run once whenever you get a new report.
 */
function importReceiptHistory(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  var pattern=getSetting_(ss.getSheetByName(S.SETTINGS),'Drive File Pattern: Receipts','Inventory Receipt');

  ui.alert('🔍 Searching…','Looking for "'+pattern+'" in the Drive folder…',ui.ButtonSet.OK);

  // Find ALL matching receipt files (2024, 2025, 2026, etc.)
  // and combine them so receipt history covers the full date range.
  var files = findAllFiles_(pattern);
  if (!files.length) {
    ui.alert('❌ Not Found',
      'No files matching "'+pattern+'" were found in the Drive folder.\n\n'+
      'Save the Inventory Receipt Report — Detail exports to the Drive folder,\n'+
      'or update "Drive File Pattern: Receipts" in ⚙️ SETTINGS.',
      ui.ButtonSet.OK);
    return;
  }

  // Sort oldest first so the most recent data wins on conflicts
  files.sort(function(a,b){ return a.getLastUpdated()-b.getLastUpdated(); });

  // Combine: keep full structure of first file, append data rows from the rest
  // processReceiptFromArray expects META_ROWS metadata + 1 header + data rows
  var combined = null, fileNames = [], totalDataRows = 0;
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var raw = readDriveFile_(files[fi]);
      fileNames.push(files[fi].getName());
      if (!combined) {
        combined = raw;  // first file: keep metadata + header + data
      } else {
        // Subsequent files: skip metadata rows and header, append data only
        var dataRows = raw.slice(CONFIG.META_ROWS + 1);
        combined = combined.concat(dataRows);
        totalDataRows += dataRows.length;
      }
    } catch(ex) {
      Logger.log('Skip receipt file '+files[fi].getName()+': '+ex.message);
    }
  }

  var res = processReceiptFromArray(combined, ss);

  logAction_('Receipt History ('+files.length+' files)',fileNames.join(', '),res.imported+' products | '+res.orders+' orders');
  ui.alert('✅ Receipt History Imported',
    files.length+' file(s) combined:\n'+fileNames.slice(0,5).join('\n')+(fileNames.length>5?'\n…+more':'')+
    '\n\nProducts: '+res.imported+
    '\nTotal orders processed: '+res.orders+
    '\n\n→ 📋 RECEIPT_HISTORY\n'+
    'Re-upload files or run Generate DOS Tracker to apply to the buy list.',
    ui.ButtonSet.OK);
}

/**
 * importExpiryReport()                                     NEW v4.4
 * Finds the latest "Inventory Expirations" file in Drive, processes it,
 * and writes to ⚠️ EXPIRY_RISK. Run whenever you get a new report.
 */
function importExpiryReport(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var pattern=getSetting_(ss.getSheetByName(S.SETTINGS),'Drive File Pattern: Expirations','Inventory Expirations');
  ui.alert('🔍','Looking for "'+pattern+'" in Drive…',ui.ButtonSet.OK);
  var file=findLatestFile_(pattern);
  if(!file){
    ui.alert('❌ Not Found',
      'No file matching "'+pattern+'" found.\n\n'+
      'Save the Inventory Expirations — Detail export to the Drive folder, or\n'+
      'update "Drive File Pattern: Expirations" in ⚙️ SETTINGS.',
      ui.ButtonSet.OK);
    return;
  }
  var data=readDriveFile_(file);
  var res =processExpiryFromArray_(data,ss);
  logAction_('Expiry Import',file.getName(),res.items+' items | '+res.expired+' expired');
  ui.alert('✅ Expiry Risk Imported',
    'File: '+file.getName()+'\n'+
    'Items: '+res.items+'\n'+
    'Already expired: '+res.expired+'\n\n'+
    '→ ⚠️ EXPIRY_RISK — open the dashboard to see the Expiry Action section.',
    ui.ButtonSet.OK);
}


function importCurrentInventory(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  ui.alert('🔍','Looking for "'+cfg.patInventory+'" in Drive…',ui.ButtonSet.OK);
  var file=findLatestFile_(cfg.patInventory);
  if(!file){ui.alert('❌','No matching file found in Drive.',ui.ButtonSet.OK);return;}
  var res=processInventoryFromArray_(readDriveFile_(file),ss);
  ui.alert('✅','Imported: '+res.imported+' | Excluded: '+res.skipped,ui.ButtonSet.OK);
}

/**
 * importSalesBreakdown()                              DORMANT (pre-tier-2)
 * Old file-scan velocity path. Velocity now comes from Product Pulse via
 * pullVelocityFromPulse / buildMasterFromPulse_. Kept for rollback only.
 */
function importSalesBreakdown(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  var allFiles=findAllFiles_(cfg.patSales);
  if(!allFiles.length){ui.alert('❌','No matching files in Drive.',ui.ButtonSet.OK);return;}
  var infos=[];
  allFiles.forEach(function(f){try{var d=readDriveFile_(f),dr=extractDateRange_(d);if(dr.fromDate&&dr.toDate)infos.push({raw:d,fromDate:dr.fromDate,toDate:dr.toDate,name:f.getName()});}catch(ex){}});
  if(!infos.length){ui.alert('❌','Could not parse date ranges.',ui.ButtonSet.OK);return;}
  infos.sort(function(a,b){return a.fromDate-b.fromDate;});
  var accepted=[],skipped=[];
  infos.forEach(function(fi){
    var ov=false;
    for(var j=0;j<accepted.length;j++){
      if(datesOverlap_(fi.fromDate,fi.toDate,accepted[j].fromDate,accepted[j].toDate)){
        var fd=Math.floor((fi.toDate-fi.fromDate)/86400000)+1,ad=Math.floor((accepted[j].toDate-accepted[j].fromDate)/86400000)+1;
        if(fd>ad){skipped.push(accepted[j].name);accepted[j]=fi;}else skipped.push(fi.name);
        ov=true;break;
      }
    }
    if(!ov)accepted.push(fi);
  });
  var totalDays=totalCalendarDays_(accepted.map(function(a){return{from:a.fromDate,to:a.toDate};}));
  var msg='Using '+accepted.length+' file(s) | '+totalDays+' total days\n\n';
  accepted.forEach(function(a){msg+='  '+fmtDateShort_(a.fromDate)+' → '+fmtDateShort_(a.toDate)+'\n  '+a.name+'\n\n';});
  if(skipped.length)msg+='Skipped: '+skipped.join(', ')+'\n\n';
  if(ui.alert('📥',msg+'Proceed?',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  var salesMap={},totalRows=0;
  accepted.forEach(function(a){
    var rows=a.raw.slice(CONFIG.META_ROWS),hIdx=0;
    for(var h=0;h<Math.min(rows.length,3);h++){var s=rows[h].join('|').toLowerCase();if(s.indexOf('product')>-1&&(s.indexOf('quantitysold')>-1||s.indexOf('category')>-1)){hIdx=h;break;}}
    for(var ri=hIdx+1;ri<rows.length;ri++){
      var r_=rows[ri],p=str_(r_[DS.PRODUCT]),c=str_(r_[DS.CATEGORY]);
      if(!p||p.toLowerCase()==='total'||c.toLowerCase()==='total')continue;
      var qty=Math.abs(num_(r_[DS.QTY_SOLD]));
      if(!salesMap[p])salesMap[p]={qty:0,cat:c,brand:str_(r_[DS.BRAND]),ps:0,rs:0,cnt:0};
      var e_=salesMap[p];e_.qty+=qty;e_.ps+=num_(r_[DS.AVG_PRICE]);e_.rs+=num_(r_[DS.AVG_PROFIT]);e_.cnt++;totalRows++;
    }
  });
  var prods=Object.keys(salesMap).sort(),now=new Date(),mRows=[];
  prods.forEach(function(p){var e_=salesMap[p];mRows.push([p,e_.cat,e_.brand,e_.qty,totalDays,r4_(e_.qty/totalDays),e_.cnt>0?r2_(e_.ps/e_.cnt):0,e_.cnt>0?r2_(e_.rs/e_.cnt):0,now]);});
  var mas=getOrCreate_(ss,S.MASTER);clearData_(mas);
  if(mRows.length){mas.getRange(2,1,mRows.length,9).setValues(mRows);mas.getRange(2,4,mRows.length,2).setNumberFormat('#,##0');mas.getRange(2,6,mRows.length,1).setNumberFormat('#,##0.0000');mas.getRange(2,7,mRows.length,2).setNumberFormat('$#,##0.00');mas.getRange(2,9,mRows.length,1).setNumberFormat('yyyy-mm-dd hh:mm');}
  logAction_('Sales (Drive all)',accepted.length+' files',prods.length+' products | '+totalDays+' days');
  ui.alert('✅',prods.length+' products | '+totalDays+' days → 📦 MASTER_SKU',ui.ButtonSet.OK);
}

function generateRiskReport(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var inv=ss.getSheetByName(S.INVENTORY),mas=ss.getSheetByName(S.MASTER),risk=ss.getSheetByName(S.RISK);
  var cfg=loadSettings_(ss.getSheetByName(S.SETTINGS));
  if(!inv||inv.getLastRow()<2){ui.alert('❌','No inventory.',ui.ButtonSet.OK);return;}
  if(!mas||mas.getLastRow()<2){ui.alert('❌','No burn rates.',ui.ButtonSet.OK);return;}
  var today=today_(),burnMap={};
  mas.getDataRange().getValues().slice(1).forEach(function(r){var p=str_(r[0]);if(p)burnMap[p]={rate:num_(r[5]),cat:str_(r[1]),brand:str_(r[2])};});
  var pm={};
  inv.getDataRange().getValues().slice(1).forEach(function(ri){
    var prod=str_(ri[0]);if(!prod)return;
    var room=str_(ri[4]),rk=room.toLowerCase(),qty=num_(ri[5]),cost=num_(ri[7]),exp=parseDate_(ri[9]);
    if(!pm[prod])pm[prod]={tq:0,fq:0,bq:0,dq:0,tc:0,cat:str_(ri[1]),brand:str_(ri[2]),vendors:{},batches:[]};
    var p=pm[prod];p.tq+=qty;p.tc+=cost;if(str_(ri[8]))p.vendors[str_(ri[8])]=true;
    if(FLOOR_ROOMS[rk])p.fq+=qty;else if(BACKSTOCK_ROOMS[rk])p.bq+=qty;else if(DISPLAY_ROOMS[rk])p.dq+=qty;
    if(burnMap[prod]){if(burnMap[prod].cat)p.cat=burnMap[prod].cat;if(burnMap[prod].brand)p.brand=burnMap[prod].brand;}
    p.batches.push({qty:qty,exp:exp,cost:cost});
  });
  var output=[];
  Object.keys(pm).sort().forEach(function(pn){
    var p=pm[pn],bm=burnMap[pn],br=bm?bm.rate:0,isNoExp=cfg.noExpCats[(p.cat||'').toLowerCase()]||false;
    var cu=p.tq>0?r2_(p.tc/p.tq):0,vs=Object.keys(p.vendors).join(', ');
    p.batches.sort(function(a,b){if(!a.exp&&!b.exp)return 0;if(!a.exp)return 1;if(!b.exp)return-1;return a.exp.getTime()-b.exp.getTime();});
    var ee=null;for(var bi=0;bi<p.batches.length;bi++)if(p.batches[bi].exp){ee=p.batches[bi].exp;break;}
    var dte=ee?Math.floor((ee.getTime()-today.getTime())/86400000):null,dos=br>0?r1_(p.tq/br):null,fDos=(br>0&&p.fq>0)?r1_(p.fq/br):null,dr=0,status;
    if(isNoExp){status=p.tq>0&&br===0?ST.DEAD:ST.OK;if(status===ST.DEAD)dr=p.tq*cu;dte=null;}
    else if(dte!==null&&dte<0){
      var eq=0;p.batches.forEach(function(b){if(b.exp&&b.exp.getTime()<today.getTime())eq+=b.qty;});
      if(eq>=p.tq){status=ST.EXPIRED;dr=p.tq*cu;}
      else{var rq=p.tq-eq,nge=null;for(var ng=0;ng<p.batches.length;ng++)if(p.batches[ng].exp&&p.batches[ng].exp.getTime()>=today.getTime()){nge=p.batches[ng].exp;break;}
        var dtn=nge?Math.floor((nge.getTime()-today.getTime())/86400000):null,dfr=br>0?r1_(rq/br):null;
        if(br===0){status=ST.DEAD;dr=p.tq*cu;}else if(dfr!==null&&dtn!==null&&dfr>dtn){status=ST.WASTE;dr=r2_(eq*cu+Math.max(0,rq-br*dtn)*cu);}
        else{status=ST.PARTIAL;dr=r2_(eq*cu);}dte=dtn;dos=dfr;ee=nge;}
    }
    else if(p.tq>0&&br===0){status=ST.DEAD;dr=p.tq*cu;}
    else if(dos!==null&&dte!==null&&dos>dte){status=ST.WASTE;dr=r2_(Math.max(0,p.tq-br*dte)*cu);}
    else if(dte!==null&&dte<=cfg.expSoonDays){status=ST.EXP_SOON;}
    else if(dte===null&&p.tq>0){status=ST.NO_EXP;}else{status=ST.OK;}
    var vt='';if(br>0&&p.fq>0){if(fDos!==null&&fDos<=cfg.hotSellerDays)vt=ST.HOT;else if(dos!==null&&dos>cfg.slowMoverDays)vt=ST.SLOW;}
    var rp=[];if(p.fq>0)rp.push('Floor: '+p.fq);if(p.bq>0)rp.push('Back: '+p.bq);
    output.push([status,vt,pn,p.cat,p.brand,p.tq,p.fq,p.bq,r4_(br),dos!==null?dos:'N/A',fDos!==null?fDos:'N/A',dte!==null?dte:'No data',ee!==null?ee:'N/A',p.batches.length+' batch'+(p.batches.length!==1?'es':''),rp.join(' | '),vs,cu,dr>0?dr:'']);
  });
  output.sort(function(a,b){var sa=STATUS_SORT[a[0]]!==undefined?STATUS_SORT[a[0]]:99,sb=STATUS_SORT[b[0]]!==undefined?STATUS_SORT[b[0]]:99;if(sa!==sb)return sa-sb;var da=typeof a[RC.DAYS_TO_EXP-1]==='number'?a[RC.DAYS_TO_EXP-1]:99999,db=typeof b[RC.DAYS_TO_EXP-1]==='number'?b[RC.DAYS_TO_EXP-1]:99999;return da-db;});
  var hd=['Status','Velocity','Product Name','Category','Brand','Total Qty','Floor Qty','Backstock Qty','Daily Burn Rate','Days of Stock','Floor Days','Days to Expiry','Earliest Exp Date','Batches','Room Breakdown','Vendor','Cost/Unit','$ at Risk'];
  risk.clear();risk.getRange(1,1,1,RC.N).setValues([hd]);hdrRow_(risk,RC.N);
  risk.setColumnWidth(RC.STATUS,160);risk.setColumnWidth(RC.VELOCITY,130);risk.setColumnWidth(RC.PRODUCT,300);
  if(output.length){
    risk.getRange(2,1,output.length,RC.N).setValues(output);
    risk.getRange(2,RC.TOTAL_QTY,output.length,3).setNumberFormat('#,##0');
    risk.getRange(2,RC.BURN_RATE,output.length,1).setNumberFormat('#,##0.0000');
    risk.getRange(2,RC.DAYS_OF_STOCK,output.length,1).setNumberFormat('#,##0.0');
    risk.getRange(2,RC.FLOOR_DAYS,output.length,1).setNumberFormat('#,##0.0');
    risk.getRange(2,RC.DAYS_TO_EXP,output.length,1).setNumberFormat('#,##0');
    risk.getRange(2,RC.EARLIEST_EXP,output.length,1).setNumberFormat('yyyy-mm-dd');
    risk.getRange(2,RC.COST_UNIT,output.length,1).setNumberFormat('$#,##0.00');
    risk.getRange(2,RC.DOLLAR_RISK,output.length,1).setNumberFormat('$#,##0.00');
    colorRiskRows_(risk,output);
    for(var vi=0;vi<output.length;vi++)applyVelocityColor_(risk,vi+2,RC.VELOCITY,output[vi][RC.VELOCITY-1]);
  }
  var cnts={},tr=0;output.forEach(function(r){cnts[r[0]]=(cnts[r[0]]||0)+1;if(typeof r[RC.DOLLAR_RISK-1]==='number')tr+=r[RC.DOLLAR_RISK-1];});
  var msg=output.length+' products\n\n';[ST.EXPIRED,ST.PARTIAL,ST.WASTE,ST.DEAD,ST.EXP_SOON,ST.NO_EXP,ST.OK].forEach(function(s){if(cnts[s])msg+=s+': '+cnts[s]+'\n';});
  msg+='\n💰 Total $ at Risk: $'+tr.toFixed(2);
  logAction_('Risk Report','',msg.replace(/\n/g,' | '));
  ui.alert('✅ Risk Report Generated',msg,ui.ButtonSet.OK);
}

function runFullPipeline(){importReceiptHistory();importCurrentInventory();pullVelocityFromPulse();generateRiskReport();generateDosTracker();}


// ════════════════════════════════════════════════════════════
//  §11  INITIALIZE WORKBOOK
// ════════════════════════════════════════════════════════════

function initializeWorkbook(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  var setSheet=getOrCreate_(ss,S.SETTINGS);
  if(setSheet.getLastRow()<2){
    setSheet.clear();
    var ms=[['Setting','Value','Notes'],
      ['Lead Time (days)',14,'Days from placing order to stock arriving. Reorder point = Target Min + Lead Time.'],
      ['OOS Lookback (days)',7,'Only flag a product as Out of Stock if its burn rate implies at least 1 sale per N days. Lower = stricter (fewer OOS). 7=weekly, 14=bi-weekly, 30=monthly. Default: 7.'],
      ['Expiring Soon Threshold (days)',30,'Flag products expiring within N days.'],
      ['Exclude Rooms','SAMPLE,Marked For Destruction,Marketing,Quarantine,Discrepancy Research,BOH Display,FOH Display','Comma-separated.'],
      ['Include Only Status','In-Stock','Only this allocation status. Blank = all.'],
      ['Exclude Product Names Containing','sample','Comma-separated keywords (case-insensitive).'],
      ['No-Expiration Categories','Accessories,CBD','Never expire — OK or DEAD STOCK only.'],
      ['Hot Seller Threshold (days)',21,'Floor ÷ burn ≤ N → 🚀 HOT SELLER'],
      ['Slow Mover Threshold (days)',120,'Total ÷ burn > N → 🐌 SLOW MOVER'],
      ['Drive File Pattern: Inventory','Current Inventory','Substring match against Drive file names.'],
      ['Drive File Pattern: Sales','Detailed Sales Breakdown','Substring match against Drive file names.'],
      ['Drive File Pattern: Receipts','Inventory Receipt','Substring match against Drive file names.'],
      ['Drive File Pattern: Expirations','Inventory Expirations','Substring match against Drive file names.']];  // v4.4
    setSheet.getRange(1,1,ms.length,3).setValues(ms);hdrRow_(setSheet,3);
    setSheet.setColumnWidth(1,300);setSheet.setColumnWidth(2,260);setSheet.setColumnWidth(3,460);
    setSheet.getRange(2,1,1,3).setBackground('#e8f5e9');
    setSheet.getRange(ms.length,1,1,3).setBackground('#e8f5e9');  // highlight Receipts pattern row
  }
  var existing=setSheet.getDataRange().getValues();
  if(!existing.some(function(r){return String(r[0]).indexOf('DOS CATEGORY TARGETS')>-1;})){
    var last=setSheet.getLastRow();
    setSheet.getRange(last+2,1,1,3).setValues([['── DOS CATEGORY TARGETS ──','','']]).setFontWeight('bold').setBackground('#c5cae9').setFontColor('#1a237e');
    setSheet.getRange(last+3,1,1,3).setValues([['Category','Min DOS','Max DOS']]).setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#283593');
    var cats=[['Flower',21,45],['Pre-Roll',14,35],['Single Pre-Roll',14,35],['Pre-Rolls',14,35],['Multi-Pack Pre-Roll',14,35],['Concentrate',30,60],['Cartridge | 510',30,60],['All-In-One',30,60],['Gummies',21,45],['Edibles',21,45],['Beverages',21,45],['Topical',30,60],['Accessories',60,120],['CBD',30,60]];
    setSheet.getRange(last+4,1,cats.length,3).setValues(cats);
    var bs=last+4+cats.length+2;
    setSheet.getRange(bs,1,1,3).setValues([['── DOS BRAND OVERRIDES ──','','']]).setFontWeight('bold').setBackground('#c5cae9').setFontColor('#1a237e');
    setSheet.getRange(bs+1,1,1,3).setValues([['Brand','Min DOS','Max DOS']]).setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#283593');
    setSheet.getRange(bs+2,1).setValue('(Add brand-specific overrides here)');
  }
  var iH=['Product Name','Category','Brand','Package ID','Room','Qty on Hand','Price','Cost','Vendor','Exp Date','Batch'];
  var inv=getOrCreate_(ss,S.INVENTORY);if(inv.getLastRow()<1){inv.getRange(1,1,1,iH.length).setValues([iH]);hdrRow_(inv,iH.length);inv.setColumnWidth(1,300);}
  var mH=['Product Name','Category','Brand','Total Qty Sold','Lookback Days','Daily Burn Rate','Avg Price/Unit','Avg Profit/Unit','Last Updated'];
  var mas=getOrCreate_(ss,S.MASTER);if(mas.getLastRow()<1){mas.getRange(1,1,1,mH.length).setValues([mH]);hdrRow_(mas,mH.length);mas.setColumnWidth(1,340);}
  // Receipt History sheet   NEW v4.3
  var rH2=['Product Name','Category','Brand','Vendor (Most Recent)','Last Received','Days Since Recv','Avg Order Qty','Total Orders','Total Units YTD','Avg Unit Cost','Last Order Qty','Avg Cadence (days)','Updated'];
  var rec=getOrCreate_(ss,S.RECEIPTS);if(rec.getLastRow()<1){rec.getRange(1,1,1,rH2.length).setValues([rH2]);hdrRow_(rec,rH2.length);rec.setColumnWidth(1,300);rec.setColumnWidth(4,220);rec.setColumnWidth(11,130);}
  var rH=['Status','Velocity','Product Name','Category','Brand','Total Qty','Floor Qty','Backstock Qty','Daily Burn Rate','Days of Stock','Floor Days','Days to Expiry','Earliest Exp Date','Batches','Room Breakdown','Vendor','Cost/Unit','$ at Risk'];
  var risk=getOrCreate_(ss,S.RISK);if(risk.getLastRow()<1){risk.getRange(1,1,1,RC.N).setValues([rH]);hdrRow_(risk,RC.N);}
  var eH=['Product Name','Room','Qty','Expiry Date','Days Until','Status'];
  var exr=getOrCreate_(ss,S.EXPIRY);if(exr.getLastRow()<1){exr.getRange(1,1,1,eH.length).setValues([eH]);hdrRow_(exr,eH.length);exr.setColumnWidth(1,280);exr.setColumnWidth(2,160);}
  var pi=getOrCreate_(ss,S.PASTE_INV);if(pi.getLastRow()<1){pi.getRange('A1').setValue('Paste full Current Inventory export here.').setBackground('#fff9c4');pi.setColumnWidth(1,600);}
  var ps=getOrCreate_(ss,S.PASTE_SALES);if(ps.getLastRow()<1){ps.getRange('A1').setValue('Paste full Sales Breakdown export here.').setBackground('#fff9c4');ps.setColumnWidth(1,600);}
  getOrCreate_(ss,S.DOS);getOrCreate_(ss,S.DASHBOARD);getOrCreate_(ss,S.TEMP);
  getOrCreate_(ss,S.LAPSED); // created empty; populated by generateDosTrackerCore_
  var lg=getOrCreate_(ss,S.LOG);if(lg.getLastRow()<1){lg.getRange(1,1,1,4).setValues([['Timestamp','Action','File','Details']]);hdrRow_(lg,4);}
  ui.alert('✅ Workbook Initialized',
    'Lead time: 14 days (edit in ⚙️ SETTINGS).\n\n'+
    'NEW: Drop the Inventory Receipt Report in the Drive folder,\n'+
    'then run Advanced → Import Receipt History to get vendor\n'+
    'and "last received" data on every product in the buy list.\n\n'+
    'PRIMARY WORKFLOW: web app → upload 2 files → Update.',ui.ButtonSet.OK);
}


// ════════════════════════════════════════════════════════════
//  §12  DOS SETTINGS HELPERS
// ════════════════════════════════════════════════════════════

function getDOSCategoryTargets_(sh){return parseDOSSection_(sh,'DOS CATEGORY TARGETS','category');}
function getDOSBrandOverrides_(sh){return parseDOSSection_(sh,'DOS BRAND OVERRIDES','brand');}
function parseDOSSection_(sh,titleKey,colLabel){
  var result={};if(!sh)return result;
  var data=sh.getDataRange().getValues(),tl=titleKey.toLowerCase(),hl=colLabel.toLowerCase();
  var inSec=false,pastHdr=false;
  for(var i=0;i<data.length;i++){
    var cell=String(data[i][0]).trim(),low=cell.toLowerCase();
    if(!inSec){if(low.indexOf(tl)>-1){inSec=true;pastHdr=false;}continue;}
    if(!pastHdr){if(low===hl)pastHdr=true;continue;}
    if(!cell||cell.indexOf('──')>-1||cell.charAt(0)==='('||cell.slice(0,4)==='Add ')break;
    var mn=parseFloat(data[i][1]),mx=parseFloat(data[i][2]);
    if(!isNaN(mn)&&!isNaN(mx))result[cell.toLowerCase()]={min:mn,max:mx};
  }
  return result;
}


// ════════════════════════════════════════════════════════════
//  §13  DRIVE CONNECTOR
// ════════════════════════════════════════════════════════════

function findLatestFile_(p){var lat=null,ld=new Date(0);var cb=function(f,d){if(d>ld){lat=f;ld=d;}};searchFolder_(CONFIG.PARENT_FOLDER_ID,p,cb);Object.keys(CONFIG.SUBFOLDER_IDS).forEach(function(y){searchFolder_(CONFIG.SUBFOLDER_IDS[y],p,cb);});return lat;}
function findAllFiles_(p){var all=[];var cb=function(f){all.push(f);};searchFolder_(CONFIG.PARENT_FOLDER_ID,p,cb);Object.keys(CONFIG.SUBFOLDER_IDS).forEach(function(y){searchFolder_(CONFIG.SUBFOLDER_IDS[y],p,cb);});return all;}
function searchFolder_(fid,pattern,callback){try{var n=pattern.toLowerCase().replace(/[\s_\-]+/g,''),files=DriveApp.getFolderById(fid).getFiles();while(files.hasNext()){var f=files.next();if(f.getName().toLowerCase().replace(/[\s_\-]+/g,'').indexOf(n)>-1)callback(f,f.getLastUpdated());}}catch(ex){Logger.log('searchFolder_ '+fid+': '+ex.message);}}
function readDriveFile_(file){var mime=file.getMimeType(),name=file.getName().toLowerCase();if(mime==='text/csv'||name.slice(-4)==='.csv')return Utilities.parseCsv(file.getBlob().getDataAsString());if(mime===MimeType.MICROSOFT_EXCEL||mime===MimeType.MICROSOFT_EXCEL_LEGACY||name.slice(-5)==='.xlsx'||name.slice(-4)==='.xls'){var tmp=Drive.Files.copy({title:'_TMP_'+file.getName(),mimeType:MimeType.GOOGLE_SHEETS},file.getId());var data=SpreadsheetApp.openById(tmp.id).getActiveSheet().getDataRange().getValues();DriveApp.getFileById(tmp.id).setTrashed(true);return data;}if(mime===MimeType.GOOGLE_SHEETS)return SpreadsheetApp.openById(file.getId()).getActiveSheet().getDataRange().getValues();throw new Error('Unsupported: '+mime);}
function extractDateRange_(d){var from=null,to=null;for(var i=0;i<Math.min(d.length,CONFIG.META_ROWS+1);i++){var l=String(d[i][0]||'').trim().toLowerCase().replace(/:$/,''),v=String(d[i][1]||'').trim();if(l==='from date')from=parseDateStr_(v);if(l==='to date')to=parseDateStr_(v);}return{fromDate:from,toDate:to};}
function parseDateStr_(s){if(!s)return null;var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(parseInt(m[3]),parseInt(m[1])-1,parseInt(m[2]));var d=new Date(s);return isNaN(d.getTime())?null:d;}
function datesOverlap_(a1,a2,b1,b2){return a1<=b2&&b1<=a2;}
function totalCalendarDays_(ranges){if(!ranges||!ranges.length)return 0;ranges=ranges.slice().sort(function(a,b){return a.from-b.from;});var merged=[{from:ranges[0].from,to:ranges[0].to}];for(var i=1;i<ranges.length;i++){var last=merged[merged.length-1],adj=new Date(last.to.getTime()+86400000);if(ranges[i].from<=adj){if(ranges[i].to>last.to)last.to=ranges[i].to;}else merged.push({from:ranges[i].from,to:ranges[i].to});}var tot=0;merged.forEach(function(s){tot+=Math.floor((s.to.getTime()-s.from.getTime())/86400000)+1;});return tot;}


// ════════════════════════════════════════════════════════════
//  §14  SHARED STATUS CALCULATOR
// ════════════════════════════════════════════════════════════

function calcStatus_(p){
  var isNoExp=p.noExpCats[(p.category||'').toLowerCase()]||false;
  var dos=p.burnRate>0?r1_(p.totalQty/p.burnRate):null,fDos=(p.burnRate>0&&p.floorQty>0)?r1_(p.floorQty/p.burnRate):null,dr=0,status;
  if(isNoExp){status=p.totalQty>0&&p.burnRate===0?ST.DEAD:ST.OK;if(status===ST.DEAD)dr=p.totalQty*p.costPerUnit;}
  else if(p.daysToExp!==null&&p.daysToExp<0){status=ST.EXPIRED;dr=p.totalQty*p.costPerUnit;}
  else if(p.totalQty>0&&p.burnRate===0){status=ST.DEAD;dr=p.totalQty*p.costPerUnit;}
  else if(dos!==null&&p.daysToExp!==null&&dos>p.daysToExp){status=ST.WASTE;dr=r2_(Math.max(0,p.totalQty-p.burnRate*p.daysToExp)*p.costPerUnit);}
  else if(p.daysToExp!==null&&p.daysToExp<=p.expSoonDays){status=ST.EXP_SOON;}
  else if(p.daysToExp===null&&p.totalQty>0){status=ST.NO_EXP;}
  else{status=ST.OK;}
  var vt='';if(p.burnRate>0&&p.floorQty>0){if(fDos!==null&&fDos<=p.hotSellerDays)vt=ST.HOT;else if(dos!==null&&dos>p.slowMoverDays)vt=ST.SLOW;}
  return{status:status,velocityTag:vt,daysOfStock:dos,floorDaysOfStock:fDos,dollarRisk:dr};
}


// ════════════════════════════════════════════════════════════
//  §15  HELPERS
// ════════════════════════════════════════════════════════════

function normalizeName_(s) {
  // Normalizes product names for cross-export matching.
  // Dutchie uses slightly different names in different exports —
  // lowercase + collapse whitespace + remove punctuation reduces mismatches.
  return str_(s).toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}

function today_(){var d=new Date();d.setHours(0,0,0,0);return d;}
function r1_(n){return Math.round(n*10)/10;}
function r2_(n){return Math.round(n*100)/100;}
function r4_(n){return Math.round(n*10000)/10000;}
function str_(v){return v?String(v).trim():'';}
function num_(v){var n=parseFloat(v);return isNaN(n)?0:n;}
function parseDate_(val){
  if(val===null||val===undefined||val==='')return null;
  if(val instanceof Date){if(isNaN(val.getTime()))return null;val.setHours(0,0,0,0);return val;}
  var s=String(val).trim();
  if(!s||s==='0'||s.toLowerCase()==='n/a'||s.toLowerCase()==='no data')return null;
  var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(parseInt(m[3]),parseInt(m[1])-1,parseInt(m[2]));
  var d=new Date(s);if(!isNaN(d.getTime())){d.setHours(0,0,0,0);return d;}
  var p=s.split(/[\-\.]/);if(p.length===3){var y=parseInt(p[2]);if(y<100)y+=2000;var d2=new Date(y,parseInt(p[0])-1,parseInt(p[1]));if(!isNaN(d2.getTime()))return d2;}
  return null;
}
function fmtDateShort_(d){if(!d)return '?';var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return M[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();}
function loadSettings_(sh){
  var g=function(l,d){return getSetting_(sh,l,d);};
  var er={};String(g('Exclude Rooms','')).split(',').forEach(function(r_){var k=r_.trim().toLowerCase();if(k)er[k]=true;});
  var ne={};String(g('No-Expiration Categories','Accessories,CBD')).split(',').forEach(function(c){var k=c.trim().toLowerCase();if(k)ne[k]=true;});
  var en=String(g('Exclude Product Names Containing','sample')).split(',').map(function(k){return k.trim().toLowerCase();}).filter(Boolean);
  return{lookbackDays:g('Sales Lookback Period',31),expSoonDays:g('Expiring Soon Threshold',30),hotSellerDays:g('Hot Seller Threshold',21),slowMoverDays:g('Slow Mover Threshold',120),excludeRooms:er,onlyStatus:g('Include Only Status','In-Stock'),excludeNames:en,noExpCats:ne,patInventory:g('Drive File Pattern: Inventory','Current Inventory'),patSales:g('Drive File Pattern: Sales','Detailed Sales Breakdown')};
}
function getSetting_(sh,label,def){if(!sh)return def;var data=sh.getDataRange().getValues(),ll=label.toLowerCase();for(var i=0;i<data.length;i++){if(String(data[i][0]).toLowerCase().indexOf(ll)>-1){var v=String(data[i][1]).trim(),n=parseFloat(v);return isNaN(n)?(v||def):n;}}return def;}
function getOrCreate_(ss,name){return ss.getSheetByName(name)||ss.insertSheet(name);}
function hdrRow_(sheet,n){sheet.getRange(1,1,1,n).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff').setHorizontalAlignment('center').setFontSize(10);sheet.setFrozenRows(1);}
function clearData_(sheet){var lr=sheet.getLastRow(),lc=sheet.getLastColumn();if(lr>1&&lc>0)sheet.getRange(2,1,lr-1,lc).clearContent().clearFormat();}
function clearTemp(){var t=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(S.TEMP);if(t)t.clear();}
function colorRiskRows_(sheet,output){if(!output.length)return;var gs=0,gSt=output[0][RC.STATUS-1];for(var r=1;r<=output.length;r++){var cur=r<output.length?output[r][RC.STATUS-1]:'__END__';if(cur!==gSt){var clr=STATUS_COLORS[gSt]||{bg:'#ffffff',fg:'#000000'},len=r-gs;sheet.getRange(gs+2,1,len,RC.N).setBackground(clr.bg);sheet.getRange(gs+2,RC.STATUS,len,1).setFontColor(clr.fg).setFontWeight('bold');gSt=cur;gs=r;}}}
function applyVelocityColor_(sheet,row,col,tag){var c=sheet.getRange(row,col);if(tag===ST.HOT)c.setFontColor('#0d9488').setFontWeight('bold');else if(tag===ST.SLOW)c.setFontColor('#9333ea').setFontWeight('bold');else c.setFontColor('#000000').setFontWeight('normal');}
function logAction_(action,file,details){var log=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(S.LOG);if(log)log.appendRow([new Date(),action,file,details]);}

// ============================================================
//  DOS ⇄ PRODUCT PULSE  — FUSION BRIDGE  (add to Sell Through Master)
//  v1.0 — one dashboard updates both systems
//
//  WHAT THIS DOES
//  The web app uploads this week's Dutchie exports once. The Pulse
//  exports (Detailed Sales Breakdown + optional POS / Daily
//  Dispensations) are pushed straight into Product Pulse through its
//  library entry point uploadWeeklyFiles(), which saves them to the
//  shared Drive folder and ingests them into ProductWeekly. Then this
//  pulls fresh velocity from Pulse and runs the normal DOS pipeline.
//
//  PREREQUISITES (one-time, see the chat checklist):
//    1. In PRODUCT PULSE, set:
//         CONFIG.SPREADSHEET_ID = '1Nz-Pwd2USi_wsBu-WmFS9kVfaxhWk1h2Gq-KKVroPeI'
//       (its own data sheet — so ss_() resolves when called as a library)
//    2. Add Product Pulse to THIS project as a library with the
//       identifier  Pulse  (Editor ▸ Libraries ▸ + ▸ paste Pulse's
//       Script ID ▸ add as "Pulse", version: HEAD / Development).
//    3. Drive advanced service is already enabled here — nothing to do.
//    4. Re-deploy this web app (new version) so index.html updates.
// ============================================================

/**
 * processWeeklyUpdate(payload)  — web-app entry for the fused upload.
 * Must NOT call getUi().
 *
 * payload = {
 *   pulseFiles: [ {name, data(base64), mimeType}, ... ],  // PRODUCT required; POS/LINES optional
 *   inventory:  [[...]],   // 2D array — required
 *   receipt:    [[...]] | null,
 *   expiry:     [[...]] | null
 * }
 */
function processWeeklyUpdate(payload) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    payload = payload || {};

    // ── 1) Push this week's sales exports into Product Pulse (separate project) ──
    var pulseResult = null;
    var pf = payload.pulseFiles || [];
    if (pf.length) {
      if (typeof Pulse === 'undefined' || !Pulse || typeof Pulse.uploadWeeklyFiles !== 'function') {
        return { ok:false, error:
          'Product Pulse library not found. In this project: Editor ▸ Libraries ▸ add ' +
          'Pulse\'s Script ID with the identifier "Pulse" (version HEAD).' };
      }
      try {
        pulseResult = Pulse.uploadWeeklyFiles(pf);
      } catch (e) {
        return { ok:false, error:
          'Product Pulse import failed: ' + (e.message || e) +
          '  — confirm Pulse CONFIG.SPREADSHEET_ID is set to its data sheet.' };
      }
    }

    // ── 2) Velocity from the now-updated Pulse ProductWeekly ──
    var velo = buildMasterFromPulse_(ss);
    if (!velo.ok) return { ok:false, error:velo.error };

    // ── 3) Inventory (required) ──
    var invData = payload.inventory;
    if (!invData || invData.length < 5)
      return { ok:false, error:'Inventory file appears empty or unreadable.' };
    var invResult = processInventoryFromArray_(invData, ss);

    // ── 4) Optional receipt / expiry ──
    var recResult = (payload.receipt && payload.receipt.length > 5)
      ? processReceiptFromArray(payload.receipt, ss) : null;
    var expResult = (payload.expiry && payload.expiry.length > 5)
      ? processExpiryFromArray_(payload.expiry, ss) : null;

    // ── 5) DOS tracker ──
    var dos = generateDosTrackerCore_(ss);
    if (!dos.ok) return { ok:false, error:dos.error };

    logAction_('Weekly Update (fused)', 'Web App',
      (pulseResult ? (pulseResult.imported + ' pulse files | ') : '') +
      invResult.imported + ' inv | ' + velo.weeks + 'wk velocity | ' +
      dos.oos + ' OOS | ' + dos.critical + ' crit | ' + dos.order + ' order');

    return {
      ok: true,
      summary: {
        pulseImported:  pulseResult ? pulseResult.imported  : null,
        pulseRejected:  pulseResult ? (pulseResult.rejected || []) : [],
        pulseRemaining: pulseResult ? pulseResult.remaining : null,
        invImported:    invResult.imported,
        invSkipped:     invResult.skipped,
        salesProducts:  velo.products,
        salesDays:      velo.days,
        salesFiles:     velo.weeks,
        dateRange:      velo.fromIso + ' – ' + velo.toIso,
        receiptImported: recResult ? recResult.imported : null,
        expiryImported:  expResult ? expResult.items     : null
      },
      data: getDashboardData()
    };
  } catch (ex) {
    return { ok:false, error: ex.message || String(ex) };
  }
}
