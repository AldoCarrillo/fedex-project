import { useEffect, useRef, useState } from 'react'
import { readSheet } from 'read-excel-file/browser'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_ROWS = 50000
const DISPLAY_COLUMNS = 3
const PREVIEW_ROWS_PER_GROUP = 100
const GROUP_STARTS = [100, 200, 300, 400, 500, 600, 700, 800]
const MAX_IMAGE_DIMENSION = 32767
const HISTORY_CODE_STORAGE_KEY = 'fedex-tools-history-code'
const HISTORY_PAIRING_PENDING_KEY = 'fedex-tools-history-pairing-pending'
const HISTORY_PAIRING_PIN_KEY = 'fedex-tools-history-pairing-pin'
const HISTORY_CODE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/
const PIN_PATTERN = /^\d{4}$/

function createHistoryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function createFourDigitCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000)
}

async function hashHistoryCode(code) {
  const bytes = new TextEncoder().encode(code)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function requestHistoryPairing({ action, code, body, requestToken }) {
  const query = new URLSearchParams({ action })
  const response = await fetch(`/api/history-pairing?${query}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(code || requestToken ? { Authorization: `Bearer ${code || requestToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.error || 'Device pairing failed. Please try again.')
  }
  return result
}

function getInitialPairingPin() {
  try {
    const storedPin = JSON.parse(localStorage.getItem(HISTORY_PAIRING_PIN_KEY) || 'null')
    return storedPin && PIN_PATTERN.test(storedPin.pin)
      && new Date(storedPin.expiresAt) > new Date()
      ? storedPin
      : null
  } catch {
    return null
  }
}

function getInitialPendingPairing() {
  try {
    const pending = JSON.parse(localStorage.getItem(HISTORY_PAIRING_PENDING_KEY) || 'null')
    return pending && HISTORY_CODE_PATTERN.test(pending.code)
      && /^[A-Za-z0-9_-]{40,64}$/.test(pending.requestToken)
      && PIN_PATTERN.test(pending.verificationCode)
      ? pending
      : null
  } catch {
    return null
  }
}

function getInitialHistorySetup() {
  let storedCode
  try {
    storedCode = localStorage.getItem(HISTORY_CODE_STORAGE_KEY)
  } catch {
    return {
      code: createHistoryCode(),
      error: 'Browser storage is unavailable. Copy your history code before leaving this page.',
    }
  }
  if (HISTORY_CODE_PATTERN.test(storedCode || '')) return { code: storedCode, error: '' }

  const code = createHistoryCode()
  try {
    localStorage.setItem(HISTORY_CODE_STORAGE_KEY, code)
    return { code, error: '' }
  } catch {
    return {
      code,
      error: 'Could not save your history code in this browser. Copy it before leaving this page.',
    }
  }
}

function mapPostedResult(post) {
  return {
    id: post.id,
    savedAt: post.saved_at,
    fileName: post.file_name,
    headers: post.headers,
    idColumnIndex: post.id_column_index,
    groups: post.groups,
    totalPackages: post.total_packages,
  }
}

async function requestPostedResults(code, { method = 'GET', id, body } = {}) {
  const query = id ? `?id=${encodeURIComponent(id)}` : ''
  const response = await fetch(`/api/package-posts${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${code}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.error || 'Cloud history request failed. Please try again.')
  }
  return result
}

function cellToText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toLocaleDateString()
  if (Array.isArray(value)) return value.map(cellToText).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getWorksheetData(rows) {
  let headerIndex = rows.findIndex((row) => row.some((cell) => cell != null && cellToText(cell).trim()))
  if (headerIndex < 0) {
    return { headers: [], records: [], rowsTruncated: false, columnCount: 0 }
  }

  const dataRows = rows.slice(headerIndex)
  let columnCount = 0
  for (const row of dataRows) {
    columnCount = Math.max(columnCount, row.length)
  }

  const headers = Array.from({ length: Math.min(columnCount, DISPLAY_COLUMNS) }, (_, index) => {
    const header = cellToText(dataRows[0][index]).trim()
    return header || `Column ${index + 1}`
  })
  const records = dataRows
    .slice(1, MAX_ROWS + 1)
    .map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
    .filter((row) => row.some((cell) => cellToText(cell).trim()))

  return {
    headers,
    records,
    rowsTruncated: dataRows.length - 1 > MAX_ROWS,
    columnCount,
  }
}

function getIdDigits(value) {
  const id = cellToText(value).trim()
  const match = id.match(/^(\d{3})-(\d{4})$/) || id.match(/^(\d{3})(\d{4})$/)
  return match ? `${match[1]}${match[2]}` : null
}

function getTimestampValue(value) {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? null : time
  }

  const text = cellToText(value).trim()
  const timeMatch = text.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i)
  if (timeMatch) {
    let hours = Number(timeMatch[1])
    const minutes = Number(timeMatch[2])
    const seconds = Number(timeMatch[3] || 0)
    const meridiem = timeMatch[5]?.toUpperCase()

    if (meridiem) {
      if (hours < 1 || hours > 12) return null
      hours = (hours % 12) + (meridiem === 'PM' ? 12 : 0)
    } else if (hours > 23) {
      return null
    }

    const milliseconds = Number((timeMatch[4] || '').padEnd(3, '0'))
    return (((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 100_000_000_000) return value
    if (value >= 1_000_000_000) return value * 1000
    if (value > 0 && value < 2_958_466) {
      return Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000
    }
    return null
  }

  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? null : timestamp
}

function getGroupStart(value) {
  const digits = getIdDigits(value)
  if (!digits) return null

  const groupStart = Math.floor(Number(digits.slice(0, 3)) / 100) * 100
  return GROUP_STARTS.includes(groupStart) ? groupStart : null
}

function findIdColumnIndex(headers, records) {
  const idHeaderIndex = headers.findIndex((header) => /\b(?:ID|IDENTIFIER)\b/i.test(header))
  if (idHeaderIndex >= 0) return idHeaderIndex

  const matchingIds = headers.map((_, columnIndex) => (
    records.reduce((count, row) => count + (getGroupStart(row[columnIndex]) !== null ? 1 : 0), 0)
  ))
  const bestMatchCount = Math.max(...matchingIds)
  if (bestMatchCount === 0) return -1

  const bestColumnIndexes = matchingIds.flatMap((count, index) => (
    count === bestMatchCount ? [index] : []
  ))
  return bestColumnIndexes.length === 1 ? bestColumnIndexes[0] : -1
}

function formatCell(value, columnIndex, idColumnIndex) {
  if (value instanceof Date) return value.toLocaleString()
  if (columnIndex !== idColumnIndex) return cellToText(value)

  const digits = getIdDigits(value)
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3)}` : value
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character])
}

