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
let statesCache = new Map(); // Cache for loaded states
let statesIndex = []; // Lightweight index of all states

// Load countries immediately, states on demand
Promise.all([
    fetch('countries.geojson').then(res => res.json()),
    loadStatesIndex() // Load just the index, not the full geometries
]).then(([countries, statesIdx]) => {
    // Process countries
    geojsonLayers.countries = L.geoJSON(countries, {
        style: { color: "#333", weight: 1, fillColor: "#ccc", fillOpacity: 0.7 }
    }).addTo(map);

    countries.features.forEach(feature => {
        searchableData.push({
            name: feature.properties.ADMIN,
            type: 'Country',
            geojsonFeature: feature,
            loadType: 'immediate'
        });
    });

    // Add states to searchable data (but don't load geometries yet)
    statesIndex = statesIdx;
    statesIdx.forEach(stateInfo => {
        searchableData.push({
            name: stateInfo.name,
            type: 'State',
            stateId: stateInfo.id,
            loadType: 'ondemand'
        });
    });
});

// Create a lightweight states index (you'd generate this once from your big file)
async function loadStatesIndex() {
    // This would be a small JSON file with just names and IDs
    // Example structure: [{ id: "US-CA", name: "California" }, ...]
    try {
        const response = await fetch('states_index.json');
        return response.json();
    } catch (error) {
        console.log('States index not found, using API fallback');
        return getStatesFromAPI();
    }
}

// Fallback to load states from API
async function getStatesFromAPI() {
    // Using Natural Earth API as example
    try {
        const response = await fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world_population.csv');
        // Process and return state names
        return []; // Placeholder
    } catch (error) {
        console.error('Failed to load states from API');
        return [];
    }
}

// Load individual state geometry when needed
async function loadStateGeometry(stateId) {
    if (statesCache.has(stateId)) {
        return statesCache.get(stateId);
    }

    try {
        // Option 1: Load from individual state files (if you split your big file)
        const response = await fetch(`states/${stateId}.geojson`);
        const stateData = await response.json();
        statesCache.set(stateId, stateData.features[0]);
        return stateData.features[0];
    } catch (error) {
        // Option 2: Fallback to API
        return loadStateFromAPI(stateId);
    }
}

async function loadStateFromAPI(stateId) {
    // Use Overpass API to get specific administrative division
    const query = `
        [out:json][timeout:10];
        relation["ISO3166-1:alpha2"~"${stateId.split('-')[0]}"]["admin_level"="4"];
        out geom;
    `;
    
    try {
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.elements && data.elements.length > 0) {
            // Convert Overpass format to GeoJSON
            const feature = overpassToGeoJSON(data.elements[0]);
            statesCache.set(stateId, feature);
            return feature;
        }
    } catch (error) {
        console.error('Failed to load state from API:', error);
    }
    
    return null;
}

// Convert Overpass API result to GeoJSON
function overpassToGeoJSON(element) {
    // Simplified conversion - you'd need a more robust implementation
    return {
        type: 'Feature',
        properties: {
            name: element.tags.name || 'Unknown'
        },
        geometry: {
            type: 'Polygon',
            coordinates: element.geometry || []
        }
    };
}

// Search functionality with async loading
searchBox.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if (query.length < 2) return;

    const results = searchableData
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 10);

    results.forEach(item => {
        const div = document.createElement('div');
        div.textContent = `${item.name} (${item.type})`;
        div.onclick = async () => {
            await handleSelection(item);
            searchBox.value = '';
            searchResults.innerHTML = '';
        };
        searchResults.appendChild(div);
    });
});

async function handleSelection(item) {
    let feature;
    
    if (item.loadType === 'immediate') {
        feature = item.geojsonFeature;
    } else if (item.loadType === 'ondemand') {
        // Show loading indicator
        searchResults.innerHTML = '<div>Loading...</div>';
        feature = await loadStateGeometry(item.stateId);
        
        if (!feature) {
            searchResults.innerHTML = '<div>Failed to load geometry</div>';
            return;
        }
    }
    
    createDraggableClone(feature);
}

// --- 3. CORE FUNCTIONALITY: CREATE A DRAGGABLE, COLOURED, RESIZING CLONE ---
function createDraggableClone(geojsonFeature) {
    const style = {
        color: palette[colorIndex % palette.length],
        weight: 2,
        fillColor: palette[colorIndex % palette.length],
        fillOpacity: 0.5,
        interactive: true
    };
    colorIndex++;

    const clone = L.geoJSON(geojsonFeature, { 
        style: style,
        onEachFeature: function(feature, layer) {
            makeDraggable(layer, feature);
        }
    }).addTo(map);

    map.flyToBounds(clone.getBounds(), { maxZoom: 8, duration: 0.5 });
}

