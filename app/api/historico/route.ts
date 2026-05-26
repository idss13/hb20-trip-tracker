import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, km_atual, valor_pago, litros, preco_por_litro, cidade, posto_nome
       FROM abastecimentos
       ORDER BY created_at DESC
       LIMIT 100`
    )
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[historico]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