function wrapText(value, maxCharacters) {
  const words = String(value).split(/\s+/)
  const lines = []
  let line = ''

  for (const word of words) {
    if (word.length > maxCharacters) {
      if (line) {
        lines.push(line)
        line = ''
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters))
      }
    } else if (line && line.length + word.length + 1 > maxCharacters) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }

  if (line || lines.length === 0) lines.push(line)
  return lines
}

function createGroupImage(groupStart, rows, headers, idIndex) {
  const width = 1200
  const padding = 28
  const columnWidth = (width - padding * 2) / headers.length
  const headerTop = 90
  const headerHeight = 42
  let y = headerTop + headerHeight
  const rowMarkup = rows.map((row, rowIndex) => {
    const cells = headers.map((_, columnIndex) => (
      wrapText(formatCell(row[columnIndex], columnIndex, idIndex), Math.floor((columnWidth - 24) / 8))
    ))
    const rowHeight = Math.max(38, ...cells.map((lines) => lines.length * 19 + 16))
    const background = rowIndex % 2 === 0 ? '#ffffff' : '#f8f6fa'
    const cellMarkup = cells.map((lines, columnIndex) => {
      const x = padding + columnIndex * columnWidth + 12
      const text = lines.map((line, lineIndex) => (
        `<tspan x="${x}" dy="${lineIndex === 0 ? 0 : 19}">${escapeXml(line)}</tspan>`
      )).join('')
      return `<text x="${x}" y="${y + 23}" fill="#29222f" font-family="Arial, sans-serif" font-size="14">${text}</text>`
    }).join('')
    const markup = `<rect x="${padding}" y="${y}" width="${width - padding * 2}" height="${rowHeight}" fill="${background}"/><line x1="${padding}" y1="${y + rowHeight}" x2="${width - padding}" y2="${y + rowHeight}" stroke="#e5dfeb"/>${cellMarkup}`
    y += rowHeight
    return markup
  }).join('')
  const emptyMarkup = rows.length
    ? ''
    : `<text x="${padding}" y="${headerTop + headerHeight + 32}" fill="#716a77" font-family="Arial, sans-serif" font-size="15">No Packages</text>`
  const height = Math.max(y + padding, headerTop + headerHeight + padding + (rows.length ? 0 : 32))
  const headerMarkup = headers.map((header, index) => {
    const x = padding + index * columnWidth + 12
    return `<text x="${x}" y="${headerTop + 26}" fill="#4d148c" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(header)}</text>`
  }).join('')

  const markup = `<rect width="${width}" height="${height}" fill="#ffffff"/><text x="${padding}" y="42" fill="#4d148c" font-family="Arial, sans-serif" font-size="24" font-weight="700">Missing Packages — ${groupStart}s</text><text x="${padding}" y="66" fill="#716a77" font-family="Arial, sans-serif" font-size="14">${rows.length.toLocaleString()} ${rows.length === 1 ? 'package' : 'packages'}</text><rect x="${padding}" y="${headerTop}" width="${width - padding * 2}" height="${headerHeight}" fill="#f3ecfa"/>${headerMarkup}${rowMarkup}${emptyMarkup}`
  return { height, markup }
}

