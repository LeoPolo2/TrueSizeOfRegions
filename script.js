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
    }).addTo(map);

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
    
    // Store the original coordinates and center
    const originalCoords = JSON.parse(JSON.stringify(originalFeature.geometry.coordinates));
    const originalCenter = calculateCenterFromCoords(originalCoords, originalFeature.geometry.type);
    
    layer.on('mousedown', function(e) {
        isDragging = true;
        dragStartLatLng = e.latlng;
        map.dragging.disable();
        map.off('click');
        
        // Change cursor to indicate dragging
        map.getContainer().style.cursor = 'grabbing';
        
        // Prevent default map interactions
        L.DomEvent.stopPropagation(e);
    });

    map.on('mousemove', function(e) {
        if (!isDragging) return;
        
        const currentLatLng = e.latlng;
        const deltaLat = currentLatLng.lat - dragStartLatLng.lat;
        const deltaLng = currentLatLng.lng - dragStartLatLng.lng;
        
        // Calculate new center
        const newCenter = L.latLng(originalCenter.lat + deltaLat, originalCenter.lng + deltaLng);
        
        // Apply the transformation: move first, then rescale
        const transformedCoords = transformCoordinates(originalCoords, originalCenter, newCenter, originalFeature.geometry.type);
        
        // Convert to LatLngs and update layer
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

    // Also handle mouse leave to stop dragging
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
    // First, translate the coordinates
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
    
    // Then apply mercator projection correction
    return applyMercatorCorrection(translatedCoords, originalCenter, newCenter, geometryType);
}

function applyMercatorCorrection(coords, originalCenter, newCenter, geometryType) {
    // Calculate the scaling factor based on latitude change
    // This corrects for the Mercator projection distortion
    const originalLat = Math.abs(originalCenter.lat);
    const newLat = Math.abs(newCenter.lat);
    
    // Avoid extreme scaling near poles
    const clampedOriginalLat = Math.min(Math.max(originalLat, 0.1), 85);
    const clampedNewLat = Math.min(Math.max(newLat, 0.1), 85);
    
    // Calculate scale factor using the secant of latitude (inverse cosine)
    const originalScale = 1 / Math.cos(clampedOriginalLat * Math.PI / 180);
    const newScale = 1 / Math.cos(clampedNewLat * Math.PI / 180);
    const scaleFactor = newScale / originalScale;
    
    // Only apply significant scaling to avoid jitter
    if (Math.abs(scaleFactor - 1) < 0.01) {
        return coords;
    }
    
    function scaleRing(ring) {
        return ring.map(coord => {
            const dLng = coord[0] - newCenter.lng;
            const dLat = coord[1] - newCenter.lat;
            
            return [
                newCenter.lng + dLng * scaleFactor,
                newCenter.lat + dLat // Latitude doesn't scale in Mercator
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
