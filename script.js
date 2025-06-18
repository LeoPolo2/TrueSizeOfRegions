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

// Load countries and prepare states data
loadInitialData();

async function loadInitialData() {
    try {
        // Load countries from your existing file
        const countries = await fetch('countries.geojson').then(res => {
            if (!res.ok) throw new Error('Countries file not found');
            return res.json();
        });

        // Process countries
        geojsonLayers.countries = L.geoJSON(countries, {
            style: { color: "#333", weight: 1, fillColor: "#ccc", fillOpacity: 0.7 }
        })

        countries.features.forEach(feature => {
            searchableData.push({
                name: feature.properties.ADMIN,
                type: 'Country',
                geojsonFeature: feature,
                loadType: 'immediate'
            });
        });

        // Add predefined states/provinces (most popular ones)
        addPredefinedStates();
        
        console.log(`Loaded ${searchableData.length} searchable items`);
        
    } catch (error) {
        console.error('Error loading initial data:', error);
        // Fallback: load everything from APIs
        await loadFromAPIsOnly();
    }
}

// Add popular states/provinces that people commonly search for
function addPredefinedStates() {
    const popularStates = [
        // US States
        { name: 'California', type: 'US State', country: 'US', adminLevel: 4 },
        { name: 'Texas', type: 'US State', country: 'US', adminLevel: 4 },
        { name: 'Florida', type: 'US State', country: 'US', adminLevel: 4 },
        { name: 'New York', type: 'US State', country: 'US', adminLevel: 4 },
        { name: 'Alaska', type: 'US State', country: 'US', adminLevel: 4 },
        
        // Canadian Provinces
        { name: 'Ontario', type: 'Province', country: 'CA', adminLevel: 4 },
        { name: 'Quebec', type: 'Province', country: 'CA', adminLevel: 4 },
        { name: 'British Columbia', type: 'Province', country: 'CA', adminLevel: 4 },
        
        // Australian States
        { name: 'Queensland', type: 'State', country: 'AU', adminLevel: 4 },
        { name: 'New South Wales', type: 'State', country: 'AU', adminLevel: 4 },
        { name: 'Victoria', type: 'State', country: 'AU', adminLevel: 4 },
        { name: 'Western Australia', type: 'State', country: 'AU', adminLevel: 4 },
        
        // Other popular regions
        { name: 'Bavaria', type: 'State', country: 'DE', adminLevel: 4 },
        { name: 'Catalonia', type: 'Region', country: 'ES', adminLevel: 4 },
        { name: 'Tuscany', type: 'Region', country: 'IT', adminLevel: 4 },
        { name: 'Île-de-France', type: 'Region', country: 'FR', adminLevel: 4 },
    ];

    popularStates.forEach(state => {
        searchableData.push({
            name: state.name,
            type: state.type,
            country: state.country,
            adminLevel: state.adminLevel,
            loadType: 'api'
        });
    });
}

// Fallback: load from APIs only
async function loadFromAPIsOnly() {
    try {
        // Load countries from Natural Earth API
        const countriesResponse = await fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world_countries_410m.geojson');
        const countries = await countriesResponse.json();
        
        geojsonLayers.countries = L.geoJSON(countries, {
            style: { color: "#333", weight: 1, fillColor: "#ccc", fillOpacity: 0.7 }
        }).addTo(map);

        countries.features.forEach(feature => {
            searchableData.push({
                name: feature.properties.NAME,
                type: 'Country',
                geojsonFeature: feature,
                loadType: 'immediate'
            });
        });

        addPredefinedStates();
        console.log('Loaded data from APIs successfully');
        
    } catch (error) {
        console.error('Failed to load from APIs:', error);
    }
}

// Search functionality
searchBox.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if (query.length < 2) return;

    const results = searchableData
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 10);

    if (results.length === 0) {
        const div = document.createElement('div');
        div.textContent = 'No results found';
        div.style.fontStyle = 'italic';
        div.style.color = '#666';
        searchResults.appendChild(div);
        return;
    }

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
        createDraggableClone(feature);
    } else if (item.loadType === 'api') {
        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.textContent = 'Loading...';
        loadingDiv.style.fontStyle = 'italic';
        searchResults.innerHTML = '';
        searchResults.appendChild(loadingDiv);
        
        feature = await loadFromOverpassAPI(item);
        searchResults.innerHTML = '';
        
        if (!feature) {
            const errorDiv = document.createElement('div');
            errorDiv.textContent = 'Failed to load. Try a different search.';
            errorDiv.style.color = 'red';
            searchResults.appendChild(errorDiv);
            return;
        }
        
        createDraggableClone(feature);
    }
}

// Load state/province from Overpass API
async function loadFromOverpassAPI(item) {
    const cacheKey = `${item.country}-${item.name}`;
    
    if (statesCache.has(cacheKey)) {
        return statesCache.get(cacheKey);
    }

    try {
        // Build Overpass query for administrative boundaries
        const query = `
            [out:json][timeout:15];
            (
              relation["name"~"${item.name}"]["admin_level"="${item.adminLevel}"]["boundary"="administrative"];
            );
            out geom;
        `;

        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.elements && data.elements.length > 0) {
            // Find the best match
            let bestMatch = data.elements[0];
            
            // Try to find exact name match
            for (let element of data.elements) {
                if (element.tags && element.tags.name && 
                    element.tags.name.toLowerCase() === item.name.toLowerCase()) {
                    bestMatch = element;
                    break;
                }
            }
            
            const feature = await overpassToGeoJSON(bestMatch);
            if (feature) {
                statesCache.set(cacheKey, feature);
                return feature;
            }
        }
    } catch (error) {
        console.error('Overpass API error:', error);
    }
    
    // Fallback: try Nominatim for simpler geometry
    return await loadFromNominatim(item);
}

// Fallback: load from Nominatim API
async function loadFromNominatim(item) {
    try {
        const query = `${item.name}, ${getCountryName(item.country)}`;
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=geojson&polygon_geojson=1&limit=1`
        );
        
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            return data.features[0];
        }
    } catch (error) {
        console.error('Nominatim API error:', error);
    }
    
    return null;
}

// Convert Overpass result to GeoJSON
async function overpassToGeoJSON(element) {
    if (!element.members || !element.tags) {
        return null;
    }

    try {
        // This is a simplified conversion
        // For production, you'd want a more robust OSM to GeoJSON converter
        const coordinates = [];
        
        if (element.members) {
            // Process outer ways
            const outerWays = element.members.filter(m => m.role === 'outer');
            
            if (outerWays.length > 0 && outerWays[0].geometry) {
                const coords = outerWays[0].geometry.map(node => [node.lon, node.lat]);
                coordinates.push(coords);
            }
        }

        if (coordinates.length === 0) {
            return null;
        }

        return {
            type: 'Feature',
            properties: {
                name: element.tags.name || 'Unknown',
                admin_level: element.tags.admin_level
            },
            geometry: {
                type: 'Polygon',
                coordinates: coordinates
            }
        };
    } catch (error) {
        console.error('Error converting Overpass data:', error);
        return null;
    }
}

// Helper to get country name from code
function getCountryName(code) {
    const countries = {
        'US': 'United States',
        'CA': 'Canada',
        'AU': 'Australia',
        'DE': 'Germany',
        'ES': 'Spain',
        'IT': 'Italy',
        'FR': 'France',
        'GB': 'United Kingdom'
    };
    return countries[code] || code;
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
