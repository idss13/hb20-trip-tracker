'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { savePending, getAllPending, deletePending, type PendingRecord } from '@/lib/idb'

interface Abastecimento {
  id: string
  created_at: string
  km_atual: number
  valor_pago: number
  litros: number | null
  preco_por_litro: number | null
  cidade: string | null
  posto_nome: string | null
}

interface AbastecimentoEnriquecido extends Abastecimento {
  km_rodados: number | null
  consumo_trecho: number | null
}

interface Metricas {
  totalGasto: number
  totalLitros: number
  totalKmViagem: number
  mediaConsumo: number | null
  consumoUltimoTrecho: number | null
  custoPorKm: number | null
  precoMedioLitro: number | null
}

function enriquecer(registros: Abastecimento[]): AbastecimentoEnriquecido[] {
  const sorted = [...registros].sort((a, b) => a.km_atual - b.km_atual)
  return sorted.map((r, i) => {
    if (i === 0) return { ...r, km_rodados: null, consumo_trecho: null }
    const prev = sorted[i - 1]
    const km_rodados = r.km_atual - prev.km_atual
    const consumo_trecho =
      r.litros && km_rodados > 0
        ? parseFloat((km_rodados / r.litros).toFixed(2))
        : null
    return { ...r, km_rodados, consumo_trecho }
  })
}

