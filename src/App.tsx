import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

type Resource = {
  id: string
  name: string
  capacity: number
}

type SchoolSession = {
  id: string
  number: number
  label: string
}

type Availability = {
  booking_date: string
  session_id: string
  available_quantity: number
}

type SavedReservation = {
  groupId: string
  token: string
  resourceName: string
  sessionLabel: string
  dates: string[]
  quantity: number
  teacherName?: string
}

type AppTab = 'calendar' | 'quick' | 'blocks'
type CalendarScreen = 'calendar' | 'sessions' | 'detail' | 'reservation-detail'

const savedReservationsKey = 'reserves-bonavista-reservations'
const schoolLogo = '/reserves-bonavista/ceip-bonavista-logo.jpg'
const firstSchoolDay = '2026-09-07'
const lastSchoolDay = '2027-06-18'

// Dies no lectius marcats en roig al calendari escolar 2026-27 del centre.
const nonLectiveDates = new Set([
  '2026-09-08', '2026-09-09',
  '2026-10-09', '2026-10-12',
  '2026-12-07', '2026-12-08', '2026-12-23', '2026-12-24', '2026-12-25',
  '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
  '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06',
  '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19',
  '2027-03-25', '2027-03-26', '2027-03-29', '2027-03-30', '2027-03-31',
  '2027-04-01', '2027-04-02', '2027-04-05',
])

