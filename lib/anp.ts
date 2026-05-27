const ANP_URL =
  'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-gasolina-etanol.csv'

// Fallback: state full name → UF abbreviation (Nominatim may not always have ISO3166-2-lvl4)
const ESTADO_MAP: Record<string, string> = {
  Acre: 'AC', Alagoas: 'AL', 'Amapá': 'AP', Amazonas: 'AM',
  Bahia: 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
  'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
  'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', Pernambuco: 'PE',
  'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', Roraima: 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE',
  Tocantins: 'TO',
}

export function estadoFromNominatim(addr: Record<string, string>): string | null {
  const iso4 = addr['ISO3166-2-lvl4']
  if (iso4?.startsWith('BR-')) return iso4.slice(3)
  const fullName = addr.state
  if (fullName && ESTADO_MAP[fullName]) return ESTADO_MAP[fullName]
  return null
}

export interface PrecoPorEstado {
  estado: string
  gasolina: number | null
  etanol: number | null
}

export async function fetchANPPrices(): Promise<PrecoPorEstado[]> {
  const res = await fetch(ANP_URL, {
    headers: { 'User-Agent': 'HB20TripTracker/1.0 italo.saraiva@grupolagoaquente.com.br' },
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) throw new Error(`ANP HTTP ${res.status}`)

  const buf = await res.arrayBuffer()

  // Try UTF-8 first; fall back to windows-1252 (Latin-1 superset used by ANP)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    text = new TextDecoder('windows-1252').decode(buf)
  }

  const lines = text.split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV vazio ou mal formatado')

  const header = lines[0].split(';').map((h) => h.trim())
  const iEstado  = header.indexOf('Estado - Sigla')
  const iProduto = header.indexOf('Produto')
  const iPreco   = header.indexOf('Valor de Venda')

  if (iEstado < 0 || iProduto < 0 || iPreco < 0) {
    throw new Error(`Colunas inesperadas: ${header.join(', ')}`)
  }

  const byState = new Map<string, { gasSum: number; gasCnt: number; etaSum: number; etaCnt: number }>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const cols = line.split(';')
    const needed = Math.max(iEstado, iProduto, iPreco) + 1
    if (cols.length < needed) continue

    const estado  = cols[iEstado].trim()
    const produto = cols[iProduto].trim().toUpperCase()
    const raw     = cols[iPreco].trim().replace(',', '.')
    const preco   = parseFloat(raw)

    if (!estado || !produto || isNaN(preco) || preco <= 0) continue

    if (!byState.has(estado)) {
      byState.set(estado, { gasSum: 0, gasCnt: 0, etaSum: 0, etaCnt: 0 })
    }
    const s = byState.get(estado)!

    if (produto === 'GASOLINA') {
      s.gasSum += preco; s.gasCnt++
    } else if (produto === 'ETANOL') {
      s.etaSum += preco; s.etaCnt++
    }
  }

  return Array.from(byState.entries()).map(([estado, s]) => ({
    estado,
    gasolina: s.gasCnt > 0 ? parseFloat((s.gasSum / s.gasCnt).toFixed(3)) : null,
    etanol:   s.etaCnt > 0 ? parseFloat((s.etaSum / s.etaCnt).toFixed(3)) : null,
  }))
}
