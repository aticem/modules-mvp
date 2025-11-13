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
        const svg = map.getPanes().overlayPane.querySelector("svg");
        if (!svg) return;

        let defs = svg.querySelector("defs");
        if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            svg.prepend(defs);
        }

        const hatch = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
        hatch.setAttribute("id", "hatchGreen");
        hatch.setAttribute("patternUnits", "userSpaceOnUse");
        hatch.setAttribute("width", "8");
        hatch.setAttribute("height", "8");

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", "M0 8 L8 0");
        line.setAttribute("stroke", "#16a34a");
        line.setAttribute("stroke-width", "1.4");
        line.setAttribute("opacity", "0.45");

        hatch.appendChild(line);
        defs.appendChild(hatch);
    }, []);
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

    useEffect(() => {
        const container = map.getContainer();

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

            e.originalEvent.preventDefault();

            const p = map.mouseEventToContainerPoint(e.originalEvent);
            startRef.current = p;
            isDrawing.current = true;

            const color = btn === 0 ? "#22c55e" : "#ef4444";
            createBox(p, p, color);

            map.dragging.disable();
        };

        const onMouseMove = (e) => {
            if (!isDrawing.current) return;
            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            createBox(startRef.current, p2, "#22c55e");
        };

        const onMouseUp = (e) => {
            if (!isDrawing.current) return;
            isDrawing.current = false;

            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            const status = e.originalEvent.button === 0 ? "done" : "todo";

            const p1 = startRef.current;
            const left = Math.min(p1.x, p2.x);
            const right = Math.max(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y);
            const bottom = Math.max(p1.y, p2.y);

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

            removeBox();
            map.dragging.enable();
        };

        const onClick = (e) => {
            const btn = e.originalEvent.button;
            if (btn !== 0 && btn !== 2) return;

            const latlng = e.latlng;
            const clickP = point([latlng.lng, latlng.lat]);
            const status = btn === 0 ? "done" : "todo";

            for (const entry of layersRef.current) {
                if (booleanPointInPolygon(clickP, entry.layer.feature)) {
                    setStatusByLayer(entry.layer, status);
                    break;
                }
            }
        };

        map.on("mousedown", onMouseDown);
        map.on("mousemove", onMouseMove);
        map.on("mouseup", onMouseUp);
        map.on("click", onClick);

        return () => {
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
                fillOpacity: 0.55,
                fillPattern: "url(#hatchGreen)"
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
        layer.on("mouseover", function () {
            if (feature.properties.status === "done") return;

            this.setStyle(hoverStyle);
            if (this._path) this._path.classList.add("panel-hover");
        });

        layer.on("mouseout", function () {
            if (feature.properties.status === "done") return;

            this.setStyle(styleFn(feature));
            if (this._path) this._path.classList.remove("panel-hover");
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
