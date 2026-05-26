'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { savePending, getAllPending, deletePending, type PendingRecord } from '@/lib/idb'

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface EditState {
  km: string
  valor: string
  preco: string
}

type Tab = 'registrar' | 'dashboard' | 'historico'

// ─── Pure functions ───────────────────────────────────────────────────────────

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

  const totalGasto   = enriquecidos.reduce((acc, r) => acc + r.valor_pago, 0)
  const totalLitros  = enriquecidos.reduce((acc, r) => acc + (r.litros ?? 0), 0)
  const totalKmViagem =
    enriquecidos[enriquecidos.length - 1].km_atual - enriquecidos[0].km_atual

  const trechosCompletos = enriquecidos.filter(
    (r) => r.km_rodados != null && r.litros != null
  )

  let mediaConsumo: number | null = null
  if (trechosCompletos.length > 0) {
    const kmTotal  = trechosCompletos.reduce((a, r) => a + r.km_rodados!, 0)
    const litTotal = trechosCompletos.reduce((a, r) => a + r.litros!, 0)
    if (litTotal > 0) mediaConsumo = parseFloat((kmTotal / litTotal).toFixed(2))
  }

  const consumoUltimoTrecho =
    trechosCompletos.length > 0
      ? trechosCompletos[trechosCompletos.length - 1].consumo_trecho
      : null

  const custoPorKm     = totalKmViagem > 0 ? parseFloat((totalGasto / totalKmViagem).toFixed(3)) : null
  const precoMedioLitro = totalLitros > 0  ? parseFloat((totalGasto / totalLitros).toFixed(3))   : null

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

function getPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 }
    )
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

const BAR_MIN = 6
const BAR_MAX = 14

