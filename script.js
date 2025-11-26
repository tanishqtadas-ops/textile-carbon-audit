
const emissionFactors = [
  { source: "Electricity", unit: "kWh", factor: 0.82 },
  { source: "Diesel", unit: "L", factor: 2.68 },
  { source: "LPG", unit: "kg", factor: 3.00 },
  { source: "Steam", unit: "kg", factor: 1.90 },
  { source: "TextileWaste", unit: "kg", factor: 1.40 },
  { source: "Transport", unit: "km", factor: 0.15 } // example transport factor
];

/* Utility: find emission factor object by activity name (case-insensitive) */
function findFactorForActivity(activity){
  if(!activity) return null;
  const key = activity.trim().toLowerCase();
  // Try exact match first
  let f = emissionFactors.find(e => e.source.toLowerCase() === key);
  if(f) return f;
  // Try partial match (e.g., "electricity (dyehouse)" or "diesel generator")
  f = emissionFactors.find(e => key.includes(e.source.toLowerCase()));
  return f || null;
}

/* Parse CSV string and return rows (array of objects) */
function parseCSVString(csvString){
  return new Promise((resolve, reject) => {
    Papa.parse(csvString, { header: true, skipEmptyLines: true, complete: (res)=>{
      resolve(res.data);
    }, error: (err)=> reject(err) });
  });
}

/* Core compute function:
   Input: rows = [{Activity, Quantity, Unit}, ...]
   Output: { totalCO2, aggregated: {activity: {qty, unit, co2, rows:[]}}, details: [...rows with co2] }
*/
function computeEmissions(rows){
  const agg = {};
  let totalCO2 = 0;
  let totalInputMass = 0;
  let totalReused = 0; // optional if you have reused column

  rows.forEach(r=>{
    const activityRaw = (r.Activity || r.activity || '').toString().trim();
    if(!activityRaw) return;
    const activity = activityRaw;
    const qty = Number((r.Quantity || r.quantity || r.Qty || 0).toString().replace(/,/g,''));
    const unit = (r.Unit || r.unit || '').toString().trim();

    // find factor
    const fobj = findFactorForActivity(activity);
    // If unit mismatch, we still use factor if available; in real system you'd check units
    const factor = fobj ? Number(fobj.factor) : 0;
    const co2 = qty * factor;

    // store details
    const row = { activity, qty, unit, factor, co2 };
    totalCO2 += co2;
    totalInputMass += qty;

    const key = activity;
    if(!agg[key]) agg[key] = { qty:0, unit: unit || (fobj?fobj.unit:'unit'), co2:0, rows: [] };
    agg[key].qty += qty;
    agg[key].co2 += co2;
    agg[key].rows.push(row);
  });

  // round total
  totalCO2 = Math.round(totalCO2*100)/100;
  return { totalCO2, aggregated: agg };
}

/* ---------------------------
   Chart rendering functions
---------------------------- */
let barChart = null, pieChart = null;

function renderBarChart(labels, values){
  const ctx = document.getElementById('barChart').getContext('2d');
  if(barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'CO₂e (kg)',
        data: values,
        backgroundColor: labels.map((_,i)=> colorForIndex(i)),
        borderRadius: 6
      }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{ beginAtZero:true, ticks:{callback: v => v.toLocaleString()} }
      }
    }
  });
}

function renderPieChart(labels, values){
  const ctx = document.getElementById('pieChart').getContext('2d');
  if(pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        label: 'Share',
        data: values,
        backgroundColor: labels.map((_,i)=> colorForIndex(i)),
        hoverOffset: 8
      }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      cutout: '60%', // makes donut smaller (change to adjust size)
      plugins:{legend:{position:'bottom'}}
    }
  });
}

function colorForIndex(i){
  const palette = ['#1f7a8c','#ff7f50','#6a5acd','#20b2aa','#ffa500','#ff6b6b','#4caf50','#9c27b0'];
  return palette[i % palette.length];
}

/* Render Sankey using Plotly */
function renderSankey(aggregated){
  const nodes = [], labelIndex = {}, sources = [], targets = [], values = [];
  let idx = 0;
  // nodes = each activity + "Emissions"
  Object.keys(aggregated).forEach(cat=>{
    labelIndex[cat] = idx++;
    nodes.push(cat);
  });
  const emissionsNode = 'Emissions (kg CO₂e)';
  labelIndex[emissionsNode] = idx++;
  nodes.push(emissionsNode);

  Object.entries(aggregated).forEach(([cat,info])=>{
    sources.push(labelIndex[cat]);
    targets.push(labelIndex[emissionsNode]);
    values.push(Math.round(info.co2));
  });

  const data = [{
    type: "sankey",
    orientation: "h",
    node: { pad: 15, thickness: 18, line:{color:"black", width:0.5}, label: nodes },
    link: { source: sources, target: targets, value: values }
  }];

  const layout = { margin:{l:20,r:20,t:20,b:20}, height:460 };
  Plotly.react('sankeyDiv', data, layout, {displaylogo:false});
}

