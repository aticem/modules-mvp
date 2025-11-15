import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/turf";
import ExcelJS from "exceljs";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import "./index.css";

// Register ChartDataLabels plugin
Chart.register(ChartDataLabels);

/* --------------------------------------------------------------
   SVG HATCH PATTERN
-------------------------------------------------------------- */
function AddSVGPatterns() {
    const map = useMap();
    useEffect(() => {
        // Wait for SVG to be created
        const createPattern = () => {
            const svg = map.getPanes().overlayPane.querySelector("svg");
            if (!svg) {
                requestAnimationFrame(createPattern);
                return;
            }

            let defs = svg.querySelector("defs");
            if (!defs) {
                defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                svg.prepend(defs);
            }

            // Remove existing pattern if it exists
            const existing = defs.querySelector("#hatchGreen");
            if (existing) existing.remove();

            const hatch = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
            hatch.setAttribute("id", "hatchGreen");
            hatch.setAttribute("patternUnits", "userSpaceOnUse");
            hatch.setAttribute("width", "10");
            hatch.setAttribute("height", "10");
            hatch.setAttribute("patternTransform", "rotate(45)");

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", "0");
            line.setAttribute("y1", "0");
            line.setAttribute("x2", "10");
            line.setAttribute("y2", "10");
            line.setAttribute("stroke", "#16a34a");
            line.setAttribute("stroke-width", "2");
            line.setAttribute("opacity", "0.6");

            hatch.appendChild(line);
            defs.appendChild(hatch);
            
            // Mark pattern as ready
            window._hatchPatternReady = true;
        };
        
        // Create pattern when map is ready
        map.whenReady(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(createPattern);
            });
        });
    }, [map]);
    return null;
}

/* --------------------------------------------------------------
   Fit bounds
-------------------------------------------------------------- */
function FitToDataOnce({ geojson }) {
    const map = useMap();
    const fittedRef = useRef(false);

    useEffect(() => {
        if (!geojson || fittedRef.current) return;
        const gj = L.geoJSON(geojson);
        const bounds = gj.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.15));
            fittedRef.current = true;
        }
    }, [geojson]);

    return null;
}

/* Ensure lines stay in background */
function BringLinesToBack() {
    const map = useMap();
    
    useEffect(() => {
        // Find all layers and bring lines to back
        const bringLinesBack = () => {
            map.eachLayer((layer) => {
                if (layer.feature?.properties?._isLinesLayer || 
                    (layer.options && layer.options.interactive === false && layer._path)) {
                    if (layer.bringToBack) {
                        layer.bringToBack();
                    }
                }
            });
        };
        
        // Try multiple times to ensure it happens after all layers are added
        bringLinesBack();
        const timeout1 = setTimeout(bringLinesBack, 100);
        const timeout2 = setTimeout(bringLinesBack, 500);
        
        return () => {
            clearTimeout(timeout1);
            clearTimeout(timeout2);
        };
    }, [map]);
    
    return null;
}

