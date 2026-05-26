'use client'

import { openDB } from 'idb'

export const DB_NAME = 'hb20-tracker'
export const DB_VERSION = 1
export const STORE_NAME = 'pending_abastecimentos'

export interface PendingRecord {
  id?: number
  km_atual: number
  valor_pago: number
  preco_por_litro?: number
  litros?: number
  latitude?: number | null
  longitude?: number | null
  timestamp: string
}

function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    },
  })
}

export async function savePending(record: Omit<PendingRecord, 'id'>): Promise<number> {
  const db = await getDB()
  return db.add(STORE_NAME, record) as Promise<number>
}

export async function getAllPending(): Promise<PendingRecord[]> {
  const db = await getDB()
  return db.getAll(STORE_NAME)
}

export async function deletePending(id: number): Promise<void> {
  const db = await getDB()
  return db.delete(STORE_NAME, id)
}