/* Build a table of breakdown */
function renderBreakdownTable(aggregated){
  const wrap = document.getElementById('tableWrap');
  const rows = Object.entries(aggregated).map(([k,v]) => ({activity:k, qty:v.qty, unit:v.unit, co2: Math.round(v.co2*100)/100 }));
  let html = `<table class="table"><thead><tr><th>Activity</th><th>Quantity</th><th>Unit</th><th>CO₂e (kg)</th></tr></thead><tbody>`;
  rows.forEach(r=> html += `<tr><td>${r.activity}</td><td>${r.qty.toLocaleString()}</td><td>${r.unit}</td><td>${r.co2.toLocaleString()}</td></tr>`);
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

/* Suggestions engine (simple rule-based) */
function buildSuggestions(totalCO2, aggregated){
  const list = document.getElementById('suggestionsList');
  list.innerHTML = '';
  // rules based on total CO2 (you can tune thresholds)
  if(totalCO2 > 500000){
    addSuggestion('Very high emissions detected. Consider immediate energy efficiency measures, renewables, and professional energy audit.');
  } else if(totalCO2 > 100000){
    addSuggestion('High emissions. Review fuel mix, optimize boiler efficiency, and explore solar rooftop + heat recovery.');
  } else if(totalCO2 > 20000){
    addSuggestion('Moderate emissions. Implement operational improvements, reduce idle running, and plan for renewable adoption.');
  } else {
    addSuggestion('Low emissions for this dataset. Continue with monitoring, and consider circularity improvements.');
  }

  // category-specific suggestions for largest contributors
  const sorted = Object.entries(aggregated).sort((a,b)=> b[1].co2 - a[1].co2);
  if(sorted.length>0){
    const [top,info] = sorted[0];
    addSuggestion(`Top contributor: ${top} (${Math.round(info.co2)} kg CO₂e). Consider targeted measures for ${top}.`);
    if(top.toLowerCase().includes('electric')){
      addSuggestion('Electricity is top source — consider installing solar PV, replacing motors with energy-efficient ones, and load management.');
    }
    if(top.toLowerCase().includes('diesel') || top.toLowerCase().includes('fuel')){
      addSuggestion('Boiler/fuel emissions are high — consider fuel switching to natural gas/biomass or improve combustion efficiency.');
    }
    if(top.toLowerCase().includes('waste')){
      addSuggestion('High waste emissions — implement waste reduction, material reuse, or partner with recycling firms.');
    }
  }
}

function addSuggestion(text){
  const li = document.createElement('li');
  li.textContent = text;
  document.getElementById('suggestionsList').appendChild(li);
}

/* Main: Build dashboard from stored CSV string */
async function buildDashboardFromStoredCSV(){
  const raw = localStorage.getItem('activityDataCSV');
  if(!raw){
    alert('No CSV found in storage. Please upload CSV on upload.html first.');
    return;
  }
  // parse
  const rows = await parseCSVString(raw);
  // compute
  const { totalCO2, aggregated } = computeEmissions(rows);

  // update KPIs
  document.getElementById('totalCO2').innerText = totalCO2.toLocaleString() + ' kg';
  // top source
  const keys = Object.keys(aggregated).sort((a,b)=> aggregated[b].co2 - aggregated[a].co2);
  document.getElementById('topSource').innerText = keys.length ? `${keys[0]} (${Math.round(aggregated[keys[0]].co2)} kg)` : '—';
  // circularity simple (we don't have reused column; show placeholder)
  document.getElementById('circ').innerText = 'N/A';

  // prepare data for charts
  const labels = keys;
  const co2s = labels.map(k => Math.round(aggregated[k].co2*100)/100);

  // render charts
  if(labels.length>0){
    renderBarChart(labels, co2s);
    renderPieChart(labels, co2s);
    renderSankey(aggregated);
  } else {
    console.warn('No aggregated data to render charts.');
  }

  renderBreakdownTable(aggregated);
  buildSuggestions(totalCO2, aggregated);
}

/* export functions for debugging if loaded in other contexts */
window.computeEmissions = computeEmissions;
window.buildDashboardFromStoredCSV = buildDashboardFromStoredCSV;

