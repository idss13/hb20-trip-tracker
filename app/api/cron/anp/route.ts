import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fetchANPPrices } from '@/lib/anp'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const precos = await fetchANPPrices()

    let registros = 0
    for (const p of precos) {
      for (const [combustivel, preco] of [
        ['gasolina', p.gasolina] as const,
        ['etanol',   p.etanol]   as const,
      ]) {
        if (preco == null) continue
        await pool.query(
          `INSERT INTO precos_combustivel (estado, combustivel, preco_medio, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (estado, combustivel)
           DO UPDATE SET preco_medio = EXCLUDED.preco_medio, updated_at = NOW()`,
          [p.estado, combustivel, preco]
        )
        registros++
      }
    }

    return NextResponse.json({
      success:  true,
      estados:  precos.length,
      registros,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