function createAllGroupsImage(groups, headers, idIndex) {
  const width = 1200
  const gap = 16
  let height = 0
  const sections = GROUP_STARTS.map((groupStart) => {
    const section = createGroupImage(groupStart, groups[groupStart], headers, idIndex)
    const markup = `<g transform="translate(0 ${height})">${section.markup}</g>`
    height += section.height + gap
    return markup
  })
  height -= gap

  if (height > MAX_IMAGE_DIMENSION) {
    throw new Error('This result is too large for one PNG image. Filter a smaller workbook and try again.')
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${sections.join('')}</svg>`
}

function renderPng(svg) {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Your browser could not create the PNG image.')
        context.drawImage(image, 0, 0)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(svgUrl)
          if (blob) resolve(blob)
          else reject(new Error('Your browser could not create the PNG image.'))
        }, 'image/png')
      } catch (renderError) {
        URL.revokeObjectURL(svgUrl)
        reject(renderError)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl)
      reject(new Error('Your browser could not render the PNG image.'))
    }
    image.src = svgUrl
  })
}

function PackageRows({ rows, headers, idColumnIndex }) {
  const [visibleCount, setVisibleCount] = useState(PREVIEW_ROWS_PER_GROUP)
  const visibleRows = rows.slice(0, visibleCount)

  if (rows.length === 0) return <p className="spreadsheet-empty">No Packages</p>

  return (
    <>
      {rows.length > PREVIEW_ROWS_PER_GROUP && (
        <p className="spreadsheet-preview-note">
          Showing the first {visibleRows.length} of {rows.length.toLocaleString()} rows.
        </p>
      )}
      <div className="spreadsheet-table-wrap">
        <table className="spreadsheet-table">
          <thead>
            <tr>{headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((header, columnIndex) => (
                  <td key={`${rowIndex}-${columnIndex}`}>
                    {formatCell(row[columnIndex], columnIndex, idColumnIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleRows.length < rows.length && (
        <button
          className="spreadsheet-show-more"
          onClick={() => setVisibleCount((count) => count + PREVIEW_ROWS_PER_GROUP)}
          type="button"
        >
          Show more ({(rows.length - visibleRows.length).toLocaleString()} remaining)
        </button>
      )}
    </>
  )
}

function PostedResultEntry({ post, onSelect, onDelete, isDeleting, isSelected }) {
  return (
    <article className="spreadsheet-history-entry">
      <div className="spreadsheet-history-heading">
        <button
          aria-pressed={isSelected}
          className="spreadsheet-history-toggle"
          onClick={() => onSelect(post)}
          type="button"
        >
          <span>
            <strong>{new Date(post.savedAt).toLocaleString()}</strong>
            <span className="spreadsheet-history-file">{post.fileName}</span>
          </span>
          <span>{isSelected ? 'Showing results' : 'View results'} · {post.totalPackages.toLocaleString()} packages</span>
        </button>
        <button
          aria-label={`Delete results from ${new Date(post.savedAt).toLocaleString()}`}
          className="spreadsheet-history-delete"
          disabled={isDeleting}
          onClick={() => onDelete(post.id)}
          type="button"
        >
          Delete
        </button>
      </div>
    </article>
  )
}

function SpreadsheetTool() {
  const fileInputRef = useRef(null)
  const [initialHistorySetup] = useState(getInitialHistorySetup)
  const [historyCode, setHistoryCode] = useState(initialHistorySetup.code)
  const [historyCodeDraft, setHistoryCodeDraft] = useState(initialHistorySetup.code)
  const [pairingPin, setPairingPin] = useState(getInitialPairingPin)
  const [pairingRequests, setPairingRequests] = useState([])
  const [pendingPairing, setPendingPairing] = useState(getInitialPendingPairing)
  const [joinPin, setJoinPin] = useState('')
  const [pairingError, setPairingError] = useState('')
  const [pairingMessage, setPairingMessage] = useState('')
  const [isStartingPairing, setIsStartingPairing] = useState(false)
  const [isJoiningPairing, setIsJoiningPairing] = useState(false)
  const [activePairingRequest, setActivePairingRequest] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyCodeError, setHistoryCodeError] = useState(initialHistorySetup.error)
  const [historyCodeMessage, setHistoryCodeMessage] = useState('')
  const [file, setFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [records, setRecords] = useState([])
  const [idColumnIndex, setIdColumnIndex] = useState(-1)
  const [scanColumnIndex, setScanColumnIndex] = useState(-1)
  const [filteredGroups, setFilteredGroups] = useState(null)
  const [activePostedResult, setActivePostedResult] = useState(null)
  const [postedResults, setPostedResults] = useState([])
  const [message, setMessage] = useState('')
  const [filterMessage, setFilterMessage] = useState('')
  const [error, setError] = useState('')
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [postMessage, setPostMessage] = useState('')
  const [postError, setPostError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [isPosting, setIsPosting] = useState(false)
  const [isDeletingPost, setIsDeletingPost] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!historyCode) return undefined

    let isCurrent = true
    requestPostedResults(historyCode)
      .then((data) => {
        if (!isCurrent) return
        setPostedResults(data.map(mapPostedResult))
      })
      .catch((loadError) => {
        if (isCurrent) setHistoryError(`Could not load posted results: ${loadError.message}`)
      })
      .finally(() => {
        if (isCurrent) setHistoryLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [historyCode])

  useEffect(() => {
    if (!pairingPin || !historyCode) return undefined

    let isCurrent = true
    let timeoutId
    const loadRequests = async () => {
      try {
        const requests = await requestHistoryPairing({
          action: 'requests',
          code: historyCode,
          body: { action: 'requests', pin: pairingPin.pin },
        })
        if (isCurrent) setPairingRequests(requests)
      } catch (requestError) {
        if (isCurrent) setPairingError(requestError.message)
      }
      if (isCurrent && new Date(pairingPin.expiresAt) > new Date()) {
        timeoutId = window.setTimeout(loadRequests, 2000)
      } else if (isCurrent) {
        localStorage.removeItem(HISTORY_PAIRING_PIN_KEY)
        setPairingPin(null)
        setPairingRequests([])
      }
    }

    loadRequests()
    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [historyCode, pairingPin])

  useEffect(() => {
    if (!pendingPairing) return undefined

    let isCurrent = true
    let timeoutId
    const checkPairing = async () => {
      try {
        const { status } = await requestHistoryPairing({
          action: 'status',
          requestToken: pendingPairing.requestToken,
        })
        if (!isCurrent) return
        if (status === 'approved') {
          let storageError = false
          try {
            localStorage.setItem(HISTORY_CODE_STORAGE_KEY, pendingPairing.code)
            localStorage.removeItem(HISTORY_PAIRING_PENDING_KEY)
          } catch {
            storageError = true
          }
          setHistoryCode(pendingPairing.code)
          setHistoryCodeDraft(pendingPairing.code)
          setHistoryLoading(true)
          setPostedResults([])
          setActivePostedResult(null)
          setHistoryError('')
          setPendingPairing(null)
          setPairingMessage(storageError
            ? 'Device paired. Copy the history code shown above now; this browser could not save it for next time.'
            : 'Device paired. Your private cloud history is now available here.')
          if (storageError) setPairingError('Browser storage is unavailable. Use “Copy current code” to keep this device connected.')
          return
        }
        if (status === 'rejected' || status === 'expired') {
          try {
            localStorage.removeItem(HISTORY_PAIRING_PENDING_KEY)
          } catch {
            setPairingError('Could not clear the expired pairing request from browser storage.')
          }
          setPendingPairing(null)
          setPairingError(
            status === 'rejected'
              ? 'The other device declined this pairing request.'
              : 'This pairing PIN expired. Ask the other device to create a new one.',
          )
          return
        }
      } catch (requestError) {
        if (isCurrent) setPairingError(requestError.message)
      }
      if (isCurrent) timeoutId = window.setTimeout(checkPairing, 2000)
    }

    checkPairing()
    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [pendingPairing])

  async function handleStartPairing() {
    setPairingError('')
    setPairingMessage('')
    setIsStartingPairing(true)
    try {
      const result = await requestHistoryPairing({ action: 'start', code: historyCode, body: { action: 'start' } })
      const nextPin = { pin: result.pin, expiresAt: result.expires_at }
      setPairingRequests([])
      setPairingPin(nextPin)
      try {
        localStorage.setItem(HISTORY_PAIRING_PIN_KEY, JSON.stringify(nextPin))
      } catch {
        setPairingError('PIN created, but browser storage is unavailable. Keep this page open until pairing is complete.')
      }
      setPairingMessage('PIN created. It expires in five minutes and requires your approval on this device.')
    } catch (requestError) {
      setPairingError(requestError.message)
    } finally {
      setIsStartingPairing(false)
    }
  }

  async function handleJoinPairing(event) {
    event.preventDefault()
    setPairingError('')
    setPairingMessage('')
    if (!PIN_PATTERN.test(joinPin)) {
      setPairingError('Enter the four-digit PIN shown on the device with your history.')
      return
    }

    setIsJoiningPairing(true)
    try {
      const code = createHistoryCode()
      const verificationCode = createFourDigitCode()
      const keyHash = await hashHistoryCode(code)
      const result = await requestHistoryPairing({
        action: 'request',
        body: {
          action: 'request',
          pin: joinPin,
          new_key_hash: keyHash,
          verification_code: verificationCode,
        },
      })
      const pending = { code, requestToken: result.request_token, verificationCode }
      setPendingPairing(pending)
      try {
        localStorage.setItem(HISTORY_PAIRING_PENDING_KEY, JSON.stringify(pending))
      } catch {
        setPairingError('Pairing request sent, but browser storage is unavailable. Keep this page open until it is approved.')
      }
      setPairingMessage('Compare the confirmation number on both devices, then approve this request on the original device.')
    } catch (requestError) {
      setPairingError(requestError.message)
    } finally {
      setIsJoiningPairing(false)
    }
  }

  async function handlePairingDecision(pairingRequest, action) {
    setPairingError('')
    setActivePairingRequest(pairingRequest.id)
    try {
      await requestHistoryPairing({
        action,
        code: historyCode,
        body: {
          action,
          pin: pairingPin.pin,
          request_id: pairingRequest.id,
        },
      })
      setPairingRequests((requests) => requests.filter((request) => request.id !== pairingRequest.id))
      if (action === 'approve') {
        setPairingMessage('Device approved. It can now access this history.')
      }
    } catch (requestError) {
      setPairingError(requestError.message)
    } finally {
      setActivePairingRequest('')
    }
  }

  function handleApplyHistoryCode(event) {
    event.preventDefault()
    setHistoryCodeError('')
    setHistoryCodeMessage('')
    if (!HISTORY_CODE_PATTERN.test(historyCodeDraft)) {
      setHistoryCodeError('Enter the complete history access code from the other device.')
      return
    }
    try {
      localStorage.setItem(HISTORY_CODE_STORAGE_KEY, historyCodeDraft)
      if (historyCodeDraft !== historyCode) {
        setHistoryLoading(true)
        setPostedResults([])
        setActivePostedResult(null)
        setHistoryError('')
      }
      setHistoryCode(historyCodeDraft)
      setHistoryCodeMessage('This device is now using that private history code.')
    } catch {
      setHistoryCodeError('Could not save the history code in this browser. Enable local storage and try again.')
    }
  }

  async function copyHistoryCode() {
    setHistoryCodeError('')
    setHistoryCodeMessage('')
    try {
      await navigator.clipboard.writeText(historyCode)
      setHistoryCodeMessage('History code copied. Keep it private and use it on your other devices.')
    } catch {
      setHistoryCodeError('Could not copy the history code. Select and copy it manually.')
    }
  }

  async function handleFileChange(event) {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) return

    const currentRequestId = ++requestId.current
    setFile(null)
    setHeaders([])
    setRecords([])
    setIdColumnIndex(-1)
    setScanColumnIndex(-1)
    setFilteredGroups(null)
    setActivePostedResult(null)
    setError('')
    setMessage('')
    setFilterMessage('')
    setDownloadMessage('')
    setDownloadError('')
    setPostMessage('')
    setPostError('')

    if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
      setError('Choose an .xlsx file. .xls files are not supported.')
      return
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('Choose an Excel workbook smaller than 20 MB.')
      return
    }

    try {
      setMessage('Reading file…')
      const rows = await readSheet(selectedFile, 1)
      if (currentRequestId !== requestId.current) return
      const data = getWorksheetData(rows)
      if (data.columnCount !== DISPLAY_COLUMNS) {
        setError(`This file needs ${DISPLAY_COLUMNS} columns. Found ${data.columnCount}.`)
        setMessage('')
        return
      }

      const detectedIdColumnIndex = findIdColumnIndex(data.headers, data.records)
      if (detectedIdColumnIndex < 0) {
        setError('Could not find the ID column. Add an ID header or use IDs like XXX-XXXX.')
        setMessage('')
        return
      }

      setFile(selectedFile)
      setHeaders(data.headers)
      setRecords(data.records)
      setIdColumnIndex(detectedIdColumnIndex)
      setScanColumnIndex(data.headers.findIndex(
        (header) => header.trim().toLocaleLowerCase() === '1st scan',
      ))
      if (data.headers.length) {
        const limits = [
          data.rowsTruncated && `limited to the first ${MAX_ROWS.toLocaleString()} rows`,
        ].filter(Boolean)
        const limitMessage = limits.length ? ` (${limits.join('; ')})` : ''
        setMessage(`Loaded ${data.records.length.toLocaleString()} rows${limitMessage}.`)
      } else {
        setMessage('No spreadsheet data found.')
      }
    } catch {
      if (currentRequestId === requestId.current) {
        setError('Could not open this file. Check that it is a valid .xlsx workbook.')
        setMessage('')
      }
    }
  }

  function clearCurrentData() {
    requestId.current += 1
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFile(null)
    setHeaders([])
    setRecords([])
    setIdColumnIndex(-1)
    setScanColumnIndex(-1)
    setFilteredGroups(null)
    setActivePostedResult(null)
    setMessage('Uploaded workbook and package sections cleared.')
    setFilterMessage('')
    setError('')
    setDownloadMessage('')
    setDownloadError('')
    setPostMessage('')
    setPostError('')
  }

  function filterRecords() {
    const groups = Object.fromEntries(GROUP_STARTS.map((start) => [start, []]))
    let ungroupedCount = 0
    let missingTimestampCount = 0

    for (const row of records) {
      const groupStart = getGroupStart(row[idColumnIndex])
      if (groupStart === null) {
        ungroupedCount += 1
      } else {
        groups[groupStart].push(row)
        if (scanColumnIndex >= 0 && getTimestampValue(row[scanColumnIndex]) === null) {
          missingTimestampCount += 1
        }
      }
    }

    if (scanColumnIndex >= 0) {
      for (const rows of Object.values(groups)) {
        rows.sort((left, right) => {
          const leftTimestamp = getTimestampValue(left[scanColumnIndex])
          const rightTimestamp = getTimestampValue(right[scanColumnIndex])
          if (leftTimestamp === null) return rightTimestamp === null ? 0 : 1
          if (rightTimestamp === null) return -1
          return leftTimestamp - rightTimestamp
        })
      }
    }

    setFilteredGroups(groups)
    setActivePostedResult(null)
    setDownloadMessage('')
    setDownloadError('')
    setPostMessage('')
    setPostError('')
    const notices = []
    if (ungroupedCount) {
      notices.push(`Skipped ${ungroupedCount.toLocaleString()} ${ungroupedCount === 1 ? 'row' : 'rows'}: ID must be XXX-XXXX and start with 100–899.`)
    }
    if (scanColumnIndex < 0) {
      notices.push('No “1st scan” column; rows keep their original order.')
    } else if (missingTimestampCount) {
      notices.push(missingTimestampCount === 1
        ? '1 row has no valid “1st scan” time; it appears last.'
        : `${missingTimestampCount.toLocaleString()} rows have no valid “1st scan” time; they appear last.`)
    }
    setFilterMessage(notices.join(' '))
  }

  function showPostedResult(post) {
    requestId.current += 1
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFile(null)
    setHeaders([...post.headers])
    setRecords([])
    setIdColumnIndex(post.idColumnIndex)
    setScanColumnIndex(post.headers.findIndex(
      (header) => header.trim().toLocaleLowerCase() === '1st scan',
    ))
    setFilteredGroups(post.groups)
    setActivePostedResult(post)
    setMessage('')
    setFilterMessage('')
    setError('')
    setDownloadMessage('')
    setDownloadError('')
    setPostMessage('')
    setPostError('')
  }

  async function postResults() {
    if (!filteredGroups || !historyCode || isPosting) return

    setIsPosting(true)
    setPostMessage('')
    setPostError('')
    const post = {
      file_name: file?.name || activePostedResult?.fileName || 'Uploaded workbook',
      headers,
      id_column_index: idColumnIndex,
      groups: Object.fromEntries(GROUP_STARTS.map((start) => [
        start,
        filteredGroups[start].map((row) => row.map(
          (value) => value instanceof Date ? value.toISOString() : value,
        )),
      ])),
      total_packages: GROUP_STARTS.reduce((total, start) => total + filteredGroups[start].length, 0),
    }

    try {
      const data = await requestPostedResults(historyCode, { method: 'POST', body: post })
      const savedPost = mapPostedResult(data)
      setPostedResults((current) => [savedPost, ...current])
      setHistoryError('')
      setPostMessage('Results saved to your cloud history.')
    } catch (saveError) {
      setPostError(`Could not save results: ${saveError.message}`)
    } finally {
      setIsPosting(false)
    }
  }

  async function deleteResult(postId) {
    if (!historyCode || isDeletingPost) return

    setIsDeletingPost(true)
    setHistoryError('')
    try {
      await requestPostedResults(historyCode, { method: 'DELETE', id: postId })
      setPostedResults((current) => current.filter((post) => post.id !== postId))
      if (activePostedResult?.id === postId) setActivePostedResult(null)
    } catch (deleteError) {
      setHistoryError(`Could not delete posted results: ${deleteError.message}`)
    } finally {
      setIsDeletingPost(false)
    }
  }

  async function downloadAllGroups() {
    setDownloadMessage('')
    setDownloadError('')
    try {
      const svg = createAllGroupsImage(filteredGroups, headers, idColumnIndex)
      const png = await renderPng(svg)
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url
      link.download = 'missing-packages-all-sections.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloadMessage('Downloading one PNG image with all 8 sections.')
    } catch (downloadError) {
      setDownloadError(downloadError instanceof Error
        ? downloadError.message
        : 'Could not create the PNG image. Please try again.')
    }
  }

  return (
    <div className="spreadsheet-tool">
      <p className="eyebrow">EXCEL FILTER</p>
      <h1 id="spreadsheet-tool-title">Missing Packages Filter</h1>
      <p className="description">
        Upload your file, then filter packages by ID.
      </p>

      <section aria-labelledby="spreadsheet-history-code-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">☁</span>
          <div>
            <h2 id="spreadsheet-history-code-title">Private cloud history</h2>
            <p>No account or sign-in required. Your history code connects your devices.</p>
          </div>
        </div>
        <form className="spreadsheet-auth-form" onSubmit={handleApplyHistoryCode}>
          <label className="spreadsheet-auth-field">
            History access code
            <input
              autoComplete="off"
              onChange={(event) => setHistoryCodeDraft(event.target.value.trim())}
              required
              spellCheck="false"
              type="text"
              value={historyCodeDraft}
            />
          </label>
          <div className="spreadsheet-auth-actions">
            <button className="spreadsheet-filter-button" disabled={!historyCode} type="submit">
              Use code
            </button>
            <button
              className="spreadsheet-auth-mode"
              disabled={!historyCode}
              onClick={copyHistoryCode}
              type="button"
            >
              Copy current code
            </button>
          </div>
        </form>
        <p className="spreadsheet-status">
          Keep this code private. Anyone who has it can view and delete your saved results. Use the same code on each device.
        </p>
        <div className="spreadsheet-pairing">
          <div className="spreadsheet-pairing-heading">
            <h3>Pair another device with a 4-digit PIN</h3>
            <p>The PIN expires after five minutes. Approve the request here after checking the matching confirmation number on both devices.</p>
          </div>
          <button
            className="spreadsheet-filter-button"
            disabled={!historyCode || isStartingPairing || Boolean(pendingPairing)}
            onClick={handleStartPairing}
            type="button"
          >
            {isStartingPairing ? 'Creating PIN…' : pairingPin ? 'Create a new PIN' : 'Create pairing PIN'}
          </button>
          {pairingPin && (
            <div className="spreadsheet-pairing-pin" role="status">
              <strong>{pairingPin.pin}</strong>
              <span>Expires {new Date(pairingPin.expiresAt).toLocaleTimeString()}</span>
            </div>
          )}
          {pairingRequests.map((pairingRequest) => (
            <div className="spreadsheet-pairing-request" key={pairingRequest.id}>
              <p>
                Pairing request · confirmation number <strong>{pairingRequest.verification_code}</strong>
              </p>
              <div className="spreadsheet-auth-actions">
                <button
                  className="spreadsheet-filter-button"
                  disabled={Boolean(activePairingRequest)}
                  onClick={() => handlePairingDecision(pairingRequest, 'approve')}
                  type="button"
                >
                  {activePairingRequest === pairingRequest.id ? 'Saving…' : 'Approve device'}
                </button>
                <button
                  className="spreadsheet-clear-button"
                  disabled={Boolean(activePairingRequest)}
                  onClick={() => handlePairingDecision(pairingRequest, 'reject')}
                  type="button"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
          <form className="spreadsheet-pairing-join" onSubmit={handleJoinPairing}>
            <label className="spreadsheet-auth-field">
              Pair this device with a PIN
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setJoinPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                pattern="[0-9]{4}"
                placeholder="4-digit PIN"
                required
                type="text"
                value={joinPin}
              />
            </label>
            <button
              className="spreadsheet-download-button"
              disabled={isJoiningPairing || Boolean(pendingPairing)}
              type="submit"
            >
              {isJoiningPairing ? 'Requesting…' : 'Request pairing'}
            </button>
          </form>
          {pendingPairing && (
            <p className="spreadsheet-status" role="status">
              Waiting for approval. Confirm number <strong>{pendingPairing.verificationCode}</strong> matches the request shown on the original device.
            </p>
          )}
        </div>
        {historyLoading && <p className="spreadsheet-status" role="status">Loading cloud history…</p>}
        {historyCodeMessage && <p className="spreadsheet-status" role="status">{historyCodeMessage}</p>}
        {historyCodeError && <p className="spreadsheet-error" role="alert">{historyCodeError}</p>}
        {pairingMessage && <p className="spreadsheet-status" role="status">{pairingMessage}</p>}
        {pairingError && <p className="spreadsheet-error" role="alert">{pairingError}</p>}
      </section>

      <section aria-labelledby="spreadsheet-upload-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">01</span>
          <div>
            <h2 id="spreadsheet-upload-title">Upload Excel file</h2>
            <p>Use a three-column .xlsx file. Posted results are saved to your private cloud history.</p>
          </div>
        </div>
        <label className="spreadsheet-upload">
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <span aria-hidden="true" className="spreadsheet-upload-icon">↑</span>
          <span className="spreadsheet-upload-copy">
            <strong>{file ? 'Choose a different workbook' : 'Choose an .xlsx file'}</strong>
            <span>.xlsx · max 20 MB</span>
          </span>
          <span className="spreadsheet-upload-action">Browse files</span>
        </label>

        {file && (
          <div className="spreadsheet-file-details">
            <span className="spreadsheet-file-name">{file.name}</span>
            <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
        )}

        {message && <p className="spreadsheet-status" role="status">{message}</p>}
        {error && <p className="spreadsheet-error" role="alert">{error}</p>}
      </section>

      <section aria-labelledby="spreadsheet-results-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">02</span>
          <div>
            <h2 id="spreadsheet-results-title">Package results</h2>
            <p>{idColumnIndex >= 0
              ? `Grouped by “${headers[idColumnIndex]}”${scanColumnIndex >= 0 ? ' · sorted by “1st scan”.' : '.'}`
              : 'Grouped by the ID prefix into 100s–800s.'}</p>
          </div>
        </div>

        {filterMessage && <p className="spreadsheet-status" role="status">{filterMessage}</p>}
        {activePostedResult && (
          <p className="spreadsheet-status" role="status">
            Showing saved results from {new Date(activePostedResult.savedAt).toLocaleString()}.
          </p>
        )}
        <div className="spreadsheet-filter-actions">
          <button
            className="spreadsheet-filter-button"
            disabled={headers.length !== DISPLAY_COLUMNS || records.length === 0}
            onClick={filterRecords}
            type="button"
          >
            Filter
          </button>
          <button
            className="spreadsheet-clear-button"
            onClick={clearCurrentData}
            type="button"
          >
            Clear data
          </button>
          {filteredGroups && (
            <button
              className="spreadsheet-download-button"
              disabled={!historyCode || isPosting}
              onClick={postResults}
              type="button"
            >
              {isPosting ? 'Posting…' : 'Post results'}
            </button>
          )}
          {filteredGroups && (
            <button
              className="spreadsheet-download-button"
              onClick={downloadAllGroups}
              type="button"
            >
              Download all packages (PNG)
            </button>
          )}
        </div>
        {downloadMessage && <p className="spreadsheet-status" role="status">{downloadMessage}</p>}
        {downloadError && <p className="spreadsheet-error" role="alert">{downloadError}</p>}
        {postMessage && <p className="spreadsheet-status" role="status">{postMessage}</p>}
        {postError && <p className="spreadsheet-error" role="alert">{postError}</p>}

        {filteredGroups && (
          <div className="spreadsheet-groups">
            {GROUP_STARTS.map((groupStart) => {
              const rows = filteredGroups[groupStart]

              return (
                <section
                  aria-labelledby={`spreadsheet-group-${groupStart}`}
                  className="spreadsheet-group"
                  key={groupStart}
                >
                  <div className="spreadsheet-group-heading">
                    <h3 id={`spreadsheet-group-${groupStart}`}>{groupStart}s</h3>
                    <span>{rows.length.toLocaleString()} {rows.length === 1 ? 'row' : 'rows'}</span>
                  </div>
                  <PackageRows
                    headers={headers}
                    idColumnIndex={idColumnIndex}
                    rows={rows}
                  />
                </section>
              )
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="spreadsheet-history-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">03</span>
          <div>
            <h2 id="spreadsheet-history-title">Posted results history</h2>
            <p>Saved results are available on devices using the same history code.</p>
          </div>
        </div>
        {historyError && <p className="spreadsheet-error" role="alert">{historyError}</p>}
        {!historyError && !historyLoading && postedResults.length === 0 ? (
          <p className="spreadsheet-empty">
            No posted results yet.
          </p>
        ) : (
          postedResults.length > 0 && (
            <div className="spreadsheet-history-list">
              {postedResults.map((post) => (
                <PostedResultEntry
                  isDeleting={isDeletingPost}
                  isSelected={activePostedResult?.id === post.id}
                  key={post.id}
                  onDelete={deleteResult}
                  onSelect={showPostedResult}
                  post={post}
                />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  )
}

export default SpreadsheetTool
