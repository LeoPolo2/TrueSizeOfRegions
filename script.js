const palette = ['#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6'];
let colorIndex = 0;

// --- 1. INITIALISE THE MAP ---
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// --- 2. SETUP SEARCH AND DATA LOADING ---
const searchBox = document.getElementById('search-box');
const searchResults = document.getElementById('search-results');
let searchableData = []; // This will hold { name, type, geojsonFeature }
let geojsonLayers = {}; // To store the rendered layers

// Load both countries and states
Promise.all([
    fetch('countries.geojson').then(res => res.json()),
    fetch('states.geojson').then(res => res.json())
]).then(([countries, states]) => {
    // Process countries
    geojsonLayers.countries = L.geoJSON(countries, {
        style: { color: "#333", weight: 1, fillColor: "#ccc", fillOpacity: 0.7 }
    })

    countries.features.forEach(feature => {
        searchableData.push({
            name: feature.properties.ADMIN,
            type: 'Country',
            geojsonFeature: feature
        });
    });

    // Process states
    geojsonLayers.states = L.geoJSON(states, {
        style: { color: "#777", weight: 0.5, fillColor: "#ddd", fillOpacity: 0.7 }
    }); // Not added to map by default to avoid clutter

    states.features.forEach(feature => {
        searchableData.push({
            name: feature.properties.name,
            type: 'State',
            geojsonFeature: feature
        });
    });
});

// Search functionality
searchBox.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if (query.length < 2) return;

    const results = searchableData
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 10); // Limit to top 10 results

    results.forEach(item => {
        const div = document.createElement('div');
        div.textContent = `${item.name} (${item.type})`;
        div.onclick = () => {
            createDraggableClone(item.geojsonFeature);
            searchBox.value = '';
            searchResults.innerHTML = '';
        };
        searchResults.appendChild(div);
    });
});


// --- 3. CORE FUNCTIONALITY: CREATE A DRAGGABLE, COLOURED, RESIZING CLONE ---
function createDraggableClone(geojsonFeature) {
    // Select the next colour from our palette, and loop back to the start if we're at the end
    const style = {
        color: palette[colorIndex % palette.length],
        weight: 2,
        fillColor: palette[colorIndex % palette.length],
        fillOpacity: 0.5
    };
    colorIndex++; // Increment the index for the next clone

    // Create the new layer with the new style and enable the transform plugin
    const clone = L.geoJSON(geojsonFeature, {
        style: style,
        transform: true // This is crucial for the plugin to work
    }).addTo(map);

    // IMPORTANT: Enable the transformation handles (for dragging, rotating, scaling)
    clone.transform.enable({ rotation: true, scaling: false });

    // When the clone is being dragged, we must trigger our rescale logic
    clone.on('drag', (e) => {
        // We need to get the layer that is actually being transformed
        const transformedLayer = e.target.getLayers()[0];
        const newCenter = transformedLayer.getBounds().getCenter();

        // Get the original coordinates from the feature data to prevent cumulative errors
        const originalLatLngs = L.GeoJSON.coordsToLatLngs(geojsonFeature.geometry.coordinates);

        // Call the rescale function to apply the "true size" effect
        rescalePolygon(transformedLayer, originalLatLngs, newCenter);
    });

    // Fly the map view to the newly created polygon
    map.flyToBounds(clone.getBounds(), { maxZoom: 8, duration: 0.5 });
}

// --- 4. THE "TRUE SIZE" RESCALING LOGIC (REMAINS THE SAME) ---
// ... (The rescalePolygon and rescaleRing functions from the previous code go here) ...
function rescalePolygon(layer, originalLatLngs, newCenter) {
    const centerLatRad = newCenter.lat * Math.PI / 180;
    const scale = 1 / Math.cos(centerLatRad);
    const scaledLatLngs = originalLatLngs.map(function(ring) {
        if (Array.isArray(ring[0])) {
            return ring.map(innerRing => rescaleRing(innerRing, newCenter, scale));
        }
        return rescaleRing(ring, newCenter, scale);
    });
    layer.setLatLngs(scaledLatLngs);
}
function rescaleRing(latlngs, center, scale) {
     return latlngs.map(function(latlng) {
        const dLon = latlng.lng - center.lng;
        const dLat = latlng.lat - center.lat;
        return L.latLng(center.lat + dLat, center.lng + dLon * scale);
    });
}