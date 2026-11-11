import { useRef, useState } from 'react'

const initialAddress = {
  streetAddress: '',
  apartment: '',
  city: '',
  state: 'CA',
  postalCode: '',
}

const stateOptions = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

function capitalizeWordInitials(value) {
  return value.replace(/(^|[\s'-])([a-z])/g, (match, separator, letter) => (
    `${separator}${letter.toUpperCase()}`
  ))
}

function parseAddressText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const stateCodes = new Set(stateOptions.map(([code]) => code))
  const parsed = {}
  const cityStateZipLine = lines.findIndex((line) => {
    const match = line.match(/^(.+?)[,\s]+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i)
    return match && stateCodes.has(match[2].toUpperCase())
  })

  if (cityStateZipLine >= 0) {
    const match = lines[cityStateZipLine].match(/^(.+?)[,\s]+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i)
    if (match && stateCodes.has(match[2].toUpperCase())) {
      parsed.city = capitalizeWordInitials(match[1].replace(/,\s*$/, '').trim())
      parsed.state = match[2].toUpperCase()
      parsed.postalCode = match[3]
    }

    const streetLines = lines.slice(0, cityStateZipLine)
    if (streetLines.length > 0) parsed.streetAddress = capitalizeWordInitials(streetLines[0])
    if (streetLines.length > 1) parsed.apartment = capitalizeWordInitials(streetLines[1])
  } else {
    const postalLine = lines.findIndex((line) => /^\d{5}(?:-\d{4})?$/.test(line))
    if (postalLine >= 0) {
      parsed.postalCode = lines[postalLine]
      const stateLine = lines[postalLine - 1]?.match(/^(.+?)[,\s]+([A-Z]{2})$/i)
      if (stateLine && stateCodes.has(stateLine[2].toUpperCase())) {
        parsed.city = capitalizeWordInitials(stateLine[1].replace(/,\s*$/, '').trim())
        parsed.state = stateLine[2].toUpperCase()
        if (postalLine > 1) parsed.streetAddress = capitalizeWordInitials(lines[0])
      }
    } else if (lines.length > 0) {
      parsed.streetAddress = capitalizeWordInitials(lines[0])
      if (lines.length > 1) parsed.city = capitalizeWordInitials(lines[1])
    }
  }

  return parsed
}

