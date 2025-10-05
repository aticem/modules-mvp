// Copy
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'

/** Sadece ilk kez fitBounds yap */
function FitToDataOnce({ geojson }) {
  const map = useMap()
  const fittedRef = useRef(false)
  useEffect(() => {
    if (!geojson || fittedRef.current) return
    const gj = L.geoJSON(geojson)
    const b = gj.getBounds()
    if (b.isValid()) {
      map.fitBounds(b.pad(0.15))
      fittedRef.current = true
    }
  }, [geojson, map])
  return null
}

/** Orta tuş: basılı pan, teker zoom */
function MiddlePanAndZoom() {
  const map = useMap()
  useEffect(() => {
    const c = map.getContainer()
    map.dragging.disable()
    map.doubleClickZoom.disable()
    map.scrollWheelZoom.enable() // sadece tekerleğe izin ver
    c.style.cursor = 'grab'

    const onMouseDownCapture = (ev) => {
      if (ev.button === 1) { // middle
        ev.preventDefault()
        map.dragging.enable()
        c.style.cursor = 'grabbing'
      } else {
        map.dragging.disable()
        c.style.cursor = 'default'
      }
    }
    const onMouseUp = () => {
      map.dragging.disable()
      c.style.cursor = 'grab'
    }
    const onContextMenu = (ev) => ev.preventDefault()

    // dblclick zoomu da kapalı tut
    const stopEvt = (e) => { e.preventDefault(); e.stopPropagation() }
    map.on('dblclick', stopEvt)

    c.addEventListener('mousedown', onMouseDownCapture, { capture: true })
    c.addEventListener('mouseup', onMouseUp)
    c.addEventListener('contextmenu', onContextMenu)

    return () => {
      map.off('dblclick', stopEvt)
      c.removeEventListener('mousedown', onMouseDownCapture, { capture: true })
      c.removeEventListener('mouseup', onMouseUp)
      c.removeEventListener('contextmenu', onContextMenu)
    }
  }, [map])
  return null
}

/** Yakınlık bazlı işaretleme/silme (sol=done, sağ=todo) */
function ProximityInteractions({ layersRef, setStatusByLayer }) {
  const map = useMap()
  const isLeftDownRef  = useRef(false)
  const isRightDownRef = useRef(false)
  const movedLeftRef   = useRef(false)
  const movedRightRef  = useRef(false)
  const downPointLeft  = useRef({x:0,y:0})
  const downPointRight = useRef({x:0,y:0})
  const MOVE_THRESHOLD = 3
  const TOLERANCE_PX   = 10

  const nearestLayerWithin = (containerPt, tolPx) => {
    let best = null, bestD = Infinity
    for (const entry of layersRef.current) {
      const b = entry.layer.getBounds()
      if (!b.isValid()) continue
      const nw = map.latLngToContainerPoint(b.getNorthWest())
      const se = map.latLngToContainerPoint(b.getSouthEast())
      const minX = Math.min(nw.x, se.x), maxX = Math.max(nw.x, se.x)
      const minY = Math.min(nw.y, se.y), maxY = Math.max(nw.y, se.y)
      const dx = (containerPt.x < minX) ? (minX - containerPt.x) : (containerPt.x > maxX ? (containerPt.x - maxX) : 0)
      const dy = (containerPt.y < minY) ? (minY - containerPt.y) : (containerPt.y > maxY ? (containerPt.y - maxY) : 0)
      const d = Math.hypot(dx, dy)
      if (d <= tolPx && d < bestD) { bestD = d; best = entry.layer }
    }
    return best
  }

  const paintAtEvent = (e, mode) => {
    const pt = map.mouseEventToContainerPoint(e.originalEvent)
    const lyr = nearestLayerWithin(pt, TOLERANCE_PX)
    if (lyr) setStatusByLayer(lyr, mode)
  }

  useEffect(() => {
    const onMouseDown = (e) => {
      const btn = e.originalEvent?.button
      if (btn === 0) {
        isLeftDownRef.current = true; movedLeftRef.current = false
        downPointLeft.current = { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
        paintAtEvent(e, 'done')
        L.DomEvent.stop(e)
      } else if (btn === 2) {
        isRightDownRef.current = true; movedRightRef.current = false
        downPointRight.current = { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
        paintAtEvent(e, 'todo')
        e.originalEvent.preventDefault(); e.originalEvent.stopPropagation()
      }
    }

    const onMouseMove = (e) => {
      const { clientX, clientY, buttons } = e.originalEvent
      if (isLeftDownRef.current || (buttons & 1)) {
        const dx = Math.abs(clientX - downPointLeft.current.x)
        const dy = Math.abs(clientY - downPointLeft.current.y)
        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) movedLeftRef.current = true
        paintAtEvent(e, 'done')
      }
      if (isRightDownRef.current || (buttons & 2)) {
        const dx = Math.abs(clientX - downPointRight.current.x)
        const dy = Math.abs(clientY - downPointRight.current.y)
        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) movedRightRef.current = true
        paintAtEvent(e, 'todo')
      }
    }

    const onMouseUp = () => {
      isLeftDownRef.current = false
      isRightDownRef.current = false
      movedLeftRef.current = false
      movedRightRef.current = false
    }

    const onClick = (e) => {
      if (e.originalEvent?.button !== 0) return
      if (movedLeftRef.current) return
      const pt = map.mouseEventToContainerPoint(e.originalEvent)
      const lyr = nearestLayerWithin(pt, TOLERANCE_PX)
      if (lyr) {
        const cur = lyr.feature.properties.status
        const next = (cur === 'done') ? 'todo' : 'done'
        setStatusByLayer(lyr, next)
        L.DomEvent.stop(e)
      }
    }

    const onContextMenu = (e) => {
      const pt = map.mouseEventToContainerPoint(e.originalEvent)
      const lyr = nearestLayerWithin(pt, TOLERANCE_PX)
      if (lyr) {
        setStatusByLayer(lyr, 'todo')
        e.originalEvent.preventDefault()
        e.originalEvent.stopPropagation()
      }
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('click', onClick)
    map.on('contextmenu', onContextMenu)

    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('click', onClick)
      map.off('contextmenu', onContextMenu)
    }
  }, [map, setStatusByLayer, layersRef])

  return null
}

