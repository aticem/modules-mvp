import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/turf";
import "./index.css";

// ... (FitToDataOnce ve SelectionTools bileşenleri DEĞİŞMEDEN kalır)
function FitToDataOnce({ geojson }) {
    const map = useMap();
    const fittedRef = useRef(false);
    useEffect(() => {
        if (!geojson || fittedRef.current) return;
        const gj = L.geoJSON(geojson);
        const b = gj.getBounds();
        if (b.isValid()) {
            map.fitBounds(b.pad(0.15));
            fittedRef.current = true;
        }
    }, [geojson, map]);
    return null;
}

function SelectionTools({ layersRef, setStatusByLayer }) {
    const map = useMap();
    const startRef = useRef(null);
    const rectRef = useRef(null);
    const isDrawing = useRef(false);
    const modeRef = useRef("done");

    useEffect(() => {
        const container = map.getContainer();
        container.style.cursor = "default";

        const createBox = (p1, p2, color) => {
            const left = Math.min(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y);
            const width = Math.abs(p2.x - p1.x);
            const height = Math.abs(p2.y - p1.y);
            if (!rectRef.current) {
                const div = document.createElement("div");
                div.style.position = "absolute";
                div.style.pointerEvents = "none";
                div.style.zIndex = 1000;
                container.appendChild(div);
                rectRef.current = div;
            }
            rectRef.current.style.left = `${left}px`;
            rectRef.current.style.top = `${top}px`;
            rectRef.current.style.width = `${width}px`;
            rectRef.current.style.height = `${height}px`;
            rectRef.current.style.border = `1px dashed ${color}`;
            rectRef.current.style.background = "transparent";
        };

        const removeBox = () => {
            if (rectRef.current) {
                rectRef.current.remove();
                rectRef.current = null;
            }
        };

        const selectInside = (p1, p2, status) => {
            const left = Math.min(p1.x, p2.x);
            const right = Math.max(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y);
            const bottom = Math.max(p1.y, p2.y);
            for (const entry of layersRef.current) {
                const b = entry.layer.getBounds();
                if (!b.isValid()) continue;
                const nw = map.latLngToContainerPoint(b.getNorthWest());
                const se = map.latLngToContainerPoint(b.getSouthEast());
                const minX = Math.min(nw.x, se.x),
                    maxX = Math.max(nw.x, se.x);
                const minY = Math.min(nw.y, se.y),
                    maxY = Math.max(nw.y, se.y);
                const intersects =
                    maxX >= left && minX <= right && maxY >= top && minY <= bottom;
                if (intersects) setStatusByLayer(entry.layer, status);
            }
        };

        const onMouseDown = (e) => {
            const btn = e.originalEvent.button;
            if (btn === 1) {
                container.style.cursor = "grabbing";
                return;
            }
            if (btn !== 0 && btn !== 2) return;

            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();

            map.dragging.disable();

            modeRef.current = btn === 0 ? "done" : "todo";
            const color = btn === 0 ? "#22c55e" : "#ef4444";
            container.style.cursor = "crosshair";

            const pt = map.mouseEventToContainerPoint(e.originalEvent);
            startRef.current = pt;
            isDrawing.current = true;
            createBox(pt, pt, color);
        };

        const onMouseMove = (e) => {
            if (!isDrawing.current) return;
            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            const color = modeRef.current === "done" ? "#22c55e" : "#ef4444";
            createBox(startRef.current, p2, color);
        };

        const onMouseUp = (e) => {
            if (!isDrawing.current) return;
            const p2 = map.mouseEventToContainerPoint(e.originalEvent);
            selectInside(startRef.current, p2, modeRef.current);
            removeBox();
            isDrawing.current = false;
            map.dragging.enable();
            container.style.cursor = "default";
        };

        const onClick = (e) => {
            const btn = e.originalEvent.button;
            if (btn !== 0 && btn !== 2) return;
            const latlng = e.latlng;
            const clickPoint = point([latlng.lng, latlng.lat]);
            const targetStatus = btn === 0 ? "done" : "todo";

            for (const entry of layersRef.current) {
                const feature = entry.layer.feature;
                if (!feature.geometry) continue;
                try {
                    if (booleanPointInPolygon(clickPoint, feature)) {
                        setStatusByLayer(entry.layer, targetStatus);
                        break;
                    }
                } catch {}
            }
        };

        const blockContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        container.addEventListener("contextmenu", blockContextMenu);

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
            removeBox();
            container.style.cursor = "default";
        };
    }, [map, layersRef, setStatusByLayer]);

    return null;
}

// -----------------------------------------------------------
// -------------------- ANA BİLEŞEN (APP) --------------------
// -----------------------------------------------------------