const citiesByState = {
  AL: ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville', 'Tuscaloosa'],
  AK: ['Anchorage', 'Fairbanks', 'Juneau', 'Wasilla', 'Sitka'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale'],
  AR: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro'],
  CA: ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Sacramento', 'Fresno', 'Oakland'],
  CO: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood'],
  CT: ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury'],
  DE: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna'],
  DC: ['Washington'],
  FL: ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Tallahassee'],
  GA: ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens'],
  HI: ['Honolulu', 'Hilo', 'Kailua', 'Kapolei', 'Kaneohe'],
  ID: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello'],
  IL: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford', 'Springfield'],
  IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel'],
  IA: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City'],
  KS: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe'],
  KY: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington'],
  LA: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles'],
  ME: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn'],
  MD: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Annapolis'],
  MA: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell'],
  MI: ['Detroit', 'Grand Rapids', 'Warren', 'Ann Arbor', 'Lansing'],
  MN: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington'],
  MS: ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi'],
  MO: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence'],
  MT: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte'],
  NE: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney'],
  NV: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks'],
  NH: ['Manchester', 'Nashua', 'Concord', 'Dover', 'Rochester'],
  NJ: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton'],
  NM: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell'],
  NY: ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem'],
  ND: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton'],
  OK: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond'],
  OR: ['Portland', 'Eugene', 'Salem', 'Gresham', 'Bend'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Erie', 'Harrisburg'],
  RI: ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'Newport'],
  SC: ['Charleston', 'Columbia', 'North Charleston', 'Mount Pleasant', 'Greenville'],
  SD: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville'],
  TX: ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso'],
  UT: ['Salt Lake City', 'West Valley City', 'West Jordan', 'Provo', 'St. George'],
  VT: ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier'],
  VA: ['Virginia Beach', 'Chesapeake', 'Norfolk', 'Richmond', 'Newport News'],
  WA: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Olympia'],
  WV: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling'],
  WI: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine'],
  WY: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs'],
}

function AddressChecker() {
  const [address, setAddress] = useState(initialAddress)
  const [checkedAddress, setCheckedAddress] = useState(null)
  const [isCityFocused, setIsCityFocused] = useState(false)
  const [activeCityIndex, setActiveCityIndex] = useState(-1)
  const [isReadingPhoto, setIsReadingPhoto] = useState(false)
  const [photoMessage, setPhotoMessage] = useState('')
  const [photoError, setPhotoError] = useState('')
  const photoInputRef = useRef(null)
  const ocrGenerationRef = useRef(0)
  const citySuggestions = address.state
    ? (citiesByState[address.state] || [])
      .filter((city) => city.toLowerCase().includes(address.city.trim().toLowerCase()))
      .slice(0, 6)
    : []
  const showCitySuggestions = isCityFocused && address.city.trim().length > 0 && citySuggestions.length > 0

  function updateAddress(event) {
    const { name, value } = event.target
    ocrGenerationRef.current += 1
    const updatedValue = ['streetAddress', 'apartment', 'city'].includes(name)
      ? capitalizeWordInitials(value)
      : value
    setAddress((currentAddress) => ({ ...currentAddress, [name]: updatedValue }))
    setCheckedAddress(null)
    if (name === 'city') setActiveCityIndex(-1)
  }

  function chooseCity(city) {
    setAddress((currentAddress) => ({ ...currentAddress, city }))
    setCheckedAddress(null)
    setActiveCityIndex(-1)
    setIsCityFocused(false)
  }

  function handleCityKeyDown(event) {
    if (event.key === 'Escape') {
      setIsCityFocused(false)
      setActiveCityIndex(-1)
      return
    }

    if (!showCitySuggestions) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveCityIndex((index) => (index + 1) % citySuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveCityIndex((index) => (
        index <= 0 ? citySuggestions.length - 1 : index - 1
      ))
    } else if (event.key === 'Enter' && activeCityIndex >= 0) {
      event.preventDefault()
      chooseCity(citySuggestions[activeCityIndex])
    }
  }

  function checkAddress(event) {
    event.preventDefault()
    const stateName = stateOptions.find(([code]) => code === address.state)?.[1]

    setCheckedAddress({
      streetAddress: address.streetAddress.trim(),
      apartment: address.apartment.trim(),
      city: address.city.trim(),
      state: address.state,
      stateName,
      postalCode: address.postalCode.trim(),
    })
  }

  function clearAddress() {
    ocrGenerationRef.current += 1
    setAddress(initialAddress)
    setCheckedAddress(null)
    setPhotoMessage('')
    setPhotoError('')
  }

  async function readAddressPhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setPhotoMessage('')
    setPhotoError('')
    setCheckedAddress(null)

    if (!file.type.startsWith('image/')) {
      setPhotoError('Choose an image file to scan.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setPhotoError('Choose an image smaller than 10 MB.')
      return
    }

    setIsReadingPhoto(true)
    const generation = ocrGenerationRef.current

    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: ({ status }) => setPhotoMessage(status === 'recognizing text' ? 'Reading text from photo…' : 'Preparing text recognition…'),
      })

      try {
        const { data } = await worker.recognize(file)
        if (generation !== ocrGenerationRef.current) {
          setPhotoMessage('Address fields changed while the photo was being read. Your entries were kept.')
          return
        }

        const parsedAddress = parseAddressText(data.text)
        if (Object.keys(parsedAddress).length === 0) {
          setPhotoError('No address details found. Try a clearer, well-lit photo with the full address visible.')
          return
        }

        setAddress((currentAddress) => ({ ...currentAddress, ...parsedAddress }))
        setPhotoMessage('Address text loaded. Review each field for accuracy.')
      } finally {
        await worker.terminate()
      }
    } catch {
      setPhotoError('Could not read this photo. Try another clear image or enter the address manually.')
    } finally {
      setIsReadingPhoto(false)
    }
  }

  return (
    <section className="address-checker" aria-labelledby="address-checker-title">
      <p className="eyebrow">U.S. ADDRESS FORMAT CHECK</p>
      <h1 id="address-checker-title">Address Checker</h1>
      <p className="description">
        Check that a U.S. mailing address has the required details and a valid ZIP code format.
      </p>

      <form className="address-form" onSubmit={checkAddress}>
        <div className="address-form-grid">
          <label className="address-field address-field--wide" htmlFor="street-address">
            Street address
            <input
              autoComplete="address-line1"
              id="street-address"
              name="streetAddress"
              onChange={updateAddress}
              placeholder="123 Main Street"
              required
              value={address.streetAddress}
            />
          </label>

          <label className="address-field address-field--wide" htmlFor="apartment">
            Apartment, suite, etc. <span className="optional-label">Optional</span>
            <input
              autoComplete="address-line2"
              id="apartment"
              name="apartment"
              onChange={updateAddress}
              placeholder="Apt 4B"
              value={address.apartment}
            />
          </label>

          <label className="address-field" htmlFor="city">
            City
            <div className="city-autocomplete">
              <input
                aria-activedescendant={
                  activeCityIndex >= 0 ? `city-suggestion-${activeCityIndex}` : undefined
                }
                aria-autocomplete="list"
                aria-controls="city-suggestions"
                aria-expanded={showCitySuggestions}
                autoComplete="address-level2"
                id="city"
                name="city"
                onBlur={() => setIsCityFocused(false)}
                onChange={updateAddress}
                onFocus={() => setIsCityFocused(true)}
                onKeyDown={handleCityKeyDown}
                placeholder="San Diego"
                required
                role="combobox"
                value={address.city}
              />
              {showCitySuggestions && (
                <ul className="city-suggestions" id="city-suggestions" role="listbox">
                  {citySuggestions.map((city, index) => (
                    <li key={city} role="presentation">
                      <button
                        aria-selected={activeCityIndex === index}
                        className={activeCityIndex === index ? 'active' : ''}
                        id={`city-suggestion-${index}`}
                        onClick={() => chooseCity(city)}
                        onMouseDown={(event) => event.preventDefault()}
                        role="option"
                        type="button"
                      >
                        {city}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="field-hint">
              {address.state
                ? 'Start typing for common city suggestions, or enter any city.'
                : 'Select a state to see common city suggestions.'}
            </span>
          </label>

          <label className="address-field" htmlFor="state">
            State
            <select
              autoComplete="address-level1"
              id="state"
              name="state"
              onChange={updateAddress}
              required
              value={address.state}
            >
              <option value="">Select state</option>
              {stateOptions.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>

          <label className="address-field" htmlFor="postal-code">
            ZIP code
            <div className="zip-input-row">
              <input
                autoComplete="postal-code"
                id="postal-code"
                inputMode="numeric"
                name="postalCode"
                onChange={updateAddress}
                pattern="\d{5}(?:-\d{4})?"
                placeholder="38103"
                required
                title="Enter a 5-digit ZIP code or ZIP+4."
                value={address.postalCode}
              />
              <button
                aria-label="Take or choose a photo of an address"
                className="camera-button"
                disabled={isReadingPhoto}
                onClick={() => photoInputRef.current?.click()}
                title="Scan address from a photo"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M8.2 5.5 9.4 4h5.2l1.2 1.5H19A2 2 0 0 1 21 7.5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h3.2Z" />
                  <circle cx="12" cy="12.5" r="3.5" />
                </svg>
              </button>
              <input
                accept="image/*"
                capture="environment"
                className="photo-input"
                onChange={readAddressPhoto}
                ref={photoInputRef}
                tabIndex={-1}
                type="file"
              />
            </div>
          </label>
        </div>

        <p className="address-privacy">
          Format checks run in your browser. Photos are processed on this device and aren’t uploaded.
          The address-existence API check is not connected yet.
        </p>
        {isReadingPhoto && <p className="photo-status" role="status">{photoMessage}</p>}
        {!isReadingPhoto && photoMessage && <p className="photo-status" role="status">{photoMessage}</p>}
        {photoError && <p className="photo-error" role="alert">{photoError}</p>}
        <div className="address-actions">
          <button className="address-submit" type="submit">
            Check format <span aria-hidden="true">→</span>
          </button>
          <button className="address-clear-button" onClick={clearAddress} type="button">
            Clear fields
          </button>
          <button
            aria-describedby="existence-check-note"
            className="address-existence-button"
            disabled
            type="button"
          >
            Check if address exists
            <span className="coming-soon-label">Coming soon</span>
          </button>
        </div>
        <p className="existence-check-note" id="existence-check-note">
          Address existence verification will be added later using an external API.
        </p>
      </form>

      {checkedAddress && (
        <section className="address-result" aria-live="polite">
          <div className="address-result-heading">
            <span className="address-result-mark" aria-hidden="true">✓</span>
            <div>
              <h2>Address format looks good</h2>
              <p>Format check only; delivery availability isn’t verified.</p>
            </div>
          </div>

          <div className="standardized-address">
            <p>
              {checkedAddress.streetAddress}
              {checkedAddress.apartment && <><br />{checkedAddress.apartment}</>}
              <br />
              {checkedAddress.city}, {checkedAddress.state} {checkedAddress.postalCode}
            </p>
          </div>
        </section>
      )}
    </section>
  )
}

export default AddressChecker
