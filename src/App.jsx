// Copy
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'

const LS_KEY = 'panel-mvp-v1' // localStorage anahtarı

// Haritayı veri sınırlarına bir kez uydurur
function FitToDataOnce({ geojson }) {
  const map = useMap()
  useEffect(() => {
    if (!geojson) return
    const gj = L.geoJSON(geojson)
    const b = gj.getBounds()
    if (b.isValid()) map.fitBounds(b.pad(0.15))
  }, [geojson, map])
  return null
}

export default function App(){
  const [base, setBase] = useState(null)        // orijinal GeoJSON
  const [features, setFeatures] = useState([])  // status birleşik
  const [painting, setPainting] = useState(false)
  const [paintMode, setPaintMode] = useState(null) // 'done' | 'todo'
  const paintRef = useRef({ painting:false, paintMode:null })

  // GeoJSON'u yükle (panels.geojson için esnek arama + JSON/HTML kontrolü)
  useEffect(() => {
    const load = async () => {
      const candidates = [
        'panels.geojson',        // relatif
        '/panels.geojson',       // kökten
        '/public/panels.geojson' // bazı ortamlarda gerekli olabiliyor
      ]
      let text = null, urlUsed = null

      for (const u of candidates) {
        try {
          const r = await fetch(u, { cache: 'no-store' })
          if (!r.ok) { console.warn('fetch not ok:', u, r.status); continue }
          const t = await r.text()
          // HTML döndüyse (SPA fallback), devam et
          if (t.trim().startsWith('<!DOCTYPE') || t.trim().startsWith('<html')) {
            console.warn('Got HTML, not JSON from', u)
            continue
          }
          text = t
          urlUsed = r.url
          break
        } catch (e) {
          console.warn('fetch error:', u, e)
        }
      }

      if (!text) {
        console.error('panels.geojson bulunamadı. public/panels.geojson konumunu doğrula.')
        return
      }

      let gj
      try {
        gj = JSON.parse(text)
      } catch (e) {
        console.error('JSON parse failed. First 200 chars:', text.slice(0,200))
        throw e
      }

      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
      const merged = (gj.features || []).map((f, i) => {
        const id = f.properties?.panel_id ?? `P${i+1}`
        const status = saved[id]?.status ?? f.properties?.status ?? 'todo'
        return { ...f, properties: { ...f.properties, panel_id:id, status } }
      })
      setBase(gj)
      setFeatures(merged)
      console.log('Loaded panels from:', urlUsed, 'count=', merged.length)
    }
    load()
  }, [])

  // Sayaçlar
  const stats = useMemo(() => {
    const total = features.length
    const done = features.filter(f => f.properties.status === 'done').length
    return { total, done, remaining: total - done }
  }, [features])

  // Kalıcı kayıt
  useEffect(() => {
    if (!features.length) return
    const obj = {}
    for (const f of features) obj[f.properties.panel_id] = { status: f.properties.status }
    localStorage.setItem(LS_KEY, JSON.stringify(obj))
  }, [features])

  // Stiller
  const styleFn = (feat) => {
    const s = feat.properties?.status
    const base = { weight:1, opacity:.9, fillOpacity:.55 }
    return s === 'done'
      ? { ...base, color:'#16a34a', fillColor:'#16a34a' } // green
      : { ...base, color:'#6b7280', fillColor:'#6b7280' } // gray
  }
  const hoverStyle = { weight:2.5, color:'#eab308', fillColor:'#eab308', fillOpacity:.35 }

  // Panel toggle helper
  const toggleByLayer = (layer, force=null) => {
    const id = layer.feature.properties.panel_id
    setFeatures(prev => prev.map(f => {
      if (f.properties.panel_id !== id) return f
      const cur = f.properties.status
      const next = force ?? (cur === 'done' ? 'todo' : 'done')
      return { ...f, properties:{ ...f.properties, status: next } }
    }))
  }

  // Her feature için eventler
  const onEach = (feature, layer) => {
    layer.on('mouseover', () => {
      layer.setStyle(hoverStyle)
      if (paintRef.current.painting) toggleByLayer(layer, paintRef.current.paintMode)
    })
    layer.on('mouseout', () => layer.setStyle(styleFn(layer.feature)))
    layer.on('mousedown', (e) => {
      const cur = layer.feature.properties.status
      const mode = cur === 'done' ? 'todo' : 'done' // ilk temas neyse hep o
      setPainting(true); setPaintMode(mode)
      paintRef.current = { painting:true, paintMode:mode }
      toggleByLayer(layer, mode)
      e.originalEvent.preventDefault(); e.originalEvent.stopPropagation()
    })
    layer.on('click', (e) => {
      // Alt+Click = tekli toggle (paint'ten bağımsız)
      if (e.originalEvent.altKey) toggleByLayer(layer, null)
    })
    layer.on('contextmenu', (e) => { // sağ tık = sil (todo)
      toggleByLayer(layer, 'todo'); e.originalEvent.preventDefault()
    })
  }

  // Global mouseup: boyamayı bitir
  useEffect(() => {
    const up = () => { setPainting(false); setPaintMode(null); paintRef.current = { painting:false, paintMode:null } }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Canlı GeoJSON
  const liveGeo = useMemo(() => base && ({ type:'FeatureCollection', features }), [base, features])

  // Aksiyonlar
  const resetAll = () => setFeatures(prev => prev.map(f => ({ ...f, properties:{ ...f.properties, status:'todo' } })))
  const exportCSV = () => {
    const lines = [['panel_id','status'], ...features.map(f => [f.properties.panel_id, f.properties.status])]
    const csv = lines.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'panel-status.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="stat">Total: <b>{stats.total}</b></div>
        <div className="stat">Done: <b style={{color:'#22c55e'}}>{stats.done}</b></div>
        <div className="stat">Remaining: <b style={{color:'#f59e0b'}}>{stats.remaining}</b></div>
        <div className="stat">Mode: <b>{painting ? (paintMode || '…') : 'idle'}</b></div>
        <div className="actions">
          <button className="ui" onClick={exportCSV}>Export CSV</button>
          <button className="ui" onClick={resetAll}>Reset All</button>
        </div>
      </div>

      <div style={{position:'relative'}}>
        <MapContainer
          center={[52.5,-1.5]}
          zoom={17}
          minZoom={2}
          maxZoom={22}
          style={{height:'calc(100vh - 54px)', width:'100%'}}
          dragging={!painting} // boyarken pan kapalı
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {liveGeo && (
            <>
              <FitToDataOnce geojson={liveGeo}/>
              <GeoJSON data={liveGeo} style={styleFn} onEachFeature={onEach}/>
            </>
          )}
        </MapContainer>

        <div className="legend">
          <div className="row"><span className="dot" style={{background:'#6b7280'}}></span> todo</div>
          <div className="row"><span className="dot" style={{background:'#16a34a'}}></span> done</div>
          <div className="row"><span className="dot" style={{background:'#eab308'}}></span> hover / paint</div>
        </div>

        <div className="footer">
          LMB drag = paint · Alt+Click = toggle · Right-click = set todo · MMB = pan
        </div>
      </div>
    </div>
  )
}