function Termometro({ consumo }: { consumo: number | null }) {
  const isGreen  = consumo != null && consumo > 10
  const isYellow = consumo != null && consumo >= 8.5 && consumo <= 10
  const isRed    = consumo != null && consumo < 8.5

  const corTexto = isGreen ? 'text-green-400' : isYellow ? 'text-yellow-400' : isRed ? 'text-red-400' : 'text-slate-500'
  const corBg    = isGreen ? 'border-green-500/30 bg-green-500/10' : isYellow ? 'border-yellow-500/30 bg-yellow-500/10' : isRed ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700 bg-slate-800'
  const corDot   = isGreen ? 'bg-green-400' : isYellow ? 'bg-yellow-400' : 'bg-red-400'
  const label    = isGreen ? 'Ótimo' : isYellow ? 'Bom' : isRed ? 'Abaixo do ideal' : 'Sem dados'

  const dotPos = consumo != null
    ? Math.max(0, Math.min(100, (consumo - BAR_MIN) / (BAR_MAX - BAR_MIN) * 100))
    : null

  return (
    <div className={`rounded-2xl border p-5 ${corBg}`}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
        Eficiência — último trecho
      </p>
      <div className="flex items-end gap-3 mb-5">
        <span className={`text-5xl font-bold tabular-nums ${corTexto}`}>
          {consumo != null ? consumo.toFixed(1) : '—'}
        </span>
        <span className="text-slate-400 text-lg mb-1">km/L</span>
        <span className={`ml-auto text-sm font-semibold ${corTexto}`}>{label}</span>
      </div>
      <div className="relative mb-1.5">
        <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
          <div className="bg-red-500/70"    style={{ flex: '2.5' }} />
          <div className="bg-yellow-500/70" style={{ flex: '1.5' }} />
          <div className="bg-green-500/70"  style={{ flex: '4' }} />
        </div>
        {dotPos != null && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-900 shadow ${corDot}`}
            style={{ left: `calc(${dotPos}% - 7px)` }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>6</span><span>8.5</span><span>10</span><span>14 km/L</span>
      </div>
    </div>
  )
}

// ─── Tab icons (inline SVG) ───────────────────────────────────────────────────

function IconForm({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconDashboard({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="7" width="4" height="14" rx="1" />
      <rect x="17" y="3" width="4" height="18" rx="1" />
    </svg>
  )
}

function IconHistory({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TripTracker() {
  const [tab, setTab] = useState<Tab>('registrar')

  const [isOnline, setIsOnline]         = useState(true)
  const [gpsCapturing, setGpsCapturing] = useState(false)

  const [km, setKm]       = useState('')
  const [valor, setValor] = useState('')
  const [preco, setPreco] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [historico, setHistorico]           = useState<Abastecimento[]>([])
  const [histLoading, setHistLoading]       = useState(true)
  const [pendingRecords, setPendingRecords] = useState<PendingRecord[]>([])
  const [pendingCount, setPendingCount]     = useState(0)

  const [menuOpen, setMenuOpen]           = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editState, setEditState]         = useState<EditState>({ km: '', valor: '', preco: '' })

  const [distancia, setDistancia] = useState('')

  const swRegistered  = useRef(false)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && !swRegistered.current) {
      swRegistered.current = true
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
    }
  }, [])

  const loadHistorico = useCallback(async () => {
    try {
      const res = await fetch('/api/historico')
      if (res.ok) setHistorico(await res.json())
    } catch { /* offline */ }
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
    const on  = () => { setIsOnline(true); triggerSync() }
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
    fetch(`/api/abastecer/${id}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error('server') })
      .catch(() => {
        if (removed) setHistorico((prev) => [...prev, removed])
        showFeedback('error', 'Erro ao apagar. Tente novamente.')
      })
  }

  const startEdit = (r: AbastecimentoEnriquecido) => {
    setEditingId(r.id)
    setEditState({
      km:    String(r.km_atual),
      valor: String(r.valor_pago),
      preco: r.preco_por_litro != null ? String(r.preco_por_litro) : '',
    })
    setMenuOpen(null)
  }

  const handleSaveEdit = async (id: string) => {
    const km_atual        = parseInt(editState.km, 10)
    const valor_pago      = parseFloat(editState.valor)
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

    // Salva os valores antes de limpar o form
    const savedKm    = km
    const savedValor = valor
    const savedPreco = preco
    const precoFallback = savedPreco ? parseFloat(savedPreco) : metricas.precoMedioLitro ?? undefined

    // Libera o form imediatamente — usuário pode já digitar o próximo
    setKm(''); setValor(''); setPreco('')

    // GPS roda em background (até 8s) enquanto o form já está livre
    setGpsCapturing(true)
    const coords = await getPosition()
    setGpsCapturing(false)

    const payload: Omit<PendingRecord, 'id'> = {
      km_atual:        parseInt(savedKm, 10),
      valor_pago:      parseFloat(savedValor),
      preco_por_litro: precoFallback,
      latitude:        coords?.lat ?? null,
      longitude:       coords?.lon ?? null,
      timestamp:       new Date().toISOString(),
    }

    if (isOnline) {
      try {
        const res = await fetch('/api/abastecer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          showFeedback('success', 'Abastecimento registrado!')
          await loadHistorico()
        } else {
          await savePending(payload); await loadPending()
          showFeedback('error', 'Erro no servidor. Salvo localmente.')
        }
      } catch {
        await savePending(payload); await loadPending()
        showFeedback('success', 'Salvo localmente. Sincroniza quando o sinal voltar.')
      }
    } else {
      await savePending(payload); await loadPending()
      showFeedback('success', 'Salvo localmente. Sincroniza quando o sinal voltar.')
    }
  }

  const enriquecidos = useMemo(() => enriquecer(historico), [historico])
  const metricas     = useMemo(() => calcularMetricas(enriquecidos), [enriquecidos])
  const historicoDisplay = useMemo(
    () => [...enriquecidos].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [enriquecidos]
  )
  const litrosEstimados = useMemo(() => {
    const d = parseFloat(distancia)
    const consumo = metricas.consumoUltimoTrecho ?? metricas.mediaConsumo
    if (!d || !consumo || consumo <= 0) return null
    return parseFloat((d / consumo).toFixed(2))
  }, [distancia, metricas.consumoUltimoTrecho, metricas.mediaConsumo])

  const inputCls =
    'w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-4 text-2xl font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors'

  const tabs: { id: Tab; label: string; icon: (a: boolean) => React.ReactNode }[] = [
    { id: 'registrar', label: 'Registrar',  icon: (a) => <IconForm active={a} /> },
    { id: 'dashboard', label: 'Dashboard',  icon: (a) => <IconDashboard active={a} /> },
    { id: 'historico', label: 'Histórico',  icon: (a) => <IconHistory active={a} /> },
  ]

  return (
    <div
      className="min-h-screen bg-slate-900 text-slate-100 font-sans"
      onClick={() => setMenuOpen(null)}
    >
      <div className="max-w-md mx-auto px-4 pb-24">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-slate-900 pt-5 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-white leading-tight">HB20 Trip Tracker</h1>
            <div className="flex items-center gap-2">
              {gpsCapturing && (
                <span className="text-xs text-yellow-400 animate-pulse">GPS...</span>
              )}
              <span className={`text-xs px-3 py-1.5 rounded-full font-semibold tracking-wide ${
                isOnline
                  ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                  : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25'
              }`}>
                {isOnline ? '● Online' : '● Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Banners globais (todas as abas) ── */}
        <div className="space-y-2 mt-4 empty:mt-0">
          {!isOnline && (
            <div className="p-3 rounded-xl text-sm bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
              Sem internet — dados salvos localmente e sincronizados quando o sinal voltar.
            </div>
          )}
          {feedback && (
            <div className={`p-3 rounded-xl text-sm font-medium border ${
              feedback.type === 'success'
                ? 'bg-green-500/10 text-green-300 border-green-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
              {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
            </div>
          )}
          {pendingCount > 0 && isOnline && (
            <div className="p-3 rounded-xl text-sm bg-blue-500/10 text-blue-300 border border-blue-500/20 flex items-center justify-between">
              <span>{pendingCount} registro{pendingCount > 1 ? 's' : ''} pendente{pendingCount > 1 ? 's' : ''}</span>
              <button onClick={triggerSync} className="text-blue-400 underline underline-offset-2 font-medium">
                Sincronizar agora
              </button>
            </div>
          )}
        </div>

        {/* ══════════════════════ ABA: REGISTRAR ══════════════════════ */}
        {tab === 'registrar' && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
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
                Preço por Litro (R$/L)
                <span className="text-slate-600 font-normal ml-1">
                  opcional{metricas.precoMedioLitro ? ` — média: R$ ${metricas.precoMedioLitro.toFixed(3)}` : ''}
                </span>
              </label>
              <input type="number" inputMode="decimal" step="0.001" value={preco}
                onChange={(e) => setPreco(e.target.value)} placeholder="3,890" className={inputCls} />
            </div>
            <button type="submit" disabled={gpsCapturing}
              className="w-full bg-blue-600 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-lg py-5 rounded-2xl transition-colors mt-1 shadow-lg shadow-blue-950/60 select-none">
              Registrar Abastecimento
            </button>
          </form>
        )}

        {/* ══════════════════════ ABA: DASHBOARD ══════════════════════ */}
        {tab === 'dashboard' && (
          <div className="mt-6 space-y-6">

            {/* Termômetro */}
            <Termometro consumo={metricas.consumoUltimoTrecho} />

            {/* Calculadora Preditiva */}
            <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
                Cálculo Preditivo
              </p>
              <label className="block text-sm text-slate-400 mb-2">
                Distância até o próximo destino (km)
              </label>
              <input
                type="number" inputMode="numeric" value={distancia}
                onChange={(e) => setDistancia(e.target.value)}
                placeholder="150"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-2xl font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
              {litrosEstimados != null ? (
                <div className="mt-4 space-y-1">
                  <p className="text-sm text-slate-400">
                    Consumo estimado:{' '}
                    <span className="font-bold text-white text-base">{litrosEstimados} L</span>
                    <span className="text-slate-600 ml-1 text-xs">
                      ({metricas.consumoUltimoTrecho ? 'último trecho' : 'média geral'})
                    </span>
                  </p>
                  {metricas.precoMedioLitro != null && (
                    <p className="text-sm text-slate-400">
                      Custo estimado:{' '}
                      <span className="font-bold text-green-400 text-base">
                        R$&nbsp;{brl(litrosEstimados * metricas.precoMedioLitro)}
                      </span>
                      <span className="text-slate-600 ml-1 text-xs">
                        @ R$&nbsp;{metricas.precoMedioLitro.toFixed(3)}/L
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-600">
                  {metricas.mediaConsumo == null
                    ? 'Registre ao menos 2 abastecimentos para ativar.'
                    : 'Digite uma distância para ver a estimativa.'}
                </p>
              )}
            </div>

            {/* Métricas da Viagem */}
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Métricas da Viagem
              </h2>
              <div className="bg-slate-800 rounded-2xl overflow-hidden">
                {[
                  { label: 'Total Gasto',     value: `R$ ${brl(metricas.totalGasto)}`,                                                              color: 'text-green-400' },
                  { label: 'Km Rodados',      value: metricas.totalKmViagem > 0 ? `${metricas.totalKmViagem.toLocaleString('pt-BR')} km` : '—',     color: 'text-blue-400' },
                  { label: 'Total de Litros', value: metricas.totalLitros > 0 ? `${metricas.totalLitros.toFixed(1)} L` : '—',                       color: 'text-sky-400' },
                  { label: 'Preço médio/L',   value: metricas.precoMedioLitro ? `R$ ${metricas.precoMedioLitro.toFixed(3)}` : '—',                  color: 'text-amber-400' },
                  { label: 'Custo por km',    value: metricas.custoPorKm ? `R$ ${metricas.custoPorKm.toFixed(3)}` : '—',                            color: 'text-orange-400' },
                  { label: 'Média geral',     value: metricas.mediaConsumo ? `${metricas.mediaConsumo} km/L` : '—',                                 color: 'text-purple-400' },
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
            </div>
          </div>
        )}

        {/* ══════════════════════ ABA: HISTÓRICO ══════════════════════ */}
        {tab === 'historico' && (
          <div className="mt-6">
            {histLoading ? (
              <div className="space-y-4">
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
              </div>
            ) : historicoDisplay.length === 0 && pendingRecords.length === 0 ? (
              <div className="text-center text-slate-600 py-16 text-sm">Nenhum abastecimento ainda.</div>
            ) : (
              <div className="space-y-4">

                {pendingRecords.map((r) => (
                  <div key={`pending-${r.id}`} className="bg-slate-800 rounded-2xl overflow-hidden border border-yellow-500/20">
                    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                          Pendente
                        </span>
                        <p className="text-xs text-slate-600 mt-2">
                          {new Date(r.timestamp).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-2xl font-bold text-green-400">R$&nbsp;{brl(r.valor_pago)}</p>
                        <p className="text-xs text-slate-500 mt-1">{r.km_atual.toLocaleString('pt-BR')} km</p>
                      </div>
                    </div>
                    {r.preco_por_litro != null && (
                      <div className="border-t border-slate-700 px-5 py-2">
                        <span className="text-sm text-slate-400">R$&nbsp;{r.preco_por_litro.toFixed(3)}/L</span>
                      </div>
                    )}
                  </div>
                ))}

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
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 active:bg-slate-700 transition-colors"
                                aria-label="Ações">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                  <circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" />
                                </svg>
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
          </div>
        )}
      </div>

      {/* ── Bottom tab bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-slate-900/95 backdrop-blur border-t border-slate-800">
        <div className="max-w-md mx-auto flex">
          {tabs.map(({ id, label, icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                  active ? 'text-blue-400' : 'text-slate-600 active:text-slate-400'
                }`}
              >
                {icon(active)}
                <span className={`text-xs font-medium ${active ? 'text-blue-400' : 'text-slate-600'}`}>
                  {label}
                </span>
                {active && (
                  <span className="absolute bottom-0 w-8 h-0.5 bg-blue-400 rounded-full" />
                )}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