const schoolDateMarkers: Record<string, string> = {
  '2026-09-07': 'Inici de les classes amb alumnat',
  '2027-06-18': 'Últim dia de classes amb alumnat',
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string, withYear = true) {
  if (!value) return 'Tria un dia'
  const date = new Intl.DateTimeFormat('ca-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(`${value}T12:00:00`))
  return date.charAt(0).toLocaleUpperCase('ca-ES') + date.slice(1)
}

function formatMonth(date: Date) {
  const value = new Intl.DateTimeFormat('ca-ES', { month: 'long', year: 'numeric' }).format(date)
  return value.charAt(0).toLocaleUpperCase('ca-ES') + value.slice(1)
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T12:00:00`))
}

function makeBookingDates(start: string, end: string, repeatWeekly: boolean) {
  if (!start) return []
  if (repeatWeekly && !end) return []

  const lastDate = repeatWeekly ? end : start
  if (lastDate < start) return []

  const dates: string[] = []
  const current = new Date(`${start}T12:00:00`)
  const last = new Date(`${lastDate}T12:00:00`)
  while (current <= last && dates.length <= 60) {
    dates.push(dateToInputValue(current))
    current.setDate(current.getDate() + (repeatWeekly ? 7 : 1))
  }
  return dates
}

function getCalendarCells(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - mondayOffset + 1
    if (day < 1 || day > daysInMonth) return null
    const date = new Date(month.getFullYear(), month.getMonth(), day)
    return { day, date: dateToInputValue(date), weekday: date.getDay() }
  })
}

function readSavedReservations(): SavedReservation[] {
  try {
    const value = localStorage.getItem(savedReservationsKey)
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed as SavedReservation[] : []
  } catch {
    return []
  }
}

function App() {
  const today = dateToInputValue(new Date())
  const [resources, setResources] = useState<Resource[]>([])
  const [sessions, setSessions] = useState<SchoolSession[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [bookingDate, setBookingDate] = useState(today)
  const [repeatUntil, setRepeatUntil] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [teacher, setTeacher] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<AppTab>('calendar')
  const [calendarScreen, setCalendarScreen] = useState<CalendarScreen>('calendar')
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [availability, setAvailability] = useState<Availability[]>([])
  const [availabilityRevision, setAvailabilityRevision] = useState(0)
  const [savedReservations, setSavedReservations] = useState<SavedReservation[]>(readSavedReservations)
  const [openReservationId, setOpenReservationId] = useState('')
  const [reservationToCancel, setReservationToCancel] = useState<SavedReservation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false)
  const [availabilityError, setAvailabilityError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const resource = resources.find((item) => item.id === selectedResourceId)
  const selectedSession = sessions.find((item) => item.id === selectedSessionId)
  const openReservation = savedReservations.find((item) => item.groupId === openReservationId)
  const repeatWeekly = activeTab === 'blocks'
  const bookingDates = useMemo(
    () => makeBookingDates(bookingDate, repeatUntil, repeatWeekly),
    [bookingDate, repeatUntil, repeatWeekly],
  )
  const calendarDates = useMemo(() => {
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, index) =>
      dateToInputValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)),
    ).filter((date) => date >= today)
  }, [today, visibleMonth])
  const availabilityDates = useMemo(() => {
    if (activeTab === 'blocks') return bookingDates.length ? bookingDates : (bookingDate ? [bookingDate] : calendarDates)
    return calendarDates
  }, [activeTab, bookingDate, bookingDates, calendarDates])
  const calendarCells = useMemo(() => getCalendarCells(visibleMonth), [visibleMonth])

  useEffect(() => {
    if (!supabase) {
      setLoadError('La connexió amb la base de dades encara no està configurada.')
      setIsLoading(false)
      return
    }

    let isCurrent = true
    async function loadSchoolData() {
      const [categoriesResult, resourcesResult, sessionsResult] = await Promise.all([
        supabase!.from('resource_categories').select('id,name,sort_order').eq('is_active', true).order('sort_order'),
        supabase!.from('resources').select('id,name,capacity,category_id').eq('is_active', true).order('name'),
        supabase!.from('school_sessions').select('id,session_number,label').eq('is_active', true).order('session_number'),
      ])

      if (!isCurrent) return
      if (categoriesResult.error || resourcesResult.error || sessionsResult.error) {
        setLoadError('No s’han pogut carregar els recursos. Revisa la configuració d’accés.')
        setIsLoading(false)
        return
      }

      const categories = categoriesResult.data ?? []
      const categoryNames = new Map(categories.map((item) => [item.id, item.name]))
      const categoryOrder = new Map(categories.map((item) => [item.id, item.sort_order]))
      const orderedResourceRows = [...(resourcesResult.data ?? [])].sort((left, right) =>
        (categoryOrder.get(left.category_id) ?? 0) - (categoryOrder.get(right.category_id) ?? 0)
        || left.name.localeCompare(right.name),
      )
      const loadedResources = orderedResourceRows.map((item) => ({
        id: item.id,
        name: categoryNames.get(item.category_id) ?? item.name,
        capacity: item.capacity,
      }))

      setResources(loadedResources)
      setSelectedResourceId((current) => current || loadedResources[0]?.id || '')
      setSessions((sessionsResult.data ?? []).map((item) => ({
        id: item.id,
        number: item.session_number,
        label: item.label,
      })))
      setIsLoading(false)
    }

    void loadSchoolData()
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    if (!supabase || !resource || availabilityDates.length === 0) {
      setAvailability([])
      setIsLoadingAvailability(false)
      return
    }

    let isCurrent = true
    setAvailability([])
    setAvailabilityError(false)
    setIsLoadingAvailability(true)

    async function loadAvailability() {
      const { data, error } = await supabase!.rpc('get_reservation_availability', {
        p_resource_id: resource!.id,
        p_booking_dates: availabilityDates,
      })

      if (!isCurrent) return
      setAvailabilityError(Boolean(error))
      setAvailability(error ? [] : (data ?? []) as Availability[])
      setIsLoadingAvailability(false)
    }

    void loadAvailability()
    return () => {
      isCurrent = false
    }
  }, [availabilityDates, availabilityRevision, resource])

  function availableForSession(sessionId: string, dates: string[]) {
    if (dates.length === 0) return null
    const dateSet = new Set(dates)
    const records = availability.filter((item) => item.session_id === sessionId && dateSet.has(item.booking_date))
    if (records.length !== dates.length) return null
    return Math.min(...records.map((item) => item.available_quantity))
  }

  function isNonLectiveDate(date: string) {
    const weekday = new Date(`${date}T12:00:00`).getDay()
    return date < firstSchoolDay || date > lastSchoolDay
      || weekday === 0 || weekday === 6 || nonLectiveDates.has(date)
  }

  function dayStatus(date: string) {
    if (isNonLectiveDate(date)) return 'non-lectiu'
    if (date < today) return 'past'
    if (isLoadingAvailability) return 'loading'
    const statuses = sessions.map((item) => availableForSession(item.id, [date]))
    if (availabilityError || statuses.length === 0 || statuses.some((value) => value === null)) return 'unknown'
    return statuses.some((value) => value !== null && value > 0) ? 'free' : 'reserved'
  }

  function setDate(value: string) {
    setBookingDate(value)
    if (value) {
      const parsed = new Date(`${value}T12:00:00`)
      setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
    setSelectedSessionId('')
    setMessage('')
  }

  function openTab(tab: AppTab) {
    setActiveTab(tab)
    setCalendarScreen('calendar')
    setSelectedSessionId('')
    setRepeatUntil('')
    setMessage('')
    setMenuOpen(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!supabase || !resource || !selectedSession) {
      setMessage('Tria un recurs, un dia i una sessió abans de continuar.')
      return
    }
    if (activeTab === 'blocks' && !repeatUntil) {
      setMessage('Indica fins a quin dia vols repetir la reserva.')
      return
    }

    const dates = makeBookingDates(bookingDate, repeatUntil, activeTab === 'blocks')
    if (dates.length === 0 || dates.length > 60) {
      setMessage('El període ha de contindre entre 1 i 60 dates.')
      return
    }
    if (dates.some(isNonLectiveDate)) {
      setMessage('Tria només dies lectius del calendari escolar.')
      return
    }
    if (!teacher.trim()) {
      setMessage('Escriu el nom del docent que fa la reserva.')
      return
    }
    if (isLoadingAvailability) {
      setMessage('Espera un moment mentre comprovem la disponibilitat.')
      return
    }

    const minAvailable = availableForSession(selectedSession.id, dates)
    if (minAvailable !== null && quantity > minAvailable) {
      setMessage(`En alguna de les dates només queden ${minAvailable} unitats disponibles.`)
      return
    }

    setIsSubmitting(true)
    const { data, error } = await supabase.rpc('create_reservation_group', {
      p_teacher_name: teacher.trim(),
      p_resource_id: resource.id,
      p_session_id: selectedSession.id,
      p_booking_dates: dates,
      p_quantity: quantity,
    })
    setIsSubmitting(false)

    if (error) {
      setMessage(error.message.includes('remaining availability')
        ? 'Ja no hi ha prou unitats lliures en una de les dates triades. Revisa la disponibilitat.'
        : error.message.includes('non-lective')
          ? 'Hi ha una data no lectiva en la selecció. Revisa el calendari escolar.'
          : 'No s’ha pogut crear la reserva. Torna-ho a provar d’ací a un moment.')
      return
    }

    const created = Array.isArray(data) ? data[0] : data
    if (!created?.group_id || !created?.cancellation_token) {
      setMessage('La reserva no s’ha pogut confirmar. Torna-ho a provar.')
      return
    }

    const nextReservations: SavedReservation[] = [{
      groupId: created.group_id,
      token: created.cancellation_token,
      resourceName: resource.name,
      sessionLabel: selectedSession.label,
      dates,
      quantity,
      teacherName: teacher.trim(),
    }, ...savedReservations]
    setSavedReservations(nextReservations)
    try {
      localStorage.setItem(savedReservationsKey, JSON.stringify(nextReservations))
    } catch {
      // La confirmació continua visible encara que el navegador no puga guardar-la.
    }

    setMessage('Reserva confirmada. La podràs consultar o cancel·lar des d’aquest navegador.')
    setAvailabilityRevision((revision) => revision + 1)
    setActiveTab('calendar')
    setCalendarScreen('sessions')
  }

  async function cancelReservation(reservation: SavedReservation) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('cancel_reservation_group', {
      p_group_id: reservation.groupId,
      p_cancellation_token: reservation.token,
    })

    if (error || data !== true) {
      setMessage('No s’ha pogut cancel·lar la reserva. Torna-ho a provar.')
      setReservationToCancel(null)
      return
    }

    const remaining = savedReservations.filter((item) => item.groupId !== reservation.groupId)
    setSavedReservations(remaining)
    try {
      localStorage.setItem(savedReservationsKey, JSON.stringify(remaining))
    } catch {
      // La pantalla actual es manté actualitzada encara que el navegador no puga guardar-la.
    }
    setMessage('La reserva s’ha cancel·lat.')
    setReservationToCancel(null)
    setCalendarScreen('calendar')
    setAvailabilityRevision((revision) => revision + 1)
  }

  function modifyReservation(reservation: SavedReservation) {
    const matchedResource = resources.find((item) => item.name === reservation.resourceName)
    const matchedSession = sessions.find((item) => item.label === reservation.sessionLabel)
    const firstDate = reservation.dates[0] ?? today
    if (matchedResource) setSelectedResourceId(matchedResource.id)
    setDate(firstDate)
    setSelectedSessionId(matchedSession?.id ?? '')
    setTeacher(reservation.teacherName ?? '')
    setQuantity(reservation.quantity)
    setActiveTab('quick')
    setCalendarScreen('calendar')
    setMessage('Prepara la nova reserva i crea-la; després podràs anul·lar l’anterior.')
  }

  const requestedDates = activeTab === 'blocks' ? bookingDates : (bookingDate ? [bookingDate] : [])
  const maxQuantity = resource
    ? Math.max(1, Math.min(resource.capacity, availableForSession(selectedSessionId, requestedDates) ?? resource.capacity))
    : 1

  function renderResourceField() {
    return (
      <label className="field-label field-stack" htmlFor="resource-choice">
        <span>Espai o recurs</span>
        <select
          id="resource-choice"
          value={selectedResourceId}
          onChange={(event) => {
            setSelectedResourceId(event.target.value)
            setQuantity(1)
            setSelectedSessionId('')
            setMessage('')
          }}
          required
        >
          <option value="" disabled>Tria un recurs</option>
          {resources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    )
  }

  function renderSessionRows(dates: string[], selectSession: (session: SchoolSession) => void) {
    return (
      <div className="session-list" role="group" aria-label="Sessions del dia">
        {sessions.map((item) => {
          const available = availableForSession(item.id, dates)
          const unavailable = available !== null && available < 1
          const selected = selectedSessionId === item.id
          const status = isLoadingAvailability ? 'Comprovant…'
            : unavailable ? 'Reservada'
              : available === null ? '—'
                : resource && resource.capacity > 1 ? `${available} lliures` : 'Lliure'

          return (
            <button
              className={`session-row${unavailable ? ' reserved' : ' free'}${selected ? ' selected' : ''}`}
              key={item.id}
              type="button"
              aria-label={`${item.number}a sessió, ${status}`}
              disabled={unavailable || isLoadingAvailability || dates.length === 0}
              onClick={() => selectSession(item)}
            >
              <strong>{item.number}a sessió</strong>
              <span className="session-status">{status}</span>
              <span className="row-chevron" aria-hidden="true">›</span>
            </button>
          )
        })}
      </div>
    )
  }

  function renderTeacherAndQuantity() {
    return (
      <div className="form-fields">
        <label className="field-label field-stack" htmlFor="teacher-name">
          <span>Nom del docent</span>
          <input
            id="teacher-name"
            type="text"
            value={teacher}
            onChange={(event) => setTeacher(event.target.value)}
            placeholder="Escriu el teu nom"
            autoComplete="name"
            maxLength={120}
            required
          />
        </label>
        {resource && resource.capacity > 1 && (
          <label className="field-label field-stack" htmlFor="quantity">
            <span>Quantitat (fins a {maxQuantity})</span>
            <input
              id="quantity"
              type="number"
              min="1"
              max={maxQuantity}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              required
            />
          </label>
        )}
      </div>
    )
  }

  function renderMessage() {
    return message ? <p className="app-message" role="status">{message}</p> : null
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inici" aria-label="Reserves CEIP Bonavista, inici" onClick={() => openTab('calendar')}>
          <img className="brand-logo" src={schoolLogo} alt="CEIP Bonavista d’Alaquàs" />
          <span className="brand-school">
            <span>Generalitat Valenciana</span>
            <strong>CEIP BONAVISTA</strong>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Tancar menú' : 'Obrir menú'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
        {menuOpen && (
          <div className="menu-popover">
            <strong>Reserves del centre</strong>
            <button type="button" onClick={() => { openTab('calendar'); setCalendarScreen('calendar') }}>Calendari</button>
            <button type="button" onClick={() => openTab('quick')}>Reserva ràpida</button>
            <button type="button" onClick={() => openTab('blocks')}>Reserva per blocs</button>
            <a href="#meues-reserves" onClick={() => setMenuOpen(false)}>Les meues reserves</a>
          </div>
        )}
      </header>

      <nav className="mode-tabs" aria-label="Tipus de reserva">
        <button type="button" className={activeTab === 'calendar' ? 'active' : ''} onClick={() => openTab('calendar')}>
          <span aria-hidden="true">▦</span>Calendari
        </button>
        <button type="button" className={activeTab === 'quick' ? 'active' : ''} onClick={() => openTab('quick')}>
          <span aria-hidden="true">▢</span>Reserva ràpida
        </button>
        <button type="button" className={activeTab === 'blocks' ? 'active' : ''} onClick={() => openTab('blocks')}>
          <span aria-hidden="true">▣</span>Per blocs
        </button>
      </nav>

      <main id="inici" className="main-layout">
        {(isLoading || loadError) && (
          <div className={`notice${loadError ? ' error' : ''}`} role={loadError ? 'alert' : 'status'}>
            {loadError || 'Carregant els recursos del centre…'}
          </div>
        )}
        {renderMessage()}

        {activeTab === 'calendar' && (
          <section className="screen-card">
            {calendarScreen === 'calendar' && (
              <>
                <div className="screen-heading"><span className="heading-icon">▦</span><div><p>RESERVA PER DATA</p><h1>Calendari</h1></div></div>
                {renderResourceField()}
                <div className="month-controls">
                  <button type="button" aria-label="Mes anterior" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
                  <h2>{formatMonth(visibleMonth)}</h2>
                  <button type="button" aria-label="Mes següent" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
                </div>
                <div className="weekday-labels" aria-hidden="true">
                  {['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="calendar-grid" role="grid" aria-label={formatMonth(visibleMonth)}>
                  {calendarCells.map((cell, index) => {
                    if (!cell) return <span className="calendar-empty" key={`empty-${index}`} />
                    const status = dayStatus(cell.date)
                    const isDisabled = cell.date < today || status === 'non-lectiu'
                    const marker = schoolDateMarkers[cell.date]
                    return (
                      <button
                        className={`calendar-day day-${status}${bookingDate === cell.date ? ' selected' : ''}${marker ? ' day-milestone' : ''}`}
                        key={cell.date}
                        type="button"
                        role="gridcell"
                        title={marker}
                        aria-label={`${formatDate(cell.date)}${marker ? `, ${marker}` : ''}${status === 'non-lectiu' ? ', no lectiu' : status === 'reserved' ? ', sense sessions lliures' : status === 'free' ? ', amb sessions lliures' : ''}`}
                        aria-pressed={bookingDate === cell.date}
                        disabled={isDisabled}
                        onClick={() => {
                          setDate(cell.date)
                          setCalendarScreen('sessions')
                        }}
                      >
                        <span>{cell.day}</span>
                        {status !== 'past' && <i aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
                <div className="calendar-legend">
                  <span><i className="legend-free" />Lliure</span>
                  <span><i className="legend-reserved" />Reservada</span>
                  <span><i className="legend-closed" />No lectiu</span>
                </div>
                {availabilityError && <p className="inline-note">No s’ha pogut consultar la disponibilitat ara mateix.</p>}
                <div id="meues-reserves" className="saved-section">
                  <div className="section-heading"><h2>Les meues reserves</h2><span>{savedReservations.length}</span></div>
                  {savedReservations.length === 0 ? (
                    <p className="empty-note">Ací apareixeran les reserves creades des d’aquest navegador.</p>
                  ) : (
                    <div className="saved-list">
                      {savedReservations.map((item) => (
                        <button className="saved-item" type="button" key={item.groupId} onClick={() => { setOpenReservationId(item.groupId); setCalendarScreen('reservation-detail') }}>
                          <span><strong>{item.resourceName}</strong><small>{formatShortDate(item.dates[0])} · {item.sessionLabel} sessió</small></span>
                          <span className="row-chevron" aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {calendarScreen === 'sessions' && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen('calendar')}>‹ <span>Tornar al calendari</span></button>
                <div className="screen-heading"><span className="heading-icon">▦</span><div><p>{resource?.name ?? 'Recurs'}</p><h1>Sessions del dia</h1></div></div>
                <h2 className="selected-date-heading">{formatDate(bookingDate)}</h2>
                {renderSessionRows([bookingDate], (item) => {
                  setSelectedSessionId(item.id)
                  setCalendarScreen('detail')
                })}
                {availabilityError && <p className="inline-note">No s’ha pogut consultar la disponibilitat ara mateix.</p>}
                <button className="primary-button" type="button" onClick={() => openTab('quick')}>＋ Nova reserva ràpida</button>
              </>
            )}

            {calendarScreen === 'detail' && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen('sessions')}>‹ <span>Tornar a les sessions</span></button>
                <div className="screen-heading"><span className="heading-icon">▢</span><div><p>DETALL DE LA RESERVA</p><h1>Confirma les dades</h1></div></div>
                <div className="reservation-summary">
                  <strong>{resource?.name}</strong>
                  <span>▦ &nbsp;{formatDate(bookingDate)}</span>
                  <span>◷ &nbsp;{selectedSession ? `${selectedSession.number}a sessió` : ''}</span>
                </div>
                <form className="reservation-form" onSubmit={handleSubmit}>
                  {renderTeacherAndQuantity()}
                  <button className="primary-button" type="submit" disabled={isSubmitting || isLoadingAvailability || !selectedSession}>
                    {isSubmitting ? 'Enviant…' : 'Confirmar reserva'}
                  </button>
                </form>
              </>
            )}

            {calendarScreen === 'reservation-detail' && openReservation && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen('calendar')}>‹ <span>Les meues reserves</span></button>
                <div className="screen-heading"><span className="heading-icon">▢</span><div><p>DETALL DE LA RESERVA</p><h1>La teua reserva</h1></div></div>
                <div className="reservation-summary">
                  <strong>{openReservation.resourceName}</strong>
                  {openReservation.dates.map((date) => <span key={date}>▦ &nbsp;{formatDate(date)}</span>)}
                  <span>◷ &nbsp;{openReservation.sessionLabel} sessió</span>
                  {openReservation.teacherName && <span>♙ &nbsp;{openReservation.teacherName}</span>}
                  {openReservation.quantity > 1 && <span>Quantitat &nbsp;{openReservation.quantity}</span>}
                </div>
                <div className="detail-actions">
                  <button className="danger-outline" type="button" onClick={() => setReservationToCancel(openReservation)}>⌫ &nbsp;Anul·lar reserva</button>
                  <button className="secondary-button" type="button" onClick={() => modifyReservation(openReservation)}>✎ &nbsp;Modificar</button>
                </div>
              </>
            )}
          </section>
        )}

        {(activeTab === 'quick' || activeTab === 'blocks') && (
          <section className="screen-card">
            <div className="screen-heading"><span className="heading-icon">{activeTab === 'quick' ? '▢' : '▣'}</span><div><p>{activeTab === 'quick' ? 'UNA RESERVA' : 'RESERVES RECURRENTS'}</p><h1>{activeTab === 'quick' ? 'Reserva ràpida' : 'Reserva per blocs'}</h1></div></div>
            <form className="reservation-form" onSubmit={handleSubmit}>
              {renderResourceField()}
              <label className="field-label field-stack" htmlFor="booking-date">
                <span>Dia de la reserva</span>
                <input id="booking-date" type="date" min={today} value={bookingDate} onChange={(event) => setDate(event.target.value)} required />
              </label>
              {activeTab === 'blocks' && (
                <label className="field-label field-stack" htmlFor="repeat-until">
                  <span>Repetir cada setmana fins al dia</span>
                  <input
                    id="repeat-until"
                    type="date"
                    min={bookingDate || today}
                    value={repeatUntil}
                    onChange={(event) => { setRepeatUntil(event.target.value); setSelectedSessionId(''); setMessage('') }}
                    required
                  />
                  <small>Es repetiran les mateixes sessions cada setmana, fins a 60 dates.</small>
                </label>
              )}
              <div className="section-heading"><h2>{activeTab === 'blocks' ? 'Sessió per a cada data' : 'Sessions del dia'}</h2></div>
              {activeTab === 'blocks' && bookingDates.length > 0 && <p className="inline-note">Es crearan {bookingDates.length} reserves setmanals, sempre que hi haja disponibilitat.</p>}
              {renderSessionRows(activeTab === 'blocks' ? bookingDates : [bookingDate], (item) => { setSelectedSessionId(item.id); setMessage('') })}
              {renderTeacherAndQuantity()}
              <button className="primary-button" type="submit" disabled={isSubmitting || isLoading || isLoadingAvailability || !selectedSession}>
                {isSubmitting ? 'Enviant…' : activeTab === 'blocks' ? 'Confirmar reserves' : 'Nova reserva'}
              </button>
            </form>
          </section>
        )}

        <aside className="help-card">
          <span className="help-icon" aria-hidden="true">i</span>
          <span><strong>Necessites ajuda?</strong><small>Consulta amb l’equip de coordinació del centre.</small></span>
          <span className="row-chevron" aria-hidden="true">›</span>
        </aside>
      </main>

      <footer className="footer"><span>CEIP BONAVISTA</span><span>Una eina per a compartir millor</span></footer>

      {reservationToCancel && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReservationToCancel(null) }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <span className="trash-icon" aria-hidden="true">⌫</span>
            <h2 id="cancel-title">Segur que vols anul·lar aquesta reserva?</h2>
            <p>La sessió tornarà a estar disponible per a la resta del professorat.</p>
            <button className="confirm-danger" type="button" onClick={() => void cancelReservation(reservationToCancel)}>Sí, anul·lar</button>
            <button className="secondary-button" type="button" onClick={() => setReservationToCancel(null)}>No, tornar</button>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