/* --------------------------------------------------------------
   SelectionTools
-------------------------------------------------------------- */
function SelectionTools({ layersRef, setStatusByLayer }) {
    const map = useMap();

    const startRef = useRef(null);
    const rectRef = useRef(null);
    const isDrawing = useRef(false);
    const hasDragged = useRef(false);
    const buttonRef = useRef(null);

    useEffect(() => {
        const container = map.getContainer();
        
        // Prevent context menu (at map level)
        const blockContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        container.addEventListener("contextmenu", blockContextMenu);

        const createBox = (p1, p2, color) => {
            if (!rectRef.current) {
                const div = document.createElement("div");
                div.style.position = "absolute";
                div.style.pointerEvents = "none";
                div.style.zIndex = 999;
                container.appendChild(div);
                rectRef.current = div;
            }

            const left = Math.min(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y);
            const width = Math.abs(p2.x - p1.x);
            const height = Math.abs(p2.y - p1.y);

            Object.assign(rectRef.current.style, {
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                border: `1px dashed ${color}`,
                background: "transparent"
            });
        };

        const removeBox = () => {
            if (rectRef.current) {
                rectRef.current.remove();
                rectRef.current = null;
            }
        };

        const onMouseDown = (e) => {
            const btn = e.originalEvent.button;
            
            // Show grab cursor when middle button (button === 1) is pressed
            if (btn === 1) {
                container.classList.add("middle-button-active");
                return;
            }
            
            if (btn !== 0 && btn !== 2) return;

            // If click is on a layer, do nothing
            // Layer's own click event will handle single click
            const latlng = map.mouseEventToLatLng(e.originalEvent);
            const pPt = point([latlng.lng, latlng.lat]);
            let clickedOnLayer = false;
            
            for (const entry of layersRef.current) {
                try {
                    if (booleanPointInPolygon(pPt, entry.layer.feature, {
                        ignoreBoundary: true,
                    })) {
                        clickedOnLayer = true;
                        break;
                    }
                } catch {}
            }

            // If on a layer, do nothing (layer's click/mousedown events will handle it)
            // Only process if on empty area or when dragging
            if (clickedOnLayer) {
                // On layer - let layer's events handle it (left click → DONE, right click → TODO)
                return;
            }

            const p = map.mouseEventToContainerPoint(e.originalEvent);
            startRef.current = p;
            isDrawing.current = true;
            hasDragged.current = false;
            buttonRef.current = btn;
        };

        const onMouseMove = (e) => {
            if (!isDrawing.current) return;
            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            const p1 = startRef.current;
            const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
            );

            // If mouse moved more than 5px, dragging is happening
            if (distance > 5) {
                if (!hasDragged.current) {
                    // On first drag, preventDefault and disable dragging
                    hasDragged.current = true;
                    e.originalEvent.preventDefault();
                    map.dragging.disable();
                }
                const color = buttonRef.current === 0 ? "#22c55e" : "#ef4444";
                createBox(startRef.current, p2, color);
            }
        };

        const onMouseUp = (e) => {
            if (!isDrawing.current) return;
            isDrawing.current = false;

            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            const p1 = startRef.current;
            const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
            );

            // If dragging occurred (more than 5px movement), perform multi-selection
            if (hasDragged.current && distance > 5) {
                e.originalEvent.preventDefault();
                e.originalEvent.stopPropagation();

                const left = Math.min(p1.x, p2.x);
                const right = Math.max(p1.x, p2.x);
                const top = Math.min(p1.y, p2.y);
                const bottom = Math.max(p1.y, p2.y);

                const status = buttonRef.current === 0 ? "done" : "todo";

                layersRef.current.forEach(({ layer }) => {
                    const b = layer.getBounds();
                    if (!b.isValid()) return;

                    const nw = map.latLngToContainerPoint(b.getNorthWest());
                    const se = map.latLngToContainerPoint(b.getSouthEast());

                    const minX = Math.min(nw.x, se.x);
                    const maxX = Math.max(nw.x, se.x);
                    const minY = Math.min(nw.y, se.y);
                    const maxY = Math.max(nw.y, se.y);

                    if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
                        setStatusByLayer(layer, status);
                    }
                });
            } else {
                // If only click occurred (no dragging)
                // If on a layer, let layer's click/mousedown events handle it
                const latlng = map.containerPointToLatLng(p2);
                const pPt = point([latlng.lng, latlng.lat]);
                
                for (const entry of layersRef.current) {
                    try {
                        if (booleanPointInPolygon(pPt, entry.layer.feature, {
                            ignoreBoundary: true,
                        })) {
                            // On layer, layer's events will handle it
                            // Do nothing
                            removeBox();
                            map.dragging.enable();
                            hasDragged.current = false;
                            return;
                        }
                    } catch {}
                }
            }

            removeBox();
            map.dragging.enable();
            hasDragged.current = false;
        };

        const onClick = (e) => {
            // If dragging occurred, ignore onClick
            if (hasDragged.current) {
                hasDragged.current = false;
                return;
            }

            // Layers' own click/mousedown events will handle it
            // No need to do anything here
        };

        const onMouseUpGlobal = (e) => {
            // Remove grab cursor when middle button is released
            if (e.button === 1) {
                container.classList.remove("middle-button-active");
            }
        };

        map.on("mousedown", onMouseDown);
        map.on("mousemove", onMouseMove);
        map.on("mouseup", onMouseUp);
        map.on("click", onClick);
        
        // Global mouseup event for middle button (even if mouse leaves map)
        document.addEventListener("mouseup", onMouseUpGlobal);

        return () => {
            container.removeEventListener("contextmenu", blockContextMenu);
            document.removeEventListener("mouseup", onMouseUpGlobal);
            map.off("mousedown", onMouseDown);
            map.off("mousemove", onMouseMove);
            map.off("mouseup", onMouseUp);
            map.off("click", onClick);
        };
    }, []);

    return null;
}

