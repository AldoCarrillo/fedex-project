import { useRef, useState } from 'react'
import { readSheet } from 'read-excel-file/browser'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_ROWS = 50000
const DISPLAY_COLUMNS = 3
const PREVIEW_ROWS_PER_GROUP = 100
const GROUP_STARTS = [100, 200, 300, 400, 500, 600, 700, 800]

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

function SpreadsheetTool() {
  const [file, setFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [records, setRecords] = useState([])
  const [idColumnIndex, setIdColumnIndex] = useState(-1)
  const [scanColumnIndex, setScanColumnIndex] = useState(-1)
  const [filteredGroups, setFilteredGroups] = useState(null)
  const [visibleCounts, setVisibleCounts] = useState({})
  const [message, setMessage] = useState('')
  const [filterMessage, setFilterMessage] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef(0)

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
    setVisibleCounts({})
    setError('')
    setMessage('')
    setFilterMessage('')

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
    setVisibleCounts(Object.fromEntries(GROUP_STARTS.map((start) => [start, PREVIEW_ROWS_PER_GROUP])))
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

  return (
    <div className="spreadsheet-tool">
      <p className="eyebrow">EXCEL FILTER</p>
      <h1 id="spreadsheet-tool-title">Missing Packages Filter</h1>
      <p className="description">
        Upload your file, then filter packages by ID.
      </p>

      <section aria-labelledby="spreadsheet-upload-title" className="spreadsheet-panel">
        <div className="spreadsheet-panel-heading">
          <span className="spreadsheet-step">01</span>
          <div>
            <h2 id="spreadsheet-upload-title">Upload Excel file</h2>
            <p>Use a three-column .xlsx file. Your data stays on this device.</p>
          </div>
        </div>
        <label className="spreadsheet-upload">
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
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
        <button
          className="spreadsheet-filter-button"
          disabled={headers.length !== DISPLAY_COLUMNS || records.length === 0}
          onClick={filterRecords}
          type="button"
        >
          Filter
        </button>

        {filteredGroups && (
          <div className="spreadsheet-groups">
            {GROUP_STARTS.map((groupStart) => {
              const rows = filteredGroups[groupStart]
              const visibleRows = rows.slice(0, visibleCounts[groupStart] || PREVIEW_ROWS_PER_GROUP)

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
                  {rows.length > 0 ? (
                    <>
                      {rows.length > PREVIEW_ROWS_PER_GROUP && (
                        <p className="spreadsheet-preview-note">
                          Showing the first {PREVIEW_ROWS_PER_GROUP} rows in this group.
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
                          onClick={() => setVisibleCounts((current) => ({
                            ...current,
                            [groupStart]: (current[groupStart] || PREVIEW_ROWS_PER_GROUP)
                              + PREVIEW_ROWS_PER_GROUP,
                          }))}
                          type="button"
                        >
                          Show more ({(rows.length - visibleRows.length).toLocaleString()} remaining)
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="spreadsheet-empty">No Packages</p>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default SpreadsheetTool