export default function App() {
    const [base, setBase] = useState(null);
    const [features, setFeatures] = useState([]);
    const [geoKey, setGeoKey] = useState(0);
    const layersRef = useRef([]);

    // 💡 GeoJSON katmanı için zorlanmış SVG Renderer'ı
    // SVG Renderer, dolgu alanının etkileşimini (hover) Canvas'tan daha iyi destekler.
    const svgRenderer = useMemo(() => L.svg(), []);

    useEffect(() => {
        const load = async () => {
            const candidates = ["panels.geojson", "/panels.geojson", "/public/panels.geojson"];
            let text = null;
            for (const u of candidates) {
                try {
                    const r = await fetch(u, { cache: "no-store" });
                    if (!r.ok) continue;
                    const t = await r.text();
                    if (t.trim().startsWith("<")) continue;
                    text = t;
                    break;
                } catch {}
            }
            if (!text) {
                console.error("public/panels.geojson bulunamadı");
                return;
            }
            const gj = JSON.parse(text);
            const merged = (gj.features || []).map((f, i) => ({
                ...f,
                properties: {
                    ...f.properties,
                    panel_id: f.properties?.panel_id ?? `P${i + 1}`,
                    status: f.properties?.status ?? "todo",
                },
            }));
            setBase(gj);
            setFeatures(merged);
        };
        load();
    }, []);

    const stats = useMemo(() => {
        const total = features.reduce(
            (sum, f) => sum + (f.properties.panel_count || 1),
            0
        );
        const done = features.reduce(
            (sum, f) =>
                sum +
                (f.properties.status === "done"
                    ? (f.properties.panel_count || 1)
                    : 0),
            0
        );
        return { total, done, remaining: total - done };
    }, [features]);

    // 1. STİL FONKSİYONU: Hover ve Hatch/Tarama Ayarları
    const styleFn = (feat) => {
        const base = {
            weight: 1,
            lineJoin: "miter",
            lineCap: "square",
            smoothFactor: 0,
            opacity: 1,
            interactive: true,
        };

        if (feat.properties.status === "done") {
            // 🟢 DONE STİLİ: Tüm dikdörtgeni kaplayan daha dolgun yeşil (hatch)
            return {
                ...base,
                color: "#16a34a", // Koyu yeşil çizgi
                fillColor: "#22c55e", // Parlak yeşil dolgu
                fillOpacity: 0.7, // Hatch benzeri doluluk
            };
        }

        // ⚪ TODO STİLİ: Yüzey etkileşimini garanti etmek için dolgu
        return {
            ...base,
            color: "#e5e7eb",
            // SVG'de bu dolgu alanı hover'ı tetikler ancak görünmezdir.
            fillColor: "rgba(255,255,255,0.01)",
            fillOpacity: 0.01,
        };
    };

    const hoverStyle = {
        weight: 2,
        color: "#60a5fa",
        fillColor: "rgba(147,197,253,0.35)",
        fillOpacity: 0.55,
    };

    // 2. STATUS GÜNCELLEME VE STİL UYGULAMA
    const setStatusByLayer = (layer, status) => {
        layer.feature.properties.status = status;
        layer.setStyle(styleFn(layer.feature));

        // Sayaçları güncellemek için features state'ini güncelleyelim
        setFeatures(currentFeatures =>
            currentFeatures.map(f =>
                f.properties.panel_id === layer.feature.properties.panel_id
                    ? { ...f, properties: { ...f.properties, status } }
                    : f
            )
        );
    };

    // 3. HER ÖZELLİK İÇİN (onEachFeature) Olay Yönetimi
    const onEach = (feature, layer) => {
        // Mouse olayları artık dolgu alanının tamamı üzerinde çalışacaktır (Zorlanmış SVG sayesinde).
        layer.on("mouseover", function () {
            this.setStyle(hoverStyle);
            this.bringToFront();
        });
        layer.on("mouseout", function () {
            this.setStyle(styleFn(feature));
        });
        layersRef.current.push({ id: feature.properties.panel_id, layer });
    };

    const resetAll = () => {
        setFeatures((prev) =>
            prev.map((f) => ({
                ...f,
                properties: { ...f.properties, status: "todo" },
            }))
        );
        setGeoKey((k) => k + 1);
        layersRef.current = [];
    };

    const exportCSV = () => {
        const lines = [
            ["panel_id", "status", "panel_count"],
            ...features.map((f) => [
                f.properties.panel_id,
                f.properties.status,
                f.properties.panel_count || 1,
            ]),
        ];
        const csv = lines
            .map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "panel-status.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    const liveGeo = useMemo(
        () => base && { type: "FeatureCollection", features },
        [base, features]
    );

    return (
        <div className="app">
            {/* 🔹 Üst Bar (Sayaçlar ve Butonlar) */}
            <div
                className="topbar"
                style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "rgba(17,24,39,0.85)",
                    borderBottom: "1px solid rgba(148,163,184,0.2)",
                    color: "#e5e7eb",
                }}
            >
                <div className="stat">
                    Total: <b>{stats.total}</b>
                </div>
                <div className="stat">
                    Done: <b style={{ color: "#22c55e" }}>{stats.done}</b>
                </div>
                <div className="stat">
                    Remaining: <b style={{ color: "#f59e0b" }}>{stats.remaining}</b>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button
                        onClick={exportCSV}
                        style={{
                            padding: '4px 8px',
                            backgroundColor: '#2563eb',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Export CSV
                    </button>
                    <button
                        onClick={resetAll}
                        style={{
                            padding: '4px 8px',
                            backgroundColor: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Reset All
                    </button>
                </div>
            </div>

            {/* ---------------- HARİTA ---------------- */}
            <MapContainer
                center={[52.5, -1.5]}
                zoom={17}
                minZoom={2}
                maxZoom={25}
                zoomControl={false}
                // preferCanvas artık burada DEĞİL, renderer GeoJSON'da zorlanıyor.
                style={{
                    height: "calc(100vh - 54px)",
                    width: "100%",
                    backgroundColor: "#1e293b",
                }}
                doubleClickZoom={false}
                touchZoom={false}
                keyboard={false}
                boxZoom={false}
            >
                {liveGeo && (
                    <>
                        <FitToDataOnce geojson={liveGeo} />
                        <GeoJSON
                            key={geoKey}
                            data={liveGeo}
                            style={styleFn}
                            onEachFeature={onEach}
                            // 🚨 KRİTİK DEĞİŞİKLİK: SVG Renderer'ı zorla!
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