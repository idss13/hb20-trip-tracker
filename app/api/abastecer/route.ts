import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { estadoFromNominatim } from '@/lib/anp'

interface Payload {
  km_atual: number
  valor_pago: number
  preco_por_litro?: number
  litros?: number
  latitude?: number | null
  longitude?: number | null
  timestamp?: string
  combustivel?: 'gasolina' | 'etanol'
}

async function reverseGeocode(lat: number, lon: number) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: { 'User-Agent': 'HB20TripTracker/1.0 italo.saraiva@grupolagoaquente.com.br' },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return { cidade: null, posto_nome: null, estado: null }
    const data = await res.json()
    const addr = data.address ?? {}
    return {
      cidade:     addr.city ?? addr.town ?? addr.village ?? addr.county ?? null,
      posto_nome: addr.amenity ?? addr.name ?? null,
      estado:     estadoFromNominatim(addr),
    }
  } catch {
    return { cidade: null, posto_nome: null, estado: null }
  }
}

export async function POST(request: NextRequest) {
  let body: Payload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { km_atual, valor_pago, preco_por_litro, latitude, longitude, combustivel } = body

  if (!km_atual || !valor_pago) {
    return NextResponse.json({ error: 'km_atual e valor_pago são obrigatórios' }, { status: 400 })
  }

  let litros: number | null = body.litros ?? null
  if (litros == null && preco_por_litro && preco_por_litro > 0) {
    litros = parseFloat((valor_pago / preco_por_litro).toFixed(3))
  }

  let cidade: string | null     = null
  let posto_nome: string | null = null
  let estado: string | null     = null
  if (latitude != null && longitude != null) {
    ;({ cidade, posto_nome, estado } = await reverseGeocode(latitude, longitude))
  }

  const { rows } = await pool.query(
    `INSERT INTO abastecimentos
       (km_atual, valor_pago, litros, preco_por_litro, latitude, longitude, cidade, posto_nome, combustivel, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [km_atual, valor_pago, litros, preco_por_litro ?? null,
     latitude ?? null, longitude ?? null, cidade, posto_nome,
     combustivel ?? 'gasolina', estado]
  )

  return NextResponse.json(rows[0], { status: 201 })
}