/* --------------------------------------------------------------
   MAIN APP
-------------------------------------------------------------- */
/* --------------------------------------------------------------
   Submit Daily Work Modal
-------------------------------------------------------------- */
function SubmitModal({ isOpen, onClose, onSubmit, dailyInstalled }) {
    // Initialize date with today's date in YYYY-MM-DD format
    const today = new Date().toISOString().slice(0, 10);
    const [date, setDate] = useState(today);
    const [subcontractor, setSubcontractor] = useState("");
    const [workers, setWorkers] = useState("");

    // Reset date to today when modal opens
    useEffect(() => {
        if (isOpen) {
            setDate(new Date().toISOString().slice(0, 10));
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!date || !subcontractor.trim() || !workers.trim()) {
            alert("Please fill in all fields");
            return;
        }
        const workerCount = parseInt(workers, 10);
        if (isNaN(workerCount) || workerCount <= 0) {
            alert("Please enter a valid number of workers");
            return;
        }
        onSubmit(date, subcontractor.trim(), workerCount);
        setDate(today);
        setSubcontractor("");
        setWorkers("");
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>Submit Daily Work</h2>
                <div className="modal-info">
                    <p>Today's installed panels: <strong>{dailyInstalled}</strong></p>
                </div>
                <div className="modal-form">
                    <label>
                        Date
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </label>
                    <label>
                        Subcontractor name
                        <input
                            type="text"
                            value={subcontractor}
                            onChange={(e) => setSubcontractor(e.target.value)}
                            placeholder="e.g., BZ Construction"
                            autoFocus
                        />
                    </label>
                    <label>
                        Number of workers
                        <input
                            type="number"
                            value={workers}
                            onChange={(e) => setWorkers(e.target.value)}
                            placeholder="e.g., 15"
                            min="1"
                        />
                    </label>
                </div>
                <div className="modal-actions">
                    <button className="ui" onClick={onClose}>Cancel</button>
                    <button className="ui" onClick={handleSubmit} style={{ background: "#22c55e" }}>Save / Submit</button>
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const [base, setBase] = useState(null);
    const [features, setFeatures] = useState([]);
    const [linesGeo, setLinesGeo] = useState(null);
    const [geoKey, setGeoKey] = useState(0);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [dailyLog, setDailyLog] = useState([]);

    const layersRef = useRef([]);

    const svgRenderer = useMemo(() => L.svg(), []);

    /* load lines.geojson - visual only, background layer */
    useEffect(() => {
        const load = async () => {
            const urls = ["lines.geojson", "/lines.geojson", "/public/lines.geojson"];
            let text = null;

            for (const u of urls) {
                try {
                    const r = await fetch(u, { cache: "no-store" });
                    if (!r.ok) continue;

                    const t = await r.text();
                    if (!t.trim().startsWith("<") && t.trim()) {
                        text = t;
                        break;
                    }
                } catch {}
            }

            if (text) {
                try {
                    const gj = JSON.parse(text);
                    
                    // Filter out invalid LineStrings (same coordinates - points)
                    const validFeatures = gj.features?.filter((feature) => {
                        if (feature.geometry?.type === "LineString") {
                            const coords = feature.geometry.coordinates;
                            if (coords && coords.length >= 2) {
                                // Check if coordinates are different
                                const first = coords[0];
                                const last = coords[coords.length - 1];
                                // At least 2 different coordinates needed
                                if (coords.length > 2 || 
                                    Math.abs(first[0] - last[0]) > 0.000001 || 
                                    Math.abs(first[1] - last[1]) > 0.000001) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }) || [];
                    
                    const processedGeoJson = {
                        ...gj,
                        features: validFeatures
                    };
                    
                    console.log(`Lines GeoJSON loaded: ${gj.features?.length || 0} features, ${validFeatures.length} valid LineStrings (visual only, background)`);
                    
                    // Debug: Log first few valid features
                    if (validFeatures.length > 0) {
                        console.log("Sample lines feature:", validFeatures[0]);
                    }
                    
                    setLinesGeo(processedGeoJson);
                } catch (e) {
                    console.error("Failed to parse lines.geojson", e);
                }
            }
        };

        load();
    }, []);

    /* load geojson */
    useEffect(() => {
        const load = async () => {
            const urls = ["panels.geojson", "/panels.geojson", "/public/panels.geojson"];
            let text = null;

            for (const u of urls) {
                try {
                    const r = await fetch(u, { cache: "no-store" });
                    if (!r.ok) continue;

                    const t = await r.text();
                    if (!t.trim().startsWith("<")) {
                        text = t;
                        break;
                    }
                } catch {}
            }

            if (!text) {
                console.error("panels.geojson not found");
                return;
            }

            const gj = JSON.parse(text);
            const merged = gj.features.map((f, i) => ({
                ...f,
                properties: {
                    ...f.properties,
                    panel_id: f.properties.panel_id || `P${i + 1}`,
                    // Only use total_panels if it exists and is a valid number, otherwise 0 (don't count tables)
                    total_panels: (f.properties.total_panels !== undefined && f.properties.total_panels !== null) 
                        ? Number(f.properties.total_panels) || 0 
                        : 0,
                    status: f.properties.status || "todo"
                }
            }));

            console.log(`GeoJSON loaded: ${merged.length} features`);
            setBase(gj);
            setFeatures(merged);
        };

        load();
    }, []);

    /* load daily log from localStorage */
    useEffect(() => {
        const stored = localStorage.getItem("dailyLog");
        if (stored) {
            try {
                setDailyLog(JSON.parse(stored));
            } catch (e) {
                console.error("Failed to parse dailyLog from localStorage", e);
            }
        }
    }, []);

    /* stats */
    const stats = useMemo(() => {
        // Only count panels, not tables (total_panels must be > 0)
        const total = features.reduce((s, f) => s + (f.properties.total_panels || 0), 0);
        const done = features.reduce(
            (s, f) => s + (f.properties.status === "done" ? (f.properties.total_panels || 0) : 0),
            0
        );
        const percentage = total > 0 ? ((done / total) * 100).toFixed(2) : "0.00";
        return { total, done, remaining: total - done, percentage };
    }, [features]);

    /* calculate daily installed panels */
    const dailyInstalled = useMemo(() => {
        // Only count panels, not tables (total_panels must be > 0)
        return features
            .filter(f => f.properties.status === "done")
            .reduce((s, f) => s + (f.properties.total_panels || 0), 0);
    }, [features]);

    /* submit daily work */
    const handleSubmitDailyWork = (date, subcontractor, workers) => {
        const record = {
            date: date,
            installed_panels: dailyInstalled,
            subcontractor,
            workers
        };

        const existing = JSON.parse(localStorage.getItem("dailyLog") || "[]");
        existing.push(record);
        localStorage.setItem("dailyLog", JSON.stringify(existing));
        setDailyLog([...existing]);
    };

    /* --------------------------------------------------------------
       STYLES
-------------------------------------------------------------- */
    /* Visual-only style for lines.geojson - background layer, no interaction */
    const linesStyleFn = (feature) => {
        return {
            weight: 4.0,
            color: "#ef4444", // Red for testing - change back to gray later
            opacity: 1.0, // Full opacity
            fill: false,
            interactive: false,
            pointerEvents: "none"
        };
    };

    const styleFn = (feat) => {
        const base = {
            weight: 1.0,
            color: "#cbd5e1",
            fill: true,
            fillColor: "transparent",
            fillOpacity: 0.2,
            interactive: true
        };

        if (feat.properties.status === "done") {
            return {
                ...base,
                color: "#16a34a",
                fillColor: "transparent", // Make transparent so hatch pattern is visible
                fillOpacity: 0
            };
        }

        return base;
    };

    const hoverStyle = {
        weight: 2,
        color: "#60a5fa",
        fillColor: "rgba(147,197,253,0.35)",
        fillOpacity: 0.45
    };

    /* --------------------------------------------------------------
       STATUS CHANGE
-------------------------------------------------------------- */
    const setStatusByLayer = (layer, status) => {
        layer.feature.properties.status = status;

        // remove hover class immediately
        if (layer._path) {
            layer._path.classList.remove("panel-hover");
        }

        layer.setStyle(styleFn(layer.feature));

        // Apply hatch pattern to SVG path element (after setStyle)
        if (status === "done") {
            // Wait for path element to update and apply pattern
            const applyHatch = () => {
                if (layer._path) {
                    // Ensure pattern is ready
                    const svg = layer._path.ownerSVGElement;
                    if (svg) {
                        const defs = svg.querySelector("defs");
                        const pattern = defs?.querySelector("#hatchGreen");
                        if (!pattern) {
                            // Pattern not ready yet, try again
                            requestAnimationFrame(applyHatch);
                            return;
                        }
                    }
                    
                    // Apply hatch pattern directly to SVG path element
                    layer._path.setAttribute("fill", "url(#hatchGreen)");
                    layer._path.setAttribute("fill-opacity", "0.8");
                    // Set CSS style with important so Leaflet can't override it
                    layer._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                    layer._path.style.setProperty("fill-opacity", "0.8", "important");
                    
                    // Continuously monitor with MutationObserver and preserve pattern
                    if (!layer._hatchObserver) {
                        layer._hatchObserver = new MutationObserver(() => {
                            if (layer._path && layer.feature.properties.status === "done") {
                                const currentFill = layer._path.getAttribute("fill") || layer._path.style.fill;
                                if (currentFill !== "url(#hatchGreen)") {
                                    layer._path.setAttribute("fill", "url(#hatchGreen)");
                                    layer._path.setAttribute("fill-opacity", "0.8");
                                    layer._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                                    layer._path.style.setProperty("fill-opacity", "0.8", "important");
                                }
                            }
                        });
                        layer._hatchObserver.observe(layer._path, {
                            attributes: true,
                            attributeFilter: ["fill", "style"],
                            subtree: false
                        });
                    }
                } else {
                    requestAnimationFrame(applyHatch);
                }
            };
            // Wait a few frames for setStyle to complete
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(applyHatch);
                });
            });
        } else {
            // Remove pattern and clean up observer
            if (layer._hatchObserver) {
                layer._hatchObserver.disconnect();
                layer._hatchObserver = null;
            }
            if (layer._path) {
                layer._path.removeAttribute("fill");
                layer._path.removeAttribute("fill-opacity");
                layer._path.style.removeProperty("fill");
                layer._path.style.removeProperty("fill-opacity");
            }
        }

        if (status === "done" && layer.bringToBack) {
            layer.bringToBack();
        }

        setFeatures(prev =>
            prev.map(f =>
                f.properties.panel_id === layer.feature.properties.panel_id
                    ? { ...f, properties: { ...f.properties, status } }
                    : f
            )
        );
    };

    /* --------------------------------------------------------------
       HOVER — ONLY WHEN MOUSE IS INSIDE POLYGON FILL
-------------------------------------------------------------- */
    const onEach = (feature, layer) => {
        // Function to apply hatch pattern
        const applyHatchPattern = () => {
            if (layer._path && feature.properties.status === "done") {
                // Ensure pattern is ready
                const svg = layer._path.ownerSVGElement;
                if (svg) {
                    const defs = svg.querySelector("defs");
                    const pattern = defs?.querySelector("#hatchGreen");
                    if (!pattern) {
                        // Pattern not ready yet, try again
                        requestAnimationFrame(applyHatchPattern);
                        return;
                    }
                }
                
                // Apply hatch pattern directly to SVG path element
                layer._path.setAttribute("fill", "url(#hatchGreen)");
                layer._path.setAttribute("fill-opacity", "0.8");
                // Set CSS style with important so Leaflet can't override it
                layer._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                layer._path.style.setProperty("fill-opacity", "0.8", "important");
            }
        };

        // Apply hatch pattern when layer is added
        layer.on("add", () => {
            if (feature.properties.status === "done") {
                requestAnimationFrame(() => {
                    requestAnimationFrame(applyHatchPattern);
                });
            }
        });

        // Monitor path element and continuously apply pattern (if Leaflet overrides it)
        if (feature.properties.status === "done") {
            const observer = new MutationObserver(() => {
                if (layer._path && feature.properties.status === "done") {
                    const currentFill = layer._path.getAttribute("fill") || layer._path.style.fill;
                    if (currentFill !== "url(#hatchGreen)") {
                        applyHatchPattern();
                    }
                }
            });

            // Start observer when path element is created
            const startObserver = () => {
                if (layer._path) {
                    observer.observe(layer._path, {
                        attributes: true,
                        attributeFilter: ["fill", "style"],
                        subtree: false
                    });
                } else {
                    requestAnimationFrame(startObserver);
                }
            };
            requestAnimationFrame(() => {
                requestAnimationFrame(startObserver);
            });

            // Cleanup
            layer.on("remove", () => {
                observer.disconnect();
            });
        }

        // If layer is already added and done, apply directly
        if (feature.properties.status === "done") {
            requestAnimationFrame(() => {
                requestAnimationFrame(applyHatchPattern);
            });
        }

        layer.on("mouseover", function () {
            if (feature.properties.status === "done") return;
            this.setStyle(hoverStyle);
            if (this._path) this._path.classList.add("panel-hover");
        });

        layer.on("mouseout", function () {
            if (feature.properties.status === "done") {
                // Restore hatch pattern on done tables
                this.setStyle(styleFn(feature));
                if (this._path) {
                    // Ensure pattern is ready
                    const svg = this._path.ownerSVGElement;
                    if (svg) {
                        const defs = svg.querySelector("defs");
                        const pattern = defs?.querySelector("#hatchGreen");
                        if (pattern) {
                            // Restore hatch pattern
                            this._path.setAttribute("fill", "url(#hatchGreen)");
                            this._path.setAttribute("fill-opacity", "0.8");
                            this._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                            this._path.style.setProperty("fill-opacity", "0.8", "important");
                        }
                    }
                }
                return;
            }
            this.setStyle(styleFn(feature));
            if (this._path) this._path.classList.remove("panel-hover");
        });

        // Prevent context menu (right-click menu)
        layer.on("contextmenu", function (e) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        });

        // Left click → table DONE
        layer.on("click", function (e) {
            if (e.originalEvent.button !== 0) return;
            if (feature.properties.status === "done") return;

            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent.stopImmediatePropagation();

            // Directly set to DONE
            setStatusByLayer(layer, "done");
        });

        // Right click → table TODO (unselect)
        layer.on("mousedown", function (e) {
            if (e.originalEvent.button !== 2) return;
            
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent.stopImmediatePropagation();

            // Directly set to TODO
            setStatusByLayer(layer, "todo");
        });

        layersRef.current.push({ id: feature.properties.panel_id, layer });
    };

    /* EXPORT */
    // Chart reference
    const chartRef = useRef(null);

    // Function to build chart
    const buildChart = (dailyLog) => {
        // Destroy existing chart if any
        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const canvas = document.getElementById("dailyChart");
        if (!canvas) {
            console.error("Canvas element not found");
            return null;
        }

        const ctx = canvas.getContext("2d");
        
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: dailyLog.map(d => d.date),
                datasets: [
                    {
                        label: "Installed Panels",
                        data: dailyLog.map(d => d.installed_panels),
                        backgroundColor: "rgba(0, 102, 204, 0.8)",
                        borderColor: "#000",
                        borderWidth: 1
                    }
                ]
            },
            plugins: [ChartDataLabels],
            options: {
                responsive: false,
                maintainAspectRatio: false,
                barPercentage: 0.5, // Bar width is 50% of category width (thinner bars)
                categoryPercentage: 0.8, // Spacing between categories
                plugins: {
                    datalabels: {
                        anchor: "end",
                        align: "end",
                        color: "#000",
                        font: { weight: "bold", size: 12 },
                        formatter: (value, ctx) => {
                            const row = dailyLog[ctx.dataIndex];
                            if (!row) return "";
                            const subFirst3 = row.subcontractor ? row.subcontractor.slice(0, 3).toUpperCase() : "";
                            return `${row.workers}\n${subFirst3}`;
                        }
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Date',
                            font: { size: 12, weight: 'bold' }
                        },
                        ticks: { 
                            maxRotation: 0, 
                            minRotation: 0,
                            font: { size: 10 }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Installed Panels',
                            font: { size: 12, weight: 'bold' }
                        },
                        beginAtZero: true,
                        ticks: {
                            font: { size: 10 }
                        }
                    }
                }
            }
        });

        chartRef.current = chart;
        return chart;
    };

    const exportCSV = async () => {
        try {
            console.log("Export started...");
            
            // Get daily log from localStorage
            const stored = localStorage.getItem("dailyLog");
            console.log("Stored dailyLog in localStorage:", stored);
            
            const daily = stored ? JSON.parse(stored) : [];
            console.log("Parsed daily log:", daily);
            
            if (!Array.isArray(daily)) {
                console.error("Invalid dailyLog format, clearing...");
                localStorage.removeItem("dailyLog");
                alert("Daily log data is corrupted. It has been cleared. Please try again.");
                return;
            }
            
            if (daily.length === 0) {
                alert("No daily log data to export");
                return;
            }

            console.log("Daily log data:", daily);

            // Aggregate by date: sum installed_panels and workers, combine subcontractors
            const aggregatedByDate = {};
            daily.forEach(record => {
                const date = record.date;
                if (!aggregatedByDate[date]) {
                    aggregatedByDate[date] = {
                        date: date,
                        installed_panels: 0,
                        workers: 0,
                        subcontractors: []
                    };
                }
                aggregatedByDate[date].installed_panels += (record.installed_panels || 0);
                aggregatedByDate[date].workers += (record.workers || 0);
                if (record.subcontractor && !aggregatedByDate[date].subcontractors.includes(record.subcontractor)) {
                    aggregatedByDate[date].subcontractors.push(record.subcontractor);
                }
            });

            // Convert to array and format for chart (use first subcontractor's first 3 letters)
            const aggregatedDaily = Object.values(aggregatedByDate).map(item => ({
                date: item.date,
                installed_panels: item.installed_panels,
                workers: item.workers,
                subcontractor: item.subcontractors.length > 0 ? item.subcontractors[0] : ""
            }));

            // Sort by date
            const sortedDaily = aggregatedDaily.sort((a, b) => new Date(a.date) - new Date(b.date));

            // Create and render chart
            console.log("Creating chart...");
            const chart = buildChart(sortedDaily);
            
            if (!chart) {
                throw new Error("Failed to create chart");
            }

            // Wait a bit for chart to render
            await new Promise(resolve => setTimeout(resolve, 500));

            // Get canvas and convert to PNG
            const canvas = document.getElementById("dailyChart");
            if (!canvas) {
                throw new Error("Canvas element not found");
            }

            const pngDataUrl = canvas.toDataURL("image/png");
            console.log("Chart converted to PNG");

            // Create workbook
            console.log("Creating workbook...");
            const workbook = new ExcelJS.Workbook();

            // Sheet1: Daily Log
            const dailyLogSheet = workbook.addWorksheet("Daily Log");
            
            // Add headers
            dailyLogSheet.addRow(["date", "installed_panels", "workers", "subcontractor"]);
            
            // Style header row
            const headerRow = dailyLogSheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1e293b' }
            };
            headerRow.font = { bold: true, color: { argb: 'FFe5e7eb' } };
            
            // Add data rows
            sortedDaily.forEach(record => {
                dailyLogSheet.addRow([
                    record.date,
                    record.installed_panels,
                    record.workers,
                    record.subcontractor
                ]);
            });

            // Auto-fit columns
            dailyLogSheet.columns.forEach(column => {
                column.width = 20;
            });

            // Sheet2: Chart (PNG)
            const chartSheet = workbook.addWorksheet("Chart");
            
            // Convert base64 data URL to base64 string
            const base64Data = pngDataUrl.split(',')[1];
            
            // Convert base64 string to Uint8Array for browser
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Add image to Excel
            const imageId = workbook.addImage({
                buffer: bytes,
                extension: 'png'
            });

            // Add image at the top-left corner (A1)
            chartSheet.addImage(imageId, {
                tl: { col: 0, row: 0 },
                ext: { width: 900, height: 500 }
            });

            // Set column width and row height for chart sheet to fit the image
            chartSheet.getColumn(1).width = 100;
            chartSheet.getRow(1).height = 400;
            
            // Freeze first row and column to keep chart visible when scrolling
            chartSheet.views = [{
                state: 'frozen',
                xSplit: 0,
                ySplit: 0
            }];

            // Export
            console.log("Writing file...");
            const buffer = await workbook.xlsx.writeBuffer();
            
            const blob = new Blob([buffer], { 
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" 
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "progress_report.xlsx";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Clean up chart
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
            
            console.log("Export completed successfully!");
        } catch (error) {
            console.error("Export error details:", error);
            console.error("Error stack:", error.stack);
            alert(`Export error: ${error.message}\n\nPlease open browser console (F12) to check detailed error.`);
            
            // Clean up chart on error
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
        }
    };

    const resetAll = () => {
        // Show confirmation dialog
        const confirmed = window.confirm(
            "Are you sure you want to reset all data?\n\n" +
            "This will:\n" +
            "- Reset all panel statuses to 'todo'\n" +
            "- Clear all daily log entries from memory and storage\n" +
            "- This action cannot be undone\n\n" +
            "Click OK to confirm or Cancel to abort."
        );
        
        if (!confirmed) {
            return;
        }

        // Reset panel statuses
        setFeatures(prev =>
            prev.map(f => ({
                ...f,
                properties: { ...f.properties, status: "todo" }
            }))
        );
        setGeoKey(k => k + 1);
        layersRef.current = [];

        // Clear daily log from localStorage and state
        localStorage.removeItem("dailyLog");
        setDailyLog([]);
        
        // Verify localStorage is cleared
        const remaining = localStorage.getItem("dailyLog");
        if (remaining) {
            console.error("Failed to clear dailyLog from localStorage:", remaining);
            // Force clear
            localStorage.setItem("dailyLog", "[]");
        }
        
        console.log("Reset completed: All panel statuses and daily log entries have been cleared.");
    };

    const liveGeo = useMemo(
        () => base && { type: "FeatureCollection", features },
        [base, features]
    );

    return (
        <div className="app">
            <div className="topbar">
                <div className="topbar-left">
                    <div className="stat">Total: <b>{stats.total}</b></div>
                    <div className="stat">Done: <b style={{ color: "#22c55e" }}>{stats.done}</b>, <b style={{ color: "#22c55e" }}>%{stats.percentage}</b></div>
                    <div className="stat">Remaining: <b style={{ color: "#f59e0b" }}>{stats.remaining}</b></div>
                </div>
                <div className="topbar-title">
                    PV Module Installation Progress Tracking
                </div>
                <div className="topbar-right">
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="ui" onClick={() => setIsModalOpen(true)}>Submit Daily Work</button>
                        <button className="ui" onClick={exportCSV}>Export Excel</button>
                        <button className="ui" onClick={resetAll}>Reset All</button>
                    </div>
                </div>
            </div>

            <MapContainer
                center={[52.5, -1.5]}
                zoom={17}
                doubleClickZoom={false}
                touchZoom={false}
                keyboard={false}
                zoomControl={false}
                style={{ height: "calc(100vh - 54px)", width: "100%" }}
            >
                <AddSVGPatterns />

                {/* Lines GeoJSON - background visual layer, no interaction */}
                {linesGeo && linesGeo.features && linesGeo.features.length > 0 && (
                    <>
                        <GeoJSON
                            data={linesGeo}
                            style={linesStyleFn}
                            interactive={false}
                            renderer={svgRenderer}
                            onEachFeature={(feature, layer) => {
                                // Mark as lines layer
                                layer.feature = { ...layer.feature, properties: { ...layer.feature?.properties, _isLinesLayer: true } };
                                
                                // Force bring to back immediately
                                if (layer.bringToBack) {
                                    layer.bringToBack();
                                }
                                
                                // Also use layer events to ensure it stays in back
                                layer.on("add", () => {
                                    if (layer.bringToBack) {
                                        layer.bringToBack();
                                    }
                                });
                                
                                // Debug: Log when layer is added
                                layer.on("add", () => {
                                    console.log("Lines layer added:", feature.properties?.layer || "unknown");
                                });
                            }}
                        />
                        <BringLinesToBack />
                    </>
                )}

                {liveGeo && (
                    <>
                        <FitToDataOnce geojson={liveGeo} />

                        <GeoJSON
                            key={geoKey}
                            data={liveGeo}
                            style={styleFn}
                            onEachFeature={onEach}
                            renderer={svgRenderer}
                        />

                        <SelectionTools
                            layersRef={layersRef}
                            setStatusByLayer={setStatusByLayer}
                        />
                    </>
                )}
            </MapContainer>

            <SubmitModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmitDailyWork}
                dailyInstalled={dailyInstalled}
            />

            {/* Hidden canvas for chart generation */}
            <canvas 
                id="dailyChart" 
                width="900" 
                height="500"
                style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
            />
        </div>
    );
}