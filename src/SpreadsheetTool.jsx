import { useEffect, useRef, useState } from 'react'
import { readSheet } from 'read-excel-file/browser'
import { isSupabaseConfigured, supabase } from './supabase.js'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_ROWS = 50000
const DISPLAY_COLUMNS = 3
const PREVIEW_ROWS_PER_GROUP = 100
const GROUP_STARTS = [100, 200, 300, 400, 500, 600, 700, 800]
const MAX_IMAGE_DIMENSION = 32767
function getSupabaseError(error, fallback) {
  return error instanceof Error ? error.message : fallback
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
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authMode, setAuthMode] = useState('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
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
    if (!supabase) return undefined

    let isCurrent = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isCurrent) return
      const nextUser = session?.user || null
      setUser(nextUser)
      setHistoryError('')
      if (!nextUser) {
        setPostedResults([])
        setActivePostedResult(null)
      }
    })

    supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!isCurrent) return
        if (sessionError) setAuthError(sessionError.message)
        setUser(data.session?.user || null)
        setHistoryError('')
        setAuthLoading(false)
      })
      .catch((sessionError) => {
        if (isCurrent) {
          setAuthError(getSupabaseError(sessionError, 'Could not check your sign-in status.'))
          setAuthLoading(false)
        }
      })

    return () => {
      isCurrent = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user || !supabase) return undefined

    let isCurrent = true
    supabase
      .from('package_posts')
      .select('id, saved_at, file_name, headers, id_column_index, groups, total_packages')
      .order('saved_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!isCurrent) return
        if (loadError) throw loadError
        setPostedResults(data.map((row) => ({
          id: row.id,
          savedAt: row.saved_at,
          fileName: row.file_name,
          headers: row.headers,
          idColumnIndex: row.id_column_index,
          groups: row.groups,
          totalPackages: row.total_packages,
        })))
      })
      .catch((loadError) => {
        if (isCurrent) setHistoryError(
          `Could not load posted results: ${getSupabaseError(loadError, 'Please try again.')}`,
        )
      })

    return () => {
      isCurrent = false
    }
  }, [authLoading, user])

  async function handleAuthSubmit(event) {
    event.preventDefault()
    if (!supabase) return

    setAuthError('')
    setAuthMessage('')
    try {
      const result = authMode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        : await supabase.auth.signUp({ email: authEmail, password: authPassword })

      if (result.error) {
        setAuthError(result.error.message)
      } else if (authMode === 'sign-up' && !result.data.session) {
        setAuthMessage('Check your email to confirm your account, then sign in.')
      } else {
        setAuthPassword('')
        setAuthMessage(authMode === 'sign-up' ? 'Account created and signed in.' : 'Signed in.')
      }
    } catch (authRequestError) {
      setAuthError(getSupabaseError(authRequestError, 'Could not contact the sign-in service.'))
    }
  }

  async function handleSignOut() {
    if (!supabase) return
    setAuthError('')
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        setAuthError(signOutError.message)
        return
      }
      clearCurrentData()
      setAuthMessage('Signed out.')
    } catch (signOutError) {
      setAuthError(getSupabaseError(signOutError, 'Could not sign out.'))
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
    if (!filteredGroups || !user || !supabase || isPosting) return

    setIsPosting(true)
    setPostMessage('')
    setPostError('')
    const post = {
      user_id: user.id,
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
      const { data, error: saveError } = await supabase
        .from('package_posts')
        .insert(post)
        .select('id, saved_at, file_name, headers, id_column_index, groups, total_packages')
        .single()
      if (saveError) throw saveError
      const savedPost = {
        id: data.id,
        savedAt: data.saved_at,
        fileName: data.file_name,
        headers: data.headers,
        idColumnIndex: data.id_column_index,
        groups: data.groups,
        totalPackages: data.total_packages,
      }
      setPostedResults((current) => [savedPost, ...current])
      setHistoryError('')
      setPostMessage('Results saved to your cloud history.')
    } catch (saveError) {
      setPostError(`Could not save results: ${getSupabaseError(saveError, 'Please try again.')}`)
    } finally {
      setIsPosting(false)
    }
  }

  async function deleteResult(postId) {
    if (!supabase || isDeletingPost) return

    setIsDeletingPost(true)
    setHistoryError('')
    try {
      const { data, error: deleteError } = await supabase
        .from('package_posts')
        .delete()
        .eq('id', postId)
        .select('id')
        .single()
      if (deleteError) throw deleteError
      if (!data) throw new Error('The saved result was not found.')
      setPostedResults((current) => current.filter((post) => post.id !== postId))
      if (activePostedResult?.id === postId) setActivePostedResult(null)
    } catch (deleteError) {
      setHistoryError(`Could not delete posted results: ${getSupabaseError(deleteError, 'Please try again.')}`)
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

      <section aria-labelledby="spreadsheet-account-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">☁</span>
          <div>
            <h2 id="spreadsheet-account-title">Cloud history</h2>
            <p>Sign in to save and access posted results from any device.</p>
          </div>
        </div>
        {!isSupabaseConfigured ? (
          <p className="spreadsheet-error" role="alert">
            Cloud history is not configured yet. Add the Supabase project URL and publishable key, then apply the database migration.
          </p>
        ) : authLoading ? (
          <p className="spreadsheet-status" role="status">Checking your sign-in…</p>
        ) : user ? (
          <div className="spreadsheet-account-row">
            <p className="spreadsheet-status">Signed in as {user.email}</p>
            <button
              className="spreadsheet-clear-button"
              onClick={handleSignOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        ) : (
          <form className="spreadsheet-auth-form" onSubmit={handleAuthSubmit}>
            <label className="spreadsheet-auth-field">
              Email
              <input
                autoComplete="email"
                onChange={(event) => setAuthEmail(event.target.value)}
                required
                type="email"
                value={authEmail}
              />
            </label>
            <label className="spreadsheet-auth-field">
              Password
              <input
                autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                minLength={6}
                onChange={(event) => setAuthPassword(event.target.value)}
                required
                type="password"
                value={authPassword}
              />
            </label>
            <div className="spreadsheet-auth-actions">
              <button className="spreadsheet-filter-button" type="submit">
                {authMode === 'sign-in' ? 'Sign in' : 'Create account'}
              </button>
              <button
                className="spreadsheet-auth-mode"
                onClick={() => {
                  setAuthMode((mode) => mode === 'sign-in' ? 'sign-up' : 'sign-in')
                  setAuthError('')
                  setAuthMessage('')
                }}
                type="button"
              >
                {authMode === 'sign-in' ? 'Create an account' : 'Already registered? Sign in'}
              </button>
            </div>
          </form>
        )}
        {authMessage && <p className="spreadsheet-status" role="status">{authMessage}</p>}
        {authError && <p className="spreadsheet-error" role="alert">{authError}</p>}
      </section>

      <section aria-labelledby="spreadsheet-upload-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">01</span>
          <div>
            <h2 id="spreadsheet-upload-title">Upload Excel file</h2>
            <p>Use a three-column .xlsx file. Posting saves results to your account.</p>
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
              disabled={!user || isPosting}
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
            <p>Saved to your account and available across devices.</p>
          </div>
        </div>
        {historyError && <p className="spreadsheet-error" role="alert">{historyError}</p>}
        {!historyError && postedResults.length === 0 ? (
          <p className="spreadsheet-empty">
            {!isSupabaseConfigured
              ? 'Configure cloud history to save results across devices.'
              : !user
                ? 'Sign in to view your posted results.'
                : 'No posted results yet.'}
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
