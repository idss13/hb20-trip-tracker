const CACHE_NAME = 'hb20-tracker-v1'
const DB_NAME = 'hb20-tracker'
const DB_VERSION = 1
const STORE_NAME = 'pending_abastecimentos'

// App shell assets to cache for offline loading
const APP_SHELL = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Pass API calls through without caching
  if (url.pathname.startsWith('/api/')) return

  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  // Cache-first for app shell; stale-while-revalidate for everything else
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      return cached || networkFetch
    })
  )
})

// Background Sync — flush pending records from IndexedDB to the API
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-abastecimentos') {
    event.waitUntil(flushPendingRecords())
  }
})

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
  })
}

async function flushPendingRecords() {
  const db = await openIDB()

  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  for (const record of records) {
    try {
      const res = await fetch('/api/abastecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })

      if (res.ok) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          const req = tx.objectStore(STORE_NAME).delete(record.id)
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
        })
      }
    } catch {
      // Network still unavailable — will retry on next sync event
    }
  }
}
