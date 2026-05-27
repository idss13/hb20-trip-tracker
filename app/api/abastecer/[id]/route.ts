import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM abastecimentos WHERE id = $1',
      [id]
    )
    if (!rowCount) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  let body: { km_atual?: number; valor_pago?: number; preco_por_litro?: number | null; combustivel?: 'gasolina' | 'etanol' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { km_atual, valor_pago, preco_por_litro, combustivel } = body
  if (km_atual == null || valor_pago == null) {
    return NextResponse.json({ error: 'km_atual e valor_pago são obrigatórios' }, { status: 400 })
  }

  const litros =
    preco_por_litro && preco_por_litro > 0
      ? parseFloat((valor_pago / preco_por_litro).toFixed(3))
      : null

  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE abastecimentos
         SET km_atual = $1, valor_pago = $2, preco_por_litro = $3, litros = $4, combustivel = $5
       WHERE id = $6
       RETURNING *`,
      [km_atual, valor_pago, preco_por_litro ?? null, litros, combustivel ?? 'gasolina', id]
    )
    if (!rowCount) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