function calcularMetricas(enriquecidos: AbastecimentoEnriquecido[]): Metricas {
  const zero: Metricas = {
    totalGasto: 0, totalLitros: 0, totalKmViagem: 0,
    mediaConsumo: null, consumoUltimoTrecho: null,
    custoPorKm: null, precoMedioLitro: null,
  }
  if (!enriquecidos.length) return zero

  const totalGasto = enriquecidos.reduce((acc, r) => acc + r.valor_pago, 0)
  const totalLitros = enriquecidos.reduce((acc, r) => acc + (r.litros ?? 0), 0)
  const totalKmViagem =
    enriquecidos[enriquecidos.length - 1].km_atual - enriquecidos[0].km_atual

  const trechosCompletos = enriquecidos.filter(
    (r) => r.km_rodados != null && r.litros != null
  )

  let mediaConsumo: number | null = null
  if (trechosCompletos.length > 0) {
    const kmTotal = trechosCompletos.reduce((a, r) => a + r.km_rodados!, 0)
    const litTotal = trechosCompletos.reduce((a, r) => a + r.litros!, 0)
    if (litTotal > 0) mediaConsumo = parseFloat((kmTotal / litTotal).toFixed(2))
  }

  const consumoUltimoTrecho =
    trechosCompletos.length > 0
      ? trechosCompletos[trechosCompletos.length - 1].consumo_trecho
      : null

  const custoPorKm =
    totalKmViagem > 0 ? parseFloat((totalGasto / totalKmViagem).toFixed(3)) : null

  const precoMedioLitro =
    totalLitros > 0 ? parseFloat((totalGasto / totalLitros).toFixed(3)) : null

  return { totalGasto, totalLitros, totalKmViagem, mediaConsumo, consumoUltimoTrecho, custoPorKm, precoMedioLitro }
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function corConsumo(consumo: number, media: number | null): string {
  if (!media) return 'text-slate-400'
  if (consumo >= media * 1.05) return 'text-green-400'
  if (consumo >= media * 0.95) return 'text-yellow-400'
  return 'text-red-400'
}

interface EditState {
  km: string
  valor: string
  preco: string
}

function SkeletonCard() {
  return (
    <div className="bg-slate-800 rounded-2xl overflow-hidden animate-pulse">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-700 rounded w-2/3" />
          <div className="h-3 bg-slate-700 rounded w-1/3" />
        </div>
        <div className="space-y-2 text-right">
          <div className="h-6 bg-slate-700 rounded w-20" />
          <div className="h-3 bg-slate-700 rounded w-16" />
        </div>
      </div>
      <div className="border-t border-slate-700 px-5 py-3">
        <div className="h-3 bg-slate-700 rounded w-1/2" />
      </div>
    </div>
  )
}

export default function TripTracker() {
  const [isOnline, setIsOnline] = useState(true)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'ok' | 'error'>('idle')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)

  const [km, setKm] = useState('')
  const [valor, setValor] = useState('')
  const [preco, setPreco] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [historico, setHistorico] = useState<Abastecimento[]>([])
  const [histLoading, setHistLoading] = useState(true)
  const [pendingRecords, setPendingRecords] = useState<PendingRecord[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>({ km: '', valor: '', preco: '' })

  const swRegistered = useRef(false)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && !swRegistered.current) {
      swRegistered.current = true
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('error'); return }
    setGpsStatus('capturing')
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setGpsStatus('ok') },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const loadHistorico = useCallback(async () => {
    try {
      const res = await fetch('/api/historico')
      if (res.ok) setHistorico(await res.json())
    } catch { /* offline — mantém dados anteriores */ }
    finally { setHistLoading(false) }
  }, [])

  const loadPending = useCallback(async () => {
    const all = await getAllPending()
    setPendingRecords(all)
    setPendingCount(all.length)
  }, [])

  useEffect(() => {
    setIsOnline(navigator.onLine)
    loadHistorico()
    loadPending()
  }, [loadHistorico, loadPending])

  const manualSync = useCallback(async () => {
    for (const record of await getAllPending()) {
      try {
        const res = await fetch('/api/abastecer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        })
        if (res.ok && record.id != null) await deletePending(record.id)
      } catch { break }
    }
  }, [])

  const triggerSync = useCallback(async () => {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready
        if ('sync' in reg) {
          await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } })
            .sync.register('sync-abastecimentos')
        } else { await manualSync() }
      } catch { await manualSync() }
    } else { await manualSync() }
    await loadHistorico()
    await loadPending()
  }, [manualSync, loadHistorico, loadPending])

  useEffect(() => {
    const on = () => { setIsOnline(true); triggerSync() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [triggerSync])

  const showFeedback = useCallback((type: 'success' | 'error', msg: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ type, msg })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000)
  }, [])

  const handleDelete = (id: string) => {
    const removed = historico.find((r) => r.id === id)
    setHistorico((prev) => prev.filter((r) => r.id !== id))
    setConfirmDelete(null)
    setMenuOpen(null)
    fetch(`/api/abastecer/${id}`, { method: 'DELETE' }).then((res) => {
      if (!res.ok) throw new Error('server')
    }).catch(() => {
      if (removed) setHistorico((prev) => [...prev, removed])
      showFeedback('error', 'Erro ao apagar. Tente novamente.')
    })
  }

  const startEdit = (r: AbastecimentoEnriquecido) => {
    setEditingId(r.id)
    setEditState({
      km: String(r.km_atual),
      valor: String(r.valor_pago),
      preco: r.preco_por_litro != null ? String(r.preco_por_litro) : '',
    })
    setMenuOpen(null)
  }

  const handleSaveEdit = async (id: string) => {
    const km_atual = parseInt(editState.km, 10)
    const valor_pago = parseFloat(editState.valor)
    const preco_por_litro = editState.preco ? parseFloat(editState.preco) : null
    const litros = preco_por_litro && preco_por_litro > 0
      ? parseFloat((valor_pago / preco_por_litro).toFixed(3))
      : null

    const original = historico.find((r) => r.id === id)
    setHistorico((prev) =>
      prev.map((r) => r.id === id ? { ...r, km_atual, valor_pago, preco_por_litro, litros } : r)
    )
    setEditingId(null)

    try {
      const res = await fetch(`/api/abastecer/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ km_atual, valor_pago, preco_por_litro }),
      })
      if (!res.ok) throw new Error('server')
    } catch {
      if (original) setHistorico((prev) => prev.map((r) => r.id === id ? original : r))
      showFeedback('error', 'Erro ao salvar edição.')
    }
  }

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!km || !valor) return
    setLoading(true)

    const payload: Omit<PendingRecord, 'id'> = {
      km_atual: parseInt(km, 10),
      valor_pago: parseFloat(valor),
      preco_por_litro: preco ? parseFloat(preco) : undefined,
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
      timestamp: new Date().toISOString(),
    }
    const reset = () => { setKm(''); setValor(''); setPreco('') }

    if (isOnline) {
      try {
        const res = await fetch('/api/abastecer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          showFeedback('success', 'Abastecimento registrado!')
          reset(); await loadHistorico()
        } else {
          await savePending(payload); await loadPending()
          showFeedback('error', 'Erro no servidor. Salvo localmente.'); reset()
        }
      } catch {
        await savePending(payload); await loadPending()
        showFeedback('success', 'Salvo localmente. Sincroniza quando o sinal voltar.'); reset()
      }
    } else {
      await savePending(payload); await loadPending()
      showFeedback('success', 'Salvo localmente. Sincroniza quando o sinal voltar.'); reset()
    }
    setLoading(false)
  }

  const enriquecidos = useMemo(() => enriquecer(historico), [historico])
  const metricas = useMemo(() => calcularMetricas(enriquecidos), [enriquecidos])
  const historicoDisplay = useMemo(
    () => [...enriquecidos].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [enriquecidos]
  )

  const inputCls =
    'w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-4 text-2xl font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors'

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans" onClick={() => setMenuOpen(null)}>
      <div className="max-w-md mx-auto px-4 pb-12">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-slate-900 pt-5 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-white leading-tight">HB20 Trip Tracker</h1>
            <span className={`text-xs px-3 py-1.5 rounded-full font-semibold tracking-wide ${
              isOnline
                ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25'
            }`}>
              {isOnline ? '● Online' : '● Offline'}
            </span>
          </div>
        </div>

        {/* ── GPS ── */}
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            gpsStatus === 'ok' ? 'bg-green-400' :
            gpsStatus === 'capturing' ? 'bg-yellow-400 animate-pulse' :
            gpsStatus === 'error' ? 'bg-red-400' : 'bg-slate-600'
          }`} />
          {gpsStatus === 'ok' && coords
            ? `GPS OK — ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
            : gpsStatus === 'capturing' ? 'Aguardando sinal GPS...'
            : gpsStatus === 'error' ? 'GPS indisponível' : 'GPS iniciando'}
        </div>

        {/* ── Banners ── */}
        {!isOnline && (
          <div className="mt-3 p-3 rounded-xl text-sm bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
            Sem internet — dados salvos localmente e sincronizados quando o sinal voltar.
          </div>
        )}
        {feedback && (
          <div className={`mt-3 p-3 rounded-xl text-sm font-medium border ${
            feedback.type === 'success'
              ? 'bg-green-500/10 text-green-300 border-green-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}
        {pendingCount > 0 && isOnline && (
          <div className="mt-3 p-3 rounded-xl text-sm bg-blue-500/10 text-blue-300 border border-blue-500/20 flex items-center justify-between">
            <span>{pendingCount} registro{pendingCount > 1 ? 's' : ''} pendente{pendingCount > 1 ? 's' : ''}</span>
            <button onClick={triggerSync} className="text-blue-400 underline underline-offset-2 font-medium">
              Sincronizar agora
            </button>
          </div>
        )}

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Quilometragem Atual (KM)</label>
            <input type="number" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)}
              placeholder="154230" required className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Valor Pago (R$)</label>
            <input type="number" inputMode="decimal" step="0.01" value={valor}
              onChange={(e) => setValor(e.target.value)} placeholder="80,00" required className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Preço por Litro (R$/L) <span className="text-slate-600 font-normal">opcional</span>
            </label>
            <input type="number" inputMode="decimal" step="0.001" value={preco}
              onChange={(e) => setPreco(e.target.value)} placeholder="3,890" className={inputCls} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-lg py-5 rounded-2xl transition-colors mt-1 shadow-lg shadow-blue-950/60 select-none">
            {loading ? 'Registrando...' : 'Registrar Abastecimento'}
          </button>
        </form>

        {/* ── Métricas ── */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Métricas da Viagem
          </h2>

          <div className="bg-slate-800 rounded-2xl overflow-hidden">
            {[
              { label: 'Total Gasto',      value: `R$ ${brl(metricas.totalGasto)}`,                                                                    color: 'text-green-400' },
              { label: 'Km Rodados',       value: metricas.totalKmViagem > 0 ? `${metricas.totalKmViagem.toLocaleString('pt-BR')} km` : '—',           color: 'text-blue-400' },
              { label: 'Total de Litros',  value: metricas.totalLitros > 0 ? `${metricas.totalLitros.toFixed(1)} L` : '—',                             color: 'text-sky-400' },
              { label: 'Preço médio/L',    value: metricas.precoMedioLitro ? `R$ ${metricas.precoMedioLitro.toFixed(3)}` : '—',                        color: 'text-amber-400' },
              { label: 'Custo por km',     value: metricas.custoPorKm ? `R$ ${metricas.custoPorKm.toFixed(3)}` : '—',                                  color: 'text-orange-400' },
              { label: 'Média geral',      value: metricas.mediaConsumo ? `${metricas.mediaConsumo} km/L` : '—',                                       color: 'text-purple-400' },
              {
                label: 'Último trecho',
                value: metricas.consumoUltimoTrecho
                  ? `${metricas.consumoUltimoTrecho} km/L${metricas.mediaConsumo && metricas.consumoUltimoTrecho >= metricas.mediaConsumo * 1.05 ? ' ↑' : metricas.mediaConsumo && metricas.consumoUltimoTrecho < metricas.mediaConsumo * 0.95 ? ' ↓' : ''}`
                  : '—',
                color: corConsumo(metricas.consumoUltimoTrecho ?? 0, metricas.mediaConsumo),
              },
            ].map((item, i, arr) => (
              <div key={item.label}
                className={`flex items-center justify-between px-5 py-4 ${i < arr.length - 1 ? 'border-b border-slate-700' : ''}`}>
                <span className="text-sm text-slate-400">{item.label}</span>
                <span className={`text-base font-bold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Histórico ── */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Histórico
          </h2>

          {histLoading ? (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : historicoDisplay.length === 0 && pendingRecords.length === 0 ? (
            <div className="text-center text-slate-600 py-12 text-sm">
              Nenhum abastecimento ainda.
            </div>
          ) : (
            <div className="space-y-4">

              {/* Registros pendentes (IndexedDB — ainda não sincronizados) */}
              {pendingRecords.map((r) => (
                <div key={`pending-${r.id}`} className="bg-slate-800 rounded-2xl overflow-hidden border border-yellow-500/20">
                  <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                          Pendente
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        {new Date(r.timestamp).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-2xl font-bold text-green-400">R$&nbsp;{brl(r.valor_pago)}</p>
                      <p className="text-xs text-slate-500 mt-1">{r.km_atual.toLocaleString('pt-BR')} km</p>
                    </div>
                  </div>
                  {r.preco_por_litro && (
                    <div className="border-t border-slate-700 px-5 py-2">
                      <span className="text-sm text-slate-400">R$&nbsp;{r.preco_por_litro.toFixed(3)}/L</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Registros sincronizados */}
              {historicoDisplay.map((r) => (
                <div key={r.id} className="bg-slate-800 rounded-2xl overflow-hidden">

                  {editingId === r.id ? (
                    <div className="px-5 py-4 space-y-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Editar registro</p>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">KM atual</label>
                        <input type="number" inputMode="numeric" value={editState.km}
                          onChange={(e) => setEditState((s) => ({ ...s, km: e.target.value }))}
                          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-3 text-lg font-mono text-white focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Valor pago (R$)</label>
                        <input type="number" inputMode="decimal" step="0.01" value={editState.valor}
                          onChange={(e) => setEditState((s) => ({ ...s, valor: e.target.value }))}
                          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-3 text-lg font-mono text-white focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Preço/litro (opcional)</label>
                        <input type="number" inputMode="decimal" step="0.001" value={editState.preco}
                          onChange={(e) => setEditState((s) => ({ ...s, preco: e.target.value }))}
                          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-3 text-lg font-mono text-white focus:outline-none focus:border-blue-500" />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => handleSaveEdit(r.id)}
                          className="flex-1 bg-blue-600 active:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                          Salvar
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="flex-1 bg-slate-700 active:bg-slate-600 text-slate-300 font-semibold py-3 rounded-xl text-sm transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>

                  ) : confirmDelete === r.id ? (
                    <div className="px-5 py-5 flex flex-col gap-3">
                      <p className="text-sm text-slate-300">Apagar este registro?</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleDelete(r.id)}
                          className="flex-1 bg-red-600 active:bg-red-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                          Apagar
                        </button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="flex-1 bg-slate-700 active:bg-slate-600 text-slate-300 font-semibold py-3 rounded-xl text-sm transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>

                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-white truncate">
                            {r.cidade ?? 'Local desconhecido'}
                          </p>
                          {r.posto_nome && (
                            <p className="text-sm text-slate-400 truncate mt-1">{r.posto_nome}</p>
                          )}
                          <p className="text-xs text-slate-600 mt-1">
                            {new Date(r.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <div className="flex items-start gap-2 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-2xl font-bold text-green-400">R$&nbsp;{brl(r.valor_pago)}</p>
                            <p className="text-xs text-slate-500 mt-1">{r.km_atual.toLocaleString('pt-BR')} km</p>
                          </div>
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === r.id ? null : r.id) }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 active:bg-slate-700 transition-colors text-lg leading-none"
                              aria-label="Ações">
                              ···
                            </button>
                            {menuOpen === r.id && (
                              <div onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-9 z-20 bg-slate-700 border border-slate-600 rounded-xl shadow-xl overflow-hidden min-w-[130px]">
                                <button onClick={() => startEdit(r)}
                                  className="w-full text-left px-4 py-3 text-sm text-slate-200 active:bg-slate-600 transition-colors border-b border-slate-600">
                                  Editar
                                </button>
                                <button onClick={() => { setConfirmDelete(r.id); setMenuOpen(null) }}
                                  className="w-full text-left px-4 py-3 text-sm text-red-400 active:bg-slate-600 transition-colors">
                                  Apagar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {(r.litros != null || r.preco_por_litro != null || r.km_rodados != null) && (
                        <div className="border-t border-slate-700 px-5 py-3 flex items-center justify-between gap-4">
                          <div className="flex gap-4 text-sm text-slate-400">
                            {r.litros != null && <span>{r.litros.toFixed(2)} L</span>}
                            {r.preco_por_litro != null && <span>R$&nbsp;{r.preco_por_litro.toFixed(3)}/L</span>}
                            {r.km_rodados != null && <span>+{r.km_rodados.toLocaleString('pt-BR')} km</span>}
                          </div>
                          {r.consumo_trecho != null && (
                            <span className={`text-sm font-bold ${corConsumo(r.consumo_trecho, metricas.mediaConsumo)}`}>
                              {r.consumo_trecho} km/L
                              {metricas.mediaConsumo && r.consumo_trecho >= metricas.mediaConsumo * 1.05 && ' ↑'}
                              {metricas.mediaConsumo && r.consumo_trecho < metricas.mediaConsumo * 0.95 && ' ↓'}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
