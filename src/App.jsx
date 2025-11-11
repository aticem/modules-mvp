// Copy
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/turf";

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
      rectRef.current.style.border = `2px solid ${color}`;
      rectRef.current.style.background =
        color === "#eab308" ? "rgba(234,179,8,0.25)" : "rgba(239,68,68,0.25)";
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
      const color = btn === 0 ? "#eab308" : "#ef4444";
      container.style.cursor = "crosshair";

      const pt = map.mouseEventToContainerPoint(e.originalEvent);
      startRef.current = pt;
      isDrawing.current = true;
      createBox(pt, pt, color);
    };

    const onMouseMove = (e) => {
      if (!isDrawing.current) return;
      const p2 = map.mouseEventToContainerPoint(e.originalEvent);
      const color = modeRef.current === "done" ? "#eab308" : "#ef4444";
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

    // 🔒 Sağ tık menüsünü tamamen kapat
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

export default function App() {
  const [base, setBase] = useState(null);
  const [features, setFeatures] = useState([]);
  const [geoKey, setGeoKey] = useState(0);
  const layersRef = useRef([]);

  useEffect(() => {
    const load = async () => {
      const candidates = [
        "panels.geojson",
        "/panels.geojson",
        "/public/panels.geojson",
      ];
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
      const merged = (gj.features || []).map((f, i) => {
        const id = f.properties?.panel_id ?? `P${i + 1}`;
        return {
          ...f,
          properties: { ...f.properties, panel_id: id, status: "todo" },
        };
      });
      setBase(gj);
      setFeatures(merged);
    };
    load();
  }, []);

  const stats = useMemo(() => {
    const total = features.length;
    const done = features.filter((f) => f.properties.status === "done").length;
    return { total, done, remaining: total - done };
  }, [features]);

  const styleFn = (feat) => {
    const base = { weight: 1, opacity: 0.9, fillOpacity: 0.55 };
    return feat.properties?.status === "done"
      ? { ...base, color: "#16a34a", fillColor: "#16a34a" }
      : { ...base, color: "#6b7280", fillColor: "#6b7280" };
  };
  const hoverStyle = {
    weight: 2.5,
    color: "#eab308",
    fillColor: "#eab308",
    fillOpacity: 0.35,
  };

  const setStatusByLayer = (layer, status) => {
    const id = layer.feature.properties.panel_id;
    layer.feature.properties.status = status;
    layer.setStyle(styleFn(layer.feature));
    setFeatures((prev) =>
      prev.map((f) =>
        f.properties.panel_id === id
          ? { ...f, properties: { ...f.properties, status } }
          : f
      )
    );
  };

  const onEach = (_feature, layer) => {
    layer.on("mouseover", () => layer.setStyle(hoverStyle));
    layer.on("mouseout", () => layer.setStyle(styleFn(layer.feature)));
    layersRef.current.push({ id: layer.feature.properties.panel_id, layer });
  };

  const liveGeo = useMemo(
    () => base && { type: "FeatureCollection", features },
    [base, features]
  );

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
      ["panel_id", "status"],
      ...features.map((f) => [f.properties.panel_id, f.properties.status]),
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

  return (
    <div className="app">
      <div
        className="topbar"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "10px 14px",
          background: "rgba(17,24,39,.85)",
          borderBottom: "1px solid rgba(148,163,184,.2)",
        }}
      >
        <div className="stat">Total: <b>{stats.total}</b></div>
        <div className="stat">Done: <b style={{ color: "#22c55e" }}>{stats.done}</b></div>
        <div className="stat">Remaining: <b style={{ color: "#f59e0b" }}>{stats.remaining}</b></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={exportCSV}>Export CSV</button>
          <button onClick={resetAll}>Reset All</button>
        </div>
      </div>

      <MapContainer
        center={[52.5, -1.5]}
        zoom={17}
        minZoom={2}
        maxZoom={22}
        style={{ height: "calc(100vh - 54px)", width: "100%" }}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        boxZoom={false}
        zoomControl={true}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {liveGeo && (
          <>
            <FitToDataOnce geojson={liveGeo} />
            <GeoJSON key={geoKey} data={liveGeo} style={styleFn} onEachFeature={onEach} />
            <SelectionTools layersRef={layersRef} setStatusByLayer={setStatusByLayer} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
