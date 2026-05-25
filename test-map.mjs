import http from 'http';
import fetch from 'node-fetch';

async function runTest() {
  console.log("Starting local test for Akbel Map Assets...");
  
  // Create a minimal server fetch test
  const tests = [
    { name: 'Service Worker (v9999)', url: 'http://localhost:8080/warehouse/sw.js', expectedStatus: 200, checkText: 'akbel-cache-v9999' },
    { name: 'MapLibre JS', url: 'http://localhost:8080/warehouse/maplibre-gl.js', expectedStatus: 200, checkText: 'MapLibre GL JS' },
    { name: 'MapLibre CSS', url: 'http://localhost:8080/warehouse/maplibre-gl.css', expectedStatus: 200, checkText: '' },
    { name: 'Warehouse Map JS (OSM Raster)', url: 'http://localhost:8080/warehouse/assets/warehouse-map.js', expectedStatus: 200, checkText: 'osm-tiles' },
  ];

  let score = 100;

  for (const t of tests) {
    try {
      const res = await fetch(t.url);
      const text = await res.text();
      
      if (res.status !== t.expectedStatus) {
        console.error(`❌ FAILED: ${t.name} returned status ${res.status}`);
        score -= 25;
      } else if (t.checkText && !text.includes(t.checkText)) {
        console.error(`❌ FAILED: ${t.name} did not contain expected text "${t.checkText}"`);
        score -= 25;
      } else {
        console.log(`✅ PASSED: ${t.name} is served correctly.`);
      }
    } catch (e) {
      console.error(`❌ ERROR: Could not fetch ${t.name} - ${e.message}`);
      score -= 25;
    }
  }

  console.log(`\nFinal Score: ${score}/100`);
  process.exit(score === 100 ? 0 : 1);
}

runTest();