export default function App(){
  const [base, setBase] = useState(null)
  const [features, setFeatures] = useState([])
  const [geoKey, setGeoKey] = useState(0)
  const layersRef = useRef([])

  useEffect(() => {
    const load = async () => {
      const candidates = ['panels.geojson','/panels.geojson','/public/panels.geojson']
      let text = null
      for (const u of candidates) {
        try {
          const r = await fetch(u, { cache:'no-store' })
          if (!r.ok) continue
          const t = await r.text()
          if (t.trim().startsWith('<')) continue
          text = t; break
        } catch {}
      }
      if (!text) { console.error('public/panels.geojson bulunamadı'); return }
      const gj = JSON.parse(text)
      const merged = (gj.features||[]).map((f,i)=>{
        const id = f.properties?.panel_id ?? `P${i+1}`
        return { ...f, properties:{ ...f.properties, panel_id:id, status:'todo' } }
      })
      setBase(gj); setFeatures(merged)
    }
    load()
  }, [])

  const stats = useMemo(()=>{
    const total = features.length
    const done = features.filter(f=>f.properties.status==='done').length
    return { total, done, remaining: total - done }
  },[features])

  const styleFn = (feat) => {
    const base = { weight:1, opacity:.9, fillOpacity:.55 }
    return feat.properties?.status==='done'
      ? { ...base, color:'#16a34a', fillColor:'#16a34a' }
      : { ...base, color:'#6b7280', fillColor:'#6b7280' }
  }
  const hoverStyle = { weight:2.5, color:'#eab308', fillColor:'#eab308', fillOpacity:.35 }

  const setStatusByLayer = (layer, status) => {
    const id = layer.feature.properties.panel_id
    layer.feature.properties.status = status
    layer.setStyle(styleFn(layer.feature))
    setFeatures(prev => prev.map(f => {
      if (f.properties.panel_id !== id) return f
      return { ...f, properties:{ ...f.properties, status } }
    }))
  }

  const onEach = (_feature, layer)=>{
    layer.on('mouseover', ()=> layer.setStyle(hoverStyle))
    layer.on('mouseout',  ()=> layer.setStyle(styleFn(layer.feature)))
    layersRef.current.push({ id: layer.feature.properties.panel_id, layer })
  }

  const liveGeo = useMemo(()=> base && ({type:'FeatureCollection', features}), [base, features])

  const resetAll = ()=>{
    setFeatures(prev=>prev.map(f=>({...f, properties:{...f.properties, status:'todo'}})))
    setGeoKey(k => k + 1)
    layersRef.current = []
  }

  const exportCSV = ()=>{
    const lines = [['panel_id','status'], ...features.map(f=>[f.properties.panel_id, f.properties.status])]
    const csv = lines.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='panel-status.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <div className="topbar" style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',background:'rgba(17,24,39,.85)',borderBottom:'1px solid rgba(148,163,184,.2)'}}>
        <div className="stat" style={{padding:'6px 10px',border:'1px solid rgba(148,163,184,.25)',borderRadius:10,background:'rgba(2,6,23,.4)',fontSize:14}}>Total: <b>{stats.total}</b></div>
        <div className="stat" style={{padding:'6px 10px',border:'1px solid rgba(148,163,184,.25)',borderRadius:10,background:'rgba(2,6,23,.4)',fontSize:14}}>Done: <b style={{color:'#22c55e'}}>{stats.done}</b></div>
        <div className="stat" style={{padding:'6px 10px',border:'1px solid rgba(148,163,184,.25)',borderRadius:10,background:'rgba(2,6,23,.4)',fontSize:14}}>Remaining: <b style={{color:'#f59e0b'}}>{stats.remaining}</b></div>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={exportCSV}>Export CSV</button>
          <button onClick={resetAll}>Reset All</button>
        </div>
      </div>

      <MapContainer
        center={[52.5,-1.5]}
        zoom={17}
        minZoom={2}
        maxZoom={22}
        style={{height:'calc(100vh - 54px)', width:'100%'}}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        boxZoom={false}
        zoomControl={true}
      >
        <MiddlePanAndZoom/>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {liveGeo && (
          <>
            {/* 🔒 Sadece ilk sefer fit olur; sonra zoom/pan asla resetlenmez */}
            <FitToDataOnce geojson={liveGeo}/>
            <GeoJSON key={geoKey} data={liveGeo} style={styleFn} onEachFeature={onEach}/>
            <ProximityInteractions layersRef={layersRef} setStatusByLayer={setStatusByLayer}/>
          </>
        )}
      </MapContainer>
    </div>
  )
}