// --- 4. MAKE POLYGON DRAGGABLE ---
function makeDraggable(layer, originalFeature) {
    let isDragging = false;
    let dragStartLatLng = null;
    
    const originalCoords = JSON.parse(JSON.stringify(originalFeature.geometry.coordinates));
    const originalCenter = calculateCenterFromCoords(originalCoords, originalFeature.geometry.type);
    
    layer.on('mousedown', function(e) {
        isDragging = true;
        dragStartLatLng = e.latlng;
        map.dragging.disable();
        map.off('click');
        map.getContainer().style.cursor = 'grabbing';
        L.DomEvent.stopPropagation(e);
    });

    map.on('mousemove', function(e) {
        if (!isDragging) return;
        
        const currentLatLng = e.latlng;
        const deltaLat = currentLatLng.lat - dragStartLatLng.lat;
        const deltaLng = currentLatLng.lng - dragStartLatLng.lng;
        
        const newCenter = L.latLng(originalCenter.lat + deltaLat, originalCenter.lng + deltaLng);
        const transformedCoords = transformCoordinates(originalCoords, originalCenter, newCenter, originalFeature.geometry.type);
        const newLatLngs = coordsToLatLngs(transformedCoords, originalFeature.geometry.type);
        layer.setLatLngs(newLatLngs);
    });

    map.on('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            map.dragging.enable();
            map.getContainer().style.cursor = '';
        }
    });

    map.on('mouseleave', function() {
        if (isDragging) {
            isDragging = false;
            map.dragging.enable();
            map.getContainer().style.cursor = '';
        }
    });
}

// --- 5. COORDINATE TRANSFORMATION FUNCTIONS ---
function transformCoordinates(coords, originalCenter, newCenter, geometryType) {
    const deltaLat = newCenter.lat - originalCenter.lat;
    const deltaLng = newCenter.lng - originalCenter.lng;
    
    let translatedCoords;
    if (geometryType === 'Polygon') {
        translatedCoords = coords.map(ring => 
            ring.map(coord => [coord[0] + deltaLng, coord[1] + deltaLat])
        );
    } else if (geometryType === 'MultiPolygon') {
        translatedCoords = coords.map(polygon =>
            polygon.map(ring => 
                ring.map(coord => [coord[0] + deltaLng, coord[1] + deltaLat])
            )
        );
    }
    
    return applyMercatorCorrection(translatedCoords, originalCenter, newCenter, geometryType);
}

function applyMercatorCorrection(coords, originalCenter, newCenter, geometryType) {
    const originalLat = Math.abs(originalCenter.lat);
    const newLat = Math.abs(newCenter.lat);
    
    const clampedOriginalLat = Math.min(Math.max(originalLat, 0.1), 85);
    const clampedNewLat = Math.min(Math.max(newLat, 0.1), 85);
    
    const originalScale = 1 / Math.cos(clampedOriginalLat * Math.PI / 180);
    const newScale = 1 / Math.cos(clampedNewLat * Math.PI / 180);
    const scaleFactor = newScale / originalScale;
    
    if (Math.abs(scaleFactor - 1) < 0.01) {
        return coords;
    }
    
    function scaleRing(ring) {
        return ring.map(coord => {
            const dLng = coord[0] - newCenter.lng;
            const dLat = coord[1] - newCenter.lat;
            
            return [
                newCenter.lng + dLng * scaleFactor,
                newCenter.lat + dLat
            ];
        });
    }
    
    if (geometryType === 'Polygon') {
        return coords.map(ring => scaleRing(ring));
    } else if (geometryType === 'MultiPolygon') {
        return coords.map(polygon => 
            polygon.map(ring => scaleRing(ring))
        );
    }
    
    return coords;
}

// --- 6. HELPER FUNCTIONS ---
function calculateCenterFromCoords(coords, geometryType) {
    let totalLat = 0, totalLng = 0, count = 0;
    
    function processRing(ring) {
        ring.forEach(coord => {
            totalLng += coord[0];
            totalLat += coord[1];
            count++;
        });
    }
    
    if (geometryType === 'Polygon') {
        coords.forEach(ring => processRing(ring));
    } else if (geometryType === 'MultiPolygon') {
        coords.forEach(polygon => {
            polygon.forEach(ring => processRing(ring));
        });
    }
    
    return L.latLng(totalLat / count, totalLng / count);
}

function coordsToLatLngs(coords, geometryType) {
    if (geometryType === 'Polygon') {
        return coords.map(ring => ring.map(coord => L.latLng(coord[1], coord[0])));
    } else if (geometryType === 'MultiPolygon') {
        return coords.map(polygon => 
            polygon.map(ring => ring.map(coord => L.latLng(coord[1], coord[0])))
        );
    }
}
