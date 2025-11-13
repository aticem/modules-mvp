import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/turf";
import "./index.css";

/* --------------------------------------------------------------
   SVG HATCH PATTERN
-------------------------------------------------------------- */
function AddSVGPatterns() {
    const map = useMap();
    useEffect(() => {
        // SVG'nin oluşmasını bekle
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

            // Eğer pattern zaten varsa, önce kaldır
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
            
            // Pattern'in oluşturulduğunu işaretle
            window._hatchPatternReady = true;
        };
        
        // Map hazır olduğunda pattern'i oluştur
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
        
        // Context menu'yu engelle (harita seviyesinde)
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
            if (btn !== 0 && btn !== 2) return;

            // Eğer tıklama bir layer üzerindeyse, hiçbir şey yapma
            // Layer'ın kendi click event'i çalışacak (tek tıklama için)
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

            // Eğer layer üzerindeyse, hiçbir şey yapma (layer'ın click/mousedown event'leri çalışacak)
            // Sadece boş alanda veya sürükleme yapılacaksa işlem yap
            if (clickedOnLayer) {
                // Layer üzerinde - layer'ın event'lerine bırak (sol tık → DONE, sağ tık → TODO)
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

            // Eğer mouse 5px'den fazla hareket ettiyse, sürükleme yapılıyor
            if (distance > 5) {
                if (!hasDragged.current) {
                    // İlk kez sürükleme başladığında preventDefault ve dragging disable
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

            // Eğer sürükleme yapıldıysa (5px'den fazla hareket), çoklu seçim yap
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
                // Eğer sadece tıklama yapıldıysa (sürükleme yok)
                // Layer üzerindeyse, layer'ın click/mousedown event'lerine bırak
                const latlng = map.containerPointToLatLng(p2);
                const pPt = point([latlng.lng, latlng.lat]);
                
                for (const entry of layersRef.current) {
                    try {
                        if (booleanPointInPolygon(pPt, entry.layer.feature, {
                            ignoreBoundary: true,
                        })) {
                            // Layer üzerinde, layer'ın event'leri çalışacak
                            // Hiçbir şey yapma
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
            // Eğer sürükleme yapıldıysa, onClick'i yok say
            if (hasDragged.current) {
                hasDragged.current = false;
                return;
            }

            // Layer'ların kendi click/mousedown event'leri çalışacak
            // Burada hiçbir şey yapmaya gerek yok
        };

        map.on("mousedown", onMouseDown);
        map.on("mousemove", onMouseMove);
        map.on("mouseup", onMouseUp);
        map.on("click", onClick);

        return () => {
            container.removeEventListener("contextmenu", blockContextMenu);
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
export default function App() {
    const [base, setBase] = useState(null);
    const [features, setFeatures] = useState([]);
    const [geoKey, setGeoKey] = useState(0);

    const layersRef = useRef([]);

    const svgRenderer = useMemo(() => L.svg(), []);

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
                console.error("panels.geojson bulunamadı");
                return;
            }

            const gj = JSON.parse(text);
            const merged = gj.features.map((f, i) => ({
                ...f,
                properties: {
                    ...f.properties,
                    panel_id: f.properties.panel_id || `P${i + 1}`,
                    status: f.properties.status || "todo"
                }
            }));

            setBase(gj);
            setFeatures(merged);
        };

        load();
    }, []);

    /* stats */
    const stats = useMemo(() => {
        const total = features.reduce((s, f) => s + (f.properties.panel_count || 1), 0);
        const done = features.reduce(
            (s, f) => s + (f.properties.status === "done" ? f.properties.panel_count : 0),
            0
        );
        return { total, done, remaining: total - done };
    }, [features]);

    /* --------------------------------------------------------------
       STYLES
-------------------------------------------------------------- */
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
                fillColor: "transparent", // Transparent yap ki hatch pattern görünsün
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

        // Hatch pattern'i SVG path elementine uygula (setStyle sonrası)
        if (status === "done") {
            // Path elementinin güncellenmesini bekle ve pattern'i uygula
            const applyHatch = () => {
                if (layer._path) {
                    // Pattern'in hazır olduğundan emin ol
                    const svg = layer._path.ownerSVGElement;
                    if (svg) {
                        const defs = svg.querySelector("defs");
                        const pattern = defs?.querySelector("#hatchGreen");
                        if (!pattern) {
                            // Pattern henüz hazır değil, tekrar dene
                            requestAnimationFrame(applyHatch);
                            return;
                        }
                    }
                    
                    // SVG path elementine direkt hatch pattern uygula
                    layer._path.setAttribute("fill", "url(#hatchGreen)");
                    layer._path.setAttribute("fill-opacity", "0.8");
                    // CSS style'ı important ile set et ki Leaflet override edemesin
                    layer._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                    layer._path.style.setProperty("fill-opacity", "0.8", "important");
                    
                    // MutationObserver ile sürekli izle ve pattern'i koru
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
            // Birkaç frame bekle ki setStyle tamamlanmış olsun
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(applyHatch);
                });
            });
        } else {
            // Pattern'i kaldır ve observer'ı temizle
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
        // Hatch pattern uygulama fonksiyonu
        const applyHatchPattern = () => {
            if (layer._path && feature.properties.status === "done") {
                // Pattern'in hazır olduğundan emin ol
                const svg = layer._path.ownerSVGElement;
                if (svg) {
                    const defs = svg.querySelector("defs");
                    const pattern = defs?.querySelector("#hatchGreen");
                    if (!pattern) {
                        // Pattern henüz hazır değil, tekrar dene
                        requestAnimationFrame(applyHatchPattern);
                        return;
                    }
                }
                
                // SVG path elementine direkt hatch pattern uygula
                layer._path.setAttribute("fill", "url(#hatchGreen)");
                layer._path.setAttribute("fill-opacity", "0.8");
                // CSS style'ı important ile set et ki Leaflet override edemesin
                layer._path.style.setProperty("fill", "url(#hatchGreen)", "important");
                layer._path.style.setProperty("fill-opacity", "0.8", "important");
            }
        };

        // Layer eklendiğinde hatch pattern uygula
        layer.on("add", () => {
            if (feature.properties.status === "done") {
                requestAnimationFrame(() => {
                    requestAnimationFrame(applyHatchPattern);
                });
            }
        });

        // Path elementini izle ve pattern'i sürekli uygula (Leaflet override ederse)
        if (feature.properties.status === "done") {
            const observer = new MutationObserver(() => {
                if (layer._path && feature.properties.status === "done") {
                    const currentFill = layer._path.getAttribute("fill") || layer._path.style.fill;
                    if (currentFill !== "url(#hatchGreen)") {
                        applyHatchPattern();
                    }
                }
            });

            // Path elementi oluştuğunda observer'ı başlat
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

        // Eğer layer zaten ekliyse ve done ise, direkt uygula
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
                // Done olan masalarda hatch pattern'i geri yükle
                this.setStyle(styleFn(feature));
                if (this._path) {
                    // Pattern'in hazır olduğundan emin ol
                    const svg = this._path.ownerSVGElement;
                    if (svg) {
                        const defs = svg.querySelector("defs");
                        const pattern = defs?.querySelector("#hatchGreen");
                        if (pattern) {
                            // Hatch pattern'i geri yükle
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

        // Context menu'yu engelle (sağ tık menüsü)
        layer.on("contextmenu", function (e) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        });

        // Sol tık → masa DONE
        layer.on("click", function (e) {
            if (e.originalEvent.button !== 0) return;
            if (feature.properties.status === "done") return;

            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent.stopImmediatePropagation();

            // Direkt olarak DONE yap
            setStatusByLayer(layer, "done");
        });

        // Sağ tık → masa TODO (unselect)
        layer.on("mousedown", function (e) {
            if (e.originalEvent.button !== 2) return;
            
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent.stopImmediatePropagation();

            // Direkt olarak TODO yap
            setStatusByLayer(layer, "todo");
        });

        layersRef.current.push({ id: feature.properties.panel_id, layer });
    };

    /* EXPORT */
    const exportCSV = () => {
        const rows = [
            ["panel_id", "status", "panel_count"],
            ...features.map(f => [
                f.properties.panel_id,
                f.properties.status,
                f.properties.panel_count || 1
            ])
        ];
        const csv = rows.map(r => r.join(",")).join("\n");

        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "panel-status.csv";
        a.click();

        URL.revokeObjectURL(url);
    };

    const resetAll = () => {
        setFeatures(prev =>
            prev.map(f => ({
                ...f,
                properties: { ...f.properties, status: "todo" }
            }))
        );
        setGeoKey(k => k + 1);
        layersRef.current = [];
    };

    const liveGeo = useMemo(
        () => base && { type: "FeatureCollection", features },
        [base, features]
    );

    return (
        <div className="app">
            <div className="topbar">
                <div className="stat">Total: <b>{stats.total}</b></div>
                <div className="stat">Done: <b style={{ color: "#22c55e" }}>{stats.done}</b></div>
                <div className="stat">Remaining: <b style={{ color: "#f59e0b" }}>{stats.remaining}</b></div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="ui" onClick={exportCSV}>Export CSV</button>
                    <button className="ui" onClick={resetAll}>Reset All</button>
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
        </div>
    );
}
