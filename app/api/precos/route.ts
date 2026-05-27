import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request: NextRequest) {
  const estado = new URL(request.url).searchParams.get('estado')?.toUpperCase() ?? null

  try {
    const { rows } = await pool.query(
      `SELECT estado, combustivel, preco_medio, updated_at
       FROM precos_combustivel
       ${estado ? 'WHERE estado = $1' : ''}
       ORDER BY estado, combustivel`,
      estado ? [estado] : []
    )

    if (estado) {
      const g = rows.find((r) => r.combustivel === 'gasolina')
      const e = rows.find((r) => r.combustivel === 'etanol')
      return NextResponse.json({
        estado,
        gasolina:   g ? parseFloat(g.preco_medio) : null,
        etanol:     e ? parseFloat(e.preco_medio) : null,
        updated_at: rows[0]?.updated_at ?? null,
      })
    }

    // Sem filtro: retorna todos os estados
    const estados = [...new Set(rows.map((r) => r.estado as string))]
    const result = estados.map((est) => {
      const sr = rows.filter((r) => r.estado === est)
      const g  = sr.find((r) => r.combustivel === 'gasolina')
      const e  = sr.find((r) => r.combustivel === 'etanol')
      return {
        estado:     est,
        gasolina:   g ? parseFloat(g.preco_medio) : null,
        etanol:     e ? parseFloat(e.preco_medio) : null,
        updated_at: sr[0]?.updated_at ?? null,
      }
    })
    return NextResponse.json(result)
  } catch {
    if (estado) {
      return NextResponse.json({ estado, gasolina: null, etanol: null, updated_at: null })
    }
    return NextResponse.json([])
  }
}
